# Ludo Base — UI Design Audit & Theme Consistency Plan

| | |
|---|---|
| **Date** | 2026-10-13 |
| **Scope** | Full UI: themes Retro-Futurism (default, dark) + Daybreak (light), `app/globals.css`, `app/components/**`, `app/page.tsx`, `design-system/**`, `DESIGN.md` |
| **Method** | Static audit (tokens, utility usage, contrast math) + architecture review |
| **Status** | In progress (2026-10-15) — Phases 0–3 landed (reset layering, token layer, JS-theming removal, baselines); Phase 1.1/2.6 gates re-run green; Phase 4 groups landing per branch. Live tracker: `UI_AUDIT_TRACKER.md` |
| **Companion** | `UI_COMPONENT_AUDIT.md` — buttons, chips, switches, type/radius/icon/motion scales, states & a11y semantics (execute alongside; its Phase A/B build on the Phase 2 token layer here) |

---

## 1. Executive summary

The app ships two themes that both *work*, but they are built on **three competing theming mechanisms**, and the light theme is retrofitted as a **558-rule CSS patch layer** instead of a first-class token set.

Measured state:

- **`app/globals.css` is 11,775 lines.** 558 rules target `body.theme-daybreak`, using 239 `:is()` selectors, most of them repeating the same 22-class panel-scope list verbatim.
- **Token adoption is ~0%.** The Tailwind `@theme` mapping (`text-ludo-*`, `bg-ludo-*`, `app/globals.css:11-28`) has **zero** consumers. Instead components hardcode dark-first palette utilities: **771 `text-white`**, **519 `bg-white/*`**, **356 `border-white/*`**, **632 `cyan-xxx`** across 44 of 92 component files.
- **A global `* { margin: 0; padding: 0 }` reset** (`app/globals.css:585-591`) is unlayered, so it beats Tailwind v4's layered utilities app-wide and zeroes every spacing utility. The workaround is **22 "scoped spacing repair" sections** re-asserting hundreds of utility classes by hand, per panel scope.
- **Four components bypass CSS and re-implement theming in JS** (`useIsDaybreak()` + `MutationObserver`, `GamePanelShell.tsx:18`) with inline hex values that diverge from the CSS tokens.

Net effect: every new Tailwind color utility needs a new Daybreak override, every new panel scope must be hand-added to ~10 selector lists, and panel chrome (JS-styled) can drift from panel content (CSS-styled). The fix is a single semantic token layer plus a mechanical, visual-parity-safe migration.

**Recommended plan:** Phase 0 baselines → Phase 1 five low-risk quick wins → Phase 2 token layer → Phase 3 kill JS theming → Phase 4 panel-by-panel migration (patch layer shrinks to zero) → Phase 5 typography/chrome → Phase 6 docs + CI guard → Phase 7 verification sign-off.

---

## 2. Current state inventory

### 2.1 The two themes, token by token

| Role | Retro-Futurism (default, dark) | Daybreak (light) |
|---|---|---|
| Declared at | `body.theme-retro-futurism` (`globals.css:1116-1147`) | `body.theme-daybreak` (`globals.css:103-122`) + 558-rule patch layer |
| Page bg | `#0F0F23` | `#e6e8ec` |
| Panel surface | `--panel-bg: rgba(15,15,35,0.9)` | `--panel-bg: rgba(255,255,255,0.88)` |
| Panel border | `rgba(124,58,237,0.35)` (violet rim) | `rgba(255,255,255,0.9)` + soft shadow |
| Primary ink | `#E2E8F0` | `#0f172a` |
| Muted ink | `#94A3B8` | `#475569` |
| Faint ink | `#475569` | `#94a3b8` |
| Accent | cyan-400 `#22D3EE` (panel border violet) | `#0e7490` (deepened cyan) |
| Display font | Russo One, uppercase, +0.05em | Inter Tight, sentence case, -0.02em (`!important`, `globals.css:163-169`) |
| Body font | Chakra Petch | Inter (default stack) |
| Signature effects | Scanlines (`::before`, `globals.css:1169-1182`), boot dots, violet rim light | Porcelain frost, holo-tick selected state, softer radii (26px/18px remap) |
| Lobby photo | `cyberpunk_bg.png` @ 0.55 | `pastel_bg.png` @ 0.3 |

Theme selection: cookie `ludo-theme` (`retro` default; legacy `light`/`porcelain` → Daybreak). Applied **server-side** in `app/layout.tsx:56-67` — no flash-of-wrong-theme. Legacy cookie migration lives in `hooks/usePreferences.ts:80-84`.

### 2.2 The three theming mechanisms

1. **CSS variables (the intended system).** `:root` defaults (`globals.css:30-98`), per-theme overrides, `@theme` mapping to Tailwind utilities. Used correctly by the board surface (`Board.tsx`, `BoardGrid.tsx` via `var(--ludo-*)`) and by chrome that reads `var(--nav-active-bg)` (`FooterNavPanel.tsx:124-130`).
2. **The Daybreak patch layer.** Unlayered `body.theme-daybreak ...` rules that remap dark-theme utility classes (`text-white`, `bg-white/10`, `border-white/10`, `text-cyan-400`, `placeholder:text-white/25`, …) to light values **inside panel scopes** (`globals.css:321-370` and 550+ more). Deliberate design decision, documented at `globals.css:321-326` — but it scales linearly with utility usage.
3. **JS runtime theming.** `useIsDaybreak()` (`GamePanelShell.tsx:17-32`) observes `body.classList` and feeds inline style ternaries. Imported by 4 components: `GamePanelShell`, `BurnPanel`, `BurnFeed`, `ChipsWalletPanel`. Values (`#0A0B0D` / `#F7F8FC`) diverge from CSS tokens (`#0f172a` / `#ffffff`).

### 2.3 Measured evidence

