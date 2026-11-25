# LUDO 3077 — Design System & UI Rules

This document is the **living design & UI architecture specification** for **Ludo 3077**. Every UI surface, panel, overlay, board HUD, and interactive primitive must follow these rules.

For game rules, team pairings, seating, and netcode authority invariants, see `ENGINE_LOGIC.md` and `AGENTS.md`. For wallet authentication & signing cadences, see `docs/architecture/WALLET_SIGNING_POLICY.md`. For active audit tracking, see `docs/ops/UI_AUDIT_TRACKER.md`.

---

## 1. Visual Identity & Core Principles

Ludo 3077 blends a **high-contrast terminal HUD aesthetic** with **real-time board clarity**. Three architectural tenets govern every visual decision:

1. **Token-driven styling (single source of truth):** Semantic surface, ink, line, accent, status, radius, and motion tokens live in `app/styles/tokens.css` and are specialized per theme under `app/styles/themes/`. Components never hardcode light/dark hex branches in JSX or invent per-panel `.my-btn` CSS classes.
2. **Board and viewport stability under IME, overlays, and resizes:** `FrameProvider` (`app/components/FrameProvider.tsx`) freezes `--app-vh` during mobile soft-keyboard focus, strips dead webview bottom chrome (`--vv-dead-bottom`), clamps bogus safe-area insets (`> 48px` ignored), and pins `.board-area.is-locked` to `--board-area-h`.
3. **Zero layout-thrashing motion:** All transitions and animations target compositor properties (`transform`, `opacity`, subtle `clip-path`). Motion scales cleanly across `System`, `Full`, and `Reduced` modes without hiding functional state indicators.

---

## 2. Modular CSS & SSR Hydration Architecture

### 2.1 Stylesheet Import Pipeline

`app/globals.css` is a minimal entry point importing modular layers in deterministic cascade order:

| Order | File | Responsibility |
| :--- | :--- | :--- |
| 0 | `@import "tailwindcss";` | Tailwind CSS v4 runtime |
| 1 | `app/styles/tokens.css` | `@theme` utilities, `@theme inline` semantic bridges, `:root` defaults, `body` base bridges, `.chip` base system |
| 2 | `app/styles/themes/theme-3077.css` | Flagship **3077** theme (`body.theme-3077`), chamfer utilities, HUD ticks, header/footer overrides, 3077 board chrome |
| 3 | `app/styles/themes/retro.css` | **Retro-Futurism** theme (`body.theme-retro-futurism`), CRT scanlines, vignette, smoked-glass ARC pill footer |
| 4 | `app/styles/themes/daybreak.css` | **Daybreak** theme (`body.theme-daybreak`), Warm Studio Porcelain surface, AA-safe teal/amber/forest/crimson tokens, ceramic footer |
| 5 | `app/styles/base.css` | `@layer base` reset, `html/body` height locking, `.hud-ticks-3077` & `.footer-active-laser` default off-states |
| 6 | `app/styles/panels.css` | `.app-shell`, `--footer-h`, `--panel-gap`, footer/header geometry, panel layouts, `body.keyboard-open` rules, `--ludo-motion-*` |
| 7 | `app/styles/board.css` | Board grid (`15x15`), yards, tokens, dice bay, power tiles, terminal HUD, global `:focus-visible`, board reduced-motion rules |
| 8 | `app/styles/motion.css` | Shared keyframes (`loading-bar`, `shimmer`, HUD reticle spin, trap pulse, badge pulse) + `.motion-force-full` / `.motion-force-reduced` overrides |

> **Legacy board wrapper:** `app/styles/themes/default.css` defines `[data-theme="default"]` CSS variables consumed by `.board-match-theme-wrapper` (`data-theme="default"`).
> **Mobile performance guard:** `FrameProvider` actively strips inline `backdropFilter` blur on viewports `<= 768px` (and `[class*="-scope"]`) so blurred slide-over sheets cannot smear ghost frames during mobile GPU compositing.

### 2.2 Server-Side Preference Cookies (`app/layout.tsx`)

To prevent theme or token flash on first paint (FOUC), `app/layout.tsx` reads three cookies on the server and renders body classes directly:

| Cookie | Values | Body Class Applied | Default |
| :--- | :--- | :--- | :--- |
| `ludo-theme` | `'3077'` \| `'retro'`/`'dark'`/`'ui'` \| `'light'`/`'porcelain'` | `theme-3077` \| `theme-retro-futurism` \| `theme-daybreak` | **`theme-3077`** |
| `token-style` | `'orb'` \| `'pawn'` | `token-style-orb` (omitted when `'pawn'`) | **`token-style-orb`** |
| `ludo-motion` | `'system'` \| `'full'` \| `'reduced'` | none (`system`) \| `motion-force-full` \| `motion-force-reduced` | `'system'` |

Viewport metadata in `app/layout.tsx` exports `width: 'device-width'`, `initialScale: 1`, `maximumScale: 1` (prevents iOS auto-zoom on inputs), `viewportFit: 'cover'`, and `interactiveWidget: 'resizes-content'`.

---

## 3. Themes & Deployment-Mode Reactive Accents

The app ships **three first-class UI themes**. `useTheme()` / `ThemeSwitcher` updates `document.body` and the `ludo-theme` cookie cleanly with **zero JS style-branching hooks** (no `useIsDaybreak` or JS theme checks).

