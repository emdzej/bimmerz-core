# @emdzej/bimmerz-rpc-uart

Typed client for the bimmerz-box dongle's `/rpc/uart/<n>` endpoint
(`n = 0` is the K-line UART). Built on `@emdzej/bimmerz-rpc-core`.

## Install

```sh
pnpm add @emdzej/bimmerz-rpc-uart
```

## Use

```ts
import { connectUart } from "@emdzej/bimmerz-rpc-uart";

const { uart } = await connectUart("ws://172.16.7.1/rpc/uart/0", {
  autoReconnect: true,
});

await uart.open({ baud: 9600, parity: "even", consumeEcho: true });

uart.onRx(({ data }) => {
  console.log("RX:", Array.from(data, (b) => b.toString(16).padStart(2, "0")).join(" "));
});

// DS2 ident telegram: [ECU, LEN, CMD, XOR-by-server]
const resp = await uart.transact(new Uint8Array([0x12, 0x04, 0x00, 0x16]), {
  readMs: 1_000,
});

await uart.close();
```

## API mirror

Method → server call:

| Method                          | Server endpoint  |
|---------------------------------|------------------|
| `uart.open(opts)`               | `uart.open`      |
| `uart.configure(opts)`          | `uart.configure` |
| `uart.write(bytes)`             | `uart.write`     |
| `uart.transact(bytes, opts)`    | `uart.transact`  |
| `uart.slowInit(opts)`           | `uart.slowInit`  |
| `uart.fastInit(opts)`           | `uart.fastInit`  |
| `uart.close()`                  | `uart.close`     |
| `uart.onRx(handler)`            | subscribes to `uart.rx` |
| `uart.onRevoked(handler)`       | subscribes to `uart.revoked` |

Base64 wrapping of binary payloads is handled internally — both `write`
and `onRx` deal in `Uint8Array`.

## See also

- [bimmerz-box API reference](https://github.com/emdzej/bimmerz-box/blob/main/docs/api.md#rpcuartn)
- `@emdzej/bimmerz-rpc-core` — the JSON-RPC transport this builds on
- `@emdzej/bimmerz-rpc-can` — sibling client for the CAN endpoint