| Metric | Value | Where |
|---|---|---|
| `globals.css` lines | 10,556 (re-measured 2026-10-15) | — |
| `body.theme-daybreak` rules | 522 (re-measured 2026-10-15) | `app/globals.css` |
| `:is()` selectors | 239 | `app/globals.css` |
| Repeated scope lists (23-class) | ~30 | `globals.css:138-142, 327-370` |
| Scoped spacing-repair sections | 22 | lines 209, 281, 593, 664, 689, 720, 748, 785, 817, 845, 861, 877, 902, 934, 963, 983, 1009, 1036, 1046, 4590, 4595, 4600 |
| `text-white` occurrences | 771 (44 files) | `app/components/**` |
| `bg-white/N` + `bg-white/[0.0x]` | 415 + 104 | `app/components/**` |
| `border-white/N` | 356 | `app/components/**` |
| `cyan-xxx` utility classes | 632 | `app/components/**` |
| `@theme` token utilities consumed | **0** | `app/**/*.tsx` |
| Raw `var(--ludo-*)` / `var(--panel-*)` in TSX | 36 / 42 | mostly board + wrappers |
| Components importing `useIsDaybreak` | 0 (three doc comments only; Phase 3 landed) | `GamePanelShell`, `BurnPanel`, `BurnFeed`, `ChipsWalletPanel` |
| `prefers-reduced-motion` blocks | 4 | `app/globals.css` |
| Theme-setting entry points | 4 | `SettingsPanel.tsx:556-563`, `FirstRunSetupPanel.tsx:97`, `ThemeNudge.tsx`, `MarketplacePanel.tsx:463-473` |
| Dead `ThemeSwitcher.tsx` importers | 0 | safe to delete |

---

## 3. Findings

Severity: **P0** = structural/maintainability, **P1** = user-visible consistency or a11y, **P2** = polish.

### P0-1 — Token system exists but is unused
`@theme` (`globals.css:11-28`) maps `--ludo-*` variables to Tailwind utilities, yet **no component uses a single one**. All color decisions are hardcoded dark-first utilities. The light theme therefore cannot be derived — it can only be patched.
*Fix: Phases 2 + 4.*

### P0-2 — Daybreak is a patch layer, not a theme
558 unlayered override rules; most repeat a 23-class `:is()` scope list (`globals.css:327-370`). Each rule is ~1.2 KB of near-duplicate selectors. Consequences:
- New Tailwind color utility anywhere → invisible-in-Daybreak until a rule is added.
- New panel scope → must be hand-added to ~10 lists or it silently renders dark-only.
- Coverage is already inconsistent: `ludo-mission-scope` has **0** Daybreak rules (works only because `MissionPanel.tsx:229` also carries `ludo-arena-scope`); `ludo-stats-scope` survives on hand-written match-stats rules only (`globals.css:4485-4498`).
*Fix: Phase 4 (rules deleted as panels migrate).*

### P0-3 — JS theming forks the system
Four components restyle via `MutationObserver` + inline ternaries with hex values that match neither theme's tokens. Panel chrome (JS) and panel content (CSS) can disagree; four observers watch `body.classList` forever.
*Fix: Phase 3.*

### P0-4 — Unlayered reset zeroes Tailwind spacing
`* { margin: 0; padding: 0 }` (`globals.css:585-591`) sits outside `@layer base`, so it outranks Tailwind v4's layered utilities everywhere. The app compensates with 22 hand-written "scoped spacing repair" sections (hundreds of duplicate utility re-assertions, e.g. `globals.css:597-662` for marketplace alone).
*Fix: Phase 1.2 (one `@layer base` wrapper, then delete all repairs).*

### P1-5 — Typography voice conflicts between themes
Retro: Russo One, `text-transform: uppercase`, +0.05em (`globals.css:1150-1158`). Daybreak: Inter Tight, `text-transform: none !important` (`globals.css:163-169`) — **but** component chrome labels use raw `uppercase` utilities (e.g. `PanelTabs.tsx:39`: `text-[10px] font-black uppercase tracking-[0.2em]`, in **22 files**) which stay uppercase in *both* themes. Result: Daybreak headings are sentence-case while every tab, chip and section label is SHOUTED — two typographic voices inside one theme.
*Fix: Phase 5 (`.label-chrome` class, per-theme case + tracking).*

### P1-6 — Daybreak accent fails WCAG AA on the page background
`#0e7490` on `#e6e8ec` = **4.37:1** (< 4.5 required for small text). Footer/header accents sit on the gray page background, not white panels. Fix value: **`#0d6d87`** → 4.82:1 on `#e6e8ec`, 5.91:1 on white panels. (30 hex + 21 rgb-triplet occurrences to update, all in `globals.css`.)
*Fix: Phase 1.1.*

### P1-7 — Type floor violations
`DESIGN.md` sets a 10px floor, but: diagnostic chips are **6px** (`globals.css:255-262`), `TabCount` is 9px (`PanelTabs.tsx:87`), and 10px `font-black uppercase tracking-widest` chrome is pervasive. 6px text is unreadable on any device.
*Fix: Phase 1.3.*

### P1-8 — Four entry points to one setting
Settings, FirstRunSetup, ThemeNudge, and Marketplace equip all write `ludo-theme`; `ThemeSwitcher.tsx` is a fifth, dead copy (0 importers).
*Fix: Phase 1.4 (delete the dead copy; keep Settings as the single home).*

### P2-9 — Design docs have drifted from the product
- `design-system/ludo-base/MASTER.md` describes an Orbitron/Exo-2 purple-rose cyberpunk palette (`#7C3AED`/`#F43F5E`) matching **neither** theme.
- `DESIGN.md` documents accent cyan `#00E5FF`; the real accents are cyan-400 `#22D3EE` (Retro) and `#0e7490` (Daybreak), and Retro's signature rim is violet.
*Fix: Phase 6.*

### P2-10 — Motion discipline
Only 4 `prefers-reduced-motion` blocks cover dozens of animations (orb drift, scanlines, `pulse 1s infinite` diagnostics at `globals.css:264`, framer-motion nav springs). `DESIGN.md` asks for "one clear moment over constant pulse".
*Fix: Phase 1.5.*

### P2-11 — Dead tokens
`--panel-shadow`, `--panel-blur`, `--panel-border` (defined `globals.css:1136-1138`, Daybreak lacks them) and most `--modal-*` tokens are unread since `GamePanelShell` went inline-styled.
*Fix: Phases 2.1 + 3.1 (either adopted by the new token set or removed).*

### P2-12 — Focus-ring inconsistency
A solid global `button:focus-visible` ring exists (`globals.css:6695-6704`) — keep it. But per-component rings vary (some add `ring-cyan-400/60`, some static `ring-1`, most none), producing three focus visuals.
*Fix: Phase 5.4.*


---

## 4. Contrast & accessibility audit

Ratios computed against the **page background** (worst case) and the **panel surface** (typical). AA thresholds: 4.5:1 normal text, 3:1 large text/UI.