### 3.1 Theme Matrix

| Dimension | `3077` (Flagship Default) | `Retro-Futurism` (`retro`) | `Daybreak` (`daybreak`) |
| :--- | :--- | :--- | :--- |
| **Body selector** | `body.theme-3077` | `body.theme-retro-futurism` | `body.theme-daybreak` |
| **Visual mood** | Cyber-Tactical Precision HUD | Orbital Midnight CRT Console | Warm Studio Porcelain Light |
| **Page backdrop** | `#05070A` + 32px/36px holographic grid (`--grid-opacity: 0.04`) | `#060B14` + CRT scanlines (`::before`) & vignette (`::after`) | `#F4F1EA` + 20px architectural dot grid (`--surface-grid-dot`) |
| **Cosmic orbs / lobby photo** | Disabled (`display: none`) | Enabled (calmed `.orbs-calm`) | Disabled (`display: none`) |
| **Primary accent (`--accent`)** | `#00E5FF` (`--accent-rgb: 0, 229, 255`) | `#5CE1FF` (`--accent-rgb: 92, 225, 255`) | `#0D6D87` (Prussian Teal, `--accent-rgb: 13, 109, 135`) |
| **Body font** | `Chakra Petch` (lobby UI uses `Inter`) | `Chakra Petch` | `Inter` |
| **Heading font & case** | `Chakra Petch`, uppercase, `+0.08em` (`lobby-h2-3077`: `+0.12em`) | `Russo One`, uppercase, `+0.05em` | `Inter Tight`, sentence-case, `-0.02em` |
| **Chip / Card radii** | Radii `4/8/12px` (`sm/md/lg`), Panel `10px` | Chip `9999px`, Card `18px`, Panel `24px`/`32px` | Chip `12px`, Card `18px`, Panel `24px`/`32px` |
| **Corner ticks & chamfers** | `.hud-ticks-3077` visible (`9px` brackets), `.hud-chamfer-sm/md/lg` (`5px`/`8px`/`12px`) | Hidden (`display: none`) | Hidden (`display: none`) |
| **Header clusters** | Chamfered `4px` obsidian clusters (`.hud-header-cluster`), `56px` sticky bar | Rounded capsule clusters | Clean white pill clusters (`#FFFFFF` + crisp hairline border) |
| **Footer nav** | Full-width `64px` bar + chamfered `.footer-active-plate` + 2px top `.footer-active-laser` | Floating smoked-glass pill (`max-width: 476px`, `rounded-full`) + `RetroArcLight` physics beam | Floating frosted ceramic pill (`max-width: 476px`, `rounded-full`) + teal beam |
| **Dice CTA styling** | Translucent glass plaque (`clip-path` `5px` chamfer) so pips shine through | High-contrast dark tactical pill | Clean studio button (`#0D6D87` / dark ink) |
| **Star / Safe & Arrow markers** | Tactical reticle `.star-3077` / `.arrow-3077` | Classic star / arrow geometry | `.porcelain-holo-tick` conic ring (or rotated diamond override in 3077) |

### 3.2 Deployment-Mode Reactive Palettes (`lib/deployTheme.ts`)

When the user switches lobby match mode (`quick` \| `team` \| `offline`), `lib/deployTheme.ts` (`useDeployTheme` / `setBodyDeployMode`) applies `body[data-deploy-mode="<mode>"]`, smoothly shifting `--accent`, `--accent-rgb`, `--accent-hover`, `--accent-bright`, and `--accent-edge` across **all three themes**:

| Mode | Label / Intent | `theme-3077` (`--accent`) | `theme-retro-futurism` (`--accent`) | `theme-daybreak` (`--accent`) |
| :--- | :--- | :--- | :--- | :--- |
| `quick` | Quick Deploy (1v1 / 4P) | `#00E5FF` (`0, 229, 255`) | `#5CE1FF` (`92, 225, 255`) | `#0D6D87` (`13, 109, 135`) |
| `team` | 2v2 Squad Deployment | `#F59E0B` (`245, 158, 11`) | `#FBBF24` (`251, 191, 36`) | `#B45309` (`180, 83, 9`) |
| `offline` | Offline Ops / Local Sim | `#00FF66` (`0, 255, 102`) | `#34D399` (`52, 211, 153`) | `#166534` (`22, 101, 52`) |

In `theme-3077`, this reactive accent automatically tints `.hud-header-cluster`, `.ludo-ticker-scope .ticker-status-dot`, `.seg-btn-3077[aria-checked="true"]`, `.rail-sweep-3077`, and `.dice-bay` readiness outlines.

---

## 4. Token Architecture & Color System

### 4.1 The `:root` → `body` Inheritance Rule (Critical Tailwind v4 Guard)

Tailwind v4 maps `@theme inline` tokens in `app/styles/tokens.css` directly onto CSS custom properties so utilities like `bg-surface-1`, `text-ink-strong`, `border-line-soft`, and `text-accent` work everywhere.

> **WARNING:** Theme classes sit on **`<body>`**, NOT `<html>` (`:root`). Never set theme-dependent overrides in `:root` and point `body` at them through `@theme inline` indirection — `@theme inline` resolves against `:root` before `body.theme-*` overrides apply. Only global constants or default fallbacks belong in `:root`; per-theme surface/ink/line/accent variables are overridden cleanly under `body.theme-3077`, `body.theme-retro-futurism`, and `body.theme-daybreak`.

