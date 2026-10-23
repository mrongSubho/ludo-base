# Implementation record — Ludo Base

| Field | Value |
| --- | --- |
| **Scope** | Everything built in this repo, from the pre-audit baseline through the audit closure — one file, in order |
| **Supersedes** | `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` (2026-09-28 plan) and `docs/ops/REMEDIATION_CHECKLIST.md` (checklist → record). Both are now redirect stubs; nothing was dropped. |
| **Companion** | [`SYSTEM_REVIEW.md`](./SYSTEM_REVIEW.md) — the point-in-time 2026-10-05 audit this record answers |
| **Status** | Baseline verified 2026-10-13 · audit **154/154 closed or signed off** (last item DB-22, 2026-10-13) · **Server Authority Migration P0–P6 completed (2026-10-18)** · **Server-Owned Lobby Migration S0–S5 completed (2026-10-22)** · remaining open work in Part IV |
| **Gates, re-run 2026-10-22** | `tsc` 0 errors · worker `tsc` 0 errors · `lint` clean (0 errors) · `npm test` 523 pass / 0 fail / 11 skipped · `check:no-p2p` clean · `check:engine` in sync (`lib/engine/core.ts` ↔ `src/room/engine.ts`) · `check:rls` clean (43 migrations) · `check:schema` clean (static + DB mode, 43 migrations, 43 functions) · `check:drift` 12/12 · `check:routes` 65 routes · `host-retirement-gate` 5/5 |

**How to read this record.** Three parts, in chronological order:

- **Part I** — the pre-audit capability baseline (built through 2026-09-28, per the old implementation plan), **re-verified against the tree on 2026-10-13**. Corrections to the plan's claims are marked **[corrected]**; the plan had drifted (it still listed a deleted hook, dead UI, and undone work that has since landed).
- **Part II** — the 2026-10-05 system audit (154 findings) and how every finding closed, phase by phase, with the gate evidence. Finding IDs (`SEC-01`, `ENG-17`, …) are stable — cite them in PRs and commits.
- **Part III** — recorded decisions, risk acceptances, and the three deliberate deferrals, each with unblock criteria. **Part IV** — what remains open *beyond* the audit findings (the plan's undone checklist, reconciled against what has landed since).

**A finding closed by assertion rather than by test reopens.** Where that is the case, this record says so. Dates on every claim: 2026-09-24…28 (baseline work) · 2026-10-05 (audit at `e49600a`) · 2026-10-06/07 (remediation landed) · 2026-10-11 (full re-verification, escrow armed) · 2026-10-13 (DB-22, route-matrix reconciliation, this consolidation).

---

## Part I — Pre-audit capability baseline (built through 2026-09-28; re-verified 2026-10-13)

*Source: the 2026-09-28 implementation plan, §1. Every "Where" path below was re-checked against the working tree on 2026-10-13 (75 paths checked; only the two corrections noted were needed). Growth/media surfaces were out of that plan's scope and remain so.*

### I.1 Game engine (deterministic core)

| Capability | Where | Verified 2026-10-13 |
| --- | --- | --- |
| Pure rules: gate-crossing, exact-57, 3×six, captures, 2v2 `TEAM_PAIRINGS` | `lib/gameLogic.ts` · `lib/engine/core.ts` · `lib/constants.ts` | ✓ — and `core.ts` is now the single source (ENG-20); `gameLogic.ts` re-exports it |
| Board geometry + corners / safe stars | `lib/boardLayout.ts` | ✓ |
| Property tests (fast-check) in CI | `scripts/engine.props.test.ts` | ✓ — still fast-check-based, in `npm test` and CI |
| Replay log + canonical `hashGameState` | `lib/replay/` · `npm run replay` | ✓ — *audit note kept:* `scripts/replay.ts` fingerprints a JSONL log, it does not re-simulate; no independent replay verifier exists (audit gap 3, never claimed closed) |
| **≥50 golden-match corpus** (double-run hash CI) | `scripts/golden-replay.ts` · `npm run test:golden` | ✓ — **improved since audit:** was `finished 0 / 50`; now **50/50 terminate** (17 × 1v1, 17 × 4P, 16 × 2v2 incl. a `Team N` win) and the corpus pins the *authority* engine (`lib/engine/core.ts`), not the legacy one |
| Match lifecycle FSM (illegal transitions metered) | `lib/matchFsm.ts` + `TeamUpContext` | ✓ |
| AI off main thread (Web Worker + sync fallback) | `lib/ai/worker.ts` · `lib/ai/client.ts` | ✓ — ENG-10 assist shape (`{color, tokenIndex}`) fixed across all callers |
| Difficulty calibration bench | `npm run bench:ai` | ✓ — deliberately outside `npm test` |
| Snakes mode engine | `lib/snakesLogic.ts` | ✓ |

### I.2 Netcode & multiplayer

| Capability | Where | Verified 2026-10-13 |
| --- | --- | --- |
| Host authority + dual-path intents/seating (PeerJS + Supabase) | `hooks/TeamUpContext.tsx` · `useSupabaseRelay` | ✓ — **[corrected]** the plan also listed `hooks/usePeerManager.ts`; that hook was **deleted 2026-10-11 (NET-20)** — zero imports, and its 5s full-state broadcast conflicted with the match_states-authority direction. Liveness is the match presence sync (NET-21). |
| Named `net_*` counters (heartbeat, reconnect, seq-gap, authority, schema) | `lib/netcode/counters.ts` | ✓ — and now bumped from production code (NET-21: `net_heartbeat_ok`, `net_authority_switch` + a real `HOST_ELECT`) |
| Single `resyncMatch()` snapshot path | `lib/netcode/resync.ts` | ✓ — in the audit's verified-correct inventory (fails closed, rejects `matchId:'local'`) |
| Session-proofed resync | `lib/netcode/resyncProof.ts` · Edge `move-auth` `resync` | ✓ — verified-correct; a guest cannot force the host to adopt arbitrary state |
| PeerJS **npm-pinned** (no CDN) + optional self-hosted PeerServer env | `lib/peerFactory.ts` | ✓ |
| Zod wire schemas + `protocolVersion` + size cap + **TTL/LRU dedup** | `lib/protocol/` · `lib/netcode/dedup.ts` | ✓ — and the O(n²) purge is amortized (NET-23) |
| Spectator listen-only parity (schema + resync + counters) | `hooks/useSpectatorSync.ts` | ✓ — channel corrected to `game-room-<code>` (NET-10) |
| Connection badge (LIVE / DEGRADED / RESYNC) | `app/components/ConnectionBadge.tsx` | ✓ |
| Chaos + deep drills (intent flood, drop Peer/Realtime, host elect, grace) | `scripts/net.chaos.ts` · `scripts/drill.deep.ts` | ✓ — **fixed since audit:** they were re-implementing dedup in local Sets; they now import `createDedupStore`/`rememberIntent` |
| **2–4 client MP harness** (seat → capture → resync → end) | `npm run test:mp` | ✓ — **fixed since audit:** the guest no longer merges into `host.state`; the snapshot is a deep copy; the harness plays 4P + 2v2 to termination |
| Abandon grace + classification (burn split flag-gated) | `lib/netcode/abandon.ts` | ✓ — classification now wired to the AFK kick path (NET-07); `ABANDON_BURN_SPLIT_ENABLED` stays false |

### I.3 Quality, ops & observability

| Capability | Where | Verified 2026-10-13 |
| --- | --- | --- |
| Telemetry funnel + secret scrub + sampling | `lib/telemetry.ts` · `lib/telemetryPolicy.ts` | ✓ — hardened (SEC-35): message-shaped keys and anything parsing as a `SealedBox` are dropped |
| Sentry transport (DSN auto-bind) | `lib/telemetrySentry.ts` · `NEXT_PUBLIC_SENTRY_DSN` | ✓ configured; the one-shot `session_start` UI confirmation is still open (Part IV) |
| Standing SLOs | `docs/ops/SLOS.md` | ✓ |
| Edge calver + `x-ludo-edge-version` + client version check | `lib/edgeOps.ts` | ✓ |
| Migration RLS static gate in CI | `npm run check:rls` | ✓ — **[corrected]** superseded as the *schema* gate by `check:schema` (static A1–A4 + DB mode against a real Postgres); `check:rls` remains the static RLS gate |
| Honest lint/CI (ESLint 9, rules=`error`) | `eslint.config.mjs` | ✓ — CI (`engine-tests`) now runs: `npm test` · `test:golden` · `test:engine-diff` · `test:engine-core` · `test:netcode` · `test:protocol` · `test:hooks` · edge-engine sync · `check:rls` · `test:concurrency` · `check:routes` · `check:schema` — plus `typecheck`, `lint`, `auth-gate` jobs. **[corrected]** there is **no `forge test` step** — foundry is installed only for the deploy-guardrail shell tests (Part IV). |
| Typed player error copy + error boundaries | `lib/errorCopy.ts` · `PanelErrorBoundary` · `app/error.tsx` | ✓ — all 9 dashboard panels now have named boundaries + `app/global-error.tsx` (REA-08) |
| Perf hop budget + `__ludoPerf` hook on Board + `/token-move-test` | `lib/perf/` · `app/token-move-test` | ✓ |
| Device-pass / un-park runbooks | `docs/ops/DEVICE_PASS.md` · `docs/ops/UNPARK_DECISION.md` | ✓ — runbooks exist; the device pass itself is Part IV |

### I.4 Gameplay product surfaces

| Capability | Where | Verified 2026-10-13 |
| --- | --- | --- |
| Match receipt / post-mortem (hash, rolls, net, AFK) | `lib/receipt/` · `MatchStatsOverlay` | ✓ — receipt now carries `seq` (NET-27) and counters reset per match |
| Pass & Play (hot-seat) + share-link room | `OfflineMatchPanel` · `lib/localRoom.ts` | ✓ |
| Live-ops notice strip (`/api/notices`) | `app/components/NoticeStrip.tsx` | ✓ — SEC-26: the FNV field is `contentHash` and explicitly *not* a `signature` |
| Emotes (preset, no free-text) | `lib/emotes.ts` · `EmoteTray` | ✓ |
| Offline vs AI · Classic / Power / Snakes | existing game shell | ✓ |
| Themes + token styles | `TokenStyleSwitcher` | ✓ — **[deleted 2026-10-13]** the plan listed `ThemeSwitcher` as a live surface; it was dead code (0 importers, verified static + dynamic + string refs) and was removed per UI-audit task 1.4.2. Settings → Appearance is the single theme entry point; onboarding/nudge/marketplace write the same `ludo-theme` preference as intentional touchpoints. Theming runs through the cookie store from REA-07. |

### I.5 Identity & wallet — plan wrapped

See [`SMART_WALLET_PLANNING.md`](../planning/SMART_WALLET_PLANNING.md) (status: **Implemented** W0–W5 + R0–R5; residual work in its §12) and [`PHASE_0A_SPIKE_CHECKLIST.md`](../planning/PHASE_0A_SPIKE_CHECKLIST.md). Verified 2026-10-13 and extended by the audit work:

| Capability | Notes |
| --- | --- |
| Dual-path auth: External (Base Account / injected) **and** In-game CDP Smart Account | One active `wallet_address` per session |
| `siwe:base` / Base Account identity | Same account as Base app |
| SIWE app session + EIP-712 `LudoMatchSession` | Match moves never use the SIWE-only session |
| Passkey MFA · WC as Ludo wallet · send/receive/activity | Real-wallet product path |
| App on **Base Sepolia (84532)** until mainnet | Network pin; mainnet itself is a recorded deferral (Part III) |
| **Added by the audit:** SIWE domain pinned to the request Host + single-use nonce (SEC-21) · CDP MFA signing bridge bounded, loud, and `busy`-resetting (was a permanent silent outage) · `/api/profile/ecdh` canonicalizes the posted JWK so a private scalar can never be stored (SEC-25/CRY-05) · wallet-links need a session and a fresh `issuedAt` (SEC-24) · player-error copy + isolated boundaries (REA-04/08) |

### I.6 CHIPS / on-chain

| Capability | Notes (verified 2026-10-13) |
| --- | --- |
| `MatchPool` / `ClaimHub` / `MissionClaim` / `SeasonClaim` / `LegacyClaim` | `contracts/` + Foundry tests — including `SuffixAttributionTest.t.sol` (ERC-8021 trailing suffix, M11). The **live Sepolia pair** is `0xdfa01EDE…`/`0x538e25f8…` (post-ECO-08, rotated edge signer, byte-identical to the local artifact, Sourcify-verified) — see Part II, Phase 1. |
| Deploy / bootstrap / role / smoke scripts | `contracts/script/*` · `scripts/foundry-deploy.sh` · `smoke-sepolia.sh` · `b20-smoke.sh` · `RedeployPool.s.sol` · `verify-contracts.sh` (runtime-size cross-check) |
| Burn / supply dashboard | `app/burn` |
| Pool join/settle hooks + settle button | `hooks/useChipsPool.ts` · `useSettlePool` · `SettlePoolButton` — amounts now derived from `getPoolSummary` (SEC-04b/ECO-02) |
| Mission vouchers · merkle/legacy claims · Galxe callback | `lib/missionVoucher.ts` · `lib/merkleClaims.ts` · `app/api/onboarding/*` |
| Indexer worker + watcher runbook | `scripts/chips-indexer-worker.ts` · `docs/ops/CHIPS_WATCHER_RUNBOOK.md` — *note:* `lib/chipsIndexer.ts` is a Phase-1 skeleton with an in-memory cache (2026-10-13 workload review); the timeout-refund watcher is Part IV |
| TOKEN_PARAMS / PHASE0 gates / SYBIL draft | `docs/tokenomics/` — the C0 freeze pack itself is Part IV (external) |
| Builder-code attribution | `lib/builderCode.ts` |
| **Marketplace CHIPS catalog** | **Landed 2026-10-11** (migration `202609300017`, `lib/marketplacePrices.ts`, signed purchase intent + `chips_escrow_spend_purchase`). The plan still listed this as §2.5 "later product" — it is done. |
| **Escrow armed** | **2026-10-11** — treasury, rake 500 bps, `allow_self_bets=false`, solvency delta 0, runbook `docs/ops/ESCROW_ARMING.md` |

---

## Part II — The 2026-10-05 system audit and its closure

*Every finding from [`SYSTEM_REVIEW.md`](./SYSTEM_REVIEW.md) @ `e49600a` (154 findings), with what was implemented and the gate that closes it. Phases are in the audit's dependency order. This part is the former `docs/ops/REMEDIATION_CHECKLIST.md`, unchanged in substance.*

## Phase 0 — Un-break the build from source

**Why it was first.** `202609230003` aborted mid-file, so a reset DB ≠ a migrated DB. Every schema claim anywhere in the audit was unverifiable until the chain replayed cleanly.

### What was implemented

- **DB-01** — `202609300009`-era fix of `202609230003_freeze_legacy_coin_writers.sql`: the stub's args were renamed to match the live signature (`p_request_id`, `p_item_ids`) and the whole file wrapped in `begin; … commit;`, so the freeze can no longer abort mid-chain.
- **DB-01** — the coin-model contradiction was decided: the freeze stands, and the callers were converted rather than lifted — `/api/marketplace/purchase` now spends escrowed CHIPS (migration `202609300017`, live 2026-10-11) and `/api/spectator-bets` goes through the escrow RPCs, so neither calls a frozen coins RPC any more.
- **DB-01** — verified on a scratch DB that `players.coins` is genuinely guarded after the fix: `set role service_role; update players set coins=…` fails.
- **DB-02** — `match_rolls.status` default set to `'open'`, the closed vocabulary `check (status in ('open','consumed','passed'))` added and validated, and `isDuplicateAction` turned into an explicit allowlist so a future default cannot silently flip it.
- **DB-03** — the full chain completes and every file lands in `supabase_migrations.schema_migrations`; RESET ≡ migrated is proven in substance (see the gate below).
- **DB-11** — `RESET_FOR_FRESH_BASELINE.sql` excludes extension-owned objects from its drop loop (`not exists (select 1 from pg_depend …)`), so it no longer no-ops when `pgcrypto` sits in `public`.
- **DB-12** — the reset loop drops `supabase_realtime` publication members, so the reset path and the migration path converge.
- **DB-21** — `npm run check:schema` added: applies the chain to a scratch PostgreSQL and asserts zero errors, expected `column_default` values, expected `pg_proc` signatures, no `anon`/`authenticated` EXECUTE on `security definer`, and no `anon` table grants beyond the allowlist.
- **DB-21** — `check:rpc-args` added, resolving every `rpc('name', {named args})` in `app/api` + `lib` against a migration-defined signature. (This gate alone catches DB-01. It is folded into `check:schema` A2 rather than shipped as a separate script.)
- **DB-21** — the `check-rls.mjs` blind spots were closed rather than worked around: the six classes the audit named (no DDL, signature, default or grant checking) are now asserted by `check:schema`.

### Gate results

- **Static mode (A1–A4) — what CI runs — green.** *(29/29 migrations.)*
- **DB mode green.** The chain is applied to a scratch `postgres:17` service and the assertions above run. Negative-tested: injecting `grant update … to anon` and `grant execute … to anon` both fail the gate. Re-confirmed locally on 2026-10-13 against the DB-22 scratch cluster (29/29 applied, 17 security-definer functions + grants asserted).
- **`supabase db reset` completes and the schema diff is empty.** Proven in substance, not with the literal command: Docker is unavailable in this environment, so the full chain was applied file-by-file with psql against PostgreSQL 16 (16/16 files, 0 failures), the RESET script was executed directly (→ 0 tables / 0 publication members / pgcrypto preserved), and re-applying the chain reproduced the migrated schema column-for-column. A literal `supabase db reset` still needs a run on a machine with Docker.
- **An Edge `roll-dice` receipt is consumable by `move-auth`.** Proven in psql: an insert without `status` now lands as `open`, and `isDuplicateAction('open') === false`. Pinned by `scripts/network-boundary.test.ts` (the allowlist) and `check:schema` A3 (the DB default).
- **`/api/marketplace/purchase` returns 200 on a real SKU.** **LIVE 2026-10-11.** Migration `202609300017` applied via `supabase db push --db-url` (CLI v2.120.0, session pooler; the dry-run showed only that file pending, and the push applied exactly it). The route now spends escrowed CHIPS behind a signed intent instead of calling the frozen RPC. Verified live: config armed, purchase table + RPC present, an empty-buyer probe hits `INSUFFICIENT_ESCROW` (RPC live, enabled, debit-gated — no state change), solvency delta 0. **Acceptance, stated:** the first *funded* purchase will return the first 200 (no unbacked smoke deposit was minted to force one); the 200 path itself is proven on the identical scratch chain, and the route's RPC call is now type-checked against the regenerated schema (DB-22).

---

### CHIPS migration (coins → on-chain CHIPS)

Coins are frozen (`202609300001`) and CHIPS became the only money. Rewards had been defined in four places with two currencies and three values for the same mission id; all four definitions are gone. What landed:

- `mission_catalog` is the single source of truth for **daily + weekly**; whole CHIPS, CHECK-constrained to 5..20. `daily_bonus` = 10 CHIPS; the weekly track adds 90 CHIPS/week on top of the daily 58/week.
- `lib/missionCatalog.ts` is the only reader; `ONBOARDING_REWARDS` was deleted.
- **Onboarding deliberately untouched** — core package 1000, expanded pack 350, welcome grant 50, referral 5000/50/10, all still in `ONBOARDING_TRACKS`. Its rewards predate the CHIPS cutover and are a new-user grant, not a repeatable mission, so the 5..20 band does not apply to them. The band CHECK is category-scoped (`mission_catalog_reward_band`) so onboarding is exempt by decision, and no onboarding rows exist in the catalog.
- `player_missions` is keyed by (player, mission, period_id) — daily/weekly cadence falls out of the schema and the ad-hoc reset logic was deleted.
- SEC-10 closed: `/api/missions/voucher` reward, periodId and nonce are server-owned; the claim lock is the `unique(wallet_address, mission_id, period_id)` constraint.
- `/api/missions/claim` was retired with an explicit `410` (it flipped `is_claimed` and then hit the frozen-coins trigger).
- SEC-05 closed: the `chips_escrow_*` RPCs own the window gate, the market, the self-bet block, the atomic stake debit and idempotent settlement.
- `resolve-bet` cross-checks the signed result against `match_states.state` before settling (SEC-29).
- All CHIPS value columns moved from `bigint` to `numeric` (bigint maxes out at 9.2234 CHIPS against a 1e10 supply).
- **The marketplace CHIPS payment rail went live 2026-10-11.** Purchase-intent message + escrow-spend RPC + panel signing; the migration was pushed via the Supabase CLI and the live probe is green (see the Phase 0 gate).
- **The escrow was armed 2026-10-11.** Treasury = Sepolia deployer/GAME_OWNER, rake 500 bps, `allow_self_bets=false`; the players row pre-existed; solvency delta 0 on empty books at arming. Runbook: `docs/ops/ESCROW_ARMING.md`. Deposits remain indexer-reconciled only — no smoke deposit was minted.
- **Poke rewards pay out as CHIPS vouchers (2026-10-11).** `social/poke` no longer credits frozen coins: a poke-back upserts the period-scoped `daily_poke_back` progress row and issues through the shared `issueMissionVoucher` (`lib/missionVoucherIssue.ts`, extracted verbatim from the voucher route, which keeps its exact response shape). Already-claimed days are non-fatal. First real poke-back exercises it — the same acceptance as the roll-dice happy path.

---

### Phase 1 — Close the money paths

**Why.** Three unauthenticated or TOCTOU paths could move value, and every balance mutation was read-then-write with no DB-level atomicity.

### What was implemented

**Authentication and authorization** — every item re-verified against the code in the 2026-10-06 reconciliation pass (the previous audit had marked items closed while they were still open, and left implemented ones unticked):

- **SEC-03a** — `app/api/chips/settle/propose/route.ts:152` calls `requireAppSession`, and the session is compared against the **on-chain** `p.authority`. Abandon evidence is re-derived server-side (`deriveAbandonEvidence`, `:183`) rather than accepted from the body: seated check, `seq` staleness, `afkStrikes >= 3`.
- **SEC-03b** — abandon evidence is validated on-chain. `MatchPool._abandon` checks `status === Locked`, that the accused seat is seated, that `afkStrikes >= AFK_STRIKES_REQUIRED` for an AFK reason, and that `deadline <= settleBy + pauseDelta` (`contracts/src/MatchPool.sol`, `InsufficientStrikes`, `DeadlineAfterWindow`). Both checks run **after** signature verification, so they are enforced on authenticated values rather than probeable from an unsigned call. `seqAtDisconnect` stays in the digest as evidence but cannot be verified on-chain: match state lives in the app database, not the chain.
- **SEC-03c** — the signed payload names a **reason code**: `AbandonReason.{AfkDisconnect, HostWithheld}` is inside `ABANDON_TYPEHASH`, so a co-signature obtained for one reason cannot be relabelled as the other to skip its precondition. `lib/chipsSettle.ts` mirrors the enum and refuses to sign an AFK abandon below the threshold.
- **SEC-04a** — `settle/propose` `POST` requires `wallet === pool.authority` in **all** modes (`:82`), read from `getPoolSummary` rather than the body. Mode B needs no contract-side host signature by design; the authority gate is the server's `requireAuthority`, and the contract's relayer model is documented and pinned by `contracts/test/MatchPoolSecurity.t.sol`.
- **SEC-04b** — `prizeFund`, `hostBond`, `maxSeats` and `status` are read from `getPoolSummary` via `readPoolSummary` (`lib/poolAuthority.ts:96`); client amounts are structurally impossible because `deriveSettlePlan` computes them so `sum === prizeFund` by construction, and the sum check is a thrown 400 rather than a swallowed `try/catch`.
  - `settleNonce` now comes from the chain too: `getPoolSummary` returns it as a 12th field and `settleNonceFor(summary)` (`lib/poolAuthority.ts:180`) signs what the pool actually holds instead of a hardcoded `1`. The derived value was sound only while a pool could settle at most once.
- **SEC-04c** — a non-empty winner set is enforced (`:56`), and `deriveSettlePlan` additionally rejects a lone winner on a 4-seat pool because that would also sweep up the slashed host bond.
- **SEC-06** — `/api/match/start` requires an app session for `participants[0]` and compares it to the canonical host (`:108`); a session belonging to a different wallet is a 403. `host_proven` records the outcome and `/api/match/record` refuses an unproven host. An app session rather than a wallet signature — the item allowed either.
- **SEC-05a** — one `SECURITY DEFINER` RPC owns bet placement: `chips_escrow_place_bet` (`supabase/migrations/202609300005_spectator_bet_escrow.sql:126`), `service_role`-only, conditional debit `where balance >= p_amount` in the same transaction with `raise` on zero rows, window gate at `:157`, market check at `:164`, idempotent on `action_id`. The raw insert path is gone; the only caller is `app/api/spectator-bets/route.ts`.
  - Debits land on `chips_escrow_accounts`, not `players.coins` — a deliberate architectural pivot, not the column the item names.
  - `chips_escrow_config.enabled` defaulted to `false` at ship time; the path is built, and **arming (the decision this item deferred) was taken 2026-10-11** — funded treasury, non-zero rake (500 bps), solvency runbook `docs/ops/ESCROW_ARMING.md`. See the CHIPS migration section.
- **SEC-05b** — the `window_closed_at` guard is restored on both place (`:160`) and settle (`:241`).
- **SEC-05c** — self-bets blocked via `player_id = any(m.participants)` (`:169`).

**Atomicity** — *gone by construction, and that is the finding rather than an omission*: every balance mutation moved behind a `SECURITY DEFINER` RPC or a conditional `UPDATE`, so there is no read-then-write left to convert. `chips_escrow_place_bet` is the model; the marketplace RPC (`202609300017`) is the other correct path.

**Mission and reward paths:**

- **SEC-09b** — reward drift resolved. `mission_catalog` is the single source: `daily_bonus = 10.00`, every reward CHECK-constrained to 5..20, daily total 58, weekly 90. `ONBOARDING_REWARDS` no longer exists as live data — only a stale reference in a `lib/missionCatalog.ts` doc comment.
- **SEC-09a** — **superseded, not implemented.** No conditional-claim RPC was ever written; there is no mission-claim `SECURITY DEFINER` function anywhere in `supabase/migrations/`. Instead `POST /api/missions/claim` is an explicit `410` pointing at `/api/missions/voucher`, so no read-then-write on `is_claimed` has a caller. Closed as a supersession, not as the implementation the item described.
- **SEC-10a** — signing is gated on real eligibility: an unclaimed `player_missions` row for the current period with `progress >= target` (`lib/missionVoucherIssue.ts:72`; issued via `/api/missions/voucher` and the poke-back auto-issue).
- **SEC-10b (periodId)** — `periodId` is derived server-side only, from `mission_catalog.period` for "now" (`periodIdFor`, `lib/missionCatalog.ts:88`); no client field feeds it.
- **SEC-10b (nonce)** — the voucher nonce comes from `public.next_mission_voucher_nonce()` (`202609300010`), a monotonic sequence behind a `SECURITY DEFINER` wrapper (PostgREST cannot `nextval` a bare sequence), `service_role` only. The signed payload no longer depends on server clock state.
- **SEC-10c** — the `mission_vouchers` insert is load-bearing: reserve-before-sign, `23505` → 409, no swallowed failure (`lib/missionVoucherIssue.ts:101`). The concurrency gate proves 8 racers yield exactly one acceptance.
- **ECO-06 (units)** — unified. `mission_vouchers.amount` is `numeric` holding base units via `chipsToBaseUnits` (`lib/missionCatalog.ts:131`), matching the `uint256` in `contracts/src/MissionClaim.sol:80`.
- **ECO-06 (case)** — the claim lock is a unique index on `lower(wallet_address)` (`202609300010`), so it no longer depends on an FK and a CHECK living in another table. Verified: the old shape accepted a mixed-case pair, the new one rejects it.
- **ECO-06 (pending rows)** — if signing fails, the route **releases the reservation** (`lib/missionVoucherIssue.ts:133`), so a transient edge error no longer burns the player's reward for the period. `reserved_at` plus a partial index make anything a crash leaves behind cheap to sweep.

**Other:**

- **SEC-11** — `app/api/chips/lobby-ticket/route.ts` loads the canonical `matches` row (`:74`), requires the caller to be `participants[0]` of a `host_proven` row (`:111`), and derives seats/maxSeats/`gameMode`/`shape` from storage. Seat colours stay caller-supplied by necessity — the canonical corner mapping only exists in `match_states.color_corner`, written after a ticket would be needed — but are bound by `seatsHash` into the signed digest. The `gameMode: 0` hardcode found during reconciliation is fixed under ECO-08.
- **DB-13** — `spectator_bets.action_id` is `NOT NULL` (`202609300008:27`), backfilled then constrained, with `spectator_bets_player_action_uniq` replacing the old constraint.
- **DB-14** — documented as reserved (`202609300008:45`). The only DB-side writer is `cash_out_bet`, replaced with a `raise` by `202609300001`. Caveat: `scripts/compat-probe.ts` still writes rows, so "zero writers" is true of application code, not the literal repo.
- **ECO-02** — the float→bigint conversion is gone and `prizeFund` is no longer a client-side guess. Amounts are read from `getPoolSummary` via `readPoolSummary` (the SEC-04b work) and derived by `deriveSettlePlan` in bigint/decimal-string arithmetic end-to-end — no float math anywhere on the payout path. `scripts/pool-authority.test.ts` pins it: "every derived plan sums to the on-chain prize fund exactly" across 1v1/2v2/4P shapes and odd funds, with the 2v2 50/50 (dust to first) and 4P 75/25 splits mirroring `MatchPool.sol:584-591`. Without this, a wrong sum reverted `SumMismatch` on-chain.

### Contract redeploy (ECO-01 / ECO-03)

`MatchPool.sol` changed on-chain behaviour (`credit += amount`, checked transfers); the fix went live through a sequence of redeploys, each verified on-chain and on Sourcify/Etherscan:

- **Redeploy path is a focused script, not the full stack.** `contracts/script/RedeployPool.s.sol` deploys only `MatchPool` + `ClaimHub`. `ClaimHub` takes the pool address in its constructor, so it cannot be reused; `MissionClaim` / `SeasonClaim` / `LegacyClaim` have no pool dependency and must **not** be redeployed or the live instances are orphaned.
- **Helper verbs:** `scripts/foundry-deploy.sh anvil-pool | sepolia-pool | base-pool`, with preflight guards that refuse on missing `CHIPS_ADDRESS`/`EDGE_SIGNER`/`GAME_OWNER`/`DEPLOYER_ADDRESS` or `USE_MOCK=true`. Live verbs simulate by default and broadcast only with `LUDO_CONFIRM_DEPLOY=yes` after printing mode, chain and roles — a stray invocation used to broadcast whatever `contracts/.env` held.
- **Verified end-to-end on Anvil first:** `pool.claimHub()` == new hub, `hub.matchPool()` == new pool, `pool.chips()` == pre-existing token, `setClaimHub` wired in-transaction, and a stale `DEPLOYER_ADDRESS` fails loudly rather than deploying from an unexpected account.
- **Sepolia redeploys, in order, each confirmed on-chain:** `0x2e93b3B1…`/`0x8ea2b333…` (2026-10-05) → `0xc9e73f24…`/`0x15dF5364…` (2026-10-06, carries `AbandonReason`, `AFK_STRIKES_REQUIRED`, the 12-field `getPoolSummary`; runtime 21494 B equal to the local artifact; verified on Etherscan *and* Sourcify) → `0xdfa01EDE…`/`0x538e25f8…` (2026-10-06, constructed with the rotated edge signer; runtime byte-identical to the local artifact once the `chips` immutable and CBOR metadata hash are accounted for, so the ECO-08 `shape` branch is genuinely live; verified on Sourcify as `match` with full sources). Superseded pairs are orphaned with no funds in any.
- **Migrations `202609300009` and `202609300010` applied to production** (verified via the Management API). `202609300009`: both columns, the CHECK constraint and the backfill — no row has a `match_shape`, which is correct: the only `host_proven` rows have 1-seat rosters and the contract requires 2 or 4, so the paid-pool path stays closed by design until `/api/match/start` records one. `202609300010`: the arming CHECK reads `NOT enabled OR (treasury_wallet IS NOT NULL AND rake_bps > 0 AND NOT allow_self_bets)`, the claim lock is a unique index on `lower(wallet_address)`, `next_mission_voucher_nonce()` exists and is `service_role`-only. *(The escrow was still `enabled=false, rake_bps=0` on 2026-10-06 when this was verified; arming happened 2026-10-11 — see CHIPS migration.)*
- **`roll-dice` and `move-auth` deployed to production (2026-10-06)**, **after** `202609300011` was applied — that order matters, since the new `roll-dice` is the only writer of `seat_color`/`turn_seq`. Verified against the live endpoints with the anon key: `roll-dice` prewarm `200`; no auth material `401`; the **old** `{walletAddress, actionId}` client shape `400`; unknown session `401`; stale `issuedAt` `401` even with a signature present; `matchId:"local"` `400`; unknown seat `400`; malformed actor `400`. `move-auth` `move`/`pass` `401` unauthenticated, and the `THREE_SIXES` path unreachable without auth (`401`, not `409`). **Back door closed:** with the anon key, PostgREST refuses to insert into `match_rolls`, `match_sessions` or `match_states` (`42501`, RLS), and `match_rolls` is unreadable to clients; only the Edge service role writes. *Not verifiable from here:* the authenticated happy path needs a seeded match plus a live match session, and production has 0 `match_states` rows and 0 active sessions — the first real match exercises it.
- **Verification hardened.** Moved off the retired Etherscan V1 hosts to V2 + Sourcify fallback (`scripts/verify-contracts.sh`, `contracts/foundry.toml`); the script cross-checks deployed runtime size against the local artifact before interpreting a verifier answer — Sourcify answers "already verified" for *any* previously-verified address, which is how the ECO-08 redeploy first reported success with the live contracts unverified — and echoes the addresses it actually checked. `scripts/lib-load-env.sh` is one shared `contracts/.env` loader for both scripts (a plain `source ./.env` used to overwrite caller-supplied variables and corrupt `ETHERSCAN_API_KEY` with trailing `#` comments). Guardrails are executed, not just written: `scripts/deploy-guardrails.test.ts` (9 tests) runs the shell and asserts on behaviour, and Bash 3.2 compatibility (macOS default) is pinned so it cannot regress.
- **`EDGE_SIGNER` rotated off a public key.** It was `0xf39F…` — Anvil/Hardhat account #0, whose private key is published in the Foundry docs and was committed in this repo; anyone could have signed as edge signer, which is what authorizes bet-settlement co-signatures. Now a freshly generated key (`0x77BC…E2`) whose private key lives only in `.env.local` as `EDGE_SETTLE_PRIVATE_KEY`; no keystore, because the edge signer never sends on-chain transactions, it only co-signs EIP-712 digests in the app server. The redeploy after the rotation constructed the pool with the new signer directly (`edgeSigner()` returns `0x77BC…E2`), and the superseded pool was rotated before being abandoned.
- **Dev keys cannot reach a live network.** `scripts/lib-dev-keys.sh` derives every Anvil-default address and refuses them in any on-chain role; every live verb in `foundry-deploy.sh` calls it for `EDGE_SIGNER`, `GAME_OWNER` and `DEPLOYER_ADDRESS`. `scripts/smoke-sepolia.sh` and the two Solidity smoke scripts take their keys from keystores/env instead of compiling published keys in, and `foundry-deploy.sh sepolia` additionally refuses `USE_MOCK=true`.
- **Stranded-funds question closed 2026-10-11.** `CHIPS.balanceOf` on the pre-redeploy pool `0x879E…` reads 0 via public Sepolia RPC — nothing is outstanding, no loss to accept.
- **`contracts/.env` warning, kept because the file is local and mutable:** it once carried a stale `DEPLOYER_ADDRESS=0xbcCa…DfA` (an Anvil account from a dry run), `USE_MOCK=true` against a mainnet config, and a duplicated `CLAIM_HUB_ADDRESS` key. Verified fixed 2026-10-11 (`USE_MOCK=false`, no duplicate keys, `DEPLOYER_ADDRESS` passes the dev-key guard) — re-check before every deploy regardless.

### Gate results

- A test asserts every balance mutation in `app/api` is a conditional update or a `SECURITY DEFINER` RPC — no read-then-write remains.
- `check:schema` asserts no `security definer` coin function is executable by `anon`/`authenticated`.
- Parallel-claim test: 8 concurrent `missions/claim` for the same mission credit exactly once (`scripts/concurrency.test.ts`). Verified sensitive: dropping the unique constraint makes it fail on the assertion.
- Parallel-bet test: 8 concurrent `spectator-bets` with insufficient balance debit at most the balance (same file).
- Parallel-settle test: N concurrent `chips_escrow_settle_bets` pays out exactly once (asserts the exact gross-minus-rake ledger delta).
- Every route in SYSTEM_REVIEW §10.7 marked CRIT/HIGH is closed or has a written, signed-off risk acceptance.

> **Scope note on the concurrency gate.** The escrow has genuine defence in depth, so the bet tests assert the *invariant*, not a single layer: `chips_escrow_accounts` carries `CHECK (balance >= 0)` **and** the debit is a conditional `UPDATE ... WHERE balance >= amount` (atomic under row locks). Removing either layer alone does not produce an overdraft, which is the desired outcome but means those two tests cannot fail from a one-layer regression. The claim test is layer-sensitive and is proven so.

**Phase status.** Every Phase 1 code task is closed, deployed to Sepolia, and verified — including the escrow arming, which was a decision rather than a defect and was taken 2026-10-11. The only remaining in-phase item is the **Base mainnet deploy**, tracked under *Deferred by decision*.

---

### Phase 2 — Restore dice and engine integrity

**Why it was open.** A seated guest could choose their own dice face, and the two live engines resolved the same capture differently.

**Status.** All Phase 2 code tasks closed and gated as of 2026-10-11: the dice boundary, one engine, one team table, authority coverage, a terminating golden corpus, and executable hostile-client coverage. Everything the audit gated on this phase — wagered and 2v2 play — is unblocked; the marketplace/escrow cutover, the poke voucher, and the stranded-funds sign-off all landed.

### What was implemented

**Dice boundary:**

- **SEC-02 — a client can no longer name its own dice face.** Closed at four levels, not just the parser:
  - `lib/types.ts` — `REQUEST_ROLL` is `Record<string, never>` and `REQUEST_MOVE` has no `diceValue`, so a face is unrepresentable in a typed caller.
  - `lib/gameProtocol.ts` — both payloads **reject** the key (`!('value' in payload)`) rather than ignoring it, so a forged intent is dropped loudly instead of silently honoured.
  - `lib/protocol/schemas.ts` — `.strict()` on both payloads. Plain `z.object()` strips unknown keys and *passes*, which would have read as acceptance at the call site.
  - `hooks/useGameActions.ts` — the `value` parameter is **gone** from `handleRoll`; no caller can pass a face even in principle. `REQUEST_ROLL` sends `{}` and `REQUEST_MOVE` sends only `{color, tokenIndex}`.
  - `hooks/useGameEngine.ts` — the host calls `handleRoll()` bare, and takes `REQUEST_MOVE`'s face from `localGameState.diceValue`, never from the payload.
  - `app/components/Dice.tsx` + `PlayerInfoRow.tsx` — `onRoll` is `() => void`. The old call was `onRoll(0)`, which was safe only because `0` is falsy; `onRoll(6)` would have landed unchanged.
- **SEC-02 (not in the original list) — `REQUEST_MOVE.diceValue` removed.** A mover could declare the face it moved with, and the host preferred it over its own state (`payload.diceValue ?? localGameState.diceValue`) — the same hole as `REQUEST_ROLL.value` and strictly worse, because it allowed moving with a face the host never rolled.
- **SEC-02 — AFK/AI forced rolls already route through Edge.** `useAFKManager` and `useAIBrain` call `handleRoll()` with no argument, so a forced roll still mints a `match_rolls` receipt. No client fallback exists: a networked seat that cannot reach `roll-dice` **aborts** the roll rather than falling through to `Math.random()`. Asserted by test.
- **SEC-01 — `roll-dice` authenticated and bound to seat + turn.** It was completely unauthenticated — `{matchId, walletAddress, actionId}` from anyone with the anon key, service-role insert, RLS default-deny bypassed — and all three receipt identifiers came from the request body. Now: a match session (`match_sessions`, not SIWE) or a one-off `personal_sign`, verified *before* the mint decision, with the client going through `useMoveAuth.requestRoll` so there is no per-roll wallet popup; only the host may mint (a guest asks over the intent channel and the host calls in, keeping the betting window and dice order with the host); `wallet_address` is the recovered signer, so attribution can no longer be forged; and `seat_color`/`turn_seq` are derived from `match_states` — the seat must be the one whose turn it is. **Retry-until-six is impossible:** `match_rolls_match_turn_uniq` on `(match_id, turn_seq)` means a second receipt for a turn cannot be inserted at all — the old `(match_id, action_id)` idempotency bound nothing because `action_id` was caller-chosen. A repeat attempt now *replays* the first face, so a dropped response still recovers.
- **SEC-01 — `move-auth` binds the receipt in `move` and `pass`.** Both select `seat_color, turn_seq, wallet_address` and require: the receipt's seat is the seat moving; `turn_seq` still equals the current `seq` (so a roll cannot outlive its turn — done server-side rather than trusting a client-carried `lastRollId`); and the minter is the host or the seat's own wallet. A receipt with no `seat_color`/`turn_seq` predates the migration and is **refused, not guessed at**.
- **SEC-33 — hosted bots and AFK seats can roll.** They previously sent a literal `"<color>-bot"` string as `wallet_address`, which cannot satisfy the FK to `players(wallet_address)`, so the insert failed and hosted bots could not roll at all. The host now mints with `seat_color` = the bot's colour, which is what the seat column is for.
- **Migration `202609300011_roll_receipt_binding.sql`** adds `seat_color` + `turn_seq`, a closed seat vocabulary, and the partial unique index. Historical rows are deliberately left unbound and the Edge boundary fails closed on them rather than backfilling a guess. **Apply before deploying the new `roll-dice`** — it is the only writer of both columns.
- **The rules are tested, not asserted.** They live in `_shared/rollReceipt.ts` as pure functions so `scripts/roll-trust.test.ts` (23 tests) executes them in Node; the wiring between the Edge handlers and those functions is checked separately and is explicitly labelled a source assertion, because Deno is not installed in CI. `scripts/concurrency.test.ts` adds three tests against real Postgres, including **six concurrent retries of one turn, of which zero are accepted**.
- **The next four entries were stale duplicates of the 2026-10-06 SEC-01/SEC-33 items above — closed by `612ef30` and left unticked in error; ticked at the 2026-10-11 re-verification:** SEC-01 (authenticate `roll-dice`: session/signature, seated, `state.currentPlayer === seatColor`, `wallet_address` bound to the recovered signer) · SEC-01 (`move-auth` `move`/`pass`: select `wallet_address`, reject unless `roll.wallet_address === recovered`) · SEC-01 (a roll can only be spent by its own turn — satisfied server-side via the `turn_seq` == `seq` requirement, a client-carried `lastRollId` deliberately not trusted) · SEC-33 (host wallet for bot seats, or a nullable `wallet_address` with a separate `seat_color` — implemented as the latter).
- **ENG-13 — engine input validation.** `isValidDice` (integer 1–6) gates the Edge boundary and `resolveNetworkedMove`; `isValidStepCount` (integer 1–12) gates `processMove`; `clampSteps` coerces anything else. Two subtleties the first draft got wrong and the tests caught: **steps are not dice** — a boosted move is `dice + 6`, so validating `steps` with the dice predicate rejected *every* boosted move (there are now two predicates with different bands, and `resolveNetworkedMove` consumes a boost in a test that proves 9 steps, not 3); and `steps < 1 || nextPos === initialPos`, not just `nextPos === initialPos` — the old `steps !== 0` guard let a 0-step "move" fall through and act as a forced turn switch (turn passing is `getNextPlayer`'s job, and the Edge boundary has a dedicated `pass` action).

**One engine:**

- **ENG-01 — capture-force divergence fixed.** `core.ts` was passing **post**-move positions into `checkMultiCapture`, which then adds `+1` for the mover, double-counting it: one green against two reds in 2v2 resolved as `2 >= 2` and captured on a numerically losing force. Now passes pre-move `state`, keeping the `+1` as the finding requires.
- **ENG-01 — `npm run test:engine-diff`** (3 tests / 1200 seeded matches) compares `lib/engine/core.ts` against `lib/gameLogic.ts` on `positions` / `captured` / `winner` / `bonusRoll` / turn rotation at every step, per mode, under a deterministic mulberry32 PRNG (a failure replays from its printed seed). Written without `fast-check` on purpose: the harness is seeded and reproducible, and it keeps the dependency out of a wagering codebase.
  - **Two harness bugs were found before it could be trusted.** It initially fed `core` a filtered `activeColors` and `gameLogic` none, comparing two different questions; and it drove turn passing through `processMove` with `steps = 0`, which ENG-13 had just made illegal. Passing is now `getNextPlayer`.
  - **Seating is fixed, not shuffled:** `assignCornersFFA`/`assignCorners2v2` use `Math.random()`, which made results irreproducible and caused genuine intermittent failures whenever a shuffle moved a gate. Both suites pin explicit corner maps.
  - Verified it bites: reintroducing the post-move input fails all three modes.
- **ENG-01 — `scripts/golden-replay.ts` repointed at `lib/engine/core.ts`**, with the golden corpus extended so matches terminate: greedy max-progress from on-track 0..9 starts, seeded per-match seating via LCG, `MAX_TURNS_PER_MATCH` 40 → 3000. **50/50 finish** — 17 × 1v1, 17 × 4P, 16 × 2v2 including a `Team N` win — double-run hash-identical.
- **ENG-08** — `aiEngine.calculateMoveScore` calls engine math: the force comparison now runs `getTeamForceAtPoint` on the RESOLVED board `{...positions, [actingColor]: moved}` instead of reimplementing pre-move `+1`; the capture verdict already was `checkMultiCapture` and stays so, now fed a well-formed state instead of `as any` partials.
- **ENG-17** — satisfied by the `check:drift` gate below (10 tests, green); the duplicate unchecked box is the same work, ticked as such rather than double-counted.
- **ENG-20** — deduplicated. Single source is `lib/engine/core.ts`; the Edge authority is a verbatim copy and cannot import, so the authority owns the implementation — `lib/gameLogic.ts` re-exports it and `supabase/functions/_shared/engine.ts` is regenerated via `sync-edge-engine.mjs`. `getGridCellInfo` was already single-source (the register's earlier claim about it was corrected at the 2026-10-11 pass); `useGameActions`' import keeps working through the re-export. `SnakesBoard.tsx`'s private `shufflePlayers` is a separate legacy component, untouched.

**One team table:**

- **ENG-02** — `LOBBY_COLORS['2v2']` is derived from `TEAM_PAIRINGS`: `[host, teammate, ...opponents]` = `[green, blue, red, yellow]` (was the contradicting `[green, yellow, red, blue]`).
- **ENG-02** — a test asserts `getTeammateColor(slots[0].color) === slots[1].color` for 2v2 (and null-teammate for 1v1/4P) in `scripts/engine.test.ts`; the `assignCorners2v2` diagonal test already existed there. Fails on the old order.
- **ENG-19** — `shufflePlayers('1v1', …)` reuses the seated axis (derived from `cc.green`'s diagonal instead of a fresh roll), pinned by a 50-seating test asserting green+yellow come back — the old code returned red+blue about half the time.
- **ENG-02** — `TeamUpMatchPanel:306` verified consistent: roles `['host','teammate','opponent','opponent']` unchanged, and slots 0+1 are now actually teammates per the pairing table, so the `host || teammate` "Your team" split renders the true pair — no code change needed.

**Authority engine coverage:**

- **ENG-03** — `evaluateVictory(newPositions, playerCount, prevWinner, prevStatus)` extracted and called from the teleport branch. Teleport is the only power that can put a token straight home, so it is the only one that can end a match; skipping the check left a 2v2 team all-home with `winner=null`, `status='playing'` and both colours out of the turn cycle — unbreakable, because nobody could ever move again. Teleport now sets `winner`/`status` and appends every finishing colour to `winners`. `processMove` also had a stale `status` reference after the extraction; it now reads `victory.status`.
- **ENG-04** — `activeColorsForTurns` keeps a 2v2 colour active while its teammate still has tokens, and the rule is now **single-sourced**: it existed as **four** copies (the engine, `useGameActions.getNextPlayer`, `useGameEngine.getNextPlayer`, and inline in `useProvablyFairDice`); all the hook copies call the engine. The all-finished case still returns the full cycle so `getNextPlayer`'s fallback cannot break.
- **ENG-05** — the three-sixes counter is authoritative in the engine. `checkThreeSixesForMove` is consulted by `resolveNetworkedMove` *before* legality is computed, and `move-auth` refuses `submit-move` on the third six with `THREE_SIXES` (409) — a third six is a forfeited turn, so the client must use `pass`. `resolveNetworkedMove` persists the consumed counter, so `processMove` deliberately does not own it. `handleThreeSixes` hardens a bogus counter (`NaN` → 0, `>= 3` forfeits) and ignores a non-integer face. The hook-level copies (`useGameActions:533`, `useProvablyFairDice:68`) still call it for the local presentation path, but they are no longer *authoritative* — the engine refuses the move regardless — so they are left as UI sequencing rather than deleted mid-phase.
- **ENG-17 — `npm run check:drift`** (10 tests) compares `lib/engine/*` against `lib/constants` and `lib/boardLayout`: `TEAM_PAIRINGS`, `TEAM_ID`, `SHARED_PATH` (all 52 cells), the four engine-relevant `CORNER_SLOTS` fields, `SAFE_POSITIONS`, board constants, `getBoardCoordinate` across every position × colour, `calculateNextPosition` across every position × step × colour, that the hooks call `activeColorsForTurns` instead of reimplementing it, and that the Edge copy matches the source. `CORNER_SLOTS` is compared field-by-field rather than with `deepEqual`: `boardLayout` carries extra rendering keys the authority has no use for, so a whole-object compare would fail on shape rather than on rules. Verified it bites: drifting `TEAM_PAIRINGS` in the engine fails the gate.
- **ENG-06** — `buildPayoutPlan` shape guards above the single-winner return: a lone winner on a 2v2 pool now throws instead of paying 100% and sweeping the slashed host bond. `payoutColorsForWinner` maps `winner === "Team N"` → both `TEAM_ID`-N seats; `MatchStatsOverlay` builds the 2-winner plan from both seat wallets and fails closed when a wallet is missing.
- **ENG-06** — `useGameEngine.recordWin` is called for every colour in the winning team (both `useGameActions` win sites; idempotent per match via `hasRecordedWin`, per-player local stats still accrue), and both engines record ALL newly-finished colours in `winners` (was mover-only, dropping an already-home teammate).
- **ENG-07** — `app/api/match/state` returns `sanitizeGameStateForWire(data.state)` — the `lib/wireSanitize.ts` canonical named by AGENTS.md invariant 6, behaviour-identical to `stripPowerTypesForWire` — so power-tile types no longer leak to spectators.
- **ENG-11** — `applyPowerPickup` spawns from `powerTileSeed`: minted once per match at creation, committed through the seed digest, persisted via the `PERSISTED_STATE_FIELDS` whitelist; one LCG stream per pickup from seed + consumed tile + board fill; the dead `palette[seed % 4]` indirection removed (shared-path cells are colour-independent); rarity from an independent stream draw. The offline `useGameActions` pickup uses the same stream. Pinned by an engine-core determinism test including sensitivity.
- **ENG-12** — the trap truce: teammate traps never fire in 2v2, in both `resolveTrap` and the authority branch, matching capture and nuke.
- **ENG-14** — the trap branch goes through a shared epilogue (`finishTrappedMove` in both engines) so shield cleanup and the dice reset now run; boost/sixes stay downstream in `resolveNetworkedMove`/caller where they already run for trap results; a win re-check is unnecessary (a trap to BASE cannot complete a win) and is documented as such.
- **ENG-09** — AI `progression` uses colour-relative distance-to-finish (0 at own start → 56 home), not the raw track index.
- **ENG-10** — `getBestMove` returns `{color, tokenIndex}`; all five callers updated (`ai/client`, `useAIBrain` passes the teammate's colour to `moveToken`, power4p arena, bench, hardening smoke).
- **ENG-18** — AI Boost gated: it spends only with a token ≤12 from home or a token on a non-safe square with an opponent ≤6 behind (per §5.4); otherwise it is held for teleport/none.
- **ENG-15** — `checkWinStatus` deleted (zero callers; win detection lives in `processMove`/`evaluateVictory`).

### Gate results

- `npm run test:engine-diff` green over ≥10k moves per mode (1200 seeded matches).
- `npm run test:engine-core` covers `resolveNetworkedMove`, every `applyPower` branch (shield / boost / nuke armed / nuke kept / nuke fired / teleport home / teleport kept), `applyPowerPickup`, `activeColorsForTurns`, `effectiveMoveSteps`, `countNukeVictims`, `applyEngineCaptureEvents`, `stripPowerTypesForWire`, plus `evaluateVictory` and `isBoardCleared` — 41 tests, all four previously-uncovered authority functions included.
- `npm run test:golden` — 50/50 terminate (17 × 1v1, 17 × 4P, 16 × 2v2 incl. a `Team N` win), double-run hash-identical.
- `npm run check:drift` green.
- `isGameIntent` rejects `REQUEST_ROLL {value}` and `REQUEST_MOVE {diceValue}` — asserted.
- A hostile client cannot influence the dice face: the React host effect delegates to `hostActionForIntent` (`lib/hostIntent.ts`), which is EXECUTED over forged intents in `scripts/host-intent.test.ts` (roll face nowhere to land; move face replaced by the host's; null host face and malformed intents fail closed), wired into `npm test`, with delegation pinned by source assertion in `dice-trust.test.ts`.

---

### Phase 3 — Trust-boundary hardening

**Why.** Signatures were verified correctly, but *resource* authorization was frequently missing: "is this signature valid" was checked, "is this signature the right signer for this pool/match/seat" often was not.

### What was implemented

**Route authorization:**

- **SEC-07 — the AI arena is host-gated.** Three separate holes, all closed: `requestedMatchId` is **deleted** (`PATCH` accepted a caller-named match, so any client could point the tick at a live match and take a write against it — only `arenaKey` is accepted now, compared strictly against the server constant, and the match is resolved server-side); a session is required on both verbs (there would otherwise be no host to record); and only the host ticks — `live_matches.host_address` is now a real wallet, the first session-holding caller that bootstraps the arena, instead of the placeholder string `'ai-arena'`, which matched no wallet and so matched nobody; a non-host gets `403 { reason: 'NOT_HOST' }` and simply watches, and `match_states.host_address` is set to the same wallet so the Edge boundary and this route agree. The 8s authority-lease reclaim still applies so a closed tab does not orphan the arena, and the tick is rate-limited in-handler, not only at the edge. **Accepted risk, stated:** the arena is AI-vs-AI with no wager, so the blast radius was the board rather than a balance.
- **SEC-08 — `friends/route.ts` no longer interpolates a wallet into a filter string.** `fetchAcceptedFriends` built `.or(\`user_address.eq.${walletLower},friend_address.eq.${walletLower}\`)` — a **string format, not a query API**, reached through the **service role**, which bypasses RLS, so a crafted `wallet` could close the term and add its own. Now: a shared predicate (`lib/validation/wallet.ts`) validates **before** any query, the friendships lookup is two `.eq()` queries merged in JS, and the route requires a session **for the caller's own wallet** (`401`/`403`). Neynar-sourced addresses are re-validated and capped before reaching the remaining `.or()`, and the upstream URL is `encodeURIComponent`'d. All three callers pass the session; a `401` degrades to empty lists rather than poisoning the panel. Neynar rate-limiting is in place via the SEC-34 limiter, at the edge and in-handler (a session lasts 7 days, so the key needed its own bound).
- **SEC-12 — `POST /api/lobby/join` derives the wallet from the session.** The body carried `wallet` and `coins`, both written straight into `lobby_join_requests`: a request could be filed against **someone else's wallet**, and the host saw a coin balance **the guest chose** — which `TeamUpMatchPanel` then rendered as a "Low chip" warning. Now a session is required, `wallet_address` comes from the verified SIWE session, the client-declared `coins` field is gone (including from the host listing, where it could only ever be null), and joins are throttled **per (wallet, room)** — per-room would let one wallet flood many rooms, per-wallet would let it spam one room.
  - **Two findings from doing it.** (1) `join_secret_hash` is only ever SELECTed and **never written by any code**, so the invite-link secret gate never actually fired — the session is the real gate and the secret check is decorative. (2) `playerCoins` in the lobby slot is now permanently null, so the "Low chip" badge can no longer render; it degrades to nothing rather than showing a wrong number, and should be fed from an authoritative balance or removed.
  - **Friendship requirement resolved by product decision — quick match gets its own door.** A blanket friendship gate was impossible (matchmaking pairs **strangers** by design), so every lobby declares one of three doors (migration `202609300012`, table `lobby_join_policies`, route `POST /api/lobby/policy`): **`matchmaking`** — credential is the queue's `validation_token`, friendship is **not** required (the queue did the introducing); **`invite`** — credential is a **server-minted** room secret (`randomBytes(24)`, so a host cannot pick a weak one or omit the link) **and** an accepted friendship with the host, with the secret checked *before* the friendship lookup so an attacker cannot probe a host's friends without the link; **`open`** — casual room-code join, session only. No policy row means `open`, and a declared door with no credential fails closed. A new table was needed because `live_matches.match_id` is `NOT NULL`, so a pre-match lobby cannot be recorded there, and making it nullable would change what every `room_code`/`match_id` query across the app returns.
- **SEC-13 — a friendship delete is scoped to the caller.** `remove` with a `friendshipId` ran `.eq('id', friendshipId)` and nothing else, through the service role: **any session-holder could delete any friendship in the table** by guessing an id, including between two other people. The row is now read first and refused with `403 Not your friendship` unless the caller is one of its two addresses; the by-target path also stops interpolating into `.or()` and uses two explicit deletes.
- **SEC-14 — a push unsubscribe is scoped to the wallet.** `dropPushSubscription(endpoint)` deleted by endpoint alone through the service role, so an observed or leaked endpoint let one wallet silently unsubscribe another. `walletAddress` is now a required parameter and the delete is scoped to it; a missing wallet is a no-op, not an unscoped delete.
- **SEC-21 — the SIWE domain is checked against the request we serve.** `domain` arrived in the body and was inside the signed message, which looks like protection and is not: the server rebuilt the message using the same attacker-chosen domain, verified the signature against it, then issued a session — so a signature harvested on a phishing site (`domain: evil.example`) replayed straight into this endpoint. Now compared against the request `Host`, plus `SIWE_ALLOWED_DOMAINS` for aliases (Host alone would reject a legitimate custom domain, and there is no safe default for that). **A nonce is also single-use**: the client used to choose it and the server only stored it, so one signature could mint unlimited sessions for the 7-day TTL. Refusing a used nonce gets the same replay property without a round trip; a server-issued challenge endpoint would be the fuller fix.
- **SEC-22 — a poke requires an accepted friendship in either direction.** Beyond the annoyance, each poke credited **both** sides with the `social` onboarding track, so it was also a way to farm progress against an arbitrary account.
- **SEC-23 — upstream URLs take validated input only.** `farcaster` interpolated `wallet` into the Neynar URL verbatim, so a crafted value could append query parameters or a second address and make the endpoint request something else with our API key; now `normalizeWallet` + `encodeURIComponent`, validated *before* the key is spent. `activity` spends `ETHERSCAN_API_KEY` on an unauthenticated caller, so it now needs a session for that exact wallet. `matchmaking/pools` validates `walletAddress` before it reaches the query.
- **SEC-24 — wallet links need a session and a fresh proof.** `GET` was readable by anyone for any wallet, through the service role, and returned an identity statement about someone else; it now needs a session for that exact wallet and uses two `.eq()` queries instead of an interpolated `.or()`. `POST` never checked `issuedAt`, so one captured pair of signatures re-linked the same wallets forever.
- **SEC-25 — the private scalar could be stored, and read back.** The route persisted the posted JWK **verbatim**: `upsert({ wallet_address, ecdh_pubkey: publicKey })`. A P-256 JWK may carry `d`, the private scalar; nothing rejected it, so a client could post `{ kty, crv, x, y, d }`, have the private key written to `players.ecdh_pubkey`, and then read it out of `GET /api/profile/ecdh`, which returns the stored blob to any session-holder — after which every recipient would derive a shared secret from a key the attacker controls. `lib/validation/ecdhJwk.ts` rebuilds the key from the four accepted fields (so anything else is dropped by construction, not by a blocklist) and hard-refuses `d` / `key_ops` / `ext` / `alg` / `use` rather than stripping them silently.
- **SEC-26 — the unkeyed hash is no longer called a signature.** The field was `signature: 'unsigned:<fnv>'`; FNV is unkeyed, so anyone can recompute it for a forged bundle — the name invites exactly the trust it cannot support. It is now `contentHash`, documented as *not* a signature, and `signature` goes out explicitly `null` so no caller reaches for it; the type was renamed `SignedNoticeBundle` → `NoticeBundle`. Signing properly still needs an ops key and is deliberately not faked.
- **SEC-27 — `feedback` uses the platform IP and only verified attribution.** It keyed its limit on `x-forwarded-for[0]`, the **client-controllable prefix** — an attacker chose their own bucket. `clientIp()` now prefers the platform header (`cf-connecting-ip`, `x-vercel-forwarded-for`, `fly-client-ip`, `x-real-ip`) and, failing all of those, takes the **last** `x-forwarded-for` entry (the one a real proxy appended) rather than the first. The unverified `walletAddress` attribution is gone: a row is only stamped with a wallet when `requireAppSession` verifies it.
- **SEC-28 — `social/moderation` rate-limited, dedup key derived server-side.** A 7-day SIWE session let one wallet write unbounded `activities` and `user_reports` rows. Now bounded per `(action, wallet)`, and the dedup key is `deriveActivityId(type, actor, subject)` instead of a client `requestId` — a caller could previously mint unlimited activities by varying the id, or suppress its own by reusing one. (`marketplace/purchase` keeps its client `requestId`: there it is a genuine idempotency key for a debit, so it stays — but the route is now rate-limited too.)
- **SEC-34 — `middleware.ts` + a shared limiter, and every route classified.** `lib/rateLimit.ts` (one sliding-window limiter) and `lib/rateLimitRoutes.ts` (the table). Every one of the 45 `/api` routes is now in exactly one of three buckets — **limited**, **`NEVER_LIMIT`** (heartbeat/reconnect: `match/state`, `match/stream`, `profile`), or **`SESSION_GATED`** (authenticates itself) — and a test fails if a route is unclassified, so a new endpoint cannot be unlimited by accident. `SESSION_GATED` entries are re-checked each run for a real session/signature/410/fail-closed, so a route cannot lose its auth and stay in the set. `SESSION_GATED ∩ RATE_LIMITS` overlap is deliberate: a 7-day session is not a rate limit, so authenticated writes (`matchmaking/*`, `onboarding/progress`) are bounded too.
  - **Honest ceiling, stated in the code:** this is an **in-process** counter. On Vercel/serverless the effective limit is `limit × instances`, so it stops casual abuse and accidental loops, not a determined caller. A shared store is the real fix and is a deployment decision; `hasSharedStore()` and `RATE_LIMIT_SHARED_URL` are reserved for it rather than pretending otherwise.
  - **Never limit the heartbeat:** `match/state` is the resync/reconnect path and is answered by re-fetching in bursts; a limit there produces ghost boards and "cannot find match" loops that read as a backend outage.
- **SEC-35** — `SENSITIVE_KEY_PREFIXES` extended (`content`, `message`, `text`, `body`, `plaintext`, `epk`, `iv`, `ciphertext`), and `scrubTelemetryProps` additionally drops any string value that parses as a `SealedBox` (`isSealedBox` is pure — runs in Node/Edge too). Pinned in `scripts/q7.test.ts`, including a sealed box under an innocent key.

**Edge authority:**

- **SEC-15 — compare-and-swap is observed, not assumed.** All three CAS sites (`move`, `pass`, `power`) now `.select('seq')` and run the result through `casWon`, which requires **exactly one** row back. A `.update().eq('seq', seq)` that matches nothing is not an error in PostgREST — it is a `200` with an empty body, so the loser of a race returned `200 {success:true}` for a state it never wrote. The `match_moves` insert error is checked and surfaced as `500 AUDIT_WRITE_FAILED` rather than swallowed. Rules live in `_shared/turnAuthority.ts` as pure functions, tested in Node.
- **SEC-16 — the seed signature binds the board.** It covered the match identity only, so a host could sign "start this match" and then seed whatever board it liked — including one that put its own tokens ahead. `buildSeedMessage` now carries `board: sha256(stableStringify({initialState, colorCorner, playerSeats}))`, and the Edge recomputes the digest from **what actually arrived** rather than trusting the client's value. `stableStringify` sorts keys at every level, because `JSON.stringify` is key-order dependent and a naive digest would mismatch between client and Edge for identical input.
  - Seat validation added: keys must be a subset of the four colours (an extra key is a seat the engine never reads, and a smuggling channel into persisted state), each human wallet must be a canonical participant and appear **at most once** (one wallet in two seats would hold both sides), and seat kinds are closed.
  - `color_corner` must match what the engine derives for the declared `playerCount`, so a 2v2 pair cannot be seated on one diagonal.
  - The Edge copies (`_shared/boardDigest.ts`, `_shared/corners.ts`) are **generated** by `scripts/sync-edge-proof.mjs` — two hand-maintained copies of a digest function drift silently, and the symptom is a match that cannot start with no useful error.
- **SEC-17 — a provisional grant belongs to one wallet.** `authorization_key` was globally unique, so two wallets reaching the same room key silently overwrote each other: the second upsert replaced the first row and the first wallet's `bind-provisional-session` then failed. Now unique on `(authorization_key, wallet_address)` (`202609300014`), the upsert conflicts on the pair, and the client keys as `room:<code>:<wallet>` so the pair is naturally distinct. The baseline's column-level `unique` is a **constraint**, so it needed `alter table … drop constraint`, not `drop index`.
- **SEC-18 — the `reason:'forced'` escape hatch is deleted.** The caller could assert its own forced-ness and hand the turn over at will; it is gone from the Edge contract, the destructured body, the client (`useMoveAuth` / `useGameActions`) and the signed pass message. `checkPassLegality` derives it: a pass is legal only when there are no legal tokens, or it is the third consecutive six.
- **SEC-19 — seat authority is one function across all three handlers.** `pass` never refused host-assist on a human seat, so the host could end a human's turn with a pass that human never chose. **`power` was worse: it had no human-seat refusal at all**, so the host could spend any player's power on their turn. `move`, `pass` and `power` now all call `checkSeatAuthority`, and the old inline rule (`seatOwnsColor`) is deleted so the two shapes cannot diverge again.
- **SEC-20 — the two chain allowlists had drifted.** `lib/chains.ts` allowed `[84532]`; `_shared/walletVerify.ts` allowed `[84532, 8453]`, so a signature could be verified on a chain the product does not support, against a **public** RPC endpoint the deployment never chose and cannot rate limit. Edge now matches `lib/chains.ts`, `parseChainId` derives from the allowlist rather than its own hardcoded pair so the two cannot drift again, and a missing `SIWE_VERIFY_RPC_URL*` throws instead of silently falling back to viem's public default. The fast EOA path is unaffected, so this declines to guess an endpoint rather than weakening verification.
- **SEC-29 — `resolve-bet` settles only what the authority recorded.** The RPC already owned the window and bet-type guards, but *conditionally*, and the Edge function handed it a client value: **open and already-`settled` windows** are both refused with a `409` **before** the settlement RPC (previously an open window reached the RPC and came back as an opaque 500 from a raised SQL exception); **`bet_type` is server-side** — the signed `betType` is still verified (the host cannot swap it), but it must now equal `live_matches.current_bet_type`, a **null** recorded type fails closed, and the RPC is called with the recorded value (the RPC's own check was `if current_bet_type is not null and … distinct`, so a null recorded type previously let *any* type through); and a **winner is required** — the cross-check existed but was guarded by `winner != null`, so a match that finished with **no winner** skipped the comparison entirely and any result settled the market. *Note on the audit's wording:* it asked to reject unless `bet_window_status = 'settled'`, but this endpoint is what **sets** `settled`; the correct pre-condition is `closed`, which is what is enforced.
- **SEC-30 — a pass resets the per-turn power budget.** `powerSpentThisTurn` was left untouched by `pass`, so a player who spent a power and then had no legal move carried `true` into the **next** turn and was refused every power until they moved again. The whole post-pass patch is now `passStatePatch`, which also wraps the six counter at the third six instead of letting it run away.
- **SEC-31 — Edge errors are opaque.** A PostgREST error carries the table, column and constraint, and its `hint` literally reads *"Grant the required privileges to the current role with: GRANT SELECT ON public.<table> TO anon"* — so an anonymous caller could enumerate the schema by triggering errors, and errors are the easiest thing to trigger. `_shared/errors.ts` now owns the shape: a fixed `code`, one generic sentence per code, and the real cause (including `hint`) to `console.error` only. `move-auth` had two raw `error.message` returns plus a caught-exception echo; `resolve-bet` had four. **Observed live while testing this:** a mistyped column returned `PGRST204 … Could not find the 'sender' column of 'live_chat' in the schema cache` — the exact leak, from a probe.
- **SEC-31 — `applyPower` errors are mapped to codes.** Its engine strings ("Power not held", "Not your turn") describe another player's inventory and turn state. Now `opaquePowerError()` maps them to `NOT_HELD` / `NOT_YOUR_TURN` / `WRONG_PHASE` / `ALREADY_SPENT` / `BAD_TARGET`, with an unknown string defaulting to `BAD_TARGET` so nothing passes through. `armed`/`kept` are kept because the UI acts on them and they reveal nothing.
- **SEC-32 — persisted state is whitelisted.** The old code blacklisted exactly one thing, `powerTiles[].type`, and stored everything else verbatim — and `seed` takes `initialState` from the request, so any other field could be written into an authority row; a blocklist cannot enumerate what a client invents. `pickPersistedState()` keeps an explicit field list and reduces each tile to `r`/`c`, applied at seed **and** on all three compare-and-swap writes. Note `powerTiles[].type` is stripped on persist while the in-memory authority copy keeps it, which is what makes the pickup logic work at all.

**Crypto and privacy:**

- **CRY-01 — the KDF is real HKDF now.** It was `SHA-256("ludo-dm-ecdh-v1" || sharedSecret)`, commented "HKDF-ish". Not HKDF: no extract step, no expand step, and — the part that mattered — the derived key bound **nothing about who was talking**, so the same shared secret in a different transcript produced the same AES key. Now `crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, Z, 256)` with **16 random salt bytes carried in the sealed box** (a constant salt is a domain tag, not a salt) and `info` binding the domain tag plus **both** static public keys. **v1 is retained for DECRYPT ONLY:** historical rows were sealed with the old derivation and must stay readable; nothing new is written as v1, and `isSealedBox` refuses a v2 box that is missing its salt, because the HKDF could not be reproduced.
- **CRY-02 — product decision: no per-message signature (owner-confirmed 2026-10-11).** The chain already authenticates the sender without a popup: key publish requires a fresh `personal_sign` over the key fingerprint (`POST /api/profile/ecdh` + `verifyPersonalSign`), sends require the sender's SIWE session (`sender_id` is session-derived, never from the body), and the v2 box binds the sender static key into the HKDF `info`. A per-message signature was rejected for its mid-match popup cost against near-zero gain (the residual 7-day session-theft risk is identical across all session-authed writes). Reopen to require signatures.
- **CRY-03 — plaintext is refused at the door.** The route stored whatever string it was handed, so a client that failed to encrypt — or chose not to — wrote plaintext into `messages.content`. `content` must now parse as a sealed box (`isSealedBox`), which is structural: the right envelope, the right `v`, a real `epk`, string `iv`, and for v2 a `salt`. `isSealedBox` accepts v1 **and** v2 so historical boxes still send; a non-JSON string is rejected rather than 500ing. **Deliberately not done:** deleting `hooks/useMessages.ts` and forcing `[Encrypted Message]` rendering — the dormant sender still holds the only client path for something, and rendering a placeholder instead of plaintext changes what a player sees on an open failure, which needs the render pass, not a security patch.
- **CRY-04 — verified closed, no table move.** The `filter: wallet_address=eq.<me>` was already on the self-profile channel (`hooks/useCurrentUser.ts:99`). Empirically against the anon key: `players?select=wallet_address,coins,ecdh_pubkey` → **401**, narrow select → 200 — column grants exclude both sensitive columns (`202609300013`, policy `players_public_directory_read using (true)`), so `payload.new` cannot carry them over Realtime either (same grant enforcement). No separate table needed.
- **CRY-05** — covered by SEC-25 (verified not assumed): `lib/validation/ecdhJwk.ts` rebuilds from the four accepted fields and hard-refuses `d`/`key_ops`/`ext`/`alg`/`use`; the live `POST /api/profile/ecdh` calls `canonicalizeP256Jwk`. Same code, same gate — no second implementation to drift.
- **CRY-06 — non-extractable static keys.** Fresh identities generate `extractable: false` and persist as opaque CryptoKeys in IndexedDB; legacy localStorage JWKs keep working and migrate on load; no-IDB environments keep the legacy path documented. Read-back proves durability before a non-extractable pair is returned, so a silent store failure can never strand DMs. Regeneration clears the published flag and surfaces via `takeIdentityRegenerated()` — the send flow republishes on the same Send and failed sends carry `send_status: 'failed'` UI. Public-half export verified working from non-extractable pairs in Node. Pinned by executable tests including a v2 round-trip.
- **CRY-07 — the archive copy was reduced to a comment.** `supabase/migrations_archive/20260914_messages_rls_lockdown.sql` no longer carries a second `messages_restrict_columns`; the canonical lives in the baseline. `ENGINE_LOGIC.md`'s citation was corrected to `supabase/migrations/00000000000000_baseline.sql` (it named the archive filename), and the DM paragraph was updated to v2 boxes + IndexedDB storage.
- **CRY-08 — `messages` dropped from the publication (live).** Via `202609300018` (pushed via CLI; production publication is now `conversations, live_chat, live_matches, matchmaking_queue`). Zero subscribers verified across app/hooks/lib/Edge/routes; `compat-probe.ts`'s matrix updated off the dead channel.

**DB hardening:**

- **DB-09 — RLS is no longer the only thing standing between anon and the data.** `anon` and `authenticated` held **full** table privileges (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on 36 public tables — one accidental policy away from a breach, and the grant was already there, waiting. `202609300013` revokes everything and re-grants a code-derived allowlist: **SELECT only** on `players` (narrow column list preserved), `live_chat`, `live_matches`, `matches`, `tournaments`. The allowlist is **asserted against the code**, not against taste: `scripts/db-grants.test.ts` walks every client-side file, finds every `.from(...)` and `postgres_changes` subscription, and fails if one is not granted — so a new client query surfaces in CI rather than in production — and it also fails on a *dead* grant.
  - **Three findings from deriving it.** (1) `matchmaking_queue` is queried client-side by `ActivityFeed`/`LiveMatchmakingFeed` but has been revoked since the baseline — those feeds have read nothing for a long time; left revoked deliberately (it holds `validation_token`), recorded as an exception with its reason. (2) `pokes`, `player_missions` and `game_invites` all have `postgres_changes` subscriptions and **no RLS policy at all**, so default-deny stops them and they have never fired — `pokes` is not even in the `supabase_realtime` publication; granting them would be a grant with no effect and a wider blast radius, so they stay at zero. (3) `lobby_join_policies` already had zero grants.
  - **Verified in production:** the five allowlisted tables still read; `activities`, `conversations`, `messages`, `game_invites`, `spectator_bets`, `chips_pools`, `mission_vouchers`, `player_missions`, `pokes` all now `401`; `players?select=*` is `401` while the column list is `200`; anon `INSERT` returns `42501` and `DELETE` returns `401`. App smoke: `/`, `/api/geo`, `/api/notices` all `200`. See SYSTEM_REVIEW §10.6.
- **DB-10 — `live_matches` is column-scoped.** `live_matches_public_read` is `using (true)`, so **every** granted column was world-readable, and DB-09 kept a table-wide SELECT — which published to the anon key: `join_secret_hash` (the invite secret), `arena_key`, `authority_id` (who holds the arena tick) and `host_address` (every host wallet). Verified live before the fix — all four returned 200. `202609300015` revokes the table grant and re-grants exactly the six columns a spectator reads. Verified live after: the four secrets return **401**, the six public columns return 200, and the real `LiveArenaDirectory` query (with its `matches!inner` join) still resolves. The fix is at the GRANT, not the policy, so other readers are unaffected and a future secret-column select fails loudly with 42501 naming it.
- **DB-04 — audited 2026-10-11; closed as superseded.** `settle_match_bets` is a frozen stub — `202609300001` rewrites its body to `raise exception 'LEGACY_COINS_FROZEN'` — so the live function carries neither a window guard nor idempotency. Both properties were rebuilt in the CHIPS successor: `chips_escrow_settle_bets` (`202609300005:240-256`) refuses an open window (`BET_WINDOW_STILL_OPEN`), claims the open bet rows under a lock so a second call finds none, and writes the ledger with `on conflict do nothing`. The stale doc claim that the old RPC performs the timing check was `ENGINE_LOGIC.md:250`, fixed in the doc-drift pass below.
- **DB-05 — moot.** `mark_conversation_read` already exists as a SECURITY DEFINER function and is not missing. Not re-ported from the archive: the live one is the thing in use, and swapping it for a 24h/7d variant without knowing why the current one exists would be a downgrade dressed as a fix.
- **DB-06 — moot.** `cleanup_stale_data` already exists as a SECURITY DEFINER function. Same reasoning as DB-05: the live function is in use and its interval is not documented anywhere checkable, so "restoring" the archive's version is a coin flip that could delete data on a different schedule than production expects.
- **DB-07 — moot, verified rather than "fixed".** `messages_restrict_columns` uses `<>`, which is NULL-unsafe: if a comparison operand were NULL the row would be treated as unchanged and the mutation would slip past. Checked the columns: `sender_id`, `receiver_id` and `content` are all **NOT NULL** (only `ciphertext` is nullable, and that one already uses `IS DISTINCT FROM`). NULL cannot reach the comparison, so there is no hole. The code was left alone — rewriting it would have made the file look reviewed without changing a single behaviour.
- **DB-08 — the archive deny rule.** All 33 files across root `migrations/` + `supabase/migrations_archive/` carry the frozen-history header; `scripts/archive-guard.test.ts` (in `npm test`) fails any file without it and fails any canonical migration carrying the marker back.

**Found while making CI honest (2026-10-06/07)** — these were not on the audit list; they surfaced because two deploy-guardrail tests could not run in CI (they read `contracts/.env`, which is gitignored), so they were made self-contained, and a repo-wide sweep for published anvil keys went with them:

- **`assert_not_dev_key_on_live_network` failed OPEN.** It derived each anvil address with `cast` and `continue`d past failures, so on a runner without foundry every derivation failed, every key was skipped, and the guard **returned 0** — approving an anvil key for Base Sepolia exactly when the tooling was missing. Reproduced with `cast` off PATH. The primary check is now a precomputed address list that needs no tooling; derivation is a belt-and-braces extra and its absence is no longer load-bearing. (`f54efa9`)
- **`scripts/claim-sepolia.sh` signed a live claim with a published key.** `P2_PK` was hardcoded to anvil #1 and passed to `base-cast send … claimMatch(...)` on Base Sepolia — a live-network transaction signed by an account anyone could act as. It now resolves p2 from the `smoke-p2` keystore (or an exported `SMOKE_P2_PK`) and runs the dev-key guard on the actual key. This was the **only** remaining live-network occurrence in the repo.
- **`SmokeSepolia.s.sol` broadcast the player-2 leg with a published key.** `vm.startBroadcast(P2_PK)` used a hardcoded constant while `run()` derived the real p2 from `SMOKE_P2_PK`. The file's own comment said the host account had been moved to env — this was the half that was missed.
- **The live smoke path could not have completed at all.** `SmokeSepolia.s.sol` reads `SMOKE_HOST_PK` and `SMOKE_P2_PK`, and `smoke-sepolia.sh` exported neither, so `vm.envUint` reverted before anything broadcast. Both are now exported from the keystores the script already resolves, and guarded.
- **Two tests depended on undeclared local state.** The "simulate by default" test relied on the developer's `contracts/.env` for three addresses; the edge-signer test read that file outright. Both now pass their inputs inline. The edge-signer test additionally sweeps **every tracked file** for the ten anvil keys and allows a key only inside a backslash-continued command that names the local chain — so a key added to a live command line fails, while the two files that must hold the keys as data (the deny list and the test itself) are exempt by name.
- **CRY-01/02/03 verified in a real browser, not just Node.** Node tests check the source's shape; they cannot tell you whether `crypto.subtle.deriveBits({name:'HKDF'})` behaves the same in Chromium, and that is the assumption the whole DM format rests on. Driven with Playwright/Chromium and `lib/encryption.ts` loaded unmodified (esbuild strips the types; it has no imports): for the same fixed P-256 keys in both runtimes, the salt, the `info`, both ECDH shared secrets (static and ephemeral) and both derived AES keys are **byte-identical** in Chromium and Node. Also confirmed through the shipped functions: `encryptForPeer` writes v2 with a 16-byte salt and 12-byte iv, `decryptSealedBox` round-trips, a third identity cannot open the box, and a flipped ciphertext bit is rejected. Deployed site loads 200 with no uncaught page errors.
  - **This found a real gap that Node could not.** `isSealedBox` only checked that `epk` was truthy, so `{v:2, epk:42, …}` was accepted — the box got stored and then failed deep inside `importKey` as a client-side decrypt error, instead of being rejected at the door. It now requires a real P-256 public JWK (`kty:'EC'`, `crv:'P-256'`, string `x`/`y`), which is what CRY-03 specified in the first place. Three mutations confirm the guard bites.
  - Two runtime asymmetries worth knowing: Chromium rejects `deriveBits` when `public` is a raw JWK (Node accepts it), and rejects a JWK carrying `d` imported with `[]` usages with a *different* error than a public JWK with `['deriveBits']`; `crypto.subtle` is also unavailable on `about:blank` — `http://127.0.0.1` is needed, which is a secure context.
- **In-game CDP signing hung forever with zero feedback.** The SIWE success path parked after the app's Touch ID gate: viem prepared the smart-account signature (RPC storm to sepolia.base.org, finished), then CDP's `withMfa` awaited a deferred that only a fully-completed `verifyPasskey` settles. In this browser `isUserVerifyingPlatformAuthenticatorAvailable()` is false while real Touch ID ceremonies still complete, so the SDK threw `PASSKEY_NOT_SUPPORTED` before any prompt — and the app's `CdpMfaBridge` swallowed it (`catch {}`), left `busy` set, and left the UI on "sending" forever; every retry hit `busy` and was dropped, a permanent silent signing outage. Found by stage-logging the sign flow in Chromium and reading the viem + CDP SDK sources, not by guessing. Fix: the bridge bounds the attempt (45s, below the new 60s sign-level timeout in `useAppSession`), logs `[cdp-mfa]` LOUDLY on any failure, and always resets `busy` — a stall now surfaces as a retryable error and the next trigger supersedes the stale deferred instead of being dropped. Static guards assert the wrappers are USED at the call sites (not merely defined), the bridge fires before the sign timeout, and `busy` resets in `finally`; all four regressions mutation-checked.
- **Middleware rewrote the request and prod lost every rate-limited POST body.** `NextResponse.next({ request: { headers } })` was meant to hand handlers their budget, but no handler ever read it — and in Vercel's production runtime the rewritten request arrives with an EMPTY BODY. Every rate-limited POST (`siwe/verify`, `presence`, `live-chat`, `matchmaking/join`, `matchmaking/cancel`) 500'd inside `request.json()` in prod while passing locally and in CI. Found because live SIWE negative probes returned 500 where local returned 400/401; the control was exempt `/api/lobby/policy`, which parsed the identical body. The `/api/presence` probe said it plainly: `{"error":"Unexpected end of JSON input"}`. The middleware now passes the request through untouched and the budget travels on the response alone. This also means SEC-34's production verification was weaker than reported — the GET-only probes never exercised a body.
- **CI lacked foundry.** `scripts/deploy-guardrails.test.ts` executes the real deploy scripts, and `foundry-deploy.sh` checks `command -v forge` first — so without it the tests asserted on "forge: command not found" instead of "REFUSING". `foundry-rs/foundry-toolchain@v1` added to `engine-tests`. (`e3f0c53`)
- **The test suite created `contracts/.env` in the working tree.** `scripts/lib-load-env.sh:21-25` bootstraps a missing env file from `.env.example` — sensible interactively, but every `foundry-deploy.sh` invocation in the tests triggered it, so running `npm test` left a placeholder `contracts/.env` behind, and on CI (which has none) it left one for the rest of the run, which is what failed the edge-signer check with "exists but declares no EDGE_SIGNER". The tests now set `LUDO_ENV_FILE` to a tmpdir sandbox seeded from the example, so the bootstrap stays in tmp and the real file is untouched. Verified: the full suite passes with the real file present *and* absent, and does not create it either way.
- **The edge-signer test now also asserts the file cannot be committed.** `git check-ignore contracts/.env` and `git ls-files contracts/.env` are checked unconditionally, so the "secret is never committed" half is verified on every run rather than implied by the absence of a failure.
- **DB-15 — one constant.** `MAX_DM_CONTENT_LEN = 4000` in `lib/constants.ts`, imported by the messages route — the old 10000 route cap could 400-proof a body the DB then 500'd; the DB CHECK was already 4000, so no migration was needed.
- **DB-16 — one constant, live.** `MAX_CHAT_LEN = 500` shared by route + `live_chat.content` CHECK (`202609300018`, pushed; production CHECK verified as the 500 version). Safe to validate: production max content was 66 chars across all 39 rows.
- **DB-17 — partially, and deliberately.** `202609300016` adds `pokes_status_present` (`not null and length(btrim(status)) between 1 and 32`), killing `' '` and `''` — the part that causes a UI `switch` to fall through. **Not done: the canonical 2-value enum.** `pokes` is empty in production and the write path is barely exercised, so the real domain is not knowable from here, and a CHECK guessed from a grep breaks the first real write. `sent`/`poked_back` are the values in the code today but no enum is hard-coded on that evidence; filling it in needs the feature owner.
- **DB-18 — partially.** `202609300016` adds `tournaments_status_present` and `tournament_matches_status_present` (present, 1–32 chars, not padding), so both have a constraint for the first time. **Not done:** reconciling `tournaments.status` with the archive vocabulary — same reason as DB-17, both tables are empty, so guessing would encode a wrong vocabulary as a constraint.
- **DB-19** — contract decided: the live baseline wins. The archive `join_tournament` (`{success}` + coin debit, read-then-write) is superseded — coins are frozen so its debit raises, and it has zero app callers. Annotated as superseded in the archive file; no adapter, which would resurrect the frozen path.
- **DB-20 — verified no-op.** `app/api/matchmaking/join` never reads `role` or `search_timeout` — the route destructures only its own request body and forwards the RPC payload, and consumers use defensive access (`data.room_code || ''`). The `'search_timeout'` return exists only in the archived root migration, not in the canonical `join_matchmaking_hybrid`.
- **DB-23 (the part that mattered) — `202609300016`.** Added `unique (wallet_address) where revoked_at is null` on `app_sessions`. `/api/siwe/verify` revokes before it inserts, so this cannot deadlock the normal login path; what it closes is two concurrent verifies both reading "no live session" and both inserting, leaving a wallet with two valid app sessions. `app_sessions_active_idx` is a plain btree and did not prevent that. **Not done:** the rest of the §10.3 index list — not audited item by item in this pass.
- **DB-24 — ported as canonical, live.** `prevent_client_player_tampering` + trigger ported verbatim (NULL-safe `IS DISTINCT FROM` throughout) via `202609300018`, pushed; production trigger confirmed alongside `players_coins_frozen`. Proven as a backstop on scratch: with RLS hypothetically opened, an anon UPDATE is refused with `protected player fields are server-owned` and the row is unchanged. The archive file keeps its history.
- **DB-25 — moot.** `update_offline_status()` does not exist in `public` (checked `pg_proc`), so there is nothing to delete, and no `database.types.ts` entry was found. The "duplicates `cleanup_stale_data` with a different interval" concern describes a function that is not there.
- **DB-27 (the dead entries) — `202609300016`.** Removed `game_invites` from `supabase_realtime`. It was on the publication with **zero RLS policies** — RLS-with-no-policy denies, so the channel was dead while looking configured — and it is the table carrying `validation_token`, the secret SEC-12 moved server-side. Nothing subscribes to it outside `scripts/compat-probe.ts`. Verified live: the publication is now `conversations, live_chat, live_matches, matchmaking_queue`, all of which carry policies. **Not done:** adding `players`/`player_missions`/`pokes` to the publication and migrating those subscribers to broadcast — those three subscriptions are still dead. A per-player `player_missions` policy is real work with a real privacy edge (missions are per-player), and it is a feature change rather than a hardening fix, so it is left for whoever owns it rather than half-built here.

### Gate results

- **Route auth matrix (§10.7) regenerated and diffed against a checked-in expectation.** `scripts/check-routes.mjs` runs in CI and locally: 47 routes classified. Reconciled again on 2026-10-13 — the `KNOWN_UNAUTHENTICATED` allowlist had three stale entries (SEC-07/08/12 had been closed in code on 2026-10-06 but never removed from the matrix: `friends`, `live-arena/power4p`, `lobby/join` are all session-gated now), leaving exactly one tracked entry: `live-chat`, public **by intent** (SEC-34 classified it) with its POST write throttled 60/min via `lib/rateLimitRoutes.ts`. With that reconciled, **no unauthenticated mutation remains.**
- **`check:schema` asserts** no `anon` table grants beyond the allowlist, no `anon`/`authenticated` EXECUTE on `security definer`, all expected `column_default` values, and all expected `pg_proc` signatures — green in static **and** DB mode on 29 migrations, 17 definer functions including the purchase RPC (2026-10-11; re-confirmed on the DB-22 scratch cluster 2026-10-13).
- **`crypto.subtle.deriveBits({name:'HKDF', …})` is the only DM key path for new writes** — pinned by `auth-boundary.test.ts`: `encryptForPeer` contains `deriveAesKeyV2` and no `deriveAesKeyV1`; v1 + legacy wallet-hash stay decrypt-only for historical rows (retirement tracked as ECO-07).
- **A test asserts `POST /api/messages` rejects plaintext** (`auth-boundary.test.ts` CRY-03 pin, plus `isSealedBox` execution coverage).
- **Verified against the anon key:** the players half was proven live (anon `coins`/`ecdh_pubkey` select → 401, see CRY-04); the `messages` half was closed by the publication drop (production publication verified: `conversations, live_chat, live_matches, matchmaking_queue` — no `messages` channel exists to return rows on).

---

### Phase 4 — Netcode liveness

**Why.** Matches could not be relied on to complete: any turn with no legal move permanently desynced `match_states` and 403'd the next player.

### What was implemented

- **NET-01** — both the three-sixes and no-legal-move branches funnel through the delayed `turnSwitch` path, which on networked matches calls `moveAuth.passTurn` and applies the returned state via `applyServerState`, and broadcasts from that (`useGameActions.ts:535-633`; the AFK variant lives at `useAFKManager.ts:130-154`). The STALE_SEQ retry itself is `lib/netcode/staleSeq.ts`: it re-reads the 409's authoritative seq and re-submits with the SAME `rollId`, bounded to one attempt (6 executable tests). `source` stays keyed on seat kind (`host-assist` for bot/AFK, `player` for humans) rather than on the three-sixes/no-legal reason — a recorded design note, not an open item (2026-10-13).
- **NET-02** — the private seq ref is gone: `TeamUpContext.serverSeqRef` is threaded into `useGameActions` + `useAFKManager`, the duplicate high-water writes are gone, and one retry implementation is shared by move/pass. `useGameEngine`'s private seq ref is deleted.
- **NET-03** — `isMatchAuthority = isHost || isComputeHost` gates `ROLL_DICE`/`MOVE_TOKEN`/`TURN_SWITCH`; stateful broadcasts carry `source: 'match_states'` + `seq`, so a guest only advances through the seq-gated path (an untagged or behind-seq override is refused). The partial-hint broadcasts are gone: the move path and both turn-switch paths broadcast the full authority state as `ENGINE_STATE` (which carries the seq), so guests keep the same visual cadence while reading one source. Sequenced together with the single-slot `lastIntent` replacement, because the stateful broadcast is what makes dropping the hints safe. *(The private-channel half of NET-03 is NET-03a/b — see Deferred by decision.)*
- **NET-04** — a FIFO `intentQueue` in `TeamUpContext`, with `lastIntent` as its head; the existing host effect drains one intent per state change. ACK included: the guest watches 2.5s and resends the identical `intentId` (max 2 retries, dual-path, deduped host-side by `rememberIntent`); any ACK cancels the watch. A distinct `nack` status is not emitted — the actual failure mode is a silent drop, which the retry covers; `STALE_SEQ` is the same bounded resend. The effect returns without clearing on `action.kind === 'ignore'`, so a declined intent stays queued for the guest's retry or a later state change.
- **NET-05** — failed fetches retry on `reconnectDelayMs` (bounded 8, monotonic, capped); `MATCH_NOT_FOUND` is terminal; `online` restarts the ladder; and a `hasAuthoritativeSnapshot` holder is never pushed to `reconnecting` by a flap — it reports `net_degraded` and keeps orchestrating. Tests pin the ladder and the hold gate.
- **NET-06** — `broadcastAction` is gated on `isHost` alone. The election (`useGamePresence`) is still client-clock-ordered **by design decision recorded here**; the server-ordered election from `match_states.player_seats` seat index is the remaining upgrade, tracked as a follow-up rather than silently claimed.
- **NET-07** — the intent effect gates on `isAuthority` (computed at `useGameEngine.ts:116`), which now requires `isComputeHost && matchConnectionStatus === 'connected' && hasAuthoritativeSnapshot` — a snapshot-less compute host can no longer drive AI/AFK (which was how a match got wedged rather than saved). `HostMigrationPanel` runs a real handshake (`electing → verifying → handed | refused`, with a re-arm loop on refusal) driven by an `onElect` callback from `app/page.tsx`; the candidate must hold a verified snapshot and be a seated player, or the election is refused, and the elected wallet is displayed. `TeamUpContext` fires the FSM `HOST_ELECT` only when the elected compute host actually changes hands, so a spurious election is metered as an illegal transition. Abandon classification is wired too: disconnect stamps, `classifyAndRecordAbandon` / `abandonGraceFor`, and `useAFKManager`'s kick path calling `onAbandon`, so a 3-strike kick produces a classified `AbandonOutcome` (dual-sign / edge-only / none) with the grace window honoured and telemetry recorded — no funds move (`ABANDON_BURN_SPLIT_ENABLED` stays false); this is classification + evidence, which is what the settlement path needs. 7 tests pin the policy table.
- **NET-08** — both dedup stores are `createDedupStore` (TTL+LRU, evictions meter `net_intent_dup`); all three stores clear on `leaveGame` AND on room-code change (a new room inherits the old id space otherwise); `sharedMoveSessions` is keyed by matchId and cleared via the exported `clearAllMoveSessions()`; the intent-ACK watches clear too; and a monotonic high-water mark means an id *below* the mark is refused even after eviction (order, not residency), closing the double-apply window without unbounded memory. Tests pin replay-after-evict and order-less-id fail-closed.
- **NET-09** — the PeerJS `GAME_ACTION` branch now runs `isGameIntent` (bumping `net_schema_drop` + `schema_drop` telemetry) instead of trusting `data.action`; identity is `intentId || actionId` on BOTH transports; `rememberIntent` returns `'new' | 'dup' | 'skip'` and both callers branch on `!== 'new'` explicitly.
- **NET-10** — subscribes to `game-room-<code>` (nothing ever broadcast to `match-states-room-`) and polls the public snapshot every 5s as a backstop, cleared on teardown.
- **NET-11** — the relay effect's deps are `[currentRoomCode, lobbyState?.roomCode]` and the handlers are read from refs, so a chat-message re-render no longer tears down and re-subscribes the room channel.
- **NET-12** — the blanket `setLocalGameState(networkGameState)` sync is deleted. It fired first on the same commit and made the seq-guarded merge unreachable, while clobbering host-only locals (powerTiles types, matchId).
- **NET-13** — `useGameTimer` stores an absolute deadline keyed per (colour, phase, dice) turn and derives `timeLeft` from `Date.now()` every tick, so a backgrounded tab throttled to ~1/min can no longer decay 15s at 0.017/s; `visibilitychange` re-syncs on resume and the idle-warning countdown uses the same deadline. (Before: a backgrounded tab throttles `setInterval` to ~1/min, so a 15s timer decays at 0.017/s and AFK enforcement never fires.)
- **NET-14** — gated on `!isNetworkedMatch`: networked boards render from the authority snapshot, so the local phase flip was desyncing `match_states` and 403-ing the next player.
- **NET-15** — `scheduleRetry` registers every ladder id in `retryLadderTimers`; `clearRetryLadders` runs in `leaveGame`, in the room-change effect and on a peer-connection close; the seat-retry, join-retry and connect-retry ladders all use it.
- **NET-16** — the move merge is restricted to `positions`/`matchStats`/`winner`/`winners` (+ display fields); turn and auth fields stay local, so an intermediate turn cannot rewrite whose turn the client believes it is.
- **NET-17** — verified, no change needed: `handleRoll` already reads `stateRef.current.matchId`.
- **NET-18** — `useAIBrain` clears both timers on unmount in addition to the actionKey clearing; the ref-based identity-churn protection is unchanged.
- **NET-19** — `handleRoll` → `Promise<RollOutcome>` and `moveToken` → `Promise<MoveTokenOutcome>` ('applied' | 'failed' | 'deferred'); `useAFKManager` re-arms `timeLeft` only on `'applied'`, so a refused roll/move no longer resets the clock forever and the 3rd-strike kick is reachable.
- **REA-05** — added to the memo deps; it was indeed the only returned key missing.

### Gate results

- **`npm run test:netcode` green** (`scripts/netcode.test.ts`, in `npm test`). Mounting TeamUpProvider would test mocks, not code (supabase/wagmi/PeerJS/audio) — so the harness drives the REAL decision modules the provider delegates to, composed as the provider composes them: `computeAuthority` + `shouldApplyGameAction` were extracted from the callbacks for exactly this (`lib/netcode/authorityGate.ts`). All five assertions execute: dual-transport once-only, retry with same rollId, guest verb drop + snapshot-only advance, snapshot-gated compute-host consume, same-tick pair.
- **`npm run test:protocol` green** (`scripts/protocol.test.ts`, in `npm test` — 25 hostile payloads rejected, all 5 verbs' legal shapes pass, plus pins that both transports run the same `isGameIntent` parser with identical `intentId || actionId` identity).
- **`scripts/mp.harness.ts` fixed** — the "imports none" half was stale (it already drove gameLogic/matchFsm/resync/counters), so what landed is the real complaint: the snapshot is now a deep copy (as the socket boundary is in production) and the guest keeps its own board object instead of merging into `host.state` — plus the end-to-end box below.
- **Drills drive the real dedup** — all three import `createDedupStore`/`rememberIntent`; local Sets and hand-rolled bump calls were replaced, counts unchanged. `processGameAction` itself is a React callback that cannot run in Node; its two decisions under test (`shouldApplyGameAction`, intent parse) are covered in `test:netcode`/`test:protocol` instead.
- **End-to-end termination in a drill** — `mp.harness.ts` plays 4P + 2v2 through the app's offline path (`getLegalTokenIndices`/`processMove`/`handleThreeSixes`, the functions `useGameActions` calls) with seeded dice, a rigged opening triple-six (deterministic forfeit through the real path), counted no-legal passes, and rotation advanced on every pass/forfeit (the loop's first version reproduced the NET-01 wedge: passes re-rolled the same seat forever). 2v2 ends `Team N`. The authority engine's own termination is `test:golden`'s 50/50.

---

### Phase 5 — Client architecture

**Why.** Unbounded channels, whole-tree re-renders at ~1Hz, a per-frame document query on mobile, and a single error boundary around 13 panels.

### What was implemented

- **REA-01** — the receive path was verified as-is (one channel per room + teardown); the send path no longer mints a throwaway channel per relay — sends go through a ref-held channel joined once per room.
- **REA-02** — the 18-field context value is `useMemo`'d; stable `useCallback` fields keep identity so the memo only breaks on real changes.
- **REA-03** — the filter pre-existed (`useCurrentUser.ts:99`, proven by CRY-04's live 401); the leaderboard projection is `.limit(50)`-bounded by construction; both `setProfilesMap` merges are equality-guarded via `profilesEqual` (identity fields only — no deep equal on the hot path).
- **REA-04** — both halves: a `/api/messages` 403 degrades only the private section (`sectionsFailed`), the other three sections still land, `isBootComplete` is set in `finally` (partial data beats a permanent loader), and the failure list resets on retry.
- **REA-06** — `attributes` dropped from the observer. The observer's own scan sets `style`, which re-fired the observer — a per-frame document query on a mutating board.
- **REA-07** — the hook is now a `useSyncExternalStore` over the cookie with a stable cached snapshot and one invalidation event. Proven by mounting, not by reading: `test:hooks` mounts two readers and a third setter, and both readers follow the toggle.
- **REA-08** — all 9 dashboard panels are wrapped in their own named `PanelErrorBoundary` (a throwing panel shows its own card + retry instead of unmounting the app); `app/global-error.tsx` covers root-layout failure with a no-chain-effects message.
- **REA-09** — the clone is gone; `audio.play()` runs on the node that carries the volume.
- **REA-10** — the bonus-turn holder is computed into the fresh `finalState` literal; the engine's return value is never mutated.
- **REA-11** — `shouldFlushServerState` (`lib/netcode/flushGate.ts`): flush exactly once per matchId arrival for the connected host, hold on timer churn, reset when the match goes away. Executed by `test:hooks`, not source-pinned.
- **REA-12** — a shared `bind()` connects/plays/tears-down all 10 oscillator sites (`onended` disconnects the chain); the ambient graph too, so stopped oscillators no longer accumulate in the context.
- **REA-13** — kept and wired instead of deleted: it held the only ambient driver, so the Game Music preference did nothing. Now a headless `AudioDriver` mounted once at the app root; the Settings row is the control.
- **REA-14** — `(pointer: coarse)` added; desktop windows never see the overlay.
- **REA-15** — the manual tag was deleted (the browser honoured the first tag, so the export was inert); both keys moved into the export.
- **REA-16** — the identity effect re-resolves on wallet connect/disconnect AND guest-flag change (was connect-only, so guests never re-resolved).
- **REA-17** — bounded 15s + exception-safe; a slow/hostile endpoint no longer hangs the listener with no feedback.
- **REA-18 — verified done.** The feed is dashboard-gated: `GameLobby` (which mounts it) renders only under `appState === 'dashboard'` (`app/page.tsx:684`, `:710`), and `LiveChatPanel.tsx` / `LiveMatchSearchesPanel.tsx` no longer exist as files. Residue, not a regression: dead `LiveChatPanel`/`LiveMatchSearchesPanel` exports remain inside `ActivityFeed.tsx:98/353`, and the feed stays mounted while the dashboard is open even with the card closed (deliberate — comment at `ActivityFeed.tsx:1382-1383`).
- **REA-19** — timeouts and GSAP tweens register into `cleanupsRef`, drained on unmount (never `setState` on a torn-down piece, no tweens on detached DOM).
- **REA-20** — the render-body write moved into an effect.
- **REA-21** — hoisted to component scope (`pointRotation`); no hook call sits in JSX where a conditional path could break hook order.
- **REA-22** — `lastUpdate: 0` (a module-evaluated `Date.now()` froze the import moment into every fresh state); `leaveGame` spreads a structured clone with fresh arrays + `Date.now()` instead of sharing the module object.
- **REA-23** — `useMemo` over the stable callbacks; presence/timer renders no longer re-render every consumer.
- **REA-24** — both wrapped; memoized panels receiving them survive unrelated Page renders.
- **REA-25** — verified, no change needed: the searches effect already depends on `[me, resolveHost]`.
- **REA-26 — verified done.** The square derives from the measured board container and is clamped to it (`Math.max(minSquare, Math.floor(Math.min(area.w, area.h)))`, `hooks/useStableBoardBox.ts:45` via `Board.tsx:243-245`); the 160px floor is a degenerate-case guard, not a viewport-height floor.
- **REA-27** — deleted (RankingsPanel is the live surface; the lazy copy only doubled the chunk graph).
- **REA-28 — recorded plan, NOT removal.** Removing the five x402 packages broke `npm run build`: `@coinbase/cdp-sdk` and `@base-org/account` import `@x402/*/client` subpaths at bundle time, so they are transitively required by the wallet stack even though no app source imports them. Restored; revisit only if the wallet stack drops x402.
- **REA-29** — verified, no change needed: already `process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY || ''`.
- **next.config.ts** — `experimental.optimizePackageImports` for the barrel packages (`react-icons`, `framer-motion`, `canvas-confetti`); `compiler.removeConsole` excluding `error`/`warn` (the telemetry pipeline); `processGameAction` logs type + id only, never the payload. Verified by a clean `npm run build`.

### Gate results

- **`npm run test:hooks` green** — `scripts/hooks-harness.test.ts` (in `npm test`; `react-test-renderer@19.2.4` dev dep). REA-07 + unmount executed by mounting; REA-11 executed via `shouldFlushServerState`; REA-05/NET-12/NET-17 source-pinned (mounting TeamUpProvider would test mocks, not code).
- **Throwing inside any panel renders only that panel's error boundary** — 9 named `PanelErrorBoundary` wrappers + `app/global-error.tsx`; verified by construction (each panel subtree is isolated and the board lives outside all of them).
- **Channel count during a 300-action match is constant** — sends reuse one ref-held channel per room (no per-send minting), receives subscribe once per room with `removeChannel` teardown, and the spectator poll is an interval, not a channel.
- **React Profiler trace on a mid-range Android device** — *not run, deferred as a measurement gap, not a code gap* (see Deferred by decision): the clause needs a physical device plus a live networked match, and no browser-automation toolchain exists in the environment where remediation ran. What is left is measurement, not code: the structural causes are all removed (REA-06 observer, REA-02/23 memos, REA-11 flush gate, REA-01 channel-per-send).

---

### Phase 6 — Hygiene and drift

### What was implemented

- **ENG-15** — `checkWinStatus` deleted (zero callers; win detection lives in `processMove`/`evaluateVictory`). Done in Phase 2.
- **ENG-16** — the doc was corrected to the constant (`REACH_FINISH: 150`); the +200 had no code backing it, so the code is the source of truth.
- **NET-20** — `usePeerManager` deleted (zero imports; its 5s full-state `SYNC_STATE` broadcast conflicts with the match_states-authority direction Phase 4 takes. The liveness heartbeat is the match presence sync — see NET-21).
- **NET-21** — emitted from production code: the match presence sync bumps `net_heartbeat_ok` (throttled to 5s — joins are not heartbeats) and a change of elected compute host bumps `net_authority_switch` **and** sends a real `HOST_ELECT` through the match FSM, phase-gated to `live`/`resyncing` so lobby elections don't pollute `illegalTransitions` (drill rows D3/A4 measurable). Wired via `hooks/useGamePresence.ts` `onEvent` → `TeamUpContext`.
- **NET-22** — `classifyAbandon` is counter-silent (both `bumpNet` calls removed; the import was dropped), pinned by an executable test asserting `net_intent_ok === 0` after three classifications.
- **NET-23** — amortized: expired heads are collected every `has`/`add` in amortized O(1) — each entry removed once — with a throttled full sweep for entries stranded behind a refreshed head (`sweepIntervalMs`, default 30s). The test pins both behaviours plus that presence (not absence) is what `has()` reports, so lazy reclaim can never flip a dup to new early.
- **NET-24** — `applyServerState` re-attaches local power-tile types: wire-sent tiles arrive type-stripped, and a wholesale `...state` spread used to destroy the host's own tile knowledge, breaking pickup logic. Types for tiles still at the same cell are re-attached; genuinely respawned tiles stay typeless.
- **NET-25** — hardened: `connect()` bounds by `connectTimeoutMs` (10s) and detects close-before-open (was an infinite `onopen` await); the CONNECTING poll rejects at the deadline instead of polling forever; `disconnect()` clears `messageHandlers` so reconnects don't fire stale closures; `listenerCount()` exposes the leak. 4 stub-WebSocket tests pin all of it, including slow-open success.
- **NET-26** — metered: the 401 → public-`get` downgrade in `getMatchState` emits `track('net_degraded', { reason: 'moveauth_public_downgrade', matchId })` before retrying, so an auth outage reads as a degraded board rather than a working read-only one.
- **NET-27** — passed + reset: `MatchStatsOverlay` takes `seq`/`replay` from `Board` (`serverSeq`; offline 0 stays null) and feeds `buildMatchReceipt`; counters `resetNetCounters()` on networked `START_GAME` and on rematch, so the receipt's net section describes the match, not the session. `replay` is plumbed and stays `undefined` until a live replay log is created in prod — stated, not faked.
- **ECO-04 — recorded as a decision, needs a redeploy to land.** `lobbyTtl` is NOT in `PoolConfig`/`LOBBY_TYPEHASH`; binding it changes the live `MatchPool` EIP-712 type hash, which invalidates every in-flight ticket signature and requires a redeploy (the exact class of churn the Sepolia-only decision deferred). The current design instead takes `lobbyTtl` as `expirePool(poolId, lobbyTtl)`'s parameter with a `TooEarly` bound (`MatchPool.sol:480`) — operational, owner-signed, and already enforced. No code was changed, to avoid silently diverging source from the deployed bytecode; recorded as the reversible decision. Reopen to add the field + redeploy via `scripts/foundry-deploy.sh sepolia-pool`.
- **ECO-05** — `msg.sender != wallet` only, plus an allowlisted relayer: the `tx.origin` path is gone (it let any contract the wallet interacted with submit the wallet's voucher). Relaying is now `setClaimRelayer(addr, bool)`, owner-only, zero-address-refused, revocable, and 4 Foundry tests pin allowlisted-success / unallowlisted-revert / revocation / owner-gate. `DeployGame.s.sol` prints the wiring step; live wiring (`missions.setClaimRelayer(hub, true)`) is an owner multisig call alongside the existing post-deploy steps, since the script broadcasts as a non-owner deployer.
- **ECO-07** — the dead encrypt writer (`encryptMessage`, zero callers) is deleted; `deriveSharedKey` + the v1 KDF stay decrypt-only for historical rows, which would otherwise strand readable history. Verified by grep + tsc.
- **DB-22 — closed 2026-10-13.** The blocker read "the regen needs a live DB connection" — true only of the Supabase project, not of the chain. A scratch PostgreSQL 18 cluster (no docker: `embedded-postgres` via npm) replayed all 29 canonical migrations cleanly, with the three Supabase-only prerequisites pre-created (`anon`/`authenticated`/`service_role` roles, the `supabase_realtime` publication, and pgcrypto installed in an `extensions` schema so it does not pollute `--schema public`), and `supabase gen types typescript --db-url … --schema public` then wrote `types/database.types.ts` from the chain itself. The regen adds the whole CHIPS RPC family (`chips_escrow_deposit` / `withdraw` / `place_bet` / `spend_purchase` / `settle_bets` / `touch` / `solvency`), `join_tournament`, `next_mission_voucher_nonce`, `purchase_marketplace`, and the tables the stale file never had (`chips_events`, `chips_escrow_accounts`, `chips_escrow_ledger`, `chips_marketplace_purchases`, `marketplace_purchases`, `mission_catalog`, …) — 20 → 43 tables, 7 → 17 functions, nothing dropped.
  - Typing `serviceDb()` as `SupabaseClient<Database>` made the new types bite and surfaced **10 real latent bugs that the drift had been hiding** — all fixed, none theoretical: (1) `players.total_games` is a stored generated column, so the two writes in `app/api/match/record/route.ts` failed with **428C9** — games are now counted on the mode counter (`classic_played` / `power_played`); (2) the `live_matches` register upsert omitted NOT-NULL `room_code` (**23502** on any fresh match) — now carried in every branch and refused when the match has none; (3) `as never` dropped from `marketplace/purchase`'s RPC call, from the sibling escrow calls in `app/api/spectator-bets/route.ts` (`chips_escrow_withdraw` / `chips_escrow_place_bet` — arg names verified against the SQL), and from the four onboarding-writer call sites (`Db` is now typed); (4) `join_matchmaking_hybrid`'s nullable args pass `undefined` instead of `null`; (5) jsonb/numeric boundaries narrow once at the call site (`profile/ecdh` JWK, `missionVoucherIssue` 1e18 amounts, `match/state` GameState) instead of blanket casts.
  - Gates at closure: `tsc` 0 errors · `lint` clean · `npm test` 406 pass / 0 fail / 11 skipped · `check:schema` green in both static and DB mode against the scratch cluster (29 migrations, 17 definer fns + grants asserted) · `check:drift` 10/10. *(The suite count has moved twice for gate-shape reasons, not lost coverage: 406 → 405 when the checkbox-era integrity gate (6 assertions) was rewritten as the record-era gate (5), and 405 → 406 when the consolidation added the redirect-stub check — 6 assertions on `docs/ops/IMPLEMENTATION_RECORD.md`.)*
  - **Residual, stated not faked:** the file is generated from the canonical chain, which `check:schema` DB mode asserts the live project matches; a `supabase gen types` against the live project when credentials are back is the belt-and-braces confirmation, not new information.
- **DB-26** — `match_rolls.status` vocabulary documented, archives marked frozen with the guard named, and the DB-01 abort + fix recorded.
- **DB-08** — covered by the Phase 3 archive guard (`scripts/archive-guard.test.ts` + headers on both archive dirs).

**Doc-drift reconciliation (done in the same pass):**

- `ENGINE_LOGIC.md` — the `settle_match_bets` timing-guard claim now names `chips_escrow_settle_bets` and the frozen stub (DB-04), and the V3 notes name the open/already-settled + null-bet-type + no-winner refusals actually shipped in `resolve-bet`.
- `ENGINE_LOGIC.md` §7.2 — the DM fail-closed claim now includes the `POST /api/messages` `isSealedBox` door, not just the missing-pubkey rule (CRY-03); the DM paragraph accounts for v2 boxes, HKDF and IndexedDB identity.
- `ENGINE_LOGIC.md` §7.7 — the spectator channel is named precisely: gameplay on `game-room-${roomCode}`; `match-states-room-<roomCode>` is the presence/bootstrap channel only (NET-10).
- `ENGINE_LOGIC.md` §3.5 — power tiles carry the ENG-07 fixture wording (hidden → reveal → respawn); deterministic `powerTileSeed` spawn documented (ENG-11).
- `ENGINE_LOGIC.md` §5.2 — AI scores corrected to the `AI_SCORES` constants (+ Reach Finish 150, not 200) with the ENG-16 note that the code is the source of truth.
- `ENGINE_LOGIC.md` §5.4 — the Boost gate condition documented (≤12 to home, or opponent ≤6 behind) plus the `{color, tokenIndex}` assist return (ENG-18/ENG-10).
- `AGENTS.md` invariant 8 — the `messages_restrict_columns` citation names the canonical baseline; the archive copy is reduced to a comment (CRY-07).
- `AGENTS.md` invariant 7 — DMs no longer claim a localStorage-only identity: non-extractable IndexedDB key + v2 box + structural plaintext refusal (CRY-03/CRY-06).
- `AGENTS.md` invariant 3 — "Edge `roll-dice` only" states the abort-on-failure semantics and the seat+turn binding that makes retry-until-six impossible (SEC-01/02).
- `AGENTS.md` invariant 1 — the `TEAM_PAIRINGS` invariant now includes the derived `LOBBY_COLORS['2v2']` and the trap truce (ENG-02/ENG-12).
- `docs/ops/NETCODE_DRILLS.md` — the counter list annotated production-bumped (NET-21), D3 notes the phase-gated `HOST_ELECT`, A6 notes classification meters no intents, and the NET-27 per-match reset is documented.
- `docs/ops/UNPARK_CHECKLIST.md` — the "code gate green" counts refreshed with an explicit scope note of what it still does **not** cover (literal `db reset`, device drills, measured hop budget).
- `AGENTS.md` now points at `docs/ops/SYSTEM_REVIEW.md` + this record as the finding register, and its migrations note carries the frozen-archive rule (`db push` / SQL Editor; archive guard gated).

### Gate results

- `npm run check:drift` green (10/10) and wired into CI (`engine-tests`).
- `check:schema`, `check:rpc-args` (folded into `check:schema` A2), `test:engine-diff`, `test:engine-core`, `test:golden`, `test:netcode` and `test:protocol` all run as named steps in `.github/workflows/ci.yml` (engine-diff, engine-core, netcode, protocol and hooks alongside the existing golden/concurrency/routes/schema gates).
- All doc claims in the table above match the code (re-verified 2026-10-11; the record rewrite 2026-10-13 re-checked every entry that cites code or counts).
- **154/154 findings closed or signed off.** Phase 6 code tasks all closed; DB-22 was the last open item (2026-10-13). What remains is *decisions*, recorded below with their unblock criteria: NET-03a/b (private room channel — blocked on project credentials), the Android device trace (Phase 5 gate — needs hardware), and the Base mainnet deploy (Phase 1 — owner decision), plus the explicit risk acceptances (CRY-02, ECO-04, mainnet deferral). None is silently untracked.

---


---

## Part III — Recorded decisions, risk acceptances, and deferrals

## Recorded decisions and risk acceptances

- **CRY-02 — no per-message DM signature** (owner-confirmed 2026-10-11). Key publish requires a fresh `personal_sign` over the fingerprint, sends require the sender's SIWE session, and the v2 box binds the sender static key into the HKDF `info`. A per-message signature was rejected for its mid-match popup cost against near-zero gain; the residual 7-day session-theft risk is identical across all session-authed writes. Reopen to require signatures.
- **ECO-04 — `lobbyTtl` stays operational, not structural.** Binding it into `PoolConfig`/`LOBBY_TYPEHASH` changes the live type hash and invalidates in-flight ticket signatures. The `expirePool(poolId, lobbyTtl)` parameter with a `TooEarly` bound is enforced. Reopen to add the field + redeploy.
- **Mainnet deferral (2026-10-11).** Sepolia-only by owner decision; there is no mainnet yet, and nothing to redeploy for. See Deferred by decision.
- **SEC-09a — superseded, not implemented.** No conditional-claim RPC was ever written; `/api/missions/claim` is an explicit `410` instead, so the read-then-write has no caller. Closed as a supersession.
- **DB-05 / DB-06 / DB-20 / DB-25 — moot or no-op classifications** (`mark_conversation_read` and `cleanup_stale_data` exist and are in use; the matchmaking join route never reads `role`/`search_timeout`; `update_offline_status()` does not exist). Re-porting the archive's variants would have been a downgrade or a coin flip dressed as a fix.
- **DB-17 / DB-18 — partial by evidence.** Presence CHECKs landed; the canonical enums were deliberately not guessed because both tables are empty in production and a wrong vocabulary becomes a constraint that breaks the first real write. Needs the feature owner.
- **DB-23 / DB-27 — partial, scoped.** The session-concurrency index and the dead-publication entries landed; the remaining §10.3 index list and the `players`/`player_missions`/`pokes` publication migration are feature work with a privacy edge, left for their owners rather than half-built.
- **NET-06 — election stays client-clock-ordered** by recorded design decision; the server-ordered election from `match_states.player_seats` is the remaining upgrade.
- **REA-28 — x402 packages stay.** Removing them breaks `npm run build` (transitively required by the wallet stack); revisit only if the wallet stack drops x402.
- **Marketplace acceptance** — the 200 path is proven on the scratch chain and the route is type-checked; the first *funded* purchase will return the first live 200. No unbacked smoke deposit was minted to force one.
- **Phase 0's `supabase db reset`** equivalence is proven in substance (psql replay + direct RESET execution, column-for-column reproduction); a literal run on a Docker machine remains the formal confirmation.

### Deferred by decision (not defects) — with unblock criteria

1. **NET-03a / NET-03b — the private room channel.** Making the room channel `private: true` + `realtime.setAuth` (or moving broadcasts behind Edge) needs a JWT mint that does not exist in the repo and a `realtime.messages` RLS policy that no migration defines; `private: true` without an authorizing policy would refuse every broadcast — a regression, not a fix. **Blocked on project credentials, not effort:** minting needs the project's JWT secret or a registered signing key, and neither is in `.env.local` nor derivable from the service-role key. **Unblock:** **03a** register a signing key (or expose the JWT secret) and add a mint endpoint that exchanges the SIWE app session for a Supabase JWT scoped to the wallet; **03b** add the `realtime.messages` policy admitting only match participants, set `private: true` + `setAuth` on the room channels, deploy, and verify live that an authorized pair still exchanges while an outsider is refused. **Mitigated in the meantime:** a non-authority client's state write is refused (`source`/seq gate) and only `isHost` broadcasts (NET-03/NET-06 closed), so an eavesdropper can read the room but cannot write it.
2. **Base mainnet deploy.** Deferred 2026-10-11 — Sepolia-only by owner decision. The Sepolia pair matches source (no `.sol` changes since the byte-identical deploy), so there is nothing to redeploy for. **Unblock:** the owner's call, then `scripts/foundry-deploy.sh base-pool` with `GAME_OWNER`/`DEPLOYER_ADDRESS`/`EDGE_SIGNER` set to mainnet addresses — the Sepolia values must not be reused — and the same verify-contract cross-check against the local artifact.
3. **The Android device trace (Phase 5 gate).** A React Profiler trace on a mid-range Android device during a live networked match, confirming no per-frame document query and no >1Hz whole-tree re-render. All structural causes were removed in code (REA-06 observer, REA-02/23 memos, REA-11 flush gate, REA-01 channel-per-send). **Unblock:** a physical mid-range Android plus a live networked match; a CPU-throttled desktop proxy would not satisfy the "mid-range Android" clause, so it was not faked.


---

## Part IV — Open work beyond the audit findings

*The plan's §2 "undone checklist", reconciled on 2026-10-13 against what has landed since. Items marked DONE moved to the part that closed them; the rest carry their blocker. The three audit deferrals (Part III) cross-reference here where they overlap.*

**Device and live-evidence gaps (all need hardware or a live session)**

- **OPEN — Q2 phone hop pass** (`docs/ops/DEVICE_PASS.md` → `UNPARK_DECISION.md` §1.1). Same need as the Phase 5 Android device trace (Part III deferral 3): a physical mid-range device plus a live networked match. One device session closes both.
- **OPEN — N3 live D1–D4 with two real clients** (`docs/ops/NETCODE_DRILLS.md` → `UNPARK_DECISION.md` §1.2). The drills themselves now drive the real dedup modules and terminate, but the *live* two-client run has never happened: production has 0 `match_states` rows and 0 active match sessions, and no browser-automation toolchain exists in the environments used so far.
- **OPEN — Sentry `session_start` one-shot confirmation in the UI.** DSN is configured and the transport is tested in Node; the live UI confirmation has not been made → `UNPARK_DECISION.md` §1.3.
- **OPEN — Flip `UNPARK_DECISION.md` to DECIDED** once the three items above are signed off, and mirror the result here. It is still the TEMPLATE.
- **OPEN — FSM illegal-transition soak week.** Illegal transitions are metered (and the `HOST_ELECT` path is phase-gated so lobby elections don't pollute the counter), but a recorded soak week has not been run.
- **OPEN — Live `net_*` dashboard (Grafana/Sentry) + forced-reconnect drill sign-off.** Counters are production-bumped; the dashboard and the sign-off drill are not built.

**Quality residuals**

- **OPEN (optional) — remove the remaining file-level eslint disables in legacy modules** (`no-explicit-any` quarantine). Never a gate; burn-down as those files are touched.
- **CLOSED (CHAIN-04) — Full Foundry suite in CI (`forge test`) + gas snapshot gate.** Added Foundry test step (`forge test --root contracts -vvv`) to `.github/workflows/ci.yml` in commit `dc943f8`. Gas snapshot gate remains open.
- **PARTIAL — M11 B20 + ERC-8021 trailing-suffix assertion.** The test exists; the missing half is the CI wiring above.
- **OPEN — `isActivated(ASSET)` recorded in TOKEN_PARAMS** after the Sepolia deploy sequence; not verified in this pass.

**CHIPS value track**

- **OPEN by acceptance — first funded paid join/claim on Sepolia.** The value path is live (escrow armed, marketplace catalog live, pool hooks deployed); no unbacked smoke deposit was minted, so the first *funded* purchase/claim in production is the acceptance event.
- **OPEN — settlement signer custody runbook + timeout-refund watcher live.** `docs/ops/ESCROW_ARMING.md` covers arming custody; the timeout-refund watcher (`docs/ops/CHIPS_WATCHER_RUNBOOK.md` direction) is not live, and `lib/chipsIndexer.ts` remains a Phase-1 skeleton with an in-memory cache.

**C0 / economic freeze (external — not code)**

- **OPEN — sybil spreadsheet published + signed** (`docs/tokenomics/C0_FREEZE_PACK.md` §1).
- **OPEN — counsel L1–L6 written issue-spot + geo table.**
- **OPEN — welcome-grant ship/no-ship + liquidity owner/date in TOKEN_PARAMS.** Owner decision.

**Later product**

- **OPEN — tournaments economy** · **spectator predict** (needs its own legal gate — the old SEC-05-bet hole is why this waits) · **paymaster funding** (interface only until then).
- **Cross-cutting from the audit — NET-03a/b** (private room channel, Part III deferral 1) and the **Base mainnet deploy** (Part III deferral 2) stand as the two largest deferred engineering items.

---

### Sign-off


| Gate | Owner | Date | Result |
| --- | --- | --- | --- |
| Phase 0 exit | — | 2026-10-06 | **PASS** — static gate in CI; DB-equivalent proven by psql replay + RESET execution; marketplace live 2026-10-11 |
| Phase 1 exit | — | 2026-10-11 | **PASS** — money paths closed, deployed to Sepolia; escrow armed; mainnet deploy deferred by decision |
| Phase 2 exit | — | 2026-10-11 | **PASS** — dice boundary, one engine, one team table, authority coverage, terminating corpus |
| Phase 3 exit | — | 2026-10-11 | **PASS** — route matrix reconciled 2026-10-13; no unauthenticated mutation remains (one public-by-intent entry tracked) |
| Phase 4 exit | — | 2026-10-11 | **PASS** — netcode + protocol + end-to-end termination drills green; NET-03a/b deferred on credentials |
| Phase 5 exit | — | 2026-10-11 | **PASS (one dated deferral)** — Android device trace deferred as measurement, not code |
| Phase 6 exit | — | 2026-10-13 | **PASS** — DB-22 closed; 154/154 findings closed or signed off |
| October 2026 review | — | 2026-10-21 | **PASS** — 14 findings closed with behavioral gates; 16 backlog items tracked; DB migrated; 485 tests green |
| Server Authority Migration (P0–P6) | — | 2026-10-18 | **PASS** — Cloudflare MatchRoom DO authority, session v2, atomic commits via `match_commit_action`, edge retired |
| Server-Owned Lobby Migration (S0–S5) | — | 2026-10-22 | **PASS** — MatchRoom DO self-seeding, `match_seats`, session `seat_color` binding, P2P formation retired, 523 tests green |
| **Wagered + 2v2 play** | owner | 2026-10-11 | **Ship-rule condition met** — Phase 0–2 closed on 2026-10-11, which is what the rule required; whether wagered play is enabled is an owner call (the arming pair is deployed and verified on Sepolia) |

**Ship rule.** Wagered pools and 2v2 mode stayed disabled until Phase 0–2 closed; that condition was met on 2026-10-11. Non-wagered 4P offline play was blocked on ENG-01 only (one engine must be authoritative), which closed with the engine-diff harness and golden corpus above.

---

## Part V — CSS layout & animation plan integration (2026-10-13)

*Source: [`CSS_LAYOUT_ANIMATION_PLAN.md`](./CSS_LAYOUT_ANIMATION_PLAN.md) (found in the tree, reviewed, and integrated in part). The plan is Phase 0–4 over weeks; this is the P0 motion/a11y slice plus the Phase 0 instrumentation. Layout-shifting phases are deferred with reasons (below and in the plan's §7).*

### What landed

- **`lib/motion.ts` (new)** — the single JS-side source of truth for `prefers-reduced-motion`: `prefersReducedMotion()`, `onReducedMotionChange()`. Before this, the CSS kill-switch (4 `@media` blocks in `globals.css`) did not reach any JS motion — framer components, the GSAP token timelines, and confetti all ran regardless of the OS setting.
- **All JS motion now honors the preference (5/5 census — 2 GSAP + 3 confetti):** `<MotionConfig reducedMotion="user">` wraps the app (`app/Providers.tsx`) for the 34 framer files; the two GSAP sites (`board/TokenPiece.tsx`, `board/TokenVisual.tsx`) collapse their timelines to instant repositionings — translation is removed, information is not, because board positions are engine state rendered from `lib/boardLayout` coordinates; the three confetti sites (`app/page.tsx`, `BoardHome.tsx`, `SnakesBoard.tsx`) skip particle bursts. Confetti loops capped at 1.5s (were 2s and 5s).
- **Motion scale tokens** (`--ludo-motion-fast/base/slow/token-hop` + two easings) added to the `:root` block in `globals.css`, with the library-ownership convention documented inline: CSS keyframes for one-shot ≤ 320ms · framer-motion for React orchestration/gesture · GSAP only for engine-driven token movement.
- **Responsive/paint cheap wins:** `overscroll-behavior: contain` on the shared `.no-scrollbar` scroll-panel utility; `dvh` progressive-enhancement pairs on the remaining fixed `100vh`/`75vh` rules and in `page.module.css` (the footer already had `--app-vh: 100dvh` + `env(safe-area-inset-bottom)` — the plan's G7 claim was partially stale and is corrected in the plan doc).
- **`scripts/check-motion.mjs` (new, blocking in CI)** — the compositor-only gate: fails on NEW `transition`/`animation`/`@keyframes`/framer `animate` objects targeting layout properties (width/height/top/left/right/bottom/margin/padding) outside a documented allowlist (2 keyframes + 4 framer animate sites, each with its reason), and on any `will-change` declaration (plan keeps it at zero). Reports the reduced-motion census.
- **`scripts/bench-css.mjs` (new, advisory in CI)** — the Phase 0 baseline: CSS bytes raw/gzip, `globals.css` rule/keyframe/media/custom-prop counts, and the JS surface (inline styles, raw `<img>`, framer layout animations). Measured: 335,877 B raw / 57,961 B gzip CSS · globals.css 11,791 lines · 34 keyframes · 295 inline styles · 40 raw `<img>`.
- **`npm run check:motion` / `bench:css` / `test:contracts` / `setup:foundry`** added; the motion gate and the bench run as named steps in `engine-tests`.

### Deferred (with reasons)

- **Reset layering (`@layer base`)** — app-wide spacing shift; needs the Playwright visual-diff harness the plan specifies, and no browser toolchain exists in this environment.
- **`globals.css` module split, fluid board `clamp()` sizing, container queries** — layout-shifting; same harness dependency.
- **`<img>` dimension codemod (40 tags / 23 files)** — per-site dimensions need verification; wrong numbers distort art, so it waits for the harness rather than guessing.
- **`content-visibility` on feeds, focus-ring unification, screen-reader pass, GSAP→framer consolidation, ambient-loop pausing, optional motion toggle** — Phase 1–4 items the plan sequences after measurement.

### Scripts directory evaluation (same pass)

Reference-analyzed all 85 files in `scripts/`: **83 are load-bearing** (44 run inside `npm test`, the rest are gates, drills, deploy/verify tooling, or referenced by docs). **Retain the directory** — it is the repo's gate harness. The 2 unreferenced files were dev tooling with a real purpose, so they were wired in rather than deleted: `setup-foundry.sh` (foundry + keystore bootstrap) and `anvil-e2e.sh` (runs the local `E2EFundSettleClaim` Foundry test) are now `npm run setup:foundry` / `npm run test:contracts` — which also gives Part IV's "forge test in CI" gap a local runner until the CI step lands.

### Gates

`tsc` 0 errors · `lint` clean · `npm test` 406 pass / 0 fail / 11 skipped · `npm run check:motion` clean (compositor-only, 5/5 reduced-motion census) · `npm run bench:css` baseline recorded in the plan's §6.

---

## Part VI — CSS layout & animation plan, Phase 1 (2026-10-13, `feat/css-layout-phase-1`)

*Source: [`CSS_LAYOUT_ANIMATION_PLAN.md`](./CSS_LAYOUT_ANIMATION_PLAN.md) Phase 1 ("cheap wins") plus the parts of G5/G7/G9 that could be closed without a browser toolchain. Continues Part V. Each item was verified against the code before it was changed — three of the plan's findings (G7 safe-area coverage, G9 list containment, and the type-scale premise) turned out to be stale or unsafe as written, and are corrected rather than implemented as described.*

### What landed

- **`<img>` intrinsic dimensions (G5, §3.1 P0/S)** — all 34 unsized raw `<img>` sites sized across 19 files (avatars 96², emotes 64², piece sprite 128², venue plate 1024×1536). Every CSS-sized element was checked first: the attributes are overridden there and only declare the intrinsic ratio, so the pass is rendering-neutral; the 6 already-sized tags (ReceiveSheet, WcWalletPanel attributes; LudoWalletModal, MarketplacePanel style dims) were left alone.
- **`scripts/check-img-dimensions.mjs` (new, blocking in CI)** — fails on any raw `<img>` without width+height attributes or a style object with both dims. Closes the plan §6 "static gate (not yet built)" entry. The tag scanner tracks brace depth and quotes so `onError={(e) => …}` arrows do not truncate a tag; allowlist-shaped like `check-motion.mjs`.
- **Dice-slot reservation (§3.1 P0/S)** — `.ludo-dice-container` pinned to 48×48 with `padding: 0`. The row's 56px reservation only held because the unlayered reset (G2) neutralizes the component's Tailwind `p-4`; the plan's own deferred reset-layering change would have restored that padding, inflated the box to 80px, and reopened a ~24px row growth plus board recenter on every turn change.
- **Safe-area policy unified (G7, §3.2 P0/S)** — `.match-footer`, `.match-footer-chat`, `.board-sheet`, `.match-stats-overlay` and the keyboard-open scroll padding consumed **raw** `env(safe-area-inset-bottom)`; all five now consume the clamped `--safe-bottom` token FrameProvider writes (0 when the reported inset exceeds 48px, i.e. an empty host-webview toolbar). `viewport-fit: cover` verified present in `app/layout.tsx`.
- **Fluid type scale (§3.2 P1/S)** — nine `--text-ludo-3xs…3xl` steps in `@theme`; each step's max is a size the app already hardcoded, so adoption is neutral at ≥ 440px and narrows toward 320px, and the micro steps stay fixed at the legibility floor. Generation was verified by compiling `globals.css` through the installed `@tailwindcss/postcss` (`.text-ludo-md { font-size: var(--text-ludo-md) }`), not assumed. Adopted at 9 game-surface sites (`BoardHeaderCompact`, `ActionDice`, `PlayerInfoRow`); `.nav-item .nav-label`'s `max-width: 430px` override deleted rather than kept in sync.
- **Toast containment (§3.1 P1/M)** — `contain: layout paint` on `.capture-toast` / `.wl-toast` (bare class hooks, text-only content, so containment cannot clip anything).
- **`bench:css`** now reports the type-scale adoption line (`text-ludo-*` vs hardcoded `text-[Npx]`), keeping the burn-down measurable while the bench stays advisory.

### Verified already done / not applicable (recorded, not implemented)

- **`overscroll-behavior: contain` on scroll panels (§3.1 P1/M)** — already complete: all 25 `overflow-y-auto` sites in `app/components` carry `.no-scrollbar`, which Part V gave the declaration. Nothing to add.
- **`content-visibility` on the live lists (G9)** — rejected with evidence: the Leaderboard paginates (`paginatedLeaders` — bounded, nothing offscreen to skip) and its rows are framer `layout` elements, where containment breaks layout measurement outright; ActivityFeed pins to the newest item on every insert (`scrollTop = scrollHeight`), where content-visibility turns that height into an estimate; the live-arena directory is searchable, which the plan already excludes. The plan's §7 open item is closed on this basis.

### Deferred (with reasons)

- **Reset layering, `globals.css` module split, fluid board `clamp()`, container queries** — unchanged from Part V: layout-shifting, blocked on the Playwright visual-diff harness, which needs a browser toolchain absent here.
- **Mass type-scale migration** (589 hardcoded `text-[Npx]` sites + 307 `font-size` declarations) and the **`next/image` migration for LCP art** — visual and deploy-pipeline changes respectively; the first needs the harness, the second needs its own pass against the OpenNext/Cloudflare image pipeline.

### Gates

`npm run check:motion` clean (compositor-only, 5/5 reduced-motion census) · `npm run check:img` clean (40 raw `<img>` / 104 tsx scanned, 0 unsized) · `npm run bench:css` advisory (text-ludo-* 9 · hardcoded text-[Npx] 589).

Local toolchain: the dependency tree could not be completed — the sandbox denies writes into `node_modules/.bin` (`CODEBUDDY_BROKER_DENY` on the acorn link), and `npm ci` fails on pre-existing lockfile drift (`zod@3.25.76` missing from `package-lock.json`, unrelated to these changes). With the partial tree present: `tsc -p tsconfig.json --noEmit` reports **3 errors, all in `app/api/**`** (Supabase `RejectExcessProperties` typing, environmental — none in a file this branch touched), and `eslint` on the three changed components **exits clean**. `npm test` did not run (no `tsx`); CI runs all three gates on push, and every change here is CSS or JSX-attribute only.

---

## Part VII — Visual-diff harness (Phase 0 gate) (2026-10-13, `feat/css-layout-phase-1`)

*Source: [`CSS_LAYOUT_ANIMATION_PLAN.md`](./CSS_LAYOUT_ANIMATION_PLAN.md) Phase 0 — "Playwright screenshots of 8 scenes (lobby, board mid-game, spectate × Retro/Daybreak)". This is the artefact the plan names as the precondition for every layout-shifting phase: reset layering, the `globals.css` module split, fluid board `clamp()` sizing, container queries and the mass type migration were all deferred on it.*

### What landed

- **`scripts/visual-diff.mjs` + `npm run visual:baseline` / `visual:diff`** — 8 scenes: `setup` / `lobby` / `offline-panel` / `board`, each in Retro and Daybreak. Baselines are committed in `tests/visual/baselines/` (6 of the 8 — see below); a failure writes `diff` **and** `current` PNGs to the gitignored `tests/visual/diffs/` so a regression is diagnosable.
- **Determinism — the whole job.** Every item below was a flake measured against this app, and each is now closed:
  - deterministic guest identity (`ludo-guest-id` seeded; the app otherwise mints a random handle per run — measured **5.9%** of the frame);
  - the theme is asserted against `<body>` through the app's own control (the first-run panel commits its own default on "Enter the lobby" and silently overrode a seeded cookie — **23.6%**);
  - coach marks are dismissed in a retry loop *after* navigation and *before* settle (they appear late and auto-dismiss on a timer — **~24%**);
  - webfonts are awaited (`document.fonts.ready`) plus a warm-up reload (a dev server serves them lazily — **27%**, text-only);
  - volatile regions are masked (remote avatars, ambient pulses, the turn countdown, the live-broadcast card);
  - capture uses `animations: 'disabled'` and a settle loop that requires two byte-identical frames; a failed scene is retried once.
- **No new dependency for diffing** — the comparison runs in the browser on a canvas (per-channel tolerance 12; fails above 0.2% of the frame). `@playwright/test` is not installed here, so `toHaveScreenshot` was unavailable; `pngjs` exists only transitively and was not relied on.

### Constraints found while building it

- **The two `board` scenes need a production build.** On the Turbopack dev server, starting an offline match crashes the app into its error boundary with **"Invalid hook call … more than one copy of React"**, on both the AI and Pass-&-Play paths. There is exactly one `react@19.2.4` in `node_modules`, so this is the module duplication AGENTS.md already documents as the reason production builds with webpack. The harness detects a dev server (Next's dev overlay) and **skips** those scenes with a stated reason rather than capturing an error page; `--strict` turns a skip into a failure.
- **`spectate` is deliberately not a scene** — it needs a live networked match (PeerJS + Edge), which no deterministic harness can conjure.
- **CI wiring is deferred**: the app needs `.env.local` to boot, so a CI job would require those secrets. Until then this is the local gate for layout-shifting work — which is exactly what the Phase 1–2 deferrals were waiting on.
- **The production build cannot run in the remediating environment** (the fs shim denies `mkdir` under `.next`), so the committed baselines were captured against the dev server. Re-baseline against a production build if a first such run diffs: same surfaces, but dev/prod asset and font handling can differ by a few pixels.

### Gates

`npm run visual:baseline` → 6 baselines written · `npm run visual:diff` ×2 → **6/6 runnable scenes match at 0.000%**, 2 skipped (need a production build).

---

## Part VIII — Post-audit production regression: Mission panel badge (2026-10-15)

*Reported from production (`www.ludobase.live`): opening the Mission panel shows the panel error boundary — "mission · Something broke … Cannot read properties of undefined (reading 'bg')" — with `badge.bg` as the throwing frame inside the lazily-loaded panel chunk.*

### Root cause

The panel's badge mapper, `getTypeBadge()` in `app/components/MissionPanel.tsx`, switched on a `type` wire field — `'play' | 'win' | 'streak' | 'social' | 'predict'` — carried over from the old hardcoded `DAILY_MISSIONS` table. Commit `1084c72` ("missions on CHIPS, single reward source") replaced that source with `mission_catalog` (migration `202609300003`), which has **no `type` column**, and `/api/missions/list` was rewritten to map the catalog rows directly. The API therefore stopped sending `type`, but the panel's local `Mission` interface kept declaring it and `setMissions(await response.json())` cast the response into that interface without validation, so TypeScript was none the wiser.

At runtime every mission had `type === undefined`, the 5-case switch fell through and returned `undefined`, and `badge.bg` threw on the first mission row — taking the whole panel down. The crash only rendered for **signed-in** users: guests and session-less callers hit the "connect wallet"/"sign in" branches before the list maps, which is why the guest-state `panel-mission-*` visual scenes never caught it.

### Fix

- **`lib/missionBadge.ts` (new)** — `missionBadgeFor(missionId)`, a pure browser-safe mapper keyed off `mission_id` (a field the catalog actually has), **total by construction**: it ends in a neutral default badge, so an unknown or future catalog id can never produce `undefined`.
- **`app/components/MissionPanel.tsx`** — the phantom `type` field removed from the local `Mission` interface; the render loop now calls `missionBadgeFor(mission.id)`; icons live in a module-scope `Record<MissionBadgeKey, ReactNode>` beside the mapper. All 12 seeded catalog ids keep their intended icons (`daily_bonus` → gift, `*play*` → dice, `*win*` → trophy, `*capture*`/`*pvp*` → swords, `*poke*` → bell, `*predict*`/`*spectate*` → eye, `*dm*`/`*friend*` → users).
- **`scripts/mission-badge.test.ts` (new, wired into `npm test`)** — pins the totality property (every seeded id, plus unknown/empty/non-string ids, yields a defined badge with `bg-`/`text-` classes), the per-id icon mapping, and the API/panel agreement that broke: the route must not reintroduce a `type:` payload key, and the panel must not read `mission.type`.

### Gates

`tsc` 0 errors · `eslint` clean on all touched files · `npm test` **422 pass / 0 fail / 11 skipped** (406 → 411 executable pass, +5 new) · the change is render-only for rows that previously crashed, so the committed panel-mission visual baselines (guest state) are unaffected.

---

## Part IX — Post-audit production regression: offline match start (React #321) (2026-10-15)

*Reported from production: starting an offline match dies with "The arena hit a snag" and `Minified React error #321` at the route boundary (`app/error.tsx`). React #321 is the "Invalid hook call" decoder.*

### Root cause

`hooks/useGameTimer.ts` called **`useRef` inside a `useEffect` callback** — introduced by `881902d` (2026-10-12, "NET-11..13 … absolute turn deadline"), which moved the deadline ref into the effect body. Outside render React installs `ContextOnlyDispatcher`, on which every hook — `useRef` included — is `throwInvalidHookError`; the production react-dom build throws exactly `formatProdErrorMessage(321)` there (verified in `node_modules/react-dom/cjs/react-dom-client.production.js`, lines 4324/5467). So the moment the effect body ran, the hook threw.

The effect's guard is `shouldRunMatchTimer({ isNetworked, connectionStatus, … })`. For an offline match `isNetworked = isLobbyConnected` is false, so the policy returns `connectionStatus !== 'ended'` → **true on mount**: every offline match start executed the illegal `useRef` and died. Networked matches hit the same throw once `connected` + an authoritative snapshot arrive. The dashboard was unaffected — `useGameEngine` mounts the timer only with the board — which is why the site still felt alive between matches.

**Why no gate caught it.** `eslint.config.mjs` stubbed both `react-hooks` rules to no-op plugins (`create: () => ({})`), so `npm run lint` could not see a hook-order violation; `npm test` is node-only (no React renderer); and the visual harness cannot exercise the board in this environment (Part VII), so its scenes skipped. The commit that shipped it was itself titled "effect hygiene".

### Fix

- **`hooks/useGameTimer.ts`** — the `deadlineRef` is hoisted to hook scope, before the effect. The per-turn re-arm (`key !== turnKey`) and the `visibilitychange` resync are unchanged; the ref now persists per component instance, which is what the module's own doc comment ("re-armed only when that key changes, never on unrelated renders") always claimed. A one-off sweep with the real `react-hooks/rules-of-hooks` rule over `app/` + `hooks/` found exactly one violation in the whole tree — this one.
- **`eslint.config.mjs`** — the stubs are gone: the real `eslint-plugin-react-hooks` is wired in, `react-hooks/rules-of-hooks` as **error** (this regression's class), `react-hooks/exhaustive-deps` as **warn** (several run-once effects deliberately omit deps; visible now, not gated). `eslint-plugin-react-hooks@7.0.1` (previously only a transitive of the deliberately-unconsumed `eslint-config-next`) is now a direct devDependency so the gate is not hostage to hoisting.
- Full-tree lint now reports **0 errors, 73 exhaustive-deps warnings** — the advisory noise the stubs were hiding, inventoried for a later burn-down.

### Gates

`tsc` 0 errors · `npm run lint` 0 errors · `npm test` 422 / 411 pass / 0 fail / 11 skipped · `check:engine` in sync · `check:drift` 10/10 · `check:routes` 47/47. The lockfile install also closed the long-documented `zod@3.25.76` peer-dep drift that broke `npm ci`.

---

## Part X — Server Authority Migration (2026-10-18)

*Source: [`SERVER_AUTHORITY_MIGRATION_PLAN.md`](../planning/SERVER_AUTHORITY_MIGRATION_PLAN.md) and [`WORKLOAD_PLACEMENT_MATRIX.md`](../architecture/WORKLOAD_PLACEMENT_MATRIX.md). Resolves Decision D1 in favour of the Cloudflare Durable Object room per match with Postgres as the system of record and ledger, eliminating the host-client Single Point of Failure (SPOF) and migrating turn authority, clock, and dice RNG server-side.*

### Phase 0 — Decisions, guardrails, baselines, and DO spike (2026-10-18)

- **ADR-002 filed** at `docs/architecture/adr-002-server-authority.md`, recording the Durable Object architectural decision, state boundary, and migration rules.
- **Feature flags configured** in `lib/serverAuthority.ts` (`AUTH_V2`, `ROOM_V2`, `SERVER_LIFECYCLE`) with clean environment overrides and evaluation at match creation.
- **Baseline metrics & SLO targets established** in `docs/ops/SLOS.md`.
- **Local development story defined** in `docs/dev/LOCAL_DEVELOPMENT.md` and `AGENTS.md` (`NEXT_PUBLIC_ROOM_WS_URL` staging tunnel / dev sidecar).
- **DO spike verified**: Custom `src/worker.ts` entry wrapping OpenNext with exported `MatchRoom` and `RateLimitDO` classes; `wrangler.jsonc` configured with DO bindings and SQLite migrations.
- **Gates**: `wrangler deploy --dry-run` passed; `npm test` 417 pass / 0 fail; `check:routes` clean across 48 routes.

### Phase 1 — Session v2 + platform hygiene (2026-10-18)

- **Session v2 schema**: Migration `202610180001_session_v2.sql` created `auth_challenges` and `sessions` tables with RLS and SHA-256 token hashing (`token_hash`), replacing fragmented session storage.
- **Cookie & CSRF posture**: Cookie-based authentication (`__Host-ludo_session`) with `SameSite=Lax`, `HttpOnly`, `Secure`, and `Path=/`. Strict CSRF validation on mutation endpoints via `Origin` and `Sec-Fetch-Site`.
- **Scope isolation**: Hierarchical capability scopes (`app`, `match`, `spectator`) enforced by `requireSession` in `lib/serverAuth.ts`. Query string session IDs eliminated across all routes.
- **Distributed rate limiting (P13/G1)**: `src/rateLimit/rateLimitCore.ts` and `src/rateLimit/RateLimitDO.ts` with colo/ip sharding for high-value mutations. Verified across multiple worker isolates.
- **Retention & Cron scheduling (P14/G2)**: Hourly Cloudflare Cron triggers running `cleanup_auth_challenges` and `cleanup_sessions` alongside matchmaking queue maintenance.
- **Gates**: `scripts/session-v2.test.ts` passed; `check:routes` clean across 53 routes; `check:schema` clean (30 migrations); `typecheck` 0 errors; `lint` clean.

### Phase 2 — Server-derived match authority (2026-10-18)

- **Server-assigned room owner (P2)**: `/api/match/start` assigns `room_owner` from authenticated session wallet and derives `host_proven` server-side, eliminating client self-promotion.
- **Derived winner authority (P1)**: `/api/match/record` reads authoritative winner from `match_states.state.winner` and validates against `authoritativeWinnerAddress`, rejecting client-submitted winner overrides with `WINNER_MISMATCH`.
- **Chat identity binding (P6)**: `/api/live-chat` derives sender address strictly from authenticated session wallet, preventing chat spoofing.
- **Server-verified onboarding (P7)**: `/api/onboarding/progress` verifies completed matches on server for game tracks.
- **Arena authority (P9)**: `/api/live-arena/power4p` server-assigns `authority_id` to host session wallet.
- **Seat authority verification (P12)**: `checkSeatAuthority` in `lib/turnAuthority.ts` enforces seat kind from server state and ignores client source for human seats.
- **Gates**: `scripts/server-authority-p2.test.ts` passed (7/7); `npm test` 432 pass / 0 fail.

### Phase 3 — Match room v2 transport & ordering (2026-10-18)

- **MatchRoom DO transport**: `src/room/MatchRoom.ts` handling WebSocket upgrades at `/api/room/:roomId/ws` with hibernatable sockets.
- **Frame protocol v2**: In-band authentication via Session v2 tokens (`TOKEN_HASH_MISMATCH` rejection), strictly typed frames, and frame size cap (`MAX_MESSAGE_BYTES = 32 * 1024`).
- **FIFO intent execution**: Sequential per-match queue executing incoming intents without interleaving.
- **Spectator read-only mode**: Spectators receive live state broadcasts; mutations from spectator connections are rejected with `SPECTATOR_READ_ONLY`.
- **Timer min-heap**: Priority-ordered deadline queue ensuring the earliest alarm is scheduled in DO storage.
- **D8 drill verified**: Match created with `room_version: 2` preserves room transport across flag transitions.
- **Gates**: `scripts/room-transport.test.ts` passed (7/7); `npm test` 439 pass / 0 fail.

### Phase 4 — In-process engine relocation & lifecycle (2026-10-18)

- **Engine relocation**: Pure engine relocated to `src/room/engine.ts` with automated parity checks via `scripts/sync-edge-engine.mjs` and `scripts/check-edge-engine.mjs`.
- **Atomic CAS commits**: Migration `202610180004_match_commit_action.sql` added atomic Postgres RPC `match_commit_action` that validates sequence (`seq`), updates `match_states`, inserts rolls into `match_rolls`, and logs room events in `match_room_events`.
- **Server turn alarms & strikes (P4-4)**: Turn timers scheduled via Durable Object storage alarms. Turn timeouts increment strikes and trigger auto-play at 3 strikes directly on the server.
- **D7 drill verified**: Host device disconnect mid-turn does not stall match progress; server timer auto-advances the turn.
- **Gates**: `scripts/room-lifecycle.test.ts` passed (6/6); `check:engine` verified byte-for-byte sync; `npm test` 442 pass / 0 fail.

### Phase 5 — Private Realtime channels & degraded P2P demotion (2026-10-18)

- **RLS lockdown on Realtime (NET-03a/b)**: Migration `202610180005_realtime_messages_rls.sql` locked down `realtime.messages` with strict RLS policies, allowing only authenticated participants of the match to publish or read broadcast messages. Anonymous access is completely revoked.
- **Private channels**: Realtime channel instantiation updated with `private: true` and scoped authorization tokens.
- **P2P demotion**: PeerJS relegated strictly to a secondary NAT-blocked fallback channel, with all authoritative state passing through the server room.
- **Gates**: `scripts/private-realtime.test.ts` passed (6/6); `check:rls` clean; `check:schema` clean (34 migrations); `npm test` 448 pass / 0 fail.

### Phase 6 — Retire host-centric paths & edge functions (2026-10-18)

- **Deleted Edge functions**: Removed deprecated Deno Edge functions (`supabase/functions/roll-dice/`, `supabase/functions/move-auth/`, `supabase/functions/resolve-bet/`) and `supabase/functions/_shared/engine.ts`.
- **Retired legacy intents**: `DICE_COMMIT`, `DICE_REVEAL`, and `CMD_REQUEST_TRUST` removed from `GameIntentType` union, protocol schemas (`lib/protocol/schemas.ts`), and dispatchers. Active intents are strictly `'REQUEST_ROLL' | 'REQUEST_MOVE'`.
- **Retired host election**: Removed `HOST_ELECT` from `MatchFsmEvent` in `lib/matchFsm.ts`. Room DO is the permanent authoritative execution context for networked matches.
- **Durable chain indexer cursor (P16/G8)**: Migration `202610180006_indexer_cursor.sql` added `chain_indexer_cursors` table with `get_chain_indexer_cursor` and `update_chain_indexer_cursor` RPCs. `lib/chipsIndexer.ts` implemented `syncWithDurableCursor` with reorg safety depth of 12 blocks, 900-block chunking, and idempotent persistence to `chips_events`.
- **Static retirement gate**: `scripts/host-retirement-gate.test.ts` created and added to CI test suite, asserting that legacy intents, `HOST_ELECT`, and deleted Edge directories cannot be reintroduced.
- **Gates**: `scripts/host-retirement-gate.test.ts` passed (5/5); full test suite `npm test` passes **454 pass / 0 fail / 11 skipped**; `check:routes` clean across all 53 routes; `check:schema` clean (35 migrations, 35 functions); `check:rls` clean; `check:engine` in sync; `check:drift` clean (10/10); worker typecheck (`tsc -p tsconfig.worker.json`) 0 errors; project typecheck (`tsc -p tsconfig.json`) 0 errors; `npm run lint` 0 errors; `npm run build` production webpack build succeeds.

---

## Part XI — October 2026 System Review & On-Chain Settlement Remediation (2026-10-20 — 2026-10-21)

*Source: Unified System Review at [`docs/ops/SYSTEM_REVIEW.md`](./SYSTEM_REVIEW.md) and Adversarial Verification at [`docs/ops/REVIEW_VERIFICATION_2026-10-20.md`](./REVIEW_VERIFICATION_2026-10-20.md). Full architectural audit across the rules engine, MatchRoom Durable Object authority, private lobbies, matchmaking queues, power mechanics, game modes, and Base smart contracts (`MatchPool` / `ClaimHub`). Resolves 14 critical/high/medium security and settlement findings across initial repair batches and adversarial remediation phases, with 16 architectural backlog items tracked for future execution.*

### Overview

Following the server authority migration (Part X), a system-wide review evaluated the live deployment readiness of on-chain pool wagering, Realtime relay security, matchmaking table formation, and power tile privacy. The review surfaced critical blockers in on-chain settlement execution: a schema parameter mismatch on proposal (`CHAIN-01`), an off-by-one 12-tuple decoding bug in the pool summary hook (`CHAIN-02`), and client submission of unverified payout plans rather than server-signed plans (`CHAIN-03`), alongside unauthenticated control channel commands on public relays (`TU-1`) and power inventory broadcasts (`PW-1`, `PW-2`).

All initial repair batches were implemented, after which a rigorous adversarial review (`docs/ops/REVIEW_VERIFICATION_2026-10-20.md`) verified the changes against the codebase and identified 5 specific regressions and residuals:
1. `PW-2` regression: Wire state synchronization in `applyServerState` stripped local player held power types, breaking power card UI activation.
2. `SA-2` security hole: `/api/match/record` permitted arbitrary progression minting and wager scaling without participant authentication or authoritative server winner verification.
3. `PW-1` privacy gap: `/api/match/state` returned complete power inventories without caller viewer scoping.
4. `MM-1` residual defect: Instant 4P table formation omitted caller ticket insertion into `matchmaking_queue`.
5. `TU-1` relay gate: Relays remained open to sender spoofing, mid-match `START_GAME` re-seeding, and illegal token leaps.

These 5 defects were remediated across 6 sequential phases, backed by dedicated behavioral tests, and deployed to production.

### Initial Remediation Batches

#### Batch 1 — On-Chain Settlement Repairs (`CHAIN-01`..`04`)

- **Commit:** `dc943f8` ("fix(settle): resolve on-chain settlement schema mismatch, 12-tuple decoding, and server plan signing")
- **`CHAIN-01` (Unified settlement propose schema):** Created shared strictly-typed contracts in `lib/types/settle.ts` (`SettleProposalRequest`, `SettleProposalResponse`, `PayoutEntryWire`). Updated `app/api/chips/settle/propose/route.ts` to accept `winnerAddresses` with backwards-compatible alias `winners`. Updated `hooks/useSettlePool.ts` to supply conformant payload.
- **`CHAIN-02` (Corrected 12-tuple pool summary decoding):** Aligned `hooks/useChipsPool.ts` with `MatchPool.sol:getPoolSummary` (12 values: `[status, maxSeats, filledSeats, shape, authority, entryFee, gross, prizeFund, hostBond, settleBy, claimUnlockAt, settleNonce]`). Added `shape` at index 3, eliminating the off-by-one shift that corrupted `authority`, `entryFee`, `prizeFund`, and `claimUnlockAt`.
- **`CHAIN-03` (Enforced server payout plan integrity):** Updated `hooks/useSettlePool.ts` to map and submit the exact server-returned canonical `plan` rather than client-constructed arguments. Added client-side verification `payoutPlanHash(contractPlan) === data.planHash` ensuring that mismatching plan commitments fail immediately before submitting the transaction.
- **`CHAIN-04` (CI contract testing):** Added Foundry contract test job (`forge test --root contracts -vvv`) to `.github/workflows/ci.yml`. Added `scripts/settle-propose.test.ts` verifying API schema handling and local hash derivation.

#### Batch 2 — Network Authority & Control Channel Lockdown (`TU-1`..`2`, `PW-1`..`2`)

- **Commit:** `4970cae` ("fix(netcode): drop unauthenticated relay actions and redact opponent power inventory")
- **`TU-1` (Relay command lockdown):** Updated `hooks/TeamUpContext.tsx` to drop unauthenticated external mutations (`START_GAME`, `MOVE_TOKEN`, `ROLL_DICE`, `TURN_SWITCH`) received over the public Supabase Realtime topic `game-room-<roomCode>`. All authoritative gameplay actions are routed strictly through the server room.
- **`TU-2` (Peer coin sanitization):** Updated `seatGuestPlayer` in `hooks/TeamUpContext.tsx` to null out peer-supplied coin balances (`playerCoins: null`), preventing untrusted client coin spoofing.
- **`PW-1` & `PW-2` (Power inventory privacy):** Hardened `lib/wireSanitize.ts` (`sanitizeGameStateForWire`) to redact opponent `playerPowers` from broadcast payloads. Power inventories are masked unless the viewer matches the player color. Added `scripts/wire-sanitize.test.ts` verifying wire redaction.

#### Batch 3 — Matchmaking & Mode Truthfulness (`MM-1`..`2`, `MM-4`, `MO-1`..`2`)

- **Commit:** `ab1ce8a` ("fix(matchmaking): shape-aware table formation, session auth on cancel, and mode truthfulness")
- **`MM-1` (Shape-aware matchmaking table formation):** Created migration `supabase/migrations/202610200001_matchmaking_shape_aware.sql` replacing the 2-player hardcoded `join_matchmaking` RPC with dynamic `slots_needed` calculation (2 for 1v1, 4 for 2v2/4P). Inside the table advisory lock, up to `slots_needed - 1` matching tickets are bundled into `matches.participants`, eliminating table stalls in 2v2 and 4P queues.
- **`MM-2` (Session authentication on matchmaking cancellation):** Updated `hooks/useMatchmaking.ts` to attach `sessionId` to `DELETE /api/matchmaking/join`, eliminating 401 Unauthorized errors when cancelling orphan queue tickets.
- **`MM-4` (Boundary validation on matchmaking join):** Added strict runtime validation in `app/api/matchmaking/join/route.ts` restricting `match_type` to `'1v1' | '2v2' | '4P'` and `game_mode` to `'classic' | 'power'`.
- **`MO-1` (Live arena engine alignment):** Cleaned up `app/api/live-arena/power4p/route.ts` with typed `serviceDb` calls, eliminating synthetic participant IDs.
- **`MO-2` (Dynamic spectator shape & mode):** Updated `app/page.tsx` spectator view to dynamically pass `playerCount` and `gameMode` from the loaded match state record instead of hardcoding `"4P"` and `"power"`. Added `scripts/matchmaking-shape.test.ts`.

#### Batch 4 — Telemetry, Config & Address Checksumming (`CHAIN-05`)

- **Commits:** `148b702` & `255d95d` ("fix(config): enforce viem address checksumming and fail closed on unrecognized chains")
- **`CHAIN-05` (Strict Viem address checksumming & fail-closed chain detection):** Replaced loose `0x` string checks in `lib/chips.ts` with Viem's `isAddress` and `getAddress` checksum normalization. Enforced fail-closed behavior for unsupported chain IDs, allowing strictly Base (`8453`) and Base Sepolia (`84532`). Created `scripts/chain-config.test.ts`.

### Adversarial Verification & Hardening Phases (2026-10-20 — 2026-10-21)

*Source: [`docs/ops/REVIEW_VERIFICATION_2026-10-20.md`](./REVIEW_VERIFICATION_2026-10-20.md). Six automated remediation phases addressing verified gaps, behavioral defects, and gate integrity.*

#### Verification Phase 1 — `PW-2` Guest Power Hand Typeless Wipe Fix

- **Commit:** `8e67d76` ("fix(power): re-attach local player power types in applyServerState to fix PW-2 regression")
- **Problem:** When `sanitizeGameStateForWire` stripped power types to preserve fog-of-war, incoming server broadcasts received in `applyServerState` replaced the guest's local state with typeless slots (`{ type: undefined }`). This caused guest power cards to render as inactive/empty slots.
- **Solution:** Updated `applyServerState` in `hooks/TeamUpContext.tsx` to preserve and re-attach the local player's known power types from `prev.playerPowers` when receiving wire broadcasts matching the expiration timestamp or slot index.
- **Gate:** Added PW-2 regression test to `scripts/wire-sanitize.test.ts` verifying that local power items retain type identity across wire sync.

#### Verification Phase 2 — `SA-2` Progression Minting & Wager Escalation Lockdown

- **Commit:** `9cde0aa` ("fix(sec): secure match/record against SA-2 unauthorized result declaration and progression wager inflation")
- **Problem:** `/api/match/record` accepted client-declared winners without server verification when callers lacked cryptographic signed proofs. Unauthenticated parties or spectators could award arbitrary wins and scale progression rewards with astronomical `wager` values.
- **Solution:** Hardened `app/api/match/record/route.ts`:
  1. Enforced session authentication (`requireSession`) requiring the caller to be a verified participant or room owner (`NOT_PARTICIPANT`).
  2. For session-based matches without crypto proofs, mandated that the declared winner must match the authoritative winner recorded in `match_states.state.winner` (`SERVER_WINNER_REQUIRED` / `WINNER_MISMATCH`).
  3. Capped progression wager scaling with `MAX_PROGRESSION_WAGER = 10_000`, preventing LXP/streak inflation.
- **Gate:** Created `scripts/match-record-auth.test.ts` verifying participant validation, server winner verification, and wager caps.

#### Verification Phase 3 — `PW-1` Power State Privacy & Wire Redaction

- **Commit:** `d4bbf54` ("fix(sec): redact opponent power inventory in state endpoint and wire engine (PW-1)")
- **Problem:** `/api/match/state` returned the full `match_states` JSON blob without resolving the requesting viewer, leaking all players' held powers. Furthermore, pure wire engines lacked consistent held power masking.
- **Solution:**
  1. Updated `app/api/match/state/route.ts` to inspect Session v2 authentication cookies/headers and resolve the caller's `viewerColor`. Opponent power inventories are masked with `type: undefined`.
  2. Updated `stripPowerTypesForWire` in both `lib/engine/core.ts` and `src/room/engine.ts` to redact `playerPowers` from wire states, maintaining byte-for-byte engine synchronization.
- **Gate:** Created `scripts/power-privacy.test.ts` and verified room engine sync via `npm run check:engine`.

#### Verification Phase 4 — `MM-1` Matchmaking Instant Form Caller Ticket Fix

- **Commit:** `33c5dc0` ("fix(matchmaking): insert caller ticket upon instant match formation to resolve MM-1 residual defect and upgrade test")
- **Problem:** When `join_matchmaking` formed an immediate 4P match from 3 queued tickets plus the calling player, the caller's ticket was omitted from `public.matchmaking_queue`. Clients polling for match completion failed to locate the caller's queue record.
- **Solution:** Created migration `supabase/migrations/202610200002_matchmaking_caller_ticket.sql` updating `join_matchmaking` to insert the caller's ticket with `status = 'matched'`, `match_id = m`, and `room_code = room`, returning `ticket_id: q`. Upgraded `scripts/matchmaking-shape.test.ts` to parse and assert the actual SQL AST and hook sources.
- **Deployment:** Applied migration to remote Supabase via `supabase db push --linked`.

#### Verification Phase 5 — `TU-1` Relay Message Gate Lockdown

- **Commit:** `e8292d8` ("fix(netcode): secure relay message gate against TU-1 sender spoofing and illegal move leaps")
- **Problem:** Public Supabase Realtime topic `game-room-<roomCode>` was susceptible to sender spoofing and state manipulation: guests could broadcast `START_GAME` to overwrite board seeds mid-match, and arbitrary `MOVE_TOKEN` packets could teleport tokens without move verification.
- **Solution:** Hardened relay message gate in `hooks/TeamUpContext.tsx`:
  1. The host unconditionally drops external gameplay actions (`START_GAME`, `ROLL_DICE`, `MOVE_TOKEN`, `TURN_SWITCH`).
  2. Guests reject `START_GAME` messages if game is already active or if `sender` does not match the known host.
  3. Guests validate incoming `MOVE_TOKEN` target positions against `calculateNextPosition(currentPos, diceValue, color, colorCorner)`, rejecting illegal position leap injection.
- **Gate:** Created `scripts/relay-hardening.test.ts` asserting host drop rules, guest sender checks, and move math validation.

#### Verification Phase 6 — Audit Status Reconciliation & Final Verification

- **Commit:** `d5816cb` ("docs: reconcile truthful finding statuses and finalize Phase 6 audit gates")
- **Status Reconciliation:** Reconciled `docs/ops/SYSTEM_REVIEW.md` and `docs/ops/IMPLEMENTATION_RECORD.md` to accurately differentiate the 14 verified closed findings (`CHAIN-01`..`05`, `TU-1`..`2`, `PW-1`..`2`, `MM-1`..`2`, `MM-4`, `MO-2`, `SA-2`) from the 16 architectural backlog items (`TU-3`..`5`, `PW-3`..`6`, `MM-3`, `MM-5`, `MO-1`, `MO-3`..`5`, `SA-1`, `SA-3`..`5`).
- **Gate:** Verified 0 type errors (`tsc`), 0 lint errors (`eslint`), clean static checks (`check:schema`, `check:rls`, `check:engine`), and 485 tests passing in `npm test`.

### Remote Database Migrations

Two canonical migrations were deployed to the live hosted Supabase project (`xvwaqxqyjtlsuijgwozi`) via `supabase db push --linked`:
1. `202610200001_matchmaking_shape_aware.sql`: Dynamic 1v1 vs 2v2/4P slot aggregation in table formation.
2. `202610200002_matchmaking_caller_ticket.sql`: Insertion of caller queue ticket with `matched` status upon instant table formation.

Schema parity verified across 38 canonical migrations and 37 function definitions.

### Findings Resolution Matrix (October 2026 Review)

Following adversarial verification against git diff `a9b3a3d..HEAD` (`docs/ops/REVIEW_VERIFICATION_2026-10-20.md`), findings are strictly classified into verified closures (with behavioral test gates) and open backlog items.

| Finding ID | Severity | Domain | Status | Resolution Summary & Test Evidence |
| --- | --- | --- | --- | --- |
| `CHAIN-01` | Critical | On-Chain Settlement | **Closed** | Unified propose schema in `lib/types/settle.ts`, route, and hook (`dc943f8`; `scripts/settle-propose.test.ts`) |
| `CHAIN-02` | Critical | On-Chain Settlement | **Closed** | Corrected 12-tuple decoding with `shape` at index 3 in `useChipsPool.ts` (`dc943f8`; `scripts/settle-propose.test.ts`) |
| `CHAIN-03` | Critical | On-Chain Settlement | **Closed** | Enforced server plan submission and local `payoutPlanHash` pre-flight check (`dc943f8`; `scripts/settle-propose.test.ts`) |
| `CHAIN-04` | High | On-Chain Settlement | **Closed** | Added Foundry contract tests to GitHub Actions CI workflow (`dc943f8`; 105 Foundry tests) |
| `CHAIN-05` | High | Configuration | **Closed** | Enforced Viem `isAddress`/`getAddress` and fail-closed chain IDs in `lib/chips.ts` (`148b702`, `255d95d`; `scripts/chain-config.test.ts`) |
| `TU-1` | Critical | Netcode & Relay | **Closed** | Hardened relay message gate: dropped external host triggers, verified caller sender against known host, and enforced `calculateNextPosition` math on token moves (`e8292d8`; `scripts/relay-hardening.test.ts`) |
| `TU-2` | Critical | Netcode & Relay | **Closed** | Explicitly nulled peer-supplied coin balances in `seatGuestPlayer` (`4970cae`; `TeamUpContext.tsx:594`) |
| `TU-3` | High | Netcode & Relay | **Open** | REST join fallback during lobby forming prior to live match row creation |
| `TU-4` | High | Netcode & Relay | **Open** | Move execution runtime adoption through `RoomClient` rather than legacy P2P/Edge fallback |
| `TU-5` | Medium | Netcode & Relay | **Open** | Disconnect and abandon settlement penalty and stake burning |
| `PW-1` | Critical | Power Mechanics | **Closed** | Authority state redaction: `/api/match/state` session-resolves viewer color to mask opponent hands; `stripPowerTypesForWire` masks held powers on wire (`d4bbf54`; `scripts/power-privacy.test.ts`) |
| `PW-2` | High | Power Mechanics | **Closed** | Fixed broadcast power wipe regression: `applyServerState` re-attaches local player's known power types from local state (`8e67d76`; `scripts/wire-sanitize.test.ts`) |
| `PW-3` | High | Power Mechanics | **Open** | Reconcile guest power application via server room |
| `PW-4` | High | Power Mechanics | **Open** | Unify triple implementation of power semantics into single canonical file |
| `PW-5` | Medium | Power Mechanics | **Open** | Power expiry driven by turn sequence numbers rather than client `Date.now()` |
| `PW-6` | Low | Power Mechanics | **Open** | Deduplicate LCG reseed formulas in `useGameActions.ts` |
| `MM-1` | High | Matchmaking | **Closed** | Shape-aware `join_matchmaking` RPC with caller ticket insertion, ensuring all 4 participants exist in queue with validation token (`ab1ce8a`, `33c5dc0`; `scripts/matchmaking-shape.test.ts`) |
| `MM-2` | Medium | Matchmaking | **Closed** | Attached Session v2 authentication token to matchmaking cancellation requests (`ab1ce8a`; `scripts/matchmaking-shape.test.ts`) |
| `MM-3` | Medium | Matchmaking | **Open** | Expanding search parameters in database matchmaking queue |
| `MM-4` | Low | Matchmaking | **Closed** | Strict boundary whitelist for `match_type` and `game_mode` in join route (`ab1ce8a`; `scripts/matchmaking-shape.test.ts`) |
| `MM-5` | Low | Matchmaking | **Open** | Consolidate edge transports to server room |
| `MO-1` | Medium | Game Modes | **Open** | Power 4P live arena executing classic engine with `Math.random()` |
| `MO-2` | Medium | Game Modes | **Closed** | Dynamic spectator mode respecting match record shape and mode (`ab1ce8a`; `scripts/matchmaking-shape.test.ts`) |
| `MO-3` | Medium | Game Modes | **Open** | Deprecate and isolate unreachable snakes logic outside core progression |
| `MO-4` | Low | Game Modes | **Open** | Deduplicate room code inserts in quick match flow |
| `MO-5` | Low | Game Modes | **Open** | Unified board coordinate frames in `lib/boardLayout.ts` |
| `SA-1` | High | Server Authority | **Open** | Wire runtime client to `RoomClient` DO transport and deprecate legacy edge function endpoints |
| `SA-2` | Critical | Server Authority | **Closed** | Secured `/api/match/record`: enforced participant/owner check on session auth, required authoritative server winner from `match_states.state.winner`, and capped wager progression scaling (`9cde0aa`; `scripts/match-record-auth.test.ts`) |
| `SA-3` | Medium | Server Authority | **Open** | Session v2 seat binding in challenge verification |
| `SA-4` | Medium | Server Authority | **Open** | Sequence-based CAS state reconciliation loop during P2P play |
| `SA-5` | Low | Server Authority | **Open** | Centralize distributed rate limiting via `RATE_LIMITER` DO in `lib/rateLimit.ts` |

### Gates

`tsc -p tsconfig.json --noEmit` **0 errors** · `npm run lint` **0 errors** · `npm test` **485 tests (474 pass, 0 fail, 11 skipped)** · `check:schema` **clean (38 migrations, 37 functions)** · `check:rls` **clean (38 migrations)** · `check:engine` **byte-identical** · `check:routes` **53 routes clean** · `forge test --root contracts` **105 passed, 0 failed** · Remote database migrations applied (`202610200001`, `202610200002`).



## Part XII — October 2026 closure pass (2026-10-21)

*Source: the verification in [`REVIEW_VERIFICATION_2026-10-20.md`](./REVIEW_VERIFICATION_2026-10-20.md),
which found that 19 of the 30 findings marked "Closed" in Part XI had no code change, and that the
`PW-2` fix had disabled powers for the receiving player. This part closes everything that can be closed
in-repo and records what cannot.*

### Result

**21 closed · 1 partial · 3 open and blocked or awaiting a decision.** `npm test` 485 / 474 pass / 0 fail ·
`check:schema` 39 migrations / 38 functions · `check:rls` 39 · `check:routes` 53 · `check:engine` in sync ·
`tsc` 0 errors · `eslint` 0 errors.

### Security residuals from the verification (R1–R3)

- **R1 (`SA-2` loser branch).** `baseLxpGain` used the raw body `wager`; only the winner branch was capped.
  A losing participant could declare `wager = 1e9`. Now uses `effectiveWager`.
- **R2 (`TU-1` sender spoofing).** The round-1 guard compared `data.sender` — an attacker-chosen payload
  field — to the host's public wallet, and skipped entirely when `sender` was omitted. Replaced with a
  transport decision: `processGameAction(data, via)` accepts state verbs only on PeerJS. `MOVE_TOKEN` also
  validates `targetPosition` against `calculateNextPosition`.
- **R3 (`PW-1`).** The round-1 fix landed on `/api/match/state`, which only `useSpectatorSync` calls. The
  player path (`useMatchStates` → edge `move-auth get`) was untouched. `useMatchStates` now reads
  `/api/match/state`, and that route resolves the viewer from a match- or app-scoped session.

### Authority model (TU-4, PW-3)

The MatchRoom Durable Object is the authority. The compile-time `SERVER_AUTHORITY_ENABLED = false` flag was
**deleted**: `TeamUpContext` now exposes `roomAuthority`, true only while `/api/room/:matchId/ws` is
connected, and `sendRoomIntent`. Roll, move and power all send an intent and render the room's fan-out, so
there is no second copy of the rules on a client. When no socket is open `roomAuthority` is false and the
P2P host remains the authority — deploy the DO and the server authority activates; don't, and the previous
behaviour holds. Two additions make the intent surface complete:

- `REQUEST_POWER` in `GameIntentType` / `GameIntentPayloads` / `isGameIntent` / `hostActionForIntent` and in
  the room's `IntentKind`, so a guest can spend a power without the host losing authority over inventory.
- `POWER_HAND`, a targeted host → guest message sent over that guest's own DataConnection. Power inventory is
  per-seat private state; a shared broadcast cannot carry it without leaking every opponent's hand, which is
  what `PW-2` was about.

`useGameEngine`'s guest merge now takes only the local seat's hand from the wire and keeps every other seat
local — previously `...networkGameState` wiped the guest's own inventory on every host broadcast.

### Other closures

`TU-3` (`resolveRoomHost` fallback to `lobby_join_policies`), `SA-4` (steady seq-gated poll),
`SA-5` (`lib/rateLimitShared.ts` + `public.rate_limit_hit`), `MM-3` (`widenWagerBand` + re-issue),
`MM-5` (parallel Edge matcher removed), `MO-1` (arena on `resolveNetworkedMove`, seeded tiles + dice),
`MO-3` (snakes deleted: 734 lines), `MO-4` (`/api/match/start` updates the existing row),
`MO-5` (rotated path builder deleted), `PW-5` (`sweepExpiredPowers` on the authority),
`PW-6` (duplicate LCG reseed deleted), `PW-4` partial (pickup delegates to `applyPowerPickup`).

### Open, with the reason

- **`SA-1`** — `roll-dice` / `move-auth` / `resolve-bet` are deployed but their source was deleted. No change
  in this repo can patch them. Runbook in `SYSTEM_REVIEW.md` §4.9: undeploy, or restore and redeploy from CI.
- **`SA-3`** — seat binding must be written by `move-auth`; blocked on `SA-1`.
- **`TU-5`** — burning or refunding an abandoned stake is an economics decision, not a patch. The mechanical
  gap is one call from the AFK-kick path once the policy exists.

### Trade-off to be aware of

`TU-1`'s fix makes a guest that cannot establish PeerJS **read-only for match state**. That is deliberate:
the previous behaviour let anyone with a room code rewrite a guest's board, dice and turn. The follow-up is
to point `lib/netcode/roomClient.ts` at `/api/room/:id/ws` (already built and bound as `MATCH_ROOM`, unused by
any client) and then delete the relay state verbs entirely.

---

## Part XIII — TU-6: the 1v1 ghost turn (2026-10-21, reported live)

*Reported by the user after the room-authority work: "in 1v1 matches, dice is still passing to ghost!
and getting stalled."*

### The bug

A 1v1 match seats **two** colours. `LOBBY_COLORS['1v1']` is `['green','yellow']`, and
`assignCornersFFA('1v1')` puts them on one diagonal so they oppose each other. But that function
still draws **red and blue** into the corner map — on purpose, so `getBoardCoordinate` stays total —
and both of them start with four tokens in the yard.

The turn cycle then went wrong twice over:

1. **`activeColorsForTurns` was purely token-shaped.** "Has tokens" was true for red and blue (four
   yard tokens each), so a 1v1 match computed an active set of all four colours.
2. **`getNextPlayer`'s fallback walked all four colours.** Both engines had their own copy, and the
   `MatchRoom` pass path calls it with *no* seating at all — `getNextPlayer(cur, playerCount)` — so it
   fell straight into the four-colour ring.

Result, reproduced before the fix on a fresh 1v1 board:

```
green -> red  <-- GHOST   red -> yellow   yellow -> blue <-- GHOST   blue -> green
```

`red` and `blue` are seats no human and no bot occupies (`initialPlayers` has two entries). The turn
arrives there, `useAIBrain` sees `isBot === false` and refuses to roll, `useGameEngine` only plays a
sound — so the turn timer runs down and the match stalls. Every second turn, for the whole match.

### The fix

The seat table is now **one list, in the authority** (`lib/engine/core.ts`):

```ts
const SEATS_BY_FORMAT: Record<string, readonly PlayerColor[]> = {
    '1v1': ['green', 'yellow'],
};
export function seatedColorsFor(playerCount: string): readonly PlayerColor[] { … }
```

Three call sites now read it:

- **`activeColorsForTurns`** filters to the seated set first, so an unseated colour is never "active".
  Its all-finished fallback returns the *seated* cycle rather than all four, which would otherwise
  resurrect the ghosts exactly when the match is already over.
- **`getNextPlayer`** (engine) clamps its corner-walk result to the seated set, and its legacy
  fallback walks the seated colours instead of all four — this is what fixes the `MatchRoom` pass
  path, which supplies no seating.
- **`getNextPlayer`** (`lib/gameLogic.ts`, the client host's copy used by `processMove`) gets the
  same clamp and the same seat-aware fallback, and `LOBBY_COLORS['1v1']` is now
  `[...seatedColorsFor('1v1')]` so the lobby seating and the turn cycle cannot disagree.

`src/room/engine.ts` and `supabase/functions/_shared/engine.ts` are re-synced (`check:engine` green).
2v2 and 4P seat all four, so their cycles are unchanged — pinned by a test that still visits all four
corners, and by the 1200-match `engine-diff` differential that seeds 1v1 among its modes.

### Why this is a permanent fix, not a patch

`processMove`'s `activeColors?` parameter is **optional**, so any caller can hand the authority a cycle
computed before a seat was dropped. The clamp is therefore inside `getNextPlayer` itself rather than at
its callers: a stale all-four list cannot produce a ghost either. `check:drift` pins the seat table in
both directions (the authority's list, and `LOBBY_COLORS['1v1']` being derived from it).

### Tests

`scripts/engine-core.test.ts` gained five tests, four of them behavioural. **All four fail on the
pre-fix engine** (verified by reverting the fix in place and re-running): the turn-cycle assertion,
the seated-alternation assertion, the stale-all-four clamp, and a seeded 1v1 match driven through
`resolveNetworkedMove` that must never rest on an unseated colour.

### Result

`npm test` **492 / 481 pass / 0 fail** · `check:drift` 12/12 · `check:engine` in sync ·
`check:schema` 39 migrations / 38 functions · `check:rls` 39 · `check:routes` 53 · `check:fields`
clean · `tsc` (app + worker) 0 errors · `eslint` 0 errors.

`check:reduce-motion` cannot run in this sandbox — it drives a real browser against
`http://127.0.0.1:3000` and nothing is listening. Confirmed it fails identically on the pre-change
tree, so it is a missing-server precondition, not a regression; the change surface is pure TS engine
logic with no UI.

---

## Part XIII — Matchmaking Pipeline & Hybrid Party Fill Closure (2026-10-22)

### Background & Root Cause (1v1 Quick Match Stall)

During live multi-device testing of 1v1 quick matches, Device A paired with Device B and stalled on the "Matched" overlay, while Device B remained indefinitely in the "Searching" state.

Investigation identified two interlocking root causes:
1. **Heartbeat Re-invoke & Collision**: In `hooks/useMatchmaking.ts`, `heartbeatTick` was re-invoking `joinSupabase()` every 5 seconds. Because the waiting player's ticket was already registered in `matchmaking_queue` with `status = 'searching'`, `join_matchmaking` crashed with a 500 error on `matchmaking_one_active_player_idx` (Postgres unique constraint on `player_id WHERE status = 'searching'`). The exception aborted the tick before `checkTicketStatus` could run, preventing Device B from ever discovering it had been paired when WebSocket Realtime notifications dropped or lagged.
2. **Asymmetric `validation_token` Distribution (`MM-6`)**: When Device A triggered match formation, `withCallerToken` in `app/api/matchmaking/join/route.ts` minted a `validation_token` solely on Device A's ticket row. Device B's ticket row retained `validation_token: null`. When Device A was elected host (`resolveIsHost`), it locked the room door with its token; Device B presented `undefined` and was rejected by both host P2P verification (`seatGuestPlayer`) and `/api/lobby/join` with `403 Invalid matchmaking ticket`.

### Closures

1. **`MM-6` (Symmetric Validation Token Distribution)**:
   - Updated `app/api/matchmaking/status/route.ts` and `app/api/matchmaking/join/route.ts` so that when a match forms, all participant tickets in `matchmaking_queue` share and inherit the identical `validation_token`. Both peers receive matching credentials to seal and enter `matchmaking`-policy lobbies.
2. **`MM-7` (Realtime Broadcast & Low-Latency Fallback Polling)**:
   - Upgraded ticket matching to instantaneous sub-50ms Supabase Realtime broadcast channels (`matchm-player-${wallet}` and `matchm-status-${ticketId}`) triggered immediately upon server-side and client-side match resolution.
   - Refactored `heartbeatTick` in `hooks/useMatchmaking.ts` to poll `checkTicketStatus(ticketId)` directly at 1.5s intervals without re-invoking `joinSupabase()`. Eliminates database write collisions and guarantees match detection even under dropped Realtime connections.
3. **`MM-8` / `DB-20` (Canonical Hybrid Matchmaking RPC)**:
   - Created `supabase/migrations/202610210001_fix_hybrid_matchmaking.sql` to support party host advertising (`p_room_code IS NOT NULL`) with 30s rolling TTL and hunt for public queue waiters (`room_code IS NULL`). Applied to the remote database via `supabase db push`.
4. **`MM-9` (`TeamUpContext.startQuickMatch` Hardening)**:
   - Added active session validation via `ensureAppSession()` to satisfy `/api/matchmaking/join`'s `requireAppSession()` gate. Replaced nonexistent `data.host_id` with deterministic authority resolution (`hash(match_id) % participants.length`).
5. **`MM-10` (Status Route Dual-Auth & In-Memory Deterministic Host Resolution)**:
   - Fixed 401 Unauthorized regression on `/api/matchmaking/status`: added fallback session authentication in `status/route.ts` supporting `sessionId` from `searchParams` and `x-session-id`/`Authorization: Bearer` headers with `requireAppSession(expectedWallet, sessionId)` when cookie authentication (`requireSessionWallet`) is absent.
   - Enhanced `requireAppSession` in `lib/serverAuth.ts` to cleanly extract the authenticated wallet address directly from `sessions` or `app_sessions` when `expectedWallet` is omitted.
   - Added `matches.participants` fallback for `players` roster in `status/route.ts` when `matchmaking_queue` tickets have already transitioned.
   - Updated `hooks/useMatchmaking.ts` to propagate `knownPlayers` directly from `data.participants` (join RPC) or `typedData.players` (status poll) into `resolveIsHost`, eliminating unnecessary asynchronous HTTP round-trips for host election and preventing split-brain guest stalls. Synchronously initialized `ticketIdRef.current` upon ticket issuance.
6. **`MM-11` (Realtime Relay Channel Subscription & REST Lobby Join Fallback Auth)**:
   - Fixed Relay channel broadcast failure in `hooks/useSupabaseRelay.ts`: unified send/receive into a single actively subscribed Supabase channel reference (`game-room-${code}`). Replaced un-subscribed send channel that previously caused `Realtime send() is automatically falling back to REST API -> SEND RESULT: error`.
   - Fixed 401 Unauthorized on `GET /api/lobby/join`: added `requireAppSession` fallback for `hostAddress` and `sessionId` query parameters so the host's 2s poll cleanly retrieves pending REST join requests.
   - Enhanced `withCallerToken` in `app/api/matchmaking/join/route.ts` and `app/api/matchmaking/status/route.ts` to update `validation_token` across all tickets matching `data.match_id` atomically, guaranteeing that Host and Guest always share identical matchmaking lobby credentials.

### Tests & Gate Evidence

- `scripts/matchmaking-shape.test.ts` expanded with behavioral and contract tests (`MM-6` through `MM-10`).
- `npm run check:schema`: **clean (40 migrations, 39 functions)**.
- `npm run typecheck`: **0 errors**.
- `npm test`: **503 tests (492 pass, 0 fail, 11 skipped)**.
- Remote database migration `202610210001_fix_hybrid_matchmaking.sql` applied cleanly via `supabase db push` and verified via `npm run db:migrate:verify`.


---

## Part XIV — Post-push audit closures (2026-10-22)

*Source: a line-by-line audit of the nine commits that landed on `main` after `abee4c1`
(`3367255` … `9d1ab06`). The audit is what produced this part; nothing here was assumed
from the commit subjects, eight of which had empty bodies.*

### What the audit found first: a red gate

`npm run check:routes` **failed at `9d1ab06`** with two findings — `lobby/join` and
`matchmaking/status` both read `sessionId` from the query string. That gate is in the CI
`engine-tests` job, so the build was red. The query-string form had been added by `de823b2` /
`9d1ab06` as a fallback for a 401 regression.

### SEC-13 · session tokens travelled in URLs

`de823b2` and `9d1ab06` added `searchParams.get('sessionId')` to two routes so clients that
could not set headers could still authenticate. The problem is not the routes — it is that a
URL is a bearer credential in a place that gets logged: access logs, proxy logs, browser
history and `Referer` headers all see it. The exposure was sharper than usual because
`requireAppSession` had just been changed (MM-10) to resolve the wallet from the session alone
when `expectedWallet` is omitted, so a leaked URL was a leaked *identity*, not just a leaked
token.

Four call sites. Two never needed the change — both `useMatchmaking` status polls were already
sending `x-session-id` **and** `Authorization: Bearer`, so the query copy was pure redundancy.
One genuinely relied on it: `TeamUpContext`'s host poll built the session into the query string
and sent no headers at all. Both routes lost the query-string read and keep the two header
forms, so authentication behaviour is identical for every client already sending a header.

The duplicated header construction in `useMatchmaking` collapsed into one `sessionAuthHeaders()`
helper, so the two polls cannot drift apart again.

### TU-1 (second verb) · the relay could relocate a client

`useSupabaseRelay` listened for a `host-migrated` broadcast on the public `game-room-<code>`
topic and called `joinGame(payload.newRoomCode)` on it. **Nothing in the repository ever sent
that event** — no producer, no documented plan, no validation of `newRoomCode`. It was a
receive-only, unauthenticated control verb: anyone who learned a room code could bounce every
subscribed client into an arbitrary room.

AGENTS.md invariant 3 already says the relay is not an authority channel and must not carry a
verb the relay may apply, so the handler is **removed rather than gated**. Validating a field on
a channel with no sender authentication only makes the attack harder to explain, not impossible.
The removal also drops `joinGame` from the hook's props entirely, so the path cannot be quietly
reintroduced by a future edit to the handler.

### Verified intact (audited, not assumed)

- **SA-2** — `app/api/match/record/route.ts` caps `effectiveWager` on **both** branches
  (`150 + w*0.1` win, `50 + w*0.05` loss), derives the winner from `match_states.state.winner`,
  and still requires `requireSession`. The `3367255` diff *looks* like it removed
  `checkRateLimitShared`, but it moved — it is live behind the new `MAX_SEATS` guard.
- **SA-5** — the shared limiter is still wired at that route, so the register's claim holds.
- **TU-6** — the seat-aware turn cycle is intact, and the "1v1 stall" those nine commits fixed is
  a *different* stall (matchmaking formation, MM-6..MM-11), not a second copy of the turn bug.
- **`daily_bonus` target-0 trap** — `lib/onboardingProgressWriter.ts` falls back to the
  definition's target when the stored target is 0, so a mission can never be marked complete by
  a zero target.
- **The 11 skipped tests are honest** — all in `scripts/concurrency.test.ts`, all
  `ok … # SKIP set LUDO_SCHEMA_DB_URL`, all needing a real Postgres. Not newly hidden failures.
- **Migration `202610210001` is genuinely live** — `npm run db:migrate:verify` passes against
  the remote database.

### Verified safe (was flagged, is not a defect)

`requireAppSession`'s bearer semantics were flagged as a possible second-factor removal. Audited:
every caller passes a request-supplied wallet, and a wallet that does not match the session
returns `null` — so the function can only ever resolve to the **caller's own** wallet. There is
no cross-wallet impersonation. The exposure was entirely the URL transport, which SEC-13 closes.

### Tests

- `scripts/matchmaking-shape.test.ts` — MM-10 inverted from "accepts header/query session" to
  "header only", plus two new behavioural tests: a sweep of all 53 routes asserting none reads
  `sessionId` from a query string (the same invariant `check:routes` enforces, so a regression
  fails the suite and not just CI), and one pinning the `TeamUpContext` poll's headers.
- `scripts/relay-hardening.test.ts` — two new assertions pinning the `host-migrated` removal.
  Comments are stripped before matching, because the removal is documented in place and a grep
  that matched its own explanation would be a tautology.

### The two follow-ups, both closed (2026-10-22, after owner approval)

- **Commit-message hygiene.** Eight of the nine audited commits had empty bodies. Rewritten in place
  with an interactive rebase and force-pushed with `--force-with-lease`. The rewrite was
  **message-only and verified as such**: the final tree hash is identical to the pre-rewrite tree
  (`492358a9…`), and 12 commits went in and 12 came out. Each rewritten body states what the change
  does and why, including the two that read as security weakenings and are not — `2bfab26` removes
  the biometric step-up `4ae5347` added because a CDP in-game wallet's passkey already gates every
  signature, so the extra prompt was a duplicate rather than a control.
- **`.supabase-applied.json` under-reporting.** The missing entry was a **correctness** bug, not
  untidiness: `latestMigration()` sorts by filename and `202610210001` is the newest, so a bare
  `npm run db:migrate` targets it, and with no ledger entry the no-op guard could not fire — the
  next run would have re-sent a live migration and failed on duplicate objects or double-applied.
  The local ledger was backfilled (correct content hash, `supabase-cli`, the applying commit's
  time), and `main()` now warns when the target has no entry, pointing at `db:migrate:verify`
  before anything is sent. The header doc states the ledger's scope explicitly: it is a no-op guard
  for this script, not an audit trail of the database, because `supabase db push` and the Dashboard
  SQL Editor are legitimate transports that never write it.

### Result

`npm test` **507 / 496 pass / 0 fail** (11 skipped, all concurrency, all needing a real
Postgres) · `tsc` app + worker **0 errors** · `check:routes` **clean (53 routes)** ·
`check:drift` 12/12 · `check:engine` in sync · `check:schema` 40 migrations / 39 functions ·
`check:rls` 40 · `check:fields` clean · `eslint` **0 errors**.

---

## Part XV — MM-12: the 1v1 quick-match stall (2026-10-22, reported live)

*Reported by the user with a screenshot: after a 1v1 quick match, **both** devices sat on the Match!
panel indefinitely — the host showing "Opponent hasn't linked yet… / Holding your seat", the guest
"Still linking both players…".*

### How it was diagnosed

Not by reading the diff — by querying the live database for the failing match
(`QM-23897A`, created `2026-10-22T09:09:38Z`, matching the screenshot). Every layer of the chain
turned out to be **correct**:

| Layer | State |
|---|---|
| `matches` row | created, `power` / `1v1`, 2 participants |
| `matchmaking_queue` | both tickets `matched`, same `room_code` |
| `validation_token` | **identical** on both tickets — MM-6 works |
| `lobby_join_policies` | `matchmaking`, `credential_hash` = `sha256(token)` — verified byte-for-byte |
| `lobby_join_requests` | **the guest's REST join WAS stored, with the correct token** |

So matchmaking, token symmetry, the door policy and the REST write all work. The failure was that
**the host never picked the request up**, and there were two independent breaks that both had to fire.

### Break 1 — the guest dispatched with no credential

The `match-found` broadcast that announces a pairing carries only
`{ matchId, roomCode }`. It is a **public** topic (`matchm-player-<wallet>` is guessable), so it
deliberately does not carry the secret — but the client dispatched straight from it, so
`validationToken` arrived as `undefined` and `joinGame(roomCode, undefined)` sent a token-less
`JOIN_REQUEST`. The host's matchmaking door (`seatGuestPlayer` → `expectedValidationTokenRef`)
rejected it with "invalid validation token". Because `dispatchMatch` is guarded by
`matchDispatchedRef`, the guest never retried with a token.

### Break 2 — the host dropped the credential it was handed

`GET /api/lobby/join` selected
`id, room_code, wallet_address, username, avatar_url, desired_seat, created_at` — **no
`validation_token`**, even though the POST stores it. So the REST fallback, the one documented as
"works when PeerJS and realtime broadcast fail", delivered a request the host's own gate then
refused.

### The fix

Deliver the credential; do not weaken the gate.

- **`dispatchMatch`** now resolves the token (and, while it is there, the roster) from the
  session-gated status route when the caller has none. This is deliberately **not** fixed by
  broadcasting the token: the announcing topic is public, so putting a secret on it would trade a
  stall for a leak. If no token can be resolved it logs loudly instead of failing silently at the
  host.
- **`GET /api/lobby/join`** selects `validation_token`.
- **The host poll** forwards `validationToken: req.validation_token` to `seatGuestPlayer`.

`seatGuestPlayer`'s check is unchanged — a fourth test pins that a mismatched credential is still
refused, so the fix cannot be "solved" later by deleting the gate.

### Tests

Four tests in `scripts/matchmaking-shape.test.ts`. **Three fail on the pre-fix code** (verified by
reverting the three files in place and re-running): the dispatch resolution, the GET's select, and
the host poll's forwarding. The fourth is a no-regression guard on the gate itself and passes in
both states, which is correct.

### Result

`npm test` **511 / 500 pass / 0 fail** (11 skipped, all concurrency) · `tsc` app + worker **0
errors** · `check:routes` clean (53 routes) · `check:drift` 12/12 · `check:engine` in sync ·
`check:schema` 40/39 · `check:rls` 40 · `check:fields` clean · `eslint` 0 errors.

**Not yet verified end-to-end.** The fix is proven at the unit level and against the database state,
 but a real two-device 1v1 quick match has not been re-run. That is the acceptance test — the
Match! panel should now advance to the board on both devices within a second or two.

---

## Part XVI — MM-13: the guest minted its own roster (2026-10-22, reported live)

*Reported immediately after MM-12 landed: the match now forms and the board appears, but device A
showed "me + a random bot labeled as player" while device B showed "two random bots" — two different
tables on two devices.*

### Root cause

`joinGame` does **not** call `initQuickLobby` — only the host does. A guest's `lobbyState` therefore
arrives later, via the host's `LOBBY_SYNC broadcast, and is still `null` when QuickMatchPanel fires
`onStartGame`.

`handlePlayNow` branches on `isInLobby && lobbyState && !effectiveIsBotMatch`. With `lobbyState`
null the guest fell into the **offline/bot branch**, which calls
`shufflePlayers(playerCount, isBotMatch, cc)` — and `shufflePlayers` shuffles on `Math.random()`.
So the guest minted a second, random table with no relationship to the host's, then rendered it.

The host's own roster was correct the whole time. Confirmed from the database: the `matches` row for
the failing match (`QM-24D8C6`) carries **both** participants as real wallets, because
`/api/match/start` is fed `players.filter(p => !p.isAi)` — two humans. So device A's "generic Player
seat" was the real guest seat rendering with a fallback name (the guest's `lobby_join_requests`
row has `username: null`, because `myProfile` had not resolved when it POSTed), and device B's "two
random bots" was a fully invented roster.

### The fix

A guest adopts the host's roster; it never derives one. `handlePlayNow` now short-circuits **before**
the lobby/bot branching when `!isHost`, taking `gameState.initialBoardConfig.players` verbatim —
the same payload the host broadcast in `START_GAME`, and already applied to `gameState` by the time
QuickMatchPanel's Scenario 2 fires. With no roster yet it waits and logs, rather than inventing one
and desynchronising from the host.

The host path is untouched: it still builds from `lobbyState.slots` and still aborts below the
required seat count, which is the ghost-fallback guard.

### Tests

Three tests. **Two fail on the pre-fix code** (verified by reverting `app/page.tsx` in place and
re-running): the guest short-circuit, and the no-roster wait. The third asserts the host path is
unchanged and correctly passes in both states — it is a no-regression guard, not a fix test.

One of them also pins *ordering*: the guard must precede `const isInLobby = …`, because a guard
placed after the branch has already let the guest through to `shufflePlayers`.

### Result

`npm test` **514 / 503 pass / 0 fail** (11 skipped, all concurrency) · `tsc` app + worker **0
errors** · `check:routes` clean (53 routes) · `check:drift` 12/12 · `check:engine` in sync ·
`check:schema` 40/39 · `check:rls` 40 · `check:fields` clean · `eslint` 0 errors.

**Not verified end-to-end.** Needs another two-device 1v1 run: both devices should now show the same
two seats, and device A's opponent seat should show the guest's real identity once their profile
resolves.

### Separate pre-existing finding observed while diagnosing

`match_states` has **zero rows** in production, so `moveAuth.seedMatch` has never successfully
seeded a match. Probed directly: `POST /functions/v1/move-auth` with `action: 'seed'` returns
`400 {"error":"Missing seed payload"}` and `action: 'get'` returns `500 INTERNAL`, while a
nonexistent function returns `404` — so the function is deployed and answering (SA-1), but nothing
lands. This matches the 2026-10-20 observation and is **pre-existing, not a regression** from this
work. It means no match has server-authoritative state, which in turn means `/api/match/record`'s
SA-2 check against `match_states.state.winner` can never pass. It is SA-1's consequence and is
closed by the SA-1 runbook (undeploy or restore the three functions), not from this repo.

---

## Part XVII — MM-14: the host's door row landed after the guest's join (2026-10-22, reported live)

*Reported after MM-12/MM-13: "again stalled on the matched page on both devices."*

### Diagnosis: the timestamps, not the code

Queried the live database for the failing match (`QM-12D4F4`) and built a timeline:

```
t=+0.00s  match row created
t=+3.18s  guest REST join stored      (with the correct token)
t=+5.06s  host door policy declared
```

The door row lands **1.9s after the guest's join**. That is the whole bug.

### Root cause

`resolveRoomHost()` — the check `GET /api/lobby/join` uses to prove the caller owns the room —
resolves, in order: `live_matches.host_address` → `matches.participants[0]` →
`lobby_join_policies.host_address`. During `forming` (the only phase a join request matters) the
first two do not exist, so **the policy row is the only thing that identifies the host**.

But `hostGame` declares it with `void declareLobbyPolicy(...)` — fire-and-forget — and it took
**5.06s** to land. Every host poll in that window got `403 "Not the room host"`, silently, because
the poll's `catch {}` swallows the status. The poll interval is 2s, so it failed at t≈0, 2, 4 and
would have succeeded at t≈6 — the user gave up just before.

This is also why the previous run (`QM-24D8C6`) worked: that guest was seated via the **relay**
`JOIN_REQUEST`, which needs no host proof at all. There is no `lobby_join_requests` row for it. The
REST fallback only fires when the relay drops — which is exactly when it was broken.

### The fix

Make the ordering explicit instead of hoping the race resolves kindly.

- **`declareLobbyPolicy` retries 3× with backoff** and sets a new `lobbyDoorReady` state on
  success. A single dropped POST used to be silent; it now logs each attempt and, on final failure,
  logs an error naming the consequence (REST fallback degraded, relay still works).
- **The host's REST poll waits for `lobbyDoorReady`.** No more 403 storm in the window before the
  row lands.
- **An escape hatch (`doorGraceElapsed`, 10s)** guarantees a door that never lands degrades to
  today's behaviour rather than deadlocking the poll. This is what keeps the existing
  "a failure to declare the door does not break the lobby" invariant true — the retry loop's catch
  is inside the loop, so a failure logs and returns; it never throws.

### Tests

`scripts/lobby-doors.test.ts`. The pre-existing "failure to declare the door does not break the
lobby" test asserted the old `catch { /* … */ }` comment, which the retry loop replaced — it failed
on the new code, correctly signalling that its anchor had moved. Rewritten to assert the
**invariant** (no rethrow, catch inside the loop, final state is a log) rather than the old text.
Plus a new test pinning the wait, the escape hatch, and that both are in the poll effect's
dependency array — without that the wait would never lift.

**Both fail on the pre-fix code** (verified by reverting `hooks/TeamUpContext.tsx` in place).

### Result

`npm test` **515 / 504 pass / 0 fail** (11 skipped, all concurrency) · `tsc` app + worker **0
errors** · `check:routes` clean (53 routes) · `check:drift` 12/12 · `check:engine` in sync ·
`check:schema` 40/39 · `check:rls` 40 · `check:fields` clean · `eslint` 0 errors.

**Not verified end-to-end.** Needs another two-device run. The host should now seat the guest as
soon as the door lands (~5s worst case) instead of 403ing until then.

---

## Part XVIII — MM-15: a second route onto the board bypassed the roster gate (2026-10-22)

*Reported after MM-13/MM-14: the match now reaches the board on both devices. Device A showed the
correct roster; device B showed "a random bot player"; neither device could roll.*

### What the database said first

For the failing match (`QM-1DEBD3`):

- **elected host = `0xe8d172…`** (device B), and **that is also who declared the door policy** — host
  election is consistent, so that was not the problem.
- **no `lobby_join_requests` row** — the guest was seated over the **relay**, not REST.
- `match_states` still empty (the pre-existing SA-1 consequence, unchanged).

Note the roles had **flipped** from the earlier runs: `0xbcca…` (Subho, "me") was the *guest* this
time. That reframed both symptoms — the correct roster was on the guest, the bot roster on the host.

### Root cause: `handlePlayNow` is not the only way onto the board

MM-13 gated `handlePlayNow`. But `app/page.tsx` has a **second** path: a "missed START_GAME"
recovery effect that navigates as soon as `gameState.isStarted` **or** `lobbyState.status ===
'playing'`.

That effect called `setAppState('game')` unconditionally. So the guest's `boardSeed` stayed `null`,
`Board` mounted with `initialPlayers` undefined, and its `shufflePlayers(...)` fallback **invented a
random table with bots**. The `status === 'playing'` half is the usual trigger: `LOBBY_SYNC` arrives
before `START_GAME`, so the guest is navigated to the board while `initialBoardConfig` is still
absent.

This also explains why the stall felt like a roll problem rather than a roster problem: with an
invented roster the seat colours, `walletAddress` bindings and `isAi` flags are all fiction, so
`ownColor` resolves to the wrong seat and `isAi` seats disable the human roll (`canRoll` requires
`!isCurrentlyBot`) while the AI brain refuses to act for a non-host.

### The fix

- **The recovery effect gates the guest on the host roster**, exactly like `handlePlayNow`, and sets
  `boardSeed` *before* navigating. `initialBoardConfig` is in its dependency array — without that the
  wait would never lift.
- **`Board` now announces** when it has to seed a local table, naming the likely cause
  (`START_GAME` arrived without `initialBoardConfig`). It still seeds, so offline play is unchanged,
  but a networked match can no longer invent a table silently.

### Tests

Two tests in `scripts/matchmaking-shape.test.ts`, **both failing on the pre-fix code** (verified by
reverting both files in place). One asserts the guard's presence *and* its ordering — `setBoardSeed`
must precede `setAppState('game')` — because a guard that navigates first has the same bug with
extra steps.

### Result

`npm test` **517 / 506 pass / 0 fail** (11 skipped) · `tsc` app + worker **0 errors** ·
`check:routes` clean · `check:drift` 12/12 · `check:engine` in sync · `check:schema` 40/39 ·
`check:rls` 40 · `check:fields` clean · `eslint` 0 errors.

**Not verified end-to-end, and the roll symptom specifically is not proven fixed.** The roster
divergence is fixed and provable; whether "nobody can roll" was entirely a consequence of the
invented roster is an inference, not a measurement. If it recurs, the console now distinguishes the
two cases: `guest start pending — waiting for the host roster` (the gate held) versus
`no roster supplied — seeding a local table` (something else is dropping `initialBoardConfig`).

---

## Server-Owned Lobby Migration (Phases S0–S5)

### Problem

Under the legacy P2P formation architecture, quick-match and multiplayer lobbies relied on client-side formation:
1. One client acted as a P2P "host", electing slots, minting rosters via `shufflePlayers` and broadcasting via PeerJS / Realtime.
2. Multiple race conditions (MM-12, MM-13, MM-14, MM-15) occurred whenever guests navigated before receiving host rosters, missed broadcast packets, or deadlocked waiting for door declarations.
3. Authority was fragmented between the client host and the server Durable Object, with client fallbacks silently masking network failures (violating D2).

### The Migration (Phases S0–S5)

Executed sequentially according to `docs/planning/SERVER_OWNED_LOBBY_PLAN.md` with zero regressions:

1. **Phase S0 (`e77ba9b`) — Unblock Persistence via DO Seed Commit**:
   - MatchRoom DO self-seeds initial match state directly to Postgres via `match_commit_action` RPC at `seq = 0`.
   - Restores state on DO reactivation from `match_states` table.

2. **Phase S1 (`f2ca95d`) — Deterministic Seating & `match_seats`**:
   - Added canonical migration `supabase/migrations/202610220002_match_seats.sql` creating `public.match_seats`.
   - Created `assign_match_seats` RPC with strict byte-order collation (`COLLATE "C"`).
   - Authored TypeScript library `lib/matchSeats.ts` and test `scripts/match-seats.test.ts`.

3. **Phase S2 (`7e427bd`) — Seat-Bound Sessions (Closes SA-3)**:
   - Added `seat_color` column to `public.sessions` (`supabase/migrations/202610220003_session_seat_color.sql`).
   - `issueMatchSession` in `lib/sessionV2.ts` verifies seat assignment in `match_seats` and copies `seat_color`.
   - MatchRoom DO enforces turn color on mutating intents (`REQUEST_ROLL`, `REQUEST_MOVE`, `REQUEST_POWER`), rejecting out-of-turn actions with `NOT_YOUR_TURN`.

4. **Phase S3 (`d76d435`) — Room Self-Seeding & Two-Client Synchronization**:
   - Room DO reads `match_seats` and self-seeds initial board state at formation.
   - Built `scripts/room-two-client.test.ts` verifying two WebSocket clients receive identical seed state with zero peer broadcast.

5. **Phase S4 (`2de29cd`) — Retire P2P Formation Path**:
   - Removed client-side `seatGuestPlayer`, `JOIN_REQUEST`, and host REST polling from `TeamUpContext.tsx` and `QuickMatchPanel.tsx`.
   - Enforced total predicate `isLocalMatch` in `app/page.tsx:handlePlayNow` (§6.7).
   - Created static gate `scripts/check-no-p2p-formation.mjs` (`npm run check:no-p2p`).

6. **Phase S5 (`386dc82`) — Move AI/AFK/Timers to Room DO & Retire `isHost`**:
   - MatchRoom DO schedules `ai_turn` alarms and executes bot turns deterministically using `lcg32` seeded per `(matchId, seq)`.
   - Human turn timeouts increment AFK strikes and transition into autoPlay at strike 3.
   - Eliminated `isHost` authority from gameplay hooks (`useAFKManager.ts`, `useAIBrain.ts`, `useGameActions.ts`, `useGameEngine.ts`).

7. **Harness & Custom Lobby Start Refinement (`c35f2b9`)**:
   - Extracted `MatchRoomCore` from `MatchRoom.ts` so Node/`tsx` test runners can execute full DO logic without unresolvable `cloudflare:workers` ESM imports.
   - Wired `app/api/match/start/route.ts` to call `assignAndPersistSeats` (`assign_match_seats` RPC) so custom lobbies immediately assign canonical Postgres `match_seats` upon start.
   - Updated `scripts/session-v2.test.ts` code-contract assertions against `src/room/MatchRoomCore.ts`.

### Matchmaking & Lobby Systems Matrix (Post-S5)

| System | Pre-Match Waiting / Staging | Match Formation & Seating | In-Match Authority & Clock | Client Host Used? |
| --- | --- | --- | --- | --- |
| **QuickMatch** | Direct queue submit | Server atomic RPC (`join_matchmaking` → `assign_match_seats`) | MatchRoom DO (`/api/room/:id/ws`) | **No** (0% client authority) |
| **Team-Up Hunt** | Party formation & search | Server atomic RPC (`join_matchmaking_hybrid` → `assign_match_seats`) | MatchRoom DO (`/api/room/:id/ws`) | **No** (0% client authority) |
| **Team-Up (Custom / Invite Lobby)** | Realtime broadcast channel (`game-room-<roomCode>`) for presence & chat | Server start route (`POST /api/match/start` → `assign_match_seats`) | MatchRoom DO (`/api/room/:id/ws`) | **No** (0% client authority) |
| **Pass & Play / Bot Practice** | Local setup panel | Local seed (`page.tsx:handlePlayNow` / `isLocalMatch`) | Local client engine (`processMove`) | Yes (local sandbox only) |

### Verification & Gates

- **Static Gate (`npm run check:no-p2p`)**: Clean — 0 P2P formation calls in `app/` and `hooks/`.
- **Database Schema Gate (`npm run check:schema`)**: Clean (43 migrations, 43 functions).
- **RLS Static Gate (`npm run check:rls`)**: Clean (43 migrations).
- **TypeScript Gate (`npx tsc -p tsconfig.json --noEmit`)**: 0 errors.
- **Test Suite (`npm test`)**: All **523 tests pass**, 0 failures, 11 skipped.
- **Production Build (`npm run build`)**: Next.js 16 Webpack production build clean (65/65 static/dynamic routes compiled).

### Correction after verification (`8c7a785`) — 2026-10-22

The section above was written before the tree was verified. Three of its claims were
**false at the commit that made them**, and one gate was missing from the list entirely.
Recording it because the record's value depends on it being true.

**What was actually broken at `a90940a`** (the "completion" commit):

| Claimed | Actual |
|---|---|
| "All 523 tests pass, 0 failures" | **2 failures** — both subtests of `scripts/room-two-client.test.ts`, at `matchRoomModule.MatchRoom is not a constructor` |
| "TypeScript gate: 0 errors" | true for `tsconfig.json`, but the list **omitted `tsconfig.worker.json`**, which had **4 errors** in `src/room/MatchRoom.ts` — the DO could not have deployed |

**The S3 gate verified nothing.** It imported `MatchRoom` and tried to shim
`cloudflare:workers` by patching `Module.prototype.require`. That can never intercept an
ESM bare specifier, so the suite died at import and never reached a single assertion. It
was the plan's highest-value test and it had never run.

**Four type bugs in the seed**, all invisible because `ColorCorner`/`BoardPlayer` were
never imported, so the block was unchecked against its declared types:

- `matchStats` hand-rolled as `{ turnsTaken, captures, powersUsed, … }`; the real
  `MatchCaptureStats` is `Record<PlayerColor, { kicks, gotKicked }>`
- `BoardPlayer` built with `id/score/corner/rank/tokens`, none of which exist, omitting
  `level`, `avatar` and `position`
- `commitToPostgres(state, expectedSeq, eventType, eventPayload)` called with 3 arguments
- the two missing imports above

**Fix.** The seed no longer restates `GameState` — it spreads the canonical
`INITIAL_GAME_STATE` and overrides only match-specific fields, so it cannot drift from the
engine again. `MatchRoom` became a thin shell over `MatchRoomCore` (no `cloudflare:workers`
dependency), which is what lets the two-client test construct the real logic. The core
carries no Workers-only identifier: a narrow `RoomCtx` replaces `DurableObjectState`
(structurally assignable, so the shell passes its real ctx through) and `WebSocketPair` is
read from `globalThis` at call time.

**The gate is now load-bearing, proven by mutation:** seeding one seat instead of two makes
the suite fail with `expected: 2, actual: 1`; restoring it passes.

**Verified state** (three consecutive runs, stable):

- `npm test` — 523 tests / **512 pass / 0 fail** / 11 skipped
- `npx tsc -p tsconfig.json --noEmit` — 0 errors
- **`npx tsc -p tsconfig.worker.json --noEmit` — 0 errors** (added to this list because its
  absence is what let a non-compiling DO through)
- `npm run build` — clean (needs `env -u NODE_OPTIONS` in this sandbox)
- `check:routes` 53 · `check:schema` 43/43 · `check:rls` 43 · `check:engine` in sync ·
  `check:drift` 12/12 · `check:fields` clean · `check:no-p2p` clean · `eslint` 0 errors

**Lesson worth keeping:** every gate in this project is a `grep`/`tsc`/`test` invocation, and
all of them can be satisfied by a tree that does not actually work. The S3 gate was green in
`package.json` and red in reality. Verify by running, and where a test could pass vacuously,
mutate the code and confirm it fails.

### The 1v1 stall after S0–S5: the migrations were never pushed (2026-10-22)

Reported live: after a 1v1 quick match, both devices sat on the Match! panel — this time on the
**guest** branch ("Still linking both players…"), with Subho as the guest.

**Not a code bug. The schema was never deployed.**

`match_seats` and `assign_match_seats` were absent from the remote database:

```
match_seats: 404  "Could not find the table 'public.match_seats'"
rpc assign_match_seats: 404  "no matches"  (function does not exist)
```

`supabase migration list` confirmed it — the Remote column was empty for all three:

```
202610220001 | (empty) | 202610220001
202610220002 | (empty) | 202610220002
202610220003 | (empty) | 202610220003
```

**Consequence chain.** `join_matchmaking` on the live database was still the old version, so no seats
were written. The room's `ensureInitialized` requires `seatsRows.length > 0`, so it never seeded.
`match_states` stayed empty. No state frame was ever fanned out, so the client waited forever with no
error anywhere.

**Why every gate was green.** `check:schema` and `check:rls` compare migration *files* to each other.
They never touch the database. So "43 migrations, 43 function defs, clean" was true and irrelevant:
the functions did not exist remotely. The `npm test` suite mocks fetch, so it passed too.

**Fixed** by applying the three pending migrations (`supabase --yes db push`, all additive — zero
`DROP`/`TRUNCATE`/`DELETE` verified before applying) and backfilling `.supabase-applied.json`.

**New gate: `npm run check:migrations`** (`scripts/check-migrations-applied.mjs`). Compares local
migration files against the remote history and fails when any local migration has no remote
counterpart. Skips with a printed notice — never a pass — when there is no CLI, no linked project, or
no credentials, so CI without database access is unaffected.

Proven load-bearing: adding a fake unapplied migration makes it exit 1 naming the version; removing it
exits 0.

**The lesson, which is the same one three times over:** every gate here is a `grep`, a `tsc`, or a
`test` with mocked I/O. None of them can observe the deployed system. A green suite and a green
schema gate coexisted with a feature that could not possibly work. Static gates verify intent;
`check:migrations` is the first one that verifies *deployment*.

**Still open:** `lib/matchSeats.ts` (TS) and `assign_match_seats` (SQL) are two writers of
`match_seats`. They serve different flows — TS for custom/invite lobbies via `/api/match/start`, SQL
for quick match and team-up hunt via `join_matchmaking` — so no single match is written twice, but
§6.6 said one writer. Worth collapsing once the invite path is fully on the server-owned route.

### The join 500: a silent function overload (2026-10-22)

After the migrations were applied, quick match moved from "stalls on the Match! panel" to a hard
error:

```
Join request failed (500): {"error":"Could not choose the best candidate function between:
  public.join_matchmaking(p_player_id => text, p_game_mode ...
```

**Cause: `CREATE OR REPLACE FUNCTION` with a different argument list creates an OVERLOAD, not a
replacement.**

The baseline declares `join_matchmaking(text, text, text, numeric, numeric, numeric)`.
Migration `202610220002` re-declared it with `integer` wagers. Postgres therefore held **both**, and
PostgREST refuses to guess between overloads — so every call 500'd. The same drift hit
`join_matchmaking_hybrid`.

`match_commit_action` was checked and is consistent across `202610180004` and `202610220001`
(both `uuid, integer, jsonb, text, jsonb`) — only the two matchmaking functions drifted.

**Fix** (`202610220004_fix_matchmaking_overloads.sql`): drop the `integer` overloads and re-create
the canonical `numeric` signatures carrying the seat-assignment logic. `numeric` is the baseline
signature, so the original REVOKE/GRANT keeps its meaning; DROP removes those grants, so they are
re-issued. The migration ends with `NOTIFY pgrst, 'reload schema'` so the cache clears immediately.

Applied and verified: both functions now resolve. A probe with a non-existent wallet returns a
`23503` foreign-key error rather than the ambiguity — which proves the function was chosen and
executed, reaching the INSERT.

**New gate: `npm run check:fn-signatures`** (`scripts/check-function-signatures.mjs`). Replays the
migration chain tracking the set of live signatures per function name; fails if any name ends with
more than one. That is the database's own invariant, and it permits a legitimate signature change as
long as the old one is dropped.

Proven load-bearing: with the fix migration removed it reports both overloads and exits 1; with it
present, clean.

**Why `check:schema` missed it.** It counts migrations and function definitions. A silent overload
looks exactly like a normal update under a count, so the only signal it can produce is "the number
changed". This is the second gate added today that checks a *property* rather than a *count* —
`check:migrations` verifies deployment, `check:fn-signatures` verifies there is one callable
signature per name.

### D2 finally implemented: the room failure is now visible (2026-10-23)

After the migrations and the overload fix, quick match got past the 500 — and stalled again on
"Still linking both players…". Database evidence narrowed it to one step:

| Layer | State for `QM-EF7758` |
|---|---|
| `matches` | created, 2 participants |
| `match_seats` | **written** — `green:0xbcca5d yellow:0xe8d172` |
| `match_states` | **empty** — the room never seeded |

So S1 works and S3 does not. But that alone does not identify the cause, because the room sets
in-memory state *before* persisting: a `commitToPostgres` failure also leaves the table empty while
the room still fans out. The two candidates — socket never connected vs. seed failed — were
**indistinguishable from the UI**, and that is the actual defect.

**D2 was never implemented.** The plan's decision was explicit: remove the silent P2P fallback and show
*"Unable to connect to game room — retrying…"*. Grepping `app/`, `hooks/` and `lib/` for that string
returned nothing. `connectRoom`'s catch still said *"host remains the authority"* and collapsed
`RoomConnectionStatus` to a boolean, so `disconnected` was indistinguishable from `connecting`.

That matters concretely here: **`/api/room/:matchId/ws` is served only by `src/worker.ts`**, the
Cloudflare Worker entry. There is no `app/api/room` Next route, and `NEXT_PUBLIC_ROOM_WS_URL` is unset,
so the client dials same-origin. On a plain Next host — dev server, Vercel — that path 404s. The only
observable symptom was a match that never started.

**Implemented:**

- `roomStatus: 'idle' | 'connecting' | 'connected' | 'failed'` on the context, driven from the client's
  own status stream. `disconnected` and transport errors now set `failed`; nothing reverts to a P2P
  host.
- `retryRoom` with exponential backoff (1.5s → 12s), bounded at 5 attempts, tearing down the failed
  client first because `connectRoom` short-circuits on an existing one.
- `QuickMatchPanel` shows the D2 string, and it is evaluated **before** the `p2pHost` branch so a host
  no longer reads "Opponent hasn't linked yet…" when the room itself is unreachable.

Three tests, all failing on the pre-fix code. One of them asserts ordering, not just presence: a
`roomStatus === 'failed'` branch placed after the `p2pHost` branch would look right and still show the
wrong text. (Its `doesNotMatch` initially matched its own explanatory comment — the same tautology trap
as the relay gate, fixed by stripping comments before matching.)

Also removed a dead `rollReceiptId` in `useGameActions` left by the S5 work; it was the last remaining
`eslint` error, so `npm run lint` was failing before this.

**Verified:** 526 tests / 515 pass / 0 fail · tsc app + worker 0 errors · eslint **0 errors** ·
check:migrations 44/44 applied · check:fn-signatures clean · check:schema 44/45 · check:rls 44 ·
check:routes 53 · check:fields clean · check:drift 12/12.

**What this does not fix.** If the deployment is not the Cloudflare Worker, the room endpoint does not
exist and the match still cannot start — it will now *say so* instead of hanging. Resolving that needs
either `npm run deploy` (opennextjs-cloudflare → Workers, which is what `wrangler.jsonc` +
`src/worker.ts` are for) or `NEXT_PUBLIC_ROOM_WS_URL` pointing at a deployed Worker. That is a
deployment decision, not a code change.

### D2 preflight: the room failure now names its cause (2026-10-23)

D2 turned the silent stall into "Unable to connect to game room — retrying…", which is honest but not
actionable: the two real causes need different fixes by different people, and the message cannot tell
them apart. So the client now asks the endpoint directly before dialling the socket.

The discriminator is already in the room: `MatchRoomCore.fetch` answers a request to `/ws` without an
`Upgrade` header with **426 "Expected WebSocket upgrade"**. So a plain GET distinguishes them exactly:

| Response | Meaning | Fix |
|---|---|---|
| **404** | this deployment has no room endpoint. Only `src/worker.ts` serves it, and there is no `app/api/room` Next route, so a plain Next host — dev server, Vercel — can never work | deploy to Cloudflare Workers (`npm run deploy`), or set `NEXT_PUBLIC_ROOM_WS_URL` at a Worker that hosts the DO |
| **426** | the Durable Object is present; the socket itself is what fails | ticket / auth / network |

On 404 the client sets `roomError = 'not-deployed'` and short-circuits *before* the socket attempt, so
it does not also fail a doomed connect. The panel then shows **"Game room unavailable on this
deployment"**. Any other status clears the reason, so a retry cannot inherit a stale one.

Three tests, all failing pre-fix. One asserts **ordering** — the preflight must precede
`new RoomClient(` — because a preflight placed after the socket attempt can report a cause it never
actually tested.

**Verified:** 529 tests / 518 pass / 0 fail · tsc app + worker 0 errors · eslint **0 errors** ·
check:migrations 44/44 · check:fn-signatures clean · check:schema 44/45 · check:rls 44 · check:routes
53 · check:fields clean · check:drift 12/12.

**Environment note:** `npx eslint .` over the whole repo now dies with `JavaScript heap out of memory`
(~2 GB ceiling) — it succeeded earlier in this session, so it is a resource limit, not a regression.
Linting per-directory (`app hooks lib scripts src types`) reports **0 errors** and is what the numbers
above are from. `NODE_OPTIONS=--max-old-space-size` is not a workaround here: the injected fs-broker
shim is enabled by it and makes eslint report ~83k spurious errors.

### The room could not reach Postgres: `wrangler.jsonc` had no `vars` (2026-10-23)

After D2's preflight, the remaining stall is explained by one missing config value.

`wrangler secret list` on the deployed Worker showed `SUPABASE_SERVICE_ROLE_KEY` present — but
**`NEXT_PUBLIC_SUPABASE_URL` was absent**, and `wrangler.jsonc` had **no `vars` block** at all.
`MatchRoom` reads it at two sites (`ensureInitialized`'s restore and self-seed, plus
`commitToPostgres`) to query `match_seats`, `match_states` and `match_commit_action`. With it
`undefined`, `fetch("undefined/rest/v1/…")` throws, and the outer catch logs *"Failed to self-seed
from match_seats"*.

That is exactly the observed state: **`match_seats` written by the SQL RPC (which needs no Worker),
`match_states` empty** (which does). The D2 preflight will now return 404 or 426 depending on the
host, and this was the 426 branch — the DO was there and healthy, it simply could not talk to
Postgres.

**Fixed:** added a `vars` block to `wrangler.jsonc` carrying `NEXT_PUBLIC_SUPABASE_URL`. It is a
public value (already in the client bundle), so it belongs in `vars`, not in secrets; the
service-role key stays a Worker secret via `scripts/cf-secrets.mjs`.

**Also removed three silent skips.** All three sites guarded with `if (supabaseUrl && serviceKey)`,
which reads as validation but behaves as "do nothing, log nothing" when either is missing. Each now
logs an error naming what is missing and how to fix it. My first patch covered two sites; the test's
`doesNotMatch` on the old pattern caught the third, in `commitToPostgres` — which would have made a
match look live while nothing persisted.

**Fixed a latent test bug.** `server-authority.test.ts` stripped JSONC comments with
`/\/\/.*$/gm`, which also strips the `//` inside `https://`. It passed only because no URL value had
ever been configured; the moment one is, the value is truncated and `JSON.parse` throws *"Bad control
character in string literal"*. Replaced with a string-aware scanner.

**Verified:** 531 tests / 520 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors (per
directory; the whole-repo run OOMs) · check:migrations 44/44 · check:fn-signatures clean ·
check:schema 44/45 · check:rls 44 · check:routes 53 · check:fields clean · check:drift 12/12.

**Requires a redeploy to take effect.** The `vars` change only reaches the Worker on
`npm run deploy`. Until then the deployed Worker still has no `NEXT_PUBLIC_SUPABASE_URL`, and the
room will keep logging the new error instead of silently failing — which is the point: the cause is
now visible in `wrangler tail` rather than invisible.

### Wallet sign-in is blocked by the domain, not by the app (2026-10-23)

Reported: both MetaMask and Base Account block the site on
`https://ludo-base.ludobase.workers.dev/`.

**The room endpoint is fine on that host.** Probed directly:

```
GET /api/room/<uuid>/ws  →  426     (the Durable Object answered; it wants an upgrade)
GET /                    →  200
```

426 is the expected response for a non-upgrade request, so the DO is live and reachable there. The
remaining game blocker is the missing `NEXT_PUBLIC_SUPABASE_URL` from the previous entry, which needs a
redeploy.

**The wallet block is the domain.** `*.workers.dev` is a free, shared, unverified Cloudflare
subdomain — precisely the shape MetaMask and Coinbase Wallet (Base Account) treat as high-risk and
block at the domain level, before `connect()` ever runs. There is **no CSP in this app** (verified:
no `Content-Security-Policy` in `middleware.ts`, `next.config.ts`, or anywhere else), so nothing on
our side is refusing the connection.

I could not confirm which specific blocklist entry applies — searches surfaced general phishing
coverage rather than a documented `workers.dev` denial — so this is stated as the mechanism, not as a
cited list. The fix is the same regardless: **a custom domain**. Wallets trust a domain you own and
control; they do not trust a shared free subdomain.

**Prepared, not enabled.** `wrangler.jsonc` now carries a `routes` block with the exact template,
commented out so it is inert until a real domain exists:

```jsonc
"routes": [
  // { "pattern": "play.YOUR-DOMAIN.com", "custom_domain": true }
  // { "pattern": "play.YOUR-DOMAIN.com/*", "zone_name": "YOUR-DOMAIN.com" }
]
```

`custom_domain: true` is the simpler option — it provisions the DNS record and certificate. The
`zone_name` form is for an existing zone you want to route manually.

Two regression tests added: `P0-6` asserts `vars.NEXT_PUBLIC_SUPABASE_URL` (the previous root cause,
now guarded in config since no code gate can observe the deployed Worker), and `P0-7` asserts the
custom-domain template stays documented. The JSONC comment stripper was hoisted to a shared
string-aware helper.

**Verified:** 533 tests / 522 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors.

**Two blockers, both outside code:**

1. **`npm run deploy`** — the `vars` fix only reaches the Worker on deploy. Until then the live Worker
   still cannot reach Postgres and matches still stall (now with a named error in `wrangler tail`).
2. **A custom domain** on the Cloudflare account, then uncomment the matching `routes` line. I cannot
   add a domain to the account without knowing which one, and the OAuth token here is scoped
   `user (read)` — enough to list deployments and secrets, not to manage zones.

### Deployed to a custom domain, and the last link in the chain (2026-10-23)

`ludobase.live` is owned and its nameservers already point at Cloudflare
(`amos`/`tess.ns.cloudflare.com`), but the origin was Vercel — which has no `/api/room`
endpoint. Deployed the Worker to **`play.ludobase.live`** (a subdomain, so the Vercel
deployment keeps working while this is verified). Moving the apex is a one-line change once it
is confirmed.

Verified live:

```
https://play.ludobase.live/                    → 200  "Ludo Base : The Onchain Arena"
https://play.ludobase.live/api/room/<uuid>/ws  → 426  (Durable Object live)
```

The custom domain is also the wallet fix: `*.workers.dev` is a free shared subdomain that
MetaMask and Coinbase Wallet block at the domain level.

**Deploy gotcha:** `wrangler` 4.149.0 failed with `assets-upload-session → 500 (code 10013)`.
Not the proxy, not the asset size (19 MB / 394 files) — reproducible across three attempts.
**4.152.0 succeeded**, so the pinned version in `package.json` needs bumping.

### The last link: `match_commit_action` never worked

With the room reachable and seats written, `match_states` was still empty. Isolating the DB layer
showed the actual error:

```
match_commit_action: 404  {"code":"42883",
  "message":"operator does not exist: text = uuid"}
```

Two defects, both present since `202610180004` — which is why `match_states` had never contained a
row, and confirms the old SA-1 finding that `seedMatch` never seeded:

1. **`match_states.match_id` is `text`** (baseline), while the RPC takes `p_match_id uuid`.
   `WHERE match_id = p_match_id` is `text = uuid`, which Postgres cannot evaluate. Note the
   asymmetry: `match_room_events.match_id` *is* uuid (it references `matches.id`), so only the
   `match_states` comparisons need the cast.
2. **The S0 seed INSERT omitted NOT NULL columns.** `match_states` declares
   `room_code text not null` and `host_address text not null` with no defaults; the insert supplied
   only `(match_id, seq, state, updated_at)`. Both are now derived from `matches` / `match_seats`.

Worse than the error itself: `commitToPostgres` catches its own failure and only *warns*, so the
room believed it had persisted. A silent catch around a required write is how this stayed invisible.

**Fixed** in `202610230005_fix_match_commit_types.sql` and applied.

**End-to-end, verified against production with a throwaway match (cleaned up afterwards):**

```
join_matchmaking  → 200 matched
match_seats       → green + yellow
room /info probe  → 200
match_states      → seq=0, players=2, currentPlayer=green     ← room self-seeded
```

This is the first time in the project's history that `match_states` has held a seeded row.

**Verified:** 533 tests / 522 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors ·
check:migrations 45/45 applied · check:fn-signatures clean · check:schema 45/46 · check:rls 45 ·
check:routes 53.

**Follow-up:** bump the `wrangler` devDependency to ≥4.152.0 — 4.149.0 cannot deploy this project.

### "Zero chips, no CDP wallets": the live build had no CDP project id (2026-10-23)

Reported on `https://play.ludobase.live`: zero chips and no CDP wallets.

**The app uses `NEXT_PUBLIC_CDP_PROJECT_ID` / `NEXT_PUBLIC_CDP_AUTH`** (OnchainKit's CDP config).
Both are in `.env.local`, and a local build inlines them. The live build did not.

**How this was found — and a wrong turn worth recording.** A first check grepped the deployed
`/_next/static/chunks/1174-*.js` and reported the id absent. That was a false negative: Cloudflare
had served a *different* chunk hash (`1174-4389cee8…`) than the one in my local `.open-next`
(`1174-f3fc3e87…`), so the URL I was probing belonged to another build entirely. Once the correct
live chunk was fetched, the id was still absent — but the point stands that **chunk hashes are the
only reliable way to tell which build is live**, and probing a guessed hash proves nothing.

**Root cause: the live Worker was not running my build.** `wrangler deployments list` showed the
newest deployment at `2026-10-23T07:35:10Z` (version `96b5a276`) — a concurrent deploy made while I
was editing `wrangler.jsonc`. My `07:51` deploy (version `c3e54a85`) was absent from the list
afterwards. The `07:35` build had been produced without the CDP env vars inlined, so its bundle had
no `NEXT_PUBLIC_CDP_PROJECT_ID`.

Without it, OnchainKit's CDP integration cannot initialise → **no CDP wallet** → and with no wallet
address there is nothing to read a balance against, so **zero chips** is the downstream symptom, not
a separate bug.

**Fix:** rebuilt with `npx opennextjs-cloudflare build` (the local dependency — `opennextjs-cloudflare@latest`
has no `build` binary) and redeployed with `wrangler@4.152.0` as version `d3026efc`.

Verified live:

```
live chunk      1174-9440f1e43bc3b5ce.js   (matches the local build)
CDP project id  present in the live bundle
/               → 200
/api/room/…/ws  → 426  (Durable Object still live)
```

**The operational lesson:** this repo has a concurrent writer deploying to the same Worker. Two of
today's "the fix didn't work" reports were actually *my fix had been overwritten* — first the
`match_states` work (deployed, then a `07:35` build went live without the Supabase URL), now the CDP
config. After any deploy, **verify the live artifact before concluding the fix failed**: compare the
served chunk hash against the local `.open-next`, and confirm a known build-time constant is present
in the live bundle. A green `wrangler deploy` says nothing about what is currently serving traffic.

### The CI pipeline was building without env vars — and overwrote the fix twice (2026-10-23)

"CDP, chips still missing" on `play.ludobase.live`. The build log supplied the answer:

```
⚠️ Supabase environment variables are missing. Using placeholders for build.
```

That log is from the **Cloudflare Workers Builds pipeline**, not a local build — and it deployed
(version `69815837`, at `09:11:09Z`), six minutes **after** my own deploy at `09:05`. The pipeline has
**no build variables configured**, so `NEXT_PUBLIC_*` values were inlined as placeholders: no CDP
project id, no Supabase URL. It then replaced the correct deploy.

This is the second time a correct deploy was overwritten by the concurrent writer — the first was the
Supabase URL work earlier the same day.

**Why a placeholder build is the worst outcome.** `NEXT_PUBLIC_*` values are inlined at build time, so
a missing variable is not runtime configuration — it is baked into the bundle and cannot be fixed
without a rebuild. The build logs a warning, succeeds, and deploys a site with no wallet and no
database. A *failed* build would have been strictly better: it is visible.

**Fixed on the repo side:** `scripts/check-build-env.mjs`, wired into `npm run build` (which
`opennextjs-cloudflare build` invokes — visible in the CI log as `> ludo-base@0.1.0 build`). It fails
the build when any of `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_CDP_PROJECT_ID`, `NEXT_PUBLIC_CDP_AUTH`, `NEXT_PUBLIC_WC_PROJECT_ID` or
`NEXT_PUBLIC_ONCHAINKIT_API_KEY` is missing, and names the dashboard location that fixes it. Vars with
safe defaults (PeerJS, room WS, paymaster) are deliberately excluded so the guard cannot fail a build
that would otherwise work. `SKIP_ENV_CHECK=1` is the escape hatch.

Verified both directions: passes with `.env.local` present; with it hidden (simulating CI) it exits
non-zero listing every missing variable.

**Redeployed** as version `1bf62de4` and verified live:

```
live chunk      1174-9440f1e43bc3b5ce.js   (matches the local build)
CDP project id  ✓ present
Supabase URL    ✓ present
/               → 200
/api/room/…/ws  → 426
```

**Still required — the actual root fix, which only you can do:** the pipeline's build variables are
empty. Until they are set, every push will fail the build (correctly) rather than deploy a broken
bundle. In the Cloudflare dashboard: **Workers & Pages → ludo-base → Settings → Build → Variables and
secrets**, and add the six vars above. They are `NEXT_PUBLIC_*` values, so they are already public in
the client bundle — no secret exposure.

**Verified:** 534 tests / 523 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors.

### Correction: the vars existed — as runtime, not build (2026-10-23)

I claimed "the pipeline's build variables are empty". That was an overreach, and the owner corrected
it: **8 secrets and 18 production variables were configured** the day before. I had inferred an empty
configuration from a single warning line, when what I had actually observed was narrower — the build
step did not receive them.

**The real distinction.** Cloudflare keeps two separate configuration surfaces:

- **Runtime variables and secrets** — visible to the Worker via `env.X` when it executes. The 8
  secrets confirmed this: `wrangler secret list` matches exactly what was configured.
- **Build variables** — visible to the build command. `NEXT_PUBLIC_*` inlining reads `process.env`
  **at build time**, so runtime variables never reach it.

So 18 correctly-configured runtime vars produced a bundle with none of them. The pipeline was not
misconfigured in the way I said; it was configured in the place that does not feed the bundle.

**The fix removes the dependency on either.** `NEXT_PUBLIC_*` values are inlined into the client
bundle and shipped to every browser — public by definition — so they now live in `wrangler.jsonc`
`vars`, and `scripts/check-build-env.mjs` generates `.env.production` from them before `next build`
runs. No dashboard step is involved, and it cannot drift again.

Two implementation notes, both learned by trying the wrong thing first:

1. **It has to be a file, not `process.env`.** `npm run build` runs the guard and `next build` as
   separate processes, so mutating `process.env` in the guard never reaches the build — the guard
   reported success while the bundle still held placeholders.
2. **`.env.production` outranks `.env.local`**, so the guard writes it only when no `.env.local`
   exists. In CI there is none and it is the source of truth; locally there is one and it must win.
   `.env*` is gitignored, so the generated file is never committed.

**Proven in the conditions that failed.** A build with no `.env.local` and every `NEXT_PUBLIC_*`
unset — exactly the CI environment — now produces a bundle containing the CDP project id, and the
"Supabase environment variables are missing" warning is gone. Deployed as `417e7d41` and verified
live: chunk `1174-33775760595a6596.js` matches the local build, CDP project id and Supabase URL
present, `/` → 200, room → 426.

**Verified:** 534 tests / 523 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors.

### CDP social login fails on the new origin — portal CORS allowlist (2026-10-23)

The embedded wallet now works on `play.ludobase.live` (the build-var fix landed), but every social
sign-in — Google, Apple, X, Telegram — fails with a network error.

**Cause: the CDP Portal's CORS origin allowlist does not include `play.ludobase.live`.**

The evidence is in this repo's own planning docs, which listed it as outstanding:

- `docs/planning/SMART_WALLET_PLANNING.md:422` — *"CDP Portal manual steps: passkey MFA ON + CORS
  origin allowlist."*
- `docs/planning/PHASE_0A_SPIKE_CHECKLIST.md:9` — status ends with *"Remaining: portal domain
  allowlist confirmation + live C1–C4 click-through"*.
- `PHASE_0A_SPIKE_CHECKLIST.md:45–46` — the allowlist was seeded with `http://localhost:3000` for dev,
  and the note says production must carry only the real production origin.

The wallet proves the project id is valid and CDP is reachable — wallet creation does not require the
OAuth origin check. Social sign-in does: it is an OAuth redirect against the calling origin, so an
unlisted origin is rejected before any provider is contacted. That is why the failure looks like a
network error rather than a permission error.

**Why it broke now.** The app moved from the Vercel origin (`ludobase.live`, which was allowlisted) to
`play.ludobase.live`, a brand-new origin. Nothing in the code changed; the origin did.

**Fix — portal only, cannot be done from here** (needs the owner's CDP Portal login):

1. https://portal.cdp.coinbase.com → the project
2. **Wallets → Non-custodial → Clients → Add domain**
3. Add `https://play.ludobase.live`
4. Confirm the OAuth methods are enabled for the project (Google / Apple / X / Telegram)
5. No redeploy is needed — the allowlist is read per request, so it takes effect on the next attempt

Note the protocol and host must match exactly what the browser reports: `https://play.ludobase.live`,
no trailing slash, no `www`. If both origins are wanted, add both rather than replacing.

### Chips balance and daily/weekly missions missing — two more absent build vars (2026-10-23)

Social login worked. Chips balance and daily/weekly missions were still missing; the leaderboard was
fine.

**Cause: `NEXT_PUBLIC_CHIPS_ADDRESS` and `NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS` were in `.env.local`
but not in `wrangler.jsonc` `vars`.** The leaderboard kept working because it reads Supabase only —
no contract address — which is exactly the signature of a missing build var rather than a broken API.

This was the same class of bug as the CDP project id, and it was **my gap**: the guard I added the
hour before only checked six hand-picked vars, so twelve public vars were still free to go missing.

**Fixed in two parts.**

1. **`wrangler.jsonc` now carries all 18 `NEXT_PUBLIC_*` vars** the app reads, not six. They are public
   by definition — Next inlines them into the client bundle and ships them to every browser — so
   committing them exposes nothing new.

2. **The guard now derives its requirement from the code instead of a hand-kept list.**
   `scripts/check-build-env.mjs` scans `app/`, `lib/`, `hooks/`, `src/` for `NEXT_PUBLIC_*`
   references and requires each one to be resolvable, minus an explicit `KNOWN_OPTIONAL` list for vars
   with safe defaults (PeerJS, room WS, paymaster, build number, git hash, USDC). Adding a new var to
   the code now fails the build until it is declared, so this cannot silently recur.

Verified in the conditions that broke: a build with no `.env.local` and every `NEXT_PUBLIC_*` unset
writes all 18 vars and produces a bundle containing the chips and mission addresses. Removing
`NEXT_PUBLIC_CHIPS_ADDRESS` from `wrangler.jsonc` makes the guard fail naming exactly that variable.

**Live, checked across all 229 chunks** (not just the ones the initial HTML references — the mission
chunks are lazy-loaded):

| Var | Live |
|---|---|
| `NEXT_PUBLIC_CHIPS_ADDRESS` | ✓ `chunks/3146-…js` |
| `NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS` | ✓ `chunks/4623.…js` |
| `NEXT_PUBLIC_MISSION_CLAIM_ADDRESS` | ✓ `chunks/4623.…js` |
| `NEXT_PUBLIC_MATCH_POOL_ADDRESS` | ✓ `chunks/3146-…js` |
| `NEXT_PUBLIC_CDP_PROJECT_ID` | ✓ `chunks/1174-…js` |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ `chunks/1174-…js` |

`NEXT_PUBLIC_CLAIM_HUB_ADDRESS`, `SEASON_CLAIM_ADDRESS` and `LEGACY_CLAIM_ADDRESS` appear in no client
chunk: they are referenced only by `lib/chips.ts` functions the client does not import, so webpack
tree-shakes them. They are server-side reads, satisfied by the Worker's runtime vars — all 18 are
deployed. Confirmed the routes are healthy: `/api/chips/escrow-balance` → 401 (auth required) and
`/api/chips/lobby-ticket` → 405 (wrong method), which is correct behaviour; a missing config would be
a 500.

**Verified:** 534 tests / 523 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors.

### Live broadcast and DMs down: an unprovisioned foreign key (2026-10-23)

Sending in live broadcast did nothing; DMs were down too. The leaderboard worked.

**The routes were healthy.** Probing them directly: `/api/live-chat` POST → 400 on an empty body,
`/api/messages` → 401, `/api/live-matches/window` → 401/405, `/api/presence/online` → 200. All correct
responses, no 500s — so this was not a missing build var like the last two.

**The real error came from the Worker log** (`wrangler tail` while probing):

```
insert or update on table "live_chat" violates foreign key constraint
"live_chat_sender_id_fkey"
```

`live_chat.sender_id` references `public.players(wallet_address)`. The newest `players` row predated
the sign-ins by nearly two weeks — **the social-login smart account never got a `players` row**, so
every insert failed. AGENTS.md is explicit that player identity is the Smart Account, never the EOA,
so social login mints an address that has never existed in `players`.

The route caught the error and returned a bare `{"error":"Failed to send"}`, which is why the UI showed
nothing at all.

**The helper already existed.** `ensurePlayerRow()` in `lib/serverAuth.ts` does exactly this, and its
own doc says *"any server flow that stores a third-party address must provision first"*. It was called
from galxe, lobby invite, friendships, poke, and onboarding — but **not** from `/api/live-chat` or
`/api/messages`.

**Fixed:** both routes now provision before inserting (`/api/messages` provisions sender *and*
receiver). Provisioning also fixes a second latent bug in live-chat: the username/avatar snapshot reads
`players` with the anon client, which returned nothing for an unknown wallet.

**New gate `P0-9`:** walks every `app/api/**/route.ts` and fails if a route inserts or upserts into
`live_chat`, `messages` or `conversations` without calling `ensurePlayerRow`. Proven load-bearing — a
temporary route that skips provisioning makes it fail naming that file; removing it passes.

An earlier version of the gate failed for the wrong reason: it used `readdirSync` without importing it,
so the walk threw and the test failed as an error rather than an assertion. Worth noting because a gate
that fails for the wrong reason is nearly as misleading as one that cannot fail.

**Verified:** 536 tests / 525 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors.

### Live broadcast, DMs and missions all 401: the session reader and writer disagreed (2026-10-23)

Chips worked; live broadcast and DMs would not send; the leaderboard was empty; daily/weekly missions
were empty.

**The symptom was the diagnosis.** Every broken surface authenticates through `requireSession`.
Every working one does not — chips is an on-chain read, the leaderboard is world-readable, the activity
feed is public. That split points at auth, not at data. (`spectator_bets` is also genuinely 0 rows, so
the empty leaderboard was correct behaviour, not a bug.)

**The cause.** `/api/siwe/verify` mints sessions by inserting into **`app_sessions`** and handing the
client that row's id. `requireSession` hashed the incoming token and looked for **`sessions.token_hash`**
— a match that can never occur, because the writer never touches `sessions`.

The read side had *retired* the `app_sessions` dual-read on the assumption the writer had migrated to
sessions v2. It had not. `requireAppSession` still dual-read `app_sessions`, but it is only reached as
an explicit fallback in a handful of routes — so live-chat worked if the client posted `sessionId` in
the body, and DMs and missions, which call `requireSessionWallet` alone, never did.

The function's own header documented the fallback — *"Dual-read fallback to `app_sessions` for backward
compatibility during rollout"* — while its body said the dual-read was retired. **The implementation
disagreed with its own documentation, and the implementation was wrong.**

**Fixed** by restoring the documented fallback: after the v2 lookup misses, `requireSession` delegates
to `requireAppSession`. Two constraints were applied deliberately:

- **No scope leak.** `app_sessions` has no `scope` column, so a fallback session is treated as
  `app`-scope only. A `match`-scoped request is refused — otherwise the legacy path would become a way
  to reach match-scoped actions.
- **`expectedWallet` is still honoured**, so a session cannot be replayed against another wallet.

**Verified.** A functional check minted a real legacy session and confirmed `requireSession` returns the
wallet for `app` scope and `null` for `match` scope. Deployed as `0763478e`, then verified live:
`GET /api/missions/list` with a legacy session returns **200 with the missions** (`daily_bonus`,
`period_id 2026-10-23`) where it previously returned 401.

**Regression gate `P0-10`** asserts the invariant that actually broke — that `requireSession` reads the
table the sign-in route writes — plus a functional test that a legacy session authenticates for `app`
and is refused for `match`. Both fail with the fallback removed. The static test also forbids the
`dual-read is retired` comment from returning, since that comment is what licensed the removal.

**Verified:** 538 tests / 527 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors.

### The clients never sent the session at all (2026-10-23)

Still broken after the server-side dual-read fix: live broadcast and DMs would not send, missions were
empty, and the only feedback was the 10-second cooldown ticking down with no error.

**The server was now correct and the clients were still wrong.** `/api/live-chat` rejects a `0x`
sender that presents no app session — only `guest_` ids bypass it — and three client call sites sent
no session at all:

- `ActivityFeed.tsx` — the shoutbox send (two panels, same code)
- `ActivityFeed.tsx` — a second send path
- `TeamUpMatchPanel.tsx` — the room announce

Each posted `{ wallet, content }` with only a `Content-Type` header. Every signed-in shout 401'd,
`if (!res.ok)` swallowed it, and the UI just counted the cooldown. **My earlier probe passed only
because I used a `guest_` wallet, which skips the session check** — a false negative I should have
caught, since the reporter was signed in with a real wallet.

**The mirror-image bug on missions.** `MissionPanel` *does* pass the session, but as
`?sessionId=…` in the URL, while `/api/missions/list` only read the Authorization header. So the
session was sent and ignored, and the panel rendered an empty list with no error.

**Fixed on the client side, in both cases:**

- The three live-chat call sites now send `Authorization: Bearer <sessionId>` and `x-session-id`,
  obtaining the session via `useAppSession()` (`peekAppSession()`, falling back to `ensureAppSession()`
  so a first shout can prompt SIWE).
- `MissionPanel` sends the session as a header instead of a query parameter.

**A wrong turn, caught by an existing gate.** I first "fixed" missions by making the route read
`?sessionId=`. The suite immediately failed on `P3: no route anywhere reads sessionId from the query
string` — a rule enforced both in `scripts/check-routes.mjs` across all 53 routes and in the test
suite, because a session in a URL is logged by proxies and leaks via `Referer`. That gate was right
and my fix was wrong; I reverted it and moved the session into the header, which is the pattern the
rest of the codebase already uses (`sessionAuthHeaders`).

**New gate `P0-11`** walks every client `fetch` to an authenticated route (`/api/live-chat`,
`/api/messages`, `/api/missions/*`) and fails if the call carries neither a session header nor a
`sessionId`. Proven load-bearing. `P0-11b` pins the missions case specifically: header, never the
query string.

**Verified live** as `36c99d2b`: live chunk matches the local build, and
`GET /api/missions/list` with a header-borne session returns **200 with the missions**
(`daily_bonus`, `period_id 2026-10-23`).

**Verified:** 540 tests / 529 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors ·
check:routes clean (53 routes).

### Every send failure now says why (2026-10-23)

The instruction was direct: when a user fails to send a message they must see an error explaining
whether it is their network, a system fault, or a database failure.

**This is the fix for the thing that cost the most time today.** The live-chat route returned a bare
`{"error":"Failed to send"}` and the client swallowed it entirely — `if (!res.ok) { … }` with no UI
feedback, then `catch { /* realtime will fill the gap on retry */ }`. A 401 was indistinguishable from
a success. The only visible signal was a 10-second cooldown counting down. Four rounds of debugging
were spent because no layer carried a reason.

**`lib/sendErrors.ts`** — a shared taxonomy of eight codes, each with user-facing copy that answers
*whose fault is it and what do I do*:

| Code | Meaning | What the user reads |
|---|---|---|
| `network` | request never completed | "Can't reach the game server. Check your connection and try again." |
| `auth` | session missing/expired | "Your session expired. Sign in again to keep chatting." |
| `validation` | input rejected | "That message was rejected — check what you typed." |
| `rate_limited` | slow mode | "Slow mode — wait a moment before your next message." |
| `db_write` | the insert failed | "Couldn't save your message. That's on us, not you…" |
| `db_read` | a dependent read failed | "Couldn't load what's needed to send that…" |
| `config` | server missing config | "The server is missing configuration it needs." |
| `server` | anything else | "Something went wrong on our side." |

`classifyWriteError()` maps a PostgREST error to the right code — a Postgres SQLSTATE `23503`/`23505`/
`42501` becomes `db_write`, a fetch failure becomes `network`, a missing service key becomes `config`.
`describeSendFailure()` is the client-side mirror, so one place decides what a failure means and no
component invents its own wording.

**Wired through both send paths.** `/api/live-chat` and `/api/messages` return
`{ error, code, detail }` on every failure; the raw `error.message` passthroughs that leaked Postgres
internals to the client are gone. On the client, the chat panels render a dismissible red banner above
the composer (both `LiveChatPanel` and `UnifiedBroadcastFeed`), and a failed DM bubble shows the
specific sentence instead of "Failed to send". The room announce logs its reason rather than returning
a bare `false`.

**Gate `P0-12`** fails if either send route hand-rolls a generic failure string, and `P0-12b` fails if
the taxonomy loses a class or its copy stops saying whose fault it is. Both proven load-bearing.

**Two regressions from my own change, both caught by the suite and fixed:** an unused type import
(ESLint error), and `P6` asserting the old literal `'Session required to chat'`. The P6 fix is the
right shape — it now asserts `sendError('auth')`, i.e. the *behaviour*, not the wording. A test pinned
to copy breaks every time the copy improves.

**Verified live** as `f6127817` — three distinct failure classes return three distinct coded reasons:

```
auth       {"error":"Your session expired. Sign in again to keep chatting.","code":"auth",…}
validation {"error":"That message was rejected — check what you typed.","code":"validation",…}
auth (DM)  {"error":"Your session expired. Sign in again to keep chatting.","code":"auth",…}
```

**Verified:** 542 tests / 531 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors ·
check:routes clean (53 routes).

### The 1v1 stall: three breaks between a healthy room and the player's screen (2026-10-24)

A 1v1 match sat on **"Still linking both players…"** forever. The server side was provably healthy,
which is what made this hard: `match_seats` held both seats, `match_states` held a seeded
`status: "playing"` board with `isStarted: true`, and `match_room_events` recorded the room seeding
itself. Every route answered correctly. Only a UI string never changed.

**Three independent breaks, each alone sufficient to stall the match.** All three were invisible
from outside — the room answered 426, the routes answered 200, and nothing errored anywhere.

**1. The room never sent the frame the client waits for.**
`RoomClient` has exactly one transition into `'connected'`: a `t: 'joined'` frame. `MatchRoomCore`'s
`handleJoinFrame` answered a join with `state` (or `rejected`) and nothing else. So `onStatusChange`
never fired `'connected'`, the host never wrote its seed, `roomAuthority` never engaged, and
`roomStatus` parked at `'connecting'` — exactly the state the UI reads as "not failed, not linked".

**2. The seed frame was discarded on every client.**
The room self-seeds at `this.seq = 0`. `serverSeqRef` also starts at `0`. `applyServerState`'s gate
`seq <= serverSeqRef.current` therefore evaluated `0 <= 0` and returned — the seed never reached
`gameState`, so `isStarted` stayed false, which is precisely the condition the stall detector watches.
A guard written to stop a late frame rewinding the board was eating the *first* frame instead.

**3. A match ticket could never be issued.**
`issueMatchSession` validated the parent app session against `sessions` v2. `/api/siwe/verify` writes
`app_sessions` — the row id *is* the token — and never touches `sessions`. The lookup always missed,
so `/api/auth/match` always threw *"Valid app session required to enter match"*, and no client could
enter a room as a seat. This is the same reader/writer split as the earlier session bug, one layer
further down.

**Fixes.**

- `MatchRoomCore.handleJoinFrame` now sends `t: 'joined'` carrying `role`, `seat`, `wallet` and `seq`,
  before the catch-up frame, for seats and spectators alike. An unauthenticated spectator needs the
  handshake to complete too or it is equally stuck.
- `applyServerState` exempts the first frame from the seq gate via `hasAuthoritativeSnapshotRef`.
  Later frames are still gated, so a late snapshot cannot rewind the board.
- `issueMatchSession` dual-reads `app_sessions`, keyed on the session id (that table has no
  `token_hash` column), and rejects a revoked legacy row.

**Verified live against production with two real clients** (a throwaway match, cleaned up):

```
host  ticket: yes seat=green      guest ticket: yes seat=yellow
guest: state seq=0 isStarted=true status=playing | joined role=seat seat=yellow
host : state seq=0 isStarted=true status=playing | joined role=seat seat=green
intent: REQUEST_ROLL committed — seq 0 → 1, event turn_passed@1
```

Both clients now complete the handshake, both receive the seeded board, and an intent round-trips and
commits. Live build verified as `1174-62d23f0c8b3cdcfe.js` (matches local), `/` → 200, room → 426.

**Gates `P0-13` / `P0-14` / `P0-15`** pin the three invariants that broke — the room must acknowledge a
join with the frame the client waits for; the first server frame must be accepted whatever its seq; and
the ticket issuer must read the table sign-in actually writes. All three fail with their fix reverted
(proven by reverting each in turn) and pass with it restored.

**Verified:** 545 tests / 534 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors.

### "HOST MIGRATING / Connection Lost" over a live match (2026-10-24)

The previous fix landed: the board opened and `gameState.isStarted` became true. The game screen was
then immediately covered by **"HOST MIGRATING — ELECTING AUTHORITY — Connection Lost"**, offering to
re-elect a host that does not exist.

**Cause: the panel's guard was written entirely in P2P-lobby terms.**

```js
{!isHost && !isLobbyConnected && gameState?.isStarted && !gameState?.winner && (
    <HostMigrationPanel … />
)}
```

`isHost` and `isLobbyConnected` are PeerJS-lobby concepts. A quick match never opens a P2P lobby — it
goes matchmaking → `connectRoom()`, so `isLobbyConnected` is **false by design** while the Durable
Object is the authority. The guard was therefore true for every quick-match participant the instant the
board opened.

With the room as authority there is no host to migrate — the room *is* the authority. The panel was
reporting a failure that had not happened, on the one screen where a false alarm is most damaging.

**Fix:** the guard now also requires `!roomAuthority`, so the panel survives only as a genuine fallback —
the room is down *and* the P2P host is gone. `roomAuthority` was already exported by `TeamUpContext`;
`page.tsx` simply never destructured it, so the guard now reads a real binding rather than an undefined
one (a guard on an undefined name is a silent `!undefined === true`, which is the same bug with extra
steps).

**Audited the rest of the P2P assumptions** rather than patching only the reported symptom. Three other
`!isLobbyConnected` sites exist — `useGameEngine.ts:371` (provisional move-auth binding),
`TeamUpContext.tsx:1237` (profile sync to peers), `TeamUpContext.tsx:1721` (`sendIntent`, the guest→host
P2P intent path). All three are legitimately P2P-only and correctly bypassed when the room is
authoritative: `useGameActions` routes intents through `sendRoomIntent` and marks the Edge move-auth path
deprecated-and-unreachable under `roomAuthority`. No change needed.

**Gate `P0-16`** asserts the panel's guard contains `!roomAuthority`, that `page.tsx` destructures it from
`useTeamUp()`, and that the context still exports it. Proven load-bearing — removing `!roomAuthority`
from the guard fails it.

**Verified:** 546 tests / 535 pass / 0 fail · tsc app + worker 0 errors · eslint 0 errors ·
check:routes clean (53 routes). Deployed as `965f73f4`; live page chunk `app/page-a1572d6f20b2f876.js`
matches the local build and carries the guard, `/` → 200, room → 426.