| Theme | Pair | Ratio | Verdict |
|---|---|---|---|
| Retro | `#E2E8F0` on `#0F0F23` | 15.31:1 | Pass |
| Retro | `#94A3B8` muted on panel `#12122b` | 7.14:1 | Pass |
| Retro | `#22D3EE` cyan on panel | 10.13:1 | Pass |
| Retro | `#475569` faint on `#0F0F23` | 2.49:1 | Decorative only — never body text |
| Retro | `#E2E8F0` on path `#334155` (board) | 8.40:1 | Pass |
| Daybreak | `#0f172a` on `#e6e8ec` | 14.55:1 | Pass |
| Daybreak | `#475569` muted on white panel | 7.58:1 | Pass |
| Daybreak | `#0e7490` accent on `#e6e8ec` | **4.37:1** | **FAIL (small text)** |
| Daybreak | `#0d6d87` accent (proposed) on `#e6e8ec` | 4.82:1 | Pass |
| Daybreak | `#0d6d87` accent (proposed) on white | 5.91:1 | Pass |
| Daybreak | `#94a3b8` faint on `#e6e8ec` | 2.09:1 | Decorative only |
| Daybreak | white/40-mapped ink (~`#a2a6b2`) on white | 2.43:1 | Decorative/hints only — do not use for required labels |

**Actions:** deepen the Daybreak accent to `#0d6d87` (Phase 1.1); document faint inks as decorative; never place required text on the white/40-mapped ink.

**Correction (2026-10-13, found while implementing 1.1):** the three Daybreak status values proposed in §5.2 **fail AA on the page background** when actually measured — `#b45309` 4.09:1, `#15803d` 4.09:1, `#dc2626` 3.94:1 (all < 4.5). Phase 2 must ship `#92400e` (5.78:1), `#166534` (5.81:1) and `#b91c1c` (5.27:1) instead. The gate is `node scripts/contrast.mjs --pairs` (15 pairs, added with 1.1) — run it after any token change.

**Gate re-run 2026-10-15 (V-3):** `node scripts/contrast.mjs --pairs` → **15/15 green**. Daybreak: `#0d6d87` 4.82:1 on `#e6e8ec` / 5.91:1 on white; `#92400e` 5.78:1; `#166534` 5.81:1; `#b91c1c` 5.27:1. Retro pairs 6.62–15.31:1. The corrected status tokens are live at `globals.css:283-285`. Output recorded in `UI_AUDIT_TRACKER.md` §3.

---

## 5. Target architecture

### 5.1 Semantic token set

Introduce one semantic layer on top of the existing `--ludo-*` variables. Retro keeps its values; Daybreak gets real values (not patches). All values below reproduce the current look exactly — Phase 2 is visually neutral.

```css
/* ─── Semantic UI tokens (both themes define these) ─── */
:root {
  --surface-page: var(--ludo-bg);            /* app background            */
  --surface-panel: var(--panel-bg);          /* sandwich panels / sheets  */
  --surface-recessed: rgba(255,255,255,0.06);/* rows, wells, inset tiles  */
  --surface-hover: rgba(255,255,255,0.10);   /* hover fill                */
  --surface-active: rgba(255,255,255,0.14);  /* pressed/selected fill     */
  --ink-strong: #ffffff;                     /* primary ink               */
  --ink-muted: rgba(255,255,255,0.60);       /* secondary ink             */
  --ink-faint: rgba(255,255,255,0.40);       /* hints, decorative         */
  --line-soft: rgba(255,255,255,0.10);       /* hairline borders          */
  --line-strong: rgba(255,255,255,0.25);
  --accent: #22d3ee;                         /* brand accent              */
  --accent-soft: rgba(34,211,238,0.15);      /* accent wash / chip fill   */
  --accent-ink: #06282f;                     /* text on accent fill       */
  --shadow-panel: 0 24px 60px -12px rgba(0,0,0,0.55);
  --radius-card: 16px;  --radius-chip: 12px;
}
body.theme-daybreak {
  --surface-page: #e6e8ec;
  --surface-panel: rgba(255,255,255,0.88);
  --surface-recessed: rgba(23,23,23,0.05);
  --surface-hover: #f1f5f9;
  --surface-active: rgba(23,23,23,0.12);
  --ink-strong: #0f172a;
  --ink-muted: rgba(15,23,42,0.62);
  --ink-faint: rgba(15,23,42,0.42);
  --line-soft: rgba(15,23,42,0.12);
  --line-strong: rgba(15,23,42,0.24);
  --accent: #0d6d87;                         /* AA-safe on #e6e8ec */
  --accent-soft: rgba(13,109,135,0.12);
  --accent-ink: #ffffff;
  --shadow-panel: 0 24px 60px -12px rgba(15,23,42,0.22);
  --radius-card: 18px;  --radius-chip: 12px;
}
```

Then register them as Tailwind v4 utilities (append to the existing `@theme` block, `globals.css:11-28`):

```css
@theme {
  --color-surface-page: var(--surface-page);
  --color-surface-panel: var(--surface-panel);
  --color-surface-recessed: var(--surface-recessed);
  --color-surface-hover: var(--surface-hover);
  --color-surface-active: var(--surface-active);
  --color-ink-strong: var(--ink-strong);
  --color-ink-muted: var(--ink-muted);
  --color-ink-faint: var(--ink-faint);
  --color-line-soft: var(--line-soft);
  --color-line-strong: var(--line-strong);
  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
  --color-accent-ink: var(--accent-ink);
}
```

This makes `bg-surface-panel`, `text-ink-muted`, `border-line-soft`, `text-accent`, `bg-accent-soft`, `text-accent-ink` available everywhere and **theme-reactive with zero JS and zero patch rules**.

### 5.2 Utility migration mapping (the codemod table)

Apply mechanically, per panel (Phase 4). Every left-hand class is already remapped by the Daybreak patch layer, so converting is **visual-parity-safe** — the patch rule for that class can be deleted once its last consumer converts.

