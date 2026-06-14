/**
 * Public surface of `@emdzej/bimmerz-ui` — Svelte 5 components +
 * helper types shared across the bimmerz app family.
 *
 * Components are exported as `.svelte` source. The consumer app's
 * Vite + svelte-plugin compiles them — pre-compiling locks the
 * output to a specific Svelte version and breaks tree-shaking, HMR,
 * and rune handling.
 *
 * Tokens (`bg-surface`, `text-foreground`, etc.) come from
 * `@emdzej/bimmerz-theme`'s Tailwind preset; the consumer app must
 * have that preset applied for these components to render correctly.
 */

export { default as Brand } from "./Brand.svelte";
export { default as MStripe } from "./MStripe.svelte";

/* Embedded-mode lifecycle hook — shared across every dongle-hosted
   app (dashx / ediabasx / inpax / ncsx). Browser builds keep the
   manual Connect button; embedded builds wire this hook into
   App.svelte to auto-connect on mount + auto-disconnect on
   beforeunload + auto-reconnect with backoff on transient drops. */
export {
  useEmbeddedAutoConnect,
  type AutoConnectOptions,
} from "./useEmbeddedAutoConnect.svelte.js";
