# @emdzej/bimmerz-ui

Shared **Svelte 5** components + lifecycle hooks for the bimmerz app
family (dashx, ediabasx, inpax, ncsx, …). Source-only — consumer
apps' Vite + svelte-plugin compiles them. No pre-compiled output.

## Convention: source-only Svelte libs

Svelte components ship as `.svelte` files, rune helpers as
`.svelte.ts` — both compiled by the consumer's Svelte plugin. The
`package.json` carries:

```json
{
  "svelte": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "svelte": "./src/index.ts",
      "import": "./src/index.ts"
    }
  }
}
```

The `svelte` export condition is what the consumer's Vite plugin
reads to locate the source. The `types` condition lets
`svelte-check` resolve them the same way without an explicit
`.d.ts` step.

**Why:** Svelte 5's compiler output depends on the consumer's
compiler version + rune config. Pre-compiling locks the output to
whichever Svelte version the lib was built against and breaks
tree-shaking + HMR in the consuming app. Letting consumers compile
means every version, every dev mode, every runes setting works.

A consumer's `vite.config.ts` should also tell `optimizeDeps`
about us so the dev server pre-bundles the source:

```ts
optimizeDeps: {
  include: ["@emdzej/bimmerz-ui"],
}
```

## Required peer setup

Components use semantic colour tokens (`bg-surface`,
`text-foreground`, `text-accent`, `m-stripe`, …) from
[`@emdzej/bimmerz-theme`](../theme). Wire that preset into the
consumer app's `tailwind.config.ts` and import its `tokens.css`
first; the components break visually without those tokens.

## Components

| Name | Purpose |
|---|---|
| `<Brand body suffix class? />` | Split-colour wordmark — body in foreground, suffix in accent. |
| `<MStripe class? />` | BMW M tricolour bar (light-blue / dark-blue / red) used as the page-top signature. Renders the `.m-stripe` element from `@emdzej/bimmerz-theme/tokens.css`. |

### `<Brand>`

```svelte
<script lang="ts">
  import { Brand } from "@emdzej/bimmerz-ui";
</script>

<Brand body="EDIABAS" suffix="X" />
<Brand body="DASH"    suffix="X" class="text-2xl" />
```

Default styling is `text-sm font-bold tracking-wide`. Pass extra
Tailwind classes via `class` for hero / welcome-screen variants.
Each consumer app picks its own `accent` colour via
`tailwind.config.ts` extend.

### `<MStripe>`

```svelte
<script lang="ts">
  import { MStripe } from "@emdzej/bimmerz-ui";
</script>

<MStripe />
<MStripe class="h-2" />  <!-- thicker variant -->
```

Renders three bands (`m-stripe__band--light`, `--dark`, `--red`).
Colours resolve through the `.m-stripe` CSS in
`@emdzej/bimmerz-theme/tokens.css` — consumer must have those
tokens imported. Default height is 4 px.

## Hooks

### `useEmbeddedAutoConnect`

Embedded-mode lifecycle hook for every dongle-hosted app. Browser
builds keep the manual "Connect" button; embedded builds (those
served by the bimmerz-box at `/dashx/`, `/inpax/`, …) wire this
hook into `App.svelte` to **auto-connect on open**, **auto-disconnect
on close**, and **auto-reconnect with exponential backoff** on
transient transport drops.

The hook is a **no-op when `isEmbedded === false`**, so calling it
unconditionally from `App.svelte` is the intended pattern. Must be
called inside a Svelte 5 component context (uses `$effect`).

```svelte
<script lang="ts">
  import { useEmbeddedAutoConnect } from "@emdzej/bimmerz-ui";
  import { isEmbedded } from "./lib/embedded";
  import { app } from "./lib/state.svelte";
  import { connect, disconnect } from "./lib/connection.svelte";

  useEmbeddedAutoConnect({
    isEmbedded,
    connect,
    disconnect,
    /* Optional readiness gate — inpax/ncsx wait for the install to
       load before connecting; dashx/ediabasx can omit this. */
    isReady: () => app.install !== null,
    /* Drives the auto-reconnect loop: when this flips back to
       false (transient Wi-Fi drop, dongle reboot, bus-off), the
       hook re-enters the backoff retry loop. */
    isConnected: () => app.status.kind === "connected",
  });
</script>
```

**Behaviour:**

| Event | Effect |
|---|---|
| Mount, `isEmbedded` + `isReady` true | Call `connect()` once. |
| `connect()` throws | Retry with exponential backoff (1 → 2 → 4 → 8 → 16 → 30 s cap). Reset on success. |
| `isConnected()` observed false later | Re-enter the backoff retry loop. |
| `beforeunload` / `pagehide` | Fire-and-forget `disconnect()` so the dongle WebSocket closes cleanly. Both events handled — `pagehide` covers mobile Safari's bfcache. |
| `isEmbedded` false | Hook does nothing. Manual Connect button stays in charge. |

**Options:**

```ts
interface AutoConnectOptions {
  isEmbedded: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isReady?: () => boolean;          // default: always ready
  isConnected?: () => boolean;      // omit to attempt only once
  maxBackoffMs?: number;            // default 30_000
  initialBackoffMs?: number;        // default 1_000
  log?: (msg: string, level?: "info" | "warn" | "error") => void;
}
```

**Where to use it:**

- **dashx-web** — `connect()` opens the RPC CAN session at
  `${origin}/rpc/can/0`. No `isReady` gate needed.
- **ediabasx-web** — `connect()` opens the ediabasx RPC session at
  `${origin}/rpc/ediabasx`. No `isReady` gate needed.
- **inpax-web** / **ncsx-web** — `connect()` opens the ediabasx-server
  RPC session over WebSocket. `isReady` should return true once the
  remote install has loaded; otherwise the hook idles until then.

**Why centralise this**: every embedded app needs the same
lifecycle (connect on mount, clean disconnect on close, retry on
transient failure). Without the shared hook each app drifts —
different backoff curves, different unload event sets, different
reconnect semantics. One implementation, four consumers.

## Versioning

`0.2.0` adds the `useEmbeddedAutoConnect` hook. `Brand` + `MStripe`
APIs are unchanged from `0.1.x`. SemVer minor — existing consumers
upgrade without code changes.
