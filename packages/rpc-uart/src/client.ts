/**
 * Typed facade over the dongle's `/rpc/uart/<n>` endpoint.
 *
 * Wraps a connected `RpcClient` and exposes each `uart.*` method with
 * its proper TypeScript shape, converting binary payloads to/from
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

export class UartClient {
  constructor(public readonly rpc: RpcClient) {}

  /** Claim the UART, configure framing, start the RX stream. */
  async open(opts: UartOpenOptions = {}): Promise<UartOpenResult> {
    return this.rpc.request<UartOpenResult>("uart.open", opts);
  }

  /** Update settings while open. Caller must already hold the lock. */
  async configure(opts: UartConfigureOptions): Promise<UartOpenResult> {
    return this.rpc.request<UartOpenResult>("uart.configure", opts);
  }

  /** Transmit raw bytes. Echo is auto-consumed if `consumeEcho` is set on open. */
  async write(data: Uint8Array): Promise<UartWriteResult> {
    return this.rpc.request<UartWriteResult>("uart.write", {
      data: encodeBase64(data),
    });
  }

  /** Transmit then synchronously read the response within `readMs`. */
  async transact(
    data: Uint8Array,
    opts: UartTransactOptions,
  ): Promise<Uint8Array> {
    const r = await this.rpc.request<{ data: string; len: number }>(
      "uart.transact",
      { data: encodeBase64(data), readMs: opts.readMs, readBytes: opts.readBytes },
    );
    return decodeBase64(r.data);
  }

  /** 5-baud bit-bang init (ISO 9141 / KWP2000 slow init). */
  async slowInit(opts: UartSlowInitOptions = {}): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>("uart.slowInit", opts);
  }

  /** KWP2000 fast-init break/idle pulse. */
  async fastInit(opts: UartFastInitOptions = {}): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>("uart.fastInit", opts);
  }

  /** Release the lock and stop the RX pump. */
  async close(): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>("uart.close", {});
  }

  /** Subscribe to streamed RX bytes. Returns an unsubscribe function. */
  onRx(handler: (ev: UartRxEvent) => void): Unsubscribe {
    return this.rpc.on<{ data: string }>("uart.rx", (params) => {
      handler({ data: decodeBase64(params.data) });
    });
  }

  /** Subscribe to revocation events (cooperative `open` from another client). */
  onRevoked(handler: (ev: UartRevokedEvent) => void): Unsubscribe {
    return this.rpc.on<UartRevokedEvent>("uart.revoked", handler);
  }
}

/** Convenience: build the WS URL, open it, and wrap in a UartClient. */
export async function connectUart(
  url: string,
  options?: RpcClientOptions,
): Promise<{ uart: UartClient; rpc: RpcClient }> {
  const rpc = new RpcClient(url, options);
  await rpc.connect();
  return { uart: new UartClient(rpc), rpc };
}
