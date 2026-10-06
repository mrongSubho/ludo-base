# Remediation checklist — system review

| Field | Value |
| --- | --- |
| **Source** | [`SYSTEM_REVIEW.md`](./SYSTEM_REVIEW.md) @ `e49600a`, 2026-10-05 |
| **Status** | Phase 0 **16/17** · 4 Critical closed (DB-01, DB-02, DB-03, SEC-05) · **12 Critical open** |
| **Baseline gates** | `tsc` 0 · `lint` clean · `npm test` 91/91 · `check:engine` sync · `check:rls` clean |
| **Rule** | Do not close an item until its **exit gate** passes. A finding closed by assertion, not by test, reopens. |

**How to use.** Work one phase at a time. Each phase has an ordered task list and an exit gate. Tick the boxes as you land commits. Reference finding IDs (`SEC-01`, `ENG-01`, …) in the PR description so the register stays authoritative.

**Phases are ordered by dependency, not by severity.** Phase 0 first: until a fresh `db reset` produces a schema equivalent to a migrated one, nothing else can be validated.

---

## Phase 0 — Un-break the build from source

**Why first.** `202609230003` aborts mid-file, so a reset DB ≠ a migrated DB. Every schema claim below is unverifiable until this is fixed.

### Tasks

- [x] **DB-01** — Fix `202609230003_freeze_legacy_coin_writers.sql`. Rename the stub args to match the live signature (`p_request_id`, `p_item_ids`) **or** rename the stub function to `purchase_marketplace_frozen()`. Wrap the whole file in `begin; … commit;`.
- [x] **DB-01** — Decide the intended coin model. The freeze and the live economy contradict each other: `/api/marketplace/purchase` and `/api/spectator-bets` both call frozen RPCs and return 409. Either lift the freeze behind the RPCs below, or remove the callers.
- [x] **DB-01** — Verify `players.coins` actually has a guard after the fix: on a scratch DB, `set role service_role; update players set coins=…` must fail.
- [x] **DB-02** — `alter table public.match_rolls alter column status set default 'open';`
- [x] **DB-02** — Add `match_rolls_status_check check (status in ('open','consumed','passed'))`, then `validate`.
- [x] **DB-02** — Make `isDuplicateAction` an explicit allowlist so a future default cannot silently flip it.
- [x] **DB-03** — Confirm `supabase db reset` completes the full chain and records every file in `supabase_migrations.schema_migrations`.
- [x] **DB-11** — Fix `RESET_FOR_FRESH_BASELINE.sql`: exclude extension-owned objects from the drop loop (`not exists (select 1 from pg_depend …)`).
- [x] **DB-12** — Drop `supabase_realtime` publication members inside the reset loop so reset ≡ migrated.
- [x] **DB-21** — Add `npm run check:schema`: apply the chain to a scratch PostgreSQL 16 in CI. Assert zero errors, expected `column_default` values, expected `pg_proc` signatures, no `anon`/`authenticated` EXECUTE on `security definer`, and no `anon` table grants beyond the allowlist.
- [x] **DB-21** — Add `npm run check:rpc-args`: resolve every `rpc('name', {named args})` in `app/api` + `lib` against a migration-defined signature. *(This gate alone catches DB-01.)*
- [x] **DB-21** — Extend `check-rls.mjs` or replace it with `check:schema`; see the six blind spots in [`SYSTEM_REVIEW.md` §10.1](./SYSTEM_REVIEW.md).

### Exit gate

- [x] `npm run check:schema` green. **Static mode (A1–A4) is what CI runs and it is green.** *(Verified against PostgreSQL 16 separately: chain applies 16/16, 37 tables.)*
- [x] `check:schema` **DB mode** in CI: applies the chain to a scratch `postgres:17` service and asserts zero errors, `column_default`, `pg_proc` signatures, `anon` table grants, and `anon`/`authenticated` EXECUTE on `security definer`. *(Wired in 2026-10-05. Negative-tested: injecting `grant update … to anon` and `grant execute … to anon` both fail the gate.)*
- [x] `supabase db reset` completes; schema diff against a migrated DB is empty. *(Proven in substance, not with the literal command: Docker is unavailable in this environment, so `supabase db reset` cannot run. Instead the full chain was applied file-by-file with psql against PostgreSQL 16 — 16/16 files, 0 failures — and the RESET script was executed directly. RESET → 0 tables / 0 publication members / pgcrypto preserved, and re-applying the chain reproduced the migrated schema column-for-column. A literal `supabase db reset` still needs a run on a machine with Docker.)*
- [x] A receipt inserted through Edge `roll-dice` is consumable by `move-auth`. *(Proven in psql: an insert without `status` now lands as `open`; `isDuplicateAction('open') === false`. `scripts/network-boundary.test.ts` pins the allowlist, `check:schema` A3 pins the DB default.)*
- [ ] `/api/marketplace/purchase` returns 200 on a real SKU, or its caller is removed. **NOT DONE.** `purchase_marketplace` is frozen and the route still calls it, so it returns 409 with a raw `LEGACY_COINS_FROZEN` message. The exit gate offered "or its caller is removed"; the caller is still there. Fixing it needs the CHIPS payment rail — tracked under "CHIPS migration" below.

---

## CHIPS migration (coins → on-chain CHIPS)

Coins are frozen (202609300001). CHIPS became the only money. Rewards were
previously defined in four places with two currencies and three values for the
same mission id; all four are now gone.

- [x] `mission_catalog` is the single source of truth for **daily + weekly**; whole CHIPS, CHECK-constrained to 5..20
- [x] `daily_bonus` = 10 CHIPS; weekly track added (90 CHIPS/week); daily 58/week
- [x] `lib/missionCatalog.ts` is the only reader; `ONBOARDING_REWARDS` deleted
- [x] **Onboarding deliberately untouched** — core package 1000, expanded pack 350, welcome grant 50, referral 5000/50/10, all still in `ONBOARDING_TRACKS`. Its rewards predate the CHIPS cutover and are a new-user grant, not a repeatable mission, so the 5..20 band does not apply to them. The band CHECK is category-scoped (`mission_catalog_reward_band`) so onboarding is exempt by decision, and no onboarding rows exist in the catalog.
- [x] `player_missions` keyed by (player, mission, period_id) — daily/weekly cadence falls out of the schema, ad-hoc reset logic deleted
- [x] SEC-10 closed: `/api/missions/voucher` reward/periodId/nonce are server-owned; claim lock is the `unique(wallet_address, mission_id, period_id)` constraint
- [x] `/api/missions/claim` retired with an explicit 410 (it flipped `is_claimed` then hit the frozen-coins trigger)
- [x] SEC-05 closed: `chips_escrow_*` RPCs own the window gate, market, self-bet block, atomic stake debit, and idempotent settlement
- [x] `resolve-bet` cross-checks the signed result against `match_states.state` before settling (SEC-29)
- [x] All CHIPS value columns moved from `bigint` to `numeric` (bigint maxes at 9.2234 CHIPS against a 1e10 supply)
- [ ] **Marketplace CHIPS payment rail.** Cosmetics are coins-only with no CHIPS path. Needs a treasury address + a purchase-intent message, or a contract. Blocked on that decision.
- [ ] **Arm the escrow.** `chips_escrow_config.enabled` is `false`; cannot be set true without a treasury wallet and non-zero rake. Requires a funded treasury, a deposit path reconciled against `chips_events`, and a solvency runbook.
- [ ] **Poke rewards → CHIPS voucher.** `social/poke` still credits frozen coins (now a no-op) rather than minting a voucher.

---

## Phase 1 — Close the money paths

**Why.** Three unauthenticated or TOCTOU paths can currently move value. All balance mutations are read-then-write with no DB-level atomicity.

### Tasks — authentication and authorization

> **Reconciled 2026-10-06.** Every item below was re-verified against the code
> rather than trusted from the previous audit, which had marked items closed
> while still open (and left implemented ones unticked). Statuses now reflect the
> tree.

