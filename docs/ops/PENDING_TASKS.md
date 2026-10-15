# Ludo Base — Pending Development Tasks (project-wide backlog)

| | |
|---|---|
| **Created** | 2026-10-15 |
| **Scope** | All incomplete or pending engineering work in the repo, consolidated and dependency-ordered, with implementation steps and verification criteria per item |
| **Companion docs** | `docs/ops/UI_AUDIT_TRACKER.md` (UI-audit detail — do not duplicate) · `docs/ops/IMPLEMENTATION_RECORD.md` (the authoritative closure record — **when an item here closes, record it there in prose**) · `docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md` Rev 3 (invariants Appendix B, specs §4.x) · `docs/architecture/WORKLOAD_PLACEMENT_MATRIX.md` Rev 3 · `docs/ops/CSS_LAYOUT_ANIMATION_PLAN.md` |
| **How to read** | Priority = impact × (what it blocks). Each item has concrete steps and a "Verify" line naming the command or artifact that proves done. Strike items here only when the record carries the closure. |

---

## 0. Dependency map

```
A1 P0 DO spike ──┬──> A3 P3 room/transport ──> A4 P4 relocation/clock
                 └──> NET-03a/b channel decision ──> H2 mainnet (owner call)
B  UI sweep ──── (independent; in flight) ────> UI design docs + enforcement
F1 funded Sepolia acceptance ──> H2 mainnet (owner call)
C  CSS plan ──── unblocked now (visual harness + playwright confirmed working)
D  device/live evidence ── needs hardware or a live session (schedule externally)
E  quality residuals ── independent, cheap
G/I owner decisions & later product ── external
```

**Priority queue:** ① A1 → ② B (UI sweep) → ③ F1 → ④ C1–C4 → ⑤ E1/E2/E4 → ⑥ D (schedule hardware) → ⑦ G/H/I (owner/external).

---

## Track A — Server-authority migration (P0; largest deferred engineering; **not started**)

Verified evidence: `wrangler.jsonc` has `main: ".open-next/worker.js"`, **no** `durable_objects`, **no** `migrations`; `src/worker.ts` does not exist. The P0 spike is the gate — nothing in A3/A4 may be designed before it passes.

### A1 — P0 spike: custom worker entry + DO wiring

Spec: plan §4.4 (verbatim `src/worker.ts` scaffold), matrix §2 inventory row.

1. Create `src/worker.ts`: re-export the OpenNext handler, declare `MatchRoom` + `RateLimitDO` classes, the WebSocket fast-path, and a `scheduled` (Cron) export.
2. Edit `wrangler.jsonc`: switch `main` → `src/worker.ts`; add `durable_objects.bindings` (`MATCH_ROOM` → `MatchRoom`, `RATE_LIMIT_DO` → `RateLimitDO`) and a `migrations` entry for the chosen DO class/storage.
3. Keep the `.open-next/worker.js` contract intact for instant rollback; do not delete OpenNext output.
4. Add the DO storage/concurrency unit tests (single-alarm timer min-heap; `blockConcurrencyWhile` + FIFO action queue).
5. Local dev: wire `NEXT_PUBLIC_ROOM_WS_URL` + one §4.13 option (A staging tunnel / B `scripts/dev-room-server.ts` sidecar / C offline fallback) so `npm run dev` no longer 404s on room sockets.