### 4.2 Semantic Token Inventory (`app/styles/tokens.css` & Theme Layers)

| Group | Tokens | Usage |
| :--- | :--- | :--- |
| **Surfaces (`@theme inline`)** | `--surface-page`, `--surface-panel`, `--surface-recessed`, `--surface-hover`, `--surface-active` | Layered theme-aware containers (`bg-surface-page`, `bg-surface-panel`, `bg-surface-recessed`, `hover:bg-surface-hover`) |
| **Tiered Glass Surfaces (3077 / Retro)** | `--surface-0`, `--surface-1`, `--surface-2`, `--surface-3`, `--surface-selected` | Precision depth hierarchy inside tactical dark sheets & HUD clusters |
| **Ink (`@theme inline`)** | `--ink-strong`, `--ink-muted`, `--ink-faint` | Primary copy, secondary labels/hints, subtle captions (`text-ink-strong`, `text-ink-muted`, `text-ink-faint`) |
| **Borders / Lines** | `--line-soft`, `--line-strong`, `--line-accent`, `--panel-border` | Hairlines (`border-line-soft`), interactive hover/active borders (`border-line-strong`) |
| **Accents (`@theme inline`)** | `--accent`, `--accent-rgb`, `--accent-bright`, `--accent-edge`, `--accent-soft`, `--accent-ink` | Primary action fills (`bg-accent`), active rails, text-on-accent (`text-accent-ink`), translucent tints (`bg-accent-soft`) |
| **Signal & Status** | `--warn`, `--positive`, `--negative`, `--sig-ok`, `--sig-warn`, `--sig-danger`, `--sig-info` | AA-contrast status badges, telemetry alerts, winner/capture signals |
| **Marketplace Chips** | `--market-chip-icon`, `--market-chip-count-bg/ink`, `--market-chip-count-bg-active/ink-active`, `.chip-market` | Equipped/owned/trial status & category rail badges in `MarketplacePanel` |
| **Error & Claiming** | `--err-backdrop/card-bg/card-border/card-shadow/ink/ink-muted/kicker/stack-*/cta-*`, `--claiming-overlay-*` | `ErrorCard` and `ClaimingOverlay` theme-adaptive states |

### 4.3 Verified Core Values by Theme

| Token | `theme-3077` | `theme-retro-futurism` | `theme-daybreak` |
| :--- | :--- | :--- | :--- |
| `--ludo-bg` / `--surface-page` | `#05070A` | `#060B14` | `#F4F1EA` |
| `--surface-panel` / `--panel-bg` | `rgba(14, 19, 27, 0.92)` | `rgba(8, 13, 25, 0.94)` | `rgba(255, 255, 255, 0.94)` |
| `--surface-1` / `--ludo-card` | `#0A0E14` / `#090C13` | `#0A101E` | `#FFFFFF` (`--ludo-card`) |
| `--surface-2` / `--surface-recessed` | `rgba(14, 19, 27, 0.72)` | `rgba(11, 18, 33, 0.84)` | `#EAE5DC` (`--surface-recessed`) |
| `--surface-3` | `rgba(20, 27, 38, 0.84)` | `rgba(16, 25, 44, 0.90)` | — |
| `--ink-strong` | `#F1F5F9` | `#F0F6FC` | `#18181B` |
| `--ink-muted` | `#A3AEBD` | `#9BB0C9` | `rgba(24, 24, 27, 0.64)` (`--ludo-muted: #52525B`) |
| `--ink-faint` | `#6B7685` | `#5E738E` | `rgba(24, 24, 27, 0.44)` (`--ludo-faint: #71717A`) |
| `--accent` (Quick default) | `#00E5FF` | `#5CE1FF` | `#0D6D87` |
| `--positive` / `--sig-ok` | `#00FF66` / `#22C55E` | `#34D399` | `#166534` (`--positive`) |
| `--warn` / `--sig-warn` | `#F59E0B` | `#FBBF24` | `#92400E` (`--warn`) |
| `--negative` / `--sig-danger` | `#FF0055` / `#F43F5E` | `#FB7185` | `#B91C1C` (`--negative`) |
| `--sig-info` | `#38BDF8` | `#38BDF8` | — |

> **Daybreak AA contrast fixes (verified via `node scripts/contrast.mjs --pairs`, 15/15 passing):** `--accent` is `#0D6D87` (`4.82:1` on page, `5.91:1` on white), `--warn` is `#92400E` (`5.78:1`), `--positive` is `#166534` (`5.81:1`), and `--negative` is `#B91C1C` (`5.27:1`). Do not lighten Daybreak signal or accent colors back toward Tailwind `-500`/`-600` shades.

### 4.4 Player Seat Colors (Fixed Board Identity)

The four Ludo player seats retain recognizable identities across themes (`--p-green`, `--p-red`, `--p-yellow`, `--p-blue` in `board.css` / theme overrides). In **2v2**, **Green + Blue vs Red + Yellow** (`TEAM_PAIRINGS` in `lib/constants.ts`) is the single source of truth across seating, lobby chips, and board indicators.

---