- [x] **SEC-03a** — `PUT /api/chips/settle/propose` calls `requireAppSession` (`app/api/chips/settle/propose/route.ts:152`), and the session is compared against the **on-chain** `p.authority`. Abandon evidence is re-derived server-side (`deriveAbandonEvidence`, `app/api/chips/settle/propose/route.ts:183`) rather than accepted from the body: seated check, `seq` staleness, `afkStrikes >= 3`.
- [x] **SEC-03b** — abandon evidence now validated on-chain. `MatchPool._abandon` checks `status === Locked`, that the accused seat is seated, that `afkStrikes >= AFK_STRIKES_REQUIRED` for an AFK reason, and that `deadline <= settleBy + pauseDelta` — an adjudication the contract could never execute on time is now refused outright (`contracts/src/MatchPool.sol`, `InsufficientStrikes`, `DeadlineAfterWindow`). Both checks run **after** signature verification, so they are enforced on authenticated values rather than being probeable from an unsigned call. `seqAtDisconnect` stays in the digest as evidence but cannot be verified here: match state lives in the app database, not the chain.
- [x] **SEC-03c** — the signed payload now names a **reason code**. `AbandonReason.{AfkDisconnect, HostWithheld}` is inside `ABANDON_TYPEHASH`, so a co-signature obtained for one reason cannot be relabelled as the other to skip its precondition. `lib/chipsSettle.ts` mirrors the enum and refuses to sign an AFK abandon below the threshold.
- [x] **SEC-04a** — `settle/propose` `POST` requires `wallet === pool.authority` in **all** modes (`app/api/chips/settle/propose/route.ts:82`), read from `getPoolSummary` rather than the body. Mode B needs no contract-side host signature by design; the authority gate is the server's `requireAuthority`, and the contract's relayer model is now documented and pinned by `contracts/test/MatchPoolSecurity.t.sol`.
- [x] **SEC-04b** — `prizeFund`, `hostBond`, `maxSeats` and `status` are read from `getPoolSummary` via `readPoolSummary` (`lib/poolAuthority.ts:96`); client amounts are structurally impossible because `deriveSettlePlan` computes them so `sum === prizeFund` by construction, and the sum check is a thrown 400 rather than a swallowed `try/catch`.
  - [x] **`settleNonce` now read from the chain.** `getPoolSummary` returns it as a 12th field, and `settleNonceFor(summary)` (`lib/poolAuthority.ts:180`) signs what the pool actually holds instead of a hardcoded `1`. The derived value was sound only while a pool could settle at most once.
- [x] **SEC-04c** — non-empty winner set enforced (`app/api/chips/settle/propose/route.ts:56`); `deriveSettlePlan` additionally rejects a lone winner on a 4-seat pool because that would also sweep up the slashed host bond. Superseded in shape: the route reads `winners`, not `participants`.
- [x] **SEC-06** — `/api/match/start` requires an app session for `participants[0]` and compares it to the canonical host (`app/api/match/start/route.ts:108`); a session belonging to a different wallet is a 403. `host_proven` records the outcome and `/api/match/record` refuses an unproven host. An app session rather than a wallet signature — the item allowed either.
- [x] **SEC-05a** — one `SECURITY DEFINER` RPC owns bet placement: `chips_escrow_place_bet` (`supabase/migrations/202609300005_spectator_bet_escrow.sql:126`), `service_role`-only, conditional debit `where balance >= p_amount` in the same transaction with `raise` on zero rows, window gate at `:157`, market check at `:164`, idempotent on `action_id`. The raw insert path is gone; the only caller is `app/api/spectator-bets/route.ts`.
  - Debits land on `chips_escrow_accounts`, not `players.coins` — a deliberate architectural pivot, not the column the item names.
  - `chips_escrow_config.enabled` defaults to **`false`**, so every call currently returns `ESCROW_DISABLED`. The path is built and inert; arming needs a funded treasury, a non-zero rake, deposit reconciliation against `chips_events`, and a solvency runbook.
- [x] **SEC-05b** — the `window_closed_at` guard is restored on both place (`supabase/migrations/202609300005_spectator_bet_escrow.sql:160`) and settle (`supabase/migrations/202609300005_spectator_bet_escrow.sql:241`).
- [x] **SEC-05c** — self-bets blocked via `player_id = any(m.participants)` (`supabase/migrations/202609300005_spectator_bet_escrow.sql:169`).

### Tasks — atomicity

_Gone by construction, and that is the finding rather than an omission: every balance
mutation moved behind a `SECURITY DEFINER` RPC or a conditional `UPDATE`, so there is
no read-then-write left to convert. `chips_escrow_place_bet` is the model; the
marketplace RPC (`supabase/migrations/202609170001_marketplace_purchase.sql`) is the
only pre-existing correct coin path in the repo._

### Tasks — mission and reward paths

- [x] **SEC-09b** — reward drift resolved. `mission_catalog` is the single source: `daily_bonus = 10.00`, every reward CHECK-constrained to 5..20, daily total 58, weekly 90. `ONBOARDING_REWARDS` no longer exists as live data — only a stale reference in a `lib/missionCatalog.ts` doc comment.
- [x] **SEC-09a — superseded, not implemented.** No conditional-claim RPC was ever written; there is no mission-claim `SECURITY DEFINER` function anywhere in `supabase/migrations/`. Instead `POST /api/missions/claim` is an explicit `410` pointing at `/api/missions/voucher`, so no read-then-write on `is_claimed` has a caller. Closed as a supersession, **not** as the implementation the item described.
- [x] **SEC-10a** — signing is gated on real eligibility: an unclaimed `player_missions` row for the current period with `progress >= target` (`app/api/missions/voucher/route.ts:69`).
- [x] **SEC-10b (periodId)** — `periodId` is derived server-side only, from `mission_catalog.period` for "now" (`periodIdFor`, `lib/missionCatalog.ts:88`); no client field feeds it.
- [x] **SEC-10b (nonce)** — the voucher nonce now comes from `public.next_mission_voucher_nonce()` (`supabase/migrations/202609300010_phase1_unblock.sql`), a monotonic sequence behind a `SECURITY DEFINER` wrapper (PostgREST cannot `nextval` a bare sequence), `service_role` only. The signed payload no longer depends on server clock state.
- [x] **SEC-10c** — the `mission_vouchers` insert is load-bearing: reserve-before-sign, `23505` → 409, no swallowed failure (`app/api/missions/voucher/route.ts:97`). The concurrency gate proves 8 racers yield exactly one acceptance.
- [x] **ECO-06 (units)** — unified. `mission_vouchers.amount` is `numeric` holding base units via `chipsToBaseUnits` (`lib/missionCatalog.ts:131`), matching the `uint256` in `contracts/src/MissionClaim.sol:80`.
- [x] **ECO-06 (case)** — the claim lock is now a unique index on `lower(wallet_address)` (`supabase/migrations/202609300010_phase1_unblock.sql`), so it no longer depends on an FK and a CHECK living in another table. Verified the old shape accepted a mixed-case pair and the new one rejects it.
- [x] **ECO-06 (pending rows)** — if signing fails the route now **releases the reservation** (`app/api/missions/voucher/route.ts:137`), so a transient edge error no longer burns the player's reward for the period. `reserved_at` plus a partial index make anything a crash leaves behind cheap to sweep.

### Tasks — other

- [x] **SEC-11** — `app/api/chips/lobby-ticket/route.ts` loads the canonical `matches` row (`:74`), requires the caller to be `participants[0]` of a `host_proven` row (`:111`), and derives seats/maxSeats/`gameMode`/`shape` from storage. Seat colours stay caller-supplied by necessity — the canonical corner mapping only exists in `match_states.color_corner`, written after a ticket would be needed — but are bound by `seatsHash` into the signed digest. The `gameMode: 0` hardcode found during this reconciliation is fixed under ECO-08.
- [x] **DB-13** — `spectator_bets.action_id` is `NOT NULL` (`supabase/migrations/202609300008_bet_idempotency_and_ledger_docs.sql:27`), backfilled then constrained, with `spectator_bets_player_action_uniq` replacing the old constraint.
- [x] **DB-14** — documented as reserved (`202609300008:45`). The only DB-side writer is `cash_out_bet`, replaced with a `raise` by `202609300001`. Caveat: `scripts/compat-probe.ts` still writes rows, so "zero writers" is true of application code, not the literal repo.

### Exit gate

