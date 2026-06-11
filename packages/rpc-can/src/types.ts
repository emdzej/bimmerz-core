/**
 * CAN RPC method param + result shapes. Classical CAN only (no FD;
 * the dongle's TJA1051T transceivers and the firmware's TWAI driver
 * caps payload at 8 bytes). Mirrors the server contract in
 * `bimmerz-box/docs/api.md` (`/rpc/can/<n>` section).
 */

export type CanMode = "normal" | "listen-only" | "no-ack";

/** Standard CAN bitrates the dongle supports. */
export type CanBitrate =
  | 25_000
  | 50_000
  | 100_000
  | 125_000
  | 250_000
  | 500_000
  | 800_000
  | 1_000_000;

export interface CanOpenOptions {
  /** True → reject open if held; false (default) → revoke prior holder. */
  exclusive?: boolean;
  /** Bit-rate in bps. Must be one of the standard values. */
  bitrate: CanBitrate;
  /** Default `"normal"`. `"listen-only"` is read-only; `"no-ack"` doesn't ACK frames. */
  mode?: CanMode;
}

export interface CanConfigureOptions {
  bitrate?: CanBitrate;
  mode?: CanMode;
}

export interface CanOpenResult {
  ok: boolean;
  bitrate: number;
  mode: CanMode;
  exclusive: boolean;
}

/** A single CAN frame as the client sees it. */
export interface CanFrame {
  /** 11-bit (when `ext` is false) or 29-bit (when `ext` is true) identifier. */
  id: number;
  /** Extended-frame format flag. Default false. */
  ext?: boolean;
  /** Remote Transmission Request flag. Default false. */
  rtr?: boolean;
  /** Payload (0..8 bytes for classical CAN). Required even for RTR — pass an empty Uint8Array. */
  data: Uint8Array;
}

export interface CanSendBatchResult {
  sent: number;
  requested: number;
}

/** Received frame, as emitted by `can.rx`. */
export interface CanRxEvent {
  id: number;
  ext: boolean;
  rtr: boolean;
  data: Uint8Array;
  /** Microseconds since the dongle's boot (`esp_timer_get_time()`). */
  ts: number;
}

export interface CanRevokedEvent {
  by: string;
}