## 5. Typography & Fluid Type Scale

### 5.1 Self-Hosted Fonts (`app/fonts.ts`)

All Google fonts are self-hosted via `next/font/google`:

- `Inter` (`--font-inter`): weights `400, 500, 600, 700` — body UI in Daybreak and lobby scopes
- `Inter Tight` (`--font-inter-tight`): weights `500, 600, 700, 800` — Daybreak display headings
- `Chakra Petch` (`--font-chakra`): weights `300, 400, 500, 600, 700` — `3077` primary + heading font, `Retro` body font
- `Russo One` (`--font-russo`): weight `400` — `Retro` display headings (`h1`/`h2`/`h3`/`.font-heading`)
- `--font-mono`: `'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace` (in `theme-3077.css`; `ui-monospace` in `daybreak.css`) paired with `font-variant-numeric: tabular-nums` for balances, timers, telemetry, and scores.

### 5.2 Fluid 7-Step Type Scale (`app/styles/tokens.css` `@theme`)

**Rule:** Always use `text-ludo-*` utility classes or semantic defaults. **Hardcoded `text-[Npx]` utilities in `app/**/*.tsx` are banned** (enforced by `npm run check:type-scale`, currently `0` violations). Minimum readable floor is **`10px` (`0.625rem`)** — sub-`10px` UI text is forbidden.

| Token Utility | `clamp()` Expression | Min | Max | Intended Role |
| :--- | :--- | :--- | :--- | :--- |
| `text-ludo-xs` | `clamp(0.625rem, 0.6rem + 0.1vw, 0.6875rem)` | `10px` | `11px` | Micro chrome, badge labels, hints (`leading-4`) |
| `text-ludo-sm` | `clamp(0.75rem, 0.72rem + 0.15vw, 0.8125rem)` | `12px` | `13px` | Secondary body, compact buttons (`leading-[18px]`) |
| `text-ludo-md` | `clamp(0.875rem, 0.84rem + 0.18vw, 0.9375rem)` | `14px` | `15px` | Default body copy, row labels, inputs (`leading-5`) |
| `text-ludo-lg` | `clamp(1.0625rem, 1rem + 0.3vw, 1.1875rem)` | `17px` | `19px` | Panel headers, card titles (`leading-6`) |
| `text-ludo-xl` | `clamp(1.25rem, 1.15rem + 0.45vw, 1.5rem)` | `20px` | `24px` | Match totals, hero metrics (`leading-7`) |
| `text-ludo-2xl` | `clamp(1.5rem, 1.35rem + 0.75vw, 1.875rem)` | `24px` | `30px` | Victory / display headers (`leading-9`) |
| `text-ludo-3xl` | `clamp(2rem, 1.75rem + 1.2vw, 2.5rem)` | `32px` | `40px` | Primary Splash / Endgame heroes |

### 5.3 Weight & Tracking Rules

- Reserve **`font-black` (`900`)** strictly for primary display numbers (final prize amount, dice face pips, endgame hero titles). Normal UI chrome caps at `font-bold` (`700`) or `font-semibold` (`600`).
- **Chrome tracking rule:** Uppercase technical labels (`h1..h3`, `label-chrome`, `HudSectionLabel`, buttons) use tracked uppercase in `3077` (`+0.06em` to `+0.12em`) and `Retro` (`+0.05em`). **Daybreak** intentionally relaxes headings to sentence case (`text-transform: none`) with tight `-0.02em` tracking.

---

## 6. Spatial, Radius, Icon & Motion Scales

| Scale Category | Tokens | Values |
| :--- | :--- | :--- |
| **Spacing (8pt baseline, `theme-3077`)** | `--space-0`, `--space-0_5`, `--space-1` .. `--space-6`, `--space-8` | `0px`, `4px`, `8px`, `16px`, `24px`, `32px`, `40px`, `48px`, `64px` |
| **3077 Radii** | `--radius-sm`, `--radius-md`, `--radius-lg` | `4px`, `8px`, `12px` |
| **Icon sizes (`tokens.css`)** | `--icon-sm`, `--icon-md`, `--icon-lg` | `14px`, `16px`, `20px` |
| **Component motion (`tokens.css`)** | `--motion-micro`, `--motion-control`, `--motion-surface`, `--ease-standard` | `120ms`, `160ms`, `240ms`, `cubic-bezier(0.22, 1, 0.36, 1)` |
| **3077 / Retro UI timings** | `--dur-instant`, `--dur-fast`, `--dur-base`, `--dur-exit`, `--ease-out`, `--ease-emphasized` (3077) | `100ms`, `150ms`, `200ms`, `150ms`, `cubic-bezier(0.2, 0, 0, 1)`, `cubic-bezier(0.3, 0, 0, 1.2)` |
| **Board timings (`panels.css`)** | `--ludo-motion-fast`, `--ludo-motion-base`, `--ludo-motion-slow`, `--ludo-motion-token-hop` | `120ms`, `200ms`, `320ms`, `450ms` |
| **Min Touch Target** | Interactive controls (`Button size="icon"`, switches, footer tabs) | **`44px × 44px`** hit target minimum on mobile |

---

## 7. Core Primitives & Chrome Components

All new and migrated UI surfaces **must** compose from `app/components/` primitives instead of raw `<button>` tags or ad-hoc CSS recipes.

