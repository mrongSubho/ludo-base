# CSS Layout & Animation Optimization Plan — Ludo Base

| | |
|---|---|
| **Date** | 2026-10-13 |
| **Scope** | Layout performance, responsive behavior, animation efficiency, and motion/layout accessibility across `app/globals.css`, `app/components/**`, `app/page.tsx`, `app/styles/**`, `hooks/**` |
| **Companions** | `UI_DESIGN_AUDIT.md` (color/token layer — this plan's Phase 2 depends on its Phase 2), `UI_COMPONENT_AUDIT.md` (component & motion scales — this plan's Phase 3 builds on its motion scale) |
| **Status** | **Partially implemented 2026-10-13** — Phase 0 baselines captured; the P0 motion/a11y slice landed (reduced-motion across all JS motion, motion tokens, dvh/overscroll, `check-motion` gate in CI); the `<img>` intrinsic-dimensions pass landed with a blocking `check:img` gate (40 → 0 unsized tags). Layout-shifting phases (reset layering, `globals.css` split, fluid board, container queries) are deferred — see §7 and Part V of `docs/ops/IMPLEMENTATION_RECORD.md`. |
| **Stack** | Next.js 16 (App Router, webpack build), Tailwind CSS v4 (`@tailwindcss/postcss`), framer-motion v12, GSAP 3, canvas-confetti |

## 1. Objectives

- **Layout performance:** keep board, lobby, and spectate surfaces interactive (INP ≤ 200 ms p75) on mid-tier mobile by eliminating avoidable layout/paint work and shrinking shipped CSS.
- **Responsive behavior:** one fluid board + panel system that behaves from 320 px phones to desktop and inside Farcaster mini-app webviews (safe areas, varying viewport heights), with zero layout shift on mount and rotate.
- **Animation efficiency:** all motion on the compositor (`transform`/`opacity` only), one orchestration library per motion class, a fixed motion scale shared across surfaces.
- **Accessibility:** every animation — CSS, framer-motion, GSAP, canvas — honors `prefers-reduced-motion`; no information is conveyed by motion alone; focus order and visibility never depend on animation.
- **Guardrails:** budgets (CSS size, animated-property whitelist, reduced-motion coverage) enforced in CI so regressions cannot merge.

## 2. Current-State Assessment

### 2.1 What is already healthy (do not regress)

- Self-hosted webfonts via `next/font` (no render-blocking `fonts.googleapis.com` @imports; see `app/globals.css:6-8`).
- A blanket `prefers-reduced-motion` kill-switch plus three targeted blocks in `globals.css` (lines 6711, 7241, 11673, 11771) — CSS-driven animation already degrades globally.
- Server-side theme application in `app/layout.tsx` (no flash-of-wrong-theme).
- The board surface consumes `var(--ludo-*)` tokens rather than hardcoded palette values.
- Production build locked to webpack for smaller critical-path payload — the same discipline this plan applies to CSS.

### 2.2 Measured gaps

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| G1 | Single 11,775-line `globals.css` | 558 `body.theme-daybreak` rules, 239 `:is()` selectors, ~30 duplicated 23-class scope lists, 22 "spacing-repair" sections | whole-file parse/apply cost per route; specificity arms race |
| G2 | Unlayered universal reset `* { margin: 0; padding: 0 }` | `globals.css:585-591`, per `UI_DESIGN_AUDIT.md` §2 | beats Tailwind v4 layered utilities app-wide, forcing hundreds of hand-repaired spacing rules |
| G3 | ~0% token adoption | `UI_DESIGN_AUDIT.md`: 771 `text-white`, 519 `bg-white/*`, 356 `border-white/*`, 632 `cyan-*` across 44 of 92 files; `@theme` utilities consumed 0 times | every new utility needs a Daybreak override; CSS grows linearly with features |
| G4 | No component-level reduced-motion handling | `useReducedMotion` / `MotionConfig` / `gsap.matchMedia` absent repo-wide; framer-motion in 34 files; GSAP drives token movement (`board/TokenVisual.tsx`, `board/TokenPiece.tsx`); `canvas-confetti` on wins | JS-driven motion ignores the OS setting; the CSS kill-switch does not cover JS animation |
| G5 | 23 files render raw `<img>`; `next/image` used 0 times | static grep of `app/**/*.tsx` | no intrinsic sizing (CLS risk), no responsive srcset, no priority/lazy hints |
| G6 | 295 inline `style={{…}}` | static grep | bypasses CSSOM caching, hides dynamic values from audit tooling |
| G7 | No modern viewport/safe-area strategy | no `dvh/svh/lvh`/`100vh` in `globals.css`; no `env(safe-area-inset-*)`; no `@container` | fixed-height layouts break in mini-app webviews and on URL-bar show/hide |
| G8 | Motion is ungoverned | 50 `@keyframes`/`animate-*` in `globals.css`; timings hardcoded per component; framer + GSAP both loaded | inconsistent feel, unpredictable main-thread cost, no compositor-only enforcement point |
| G9 | Long live lists lack containment | `LiveMatchmakingFeed`, `ActivityFeed`, `Leaderboard`, match chat render unbounded lists | row inserts trigger full-list layout; scroll jank under load |