| Old utility (dark-first) | New token utility | Retro resolves to | Daybreak resolves to |
|---|---|---|---|
| `text-white` | `text-ink-strong` | `#ffffff` | `#0f172a` |
| `text-white/90`…`text-white/70` | `text-ink-muted` | `rgba(255,255,255,.60)` | `rgba(15,23,42,.62)` |
| `text-white/60`…`text-white/10` | `text-ink-faint` | `rgba(255,255,255,.40)` | `rgba(15,23,42,.42)` |
| `hover:text-white/70` | `hover:text-ink-strong` | — | — |
| `bg-white/[0.04]`, `bg-white/5` | `bg-surface-recessed` | `rgba(255,255,255,.06)` | `rgba(23,23,23,.05)` |
| `bg-white/10`, `bg-white/[0.07]` | `bg-surface-hover` | `rgba(255,255,255,.10)` | `#f1f5f9` |
| `bg-white/15`…`bg-white/30` | `bg-surface-active` | `rgba(255,255,255,.14)` | `rgba(23,23,23,.12)` |
| `bg-black/40`…`bg-black/60` | `bg-black/40` (keep — theme-neutral scrim) | same | same |
| `border-white/5`…`border-white/40` | `border-line-soft` | `rgba(255,255,255,.10)` | `rgba(15,23,42,.12)` |
| `divide-white/5` | `divide-line-soft` | same | same |
| `ring-white/10` | `ring-line-soft` | same | same |
| `text-cyan-300`…`text-cyan-400` | `text-accent` | `#22d3ee` | `#0d6d87` |
| `text-cyan-300/60`, `text-cyan-400/80` | `text-accent/80` | — | — |
| `bg-cyan-500/20`, `bg-cyan-400/20` | `bg-accent-soft` | `rgba(34,211,238,.15)` | `rgba(13,109,135,.12)` |
| `text-cyan-100`…`text-cyan-200` on accent fill | `text-accent-ink` | `#06282f` | `#ffffff` |
| `border-cyan-400/40`, `border-cyan-500/30` | `border-accent/40` | — | — |
| `text-amber-300`…`text-amber-500`, `text-yellow-*` | `text-warn` (new token: `#fbbf24` / `#b45309`) | — | — |
| `text-green-*`, `text-emerald-400` | `text-positive` (`#4ade80` / `#15803d`) | — | — |
| `text-red-*` | `text-negative` (`#f87171` / `#dc2626`) | — | — |

Status semantic tokens (`--warn/--positive/--negative` + `--color-*` registrations) are added in Phase 2 alongside §5.1 — the Daybreak patch layer already maps these three families (globals.css:359-365), so parity holds.

### 5.3 Typography contract

One class, two voices:

```css
.label-chrome { /* tabs, chips, eyebrows, section labels */
  font-family: var(--font-body);
  font-size: 10px;            /* floor */
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
body.theme-daybreak .label-chrome {
  font-family: var(--font-inter-tight), system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-transform: none;       /* Porcelain speaks sentence-case */
  font-weight: 700;
}
```

Replaces the 22-file `text-[10px] font-black uppercase tracking-[0.2em]` pattern (Phase 5.1). Headings drop the `!important` Daybreak override (`globals.css:163-169`) in favour of a per-theme `--font-display` variable consumed by a `.display` utility, so both themes own their heading voice through tokens.


---

## 6. Phased execution checklist

Conventions: each phase is one branch + one PR. Every phase ends with `npm run lint`, `npx tsc -p tsconfig.json --noEmit`, and a two-theme visual pass. Phases 1.1/1.3/1.4/1.5 are independent; 1.2 must land alone (large diff). Phase 4 is the long pole — split one PR per panel group.

### Phase 0 — Baseline & guardrails (do first, ~0.5 day)

**Goal:** be able to prove "no visual change" for every later phase.

- [ ] 0.1 `npm run dev` (the only reliable dev command — Turbopack).
- [ ] 0.2 Capture baseline screenshots, per theme (Settings → Appearance → Retro / Daybreak):
  - [ ] Lobby (default), Lobby (short viewport ≤700px height)
  - [ ] Board mid-match, Board with ActionDice open
  - [ ] Each sandwich panel: Friends, Leaderboard, Mission, Arena, Market, Settings, Messages, Wallet, Profile, Rankings
  - [ ] Modals/sheets: GuestWall, PublicProfile, TeamUp, QuickMatch, HostMigration, OfflineMatch, Burn, MatchStats, Splash, Quit
  - [ ] Viewports: 375px and 1440px wide
  - [ ] Save to `docs/design/baseline/<theme>/<surface>@<width>.png` (gitignored artifacts are fine; keep locally for diffing).
- [ ] 0.3 Tag the baseline: `git tag ui-baseline-2026-10-13` (or note the SHA in the PR description).
- [ ] 0.4 One commit per phase from here on; never mix a quick win with a migration PR.

**Acceptance:** a named SHA exists whose screenshots every later phase is diffed against.

### Phase 1 — Quick wins (low risk, ~1.5 days total)

#### 1.1 Deepen the Daybreak accent to `#0d6d87` (fixes P1-6)

- [x] 1.1.1 Count first: `grep -c "#0e7490" app/globals.css` (expect 30) and `grep -c "14, 116, 144" app/globals.css` (expect 21).
- [x] 1.1.2 Replace both forms **globally in `app/globals.css` only** (these hexes are patch-layer-only; verify with `grep -rnE "#0e7490|14, 116, 144" app --include="*.tsx" app --include="*.ts"` → must be 0 before editing; note: use `-E`, BSD `grep` on macOS silently fails on `\|` alternation):
  ```bash
  sed -i '' 's/#0e7490/#0d6d87/g; s/14, 116, 144/13, 109, 135/g' app/globals.css
  ```
  (Linux CI: `sed -i 's/#0e7490/#0d6d87/g; s/14, 116, 144/13, 109, 135/g' app/globals.css`)
- [x] 1.1.3 Verify contrast with the script in Appendix C: `#0d6d87` on `#e6e8ec` must be ≥ 4.5. **Re-run 2026-10-15: `node scripts/contrast.mjs --pairs` → 15/15 pairs green** (see Correction note below for the recorded output).
- [x] 1.1.4 Visual pass: footer nav active icon/label, header pills, tab underlines, buttons — Daybreak only. Retro untouched. **Evidence 2026-10-15:** Daybreak is covered by the committed visual baselines (`panel-*`, `lobby`, `board`, `burn` × Daybreak) via `npm run visual:diff`; a human one-time walk is still advised before the final sign-off.

**Acceptance:** accent pairs ≥ 4.5:1 on the page bg; zero unintended hue shifts (same sed, single commit).

**Rollback:** `git revert` the one commit.

#### 1.2 Fix the reset, delete all spacing repairs (fixes P0-4)

- [x] 1.2.1 Wrap the reset in `@layer base` at `globals.css:584-591`:
  ```css
  /* ─── Step 2: Base styles ─── */
  @layer base {
    *,
    *::before,
    *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
  }
  ```