### 7.1 `Button` (`app/components/Button.tsx`)

- **Variants:** `primary` (accent fill + ink-inverse), `secondary` (surface-2 + line-soft), `ghost` (transparent + hover surface), `danger` (semantic error red tint + border).
- **Sizes:** `sm` (`32px`, `px-2.5 text-ludo-xs`), `md` (`40px`, `px-3.5 text-ludo-sm`), `lg` (`48px`, `px-5 text-ludo-md`), `icon` (`44px × 44px`, no horizontal padding).
- **Brand exception (`brand` prop):** Uses Base blue `#0052FF` only on Coinbase/Base branded auth CTAs (e.g., Base App sign-in).
- **Interactive affordances:** Built-in `loading` + optional `loadingIcon`, `leftIcon` / `rightIcon`, `active:scale-[0.98]`, `data-variant` / `data-size` attributes, and `sound` hook (`'click' | 'select' | 'back' | 'none'`). Note: `theme-3077.css` locks `:hover` to `transform: translateZ(0)` (zero hover jump) and `:active` to `scale(0.98)`.

### 7.2 `Chip` (`app/components/Chip.tsx`)

- **Types:** `filter` (toggleable filter button with `active` border/tint state), `status` (`status="ok" | "warn" | "off"`), `info` (read-only informational pill with `tone="default" | "address"` for tabular truncated wallet addresses).
- **Sizes:** `md` (default, `text-ludo-xs`) and `sm` (`.chip-sm`, compact card metadata).
- **Icon rendering:** Uses semantic status dots for `status` chips unless an explicit SVG `icon` prop is passed.

### 7.3 `Switch` & `ListRow`

- **`Switch` (`app/components/Switch.tsx`):** `role="switch"`, `44×24px` pill track (`aria-checked`), spring-animated thumb (`stiffness: 500, damping: 32`), plays `pref_toggle_on` / `pref_toggle_off` sound cues, minimum `44px` interactive height.
- **`ListRow` (`app/components/ListRow.tsx`):** Standardized row container (`p-3.5`, `border-b border-line-soft`, `rounded-xl` `36px` icon tile, `text-ludo-md font-semibold` label, `text-ludo-xs text-ink-muted` hint, optional right `trailing` slot).

### 7.4 Navigation & Layout Shells

- **`PanelTabs`, `PanelChildTabs`, `TabCount` (`app/components/PanelTabs.tsx`):**
  - `PanelTabs`: Segmented control (`cols: 2 | 3 | 4`) using `.panel-tabs-3077` / `.panel-tab-active-3077`. Desktop animates active plate with Framer `layoutId`; mobile (`< 768px`) swaps statically (`transition: none`) to guarantee zero layout animation jank.
  - `PanelChildTabs`: Semantic `role="tablist"` horizontal underline tabs with `.panel-child-rail-3077` active underline rail.
  - `TabCount`: Compact monospaced counter badge (`px-1.5 py-0.5 rounded-full`) inside tab pills.
- **`GamePanelShell` (`app/components/GamePanelShell.tsx`):**
  - **Sandwich sheet (default):** Portal-mounted fixed panel fitted between header and footer (`top-[64px] bottom-[80px] left-[8px] right-[8px] rounded-[32px]`, clamped to `maxWidthPx` = default `500px`, single-scroller content area inside `panel-shell-3077`).
  - **Overlay modal (`overlay={true}`):** Elevated `z-[1090]` backdrop + `z-[1100]` modal (`top-4 bottom-4 sm:top-7 sm:bottom-7`), full-viewport framing for nested flows (such as Wallet sheets).
  - Automatically renders `.panel-handle-bar`, `HudCornerTicks`, `compactHeader` option, standardized `Button variant="ghost" size="icon"` wrapping `<CloseReticleIcon />`, and ducks match/ambient audio (`soundEngine.setModalDuck`) while open.
- **`HeaderNavPanel` (`app/components/HeaderNavPanel.tsx`):**
  - Fixed 3-zone sticky top bar (`dash-header`, `56px` in `theme-3077`, `40px`/`44px` clusters):
    1. Left: CHIPS wallet trigger (`.hud-header-cluster`) showing abbreviated CHIPS readout & online/network state.
    2. Center: Pilot Dossier badge showing `RankTierIcon` + `PilotAvatar` + pilot handle.
    3. Right: Social/Chat badge (`.unread` indicator) + Settings trigger.
- **`FooterNavPanel` (`app/components/FooterNavPanel.tsx`) & `RetroArcLight` (`app/components/RetroArcLight.tsx`):**
  - Five top-level tabs: `Friends`, `Ranking`, `Clan`, `Mission`, `Market`.
  - Publishes measured shell offset `--footer-h` via `ResizeObserver` (`76px` desktop, `62px` below `430px` in `panels.css`).
  - In `Retro-Futurism`: renders the SVG `RetroArcLight` horizontal capsule bar with asymmetric dual-spring physics (`stepArcSprings`) and pointer drag scrubbing across tabs.
  - In `3077`: renders full-width `64px` bar with chamfered `.footer-active-plate` and 2px `.footer-active-laser` top scan line.

### 7.5 Tactical HUD, Feedback & Crypto Modals

