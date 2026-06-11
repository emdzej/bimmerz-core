/**
 * JSON-RPC 2.0 client over a single WebSocket.
 *
 * Lifecycle:
 *   const rpc = new RpcClient("ws://172.16.7.1/rpc/uart/0");
 *   await rpc.connect();
 *   const r = await rpc.request<{ ok: boolean }>("uart.open", { baud: 9600 });
 *   const off = rpc.on("uart.rx", (params) => ... );
 *   off();
 *   rpc.close();
 *
 * Concurrency: requests are correlated by `id` and may interleave freely;
 * the server is single-threaded per connection so order is preserved.
 * Pending requests reject with `RpcDisconnectedError` if the socket
 * closes before a reply arrives.
 */

import {
  RpcDisconnectedError,
  RpcError,
  RpcTimeoutError,
} from "./errors.js";
import type {
  JsonRpcId,
  JsonRpcInboundMessage,
  RpcClientOptions,
  RpcStatus,
} from "./types.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  method: string;
};

export type NotificationHandler<TParams = unknown> = (params: TParams) => void;
export type StatusListener = (status: RpcStatus) => void;
export type Unsubscribe = () => void;

export class RpcClient {
  readonly url: string;
  readonly options: RpcClientOptions;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private notifyHandlers = new Map<string, Set<NotificationHandler>>();
  private statusListeners = new Set<StatusListener>();
  private _status: RpcStatus = "idle";
  private explicitClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, options: RpcClientOptions = {}) {
    this.url = url;
    this.options = options;
  }

  get status(): RpcStatus {
    return this._status;
  }

  /** Open the WebSocket and resolve when the server accepts the upgrade. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._status === "open") return resolve();
      this.explicitClose = false;
      const WS = this.options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
      if (!WS) {
        return reject(new Error("WebSocket implementation not available"));
      }
      this.setStatus("connecting");
      let ws: WebSocket;
      try {
        ws = new WS(this.url);
      } catch (e) {
        this.setStatus("closed");
        return reject(e as Error);
      }
      this.ws = ws;
      ws.onopen = () => {
        this.setStatus("open");
        resolve();
      };
      ws.onerror = () => {
        if (this._status === "connecting") {
          reject(new Error("WebSocket connect failed"));
        }
      };
      ws.onclose = () => {
        this.setStatus("closed");
        this.failAllPending(new RpcDisconnectedError("socket closed before response"));
        this.ws = null;
        if (this.options.autoReconnect && !this.explicitClose) {
          const delay = this.options.reconnectDelayMs ?? 1000;
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch(() => { /* will retry again on next close */ });
          }, delay);
        }
      };
      ws.onmessage = (ev: MessageEvent) => {
        this.handleMessage(typeof ev.data === "string" ? ev.data : "");
      };
    });
  }

  /** Close the WebSocket. Disables auto-reconnect for the rest of the lifetime. */
  close(): void {
    this.explicitClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws && (this._status === "open" || this._status === "connecting")) {
      this.setStatus("closing");
      this.ws.close();
    }
  }

  /** Issue a JSON-RPC request and resolve with its `result` (or reject with `error`). */
  request<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
  ): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      if (this._status !== "open" || !this.ws) {
        return reject(new RpcDisconnectedError());
      }
      const id = this.nextId++;
      const timeoutMs = this.options.requestTimeoutMs ?? 30_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
      });
      try {
        this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  /** Fire-and-forget notification (no `id`, no response expected). */
  notify<TParams = unknown>(method: string, params?: TParams): void {
    if (this._status !== "open" || !this.ws) {
      throw new RpcDisconnectedError();
    }
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /** Subscribe to server-sent notifications of a given method name. */
  on<TParams = unknown>(
    method: string,
    handler: NotificationHandler<TParams>,
  ): Unsubscribe {
    let set = this.notifyHandlers.get(method);
    if (!set) {
      set = new Set();
      this.notifyHandlers.set(method, set);
    }
    const h = handler as NotificationHandler;
    set.add(h);
    return () => {
      set!.delete(h);
      if (set!.size === 0) this.notifyHandlers.delete(method);
    };
  }

  /** Observe connection-state transitions. */
  onStatusChange(handler: StatusListener): Unsubscribe {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  // ----- internals --------------------------------------------------------

  private setStatus(s: RpcStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const l of this.statusListeners) {
      try { l(s); } catch { /* ignore listener errors */ }
    }
  }

  private handleMessage(text: string): void {
    if (!text) return;
    let msg: JsonRpcInboundMessage;
    try {
      msg = JSON.parse(text) as JsonRpcInboundMessage;
    } catch {
      return;
    }
    if ("error" in msg && msg.error) {
      const p = this.pending.get(msg.id);
      if (p) {
        if (p.timer) clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data));
      }
      return;
    }
    if ("result" in msg) {
      const p = this.pending.get(msg.id);
      if (p) {
        if (p.timer) clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.resolve(msg.result);
      }
      return;
    }
    if ("method" in msg) {
      const handlers = this.notifyHandlers.get(msg.method);
      if (handlers) {
        for (const h of handlers) {
          try { h(msg.params); } catch { /* swallow listener errors */ }
        }
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