- [x] 1.2.2 Run dev and walk every panel in **both themes**: all padding/margin utilities must now come from Tailwind itself. Diff against Phase 0 screenshots. Fix any *genuine* layout bug this exposes (there may be a few places that quietly relied on zeroed spacing) before continuing.
- [x] 1.2.3 Delete all 22 repair sections. They start at lines 209, 281, 593, 664, 689, 720, 748, 785, 817, 845, 861, 877, 902, 934, 963, 983, 1009, 1036, 1046, 4590, 4595, 4600 — each runs until the next `/* ───` banner or blank-line-separated unrelated rule. Locate programmatically: `grep -n "Scoped spacing repair" app/globals.css`. Delete section-by-section, reloading the affected panel after each.
- [x] 1.2.4 Also delete the inline lobby-scope utility re-assertions that are *not* under a "Scoped spacing repair" banner (the bare `.ludo-lobby-scope .p-2 { … }` runs at 211-225, 272-310 and `.ludo-broadcast-scope .px-6 { … }` at 292-295) — same landmine, same fix.
- [x] 1.2.5 Re-walk every panel in both themes; diff screenshots again.

**Acceptance:** `grep -c "Scoped spacing repair" app/globals.css` → 0; spacing identical to baseline; `globals.css` shrinks by ~600+ lines.

**Rollback:** single-commit revert. If layout regressions appear in 1.2.2, fix forward — do not revert to the repair approach.

#### 1.3 Raise the type floor (fixes P1-7)

- [x] 1.3.1 Diagnostic chips: `globals.css:255-262` `font-size: 6px` → `10px` (or gate the whole `.diag-chip` block behind `data-debug` if the chips are dev-only). If chips become a layout problem at 10px, hide them (`display: none`) rather than shrink them.
- [x] 1.3.2 `PanelTabs.tsx:87` `TabCount`: `text-[9px]` → `text-[10px]`.
- [x] 1.3.3 Sweep for anything smaller: `grep -rn "text-\[[0-9]px\]" app --include="*.tsx" | awk -F'text-\\[' '{print $2}' | sort -u` — anything `< 10px` is either raised or deleted.
- [x] 1.3.4 Confirm no clipped/overflowing labels at 375px after the bump (tabs are the risk).

**Acceptance:** no rendered text under 10px anywhere; no layout regressions.

#### 1.4 Delete the dead theme switcher (fixes P1-8)

- [x] 1.4.1 `grep -rln "ThemeSwitcher" app --include="*.tsx"` → must list only `ThemeSwitcher.tsx` itself (re-verified 0 importers 2026-10-13, incl. dynamic + string refs).
- [x] 1.4.2 Delete `app/components/ThemeSwitcher.tsx`. **Done 2026-10-13** (49 lines, one `usePreferences` import; theming is the REA-07 cookie store).
- [x] 1.4.3 Add a code comment in `SettingsPanel.tsx` near the Appearance section marking it as the single theme entry point, so the next person does not grow a fifth. **Done** — `SettingsPanel.tsx` above the Appearance `<section>`, citing 1.4.3 and naming the three write-only touchpoints (FirstRunSetup, ThemeNudge, Marketplace).

**Acceptance:** exactly one user-reachable theme control (Settings → Appearance); onboarding/nudge/marketplace write the same preference but are intentional touchpoints, not competing UIs.

#### 1.5 Motion discipline (fixes P2-10)

- [x] 1.5.1 Wrap all decorative animation in the existing `prefers-reduced-motion` blocks — orbs (`drift-orb`), scanlines, ticker, `pulse` — so `reduce` stops them entirely (a static gradient/scanline image is fine, animation is not).
- [x] 1.5.2 Replace `animation: pulse 1s infinite` on `.diag-status-warn` with a single 3-flash keyframe or static amber.
- [x] 1.5.3 framer-motion: wrap the app in `<MotionConfig reducedMotion="user">` in `app/Providers.tsx` so nav springs (`layoutId="active-nav-bg"`, FooterNavPanel) respect the OS setting.
- [x] 1.5.4 Verify: macOS System Settings → Accessibility → Display → Reduce Motion, walk lobby + a panel open/close. **Automated 2026-10-13 (bd6ca99): `scripts/check-reduced-motion.mjs` (`npm run check:reduce-motion`) drives the guest flow and asserts zero animations under `reduce` AND motion under `no-preference`; validated both ways. Documented blind spot: GSAP canvas work and canvas-confetti are not in the animation registry.**

**Acceptance:** with Reduce Motion on, nothing loops; theme and layout unchanged.

### Phase 2 — Semantic token layer (visually neutral, ~1 day)

- [x] 2.1 Add the §5.1 token block to `globals.css` immediately after the existing `:root` panel-shell variables (`globals.css:93-98`), plus the `--warn/--positive/--negative` status tokens:
  ```css
  :root {
    --warn: #fbbf24;  --positive: #4ade80;  --negative: #f87171;
  }
  body.theme-daybreak {
    --warn: #b45309;  --positive: #15803d;  --negative: #dc2626;
  }
  ```
- [x] 2.2 Append the §5.1 `@theme` registrations **into** the existing `@theme` block (`globals.css:11-28`) — including `--color-warn/positive/negative`. Do not create a second `@theme`.
- [x] 2.3 Fix the duplicate key already in `@theme` (`--color-ludo-blue` is declared twice, lines 16-17 and 20-21 — keep one).
- [x] 2.4 Verify tokens resolve: dev server, then in the browser console:
  ```js
  getComputedStyle(document.body).getPropertyValue('--surface-panel');
  ```
  must return the panel value in both themes (toggle and re-read).
- [x] 2.5 Smoke-test one utility end-to-end on a scratch branch: change any element to `bg-surface-recessed text-ink-muted` and confirm it flips with the theme. Revert the scratch edit.
- [x] 2.6 `npm run lint` + `npx tsc -p tsconfig.json --noEmit` (no component changed, but CSS typos surface here only via build — also run `npm run build` once). **Re-run 2026-10-15: lint clean, tsc 0 errors (after fixing a build break traced to wallet-sheet conversions — see `UI_AUDIT_TRACKER.md` §3). `npm run build` could not run in this sandbox: the IDE's fs broker rejects Next's `.next` mkdir/unlink patterns (two distinct shim errors, both environmental); CI runs the build gate on push as the repo already assumes.**