- **`HudPrimitives` (`app/components/HudPrimitives.tsx`):**
  - `HudCornerTicks`: 4 corner L-brackets (`9px`, `1.5px` stroke) — visible **only** in `body.theme-3077`.
  - `HudProgressGauge`: Segmented gauge bar driven strictly by compositor `transform: scaleX(...)` (`0..100%`) with optional leading glow and notch grid overlay.
  - `HudSectionLabel`: `// SECTION` monospace pill header flanked by a horizontal hairline rule.
- **`ThinkingOrb` (`app/components/ThinkingOrb.tsx`):**
  - Wraps `thinking-orbs` canvas widget. Never import `thinking-orbs` directly in feature code: the wrapper pins the package theme (`dark` / `light` derived from `usePreferences`) and forces `paused={true}` whenever `prefersReducedMotion()` is active. Supports `tone: 'accent' | 'neutral'` and `state: 'idle' | 'thinking' | 'solving'`.
- **`SignWaitModal` (`app/components/SignWaitModal.tsx`):**
  - System-wide Universal Dual-Modal Wallet Guard (`lib/walletGuard.ts` + `lib/txSimulator.ts`).
  - `signature` mode explains off-chain zero-gas confirmation; `transaction` mode renders `32px` `<ThinkingOrb state="solving" tone="accent" />`, live pre-flight simulation (`You Send` vs `You Receive`, verified core contract badges, unlimited approval callouts, revert protection), and submission → confirmation telemetry.
- **`ClaimingOverlay` (`app/components/ClaimingOverlay.tsx`):**
  - Modal reward claim shield featuring a `64px` `<ThinkingOrb state="solving" tone="accent" />`, concentric sonar rings, conic rotary radar sweep, vertical laser scan line, and `claim_radar_ping` audio pulse every `1800ms`.
- **`EmptyState`, `ErrorCard`, `ConnectionBadge`:**
  - `EmptyState`: Centered bordered slot with icon box, uppercase title, hint text, and optional single primary action button.
  - `ErrorCard`: Semantic `--err-*` danger callout supporting `compact`, retry button, and inline dismissal.
  - `ConnectionBadge`: Live connection pill (`connecting` | `online` | `stale` | `offline`) with semantic dot + tabular ping readout.
- **Iconography (`app/components/icons.tsx`):**
  - Handcrafted `24×24` viewBox geometric mecha-tactical **duotone SVG** icon suite (`strokeWidth="1.85"`, active `fillOpacity: 0.24` vs inactive `0.08`, crisp square linecaps).
  - Do not mix Unicode emoji (`🔥`, `🛡️`, `🚀`) into chrome, nav buttons, or badges — use SVG components from `icons.tsx` or feature SVG sets (`PowerEmblem` etc.).

---

## 8. Text Fields & Soft-Keyboard / IME Contract

### 8.1 Text Field Attribute Rules (`npm run check:fields`)

Every free-text `<input>` and `<textarea>` inside `app/` **must** declare explicit OS-interference suppression attributes so mobile keyboards do not autocapitalize wallet addresses, usernames, room codes, or numeric wager amounts:

```tsx
autoComplete="off"
autoCorrect="off"
autoCapitalize="none"
spellCheck={false}
```

- **Documented prose exceptions** (intentionally omit `autoCapitalize` for natural sentence typing; verified by `scripts/check-field-rules.mjs`):
  1. `RichChatField.tsx` (`.rich-field-input` — chat/DM composer)
  2. `EmoteTray.tsx` (`Write a reaction` custom reaction input)
  3. `SettingsPanel.tsx` (`Tell us what to fix next` feedback textarea)
- Non-text inputs (`type="file"`, `range`, `hidden`, `checkbox`, `radio`) are out of scope.
- Use `inputMode="decimal"` or `inputMode="numeric"` on numeric/CHIPS/USDC fields so mobile devices open a numeric pad cleanly.

### 8.2 Viewport Locking & Focus Stability (`FrameProvider.tsx`)

1. `FrameProvider` tracks `window.visualViewport` alongside `focusin` / `focusout` on editable elements (`input`, `textarea`, `select`, `[contenteditable="true"]`).
2. Sub-pixel discrepancies under `1px` between `visualViewport.height` and `window.innerHeight` are snapped out (`snapNoise`) so URL bar jitter never shifts layout by `1px`.
3. When an input focuses, `--app-vh` freezes at the pre-IME `stableLayoutHeight`, `body.keyboard-open` is toggled on (when `--kb-inset > 120px`), and panels yield chrome gracefully without resizing or reflowing the game board underneath.
4. `scrollFocusedControl()` scrolls the control into view **only if clipped**, using `scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })` — never force-centering the page.

---

## 9. Board, Tokens & In-Game Visual Contract

### 9.1 Layout & Board Containment (`app/styles/panels.css`, `app/styles/board.css`)

- `.app-shell` locks to `height: var(--app-vh, 100%)` with `touch-action: pan-y` on `html/body` to prevent overscroll bounce in wallet webviews.
- `.board-outer` reserves `--match-footer-slot` (`46px` default) so player HUD strips hug the `15×15` square without dead vertical gaps.
- `.board-area.is-locked` pins `height: var(--board-area-h, auto) !important` so chat drawers, wallet prompts, or IME openings never squeeze the board.

### 9.2 Token Visual Styles

