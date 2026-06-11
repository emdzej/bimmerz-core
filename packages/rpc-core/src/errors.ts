/**
 * Error classes the JSON-RPC client may reject pending requests with.
 *
 * The naming mirrors common JSON-RPC libraries so consumers can match
 * by class without parsing strings.
 */

/** A `{ "error": { code, message } }` reply from the server. */
export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

/** Request waited longer than `requestTimeoutMs` for a reply. */
export class RpcTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;
  constructor(method: string, timeoutMs: number) {
    super(`RPC ${method} timed out after ${timeoutMs}ms`);
    this.name = "RpcTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/** The underlying WebSocket closed (or was never opened) when a request was issued. */
export class RpcDisconnectedError extends Error {
  constructor(message = "RPC connection is closed") {
    super(message);
    this.name = "RpcDisconnectedError";
  }
}