**Acceptance:** all 16 utilities exist and are theme-reactive; no visual diff vs baseline (this phase touches CSS variables only, and their values equal today's resolved values).

**Rollback:** single commit revert; nothing consumes the tokens yet.

### Phase 3 — Kill JS theming (fixes P0-3, ~0.5 day)

- [x] 3.1 Add `--panel-border` + `--panel-shadow` to the Daybreak block (Retro already has them at `globals.css:1136-1138`); values: border `rgba(15,23,42,0.12)`, shadow `0 24px 60px -12px rgba(15,23,42,0.22)` — matching the patch-layer shell rule (`globals.css:352`).
- [x] 3.2 `GamePanelShell.tsx`: delete `useIsDaybreak` and the ternaries (lines 17-32, 44, 48-53, 70-72, 88, 94). Replace with:
  ```tsx
  style={{
    background: "var(--panel-bg)",
    border: "1px solid var(--panel-border)",
    boxShadow: "var(--panel-shadow)",
    color: "var(--ink-strong)",
    backdropFilter: "blur(32px)",
    WebkitBackdropFilter: "blur(32px)",
  }}
  ```
  and the grabber/divider colors → `var(--line-strong)` / `var(--line-soft)`.
- [x] 3.3 `BurnPanel.tsx`, `BurnFeed.tsx`, `ChipsWalletPanel.tsx`: same conversion — remove the `useIsDaybreak` import/call, swap every inline ternary for the §5.1 token `var()` (or the new token utilities if the value lives in `className`).
- [x] 3.4 Delete the `useIsDaybreak` export; confirm `grep -rn "useIsDaybreak" app` → 0.
- [x] 3.5 Perf check: no MutationObserver on `body.classList` remains (`grep -rn "attributeFilter" app` → 0 in these files). Theme toggles now update panels instantly via CSS — verify mid-panel.
- [x] 3.6 Two-theme visual diff for all four surfaces (shell, burn panel, burn feed, chips wallet), including the panel-opening animation.

**Acceptance:** zero JS theme branching; chrome/content drift impossible; diff clean.

**Rollback:** single commit revert.


### Phase 4 — Panel-by-panel token migration (fixes P0-1 + P0-2)

**The invariant that makes this safe:** every old utility in §5.2 is already remapped by the Daybreak patch layer *today*. Converting a panel therefore cannot change either theme's appearance — the new token simply resolves to the value the patch layer was already painting. After converting, delete the patch rules whose every consumer has converted. The patch layer shrinks monotonically to zero.

**The rule while migrating:** never add a new class to the Daybreak `:is()` lists. If a panel needs a value the patch layer lacks, it uses a token.

#### 4.0 The codemod

Write `scripts/codemod-ui-tokens.mjs` — a conservative, review-friendly string-replacement over `className` string literals and `class`/`className` template expressions. Run it on one file at a time; review every hunk with `git diff -w`:

```js
// scripts/codemod-ui-tokens.mjs — run: node scripts/codemod-ui-tokens.mjs <file.tsx> [--write]
import { readFileSync, writeFileSync } from "node:fs";
const MAP = [
  [/\btext-white\/90\b|\btext-white\/80\b|\btext-white\/75\b|\btext-white\/70\b/g, "text-ink-muted"],
  [/\btext-white\/60\b|\btext-white\/55\b|\btext-white\/50\b|\btext-white\/45\b|\btext-white\/40\b/g, "text-ink-faint"],
  [/\btext-white\/35\b|\btext-white\/30\b|\btext-white\/25\b|\btext-white\/20\b|\btext-white\/10\b/g, "text-ink-faint"],
  [/\btext-white\b/g, "text-ink-strong"],
  [/\bhover:text-white\/70\b|\bhover:text-white\/60\b/g, "hover:text-ink-strong"],
  [/\bbg-white\/\[0\.04\]\b|\bbg-white\/\[0\.07\]\b|\bbg-white\/5\b/g, "bg-surface-recessed"],
  [/\bbg-white\/10\b/g, "bg-surface-hover"],
  [/\bbg-white\/15\b|\bbg-white\/20\b|\bbg-white\/25\b|\bbg-white\/30\b/g, "bg-surface-active"],
  [/\bborder-white\/5\b|\bborder-white\/10\b|\bborder-white\/15\b|\bborder-white\/20\b|\bborder-white\/25\b|\bborder-white\/30\b|\bborder-white\/40\b/g, "border-line-soft"],
  [/\bdivide-white\/5\b/g, "divide-line-soft"],
  [/\bring-white\/10\b/g, "ring-line-soft"],
  [/\btext-cyan-300\b|\btext-cyan-400\b/g, "text-accent"],
  [/\bbg-cyan-500\/20\b|\bbg-cyan-400\/20\b|\bbg-cyan-500\/15\b/g, "bg-accent-soft"],
  [/\btext-amber-300\b|\btext-amber-400\b|\btext-amber-500\b|\btext-yellow-300\b|\btext-yellow-400\b|\btext-yellow-500\b/g, "text-warn"],
  [/\btext-green-200\b|\btext-green-300\b|\btext-green-400\b|\btext-green-500\b|\btext-emerald-400\b/g, "text-positive"],
  [/\btext-red-300\b|\btext-red-400\b|\btext-red-500\b/g, "text-negative"],
];
const f = process.argv[2];
let src = readFileSync(f, "utf8");
for (const [re, to] of MAP) src = src.replace(re, to);
if (process.argv.includes("--write")) writeFileSync(f, src);
else console.log(src);
```

Guardrails:
- The codemod must not touch strings that are not class names. Restrict replacements to inside `className="…"`, `` className={`…`} ``, and `class="…"` by processing only quoted/template segments — review each diff before `--write`.
- Classes that are **identical in both themes** (`bg-black/40`, board pastels `--ludo-base-*`, `var(--ludo-*)` board colors) stay as-is. Do not convert the board.
- Anything the codemod can't map (one-off hexes, `style={{…}}` inline colors) is converted by hand in the same PR.

#### 4.1 Migration groups (one PR each, in this order)

Order is by risk: shell → wallet → social → progression → lobby/chrome last (highest visibility).

| # | Group | Files (primary) | Scope classes freed |
|---|---|---|---|
| 1 | Panel shell | `GamePanelShell.tsx` (+ anything only it owns) | — |
| 2 | Wallet cluster | `BurnPanel`, `BurnFeed`, `ChipsWalletPanel`, `WalletPanel`, `WalletShell`, `WalletDetailsSheet`, `LudoWalletModal`, `SwapSheet`, `SendNativeSheet`, `SendTokenSheet`, `ReceiveSheet`, `WalletActivityList`, `WalletSecurityPanel`, `WalletLinkPanel`, `WcWalletPanel`, `InGameWalletPanel`, `WalletConnectCard` | `ludo-wallet-scope`, `ludo-burn-scope`, `ludo-walletsheet-scope` |
| 3 | Social | `FriendsPanel`, `MessagesPanel`, `RichChatField`, `InviteNotification`, `EmoteTray`, `EmojiPicker`, `PublicProfileModal`, `PlayerProfileSheet`, `UserProfilePanel` | `ludo-friends-scope`, `ludo-messages-scope`, `ludo-invite-scope`, `ludo-pubprofile-scope`, `ludo-profile-scope` |
| 4 | Progression | `Leaderboard`, `RankingsPanel`, `MissionPanel`, `ActivityFeed`, `ModeBreakdown`, `FormChart`, `MatchStatsOverlay`, `PlayerInfoRow` | `ludo-leaderboard-scope`, `ludo-rankings-scope`, `ludo-stats-scope`, `ludo-mission-scope` (via `ludo-arena-scope` today) |
| 5 | Marketplace | `MarketplacePanel`, `MerkleClaimPanel`, `BuyCryptoButton` | `ludo-market-scope` |
| 6 | Matchmaking | `ArenaPanel`, `LiveArenaDirectory`, `LiveArenaStage`, `LiveMatchmakingFeed`, `QuickMatchPanel`, `TeamUpMatchPanel`, `TeamUp/**` | `ludo-arena-scope`, `ludo-livearena-scope`, `ludo-quick-scope`, `ludo-teamup-scope` |
| 7 | Settings & onboarding | `SettingsPanel`, `OnboardingPanel`, `FirstRunSetupPanel`, `TokenStyleSwitcher`, `AudioToggle`, `GuestWall`, `SecurityLadderChip` | `ludo-settings-scope`, `ludo-onboard-scope`, `ludo-wall-scope`, `ludo-guestpill-scope` |
| 8 | Match sheets | `HostMigrationPanel`, `OfflineMatchPanel`, `Phase0aSpikePanel`, `SettlePoolButton`, `PaidPoolJoinButton` | `ludo-migrate-scope`, `ludo-offline-scope`, `ludo-idle-scope`, `ludo-quit-scope`, `ludo-splash-scope` |
| 9 | Chrome & lobby | `HeaderNavPanel`, `FooterNavPanel`, `NoticeStrip`, `ConnectionBadge`, `GameLobby`, `BoardHeaderCompact`, `SpectatorHUD`, `LandscapeGuard`, `ThemeNudge`, broadcast panels | `ludo-header-scope`, `ludo-footer-scope`, `ludo-lobby-scope`, `ludo-broadcast-scope`, `ludo-ticker-scope` |

Track status in the checklist at Appendix B.

#### 4.2 Per-group procedure

1. Branch `ui/tokens-group-<n>`.
2. Run the codemod per file with `--write`; `git diff -w` review; hand-fix leftovers.
3. `npm run lint` + `npx tsc -p tsconfig.json --noEmit`.
4. Dev-server pass: open every migrated surface in **both themes**, at 375px and 1440px; diff vs Phase 0 screenshots.
5. **Delete the dead patch rules** for the scopes freed by this group:
   - Remove the scope from every `:is()` list it appears in (`globals.css:138-142, 327-370` and all 558 rules).
   - Delete rules whose selector now matches nothing — e.g. when `text-white` is gone from the app, the `text-white → #171717` remaps are deleted even if some scopes remain (a rule only survives while its selector still occurs).
   - Keep a rule alive **only** if some un-migrated scope still needs it. When in doubt, keep the rule and note it in Appendix B.
6. Re-run `grep -c "body.theme-daybreak" app/globals.css` and record the count in the PR — it must be ≤ the previous group's.
7. Merge.

**Per-group acceptance:** two-theme diff clean; `body.theme-daybreak` rule count decreased (or explicitly unchanged with reason); no scope added to any `:is()` list.

**Rollback:** single-commit revert of the group branch — it restores both the component files and any patch rules that group deleted. Groups are independent, so a revert never corrupts another group's state.


### Phase 5 — Typography & chrome contract (fixes P1-5, P2-12)

- [ ] 5.1 Add `.label-chrome` (§5.3) to `globals.css`. Replace the `text-[10px] font-black uppercase tracking-[0.2em]` / `tracking-widest` pattern in the 22 files that use it with `label-chrome`. Suggested codemod: `s/text-\[10px\] font-black uppercase tracking-\[0\.2em\]/label-chrome/g` and the `tracking-widest` variant — review diffs; some spots may want `label-chrome` + one extra utility (e.g. a color).
- [ ] 5.2 Daybreak headings: remove the `!important` block at `globals.css:163-169`; introduce `--font-display` per theme (`Russo One` uppercase / `Inter Tight` sentence-case) and a `.display` utility (`font-family: var(--font-display)`) used by headings. Verify no heading relies on the old override (walk every panel title + section heading in both themes).
- [ ] 5.3 Retro headings keep the element-selector approach (`globals.css:1150-1158`) or also move to `.display` — pick one approach for both themes so the contract is symmetric.
- [ ] 5.4 Focus rings: keep the global `button:focus-visible` rule (`globals.css:6695-6704`); delete per-component ad-hoc rings (`focus-visible:ring-cyan-400/60` in `PanelTabs.tsx` and siblings, static `ring-1` decorations that read as focus) so exactly one focus visual exists. Exception: inputs/textareas keep their own stronger ring if any.
- [ ] 5.5 Two-theme typography pass at 375px: check Daybreak tab labels (now sentence-case, longer) do not wrap or overflow in `PanelTabs` 2/3/4-col grids; adjust `letter-spacing`/`font-size` on `.label-chrome` if they do.

**Acceptance:** one typographic voice per theme; labels never wrap at 375px; single focus-ring style.

### Phase 6 — Docs & CI guard (fixes P2-9 + prevents regression)

- [ ] 6.1 Update `DESIGN.md` to the real contract: both themes' palette tables (bg/panel/ink/accent/faint per theme), fonts per theme, the semantic token list, `.label-chrome` + `.display`, the sandwich/panel-shell rules, tap-target and 10px floor, and the "no new Daybreak override rules — use tokens" rule.
- [ ] 6.2 Replace `design-system/ludo-base/MASTER.md` with a pointer to `DESIGN.md` (or rewrite it to match the shipped themes). Its Orbitron/Exo-2 purple-rose palette matches no theme.
- [ ] 6.3 Add the CI guard — new job or a step in `.github/workflows/ci.yml` (`ui-token-guard`): fail if any file under `app/` other than `app/globals.css` matches `text-white|bg-white/|border-white/|text-cyan-|text-amber-300|text-green-400`:
  ```bash
  # scripts/check-ui-tokens.sh — diff-scoped so legacy files can migrate group by group
  FILES=$(git diff --name-only origin/main...HEAD -- 'app/**/*.tsx' | grep -v 'globals.css')
  HITS=$(grep -nE '\btext-white\b|\bbg-white/|\bborder-white/|\btext-cyan-[0-9]' $FILES || true)
  [ -z "$HITS" ] && echo "ui-token-guard: clean" || { echo "$HITS"; exit 1; }
  ```
  Ship the script under `scripts/` and call it from CI; initially it may run in warn mode (`|| true`) until Phase 4 completes, then flips to hard fail.
- [ ] 6.4 Update `AGENTS.md` UI section: point to `DESIGN.md` as the living contract and this file as the migration tracker.

**Acceptance:** docs describe the shipped system; CI fails on new hardcoded dark-first utilities once Phase 4 is done.

### Phase 7 — Verification & sign-off

- [ ] 7.1 Matrix pass: every Phase 0 surface × both themes × {375px, 768px, 1440px} × {default motion, Reduce Motion}. Diff vs baseline; every delta must be explainable by an intentional change (accent deepening, label case in Daybreak, type bumps).
- [ ] 7.2 Gates green: `npm run lint`, `npx tsc -p tsconfig.json --noEmit`, `npm test`, `npm run build`.
- [ ] 7.3 Contrast spot-check (Appendix C): all ink/surface/accent pairs in both themes ≥ their thresholds (4.5:1 text, 3:1 UI).
- [ ] 7.4 Final counts recorded in this file's §2.3 (rerun the Appendix A commands): `body.theme-daybreak` rules → target **0** (or only theme-specific signatures that cannot be tokenized, e.g. the holo-tick conic gradient); `text-white` in components → 0; `useIsDaybreak` → 0; "Scoped spacing repair" → 0.
- [ ] 7.5 Mark Appendix B fully checked; close the file's Status row to "Implemented".

---

## Appendix A — Reproduce the evidence

```bash
cd /Users/mrongsubho/Documents/Termninal/ludo-base
wc -l app/globals.css
grep -c "body.theme-daybreak" app/globals.css
grep -o ":is(" app/globals.css | wc -l
grep -n "Scoped spacing repair" app/globals.css | wc -l
grep -ro "text-white" app/components | wc -l
grep -roE "bg-white/[0-9\[]" app/components | wc -l
grep -roE "border-white/[0-9]" app/components | wc -l
grep -roE "cyan-[0-9]{3}" app/components | wc -l
grep -rn "useIsDaybreak" app --include="*.tsx" -l
grep -rln "ThemeSwitcher" app --include="*.tsx"
```

## Appendix B — Migration checklist (updated 2026-10-15)

Scopes and their group (G#). Check when the group merges. ☑ = landed (commit in `UI_AUDIT_TRACKER.md` §2.2); execution order differs from this print order.

| Scope | G# | Status | Daybreak rules after |
|---|---|---|---|
| `ludo-wallet-scope` | 2 | ☐ | |
| `ludo-walletsheet-scope` | 2 | ☐ | |
| `ludo-burn-scope` | 2 | ☐ | |
| `ludo-friends-scope` | 3 | ☑ dee8f35 | |
| `ludo-messages-scope` | 3 | ☐ | |
| `ludo-invite-scope` | 3 | ☐ | |
| `ludo-pubprofile-scope` | 3 | ☐ | |
| `ludo-profile-scope` | 3 | ☑ dee8f35 | |
| `ludo-leaderboard-scope` | 4 | ☐ | |
| `ludo-rankings-scope` | 4 | ☐ | |
| `ludo-stats-scope` | 4 | ☐ | |
| `ludo-mission-scope` | 4 | ☑ ce49cfe | |
| `ludo-market-scope` | 5 | ☑ c542247 | |
| `ludo-arena-scope` | 6 | ☑ ce49cfe | |
| `ludo-livearena-scope` | 6 | ☑ ce49cfe | |
| `ludo-quick-scope` | 6 | ☑ a847fcb | |
| `ludo-teamup-scope` | 6 | ☐ partial (ccc13d7: generic controls done; 13 bespoke raw buttons remain) | |
| `ludo-settings-scope` | 7 | ☑ a7d05d4 | |
| `ludo-onboard-scope` | 7 | ☑ a7d05d4 | |
| `ludo-wall-scope` | 7 | ☐ | |
| `ludo-guestpill-scope` | 7 | ☑ a7d05d4 | |
| `ludo-migrate-scope` | 8 | ☐ | |
| `ludo-offline-scope` | 8 | ☑ 8f23c69 | |
| `ludo-idle-scope` | 8 | ☐ | |
| `ludo-quit-scope` | 8 | ☐ | |
| `ludo-splash-scope` | 8 | ☐ | |
| `ludo-header-scope` | 9 | ☐ | |
| `ludo-footer-scope` | 9 | ☐ | |
| `ludo-lobby-scope` | 9 | ☐ | |
| `ludo-broadcast-scope` | 9 | ☐ | |
| `ludo-ticker-scope` | 9 | ☐ | |

Rule reminders: never add a scope to a Daybreak `:is()` list; delete a scope's rules only when its group merges; surviving rules must still match at least one live selector.

## Appendix C — Contrast check script

Save as `scripts/contrast.mjs`; rerun after any token change:

```js
// node scripts/contrast.mjs <fg> <bg>  — WCAG 2.1 contrast ratio
const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
};
console.log(`${process.argv[2]} on ${process.argv[3]} = ${cr(process.argv[2], process.argv[3])}:1`);
```

Key pairs to assert (thresholds: 4.5 text / 3.0 UI):

```
#0f172a on #e6e8ec   #0d6d87 on #e6e8ec   #0d6d87 on #ffffff
#475569 on #ffffff   #E2E8F0 on #0F0F23   #94A3B8 on #12122b
#22D3EE on #12122b   #fbbf24 on #12122b   #b45309 on #e6e8ec
#4ade80 on #12122b   #15803d on #e6e8ec   #f87171 on #12122b   #dc2626 on #e6e8ec
```

---

*End of audit. Update §2.3 counts, Appendix B, and the Status row as phases land.*