- **Orbs (default):** `body.token-style-orb` (`TokenPiece` / `TokenVisual`) renders glowing glass orbs with inner specular depth and `.ludo-token-pulse` wrapped **outside** counter-rotated root transforms so board flip/rotation never distorts the pulse halo.
- **Chess Pawns (opt-in):** Selecting `Chess Pawns` in Settings switches `token-style` cookie to `'pawn'` (`ChessTokens.tsx`). Both styles preserve the same hit area and valid-move highlight behavior (`calculateNextPosition(pos, dice, color, cc) !== pos`).

### 9.3 Specialized Match HUD & VFX Layers

- **`AnchoredDiceBay` (`app/components/AnchoredDiceBay.tsx`):** Theme-sculpted corner dice launch well coupled to the active player's avatar corner, showing an exposed inner chamber during breakout rolls, a Dual-Core `+6` overdrive wing when **Boost** is armed, and a `dice-streak-strip` (`[6][6]...`) warning on double-six bust danger.
- **`BoardTerminalHud` / `TerminalTypeText`:** Top/bottom corner status telemetry banners formatted in tabular mono uppercase (`letter-spacing: 0.1em` in 3077).
- **`PowerInventoryDock` (`app/components/PowerInventoryDock.tsx`):** Bottom-docked strip of active player powerups with multi-layer SVG emblems, live circular SVG expiry countdown rings, 1-tap instant cast when eligible, and an inspection popover with mini board simulation when locked.
- **`PowerVfxOverlay` (`app/components/PowerVfxOverlay.tsx`):** Full-board `15×15` compositor-only SVG/Framer overlay synchronizing:
  - **Nuke:** Siren warhead descent + `+0.88s` crimson corridor flash + radial shards.
  - **Shield:** Token shield dome badge + Aegis activation burst.
  - **Boost:** Plasma ignition ring + directional speed trail.
  - **Teleport:** 3-beat quantum warp beam + spatial scatter sparks.

### 9.4 Animation Ownership Split

| Animator | Strict Responsibility | Rule |
| :--- | :--- | :--- |
| **GSAP** | Multi-hop token movement (`BoardTokens.tsx` FLIP hops), board-level physics sequences | Must check `prefersReducedMotion()` and collapse to instant/quick fade when reduced |
| **Framer Motion** | Interactive UI transitions, drawers, `<Switch />`, desktop `PanelTabs` pill, `PowerVfxOverlay` bursts, `ClaimingOverlay` | Wrapped globally in `<MotionConfig reducedMotion={...}>` (`app/Providers.tsx`); **0** `layout` / `layoutId` animations allowed on mobile hot paths (gated by `check:motion`) |
| **CSS Transitions / Keyframes** | Hover/press detents (`120ms`), panel edges, and the `2` allowlisted keyframes (`loading-bar`, `shimmer`) plus gated HUD pulses | Only animate `transform`, `opacity`, or compositor-safe masks; never `width`, `height`, `top`, `left`, or `box-shadow` keyframes |

---

## 10. Motion & Reduced-Motion Policy

### 10.1 Three-Way Motion Preference (`lib/motion.ts` & `app/Providers.tsx`)

Ludo 3077 supports an explicit user override cookie (`ludo-motion`) alongside the OS media query `(prefers-reduced-motion: reduce)`:

| `MotionMode` | Body Class | Framer `MotionConfig` | Result |
| :--- | :--- | :--- | :--- |
| `'system'` (default) | *(none)* | `reducedMotion="user"` | Follows OS accessibility setting (`prefersReducedMotion()`) |
| `'full'` | `motion-force-full` | `reducedMotion="never"` | Forces full visual motion even if OS reduce-motion is enabled |
| `'reduced'` | `motion-force-reduced` | `reducedMotion="always"` | Forces zero decorative/continuous motion everywhere |

### 10.2 CSS Scoping Pattern

Because `motion-force-full` must override OS `@media (prefers-reduced-motion: reduce)` cleanly, CSS reduced-motion rules use this exact dual selector structure (`app/styles/motion.css`, `board.css`, `theme-3077.css`):

```css
@media (prefers-reduced-motion: reduce) {
  body:not(.motion-force-full) .your-animated-class {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}

body.motion-force-reduced .your-animated-class {
  animation: none !important;
  transition-duration: 0.01ms !important;
}
```

- All continuous decorative loops (`.animate-pulse`, `.animate-ping`, `.animate-bounce`, `.shimmer-effect::after`) are suppressed inside `3077` dashboard scopes, leaving only functional state cues (`.rail-sweep-3077`, live stream indicators, turn timer countdowns).
- **Important nuance:** In `reduced` mode, `.rail-sweep-3077::after` parks statically at `translateX(0); opacity: 0.5` so matchmaking state remains visually legible.

---

## 11. Styling Rules (Do & Do Not) & Accessibility

### Do
- Use Tailwind semantic tokens (`bg-surface-panel`, `bg-surface-recessed`, `hover:bg-surface-hover`, `text-ink-strong`, `text-ink-muted`, `border-line-soft`, `text-accent`, `text-positive`, `text-warn`, `text-negative`).
- Use `Button`, `Chip`, `Switch`, `ListRow`, `PanelTabs`, `GamePanelShell`, and `HudPrimitives`.
- Use `text-ludo-*` utilities (`text-ludo-xs` minimum `10px`) and `font-mono tabular-nums` on numbers.
- Provide explicit width/height (`w-* h-*` or `width`/`height` attrs) on every raw `<img>` to eliminate layout shift (CLS).
- Keep `:focus-visible` outlines crisp (`outline: 2px solid var(--accent); outline-offset: 2px;`).