### 2.3 Root causes (why the gaps persist)

1. **One giant unlayered file** — resets, utilities, and themes compete at one layer, so fixes add specificity instead of removing work.
2. **No motion owner** — keyframes, framer components, GSAP timelines, and confetti each set their own timing; nothing checks the compositor-only rule or reduced-motion.
3. **No budgets** — CI fails on nothing CSS-related, so growth is cheap to add and expensive to carry.

## 3. Prioritized Optimization Strategies

Priority: **P0** first (biggest payoff, low risk) · **P1** core work · **P2** hardening. Effort: **S** ≤ 2 days · **M** ≈ 1 week · **L** multi-week.

### 3.1 Layout performance (P0/P1)

- **[P0/S] Layer the stylesheet.** Move the universal reset and base styles into `@layer base` so Tailwind v4 utilities win without hand-repair; shrinks the 22 spacing-repair sections. *Risk: app-wide spacing shift — pair with the Phase 0 visual-diff harness.*
- **[P0/S] Image dimensions.** Add `width`/`height` (or `aspect-ratio`) to the 23 raw `<img>` sites; migrate LCP-critical raster art to `next/image` (`priority` on hero/lobby art, lazy elsewhere). Keep inline SVG/CSS art as-is.
- **[P0/S] Reserve space.** Board, dice, panels, and overlay mounts get `aspect-ratio`/`min-height` so network/stream inserts never reflow the board.
- **[P1/M] Contain long lists.** `content-visibility: auto` + `contain-intrinsic-size` on feed/leaderboard/chat rows; `overscroll-behavior: contain` on scroll panels; `contain: layout paint` on chips/toasts. *Risk: hurts find-in-page/a11y — skip searchable lists.*
- **[P1/M] Split `globals.css` by concern** into `app/styles/` modules (`tokens.css`, `base.css`, `board.css`, `panels.css`, `motion.css`, `themes/*`), `@import`ed from `globals.css`. Coordinate with `UI_DESIGN_AUDIT.md` Phase 2 so the Daybreak patch layer shrinks as scopes consolidate.
- **[P1/M] Cut inline styles to dynamic-only.** Survivors: genuinely per-render values (engine-state token transforms, live progress). Everything static moves to classes.
- **[P2/M] CSS payload budget.** Baseline gzip in Phase 0; −30% net target after the token layer; block merges above baseline.

### 3.2 Responsive behavior (P0/P1)

- **[P0/S] Viewport units.** Replace fixed `vh` (inventory components; `globals.css` is clean) with `dvh` + `vh` fallback inside `@supports` for older mini-app webviews.
- **[P0/S] Safe areas.** `env(safe-area-inset-*)` padding on fixed footer nav, header, board frame; verify in a Farcaster frame viewport. *Tradeoff: scope insets to `pointer: coarse`/max-width so desktop is untouched.*
- **[P1/M] Fluid board.** `aspect-ratio: 1` container sized via `min(92vw, 60dvh, 640px)`-style `clamp()` tokens; grid children use `%`/`fr`, never px. Rotate/resize must not recompute the grid.
- **[P1/M] Container queries for panels.** Replace duplicated per-panel media queries with `@container` on static panel shells — directly reduces the scope-list duplication. *Risk: containment on animated panels can affect stacking.*
- **[P1/S] Type scale.** Move hardcoded `text-[..px]` onto a `clamp()`-based scale in `@theme` so 320 px → desktop needs no per-breakpoint overrides.
- **[P2/S] Touch ergonomics.** Audit `touch-action`/tap-highlight on dice, tokens, emote tray; roll targets ≥ 44 px on coarse pointers.

### 3.3 Animation efficiency (P0/P1)

