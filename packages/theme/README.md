# @emdzej/bimmerz-theme

Shared Tailwind preset + CSS variables for the bimmerz app family. Two layers
stack together — semantic light/dark theme tokens (`bg-base` / `bg-surface` /
`text-foreground` / `text-muted`…), and the BMW M-division identity palette
(`m-light` / `m-dark` / `m-red`) that drives the brand visuals.

## Wire it in (consumer app)

```ts
// tailwind.config.ts
import preset from "@emdzej/bimmerz-theme";
import type { Config } from "tailwindcss";

export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{ts,svelte}"],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: "#2563eb", muted: "#1e40af" }, // pick your own
      },
    },
  },
} satisfies Config;
```

```css
/* src/app.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
@import "@emdzej/bimmerz-theme/tokens.css";
```

```ts
// src/main.ts — apply on boot
import { applyTheme, watchSystemTheme } from "@emdzej/bimmerz-theme";
applyTheme("system"); // or whatever the user has saved
watchSystemTheme(() => applyTheme("system"));
```

## What you get

### Semantic theme tokens

Light/dark via the `dark` class on `<html>`. Slate-tinted neutrals matching the
hub.bimmerz.app + bimmerz.app site palettes.

| Tailwind class | Purpose |
|---|---|
| `bg-base` | page background |
| `bg-surface` | raised cards / panels |
| `bg-elevated` | one step further up the stack |
| `text-foreground` | primary text |
| `text-muted` | secondary text (labels, captions) |
| `text-faint` | tertiary text (timestamps, hints) |
| `border-divider` | subtle rule between rows |
| `border-rule` | stronger separator between sections |

### M-division identity palette

Same in both themes — these are brand colours, not theme colours.

| Tailwind class | Hex |
|---|---|
| `bg-m-light` / `text-m-light` / `border-m-light` | `#1c69d4` |
| `bg-m-dark` / `text-m-dark` / `border-m-dark` | `#002664` |
| `bg-m-red` / `text-m-red` / `border-m-red` | `#c41e3a` |

### M-stripe

The three-band signature bar BMW M cars carry on their kidney grilles.
Available two ways:

```svelte
<!-- via the Svelte component -->
<script>import { MStripe } from "@emdzej/bimmerz-ui";</script>
<MStripe class="h-1" />
```

```html
<!-- or as raw HTML / CSS (Tailwind not required) -->
<div class="m-stripe" aria-hidden="true">
  <div class="m-stripe__band m-stripe__band--light"></div>
  <div class="m-stripe__band m-stripe__band--dark"></div>
  <div class="m-stripe__band m-stripe__band--red"></div>
</div>
```

### M-gradient

Canonical brand gradient (light → dark → red, 135°). Two flavours:

```svelte
<!-- text fill — paint a wordmark in the M signature -->
<h1 class="m-gradient-text">bimmerz</h1>

<!-- background fill — use `bg-m-gradient` from the Tailwind preset -->
<div class="bg-m-gradient" />
```

Text fill needs `background-clip: text` which doesn't survive arbitrary
Tailwind composition, so it ships as the `.m-gradient-text` class in
`tokens.css` rather than as a preset utility.

## JS API

```ts
import { applyTheme, isDarkTheme, watchSystemTheme, type ThemeChoice } from "@emdzej/bimmerz-theme";
```

- `applyTheme(choice)` — toggle the `dark` class on `<html>`.
- `isDarkTheme(choice)` — resolve `"system"` against `prefers-color-scheme`.
- `watchSystemTheme(onChange)` — listen for OS-preference changes.
