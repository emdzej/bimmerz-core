/**
 * `useEmbeddedAutoConnect` — shared embedded-mode lifecycle hook
 * for every bimmerz app (dashx / ediabasx / inpax / ncsx / …).
 *
 * Embedded builds run inside the bimmerz-box dongle and serve the
 * SPA at a fixed path (`/dashx/`, `/inpax/`, …) with the backend
 * always at `window.location.origin`. The user opening the page
 * explicitly navigated to the dongle — there's no ambiguity about
 * what to connect to, so the "Connect" button is friction the
 * embedded form factor doesn't need.
 *
 * What the hook does, called once from `App.svelte`:
 *
 *   1. **On mount** — if `isEmbedded` is true AND optional
 *      `isReady()` gate returns true (inpax/ncsx use this to wait
 *      for the install to load), kick off `connect()` once.
 *   2. **Auto-reconnect** — when `isConnected()` is observed to
 *      flip back to false (transient Wi-Fi drop, dongle reboot,
 *      bus-off recovery), retry with exponential backoff
 *      (1 s → 2 → 4 → 8 → 16 → 30 s cap). Successful connect
 *      resets the backoff.
 *   3. **On unload / unmount** — call `disconnect()` so the
 *      dongle-side WebSocket closes cleanly instead of waiting
 *      on TCP keep-alive. Avoids "duplicate session" rejection
 *      on the next visit if the dongle tracks single-client
 *      sessions per endpoint.
 *
 * The hook is **a no-op when `isEmbedded === false`**. Browser
 * builds keep their manual Connect button — Web Serial picker
 * needs a user gesture anyway, so auto-connect couldn't help.
 *
 * Must be called inside a Svelte 5 component context (uses
 * `$effect`).
 */

export interface AutoConnectOptions {
  /**
   * Whether this build is the dongle-embedded variant. When
   * false the hook does nothing.
   */
  isEmbedded: boolean;

  /**
   * Open the bus / RPC session. May throw — the hook catches and
   * schedules a retry. Should be idempotent (a second call while
   * already connected should not error or duplicate work).
   */
  connect: () => Promise<void>;

  /**
   * Tear down the connection. Called on `beforeunload`. Should be
   * fast and tolerant of being called while already disconnected.
   */
  disconnect: () => Promise<void>;

  /**
   * Reactive readiness check — return true when the app is ready
   * to connect. Used by inpax/ncsx to wait for the install to
   * load; dashx/ediabasx can omit it (always ready).
   */
  isReady?: () => boolean;

  /**
   * Reactive connection-state read. Drives auto-reconnect: when
   * this flips from true to false the hook starts a backoff loop.
   * If omitted the hook only ever attempts a single connect.
   */
  isConnected?: () => boolean;

  /**
   * Cap on the exponential backoff (ms). Default 30 000.
   */
  maxBackoffMs?: number;

  /**
   * Initial backoff (ms). Default 1 000.
   */
  initialBackoffMs?: number;

  /**
   * Optional logger. The hook is intentionally quiet by default —
   * embedded mode runs unattended for hours, log spam isn't useful.
   * Supply this if you want connect attempts surfaced (a project
   * usually wires it to its bimmerz-logger category).
   */
  log?: (message: string, level?: "info" | "warn" | "error") => void;
}

const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export function useEmbeddedAutoConnect(options: AutoConnectOptions): void {
  /* Browser builds: do nothing. Calling the hook unconditionally
     from App.svelte is the intended pattern; this guard is what
     makes that cheap. */
  if (!options.isEmbedded) return;

  const initial = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const cap = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const log = options.log ?? (() => undefined);

  /* Connection-state loop. $effect re-runs whenever its tracked
     reactive deps (`isReady()` + `isConnected()`) change. Each run
     either:
       • exits silently (already connected, or not ready), or
       • starts an attempt → retry loop until success or unmount.
     The cleanup cancels any pending retry so a re-run doesn't
     stack timers. */
  $effect(() => {
    /* Read both gates synchronously so the effect tracks them. */
    const ready = options.isReady ? options.isReady() : true;
    const connected = options.isConnected ? options.isConnected() : false;

    if (!ready) {
      log("auto-connect: waiting for ready", "info");
      return;
    }
    if (connected) {
      /* Already connected — nothing to do. The effect re-runs if
         `isConnected()` flips back to false. */
      return;
    }

    let cancelled = false;
    let backoff = initial;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = async (): Promise<void> => {
      if (cancelled) return;
      try {
        log(`auto-connect: attempting (backoff was ${backoff} ms)`, "info");
        await options.connect();
        backoff = initial;
        log("auto-connect: success", "info");
        /* Don't re-loop — the effect's next re-run (driven by
           `isConnected()` going true) is what handles the
           steady-state "connected" branch. */
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`auto-connect: failed (${msg}); retry in ${backoff} ms`, "warn");
        const wait = backoff;
        backoff = Math.min(backoff * 2, cap);
        if (!cancelled) {
          timer = setTimeout(() => {
            timer = null;
            void attempt();
          }, wait);
        }
      }
    };

    void attempt();

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
  });

  /* Clean shutdown on tab close. `beforeunload` is the canonical
     signal; we register only in embedded mode so browser builds
     never pay the cost. Disconnect is fire-and-forget — by the
     time the promise resolves the page might be gone, that's
     fine. */
  $effect(() => {
    if (typeof window === "undefined") return;
    const handler = (): void => {
      try {
        void options.disconnect().catch(() => undefined);
      } catch {
        /* swallow */
      }
    };
    window.addEventListener("beforeunload", handler);
    /* `pagehide` is the mobile-Safari-friendly counterpart — fires
       when the tab is suspended / put into the back/forward cache.
       Adding both is safe; the disconnect is idempotent. */
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    };
  });
}