### Do Not
- Do **not** hardcode light/dark hex branches (`#ffffff`, `#000000`, `text-slate-900`) for themeable surfaces/ink or invent JS theme-check hooks.
- Do **not** use `text-[8px]`, `text-[9px]`, or any arbitrary `text-[Npx]` utility in `app/**/*.tsx`.
- Do **not** add raw `<button>` controls for standard actions — wrap `<Button>` instead (and never bypass `useWalletGuard` / `SignWaitModal` when initiating a wallet prompt).
- Do **not** use Framer `layout` / `layoutId` in long lists or mobile cards, or CSS keyframes animating layout properties or `box-shadow`.
- Do **not** leave `<input>` / `<textarea>` fields without `autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}` (outside documented prose exceptions).

---

## 12. Copy & Naming Conventions

- **Headers, badges & buttons:** Concise UPPERCASE tactical phrasing (`DEPLOY MATCH`, `CLAIM REWARD`, `NO SIGNAL`, `CONNECTED`) in `3077` and `Retro`; sentence case in `Daybreak` headings (`Inter Tight`).
- **Body copy & hints:** Clear, scannable sentence case (`text-ink-muted` / `text-ink-dim`) without unnecessary jargon. Avoid crypto slang in primary onboarding or allowance sheets (`Starter`, `Tactical`, `Recommended`, plain-English allowance limits).
- **Identifiers:**
  - Components: `PascalCase.tsx` under `app/components/`
  - Hooks & engine utilities: `camelCase.ts` under `hooks/` (`app/hooks/` is strictly for audio hooks `useAudio.ts` and `useSoundEffects.ts`)
  - Theme-scoped utility classes: suffix `-3077` when 3077-specific (e.g. `.panel-shell-3077`, `.hud-ticks-3077`, `.hud-chamfer-md`)

---

## 13. Verification Gates & Migration State

Run these automated checks after UI or CSS changes (gated in CI / local verification):

| Command | Script | What It Enforces |
| :--- | :--- | :--- |
| `npm run check:type-scale` | `scripts/check-type-scale.mjs` | Zero hardcoded `text-[Npx]` utilities in `app/**/*.tsx` |
| `npm run check:motion` | `scripts/check-motion.mjs` | Compositor-only animations, allowlisted keyframes (`2`) & framer sites (`0`), JS `prefersReducedMotion` coverage (`4/4`) |
| `npm run check:fields` | `scripts/check-field-rules.mjs` | All free-text inputs/textareas carry OS interference suppression attributes (minus documented prose exceptions) |
| `npm run check:img` | `scripts/check-img-dimensions.mjs` | Every raw `<img>` declares explicit dimensions before decode |
| `npm run check:ui-tokens` | `scripts/check-ui-tokens.mjs` | Diff guard against banned raw colors/tokens in edited `app/` files |
| `npm run check:ui-contract` | `scripts/check-ui-contract.mjs` | Diff guard enforcing `Button` / `Chip` / primitive adoption on edited `app/` files |
| `node scripts/contrast.mjs --pairs` | `scripts/contrast.mjs` | WCAG 2.1 AA ratios (`>= 4.5:1` copy / `>= 3.0:1` UI) across 15 documented theme pairs |
| `npm run check:reduce-motion` | `scripts/check-reduced-motion.mjs` | Live browser assertion against `http://127.0.0.1:3000/` verifying 0 CSS/WAAPI animations under `reduce` |
| `npm run bench:css` | `scripts/bench-css.mjs` | CSS bundle size & rule count tracking |
| `npm run visual:diff` | `scripts/visual-diff.mjs` | Pixel regression gate (`<= 0.2%` delta) across committed baselines; **must run against `npm run build && npm start`**, not Turbopack `dev` |

### Implemented vs Remaining Migration State (`docs/ops/UI_AUDIT_TRACKER.md`)

- **Fully landed:** Modular CSS split (`15,473` lines across `app/globals.css` + `app/styles/*`), all 3 themes (`3077` default, `Retro`, `Daybreak`), reactive deployment-mode accents (`quick` / `team` / `offline`), zero hardcoded `text-[Npx]` type classes (`check:type-scale` clean), text-field attribute contract (`check:fields` clean), image dimension gate (`check:img` clean), WCAG contrast pairs (`15/15` passing), `MotionConfig` + 3-way `ludo-motion` override, and core primitives (`Button`, `Chip`, `Switch`, `ListRow`, `PanelTabs`, `GamePanelShell`, `HudPrimitives`, `SignWaitModal`, `ClaimingOverlay`).
- **Still tracked incrementally in `docs/ops/UI_AUDIT_TRACKER.md`:** Remaining legacy raw `<button>` sites and dead CSS family deletions inside older panel surfaces (e.g., remaining `TeamUpMatchPanel` buttons, social/wallet edge views) are migrated progressively via `check:ui-contract` and one-group PRs rather than bulk rewrites.
