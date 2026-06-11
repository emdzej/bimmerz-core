/**
 * `@emdzej/bimmerz-rpc-core` — JSON-RPC 2.0 client over WebSocket.
 *
 * Used by the bimmerz-box dongle's `/rpc/...` endpoints. Transport-only:
 * this package owns the envelope, id correlation, timeout and reconnect
 * logic; the protocol-specific facades (UART, CAN, ...) live in sibling
 * packages and consume an `RpcClient` instance.
 */

export { RpcClient } from "./client.js";
export type {
  NotificationHandler,
  StatusListener,
  Unsubscribe,
} from "./client.js";

export {
  RpcError,
  RpcTimeoutError,
  RpcDisconnectedError,
} from "./errors.js";

export type {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResultMsg,
  JsonRpcErrorMsg,
  JsonRpcErrorBody,
  JsonRpcNotification,
  JsonRpcInboundMessage,
  RpcClientOptions,
  RpcStatus,
} from "./types.js";

export { encodeBase64, decodeBase64 } from "./base64.js";