**Verify:** `npm run build` succeeds; `opennextjs-cloudflare deploy` (or `preview`) runs against `src/worker.ts` with **no** `.open-next/worker.js` validation warnings (the plan's P0 acceptance); `npm test` + `npm run check:routes` unchanged (47 routes, 1 known-weak).

### A2 — P1 foundations: rate limiting + paid baseline

Spec: plan §5-P1 (CF native Rate Limiting binding **first**; DO counters only if needed, sharded by colo+routeClass+ipPrefix, mutations only, reads stay in-process), matrix §8/§9 (Workers Paid $5/mo from P1 — 240 frames × matches ≈ 96k req/day, free tier exhausts under 150 DAP).

1. Add the native CF Rate Limiting binding config to `wrangler.jsonc` and consume it at the mutation routes.
2. Leave `lib/rateLimit.ts`'s in-process Map as the read path; document why KV is still ruled out (1,000 writes/day free tier).
3. Set the Workers Paid plan as the Day-1 assumption in the deploy config.

**Verify:** binding present in `wrangler.jsonc`; a burst against one mutation route returns 429 at the configured rate; `scripts/rate-limit.test.ts` green; `npm test` green.

### A3 — P3: room as transport/`seq`/fan-out/reconnect — **a pure HTTP proxy of the untouched Edge functions**

Hard rule: do **not** refactor `move-auth` in P3 (`match_commit_action` relocation moved to P4). Specs: §4.4 (concurrency), §4.13 (local dev), §4.5/4.7 (WS auth), §4.9 (failure rows), §4.11 (latency), §5-P3, matrix §3B/§6/§10.

1. Implement only transport, `seq`, fan-out, reconnect; rules and roll minting stay delegated to the Edge functions (no engine fork).
2. WS auth: ticket query param at connect; socket held `unauthenticated` until the in-band `join` token upgrade (§4.5/4.7); add the §4.9 failure rows.
3. Concurrency: single-alarm timer min-heap + `blockConcurrencyWhile`/FIFO action queue (§4.4) with the §6 concurrency test.

**Verify:** DO concurrency tests green inside `npm run test:concurrency`; reconnect/seq drills green (`npm run test:netcode`); the ~180–350 ms cross-cloud latency breakdown from §4.11 re-measured; `npm run check:engine` still green (one engine unchanged); `npm test` green.

### A4 — P4: relocation, clock, and server-originated flows

Spec: §5-P4, matrix §3B/§6/§10.

1. Relocate `match_commit_action` (atomic RPC) + validation/minting in-process into the DO.
2. DO alarms as the clock; AI turns; server-originated settle/record/stream.
3. Add the engine third copy and the `check:engine` third target.

**Verify:** `npm run check:engine` passes three-way (Edge vs DO vs `lib/`); `npm test` green; P4 exit recorded in `IMPLEMENTATION_RECORD.md`.

---

## Track B — UI audits (P1; **in flight** — detail lives in `docs/ops/UI_AUDIT_TRACKER.md`)

Status: primitives + shell/settings + five team-groups landed; raw `<button>` 348 → **238**. This session closed every Tier 0 verification (V-1–V-6), shipped the Phase 4.0 codemod (P-2), fixed a build break the gates exposed (missing `Button`/`Chip` imports + a dangling `pct` ref in the wallet sheets), and finished converting every consumer of the deleted legacy families (which makes the uncommitted −697-line `globals.css` deletion safe). Remaining:

1. Continue the sweep per the tracker's §5.2: wallet remainder (`BurnPanel`, `BurnFeed`, `ChipsWalletPanel`, `WalletPanel`, `WalletShell`, `WalletDetailsSheet`, `LudoWalletModal`, `SendNativeSheet`, `WalletConnectCard`), social remainder, `TeamUpMatchPanel`'s 13 bespoke raw buttons, match-sheet remainder, then chrome/lobby (G9 last).
2. `theme-inline-btn` deletion with G7 (`TokenStyleSwitcher.tsx` is its last consumer).
3. Tier 3 typography (T-1–T-5), Tier 4 deletion sweep (D-1–D-4; D-1 already passes for the uncommitted diff), Tier 5 docs/CI (E-1–E-6), Tier 6 sign-off (S-1–S-5).

**Verify (per group):** family grep → 0 for the group's files; `grep -c "body.theme-daybreak" app/globals.css` non-increasing (now 522, target 0); `npm run visual:diff` clean both themes at 375/1440; lint + tsc + `npm test` green.

---

## Track C — CSS layout & animation leftovers (was deferred on the visual harness — **now unblocked**)

Verified: the `playwright` library is installed and chromium is cached (`~/Library/Caches/ms-playwright/chromium-1208`); `npm run visual:diff` / `check:reduce-motion` drive it locally. (The record's "@playwright/test is not installed" refers to the test runner only — the harness needs neither it nor a new dependency.) Track: `CSS_LAYOUT_ANIMATION_PLAN.md`.

- **C1 — `globals.css` module split** (10,556 lines). **Verify:** `npm run bench:css` counts sane per module; `visual:diff` clean; `npm run build` green.
- **C2 — fluid board `clamp()` sizing.** **Verify:** board scenes clean at 320/375/768/1440 (extend `scripts/visual-diff.mjs` widths); `check:motion` green.
- **C3 — container queries.** **Verify:** same width matrix, no layout shift vs baseline.
- **C4 — mass type migration** (589 hardcoded `text-[Npx]` sites). **Coordinate with UI tracker T-1** (`.label-chrome`) so one contract lands, not two. **Verify:** `bench:css` type-scale adoption line rises; zero sub-10px text; `visual:diff` clean.
- **C5 — `next/image` for LCP art.** **Verify:** `npm run preview` (OpenNext/Cloudflare pipeline) serves optimized art; CLS unchanged on `visual:diff`.
- **Stale-doc flag:** the record's Part V lists "reset layering deferred" — it landed (commit 77162c0; "Scoped spacing repair" = 0). Correct on the next record edit.

---

## Track D — Netcode & device evidence (record Part IV; needs hardware or a live session)

- **D1 — Q2 phone-hop pass + Android device trace.** One physical mid-range device + a live networked match closes both. **Verify:** `docs/ops/DEVICE_PASS.md` filled; the Part III deferral flipped in the record.
- **D2 — N3 live D1–D4 with two real clients** (drills exist and terminate locally; the live run has never happened). **Verify:** drill logs in `docs/ops/NETCODE_DRILLS.md`; `npm run drill:live` green against production endpoints.
- **D3 — Sentry `session_start` one-shot confirmation in the UI.** **Verify:** the event visible in Sentry from a real session.
- **D4 — FSM illegal-transition soak week.** **Verify:** counters recorded over 7 consecutive days.
- **D5 — live `net_*` dashboard + forced-reconnect drill sign-off.** **Verify:** dashboard URL + one signed-off drill.
- **D6 — flip `UNPARK_DECISION.md` to DECIDED** and mirror in the record.

---

## Track E — Quality residuals (independent, cheap)

- **E1 — eslint file-level disables burn-down** (`lib/` legacy modules). **Swept 2026-10-15:** `scripts/eslint-disable-sweep.sh` (new) removes a file-level disable only if the file still lints clean without it; result: **0 of 73 removable** — every remaining one still suppresses a real `any`/unused-var, so the rest is per-file typing work, not a mechanical sweep. **Verify:** `grep -rn "eslint-disable" lib hooks app | wc -l` trending down as files are typed; `npm run lint` clean.
- **E2 — full Foundry suite in CI + gas snapshot gate** (also closes M11's CI half; `npm run test:contracts` gives a local runner today). **Verify:** a CI step runs the Foundry suite; `SuffixAttributionTest` executes in CI.
- **E3 — verify `isActivated(ASSET)` recorded in `TOKEN_PARAMS`** after the Sepolia deploy sequence. **Verify:** the on-chain read (tx/explorer evidence) pasted into the record.
- **E4 — Builder Code placeholder** (`lib/builderCode.ts:15` ships `"TODO-from-base.dev"`; the `startsWith("TODO")` guard already trips). **Verify:** real `NEXT_PUBLIC_BUILDER_CODE` from base.dev set per environment; guard silent in production.

---

## Track F — CHIPS value track (money path acceptance)

- **F1 — first funded paid join/claim on Sepolia** (the acceptance event for the value path). **Verify:** tx hash + claim state recorded in `IMPLEMENTATION_RECORD.md`.
- **F2 — timeout-refund watcher live** + custody runbook (`docs/ops/CHIPS_WATCHER_RUNBOOK.md`). **Verify:** watcher running; one observed timeout-refund event.
- **F3 — `lib/chipsIndexer.ts` Phase-1 skeleton → real indexer** (replace the in-memory Phase-1 cache). **Verify:** indexer reads chain state with tests; no in-memory-only path in production.

---

## Track G — C0 / economic freeze (owner decisions, external)

- G1 sybil spreadsheet published + signed (`docs/tokenomics/C0_FREEZE_PACK.md` §1).
- G2 counsel L1–L6 written issue-spot + geo table.
- G3 welcome-grant ship/no-ship + liquidity owner/date in `TOKEN_PARAMS`.

---

## Track H — Deferrals needing owner action or credentials

- **H1 — NET-03a/b private room channel** — blocked on credentials; takes design input from A1/A3 (settled P3 boundary: proxy the Edge functions, no fork).
- **H2 — Base mainnet deploy** — owner call; sequence after F1 (funded Sepolia acceptance) and Track A landing.
- **H3 — Android device trace** — folded into D1.

---

## Track I — Later product

- Tournaments economy.
- Spectator predict — needs its own legal gate (the SEC-05-bet hole is why it waits).
- Paymaster funding — interface only until G/C0 close.

---

## Verification commands (one place)

```bash
npm run lint && npm run typecheck && npm test          # standard gates
npm run check:engine && npm run check:routes           # engine parity + route matrix
npm run check:motion && npm run check:img              # motion + image gates
npm run check:reduce-motion                            # reduced-motion gate (design 1.5.4)
npm run build && npm start   # then: npm run visual:diff   # visual gate (prod build)
npm run bench:css && node scripts/contrast.mjs --pairs # metrics + contrast
npm run test:contracts && npm run test:concurrency     # foundry + DO concurrency
npm run drill:live                                     # live netcode drills (needs prod endpoints)
```

## Appendix — verified evidence for the statuses above (2026-10-15)

- `wrangler.jsonc`: `main = .open-next/worker.js`, no `durable_objects`, no `migrations`; `src/worker.ts` absent → Track A not started.
- `node_modules/playwright` present + chromium-1208 cached → Track C unblocked; visual gates run locally.
- "Scoped spacing repair" = 0; `useIsDaybreak` = 0 code refs; Daybreak status tokens corrected (`#92400e/#166534/#b91c1c`) → reset layering + design P1/P2/P3 landed.
- Only real code TODO in `lib/`: the `builderCode.ts` placeholder (E4); the `@deprecated` marks are intentional decrypt-only legacy paths guarded by tests.
- UI detail and per-group statuses: `docs/ops/UI_AUDIT_TRACKER.md`; both audits' own checkboxes are stale (item V-6).

*When an item closes: record the closure in `IMPLEMENTATION_RECORD.md` (prose — that file is gate-protected against checkbox syntax), then strike it here.*
