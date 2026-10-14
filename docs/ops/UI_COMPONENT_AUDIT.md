# Ludo Base — UI Component & Structure Consistency Audit

| | |
|---|---|
| **Date** | 2026-10-13 |
| **Scope** | Component layer: buttons, pills/chips/badges, switches/toggles, inputs, rows, cards, sheets, iconography, motion, controls' states & semantics. Companion to `UI_DESIGN_AUDIT.md` (color/theming/tokens) |
| **Method** | Static extraction of every `<button>`, custom CSS class inventory, state/semantics greps, cross-family comparison |
| **Status** | Proposed — not yet implemented |

---

## 1. Executive summary

The color audit found theming problems; this audit found the deeper issue: **there is no component system at all**. The app has no shared `Button`, `Chip`, `Switch`, or `Row` component — every surface styles its own controls from raw Tailwind strings or one-off CSS classes.

Measured state (verification commands in Appendix A):

- **348 `<button>` elements across 144 distinct class recipes.** The most common recipe (`w-11 h-11 rounded-full …`, the close button) appears 12 times; 161 buttons use dynamic template classes, so the true recipe count is higher.
- **695 custom CSS classes in `globals.css`, of which 92 are button/pill/chip-ish** — at least **17 button families** (`btn-main`, `btn-ghost`, `btn-mini`, `cb-btn`, `wl-btn`, `pp-btn`, `play-button`, `play-now-btn`, `play-again-btn`, `ingame-cta`, `ingame-ghost`, `boot-lock-cta`, `boot-lock-ghost`, `settings-action-btn`, `profile-action-btn`, `close-btn`, `profile-close-btn`) and **7 chip families** (`bet-chip`, `match-stats-chip`, `cb-filter-chip`, `tk-chip`, `dapp-chip`, `wl-addr-chip`, `ai-thinking-tag`).
- **Primary CTA has ≥3 visual flavors**: white-fill (`bg-white text-black`, 21 uses), Base blue `#0052FF` (`.btn-main`, `.cb-btn.primary`, `.btn-mini.primary` — theme-static, in both themes), and cyan-500 fills (`Switch`, odds and ends).
- **47 of 62 disabled buttons (76%) have no visual treatment** — they look enabled but do nothing.
- **24 distinct border-radius values** including `rounded-[100px]`, `rounded-[22px]`, `rounded-[2px]`; **10 arbitrary font sizes** with 135 uses below the 10px floor; **8 icon sizes**; `font-black` (weight 900) appears **446 times**.
- **A11y semantics are inconsistent**: `aria-pressed` in 6 files, `role="switch"` in exactly 1 (the good `Switch` in SettingsPanel), most toggle-like controls have no state semantics.

What already works and must be preserved: `PanelTabs`/`PanelChildTabs` (true single-source-of-truth tabs), `EmptyState` (shared surface with a proper 44px CTA), the global `button:focus-visible` ring, the Settings `Switch` (correct `role`/`aria-checked`/spring), and consistent SVG `strokeWidth={2}` iconography.

The fix is a small contract — 4 button variants, 3 chip types, fixed scales for type/radius/icon/motion — adopted surface-by-surface, enforced by a CI allowlist that fails on new one-off recipes.

---

## 2. Evidence — component layer

### 2.1 Buttons

| Metric | Value |
|---|---|
| `<button>` tags | 348 |
| Distinct static class recipes | 144 (+161 dynamic) |
| Button-ish CSS classes | ≥17 families |
| Radii used on buttons | `rounded-full` 32, `2xl` 25, `xl` 11, `lg` 11, plus arbitrary `[14px]`, `[10px]` |
| Sizes | `w-11 h-11` (44px) 16–17× — good; `h-9`/`h-8`/`h-7`/`h-6` icon buttons ~12× below 44px |
| With `disabled` attr | 62 |
| …with visual disabled treatment | **15** (47 unstyled) |
| With `disabled:` utility in className | 47 total in codebase (mostly non-button) |
| `type="button"` declared | rare (forms-free app, but implicit `submit` risk if a form ever wraps them) |

Family comparison (three "primary" buttons that should look identical):