- **[P0/S] Compositor-only gate.** New `scripts/check-motion.mjs` (mirrors existing `check-*.mjs` gates): fails on `transition`/`animation` targeting `width|height|top|left|right|bottom|margin|padding` outside an allowlist, and on new `box-shadow`/`filter` animations. Wire into `.github/workflows/ci.yml`.
- **[P0/S] `will-change` discipline.** Currently 0 declarations — keep it that way; allow transient `will-change: transform` only on `board/*` token pieces during a move, removed on complete. Never on scroll containers.
- **[P1/M] Motion scale + convention** (CSS custom properties): `fast 120ms`, `base 200ms`, `slow 320ms`, `token-hop 450ms`; easings `cubic-bezier(0.2,0,0,1)` standard, `cubic-bezier(0.34,1.56,0.64,1)` emphasis. Convention: **CSS keyframes for one-shot ≤ 320 ms** · **framer-motion for React orchestration/gesture** (sheets, overlays, dice roll) · **GSAP only for engine-driven token movement** (hops/captures sequenced off `GameState`). New motion libraries require an ADR against the webpack bundle budget.
- **[P1/M] Engine-driven, layout-free animation.** Token hops read positions from `lib/boardLayout` coordinates — no `getBoundingClientRect` in the animation path. Confetti capped ≤ 1.5 s, single instance, auto-disposed.
- **[P1/M] Consolidate runtimes.** GSAP (2 board files) vs framer (~35 files): dead-path elimination per route; if GSAP serves ≤ 2 timelines, collapse into framer and drop it.
- **[P2/S] Pause ambient loops** (live dots, pulses, scanlines) on `visibilitychange` and offscreen panels via `animation-play-state`.

### 3.4 Accessibility of motion & layout (P0/P1)

- **[P0/S] Extend reduced-motion to JS.** `<MotionConfig reducedMotion="user">` at the app root; `gsap.matchMedia("(prefers-reduced-motion: reduce)")` around token timelines (instant reposition — engine state stays authoritative); gate confetti on the query. Closes G4 to match the existing CSS kill-switch.
- **[P0/S] Nothing-by-motion-only audit.** Live badges, turn timers, "your-turn" cues, capture feedback need text/ARIA equivalents (`role="status"`, `aria-live="polite"`); animated dots get `aria-hidden` + adjacent text.
- **[P1/M] Focus integrity.** Animated overlays move focus on open and restore on close; `:focus-visible` uses one token (`--ludo-focus-ring`) at ≥ 3:1 contrast on both themes — verify against `UI_COMPONENT_AUDIT.md`.
- **[P1/S] Optional manual preference.** `SettingsPanel` toggle persisting `ludo-reduced-motion`, OR'd with the OS query. *Ship only if Phase 3 has slack.*
- **[P1/S] Contrast under animation.** No animated background/text combos below 4.5:1 at any keyframe (check Daybreak translucent panels).
- **[P2/M] Screen-reader pass.** Board state changes (capture, home column) announced via existing status regions, not only visuals.

### 3.5 Maintainability guardrails (P2)

- Motion/scale doc in `design-system/` (extend `MASTER.md`): durations, easings, library ownership per motion class.
- CSS architecture section in `DESIGN.md`/`AGENTS.md`: layer order, where new CSS lives, the inline-style rule.
- One named reviewer for `app/styles/**` and `scripts/check-motion.mjs`.

## 4. Implementation Phases

Sequenced against the companion audits: **Phase 2 depends on `UI_DESIGN_AUDIT.md` Phase 2 (token layer); Phase 3 depends on `UI_COMPONENT_AUDIT.md` motion scale.**

**Phase 0 — Baseline & instrumentation (no app changes)**
- Capture: `next build` (webpack) CSS/JS chunk report; Lighthouse mobile on lobby/board/spectate (both themes); Playwright CPU-throttled trace of a token-hop sequence.
- Write `scripts/bench-css.mjs` (gzip size, rule/selector counts, media-query count, keyframes count), CI-advisory.
- Visual-diff harness: Playwright screenshots of 8 scenes (lobby, board mid-game, spectate × Retro/Daybreak — Playwright is a devDependency; `npx playwright install chromium` if browsers are missing).
- **Motion census:** every animation source (keyframes, framer components, GSAP timelines, confetti) with property, duration, trigger.
- Exit gate: baselines recorded in §6.

**Phase 1 — Cheap wins (low risk, high certainty)**
- Layer the reset; image dimensions + `next/image` on LCP hero; space reservation; `dvh` migration; safe-area padding; `content-visibility` on feeds; `overscroll-behavior`; `clamp()` type tokens.
- Gate: visual-diff clean on 8 scenes; Lighthouse no-regression; `npm run lint` + `tsc --noEmit` green.

