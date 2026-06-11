# @emdzej/bimmerz-rpc-can

Typed client for the bimmerz-box dongle's `/rpc/can/<n>` endpoint
(`n = 0` and `n = 1` are the two TJA1051T transceivers on the custom
PCB). Built on `@emdzej/bimmerz-rpc-core`.

Classical CAN only — the dongle's TJA1051T transceivers don't support
CAN-FD. Payloads are capped at 8 bytes.

## Install

```sh
pnpm add @emdzej/bimmerz-rpc-can
```

## Use

```ts
import { connectCan } from "@emdzej/bimmerz-rpc-can";

const { can } = await connectCan("ws://172.16.7.1/rpc/can/0", {
  autoReconnect: true,
});

await can.open({ bitrate: 500_000, mode: "normal" });

can.onRx((frame) => {
  console.log(
    `[${frame.ts}] ${frame.id.toString(16).padStart(3, "0")}: ${
      Array.from(frame.data, (b) => b.toString(16).padStart(2, "0")).join(" ")
    }`,
  );
});

// Send a frame
await can.send({
  id: 0x6F1,
  data: new Uint8Array([0x12, 0x21, 0x01]),
});

await can.close();
```

## API mirror

Method → server call:

| Method                          | Server endpoint  |
|---------------------------------|------------------|
| `can.open(opts)`                | `can.open`       |
| `can.configure(opts)`           | `can.configure`  |
| `can.send(frame)`               | `can.send`       |
| `can.sendBatch(frames)`         | `can.sendBatch`  |
| `can.recover()`                 | `can.recover`    |
| `can.close()`                   | `can.close`      |
| `can.onRx(handler)`             | subscribes to `can.rx` |
| `can.onRevoked(handler)`        | subscribes to `can.revoked` |

`CanFrame` data is `Uint8Array`; base64 encoding for the wire is
handled internally.

## See also

- [bimmerz-box API reference](https://github.com/emdzej/bimmerz-box/blob/main/docs/api.md#rpccann)
- `@emdzej/bimmerz-rpc-core` — the JSON-RPC transport this builds on
- `@emdzej/bimmerz-rpc-uart` — sibling client for the UART endpoint
