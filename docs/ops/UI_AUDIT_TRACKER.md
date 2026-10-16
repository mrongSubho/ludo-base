# Ludo Base — UI Audit Remaining Work Tracker

| | |
|---|---|
| **Created** | 2026-10-15 (revised same day after commit-history verification) |
| **Sources** | `docs/ops/UI_DESIGN_AUDIT.md` (themes / tokens / typography) · `docs/ops/UI_COMPONENT_AUDIT.md` (components / primitives) |
| **Purpose** | One actionable tracker for every item still open across both audits — each item carries an action, a status, and its dependencies. Update in place; do not fork new trackers. |
| **Conventions** | One branch + one PR per migration group. Every phase ends with `npm run lint` + `npx tsc -p tsconfig.json --noEmit` + a two-theme visual pass at 375px. Never mix a quick win with a migration PR. |

---

## 1. Progress snapshot

Both audits still read "Proposed — not yet implemented" and carry stale checkboxes, but `git log` shows Phases A/B and five component-C groups have landed (see §2.2). Treat this tracker — not the audit checkboxes — as the status source until V-6 syncs the docs.

| Audit | Phase | Real state |
|---|---|---|
| Design | P0 baselines | **Mostly landed** — deterministic harness + 10 scene types committed; 375px coverage + SHA tag remain → P-1 |
| Design | P1 quick wins | **Done** — 1.2–1.4 in code; 1.1 shipped (verify V-1); 1.5.4 closed by CI gate (V-4) |
| Design | P2 token layer | **Done** — values + corrected status tokens live; gate 2.6 unrun → V-2 |
| Design | P3 kill JS theming | **Done** — zero code refs |
| Design | P4 migration | **In progress** — see §2.2 for landed groups |
| Design | P5 typography/chrome | **Open** → Tier 3 |
| Design | P6 docs & CI guard | **Open** → Tier 5 |
| Design | P7 sign-off | **Open** → Tier 6 |
| Component | A primitives | **Done** |
| Component | B shell + settings | **Done** — one residue → G7 → V-5 |
| Component | C panel sweep | **In progress** — teams groups landed + this session's wallet/misc sweep; remainder in §5 |
| Component | D deletion sweep | **Started** — 23 dead rules deleted (ee86ab8); sweep open → Tier 4 |
| Component | E enforcement | **Open** → Tier 5 |