**Phase 2 — Layout architecture (after token layer lands)**
- Split `globals.css`; migrate panels scope-by-scope; delete Daybreak patch rules as token coverage replaces them (target: patch layer → near zero).
- Fluid board via `clamp()`; container queries on panel shells; inline-style cleanup on the 10 hottest components (board, dice, panels).
- Gate: rule count and CSS gzip trending down every PR; visual-diff clean; `style={{` additions outside the dynamic allowlist blocked.

**Phase 3 — Motion system**
- Motion scale tokens + convention doc; `MotionConfig reducedMotion="user"`; `gsap.matchMedia` on token timelines; confetti gating; `scripts/check-motion.mjs` lands in CI; ambient-loop pausing; runtime consolidation.
- Gate: census 100% reduced-motion-respecting; zero layout-property animations outside allowlist; frame budget met under 4× CPU throttle.

**Phase 4 — Accessibility & sign-off**
- Focus management on animated overlays; status/`aria-live` audit; contrast re-check at all keyframes; optional motion toggle; docs updated (`DESIGN.md`, `design-system/MASTER.md`, `AGENTS.md`).
- Gate: `npm test` + `lint` + `typecheck` + new CSS/motion CI jobs green; verification record appended; deferred items logged in `docs/ops/UNPARK_CHECKLIST.md`.

## 5. Tradeoffs & Explicit Decisions