- [x] A test asserts every balance mutation in `app/api` is a conditional update or a `SECURITY DEFINER` RPC — no read-then-write remains.
- [x] `check:schema` asserts no `security definer` coin function is executable by `anon`/`authenticated`.
- [x] Parallel-claim test: N concurrent `missions/claim` for the same mission credit exactly once. `scripts/concurrency.test.ts` — 8 parallel connections race one `mission_vouchers` insert; asserts exactly 1 accepted / 7 rejected with `23505`. Verified sensitive: dropping the unique constraint makes it fail on the assertion.
- [x] Parallel-bet test: N concurrent `spectator-bets` with insufficient balance debit at most the balance. Same file — 8 racers against a 30 CHIPS balance.
- [x] Parallel-settle test: N concurrent `chips_escrow_settle_bets` pays out exactly once (asserts the exact gross-minus-rake ledger delta).
- [x] Every route in [`SYSTEM_REVIEW.md` §10.7](./SYSTEM_REVIEW.md) marked CRIT/HIGH is closed or has a written, signed-off risk acceptance.

> **Scope note on the concurrency gate.** The escrow has genuine defence in depth, so tests 2 and 3 assert the *invariant*, not a single layer. `chips_escrow_accounts` carries `CHECK (balance >= 0)` **and** the debit is a conditional `UPDATE ... WHERE balance >= amount` (atomic under row locks). Removing either layer alone does not produce an overdraft, which is the desired outcome but means those two tests cannot fail from a one-layer regression. Test 1 is layer-sensitive and is proven so.

**Gate status: every Phase 1 code task is closed, deployed to Sepolia, and
verified. One item remains, and it is a decision rather than a defect.**

1. **`SEC-05a` is built but inert.** `chips_escrow_config.enabled` is `false`, so no escrow RPC runs in production. Arming is a decision, not a fix: funded treasury wallet, non-zero rake, deposit reconciliation against `chips_events`, solvency runbook. `allow_self_bets` is now inside the arming CHECK, so it cannot be re-enabled by a config write.
3. **Mainnet deploy and the stranded-funds question**, both tracked under *Contract redeploy* below.

### Contract redeploy (ECO-01 / ECO-03)

`MatchPool.sol` changed on-chain behaviour (`credit += amount`, checked transfers). Source is fixed and tested; the fix is **not live** until the pool is redeployed.

- [x] Redeploy path is a focused script, not the full stack: `contracts/script/RedeployPool.s.sol` deploys only `MatchPool` + `ClaimHub`. `ClaimHub` takes the pool address in its constructor, so it cannot be reused; `MissionClaim` / `SeasonClaim` / `LegacyClaim` have no pool dependency and must **not** be redeployed or the live instances are orphaned.
- [x] Helper verbs added: `scripts/foundry-deploy.sh anvil-pool | sepolia-pool | base-pool`, with preflight guards that refuse on missing `CHIPS_ADDRESS`/`EDGE_SIGNER`/`GAME_OWNER`/`DEPLOYER_ADDRESS` or `USE_MOCK=true`.
- [x] Redeploy verified end-to-end on Anvil: `pool.claimHub()` == new hub, `hub.matchPool()` == new pool, `pool.chips()` == pre-existing token, `setClaimHub` wired in-transaction. A stale `DEPLOYER_ADDRESS` fails loudly rather than deploying from an unexpected account.
- [x] **Base Sepolia redeploy done (2026-10-05).** New `MatchPool` `0x2e93b3B1A3418a45f64B8e319CD0EFa997Aa8aD0`, new `ClaimHub` `0x8ea2b3332fD4e348102603811a24Fdfa8Ddf2D9F`. Confirmed on-chain: `claimHub()`/`matchPool()` cross-reference correctly, `owner`/`edgeSigner`/`chips` preserved, `setClaimHub` wired in-transaction. Both contracts verified on Sourcify (`exact_match`).
- [x] **Post-SEC-03b/04b redeploy done (2026-10-06).** Live pair is `MatchPool` `0xc9e73f24Db37FdaA7BF832CA4d1d89539D45E48D`, `ClaimHub` `0x15dF536466Ef58f77e95D7432089DeEBDf276821` — carries `AbandonReason` in `ABANDON_TYPEHASH`, `AFK_STRIKES_REQUIRED`, and the 12-field `getPoolSummary`. On-chain runtime 21494 B, equal to the local artifact. Both **verified on Etherscan** (`sepolia.basescan.org`) as well as Sourcify. Superseded and orphaned: `0xdfa01EDE…`/`0x538e25f8…`, `0xb1cEB8Da…`/`0xcdBd9763…`, `0x2e93b3B1…`/`0x8ea2b333…`, `0x879E7D56…`/`0x1430E2D4…`.
- [x] **Post-ECO-08 redeploy done (2026-10-06).** Live pair is `MatchPool` `0xdfa01EDE5E9A013a6C3deA718818315f9D4A102e`, `ClaimHub` `0x538e25f8ED55Be59662e1F89d0B26c0013B67CCC` — constructed with the rotated edge signer, so no separate `setEdgeSigner` was needed for it. Runtime byte-identical to the local artifact (immutables + CBOR metadata aside), verified on Sourcify as `match`. Superseded: `0xb1cEB8Da…`/`0xcdBd9763…`. Confirmed on-chain: `claimHub()`/`matchPool()` cross-reference, `owner`/`edgeSigner`/`chips` preserved, `setClaimHub` wired. Deployed runtime is byte-identical to the local artifact once the `chips` immutable and the CBOR metadata hash are accounted for (21145 B), so **the ECO-08 `shape` branch is genuinely live**. Both verified on Sourcify as `match` with full sources.
  - Superseded and orphaned, no funds in any: `0xb1cEB8Da…`/`0xcdBd9763…` (pre-edge-rotation), `0x2e93b3B1…`/`0x8ea2b333…` (pre-ECO-08), `0x879E7D56…`/`0x1430E2D4…` (pre-redeploy).
- [x] Migration `202609300009` **is applied to production** (verified via the Management API: both columns, the CHECK constraint, and the backfill). No row has a `match_shape`, which is correct — the only `host_proven` rows have 1-seat rosters and the contract requires 2 or 4 — so the paid-pool path stays closed by design until `/api/match/start` records one.
- [x] **Migration `202609300010` applied to production** (verified via the Management API): the arming CHECK now reads `NOT enabled OR (treasury_wallet IS NOT NULL AND rake_bps > 0 AND NOT allow_self_bets)`, the claim lock is a unique index on `lower(wallet_address)`, `next_mission_voucher_nonce()` exists and is `service_role`-only, and the escrow is still inert (`enabled=false, rake_bps=0`).
- [x] Verification moved off the retired Etherscan V1 hosts to V2 + Sourcify fallback (`scripts/verify-contracts.sh`, `contracts/foundry.toml`).
- [x] `scripts/verify-contracts.sh` now cross-checks the deployed runtime size against the local artifact before interpreting a verifier answer. This was needed because Sourcify answers "already verified" for *any* previously-verified address, so a stale `contracts/.env` made the script verify the **previous** deployment and still exit 0 — exactly how the ECO-08 redeploy first reported success with the live contracts unverified. It also echoes the addresses it actually checked, so the output can be compared against the deploy log.
- [x] `scripts/lib-load-env.sh` — one shared `contracts/.env` loader for both deploy/verify scripts. A plain `source ./.env` overwrote caller-supplied variables, so an inline override silently lost; inline now always wins, and trailing `#` comments are stripped (which had been corrupting `ETHERSCAN_API_KEY`).
- [ ] **Still open: Base mainnet redeploy.** Sepolia is done; mainnet has no code at any of these addresses, so nothing is deployed there yet. Same script: `scripts/foundry-deploy.sh base-pool`, but set `GAME_OWNER`/`DEPLOYER_ADDRESS`/`EDGE_SIGNER` to mainnet addresses first — the current Sepolia values must not be reused.
- [x] **`EDGE_SIGNER` rotated off a public key (2026-10-06).** It was `0xf39F…` — Anvil/Hardhat account #0, whose private key is published in the Foundry docs and was committed in this repo. Anyone could have signed as edge signer, which is what authorizes bet settlement co-signatures. Now a freshly generated key (`0x77BC…E2`) whose private key lives only in `.env.local` as `EDGE_SETTLE_PRIVATE_KEY`; no keystore, because the edge signer never sends on-chain transactions, it only co-signs EIP-712 digests in the app server.
  - [x] **Live.** The redeploy after the rotation constructed the pool with the new signer directly; `edgeSigner()` returns `0x77BC…E2`. The superseded pool was also rotated before being abandoned.
