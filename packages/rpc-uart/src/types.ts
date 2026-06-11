/**
 * UART RPC method param + result shapes. Mirrors the server contract
 * documented in `bimmerz-box/docs/api.md` (`/rpc/uart/<n>` section).
 */

export type Parity = "none" | "even" | "odd";
export type DataBits = 7 | 8;
export type StopBits = 1 | 2;

export interface UartOpenOptions {
  /** True → reject open if held; false (default) → revoke prior holder. */
  exclusive?: boolean;
  /** Bit-rate (bps). Default 9600 for K-line. */
  baud?: number;
  parity?: Parity;
  dataBits?: DataBits;
  stopBits?: StopBits;
  /**
   * For half-duplex K-line: `uart.write` reads the matching TX echo
   * back from the bus and discards it before returning, so callers
   * never see their own bytes. When false, the echo arrives via
   * `uart.rx`. Default true.
   */
  consumeEcho?: boolean;
}

export type UartConfigureOptions = UartOpenOptions;

export interface UartOpenResult {
  ok: boolean;
  baud: number;
  parity: Parity;
  exclusive: boolean;
  consumeEcho: boolean;
}

export interface UartWriteResult {
  ok: boolean;
  wrote: number;
}

export interface UartTransactOptions {
  /** Total budget (ms) for the response read. */
  readMs: number;
  /** Maximum bytes to read. Default 256. */
  readBytes?: number;
}

export interface UartSlowInitOptions {
  /** Byte to bit-bang at 5 baud. Default 0x33 (BMW K-line wake address). */
  value?: number;
  /** Bit time. Default 200 ms (ISO 9141). */
  bitTimeMs?: number;
  /** Optional baud rate to switch to immediately after the pulse. */
  baudAfter?: number;
  /** Optional parity to switch to after the pulse. */
  parityAfter?: Parity;
}

export interface UartFastInitOptions {
  /** Break duration. Default 25 ms (KWP2000). */
  breakMs?: number;
  /** Idle high duration after break. Default 25 ms. */
  idleMs?: number;
}

/** Streamed RX bytes. */
export interface UartRxEvent {
  data: Uint8Array;
}

/** Sent when a cooperative `open` kicks us off the bus. */
export interface UartRevokedEvent {
  by: string;
}
