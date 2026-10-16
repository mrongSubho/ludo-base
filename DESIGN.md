# DESIGN.md — Ludo Base design system

**What this file is.** The implemented design system: the tokens, components, scales, and rules
that are actually in force in this codebase, with the file that owns each one. Where a rule is
specified but not yet landed, it is marked **pending** in §12 — this document does not describe
aspirations as if they were facts.

**Where the detail lives.** This file is the contract. The audits are the reasoning and the
migration plan: `docs/ops/UI_DESIGN_AUDIT.md` (themes/tokens/typography),
`docs/ops/UI_COMPONENT_AUDIT.md` (components/primitives), `docs/ops/CSS_LAYOUT_ANIMATION_PLAN.md`
(layout/motion), `docs/ops/UI_AUDIT_TRACKER.md` (what is left), `docs/ops/MOTION_AUDIT.md`
(the animation inventory), `docs/ops/IMPLEMENTATION_RECORD.md` (closure record).

**Match this system; do not invent a second language.** New UI composes `Button`, `Chip`,
`Switch`, `ListRow`, `PanelTabs` and the semantic tokens. If a value you need is missing, add a
token — never a one-off class.

---

## 1. Identity & themes

- Chess-token board + `ActionDice` path picker + cosmic terminal glass; mobile-first shell.
- **Two themes**, both first-class:
  - `theme-retro-futurism` — default, dark. Cosmic glass, violet rim, cyan accent, scanlines.
  - `theme-daybreak` — light. Porcelain frost, slate ink, deepened cyan accent, soft shadows.
- **Theme selection:** cookie `ludo-theme` (`retro` default; legacy `light`/`porcelain` map to
  Daybreak), applied **server-side** in `app/layout.tsx` — there is no flash of the wrong theme.
- **Lobby backdrop:** theme-mapped photography, lobby only (`cyberpunk_bg.png` @ 0.55 /
  `pastel_bg.png` @ 0.3), inside an isolated stacking context at `z-index: -1`.
- **Fonts are self-hosted** via `next/font` (`app/fonts.ts`) — no third-party font origin.

| Role | Retro (default) | Daybreak |
|---|---|---|
| Body face | Chakra Petch (`--font-chakra`, `--font-body`) | Inter (`--font-inter`) |
| Display / headings | Russo One (`--font-russo`), uppercase | Inter Tight (`--font-inter-tight`), sentence case, `-0.02em` |
| Numerals in chrome | — | Inter Tight + `tabular-nums` (Daybreak remaps `.font-mono`) |

---

## 2. Token layers (three, in this order)

1. **Primitives** — `--ludo-*` (`app/globals.css:78-139`, per-theme overrides at `:910` Retro and
   `:325` Daybreak). Board colours, page background, panel background, base radius/shadow.
2. **Semantic tokens** — the layer panels must use: `--surface-*`, `--ink-*`, `--line-*`,
   `--accent*`, `--warn/--positive/--negative`, `--shadow-panel`, `--radius-card/chip`
   (`:152-210` Retro, `:351-367` Daybreak). Values equal what the theme already painted, so
   adopting one is visually neutral.
3. **Tailwind registrations** — `@theme` (`:11-43`) for the primitive/type utilities and
   **`@theme inline`** (`:59-76`) for the semantic ones.

**Two gotchas that are load-bearing — do not "simplify" them:**

- **`@theme inline` is required for the semantic block.** A plain `@theme` registration emits
  `--color-surface-recessed: var(--surface-recessed)` into `:root`, where it is substituted once
  against Retro's value and then inherited as a *frozen* colour — measured: `bg-surface-recessed`
  never flipped under `body.theme-daybreak`. `inline` emits the reference into each utility so the
  var resolves on the element and follows the theme.
- **`--surface-page` / `--surface-panel` are declared on `body`, not `:root`** (`:220-223`),
  because they chain to another theme variable and substitution happens where the property is
  *declared*. The `:root` copies remain as the pre-hydration fallback.

**Registered semantic utilities** (usable everywhere, theme-reactive, zero patch rules):
`bg-surface-page|panel|recessed|hover|active`, `text-ink-strong|muted|faint`,
`border-line-soft|strong`, `text-accent`, `bg-accent-soft`, `text-accent-ink`,
`text-warn|positive|negative`.

---

## 3. Theme palettes (implemented values)