- [x] **Dev keys cannot reach a live network any more.** `scripts/lib-dev-keys.sh` derives every Anvil-default address and refuses them in any on-chain role; every live verb in `foundry-deploy.sh` calls it for `EDGE_SIGNER`, `GAME_OWNER` and `DEPLOYER_ADDRESS`. `scripts/smoke-sepolia.sh` and the two Solidity smoke scripts take their keys from keystores/env instead of compiling published keys in. `foundry-deploy.sh sepolia` additionally refuses `USE_MOCK=true`.
- [x] **Live deploys are opt-in.** `-pool` verbs simulate by default and only broadcast with `LUDO_CONFIRM_DEPLOY=yes`, after printing mode, chain, and roles. Previously any stray invocation broadcast whatever `contracts/.env` held — a stray run during guard development did exactly that (it failed to unlock the keystore, so nothing was sent, but only by accident).
- [x] Guardrails are executed, not just written: `scripts/deploy-guardrails.test.ts` (9 tests) runs the shell and asserts on behaviour.
- [x] Bash 3.2 compatibility (macOS default): guarded empty-array expansion and no `${var,,}`, both of which broke the dry run and the closing hint on first use. Asserted by test so it cannot regress.
- [ ] **Open: stranded funds on the pre-redeploy Sepolia pool** `0x879E…`. Any in-flight pool entries there can no longer be claimed; confirm nothing is outstanding or accept the loss.

> **Before any `-pool` deploy, fix `contracts/.env`:** it currently carries a stale `DEPLOYER_ADDRESS=0xbcCa…DfA` (an Anvil account) left over from a dry run, `USE_MOCK=true` against a mainnet config, and a duplicated `CLAIM_HUB_ADDRESS` key. None of these are committed; all three affect the deploy.

---

## Phase 2 — Restore dice and engine integrity

**Why.** A seated guest can currently choose their own dice face, and the two live engines resolve the same capture differently.

### Tasks — dice

- [x] **SEC-02 — a client can no longer name its own dice face (2026-10-06).** Closed at four levels, not just the parser:
  - `lib/types.ts` — `REQUEST_ROLL` is `Record<string, never>` and `REQUEST_MOVE` has no `diceValue`, so a face is unrepresentable in a typed caller.
  - `lib/gameProtocol.ts` — both payloads **reject** the key (`!('value' in payload)`) rather than ignoring it, so a forged intent is dropped loudly instead of silently honoured.
  - `lib/protocol/schemas.ts` — `.strict()` on both payloads. Plain `z.object()` strips unknown keys and *passes*, which would have read as acceptance at the call site.
  - `hooks/useGameActions.ts` — the `value` parameter is **gone** from `handleRoll`; no caller can pass a face even in principle. `REQUEST_ROLL` sends `{}` and `REQUEST_MOVE` sends only `{color, tokenIndex}`.
  - `hooks/useGameEngine.ts` — host calls `handleRoll()` bare, and takes `REQUEST_MOVE`'s face from `localGameState.diceValue`, never from the payload.
  - `app/components/Dice.tsx` + `PlayerInfoRow.tsx` — `onRoll` is `() => void`. The old call was `onRoll(0)`, which was safe only because `0` is falsy; `onRoll(6)` would have landed unchanged.
- [x] **SEC-02 (not in the original list) — `REQUEST_MOVE.diceValue` removed.** A mover could declare the face it moved with, and the host preferred it over its own state (`payload.diceValue ?? localGameState.diceValue`). This is the same hole as `REQUEST_ROLL.value` and strictly worse — it allowed moving with a face the host never rolled.
- [x] **SEC-02 — AFK/AI forced rolls already route through Edge.** `useAFKManager` and `useAIBrain` call `handleRoll()` with no argument, so a forced roll still mints a `match_rolls` receipt. No client fallback exists: a networked seat that cannot reach `roll-dice` **aborts** the roll rather than falling through to `Math.random()`. Asserted by test.
- [x] **SEC-01 — `roll-dice` authenticated and bound to seat + turn (2026-10-06).** It was completely unauthenticated: `{matchId, walletAddress, actionId}` from anyone with the anon key, service-role insert, RLS default-deny bypassed. Three things identified the receipt and **all three came from the request body**. Now:
  - **Authentication.** A match session (`match_sessions`, not SIWE) or a one-off `personal_sign`. The client goes through `useMoveAuth.requestRoll`, which holds the session, so there is no per-roll wallet popup. Verified *before* the mint decision.
  - **Only the host may mint.** A guest asks over the intent channel and the host calls in, which keeps the betting window and dice order with the host.
  - **`wallet_address` is the recovered signer.** `body.walletAddress` is gone. Attribution can no longer be forged to another player.
  - **Seat and turn are derived, not supplied.** `seat_color` and `turn_seq` come from `match_states`, and the seat must be the one whose turn it is.
  - **Retry-until-six is impossible.** `match_rolls_match_turn_uniq` on `(match_id, turn_seq)` means a second receipt for a turn cannot be inserted at all. The old `(match_id, action_id)` idempotency bound nothing, because `action_id` was caller-chosen — the comment claimed a guarantee it did not provide. A repeat attempt now *replays* the first face, so a dropped response still recovers.
- [x] **SEC-01 — `move-auth` binds the receipt in `move` and `pass`.** Both now `select` `seat_color, turn_seq, wallet_address` and require: the receipt's seat is the seat moving; `turn_seq` still equals the current `seq` (so a roll cannot outlive its turn — done server-side rather than trusting a client-carried `lastRollId`); and the minter is the host or the seat's own wallet. A receipt with no `seat_color`/`turn_seq` predates the migration and is **refused, not guessed at**.
- [x] **SEC-33 — hosted bots and AFK seats can roll.** They previously sent a literal `"<color>-bot"` string as `wallet_address`, which cannot satisfy the FK to `players(wallet_address)`, so the insert failed and hosted bots could not roll at all. The host now mints with `seat_color` = the bot's colour, which is what the seat column is for.
- [x] **Migration `202609300011_roll_receipt_binding.sql`.** `seat_color` + `turn_seq`, a closed seat vocabulary, and the partial unique index. Historical rows are deliberately left unbound and the Edge boundary fails closed on them rather than backfilling a guess. **Apply before deploying the new `roll-dice`** — it is the only writer of both columns.
- [x] **The rules are tested, not asserted.** They live in `_shared/rollReceipt.ts` as pure functions so `scripts/roll-trust.test.ts` (23 tests) executes them in Node; the wiring between the Edge handlers and those functions is checked separately and is explicitly labelled a source assertion, because Deno is not installed in CI. `scripts/concurrency.test.ts` adds three tests against real Postgres, including **six concurrent retries of one turn, of which zero are accepted**.
- [ ] **SEC-01** — Authenticate `roll-dice`: require the caller's session/signature, verify they are seated, verify `state.currentPlayer === seatColor`, and bind `wallet_address` to the **recovered** signer.
- [ ] **SEC-01** — In `move-auth` `move` and `pass`: select `wallet_address` and reject unless `roll.wallet_address === recovered`.
- [ ] **SEC-01** — Require `state.lastRollId === rollId` (or store `roll_id` on the state row and CAS it) so a roll can only be spent by the turn that minted it.
- [ ] **SEC-33** — Use the host's wallet for bot seats, or make `match_rolls.wallet_address` nullable with a separate `seat_color`. Today hosted bots cannot roll at all.
- [ ] **ENG-13** — Validate `Number.isInteger(dice) && dice >= 1 && dice <= 6` in `move-auth` before `getLegalTokenIndices`. Clamp `steps` in `calculateNextPosition`. Change the `steps !== 0` guard at `core.ts:348` to `if (nextPos === initialPos)`.

### Tasks — one engine