| Family | Fill | Radius | Font | Padding | Theme-aware |
|---|---|---|---|---|---|
| `EmptyState` CTA | `bg-white text-black` | `full` | 11px/900 | `min-h-44 px-5` | white in both themes |
| `.btn-main` | **`#0052FF`** | **14px** | 14px/700 | `14px 18px` | static |
| `.cb-btn.primary` | `rgba(0,82,255,.22)` + `#8EB6FF` text | 12px | 12px/650 | `10px 14px` | static |
| `.btn-mini.primary` | `#0052FF` | 10px | — | — | static |
| `.ingame-cta` | cyan family | — | — | — | via patch layer |

### 2.2 Pills / chips / badges — seven families, zero shared base

| Family | Padding | Radius | Size / weight | Defined at |
|---|---|---|---|---|
| `.bet-chip` | `8px 18px` | pill | 13px/600 | `globals.css:1889` (uses ludo tokens — the best one) |
| `.cb-filter-chip` | `6px 12px` | 999px | 11px/650 | `globals.css:7886` |
| `.tk-chip` | `10px 14px` | 999px | — | `globals.css:8700` |
| `.match-stats-chip` | `1px 7px` | 999px | 10px/800 | `globals.css:4251` |
| `.wl-addr-chip`, `.dapp-chip`, `.ai-thinking-tag`, `.cb-status-pill`, `.match-status-*` | each bespoke | | | |
| Tailwind one-offs | `px-2 py-0.5`–`px-3 py-1` | `full`/`xl` | 9–11px | dozens across panels |

Status semantics (`connected`/`offline`/`reconnecting`…) are re-invented per surface: `ConnectionBadge` (own tone map + titles — good pattern, no shared pill), `MatchStatsOverlay`, lobby presence dots, `LiveArenaStage`.

### 2.3 Type, radius, icon, motion scales

| Scale | Distinct values in use | Problem |
|---|---|---|
| Font size (arbitrary) | `6,7,8,9,10,11,12,13,14,15` px | 135 uses below 10px floor; no roles — everything is 10–11px 900-weight |
| Font weight | black 446, bold 233, medium 28, semibold 4, extrabold 5 | hierarchy flattened by 900-weight inflation |
| Radius | 24 distinct values incl. `full, 3xl, 2xl, xl, lg, md, sm, [100px], [32px], [28px], [26px], [24px], [22px], [20px], [18px], [14px], [2px]`, per-corner variants | no scale; arbitrary px values unmaintainable |
| Icon size | `w-3, 3.5, 4, 5, 7, 8, 10, 11` (25–117 uses each) | 8 sizes, no semantics |
| Motion duration | 200 (13×), 300 (10×), 500 (2×), 1000 (3×) | outliers; no easing token |
| Gap | 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 | acceptable (4pt-ish) — keep |

### 2.4 States & semantics

- **Disabled**: 47 buttons accept `disabled` with zero visual change (no opacity, no cursor) — users click dead controls.
- **Pressed/active**: inconsistent — some `active:scale-[0.98]`, some `active:bg-white/10`, most nothing.
- **Loading**: no pattern; async actions (join, send, settle) presumably disable without feedback.
- **Semantics**: toggle-like buttons mostly lack `aria-pressed`; only one `role="switch"`; icon-only buttons mostly have `aria-label` (close buttons do — good) but not all.
- **Focus**: global ring exists (good); per-component `focus-visible:ring-cyan-400/60` duplicates create two ring styles.

---

## 3. Findings

**P0-1 — No shared control primitives.** 144 recipes for what is conceptually 4 variants × 3 sizes. Every new panel re-derives the system; cross-panel parity is impossible to review.

**P0-2 — Brand CTA ambiguity.** Three incompatible primary fills (white / `#0052FF` / cyan). `#0052FF` is hardcoded and theme-static: it survives untouched in Daybreak, introducing a saturated blue that exists nowhere in either theme's token set (Retro's accent is cyan `#22D3EE`, Daybreak's `#0d6d87`). Users cannot tell which blue means "go".

**P0-3 — Invisible disabled state.** 47 of 62 disabled buttons look enabled. Worse than a cosmetic issue: wallet/join flows disable buttons while a tx is pending, and the user perceives a broken app.

**P0-4 — No type scale.** 10 arbitrary sizes, 135 sub-floor uses, 446× weight-900. There is no visual hierarchy mechanism: section titles, row labels, chips, and hints all compete at 10–11px black.

**P1-5 — Seven chip families.** Filter chips, status pills, address chips, tags — each bespoke padding/size/weight. The same pill concept renders at 6px 12px / 8px 18px / 10px 14px padding in adjacent panels.