| Role | Retro (dark, default) | Daybreak (light) |
|---|---|---|
| Page background | `#0F0F23` | `#e6e8ec` |
| Panel surface | `rgba(13,13,13,0.92)` | `rgba(255,255,255,0.88)` |
| Card | `rgba(15,15,35,0.85)` | `#ffffff` |
| Ink strong | `#ffffff` | `#0f172a` |
| Ink muted | `rgba(255,255,255,0.60)` | `rgba(15,23,42,0.62)` |
| Ink faint (decorative) | `rgba(255,255,255,0.40)` | `rgba(15,23,42,0.42)` |
| Line soft / strong | `rgba(255,255,255,0.10)` / `0.25` | `rgba(15,23,42,0.12)` / `0.24` |
| Accent | `#22d3ee` (cyan-400) | `#0d6d87` (AA-safe on the page) |
| Accent soft / ink-on-accent | `rgba(34,211,238,0.15)` / `#06282f` | `rgba(13,109,135,0.12)` / `#ffffff` |
| Warn / positive / negative | `#fbbf24` / `#4ade80` / `#f87171` | `#92400e` / `#166534` / `#b91c1c` |
| Border primitive (`--ludo-border`) | `rgba(124,58,237,0.4)` (violet rim) | `#e2e8f0` |
| Board pastels (green/red/blue/yellow) | `#16a34a` / `#dc2626` / `#2563eb` / `#ca8a04` | `#22c55e` / `#ef4444` / `#3b82f6` / `#eab308` |
| Board path / pad | `#e2e8f0` / — | `#ffffff` / `rgba(0,0,0,0.35)` |

The three Daybreak status values are the **AA-safe corrected set** — the audit's originally
proposed `#b45309/#15803d/#dc2626` measured 4.09/4.09/3.94 on `#e6e8ec` (below AA) and were
replaced after measurement. Do not "restore" them.

**Specialised token families** (same pattern, narrower scope):

- **Error surfaces** (`--err-*`, `:183-209`): one card for every error boundary (scoped
  `PanelErrorBoundary`, `app/error.tsx`, inlined `global-error.tsx`). Daybreak inverts the CTA to
  `#171717` so a white button never sits on the white card.
- **Marketplace category rail** (`--market-chip-*`): theme-aware badge + active icon; the rail sits
  on the panel, so hardcoded white/cyan utilities would go white-on-white in Daybreak.

---

## 4. Typography

**Fluid type scale** (`@theme`, `:28-42`) — seven steps, **hard 10px floor** (the audit measured
135 usages below it; 6px text is unreadable on any device):

| Token | Resolves to |
|---|---|
| `--text-ludo-xs` | `10px` (fixed) |
| `--text-ludo-sm` | `clamp(10px … 11px)` |
| `--text-ludo-md` | `clamp(11px … 13px)` |
| `--text-ludo-lg` | `clamp(13px … 15px)` |
| `--text-ludo-xl` | `clamp(15px … 17px)` |
| `--text-ludo-2xl` | `clamp(17px … 20px)` |
| `--text-ludo-3xl` | `clamp(20px … 22px)` |

Each step's max is a size the app already used as a hardcoded px value, so adopting one is
rendering-neutral at ≥ 440px and narrows toward 320px. Usage: `text-ludo-md` etc.

**Rules:**

- **Nothing below 10px**, ever. Status pills are 10–11px; body copy ≥ 12px.
- **Chrome labels are uppercase micro-type**: the in-force pattern is
  `text-[10px] font-black uppercase tracking-[0.2em]` (or `tracking-widest`) — ~22 files.
  *Pending (T-1/T-2):* this collapses into a single `.label-chrome` class with a per-theme case
  (Retro uppercase / Daybreak sentence-case) plus a `.display` utility driven by `--font-display`.
  Until it lands, keep new chrome labels on the existing pattern rather than inventing a third.
- **Headings:** Retro owns its voice through element selectors; Daybreak overrides `h1–h3` to Inter
  Tight, `letter-spacing: -0.02em`, `text-transform: none`.
- **Weight:** 400 / 600 / 700 / 800. `font-black` (900) is reserved for chrome labels (and, once
  landed, only inside `.label-chrome`).

---

## 5. Scales (the enforcement surface)