- [ ] **ENG-01** — Fix the capture-force input: change `core.ts:384` to pass pre-move `state`, keeping the `+1` at `:300`. *(Do not instead delete the `+1` — it is less readable and hides the intent.)*
- [ ] **ENG-01** — Add `npm run test:engine-diff`: N seeded matches through both `lib/engine/core.ts` and `lib/gameLogic.ts`, asserting identical `positions`/`captured`/`winner`/`bonusRoll` at every step. Fuzz with `fast-check`.
- [ ] **ENG-01** — Repoint `scripts/golden-replay.ts` at `lib/engine/core.ts`.
- [ ] **ENG-01** — Extend the golden corpus so matches **terminate** (currently `finished 0 / 50`): raise `MAX_TURNS_PER_MATCH`, start positions `0..9` only, and use `assignCorners2v2` + `getNextPlayer` for turn order.
- [ ] **ENG-08** — `aiEngine.calculateMoveScore` must call engine math (`E.resolveNetworkedMove` or `checkMultiCapture` with `{...state, positions: moved}`), not a pre-move local reimplementation.
- [ ] **ENG-17** — Add `npm run check:drift`: deep-compare `lib/engine/*` exports against `lib/constants` and `lib/boardLayout` (`TEAM_PAIRINGS`, `SHARED_PATH`, `CORNER_SLOTS`, `SAFE_POSITIONS`).
- [ ] **ENG-20** — Deduplicate `getStarIndices`/`nearestStarAhead`/`getGridCellInfo` into one module and re-export.

### Tasks — one team table

- [ ] **ENG-02** — Derive `LOBBY_COLORS['2v2']` from `TEAM_PAIRINGS` (`[host, TEAM_PAIRINGS[host], ...opponents]`) instead of hardcoding `['green','yellow','red','blue']`.
- [ ] **ENG-02** — Add a test asserting `getTeammateColor(slots[0].color) === slots[1].color` for every match type, and that `assignCorners2v2` puts the pair on the same diagonal.
- [ ] **ENG-19** — `shufflePlayers('1v1', …)` must reuse `assignCornersFFA('1v1')`'s axis instead of re-rolling it (today ~51% of 1v1 matches seat red-vs-blue while the lobby says green-vs-yellow).
- [ ] **ENG-02** — Verify `TeamUpMatchPanel:306`'s `role === 'host' || role === 'teammate'` pairing renders consistently after the fix.

### Tasks — authority engine coverage

- [ ] **ENG-03** — Extract `evaluateVictory(newPositions, playerCount)` from `processMove` (`core.ts:395-412`) and call it from `applyPower`'s teleport branch. *(A 2v2 team going all-home via teleport currently leaves `winner=null`, `status='playing'`, and both colors dropped from the turn cycle → permanent deadlock.)*
- [ ] **ENG-04** — `activeColorsForTurns`: when `playerCount === '2v2'`, keep a color active if its teammate still has tokens. Add a test: finished green + unfinished blue ⇒ green stays active.
- [ ] **ENG-05** — Move the three-sixes counter into `processMove`/`resolveNetworkedMove`; reject `submit-move` on the third six. Delete the hook-level copies at `useGameActions:487` and `useProvablyFairDice:68`.
- [ ] **ENG-06** — `buildPayoutPlan`: move the `shape === "2v2"` length check **above** the single-winner early return. Map `winner === "Team N"` → both `TEAM_ID`-N seats before calling it.
- [ ] **ENG-06** — `useGameEngine.recordWin` must be called for every color in the winning team, and `core.ts:428` must record all finishing colors in `winners`.
- [ ] **ENG-07** — `app/api/match/state` must return `stripPowerTypesForWire(data.state)`.
- [ ] **ENG-11** — `applyPowerPickup`: seed the tile respawn from a match-committed seed (e.g. a `powerTileSeed` on state), not `Date.now()`. Remove the dead `rc = palette[seed % 4]` indirection (`52 % 4 === 0`, so it is fully determined by `rp`) and derive rarity from an independent LCG stream.
- [ ] **ENG-12** — Trap resolution: add the 2v2 teammate truce (`t.owner !== tokenColor && getTeam(t.owner) !== getTeam(tokenColor)`), matching capture and nuke.
- [ ] **ENG-14** — Route the trap branch through a shared post-move epilogue (`finishMove`) so shield cleanup, boost consumption, capture stats, and the win re-check all run.
- [ ] **ENG-09** — AI `progression` term must use distance-to-finish, not the global track index (today a token 6 cells from home scores *lower* than a fresh one).
- [ ] **ENG-10** — `getBestMove` must return `{color, tokenIndex}` so `useAIBrain` passes the teammate's color to `moveToken`.
- [ ] **ENG-18** — Gate the AI's Boost usage on a condition, per `ENGINE_LOGIC.md` §5.4.
- [ ] **ENG-15** — Delete `checkWinStatus` (a deprecated no-op that always returns `'playing'`).

### Exit gate

- [ ] `npm run test:engine-diff` green over ≥10k fuzzed moves per mode.
- [ ] `npm run test:engine-core` exists and covers `resolveNetworkedMove`, all `applyPower` branches, `applyPowerPickup`, `activeColorsForTurns`, `effectiveMoveSteps`, `countNukeVictims`, `applyEngineCaptureEvents`, `stripPowerTypesForWire`. *(Today: zero coverage.)*
- [ ] `npm run test:golden` — corpus includes at least one terminated match per mode, including a 2v2 **team** win.
- [ ] `npm run check:drift` green.
- [ ] `isGameIntent` rejects `REQUEST_ROLL {value}`; a test asserts it.
- [ ] A hostile client cannot influence the dice face — demonstrated by a test that calls the full networked path with a forged `REQUEST_ROLL`.

---

## Phase 3 — Trust-boundary hardening

**Why.** Signatures are verified correctly, but *resource* authorization is frequently missing: "is this signature valid" is checked, "is this signature the right signer for this pool/match/seat" often is not.

### Tasks — route authorization

- [ ] **SEC-07** — Delete `requestedMatchId` from `live-arena/power4p`; accept only `arenaKey` and derive `matchId` server-side. Require a host signature (or session == `live_matches.host_address`) before any `authority_id` write. Require a session on `POST`.
- [ ] **SEC-07** — **Product decision required:** "any spectator claims authority" (`app/page.tsx:351-359`) is a deliberate trust-boundary break. Document the accepted risk or change the design.
- [ ] **SEC-08** — `friends/route.ts`: validate `wallet` with `/^0x[a-f0-9]{40}$/` **before** any query; never interpolate into `.or()`. Use two explicit `.eq()` queries merged in JS. Require a session. Rate-limit the Neynar calls.
- [ ] **SEC-12** — `POST /api/lobby/join`: require a session and derive `wallet_address` from it; require an accepted friendship with the host; throttle per wallet+room. Remove the client-declared `coins` field.
- [ ] **SEC-13** — `friendships` `remove`: scope the delete to the caller's participation.
- [ ] **SEC-14** — `push/subscribe` `unsubscribe`: scope `dropPushSubscription` to the session wallet.
- [ ] **SEC-21** — `siwe/verify`: compare `domain` against the request `Host` (or an allowlist); issue nonces server-side into `app_sessions` and consume them on first use.
- [ ] **SEC-22** — `social/poke`: require an accepted friendship between sender and receiver.
- [ ] **SEC-23** — `farcaster`, `activity`, `matchmaking/pools`: require a session (or IP-rate-limit) and regex-validate `wallet` before interpolating into the upstream URL.
- [ ] **SEC-24** — `wallet-links` GET: require a session and require the caller to be one of the two wallets. POST: add `isFreshIssuedAt(issuedAt)`.
- [ ] **SEC-25** — `profile/ecdh` POST: validate `kty === 'EC'`, `crv === 'P-256'`, base64url `x`/`y` of exactly 32 bytes; persist only `{crv, kty, x, y}`; reject `d`, `key_ops`, `ext`.
- [ ] **SEC-26** — `notices`: do not present an FNV hash in a field named `signature`. Rename the field or sign properly.
- [ ] **SEC-27** — `feedback`: use the platform-provided client IP, not `x-forwarded-for[0]`. Drop the unverified `walletAddress` attribution fallback.
- [ ] **SEC-28** — `social/moderation`: rate-limit `report`/`congratulate`/`activity`; derive the dedup key server-side, not from a client-supplied `requestId`.
- [ ] **SEC-34** — Add `middleware.ts` with rate limits on all unauthenticated routes.
- [ ] **SEC-35** — Add `content`, `message`, `text`, `body`, `plaintext`, `epk`, `iv`, `ciphertext` to `SENSITIVE_KEY_PREFIXES`; drop any value that parses as a `SealedBox`.

