/**
 * JSON-RPC 2.0 envelope types and connection-level configuration.
 *
 * The wire format follows the spec verbatim:
 *   - Requests carry an `id` and expect exactly one response (result OR error)
 *   - Notifications omit `id` and receive no response
 *   - Server-sent notifications use the same envelope shape but flow
 *     from server → client (e.g. `uart.rx`)
 *
 * Binary payloads are base64-encoded strings on the wire; the typed
 * facades over this layer (UartClient / CanClient) hide that detail.
 */

export type JsonRpcId = number | string | null;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcResultMsg<TResult = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorMsg {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorBody;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export type JsonRpcInboundMessage =
  | JsonRpcResultMsg
  | JsonRpcErrorMsg
  | JsonRpcNotification;

/** Connection lifecycle states. */
export type RpcStatus =
  | "idle"        // never connected
  | "connecting"  // socket handshake in flight
  | "open"        // ready to issue requests
  | "closing"     // close() called, socket draining
  | "closed";     // socket finished closing (terminal or pre-reconnect)

export interface RpcClientOptions {
  /**
   * Maximum time to wait for a `result` / `error` reply before the
   * request rejects with `RpcTimeoutError`. Default 30_000 ms.
   */
  requestTimeoutMs?: number;
  /**
   * If true, the client transparently reconnects on close (unless the
   * caller invoked `close()` explicitly). Default false.
   */
  autoReconnect?: boolean;
  /**
   * Delay between reconnect attempts. Default 1_000 ms.
   */
  reconnectDelayMs?: number;
  /**
   * WebSocket implementation. Defaults to `globalThis.WebSocket` (the
   * browser global, and the global in Node ≥ 22). Inject `ws.WebSocket`
   * or similar for older Node runtimes.
   */
  WebSocketImpl?: typeof WebSocket;
}
