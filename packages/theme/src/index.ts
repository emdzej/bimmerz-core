/**
 * Shared Tailwind preset for the bimmerz app family.
 *
 * Provides the semantic colour tokens (`bg-base`, `bg-surface`,
 * `bg-elevated`, `text-foreground`, `text-muted`, `text-faint`,
 * `border-divider`, `border-rule`) that every app in the family uses.
 * The actual colour values come from CSS variables in
 * `@emdzej/bimmerz-theme/tokens.css` so light / dark themes share one
 * Tailwind compile.
 *
 * Each app picks its own accent — ncsx (blue-600) vs inpax (blue-500)
 * vs ediabasx (cyan-500) vs xbusx — so the preset omits `accent` and
 * leaves the consumer's `tailwind.config.ts` to extend it.
 *
 * Usage in a consumer:
 *
 * ```ts
 * // app/tailwind.config.ts
 * import preset from "@emdzej/bimmerz-theme";
 * export default {
 *   presets: [preset],
 *   content: ["./index.html", "./src/**\/*.{ts,svelte}"],
 *   theme: {
 *     extend: {
 *       colors: {
 *         accent: { DEFAULT: "#2563eb", muted: "#1e40af" }, // per-app
 *       },
 *     },
 *   },
 * };
 *
 * // app/src/app.css
 * @tailwind base;
 * @tailwind components;
 * @tailwind utilities;
 * @import "@emdzej/bimmerz-theme/tokens.css";
 * ```
 *
 * Plus a tiny boot script (or the `applyTheme()` helper from
 * `@emdzej/bimmerz-ui`) to set `<html class="dark">` based on the
 * user's preference.
 */

import type { Config } from "tailwindcss";

export type ThemeChoice = "light" | "dark" | "system";

export const bimmerzPreset: Partial<Config> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Semantic theme tokens — light/dark via the .dark class.
        base: "rgb(var(--theme-bg) / <alpha-value>)",
        surface: "rgb(var(--theme-surface) / <alpha-value>)",
        elevated: "rgb(var(--theme-elevated) / <alpha-value>)",
        divider: "rgb(var(--theme-border-subtle) / <alpha-value>)",
        rule: "rgb(var(--theme-border-strong) / <alpha-value>)",
        foreground: "rgb(var(--theme-text-primary) / <alpha-value>)",
        muted: "rgb(var(--theme-text-secondary) / <alpha-value>)",
        faint: "rgb(var(--theme-text-muted) / <alpha-value>)",

        // BMW M identity palette — same in both themes. Use for
        // brand accents (M-stripe, brand wordmark gradient) or as
        // an opt-in app accent (`accent` slot per consumer).
        "m-light": "rgb(var(--m-light) / <alpha-value>)",
        "m-dark": "rgb(var(--m-dark) / <alpha-value>)",
        "m-red": "rgb(var(--m-red) / <alpha-value>)",
      },
      backgroundImage: {
        // Canonical bimmerz brand gradient (135°, light → dark →
        // red). Use as `bg-m-gradient` for backgrounds; for text
        // fills, prefer the `.m-gradient-text` class shipped in
        // tokens.css (text-fill needs `background-clip: text` which
        // doesn't survive arbitrary Tailwind composition).
        "m-gradient":
          "linear-gradient(135deg, rgb(var(--m-light)) 0%, rgb(var(--m-dark)) 55%, rgb(var(--m-red)) 100%)",
      },
      borderColor: {
        DEFAULT: "rgb(var(--theme-border-subtle) / <alpha-value>)",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
};

export default bimmerzPreset;

/**
 * Resolve a `ThemeChoice` into a concrete dark flag. For `"system"`
 * consults `prefers-color-scheme`. Safe in pre-DOM / SSR contexts —
 * returns the light branch when `window` isn't defined.
 */
export function isDarkTheme(choice: ThemeChoice): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Push the resolved theme onto `<html>` — adds the `dark` class for
 * dark mode, removes it otherwise. Call on initial boot and on every
 * settings change; pair with `watchSystemTheme()` for live OS tracking
 * when the user chose `"system"`.
 */
export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isDarkTheme(choice)) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * Install a `prefers-color-scheme` listener that calls `onChange`
 * whenever the OS toggles. The caller decides what to do — typically
 * `() => applyTheme(currentChoice)` when the user has chosen
 * `"system"`. Returns an unsubscribe function.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