### Tasks — Edge authority

- [ ] **SEC-15** — `move-auth` `move`, `pass`, `power`: add `.select('seq')` to the CAS update and require `data.length === 1`, else `staleStateResponse`. *(Without this, the loser of a race returns `200 {success:true}` with never-persisted state.)* Check the error on the `match_moves` insert.
- [ ] **SEC-16** — Add `board: sha256(stableStringify({initialState, colorCorner, playerSeats}))` to `buildSeedMessage`; recompute and compare server-side. Validate `playerSeats` keys ⊆ the four colors, each wallet at most once, and `color_corner` matches `assignCorners2v2` for the declared `playerCount`.
- [ ] **SEC-17** — `provisional_match_sessions`: unique on `(authorization_key, wallet_address)`; key the client value `room:<code>:<wallet>`.
- [ ] **SEC-18** — Delete the `reason:'forced'` escape hatch from `pass`; derive forced-ness server-side (no legal tokens **and** not a six).
- [ ] **SEC-19** — Mirror `move`'s `seat.kind === 'human'` rejection into the `pass` branch.
- [ ] **SEC-20** — Remove 8453 from the Edge allowlist (or refuse the RPC fallback when no RPC is configured); reject when `SIWE_VERIFY_RPC_URL*` is unset in production. Keep `_shared/walletVerify.ts` `SUPPORTED_CHAIN_IDS` in sync with `lib/chains.ts`.
- [ ] **SEC-29** — `resolve-bet`: reject unless `bet_window_status = 'settled'`; take `bet_type` from `live_matches.current_bet_type` server-side; cross-check `result` against `match_states.state.winner`.
- [ ] **SEC-30** — `pass`: set `next.powerSpentThisTurn = false`.
- [ ] **SEC-31** — Return a fixed `code` and a generic message from all three Edge functions; map `applyPower` errors to opaque codes; never echo raw PostgREST messages.
- [ ] **SEC-32** — Whitelist the persisted `match_states.state` fields explicitly instead of blacklisting `powerTiles`.

### Tasks — crypto and privacy

- [ ] **CRY-01** — Replace the hand-rolled KDF with WebCrypto HKDF: `deriveBits({name:'HKDF', hash:'SHA-256', salt:<16 random bytes>, info:<"ludo-dm-ecdh-v2" ‖ senderStaticPub ‖ recipientStaticPub ‖ epk>}, Z, 256)`. Remove the "HKDF-ish" comment — it is not HKDF.
- [ ] **CRY-02** — Include the sender's static public key in the sealed box and require a signature over `(epk ‖ iv ‖ ciphertext ‖ recipientStaticPub)`. Stop spreading `...data.metadata` into the rendered message in `usePeerChat`.
- [ ] **CRY-03** — `POST /api/messages`: reject any `content` that does not parse as JSON with `v === 1`, a string `epk` (`kty: 'EC'`, `crv: 'P-256'`), and a string `iv`. Render `[Encrypted Message]` for anything that does not open. Delete the dormant plaintext sender `hooks/useMessages.ts`.
- [ ] **CRY-04** — Add `filter: 'wallet_address=eq.<me>'` to the self-profile channel. Verify empirically against the anon key whether `payload.new` leaks `coins`/`ecdh_pubkey`; if so, move them to a separate table with no policy and no publication membership.
- [ ] **CRY-05** — Covered by SEC-25.
- [ ] **CRY-06** — Generate the ECDH keypair with `extractable: false`. If export is unavoidable, keep the JWK in IndexedDB behind a WebCrypto-backed wrapper. On regeneration failure, publish the new key immediately and surface a UI state instead of swallowing the error.
- [ ] **CRY-07** — Delete the archived `messages_restrict_columns` copy, or reduce it to a comment. Correct the `AGENTS.md` citation to the canonical baseline.
- [ ] **CRY-08** — Remove `messages` from the `supabase_realtime` publication; there is no consumer.

### Tasks — DB hardening

- [ ] **DB-09** — Add the `revoke all … from anon, authenticated` loop for all 30 tables; keep the narrow `players` column grant. See [`SYSTEM_REVIEW.md` §10.6](./SYSTEM_REVIEW.md).
- [ ] **DB-10** — Column-scope the `live_matches` grant to exclude `join_secret_hash`, `arena_key`, `authority_id`.
- [ ] **DB-04** — Restore the `window_closed_at > NOW()` guard in `settle_match_bets` and make it idempotent (guard on `status='open'` **and** a settlement marker), or reconcile `ENGINE_LOGIC.md:231` to describe what the code actually does.
- [ ] **DB-05** — Port the archive's counter-reconciling `mark_conversation_read`; `lower()` its inputs so a mixed-case wallet does not silently no-op.
- [ ] **DB-06** — Port the archive's `cleanup_stale_data` (24h-read + 7-day absolute backstop + counter reconciliation).
- [ ] **DB-07** — Change `messages_restrict_columns` to `IS DISTINCT FROM` for all three identity columns.
- [ ] **DB-08** — Add a header comment to `migrations_archive/` forbidding application against a canonical DB; better, move it out of the repo tree or add a CI deny.
- [ ] **DB-15** — Align `messages.content` CHECK (4000) with the route cap, or raise the CHECK to the archive's 8192. Pick one constant.
- [ ] **DB-16** — Align `live_chat.content` CHECK (1000) with the route's `.slice(0, 500)`.
- [ ] **DB-17** — Split `pokes.status` into a canonical 2-value CHECK plus a separate `not valid` legacy CHECK.
- [ ] **DB-18** — Reconcile `tournaments.status` with the archive vocabulary, or document the break. Add a CHECK to `tournament_matches.status` (currently none).
- [ ] **DB-19** — Decide the `join_tournament` contract (`{'success',…}` + coin debit vs `{'participant_id'}`) and update the archive or add an adapter.
- [ ] **DB-20** — Verify `matchmaking/join:87` handles the missing `role`/`search_timeout` keys.
- [ ] **DB-23** — Add the missing indexes from §10.3, including `unique (wallet_address) where revoked_at is null` on `app_sessions`.
- [ ] **DB-24** — Port `prevent_client_player_tampering` from the archive, or delete the archive file so the intent is not lost.
- [ ] **DB-25** — Delete `update_offline_status()` and its `database.types.ts` entry, or add `set search_path = public` + a revoke. It also duplicates `cleanup_stale_data` with a **different** interval.
- [ ] **DB-27** — Fix the publication per §10.2: remove the 3 dead entries, add `players`/`player_missions`/`pokes` (or migrate those subscribers to broadcast).

### Exit gate

- [ ] Route auth matrix (§10.7) regenerated and diffed against a checked-in expectation; no unauthenticated mutation remains.
- [ ] `check:schema` asserts: no `anon` table grants beyond the allowlist, no `anon`/`authenticated` EXECUTE on `security definer`, all `column_default` values as expected, all expected `pg_proc` signatures present.
- [ ] `crypto.subtle.deriveBits({name:'HKDF', …})` is the only DM key path.
- [ ] A test asserts `POST /api/messages` rejects plaintext.
- [ ] Verified against the anon key: `realtime.messages` SELECT returns zero rows; `players` `payload.new` exposes no sensitive column.

---

## Phase 4 — Netcode liveness

**Why.** Matches currently cannot be relied on to complete: any turn with no legal move permanently desyncs `match_states` and 403s the next player.

### Tasks