| Scale | Tokens | Rule |
|---|---|---|
| Icon | `--icon-sm 14px` · `--icon-md 16px` · `--icon-lg 20px`, with `.icon-sm/md/lg` utilities (`:231-242`) | inline next to text / standalone action / feature-header. Do not hand-roll `w-4 h-4` on SVGs. |
| Motion (component) | `--motion-micro 150ms` · `--motion-control 200ms` · `--motion-surface 300ms` · `--ease-standard cubic-bezier(0.2,0,0,1)` | colour/opacity · buttons+toggles · panels+sheets. |
| Motion (engine/board) | `--ludo-motion-fast 120ms` · `-base 200ms` · `-slow 320ms` · `-token-hop 450ms` · `--ludo-ease-standard` · `--ludo-ease-emphasis cubic-bezier(0.34,1.56,0.64,1)` (`:1662-1671`) | durations/easings are decisions, not numbers someone typed. |
| Radius | `--radius-sm 8` · `-md 12` · `-lg 16` · `-xl 20` · `-pill 9999`; card `--radius-card 16px` (Daybreak 18), chip `--radius-chip 12px` | controls 10/12/14 · card 16 · sheet 28/32 · pill 999. Arbitrary `rounded-[Npx]` outside panels/sheets is banned by the (pending) contract guard. |
| Tap targets | — | **≥ 44px** on primary actions; `Button size="icon"` is 44×44 by construction. |
| Gap | — | 4pt-ish (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8) — keep. |

---

## 6. Components (implemented primitives)

### 6.1 `Button` — `app/components/Button.tsx`

The one button. Replaces ~30 legacy families. Every state is handled once, in tokens.

| Variant | Fill | Use for |
|---|---|---|
| `primary` | `bg-accent` + `text-accent-ink` | **The one** main action per surface |
| `secondary` | `bg-surface-hover` + `border-line-soft` | Most actions |
| `ghost` | transparent, `text-ink-muted` | Tertiary / destructive-adjacent |
| `danger` | `bg-negative` + white | Confirm-destructive only |

| Size | Height | Type | Radius |
|---|---|---|---|
| `sm` | 32px | 11px/700 | 10px |
| `md` (default) | 40px | 12px/700 | 12px |
| `lg` | 48px | 13px/700 | 14px |
| `icon` | 44×44 | bare children = the icon | full |

