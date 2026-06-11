# @emdzej/bimmerz-rpc-core

JSON-RPC 2.0 client over a single WebSocket, used by the bimmerz-box
dongle's `/rpc/...` endpoints. Transport-only — protocol-specific
clients (UART, CAN, ...) build on top.

## Install

```sh
pnpm add @emdzej/bimmerz-rpc-core
```

Node 22+ (WebSocket is a global) or any modern browser. For older Node
runtimes, install [`ws`](https://www.npmjs.com/package/ws) and pass it
via `WebSocketImpl`.

## Use

```ts
import { RpcClient } from "@emdzej/bimmerz-rpc-core";

const rpc = new RpcClient("ws://172.16.7.1/rpc/uart/0", {
  requestTimeoutMs: 5_000,
  autoReconnect: true,
});

await rpc.connect();

// Request → expect one result or one error
const result = await rpc.request<{ ok: boolean }>("uart.open", {
  baud: 9600,
  parity: "even",
});

// Subscribe to server-sent notifications
const off = rpc.on<{ data: string }>("uart.rx", ({ data }) => {
  // base64 RX bytes — decode with the helpers in this package
});

// Observe lifecycle
rpc.onStatusChange((s) => console.log("status:", s));

// Tear down (cancels reconnect)
off();
rpc.close();
```

## Errors

The promise returned by `request()` rejects with one of:

- `RpcError(code, message, data?)` — server returned a JSON-RPC error
- `RpcTimeoutError(method, timeoutMs)` — no reply within budget
- `RpcDisconnectedError` — socket closed before the reply arrived

## Binary payloads

The dongle wraps binary blobs (UART bytes, CAN data) as base64 strings
inside the JSON envelope. Use `encodeBase64` / `decodeBase64` exported
here, or rely on the typed facades (`@emdzej/bimmerz-rpc-uart`,
`@emdzej/bimmerz-rpc-can`) which hide the conversion.

## See also

- [bimmerz-box API reference](https://github.com/emdzej/bimmerz-box/blob/main/docs/api.md)
- `@emdzej/bimmerz-rpc-uart` — typed UART client
- `@emdzej/bimmerz-rpc-can` — typed CAN client