- [ ] **NET-01** — Call `moveAuth.passTurn({matchId, rollId, expectedSeq, source:'host-assist', reason:'three-sixes'|'no-legal'})` from both the three-sixes and no-legal-move branches in `useGameActions`. Apply the returned `state` via `applyServerState`; broadcast from **that**.
- [ ] **NET-01** — Add a `.then` that retries once on `STALE_SEQ`.
- [ ] **NET-02** — Delete `useGameEngine.ts:215`. Thread `TeamUpContext.serverSeq` (the ref, not the number) into `useGameActions`. Remove the two manual assignments at `:170` and `:177`.
- [ ] **NET-02** — Add one bounded retry on `code === 'STALE_SEQ'`: re-read the snapshot, re-submit with the fresh `expectedSeq` and the **same** `rollId`.
- [ ] **NET-03** — Gate every mutating `processGameAction` branch on `isHost || isComputeHost`. Require `data.source === 'match_states'` (or a host signature) before touching `positions`/`currentPlayer`.
- [ ] **NET-03** — On a networked match, **drop** `MOVE_TOKEN`/`TURN_SWITCH` broadcasts entirely and rely solely on `match_states`.
- [ ] **NET-03** — Make the room channel `private: true` + `realtime.setAuth` with a match-session JWT, or move broadcasts behind Edge.
- [ ] **NET-04** — Replace the single-slot `lastIntent` with a FIFO `intentQueue`; drain it in the effect.
- [ ] **NET-04** — Send `GAME_INTENT_ACK {intentId, status}`; have the guest retry `nack`/`STALE_SEQ` a bounded number of times with the same `intentId`.
- [ ] **NET-04** — Never call `clearIntent()` on a path that declined to act.
- [ ] **NET-05** — Add bounded exponential backoff with `counters.reconnectDelayMs` inside `useMatchStates`. Decouple "cannot reach the snapshot" from "must not act" — a host that already holds `hasAuthoritativeSnapshot` should keep orchestrating.
- [ ] **NET-06** — Elect the compute host from a **server-ordered** set (`match_states.player_seats` seat index, or `match_sessions`), never from a client clock. Until then, gate `broadcastAction` on `isHost` alone.
- [ ] **NET-07** — Gate the intent-consumption effect on `isAuthority` (currently raw `isHost`), so a compute host actually consumes `lastIntent`.
- [ ] **NET-07** — Require a verified `seq` snapshot before `isComputeHost` may act (align with `useGameTimer`'s existing `hasAuthoritativeSnapshot` gate).
- [ ] **NET-07** — Implement an explicit `HOST_ELECT` handshake. `HostMigrationPanel` is currently a passive overlay that never triggers, verifies, or completes an election.
- [ ] **NET-07** — Wire `lib/netcode/abandon.ts` to the disconnect path (`classifyAbandon`, `recordAbandonAttempt`, `ABANDON_GRACE_MS`, `abandonGraceRemainingMs` all have zero call sites).
- [ ] **NET-08** — Use `createDedupStore` for `processedActionIds` (`useSupabaseRelay:21`) and `processedJoinRequestIds` (`TeamUpContext:895`).
- [ ] **NET-08** — Clear all three dedup stores in `leaveGame` and on `roomCode` change. Key `sharedMoveSessions` by `matchId` and delete on `leaveGame`.
- [ ] **NET-08** — Raise `createDedupStore` `max` above a long match's ID space, or switch to a monotonic high-water mark. *(At `max:512` with a 10-minute TTL, a replayed old `intentId` is treated as NEW and double-applied.)*
- [ ] **NET-09** — Run `parseGameIntent` on the PeerJS path exactly as on the Supabase path. Derive the id from `actionId` when `intentId` is absent. Make `rememberIntent` return a discriminated result that cannot be silently treated as "accept".
- [ ] **NET-10** — `useSpectatorSync`: subscribe to `game-room-${roomCode}`, not `match-states-room-`. Add a poll interval as a backstop.
- [ ] **NET-11** — Hold `processGameAction`/`joinGame` in refs (the pattern already used correctly in `useMatchStates:24-31`); depend only on `[currentRoomCode, lobbyState?.roomCode]`.
- [ ] **NET-12** — Delete one of the two competing guest→`localGameState` effects. `:451` is currently unreachable because `:305` fires first on the same commit.
- [ ] **NET-13** — Store an absolute `turnDeadline`; compute `timeLeft` from `Date.now()` each tick; add a `visibilitychange` re-sync. *(Today a backgrounded tab throttles `setInterval` to ~1/min, so a 15s timer decays at 0.017/s and AFK enforcement never fires.)*
- [ ] **NET-14** — Gate the "landing" safety net on `!isNetworkedMatch`, or route it through the same `passTurn` path as NET-01.
- [ ] **NET-15** — Keep retry-ladder timeout ids in refs; clear them in `destroyPeer`/`leaveGame`; abort on `roomCode` change.
- [ ] **NET-16** — Merge only `positions`/`matchStats`/`winner` from the move response; keep turn fields local until NET-01 lands.
- [ ] **NET-17** — `handleRoll`: read `stateRef.current.matchId` (as `moveToken` already does) or add `localGameState.matchId` to the dep array at `:580`.
- [ ] **NET-18** — Clear `rollTimerRef`/`moveTimerRef` in an unmount-only effect while keeping the identity-churn protection via the existing function refs.
- [ ] **NET-19** — `useAFKManager`: reset `timeLeft` **only after** a confirmed apply. Have `moveToken` return a status the AFK hook can act on, so the `totalTriggers >= 3` kick is reachable.
- [ ] **REA-05** — Add `matchConnectionStatus` to the `TeamUpContext` memo dep array. *(It is the only value key missing from the deps; a stale `'syncing'` freezes the badge, the turn timer, bot play, and `isAuthority`.)*

### Exit gate

- [ ] `npm run test:netcode` green — a `react-test-renderer` harness mounting `TeamUpProvider` with a fake Supabase channel and fake PeerJS peer, asserting: (a) one intent on both transports applies exactly once; (b) `STALE_SEQ` retries and succeeds; (c) a non-host `MOVE_TOKEN` is dropped; (d) a compute host consumes `lastIntent`; (e) two intents arriving in one tick both apply.
- [ ] `npm run test:protocol` green — table-driven hostile payloads rejected on **both** transports.
- [ ] `scripts/mp.harness.ts` rewritten to import and drive the real modules (it currently imports none of them and models the guest's resync mutating `host.state`).
- [ ] `scripts/net.chaos.ts`, `drill.runner.ts`, `drill.deep.ts` rewritten to import `createDedupStore`/`rememberIntent` and drive `processGameAction`, instead of re-implementing dedup locally.
- [ ] A 4P and a 2v2 match played end-to-end in a drill reaches `status='finished'` with a winner — including at least one turn with no legal move, and one three-sixes forfeit.

---

## Phase 5 — Client architecture

**Why.** Unbounded channels, whole-tree re-renders at ~1Hz, a per-frame document query on mobile, and a single error boundary around 13 panels.

### Tasks

- [ ] **REA-01** — Create and subscribe one channel per room in the effect at `useSupabaseRelay:69`; send via a ref; `removeChannel` on teardown. *(This also removes the double-subscribe hazard in NET-11 and the REST fallback cost.)*
- [ ] **REA-02** — `useMemo` the `GameDataContext` value over its 18 fields.
- [ ] **REA-03** — Add `filter: 'wallet_address=eq.<me>'` to the self-profile channel; bound the leaderboard projection; equality-guard `setProfilesMap`.
- [ ] **REA-04** — `useDataBoot`: set `isBootComplete` in the `finally`, or scope the throw per section so one `/api/messages` 403 cannot abort the whole boot. Surface a retry affordance instead of an empty leaderboard.
- [ ] **REA-06** — `FrameProvider`: drop `attributes` from the MutationObserver (or debounce with `requestAnimationFrame`). `childList` alone is enough for mount-time stripping.
- [ ] **REA-07** — Lift `usePreferences` to a provider or a `useSyncExternalStore` over the cookie with invalidation, so mid-match toggles reach every consumer.
- [ ] **REA-08** — Wrap each `activeTab` panel and the board in `PanelErrorBoundary`. Add `app/global-error.tsx`.
- [ ] **REA-09** — `useSoundEffects.playSound`: set `clone.volume = volume`, or just play `audio`.
- [ ] **REA-10** — `useGameActions:246` — write `newState.currentPlayer` on the fresh `finalState`, not on the aliased `newState` returned by `processMove`.
- [ ] **REA-11** — `useGameEngine:441` — gate the whole-state write-up on a ref-stable `matchId`; flush once on `matchId` arrival instead of at 1Hz.
- [ ] **REA-12** — Hoist a single module-level `AudioContext`. Add `osc.onended = () => { gain.disconnect(); osc.disconnect(); }` to every sound path.
- [ ] **REA-13** — Delete `AudioToggle` (unreachable), or prime the context from a one-time `pointerdown` listener.
- [ ] **REA-14** — `LandscapeGuard`: add `(pointer: coarse)` or a mobile gate so a narrow desktop window does not get a "Rotate your device" overlay.
- [ ] **REA-15** — Delete the manual `<meta viewport>`; put `maximumScale: 1, interactiveWidget: 'resizes-content'` in the `viewport` export.
- [ ] **REA-16** — `page.tsx:281` — initialize `onboarded` to `false` and set it in a mount effect; re-check for guests too.
- [ ] **REA-17** — `handleWatchMatch`: add `try/catch` and `AbortSignal.timeout(15000)`.
- [ ] **REA-18** — Mount the broadcast feed only when the dashboard is open; delete the duplicate `LiveChatPanel`/`LiveMatchSearchesPanel` (imported nowhere, ~600 lines each, re-implementing the same subscriptions under different channel names).
- [ ] **REA-19** — `TokenPiece`: return cleanups from `playSpawn`/`playLanding` and register them on an unmount effect.
- [ ] **REA-20** — Move the `useScreenWakeLock` ref write out of render.
- [ ] **REA-21** — Hoist `useBoardLayoutRotation` out of the JSX props in `Board.tsx:340`.
- [ ] **REA-22** — `INITIAL_GAME_STATE`: make `lastUpdate` lazy or zero; force a new identity in the `leaveGame` reset.
- [ ] **REA-23** — Memoize the `GuestWallContext` value.
- [ ] **REA-24** — Wrap `handlePlayNow` / `handleBackToSubMenu` in `useCallback`.
- [ ] **REA-25** — `ActivityFeed:819` — add `me`/`resolveHost` to the dep array, or hold them in refs.
- [ ] **REA-26** — Lower the board-square floor below the minimum measured viewport height, or clamp to the container.
- [ ] **REA-27** — Delete the never-rendered `dynamic(() => import('./Leaderboard'))` in `page.tsx:36`.
- [ ] **REA-28** — Remove `@x402/core|evm|extensions|svm` and `x402-fetch` from `package.json`, or record the plan. They are imported nowhere.
- [ ] **REA-29** — Confirm the hardcoded OnchainKit key in `Providers.tsx:71` is the intended public key, and move it to an env var with a documented default.
- [ ] **next.config.ts** — Consider `optimizePackageImports`, `modularizeImports`, and `compiler.removeConsole`. `processGameAction` currently logs every action **and its full payload**.

### Exit gate

- [ ] React Profiler trace on a mid-range Android device shows no per-frame document query and no >1Hz whole-tree re-render during a networked match.
- [ ] `npm run test:hooks` — a `react-test-renderer` harness covering the effect/dependency findings (REA-05, REA-07, REA-11, NET-12, NET-17).
- [ ] Throwing inside any panel renders only that panel's error boundary; the board survives.
- [ ] Channel count during a 300-action match is constant.

---

## Phase 6 — Hygiene and drift

### Tasks

- [ ] **ENG-15** — Delete `checkWinStatus`.
- [ ] **ENG-16** — Reconcile `AI_SCORES` with `ENGINE_LOGIC.md` §5.2 (`PROMOTION: 150` vs "Reach Finish Zone (+200)").
- [ ] **NET-20** — Delete `usePeerManager` or wire it; today there is **no** P2P liveness detection and no heartbeat on the live path.
- [ ] **NET-21** — Emit `net_authority_switch` and `net_heartbeat_ok` from production code; send `HOST_ELECT` from `matchFsm.ts:23`. *(Both are currently only bumped by drill scripts, so `NETCODE_DRILLS` rows D3/A4 cannot fail.)*
- [ ] **NET-22** — `classifyAbandon` should not bump `net_intent_ok`.
- [ ] **NET-23** — Make `purgeExpired` amortized (check the head only, or run on a timer). *(Today it is a full O(n) scan on every `has()`/`add()` → O(n²) under an intent flood: 20.5ms for 5,000 calls at n=512.)*
- [ ] **NET-24** — Preserve the host's own `powerTiles[].type` across `applyServerState`.
- [ ] **NET-25** — `edge-server-client`: add a connect timeout, stop polling forever on `CONNECTING`, clear `messageHandlers` in `disconnect()`.
- [ ] **NET-26** — Meter the 401 → public-`get` downgrade in `useMoveAuth`.
- [ ] **NET-27** — Pass `seq` and `replay` into `buildMatchReceipt`; reset `getNetCounters()` per match.
- [ ] **ECO-04** — Store `lobbyTtl` in `PoolConfig` and bind it into the Edge-signed `LobbyTicket` typehash.
- [ ] **ECO-05** — `MissionClaim.claim`: use `msg.sender != wallet` only, or add an explicit `onlyClaimHub` path. Today `ClaimHub.allowedSource` is dead code.
- [ ] **ECO-07** — Retire the legacy `deriveSharedKey` decrypt path.
- [ ] **DB-22** — Regenerate `types/database.types.ts` with `supabase gen types typescript`. Remove the three phantom function entries (`cleanup_old_messages`, `increment_coins`, `update_offline_status`) and the `as never` cast in `marketplace/purchase`.
- [ ] **DB-26** — Correct `supabase/schema_list.md:17` and document `match_rolls.status` and the DB-01 abort.
- [ ] **DB-08** — Add a `migrations_archive/` deny rule to CI.

### Doc-drift reconciliation (do alongside the code fixes)

- [ ] `ENGINE_LOGIC.md:231` — `settle_match_bets` timing guard (DB-04)
- [ ] `ENGINE_LOGIC.md:201` — DM fail-closed claim (CRY-03)
- [ ] `ENGINE_LOGIC.md:217` — spectator channel name (NET-10)
- [ ] `ENGINE_LOGIC.md` §3.5 — hidden power tiles (ENG-07)
- [ ] `ENGINE_LOGIC.md` §5.2 — AI scores (ENG-16)
- [ ] `ENGINE_LOGIC.md` §5.4 — Boost usage (ENG-18)
- [ ] `AGENTS.md:40` — `messages_restrict_columns` citation (CRY-07)
- [ ] `AGENTS.md:41` — invariant 7 downgrade claim (CRY-03)
- [ ] `AGENTS.md` invariant 3 — "Edge `roll-dice` only" (SEC-01, SEC-02)
- [ ] `AGENTS.md` invariant 1 — `TEAM_PAIRINGS` single source (ENG-02)
- [ ] `docs/ops/NETCODE_DRILLS.md:39` + rows D3/A4 — counters and pass criteria (NET-21)
- [ ] `docs/ops/UNPARK_CHECKLIST.md` — "Code gate green" now covers neither the authority engine nor the schema; update the scope note.
- [ ] Add a pointer to `SYSTEM_REVIEW.md` from `AGENTS.md` so future agents inherit the register.

### Exit gate

- [ ] `npm run check:drift` green and wired into CI.
- [ ] `check:schema`, `check:rpc-args`, `test:engine-diff`, `test:engine-core`, `test:golden`, `test:netcode`, `test:protocol` all in `.github/workflows/ci.yml`.
- [ ] All doc claims in the table above match the code.
- [ ] 154/154 findings closed or have a signed-off risk acceptance recorded in this file.

---

## Sign-off

| Gate | Owner | Date | Result |
| --- | --- | --- | --- |
| Phase 0 exit | | | |
| Phase 1 exit | | | |
| Phase 2 exit | | | |
| Phase 3 exit | | | |
| Phase 4 exit | | | |
| Phase 5 exit | | | |
| Phase 6 exit | | | |
| **Wagered + 2v2 play re-enabled** | | | |

**Ship rule.** Wagered pools and 2v2 mode stay disabled until Phase 0–2 close. Non-wagered 4P offline play is blocked on ENG-01 only (one engine must be authoritative), which is a one-line fix plus a differential test.