**States — no exceptions:** hover steps the fill; active is `scale-[0.98]`; focus-visible uses the
**global ring only** (per-component rings are deleted); disabled is `opacity-45` +
`cursor-not-allowed` **always** (the audit counted 47 buttons that looked enabled but weren't);
`loading` sets `aria-busy` and swaps the icon slot for a spinner while the label stays.

**Brand exception (P0-2 decision):** `#0052FF` is **retired as a CTA fill**. Where Base branding is
mandatory (Base Account / onchain actions) pass `brand` with `variant="primary"` — that is the only
sanctioned use of the hex. White-fill CTAs are `primary` (accent).

### 6.2 `Chip` — `app/components/Chip.tsx`

One chip, three types on the shared `.chip` base (`globals.css:250-320`). Non-interactive types
render a `<span>`; `type="filter"` renders a real `<button>` and wires `aria-pressed`.

| Type | Renders | Notes |
|---|---|---|
| `filter` | `<button>` | toggles; `active` → accent wash via `.chip[aria-pressed="true"]` |
| `status` | `<span>` | `status="ok" \| "warn" \| "off"` → `.chip-status-*` (`--positive` / `--warn` / `--ink-faint`) |
| `info` (default) | `<span>` | neutral tag |

Modifiers: `size="sm"` (`.chip-sm`, 10px), `tone="address"` (monospace face), `icon` (auto-sized
via `.icon-sm`), `className` passthrough. Absorbs the seven legacy families (`bet-chip`,
`cb-filter-chip`, `tk-chip`, `dapp-chip`, `wl-addr-chip`, `match-status-*`, `cb-status-pill`) plus
`sec-tag`, `dapp-chips`, `ai-thinking-tag`, `match-stats-chip`.

**Base values:** pill radius, `1px solid var(--line-soft)`, `var(--surface-recessed)` fill,
`var(--ink-muted)` ink, `4px 10px` padding, 11px/650, `white-space: nowrap`. Active state:
`var(--accent-soft)` fill + `var(--accent)` ink + `color-mix(accent 40%)` border.

### 6.3 `Switch` — `app/components/Switch.tsx`

The only toggle. `role="switch"` + `aria-checked` + `aria-label`, 44×24 track, accent-filled when
on (`bg-accent` / `bg-surface-hover` off), spring-driven knob (`stiffness 500 / damping 32`),
`opacity-45` when disabled. No per-component focus ring (global ring only).

### 6.4 `ListRow` — `app/components/ListRow.tsx`

The shared row rhythm, promoted from Settings: **36px icon tile** (`w-9 h-9 rounded-xl`) +
13px/700 label + 10px hint + `p-3.5` + a `divide` hairline. `trailing` takes the control (Switch,
Chevron, Chip). With `onClick` the row is a `<button>`; otherwise a container — same markup.
Used by Settings, Friends, Messages, Wallet activity, Marketplace, Leaderboard.

### 6.5 Kept from before — do not regress

- `PanelTabs` / `PanelChildTabs` — **the** segmented control (single source of truth; `seg-btn` /
  `bet-pills` / `cb-mode-pill` duplicates are banned and being deleted).
- `EmptyState` — the shared empty/error surface with a proper ≥44px CTA.
- The **global `button:focus-visible` ring** — exactly one focus visual in the app.
- `ConnectionBadge`'s status vocabulary — the model for status semantics.
- SVG iconography at `strokeWidth={2}`.

---

## 7. Motion policy

**Motion is deliberate and load-bearing — it was never removed.** The site-wide inventory is
`docs/ops/MOTION_AUDIT.md`: 35 keyframes, 44 `animation:` declarations (23 infinite), 34
framer-motion files, 2 GSAP board timelines, 3 canvas-confetti sites, all live.

**The three rules:**

1. **Everything respects `prefers-reduced-motion`.** CSS via the kill-switch blocks
   (`globals.css:6150` global + targeted blocks), framer via `<MotionConfig reducedMotion="user">`
   (`app/Providers.tsx`), GSAP + confetti via `lib/motion.ts` (`prefersReducedMotion()` /
   `onReducedMotionChange()`). Census: **5/5 JS motion files guarded**.
2. **Compositor-only for new code.** No new `transition`/`animation` on
   `width|height|top|left|right|bottom|margin|padding`. The gate allowlists exactly two keyframes
   (`loading-bar`, `shimmer`) and three framer layout-animation sites as measured as-found cases.
3. **The a11y rule (`CSS_LAYOUT_ANIMATION_PLAN` §5):** *reduced motion removes **translation**,
   never **information**.* Board positions are engine state rendered from `lib/boardLayout`
   coordinates, so a reduced-motion move is an instant repositioning — the same fact, delivered
   without motion. Dice results and win states render as static, announced states.

**Library ownership:** CSS keyframes for one-shot ≤ 320ms · framer-motion for React
orchestration/gesture (sheets, overlays, dice roll) · GSAP **only** for engine-driven token
movement. A third runtime requires an ADR against the bundle budget.

**Ambient loops** (orbs, tickers, radar rings) stay, but must be pausable/ignorable: no information
may be conveyed by motion alone, and animated decoration is `aria-hidden` with adjacent text.

---

## 8. Layout contract

- **Shell:** `.app-shell` — `max-width: 500px`, centered, `height: var(--app-vh, 100dvh)`,
  `overflow-x: clip`. Mobile-first; desktop is the same column.
- **Viewport:** `--app-vh` / `--visible-vh` / `--layout-vh` are written by `FrameProvider` from the
  **visual** viewport; `--vv-dead-bottom` is the layout strip below the painted area. Never use
  bare `100vh` in new fixed-bottom chrome.
- **Safe area:** `--safe-bottom` is **JS-clamped** (0 when the reported inset > 48px, i.e. an empty
  host-webview toolbar). Every fixed-bottom surface consumes the token, **never raw
  `env(safe-area-inset-bottom)`**. `--kb-inset` covers the keyboard.
- **Footer nav:** fixed, `z-index: 200`, `padding-bottom: min(10px + var(--safe-bottom), 34px)`,
  opaque enough that content never bleeds under labels; hidden while `body.keyboard-open`.
- **Panel sandwich:** panels sit between the header and the footer; `--footer-h` is 76px (62px below
  430px) and `--panel-gap` is 8px. Panel shells read `var(--panel-bg)` / `--panel-border` /
  `--shadow-panel` — no hardcoded dark values.
- **Board:** a measured square (`aspect-ratio: 1/1`, stable box sizing, pinned `--board-area-h`) —
  never force a `100vw` height. Board colour comes from `--ludo-base-*` / `--ludo-path-bg` /
  `--ludo-pad-bg`. **The board is excluded from the token migration** — its pastels are
  intentionally theme-specific.
- **Space reservation:** the board box, `.ludo-dice-container` (pinned 48×48), the player row (56px
  / 48px on mobile) and the win overlay (`position: fixed`) reserve their space so inserts never
  reflow the board.
- **Containment:** `contain: layout paint` on transient toasts; `overscroll-behavior: contain` on
  every scroll panel (via `.no-scrollbar`). `content-visibility` is **deliberately not applied** to
  feeds/leaderboards (measured: it breaks framer layout measurement and bottom-pinned scroll).

---

## 9. Colour & styling rules (do / do not)

**Do**

- Reach for semantic tokens: `bg-surface-*`, `text-ink-*`, `border-line-*`, `text-accent`,
  `bg-accent-soft`, `text-warn|positive|negative`.
- Compose `Button` / `Chip` / `Switch` / `ListRow` / `PanelTabs` instead of new class recipes.
- Size icons with `.icon-sm/md/lg`; take durations from the motion tokens.

**Do not**

- **Add new `body.theme-daybreak …` override rules.** The patch layer only shrinks (522 lines and
  falling, target 0). A panel that needs a value the patch layer lacks uses a **token**.
- Ship new hardcoded dark-first utilities (`text-white`, `bg-white/10`, `border-white/10`,
  `text-cyan-400`) in new code. Existing files migrate group by group — see the tracker §5.
- Use `#0052FF` outside the documented `Button brand` exception.
- Use `font-black` outside chrome labels; use any text below 10px.
- Add a scope class to a Daybreak `:is()` list.
- Convert the board to tokens, or "fix" the `bg-black/40`-style scrims — scrims are theme-neutral
  by design.
- Animate layout properties, or animate anything without a reduced-motion path.

---

## 10. Accessibility

- **Contrast:** every ink/surface/accent pair is asserted by `node scripts/contrast.mjs --pairs`
  (15 pairs, both themes; 4.5:1 text, 3:1 UI). Faint inks (`--ink-faint`) are decorative — never
  required text.
- **Semantics:** toggles are `role="switch"` + `aria-checked`; toggleable chips are `aria-pressed`;
  icon-only buttons carry `aria-label`; status changes use `role="status"` / `aria-live="polite"`.
- **Focus:** one global `:focus-visible` ring. Never `outline: none` without a replacement.
- **Motion:** see §7 — no information by motion alone.

---

## 11. Gates (how to verify any change)

```bash
npm run lint && npm run typecheck && npm test        # standard gates
npm run check:motion        # compositor-only + reduced-motion census
npm run check:reduce-motion # live: 0 animations under reduce, motion under no-preference
npm run check:img           # every raw <img> reserves its box
npm run check:routes        # route-auth matrix
node scripts/contrast.mjs --pairs                    # 15 contrast pairs
npm run bench:css                                    # CSS bytes, rule/keyframe counts, type adoption
npm run visual:diff         # two-theme pixel gate (run against a production build)
```

Not yet shipped (**pending**, tracker Tier 5): `scripts/check-ui-tokens.sh` (`ui-token-guard`) and
`scripts/check-ui-contract.sh` (banned-pattern guard) plus the ESLint `no-restricted-syntax` rules.

---

## 12. Pending — specified but not yet in force

| Item | State |
|---|---|
| `.label-chrome` + `.display` (per-theme label case, `--font-display`) | Specified (`UI_DESIGN_AUDIT` §5.3); not landed. Keep new labels on the existing uppercase micro-type pattern. |
| Mass type migration (589 hardcoded `text-[Npx]` sites) | Pending; the fluid scale is adopted on the game surface (9 sites). |
| Panel sweep (`Button`/`Chip` adoption) | In progress — raw `<button>` is down to 238; wallet/social/progression/match-sheet/chrome remainders tracked in `UI_AUDIT_TRACKER.md` §5. |
| Daybreak patch layer → 0 | In progress (522 lines). |
| Token-contract CI guards (§11) | Not shipped; run the checks manually until then. |
| `next/image` for LCP art | Pending a pass against the OpenNext/Cloudflare image pipeline. |

---

## 13. Copy

- Sentence case for explanations; uppercase only for chrome labels.
- Name what the user controls (“Try again”, not “Retry request”).
- Errors state what failed and what to do next.
- Never ship multiplayer trust claims the engine does not enforce.

---

*Update this file in the same PR that changes a token, a primitive, or a scale. If a rule here
stops being true, fix the rule or fix the code — a stale contract is worse than none.*
