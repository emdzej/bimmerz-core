/**
 * `@emdzej/bimmerz-rpc-uart` — typed client for the bimmerz-box dongle's
 * `/rpc/uart/<n>` endpoint. Wraps `@emdzej/bimmerz-rpc-core`.
 *
 * See `bimmerz-box/docs/api.md` for the full server-side contract.
 */

export { UartClient, connectUart } from "./client.js";
export type {
  Parity,
  DataBits,
  StopBits,
  UartOpenOptions,
  UartConfigureOptions,
  UartOpenResult,
  UartWriteResult,
  UartTransactOptions,
  UartSlowInitOptions,
  UartFastInitOptions,
  UartRxEvent,
  UartRevokedEvent,
} from "./types.js";
