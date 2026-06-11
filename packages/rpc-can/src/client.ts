/**
 * Typed facade over the dongle's `/rpc/can/<n>` endpoint.
 *
 * Wraps a connected `RpcClient` and exposes each `can.*` method with
 * its proper TypeScript shape, converting CAN frame payloads to/from
 * `Uint8Array` so callers never have to deal with base64.
 */

import {
  RpcClient,
  type RpcClientOptions,
  type Unsubscribe,
  encodeBase64,
  decodeBase64,
} from "@emdzej/bimmerz-rpc-core";

import type {
  CanOpenOptions,
  CanConfigureOptions,
  CanOpenResult,
  CanFrame,
  CanSendBatchResult,
  CanRxEvent,
  CanRevokedEvent,
} from "./types.js";

interface CanFrameWire {
  id: number;
  ext?: boolean;
  rtr?: boolean;
  data: string;
}

interface CanRxWire {
  id: number;
  ext: boolean;
  rtr: boolean;
  data: string;
  ts: number;
}

function frameToWire(f: CanFrame): CanFrameWire {
  return {
    id: f.id,
    ext: f.ext ?? false,
    rtr: f.rtr ?? false,
    data: encodeBase64(f.data),
  };
}

export class CanClient {
  constructor(public readonly rpc: RpcClient) {}

  /** Claim the controller, install the TWAI driver, start the RX stream. */
  async open(opts: CanOpenOptions): Promise<CanOpenResult> {
    return this.rpc.request<CanOpenResult>("can.open", opts);
  }

  /** Change bitrate / mode. The driver is uninstalled + reinstalled. */
  async configure(opts: CanConfigureOptions): Promise<CanOpenResult> {
    return this.rpc.request<CanOpenResult>("can.configure", opts);
  }

  /** Transmit a single CAN frame. */
  async send(frame: CanFrame): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>("can.send", frameToWire(frame));
  }

  /** Transmit up to 32 frames in one call. Stops on first failure. */
  async sendBatch(frames: CanFrame[]): Promise<CanSendBatchResult> {
    return this.rpc.request<CanSendBatchResult>("can.sendBatch", {
      frames: frames.map(frameToWire),
    });
  }

  /** Explicit bus-off recovery. */
  async recover(): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>("can.recover", {});
  }

  /** Release the lock, uninstall the driver, drive the transceiver's S pin high. */
  async close(): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>("can.close", {});
  }

  /** Subscribe to streamed CAN frames. Returns an unsubscribe function. */
  onRx(handler: (frame: CanRxEvent) => void): Unsubscribe {
    return this.rpc.on<CanRxWire>("can.rx", (params) => {
      handler({
        id: params.id,
        ext: params.ext,
        rtr: params.rtr,
        data: decodeBase64(params.data),
        ts: params.ts,
      });
    });
  }

  /** Subscribe to revocation events (cooperative `open` from another client). */
  onRevoked(handler: (ev: CanRevokedEvent) => void): Unsubscribe {
    return this.rpc.on<CanRevokedEvent>("can.revoked", handler);
  }
}

/** Convenience: build the WS URL, open it, and wrap in a CanClient. */
export async function connectCan(
  url: string,
  options?: RpcClientOptions,
): Promise<{ can: CanClient; rpc: RpcClient }> {
  const rpc = new RpcClient(url, options);
  await rpc.connect();
  return { can: new CanClient(rpc), rpc };
}