**Remaining load (2026-10-15 close):** Tier 0 close-outs **all done** (V-1–V-6) · P-1 mostly landed, P-2 **done** (codemod script) · the panel sweep continues (wallet remainder, social remainder, TeamUp's 13 bespoke raw buttons, match-sheet remainder, chrome/lobby) · Tier 3 typography · Tier 4 deletion sweep (D-1 now passes for the uncommitted diff; formalize) · Tier 5 docs/CI · Tier 6 sign-off.

---

## 2. Verified state (re-measured 2026-10-15 against the tree and `git log`)

### 2.1 Metrics

| Metric | Now | Audit time (2026-10-13) | Target |
|---|---|---|---|
| `grep -c "body.theme-daybreak" app/globals.css` | **522** | 558 rules | 0 (or only non-tokenizable signatures, e.g. the holo-tick conic gradient) |
| `globals.css` lines | **10,556** | 11,775 | — |
| "Scoped spacing repair" sections | **0** ✔ | 22 | 0 |
| `useIsDaybreak` in code | **0** ✔ (3 doc comments) | 4 consumers | 0 |
| Raw `<button>` in `app/components` | **238** (re-measured 2026-10-15 after this session's 30-conversion sweep) | 348 (144 recipes) | 0 outside `Button.tsx` |
| Dead button/chip CSS rules | **23 deleted** ✔ (ee86ab8, globals.css −218 lines) + **~40 more families** in the uncommitted −697-line diff whose consumers this session finished converting | ~40 families | 0 |
| File-level `eslint-disable` comments | **73** (swept 2026-10-15: 0 mechanically removable — every remaining one still suppresses a real `any`/unused-var, so each needs typing work in its file; `scripts/eslint-disable-sweep.sh` is the incremental tool) | ~73 | 0 or documented |

### 2.2 Verified artifacts and landed work

Verified present:

- `scripts/contrast.mjs` ✔ · `scripts/check-reduced-motion.mjs` ✔ (`npm run check:reduce-motion` — closes design 1.5.4 as a validated CI gate: asserts zero animations under `reduce` **and** motion under `no-preference`; documented blind spot: cannot see GSAP canvas work or canvas-confetti)
- Daybreak status tokens corrected ✔ (`--warn/--positive/--negative` = `#92400e / #166534 / #b91c1c`, `globals.css:283-285`)
- Primitives ✔ — `Button.tsx`, `Chip.tsx`, `Switch.tsx`, `ListRow.tsx`; `.chip` base + `.icon-sm/md/lg` (`globals.css:195-236`)
- `settings-action-btn` / `theme-nudge-chip` CSS deleted ✔ (tombstones `globals.css:4417`, `8805`)
- Visual baselines extended: 10 scene types committed (`setup, lobby, offline-panel, board, burn, panel-arena, panel-friends, panel-market, panel-mission, panel-rankings` × themes) — the harness was made deterministic (ce49cfe)

Verified missing (must be created): `scripts/codemod-ui-tokens.mjs` (P-2) · `scripts/check-ui-tokens.sh`, `scripts/check-ui-contract.sh` (Tier 5).

Landed migration commits (the team's execution order — **arena/mission → social → marketplace → match sheets → matchmaking**, which differs from the audits' print order; use the canonical table in §5.2 for scope/file mapping and this order for sequencing):

| Commit | Group (team numbering) | Files |
|---|---|---|
| a4004e3 | Phase A | primitives + scale tokens |
| a7d05d4 | Phase B | shell + settings adoption |
| ce49cfe | group 1 (arena/mission) | `ArenaPanel`, `LiveArenaStage`, `MissionPanel` + harness determinism |
| dee8f35 | group 2 (social) | `FriendsPanel`, `PlayerProfileSheet` + icon-size `Button` render fix |
| c542247 | group 3 | `MarketplacePanel` |
| 8f23c69 | group 4 | `OfflineMatchPanel` |
| ee86ab8 | C.5 partial | 23 dead button/chip rules deleted |
| ccc13d7 + a847fcb | group 5 | `TeamUpMatchPanel` generic controls (partial — 13 bespoke raw buttons remain) · `QuickMatchPanel` complete |
| bd6ca99 | design 1.5.4 | reduced-motion CI gate |
| *(uncommitted, this session)* | wallet + misc sweep | fixed the build break (`ReceiveSheet` imports, `SendTokenSheet` `pct` state) · converted `InGameWalletPanel` (12 buttons), `WcWalletPanel` (8 + back button), `BootLock` (4 + badge), `SwapSheet` (2), `WalletLinkPanel` (2), `WalletSecurityPanel` (4 + back button), `MatchStatsOverlay` (2 chips), `BoardOverlays` (1), `SnakesBoard` (6 chips) — **every remaining consumer of the deleted legacy families is now converted, so the uncommitted 697-line `globals.css` deletion is safe** |

Partial/incidental adoption to verify before starting a group (files show `<Button>`/`<Chip` usage without a group commit): `ReceiveSheet`, `SendTokenSheet`, `WalletActivityList`, `RankingsPanel`, `ThemeNudge`, `FirstRunSetupPanel`.

**Resolved 2026-10-15 (this session):** the "incidental usage" in `ReceiveSheet`/`SendTokenSheet` was a *broken* older conversion (missing imports, dangling `pct` ref) — fixed, which also un-broke the tree (tsc was red on main). The uncommitted `globals.css` −697-line deletion's remaining consumers (`InGameWalletPanel`, `WcWalletPanel`, `BootLock`, `SwapSheet`, `WalletLinkPanel`, `WalletSecurityPanel`, `MatchStatsOverlay`, `BoardOverlays`, `SnakesBoard`) are all converted this session — `grep` for every deleted family in `app/` is now 0.

Live exception: **`theme-inline-btn`** is still consumed by `TokenStyleSwitcher.tsx:36,43` (not ThemeNudge) — delete with G7.

---

## 3. Tier 0 — Close-out verifications (do first; hours, zero risk)

| ID | Action | Status | Depends on |
|---|---|---|---|
| V-1 | **Design 1.1 close-out.** Accent `#0e7490 → #0d6d87` shipped and `contrast.mjs` exists. Remaining: Daybreak-only visual pass (footer nav active icon/label, header pills, tab underlines, buttons) + tick boxes 1.1.1–1.1.4 in the design audit so the doc matches code. | **Done 2026-10-15** — boxes ticked; Daybreak covered by the committed panel/lobby/board/burn baselines via `visual:diff` | — |
| V-2 | **Design 2.6 gate.** Run `npm run lint`, `npx tsc -p tsconfig.json --noEmit`, one `npm run build` against the token layer; record against 2.6. | **Done 2026-10-15** — lint clean, tsc 0 errors, `npm test` 406/0/11 green. The first run exposed a **build break on main**: missing `Button`/`Chip` imports plus a dangling `pct` reference in the wallet sheets (from older conversions) — fixed this session. `npm run build` itself cannot run in this sandbox: the IDE's fs broker rejects Next's `.next` mkdir/unlink patterns (two distinct shim errors, both environmental); CI runs the build gate on push. | — |
| V-3 | **Status-token correction gate.** Corrected values are live; run `node scripts/contrast.mjs --pairs` (15 pairs) and paste the output into the audit's Correction note. | **Done 2026-10-15** — 15/15 green; output recorded in the design audit's Correction note | V-2 |
| V-4 | **Design 1.5.4** — **CLOSED** by `scripts/check-reduced-motion.mjs` (bd6ca99): validated both ways (0 vs 7 animations; negative test fails the gate). Keep its GSAP/confetti blind spot documented; nothing further unless a new JS motion site is added. | **Done** | — |
| V-5 | **Component B.5/B.6 close-out.** Deletions verified via tombstones; `theme-inline-btn` stays until G7. Tick B.5/B.6 with that caveat noted. | **Done 2026-10-15** — boxes ticked with the G7 caveat | G7 (deletion half) |
| V-6 | **Sync both audit docs to reality.** Status rows still say "Proposed — not yet implemented" and checkboxes are stale vs §2.2 (A, B, and five C groups landed; 1.2–1.4 + Phase 2 + Phase 3 landed on the design side). Update checkboxes, §2 counts, and Status rows in both audits — or they will mislead the next reader the way this tracker's first draft did. | **Done 2026-10-15** — both audits' Status rows updated, Appendix B ticked per commit, §2 counts re-measured, correction note recorded | — |

---

## 4. Tier 1 — Prerequisites

| ID | Action | Status | Depends on |
|---|---|---|---|
| P-1 | **Baselines.** Mostly landed: deterministic 10-scene harness committed. Remaining: (a) tag the baseline — `git tag ui-baseline-2026-10-15` or record the SHA in every group PR; (b) extend scene coverage toward the audit's surface list — still no wallet-panel, messages, settings, leaderboard, profile-modal, or quick-match-sheet scenes, and no 375px-width variants; (c) refresh baselines on current HEAD before the next group PR. Constraints: board scenes need a production build; no browser toolchain may be installed (harness self-drives). | Mostly landed | — |
| P-2 | **Design 4.0 codemod.** Write `scripts/codemod-ui-tokens.mjs` per the audit's §4.0 (§5.2 mapping; replacements restricted to `className` segments; dry-run default, `--write` opt-in). Verified missing. | **Done 2026-10-15** — script written and verified on real files (GameLobby/Leaderboard/WalletShell: correct replacements inside plain + template-literal classNames, `${}` ternaries preserved, theme-neutral scrims untouched, per-file summary + `--check` mode for gates) | — |

---

## 5. Tier 2 — Migration groups (design Phase 4 + component Phase C — one PR per group)

Run both audits' work for a group in the **same** PR. Sequencing follows the landed order (arena/mission → social → marketplace → match sheets → matchmaking); the canonical table below is for scope, files, and scopes-freed mapping.

### 5.1 Standard per-group work (repeat for every group)

- [ ] Branch `ui/tokens-group-<name>`; never mix groups.
- [ ] Run the codemod per file with `--write`; `git diff -w` review; hand-fix leftovers (one-off hexes, inline `style={{…}}` colors).
- [ ] C.1 Replace raw `<button className="…">` with `<Button>`, variant per component audit §5.1.
- [ ] C.2 Replace chip/pill markup with `<Chip>` (filter chips get `aria-pressed`; status pills get `.chip-status-*`).
- [ ] C.3 Every disabled button gets visible treatment (automatic via `Button`; legacy ones get `disabled:opacity-45 disabled:cursor-not-allowed`).
- [ ] C.4 Adopt the scales: `text-[Npx]` → nearest of 10/11/13/15/17/22; `rounded-[Npx]` → scale value; icon `w-N h-N` → `.icon-sm/md/lg`.
- [ ] Delete the dead Daybreak patch rules: remove freed scopes from every `:is()` list; delete rules whose selectors no longer occur.
- [ ] C.5 Delete the converted legacy CSS families (Appendix A); record each deletion in the PR description.
- [ ] Gates: family grep → 0 for the group's files; `body.theme-daybreak` count ≤ previous group (record in the PR); `npm run lint`; `npx tsc -p tsconfig.json --noEmit`; two-theme visual diff vs baseline at 375px and 1440px.
- [ ] Tick the group's Appendix B row in the design audit.

### 5.2 Canonical group table (scope/file mapping)

| G | Group | Primary files (audit §4.1) | Scopes freed | Status (2026-10-15) |
|---|---|---|---|---|
| G1 | Panel shell | `GamePanelShell.tsx` | — (converted in design Phase 3) | Done (Phase B) |
| G2 | Wallet cluster | `BurnPanel`, `BurnFeed`, `ChipsWalletPanel`, `WalletPanel`, `WalletShell`, `WalletDetailsSheet`, `LudoWalletModal`, `SwapSheet`, `SendNativeSheet`, `SendTokenSheet`, `ReceiveSheet`, `WalletActivityList`, `WalletSecurityPanel`, `WalletLinkPanel`, `WcWalletPanel`, `InGameWalletPanel`, `WalletConnectCard` | `ludo-wallet-scope`, `ludo-walletsheet-scope`, `ludo-burn-scope` | Partial — **this session**: `InGameWalletPanel`, `WcWalletPanel`, `SwapSheet`, `SendTokenSheet`, `ReceiveSheet`, `WalletSecurityPanel`, `WalletLinkPanel` converted; verify `WalletActivityList` (partial WIP); remaining: `BurnPanel`, `BurnFeed`, `ChipsWalletPanel`, `WalletPanel`, `WalletShell`, `WalletDetailsSheet`, `LudoWalletModal`, `SendNativeSheet`, `WalletConnectCard`; triage the `.chips-wallet-panel .cw-*` family (`globals.css:6651+`), not in the audit's queue |
| G3 | Social | `FriendsPanel`, `MessagesPanel`, `RichChatField`, `InviteNotification`, `EmoteTray`, `EmojiPicker`, `PublicProfileModal`, `PlayerProfileSheet`, `UserProfilePanel` | `ludo-friends-scope`, `ludo-messages-scope`, `ludo-invite-scope`, `ludo-pubprofile-scope`, `ludo-profile-scope` | Partial — `FriendsPanel`, `PlayerProfileSheet` done; verify `PublicProfileModal`/`UserProfilePanel`; the rest not started |
| G4 | Progression | `Leaderboard`, `RankingsPanel`, `MissionPanel`, `ActivityFeed`, `ModeBreakdown`, `FormChart`, `MatchStatsOverlay`, `PlayerInfoRow` | `ludo-leaderboard-scope`, `ludo-rankings-scope`, `ludo-stats-scope`, `ludo-mission-scope` | Partial — `MissionPanel` done; `MatchStatsOverlay`'s `match-stats-chip` → `Chip` done this session; verify `RankingsPanel`; the rest not started |
| G5 | Marketplace | `MarketplacePanel`, `MerkleClaimPanel`, `BuyCryptoButton` | `ludo-market-scope` | Done (c542247); verify `MerkleClaimPanel`/`BuyCryptoButton` |
| G6 | Matchmaking | `ArenaPanel`, `LiveArenaDirectory`, `LiveArenaStage`, `LiveMatchmakingFeed`, `QuickMatchPanel`, `TeamUpMatchPanel`, `TeamUp/**` | `ludo-arena-scope`, `ludo-livearena-scope`, `ludo-quick-scope`, `ludo-teamup-scope` | Partial — `ArenaPanel`/`LiveArenaStage`/`QuickMatchPanel` done; `TeamUpMatchPanel` has 13 bespoke raw buttons left (DnD seat, kick, fee-step, inline copy links, invite row, `announce-btn` family); `LiveArenaDirectory`/`LiveMatchmakingFeed` not started; `bet-pills`/`seg-btn`/`cb-mode-pill` → `PanelTabs` or a `Chip` group |
| G7 | Settings & onboarding | `SettingsPanel`, `OnboardingPanel`, `FirstRunSetupPanel`, `TokenStyleSwitcher`, `AudioToggle`, `GuestWall`, `SecurityLadderChip` | `ludo-settings-scope`, `ludo-onboard-scope`, `ludo-wall-scope`, `ludo-guestpill-scope` | Partial (Phase B) — **delete `theme-inline-btn` here** (`TokenStyleSwitcher.tsx` is its last consumer) |
| G8 | Match sheets | `HostMigrationPanel`, `OfflineMatchPanel`, `Phase0aSpikePanel`, `SettlePoolButton`, `PaidPoolJoinButton` | `ludo-migrate-scope`, `ludo-offline-scope`, `ludo-idle-scope`, `ludo-quit-scope`, `ludo-splash-scope` | Partial — `OfflineMatchPanel` done; the rest not started |
| G9 | Chrome & lobby (highest visibility — last) | `HeaderNavPanel`, `FooterNavPanel`, `NoticeStrip`, `ConnectionBadge`, `GameLobby`, `BoardHeaderCompact`, `SpectatorHUD`, `LandscapeGuard`, `ThemeNudge`, broadcast panels | `ludo-header-scope`, `ludo-footer-scope`, `ludo-lobby-scope`, `ludo-broadcast-scope`, `ludo-ticker-scope` | Not started |

---

## 6. Tier 3 — Typography & chrome contract (design Phase 5)

| ID | Action | Status | Depends on |
|---|---|---|---|
| T-1 | 5.1 Add `.label-chrome` (§5.3) and replace the `text-[10px] font-black uppercase tracking-[0.2em]` / `tracking-widest` pattern across the 22 files. `.label-chrome` is the **only** legal home for `font-black` (component audit §4.4). | Not started | Tier 2 (G9 at minimum) |
| T-2 | 5.2 Introduce `--font-display` per theme + a `.display` utility; remove the Daybreak `!important` heading override (`globals.css:163-169`); verify no heading relied on it. | Not started | Tier 2 |
| T-3 | 5.3 Pick one heading approach (element-selector vs `.display`) and apply it symmetrically to both themes. | Not started | T-2 |
| T-4 | 5.4 Single focus visual: keep the global `button:focus-visible` ring; delete per-component ad-hoc rings (`focus-visible:ring-cyan-400/60`, static decorative `ring-1`). | Not started | Tier 2 |
| T-5 | 5.5 Two-theme 375px typography pass — Daybreak labels are sentence-case and longer; confirm no wrap/overflow in `PanelTabs` grids. | Not started | T-1, P-1 |
| T-6 | **Text-field rule compliance** (audit 2026-10-16; the contract now lives in `DESIGN.md` §6.6–6.7). Six sites deviate: (1) `TeamUpMatchPanel.tsx:927` invite-code field has **no `autoCapitalize="none"`** — case-sensitive codes can be silently capitalised into a "code not found"; (2) `WcWalletPanel.tsx:283` `wc:` URI field lacks `autoCorrect`/`autoCapitalize`; (3) `OnboardingPanel.tsx:486` referral code has no suppression attributes, no `maxLength`, no pattern; (4) `EmoteTray.tsx:114` custom-reaction field is inconsistent with its sibling chat field (no `spellCheck={false}`); (5) `GameLobby.tsx:457` + `MarketplacePanel.tsx:1480` use `type="number"` where the app's pattern is `inputMode="decimal"` (scroll-wheel value changes, locale separators); (6) `maximumScale: 1` (`app/layout.tsx`) blocks pinch-zoom for everyone (WCAG 1.4.4) — decide: keep it, or move to a 16px minimum mobile field font. Items 1–3 are genuine input-corruption bugs; 4–5 are consistency; 6 is a design decision. | Open | — (independent) |

---

## 7. Tier 4 — Legacy CSS deletion sweep (component Phase D)

23 rules already deleted (ee86ab8); the sweep formalizes the rest.

| ID | Action | Status | Depends on |
|---|---|---|---|
| D-1 | `grep -rn` every family in Appendix A across `app/` — each must be 0 or a documented exception. | Not started | Tier 2 complete |
| D-2 | Delete remaining family definitions from `globals.css`. The audit's line anchors are stale (file is now 10,556 lines vs 11,775 at audit time) — re-grep for current anchors. | Started (23 rules) | D-1 |
| D-3 | Confirm: `font-black` only inside `.label-chrome` definitions; no `text-[6|7|8|9]px`; no `rounded-[…]` outside panels/sheets. | Not started | D-2 |
| D-4 | Full two-theme matrix pass + `npm test` + `npm run build` (board scenes via production build). | Not started | D-3, P-1 |

---

## 8. Tier 5 — Docs & CI enforcement (design Phase 6 + component Phase E)

| ID | Action | Status | Depends on |
|---|---|---|---|
| E-1 | **`DESIGN.md` rewrite — one PR for 6.1 + E.3:** real token contract (both palettes, semantic tokens, `.label-chrome`/`.display`, panel-shell rules, 44px targets, 10px floor, "no new Daybreak override rules — use tokens") **plus** the Components section from component audit §4; cross-link both audits. | **Done 2026-10-16** — `DESIGN.md` rewritten as the implemented-system reference: identity/themes, the three token layers (incl. the `@theme inline` and `body`-chaining gotchas), both palettes with verified values, the fluid type scale + 10px floor, all five scales, the four primitives' full contracts, the motion policy, the layout contract, do/don't rules, a11y, the gate commands, and a **§12 "pending — specified but not in force"** table so the doc cannot drift into claiming unlanded work. Cross-links the two audits, the CSS plan, this tracker, `MOTION_AUDIT.md`, and the record. Siblings still open: E-2 (MASTER.md pointer), E-3/E-4 (the guards). | — |
| E-2 | 6.2 Replace `design-system/ludo-base/MASTER.md` with a pointer to `DESIGN.md` (its Orbitron/Exo-2 palette matches no shipped theme). | Not started | E-1 |
| E-3 | 6.3 Ship `scripts/check-ui-tokens.sh` + a `ui-token-guard` CI step, diff-scoped (fails on `text-white`/`bg-white/`/`border-white/`/`text-cyan-*` in changed files); warn mode (`\|\| true`) until Tier 2 completes, then hard-fail. | Not started | — (can ship in warn mode now) |
| E-4 | E.1 Ship `scripts/check-ui-contract.sh` with the banned-pattern regex (Appendix B), diff-scoped so historical debt never blocks a merge. | Not started | Tier 2 anchors finalized |
| E-5 | E.2 ESLint `no-restricted-syntax` rules: raw `rounded-[Npx]`, sub-10px text in JSX literals, `<button` outside `Button.tsx` in **new** code (warn first). | Not started | E-4 |
| E-6 | E.4 + design 7.4: record final counts in §2 of both audits. | Not started | Tier 6 |

---

## 9. Tier 6 — Verification & sign-off (design Phase 7)

| ID | Action | Status | Depends on |
|---|---|---|---|
| S-1 | 7.1 Matrix pass: every Phase 0 surface × both themes × {375, 768, 1440}px × {default, Reduce Motion}; every delta explainable by an intentional change. | Not started | P-1, all tiers |
| S-2 | 7.2 Gates green: `npm run lint`, `npx tsc -p tsconfig.json --noEmit`, `npm test`, `npm run build`. | Not started | S-1 |
| S-3 | 7.3 Contrast spot-check (`node scripts/contrast.mjs --pairs`): all ink/surface/accent pairs at threshold in both themes. | Not started | S-2 |
| S-4 | 7.4 Final counts: `body.theme-daybreak` → 0 (or documented signatures only); `text-white` → 0; `useIsDaybreak` → 0 (already 0); "Scoped spacing repair" → 0 (already 0); `font-black` → `.label-chrome` only; `text-[6-9]px` → 0. | Not started | S-3 |
| S-5 | 7.5 Mark the design audit's Appendix B fully checked; flip its Status row to "Implemented"; close component audit D.4/E.4 alongside. | Not started | S-4, V-6 |

---

## 10. Cross-cutting rules (do not violate)

- **One PR per group**; never mix a quick win with a migration.
- **Never add a scope** to a Daybreak `:is()` list — if a panel needs a value the patch layer lacks, it uses a token.
- **The board is excluded** from the codemod: `--ludo-*` pastels and `bg-black/40` scrims stay as-is.
- **`#0052FF` survives only** as the documented `brand`-prop exception on `Button` (component audit P0-2 decision); white-fill CTAs become `primary` (accent).
- **`font-black` (900) only inside `.label-chrome`.**
- CI guards stay **diff-scoped** so historical debt never blocks a merge.
- `npm run visual:diff` is the local visual gate; **board scenes require a production build**; no browser toolchain may be installed (the harness self-drives).
- For elements with children, scripted conversions must include **both** opening and closing tags (session-3 lesson, 2026-10-15).

## 11. Optional — cross-reference from the implementation record

`docs/ops/IMPLEMENTATION_RECORD.md` Part IV ("Open work beyond the audit findings") does not mention the UI audits. Adding a one-line **prose** pointer to this tracker there (no checkbox syntax — that file is gate-protected) keeps the record the single index it claims to be.

---

## Appendix A — Legacy CSS family deletion queue (component audit §5 C.5)

`btn-main` · `btn-ghost` · `btn-mini` · `cb-btn` · `wl-btn` · `pp-btn(+active/danger)` · `play-button` · `play-now-btn` · `play-again-btn` · `ingame-cta` · `ingame-ghost` · `ingame-link` · `ingame-back` · `ingame-ready-badge` · `boot-lock-cta` · `boot-lock-ghost` · `boot-lock-badge` · `close-btn` · `profile-close-btn` · `profile-action-btn` · `settings-dots-btn` · `theme-toggle-btn` · `audio-toggle-btn` · `dm-btn` · `bet-chip` · `bet-pill` · `cb-filter-chip` · `tk-chip` · `dapp-chip` · `ai-thinking-tag` · `match-stats-chip` · `seg-btn` · `bet-pills` · `cb-mode-pill` · `tkpick-btn` · `pct-btn` · `rev-btns` · `sec-tag` · `cb-section-tag` · `dapp-chips` · `cb-asset-pill*`

Live exceptions today: **`theme-inline-btn`** (last consumer `TokenStyleSwitcher.tsx` → delete at G7). Already deleted with tombstones: `settings-action-btn`, `theme-nudge-chip`, `theme-nudge-close`. Variant mapping per family lives in component audit §5.1 — that table is authoritative; do not fork it.

## Appendix B — Banned patterns for the enforcement scripts (component audit E.1)

```bash
BANNED='text-\[(6|7|8|9)px\]|rounded-\[(?!32|28|26|24|22|100)|\bfont-black\b(?!.*label-chrome)|\bbg-cyan-500\b|#0052FF'
```

Finalize the regex against real leftovers when E-4 ships; keep the check diff-scoped.

## Appendix C — Commands used by the gates

```bash
# per-group legacy-family gate (expect 0 for the group's files)
grep -rn "btn-main\|cb-btn\|wl-btn" app/components/<group-files>

# patch-layer burn-down (record per group; now 522, target 0)
grep -c "body.theme-daybreak" app/globals.css

# visual gate (production build for board scenes)
npm run build && npm start   # then, in another shell:
npm run visual:diff

# reduced-motion gate (design 1.5.4)
npm run check:reduce-motion

# standard gates
npm run lint && npx tsc -p tsconfig.json --noEmit && npm test

# contrast gate
node scripts/contrast.mjs --pairs
```

---

*End of tracker. Keep this file's statuses in sync with reality; when a tier closes, update §1 and §2 rather than adding a new doc.*