**P1-6 — No radius scale.**  values from `2px` to `100px`. Controls at 10–14px, cards at 16–18px, sheets at 28–32px should be a 4-step scale; today it's whatever each author typed.

**P1-7 — No icon scale.** 8 sizes. `w-4 h-4` inline / `w-5 h-5` standalone / `w-7 h-7` in 36px tiles etc. has no rule; icons drift from their containers.

**P1-8 — State semantics missing.** 6 files use `aria-pressed`; toggle buttons, segment controls, and filter chips mostly expose no state to assistive tech (contrast: `PanelTabs` and `PanelChildTabs` do it right — that's the bar).

**P2-9 — Active-state roulette.** `active:scale-[0.98]` vs `active:bg-*` vs nothing; no shared press feedback.

**P2-10 — Motion outliers.** 500ms/1000ms transitions amid 200/300ms; no easing token; framer springs unstandardized.

**P2-11 — Sub-44px tap targets.** ~12 icon buttons at 24–36px (`h-6`…`h-9`) below the 44px contract in DESIGN.md.

**Keep (do not regress):** `PanelTabs`/`PanelChildTabs`, `EmptyState` CTA (`min-h-[44px]`), Settings `Switch` (role/aria/spring), global focus ring, `ConnectionBadge`'s status vocabulary, `strokeWidth={2}` icon consistency, the `p-3.5` settings-row rhythm.


---

## 4. The component contract (target system)

Deliberately small: four button variants, three chip types, four scale families. Everything below builds on the semantic token layer from `UI_DESIGN_AUDIT.md` §5.1 (`surface-*`, `ink-*`, `line-*`, `accent*`, `warn/positive/negative`).

### 4.1 Button — `<Button variant size fullWidth loading leftIcon …>`

New shared component `app/components/Button.tsx`. All values are tokens; both themes work with zero patch rules.

| Variant | Fill | Text | Border | Use for |
|---|---|---|---|---|
| `primary` | `bg-accent` (Retro `#22D3EE` / Daybreak `#0d6d87`) | `text-accent-ink` | none | **The one** main action per surface |
| `secondary` | `bg-surface-hover` | `text-ink-strong` | `border-line-soft` | Most actions |
| `ghost` | transparent | `text-ink-muted` | none | Tertiary/destructive-adjacent, chip-row actions |
| `danger` | `bg-negative` | white | none | Confirm-destructive only |

| Size | Height | Padding | Type | Radius |
|---|---|---|---|---|
| `sm` | 32px | `0 12px` | 11px/700 `label-chrome` | 10px |
| `md` | 40px | `0 16px` | 12px/700 | 12px |
| `lg` | 48px (≥44 target) | `0 20px` | 13px/700 | 14px |
| icon-only | 44×44 | — | — | full (keep the existing `w-11 h-11` close-button look) |

**States (all variants, no exceptions):**
- hover: fill → next token step (`primary` → `brightness-95` or `bg-accent/90`)
- active: `scale-[0.98]` + same fill step — one shared press feel
- focus-visible: the existing global ring only — delete per-component `focus-visible:ring-*`
- disabled: `opacity-45` + `cursor-not-allowed`, **always** (fixes the 47 invisible-disabled buttons)
- loading: `aria-busy`, spinner slot replaces `leftIcon`, label stays — kill double-submit visually

**Brand-blue decision (P0-2):** `#0052FF` is retired as a CTA fill. Where Base branding is mandatory (Base Account / onchain actions), use `variant="primary"` with a `brand` prop that swaps only the fill to `#0052FF` and is documented as an intentional exception; everything else uses the accent. White-fill CTAs become `primary` (accent) — one accent per theme, one meaning.

### 4.2 Chips — `<Chip tone size>`

One base `.chip` + modifiers, replacing all seven families:

```css
.chip { display: inline-flex; align-items: center; gap: 6px;
  border-radius: 999px; border: 1px solid var(--line-soft);
  background: var(--surface-recessed); color: var(--ink-muted);
  padding: 4px 10px; font-size: 11px; font-weight: 650; white-space: nowrap; }
.chip-sm { padding: 2px 8px; font-size: 10px; }
.chip.active, .chip[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.chip-status-ok { color: var(--positive); }   /* live / connected */
.chip-status-warn { color: var(--warn); }     /* degraded / pending */
.chip-status-off { color: var(--ink-faint); } /* offline / ended */
.chip-address { font-family: ui-monospace, monospace; } /* wl-addr-chip */
```

Three chip **types** map onto this base: **filter** (`.chip` + `aria-pressed`), **status** (`.chip-status-*` — absorbs `ConnectionBadge`, `match-status-*`, `cb-status-pill`), **info tag** (`.chip` + tone). All get `aria-pressed` when toggleable.

### 4.3 Switch & segmented

- Keep the Settings `Switch` (correct semantics); promote it to shared `app/components/Switch.tsx`; its `bg-cyan-500` track becomes `bg-accent` via token; all toggles use it (`role="switch"` everywhere).
- `PanelTabs` stays **the** segmented control (already single-source); ban new `seg-btn`/`bet-pills`/`cb-mode-pill` style duplicates — delete those families as panels adopt.

### 4.4 Scales (the enforcement surface)

| Scale | Values | Ban |
|---|---|---|
| Type | `10, 11, 13, 15, 17, 22` px (+ `label-chrome` at 10) mapped to roles: micro-label / label / row / body / title / hero | any other `text-[Npx]`, any `< 10px` |
| Weight | 400 / 600 / 700 / 800 only — `font-black` (900) allowed **only** inside `label-chrome` | ad-hoc `font-extrabold`/`font-semibold` outside tokens |
| Radius | pill `999` · control `10/12/14` · card `16` (Daybreak `18` via token) · sheet `28/32` | arbitrary `rounded-[Npx]` outside panels |
| Icon | `14` inline · `16` standalone · `20` feature — declared as `--icon-sm/md/lg` utility classes `.icon-sm/md/lg` | ad-hoc `w-N h-N` on SVGs |
| Motion | `150ms` micro · `200ms` control · `300ms` surface · easing `cubic-bezier(0.2, 0, 0, 1)` token | `duration-500/1000` without motion-token justification |

### 4.5 Shared row pattern

Promote the Settings `PrefRow`/`NavRow` rhythm (36px icon tile `rounded-xl` + 13px label + 10px hint + `p-3.5` + `divide` line) to `app/components/ListRow.tsx` — used by Friends, Messages, Wallet activity, Marketplace rows, Leaderboard. One row, one rhythm.


---

## 5. Phased adoption checklist

Order mirrors `UI_DESIGN_AUDIT.md` Phase 1–4: primitives first, then the same panel groups get converted once. Conventions: one PR per phase; every phase ends with `npm run lint` + `npx tsc -p tsconfig.json --noEmit` + two-theme visual pass at 375px.

### Phase A — Build the primitives (~2 days, no UI change yet)

- [x] A.1 Create `app/components/Button.tsx` per §4.1 (variants/sizes/states/loading, `forwardRef`, `type="button"` default). Unit-test the variant→class map if a component test harness exists; otherwise a Story-like scratch page under `app/spike/`.
- [x] A.2 Create `app/components/Chip.tsx` per §4.2 (filter/status/info types, `aria-pressed` wiring).
- [x] A.3 Promote the Settings `Switch` to `app/components/Switch.tsx` (same API + tokens), import it back into SettingsPanel — zero visual diff proves the promotion.
- [x] A.4 Create `app/components/ListRow.tsx` from PrefRow/NavRow; refactor SettingsPanel to use it (zero visual diff).
- [x] A.5 Add the scale tokens to `globals.css`: `--icon-sm/md/lg` + `.icon-sm/md/lg` utilities, motion durations + easing token, and the §4.2 `.chip` base. **Do not delete any legacy family yet.**
- [x] A.6 Gate: new primitives unused in production paths is fine — this phase must be visually inert.

### Phase B — Adopt in shell + settings (the reference surfaces, ~1 day)

- [x] B.1 `GamePanelShell` close button → `<Button variant="ghost" size="icon">` (keeps the 44×44 look).
- [x] B.2 `EmptyState` CTA → `<Button variant="primary" size="lg">` (accent replaces white-fill — this is the intentional visual change that retires the white CTA flavor; verify both themes).
- [x] B.3 SettingsPanel: every action button → `Button`; every pref row → `ListRow`; segment controls stay `PanelTabs`; toggles → shared `Switch`.
- [x] B.4 `FirstRunSetupPanel` + `ThemeNudge` chips → `Chip`/`Button`.
- [x] B.5 Delete now-dead CSS families if nothing else uses them: `settings-action-btn`, `theme-inline-btn` (keep ThemeNudge chips if still referenced — check `grep -rn` first).
- [x] B.6 **Acceptance:** Settings is the reference implementation; diff vs baseline shows only the intended CTA accent change.

### Phase C — Panel sweep (one PR per group, ~3–4 days)

Reuse the group order from `UI_DESIGN_AUDIT.md` Phase 4 (wallet → social → progression → marketplace → matchmaking → settings/onboarding → match sheets → chrome/lobby). Per group:

- [ ] C.1 Replace raw `<button className="…">` with `<Button>` picking the closest variant/size by intent (use the family mapping in §5.1 below).
- [ ] C.2 Replace chip/pill markup with `<Chip>` (filter chips get `aria-pressed`; status pills get `.chip-status-*`).
- [ ] C.3 Fix every disabled button encountered to carry visible treatment (via Button it's automatic; legacy ones get `disabled:opacity-45 disabled:cursor-not-allowed`).
- [ ] C.4 Replace ad-hoc sizes with the scale: `text-[Npx]` → nearest of 10/11/13/15/17/22; `rounded-[Npx]` → scale value; icon `w-N h-N` → `.icon-sm/md/lg`.
- [ ] C.5 Delete the legacy CSS family when its last consumer converts — record in the PR description. Families queued for deletion: `btn-main`, `btn-ghost`, `btn-mini`, `cb-btn`, `wl-btn`, `pp-btn(+active/danger)`, `play-button`, `play-now-btn`, `play-again-btn`, `ingame-cta`, `ingame-ghost`, `ingame-link`, `ingame-back`, `ingame-ready-badge`, `boot-lock-cta`, `boot-lock-ghost`, `boot-lock-badge`, `close-btn`, `profile-close-btn`, `profile-action-btn`, `settings-dots-btn`, `theme-toggle-btn`, `audio-toggle-btn`, `dm-btn`, `bet-chip`, `bet-pill`, `cb-filter-chip`, `tk-chip`, `dapp-chip`, `wl-addr-chip`, `ai-thinking-tag`, `match-stats-chip`(→`Chip`), `seg-btn`, `bet-pills`, `cb-mode-pill`, `tkpick-btn`, `pct-btn`, `rev-btns`, `sec-tag`, `cb-section-tag`, `dapp-chips`, `cb-asset-pill*`.
- [ ] C.6 Gate per group: `grep -c "btn-main\|cb-btn\|wl-btn" app/components/<files>` → 0 for that group's files.

### Phase D — Legacy-family deletion sweep (~0.5 day)

- [ ] D.1 `grep -rn` each family in §5.1's deletion queue across `app/` — must be 0 or the group is incomplete.
- [ ] D.2 Delete the CSS definitions from `globals.css` (families live around lines 8133 `cb-btn`, 8629 `btn-main`, 9295 `btn-mini`, 1882 `bet-chips`, 1889 `bet-chip`, 4251 `match-stats-chip`, 7886 `cb-filter-chip`, 8700 `tk-chip`, plus one-offs).
- [ ] D.3 Confirm `grep -c "font-black" app/components` dropped to `label-chrome` definitions only; no `text-[6|7|8|9]px` remains; no `rounded-\[` outside panels/sheets.
- [ ] D.4 Full two-theme matrix pass + `npm test` + `npm run build`.

### Phase E — Enforcement (~0.5 day)

- [ ] E.1 Extend `scripts/check-ui-tokens.sh` (from `UI_DESIGN_AUDIT.md` Phase 6) into `scripts/check-ui-contract.sh` failing on banned patterns in changed files:
  ```bash
  BANNED='text-\[(6|7|8|9)px\]|rounded-\[(?!32|28|26|24|22|100)|\bfont-black\b(?!.*label-chrome)|\bbg-cyan-500\b|#0052FF'
  ```
  (finalize the regex against the real leftovers; keep it diff-scoped so historical debt doesn't block merges)
- [ ] E.2 Add ESLint `no-restricted-syntax` rules: raw `rounded-[Npx]`/sub-10px text in JSX literals, and `<button` JSX outside `Button.tsx` in **new** code (warn first).
- [ ] E.3 Document the contract in `DESIGN.md` (§4 here becomes the "Components" section; cross-link both audits).
- [ ] E.4 Record final counts in §2 of both audits.

### 5.1 Legacy family → variant mapping (for Phase C)

| Legacy family | Maps to |
|---|---|
| `.btn-main`, `.btn-mini.primary`, `play-now-btn`, `ingame-cta`, `boot-lock-cta`, `EmptyState` white CTA | `Button variant="primary"` (size per context; `brand` only where Base branding is required) |
| `.cb-btn` (default/`.ghost`), `.btn-ghost`, `.btn-mini`, `ingame-ghost`, `boot-lock-ghost`, `ingame-link`, `lnk`, `cb-link` | `Button variant="secondary"` / `ghost` |
| `.cb-btn.danger*`, `.pp-btn-danger` | `Button variant="danger"` |
| `.cb-icon-btn`, `close-btn`, `profile-close-btn`, `settings-dots-btn` | `Button size="icon"` |
| `.bet-chip`, `.cb-filter-chip`, `.tk-chip`, `.dapp-chip` | `Chip` (filter — `aria-pressed`) |
| `match-status-*`, `.cb-status-pill`, `ConnectionBadge` tones | `Chip` (status) |
| `.ai-thinking-tag`, `.afk-tag`, `.cb-section-tag`, `.sec-tag`, `team-badge` | `Chip` (info) |
| `.wl-addr-chip` | `Chip tone="address"` |
| `bet-pills`/`seg-btn`/`cb-mode-pill` | `PanelTabs` (or `Chip` group) |
| `theme-nudge-chip` | `Button size="sm"` / `Chip` |
| `match-stats-cta` | `Button primary/secondary` |

---

## Appendix A — Reproduce the evidence

```bash
# button inventory (script used for this audit, saved as /tmp/ui_audit.mjs pattern)
node -e '/* extract <button> tags, cluster className recipes */
const fs=require("fs"),path=require("path");
function walk(d){return fs.readdirSync(d).flatMap(f=>{const p=path.join(d,f);return fs.statSync(p).isDirectory()?walk(p):[p];});}
const rec={};
for(const f of walk("app/components").filter(f=>f.endsWith(".tsx"))){
  const src=fs.readFileSync(f,"utf8");const re=/<button\b([\s\S]*?)>/g;let m;
  while((m=re.exec(src))){const a=m[1];const c=(a.match(/className=\{?["\x27`]([\s\S]*?)["\x27`]\}?/)||[])[1]||"";
    const k=c.replace(/\s+/g," ").trim().slice(0,120);rec[k]=(rec[k]||0)+1;}}
console.log("buttons:",Object.values(rec).reduce((a,b)=>a+b,0),"recipes:",Object.keys(rec).length);'

# disabled-state gap
node -e '/* buttons with disabled but no opacity/cursor treatment → see §2.4 */
const fs=require("fs"),path=require("path");
function walk(d){return fs.readdirSync(d).flatMap(f=>{const p=path.join(d,f);return fs.statSync(p).isDirectory()?walk(p):[p];});}
let t=0,d=0,s=0;
for(const f of walk("app/components").filter(f=>f.endsWith(".tsx"))){const src=fs.readFileSync(f,"utf8");
  const re=/<button\b([\s\S]*?)>/g;let m;
  while((m=re.exec(src))){const a=m[1];t++;if(/\bdisabled\b/.test(a)){d++;if(/opacity|cursor-not-allowed|cursor-default/.test(a))s++;}}}
console.log({buttons:t,disabled:d,styled:s,unstyled:d-s});'

# custom CSS class inventory
node -e 'const css=require("fs").readFileSync("app/globals.css","utf8");
const u=[...new Set([...css.matchAll(/^\.([a-zA-Z][\w-]*)\s*[,{:]/gm)].map(m=>m[1]))];
console.log("custom classes:",u.length,"| button/chip-ish:",u.filter(c=>/btn|cta|chip|pill|link|lnk|toggle|badge|tag|mini|ghost/i.test(c)).length);'

# scales
grep -rhoE "text-\[[0-9]+px\]" app --include="*.tsx" | sort | uniq -c | sort -rn
grep -rhoE "rounded-[a-z0-9\[]+" app/components --include="*.tsx" | sort | uniq -c | sort -rn
grep -rhoE "duration-[0-9]+" app/components --include="*.tsx" | sort | uniq -c | sort -rn
grep -rho "font-black" app/components --include="*.tsx" | wc -l
```

---

*End of component audit. Execute alongside `UI_DESIGN_AUDIT.md`: its Phase 1/2 (tokens) is the foundation this contract's components consume.*
