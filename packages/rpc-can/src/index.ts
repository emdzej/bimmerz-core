/**
 * `@emdzej/bimmerz-rpc-can` — typed client for the bimmerz-box dongle's
 * `/rpc/can/<n>` endpoint. Wraps `@emdzej/bimmerz-rpc-core`.
 *
 * Classical CAN only (no CAN-FD on the dongle's TJA1051T transceivers).
 * See `bimmerz-box/docs/api.md` for the full server-side contract.
 */

export { CanClient, connectCan } from "./client.js";
export type {
  CanMode,
  CanBitrate,
  CanOpenOptions,
  CanConfigureOptions,
  CanOpenResult,
  CanFrame,
  CanSendBatchResult,
  CanRxEvent,
  CanRevokedEvent,
} from "./types.js";