- **Layering the reset changes spacing everywhere.** Do it in Phase 1 behind visual-diff, before token migration — the alternative compounds G1/G2. Fallback: wrap only the reset in `@layer base`, defer utility re-assertion to Phase 2.
- **Splitting `globals.css` risks merge conflicts and load-order bugs.** Mechanical split (move, don't rewrite); pinned `@import` order; no archive until the size gate proves the win.
- **Two motion runtimes (framer + GSAP) cost bundle bytes.** Keep both only for their proven roles (React gesture/orchestration vs engine-driven token timelines); forbid a third; the census must justify any new animation dependency. If GSAP serves ≤ 2 timelines, collapse into framer and drop it.
- **Blanket reduced-motion can strip gameplay feedback.** Decision: reduced motion removes *translation*, never *information* — moves become instant repositionings driven by engine state; dice results and win states render as static, announced states.
- **`dvh`/safe-area insets change chrome geometry.** `dvh` with `@supports` fallback; insets scoped to coarse-pointer/small-viewport media queries so desktop is untouched.
- **`content-visibility: auto` hurts find-in-page and some a11y tooling.** Only on feed/leaderboard/chat rows — never the board or searchable text.
- **No physical-device measurement in this environment** (matches the existing Android-trace deferral). Proxy: 4× CPU-throttled Playwright/WebPageTest; real-device pass (mid-tier Android + iPhone SE) is deferred evidence via `docs/ops/UNPARK_CHECKLIST.md`.
- **CI cost.** Lighthouse + visual-diff only on PRs touching `app/**` or `scripts/check-motion.mjs`; `bench-css.mjs` stays advisory until Phase 2 to avoid blocking the token migration.

## 6. Measurable Success Criteria

Baselines are captured in Phase 0; targets below are the merge gates.

Baselines measured 2026-10-13 via `npm run bench:css` + `npm run check:motion` (Lighthouse numbers still TBD — no device/browser automation in this environment):

| Metric | Baseline (measured 2026-10-13) | Target | Gate / how measured |
|---|---|---|---|
| Lighthouse mobile Perf (lobby, board) | TBD | ≥ 90 both themes | Lighthouse CI on PRs touching `app/**` |
| LCP (mid-tier mobile profile) | TBD | ≤ 2.5 s p75 | Lighthouse / WebPageTest |
| INP | TBD | ≤ 200 ms p75 | Lighthouse; field data when available |
| CLS | TBD | ≤ 0.05 in-game, ≤ 0.1 app-wide | Lighthouse |
| CSS payload (gzip, first load) | **335,877 B raw / 57,961 B gzip** (3 files; globals.css 334,440 B / 57,261 B gzip) | −30% after Phase 2; never above baseline before | `npm run bench:css` (advisory in CI) |
| Layout-property animations | **0 shorthand violations; 2 keyframes + 4 framer animate sites (3 files) allowlisted** | 0 outside allowlist | `npm run check:motion` (blocking in CI) |
| Reduced-motion coverage (JS-driven) | **5/5** (2 GSAP + 3 confetti; the 34 framer files ride `MotionConfig`) — was 0% | 100% of census entries | `check:motion` census |
| Raw `<img>` without dimensions | **0 tags / 23 files sized 2026-10-13** (was 40 / 23 on the Phase 0 baseline) | 0 | `npm run check:img` (blocking in CI) |
| Inline `style={{` in components | **295** | ≤ 100, dynamic-only | `bench:css` report |
| Keyframes in `globals.css` | **34** | declining; all on the motion scale | census diff |
| `globals.css` size | **11,791 lines · ~2,364 rules · 22 @media · 156 custom props** | split into ≤ 6 modules, monotonic shrink | `bench:css` |
| Token adoption (`@theme` utilities consumed) | 0 | per `UI_DESIGN_AUDIT.md` Phase 4 | token-usage grep |
| First-load JS (webpack report) | TBD | no regression from Phase 3; net-negative if GSAP kept | `next build` output diff |
| test / lint / typecheck | green | green at every phase gate | `npm test`, `npm run lint`, `npx tsc --noEmit` |

**Definition of done for the plan:** Phases 0–4 gates green; §6 targets met or re-baselined with written justification; verification record appended to this doc; deferred items (real-device frame pass, optional motion toggle) recorded in `docs/ops/UNPARK_CHECKLIST.md` with owners.

## 7. Deferred / Open Items

- Real-device frame-time evidence (mid-tier Android, iPhone SE) — needs hardware; proxy = 4× CPU throttle traces.
- Optional in-settings motion preference toggle — ship only if Phase 3 has slack.
- Field INP data — depends on a RUM pipeline; Lighthouse INP is the interim gate.
- Whether `content-visibility` helps or hurts the live-arena directory at realistic row counts — measure in Phase 1 before enforcing.
- Added 2026-10-13 after the P0 integration landed: **reset layering (`@layer base`)** — needs the Playwright visual-diff harness first, so an app-wide spacing shift can't ship unverified (no browser toolchain in that environment); **the `globals.css` module split**, **fluid board clamp() sizing**, and **container queries** — all layout-shifting, all blocked on the same harness or per-site measurement; **focus-ring unification** (`--ludo-focus-ring`) and the **screen-reader pass** — Phase 4 work; **GSAP→framer consolidation** — the census says GSAP serves exactly 2 timelines (TokenPiece/TokenVisual), so collapse remains the plan's call once the motion-scale convention has usage data. Full list: Part V of `docs/ops/IMPLEMENTATION_RECORD.md`.
- The **`<img>` dimension codemod is done** (2026-10-13, Phase 1 branch): 34 tags sized (avatars 96², emotes 64², piece sprite 128², venue plate 1024×1536 — the attributes are overridden wherever CSS already sizes the element and only declare the intrinsic ratio), and `scripts/check-img-dimensions.mjs` is now a blocking CI gate. LCP-critical art migration to `next/image` (`priority` on hero/lobby art) remains open — it changes the image-optimization pipeline on the OpenNext/Cloudflare deploy and needs its own pass.
- **Space reservation (§3.1 P0/S) verified 2026-10-13.** The in-game surface already reserves its inserts: the board carries `aspect-ratio: 1/1` with committed `useStableBoardBox` sizing and a pinned `--board-area-h`; `.player-row` reserves 56px (48px on the mobile breakpoint) for the turn dice; the win overlay is `position: fixed` and the match footer (chat composer, emote tray, power strip) is `position: absolute`; emote floats are `position: absolute`. One latent gap closed: `.ludo-dice-container` is now pinned to 48×48 in CSS instead of depending on the unlayered reset (G2) neutralizing the component's Tailwind `p-4` — the plan's own deferred reset-layering change would have restored that padding, inflated the box to 80px, and reopened a ~24px row shift on every turn change.
- **Safe areas (§3.2 P0/S) verified + unified 2026-10-13.** `viewportFit: 'cover'` is set (`app/layout.tsx`); the footer nav pads with the JS-clamped `--safe-bottom`; the game top bar and every overlay panel consume `env(safe-area-inset-top)`; keyboard-open scroll regions already add the inset. The gap was consistency: `.match-footer`, `.match-footer-chat`, `.board-sheet`, `.match-stats-overlay` and the keyboard-open scroll padding consumed **raw** `env(safe-area-inset-bottom)` — the exact value FrameProvider's clamp exists to neutralize (empty host-webview toolbars report 80–200px; real home indicators are ≤ 48px). All five now consume the clamped `--safe-bottom` token, so one policy governs every fixed-bottom surface. Real-device verification in a Farcaster frame is logged in `UNPARK_CHECKLIST.md` (no hardware here).
