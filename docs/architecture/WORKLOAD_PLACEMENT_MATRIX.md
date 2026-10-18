# Ludo Base — Workload Placement Architecture & Record (FULLY IMPLEMENTED)

**Component placement across Supabase and Cloudflare, data invariants, and implementation record — FULLY IMPLEMENTED (P0–P6 COMPLETED 2026-10-18).**

| Field | Value |
|---|---|
| Status | **FULLY IMPLEMENTED / COMPLETE (2026-10-18)** — Decision **D1** resolved and delivered as (a) Durable Object per match (`MatchRoom`), with the `src/worker.ts` custom worker entry, pure engine relocation to `src/room/engine.ts`, atomic CAS commits via `match_commit_action` RPC, and legacy Edge function retirement in P6. |
| Date | 2026-10-18 (Completed; Matrix Rev 3 drafted 2026-10-15) |
| Companion to | `docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md` (Doc A — the *what/when*) — this document is the *where* |
| Evidence base | 35 canonical migrations, 35 callable functions/RPCs, 0 Edge Functions (retired in P6), 53 API routes, `src/room/MatchRoom.ts`, `src/room/engine.ts`, `src/rateLimit/RateLimitDO.ts`, `src/worker.ts`, `wrangler.jsonc` |

> [!IMPORTANT]
> **Implementation Complete:** The placement decisions in this matrix are live in the codebase. All migration phases (P0–P6) have been completed and verified against all CI gates.


### Revision history

| Rev | Date | Change | Finding |
|---|---|---|---|
| 1 | 2026-10-13 | Initial placement matrix | — |
| 2 | 2026-10-13 | **§3B** MOVE rows: added the feasibility caveat and fixed the phase — in **P3 the room delegates to the existing Edge functions**; relocation lands in **P4** | XD-1, MI-4 |
| 2 | 2026-10-13 | **§2/§3C** corrected the definer-function inventory: 17 *callable* definer functions, with trigger functions named separately | MI-1 |
| 2 | 2026-10-13 | **§3D** rate-limit store **decided: DO counters**. KV ruled out (1,000 writes/day free cap) | MI-2 |
| 2 | 2026-10-13 | **NEW §11 risk register** (vendor concentration, portability, free-tier terms, hot-path RPC, placement drift) | MI-3, RK-1 |
| 2 | 2026-10-13 | **§2** added the intent/protocol surface and the missing Durable Object wiring to the inventory | MI-6, FE-1 |
| 2 | 2026-10-13 | **§9** added Postgres write amplification and room→PostgREST egress to the cost model | MI-5 |
| 2 | 2026-10-13 | **§5** invariants de-duplicated — now owned by Doc A Appendix B and referenced here | XD-5 |
| 2 | 2026-10-13 | **§4/§8/§10** added a phase column, gated D1 on the P0 spike, aligned sequencing with Doc A | XD-1, XD-6 |
| 2 | 2026-10-13 | Appendix renumbered to §12; one-line answers updated to reflect the decisions above | — |
| 3 | 2026-10-15 | **§2** DO-wiring row updated to name the `src/worker.ts` custom worker entry as the P0 spike deliverable (`wrangler.jsonc` `main` → `src/worker.ts`) | F1 |
| 3 | 2026-10-15 | **§3B/§10** `match_commit_action` RPC scope corrected to **P4** (P3 merely proxies the untouched Edge functions) | F3 |
| 3 | 2026-10-15 | **§3D/§9/§11** rate-limit decision refined: evaluate the **native CF Rate Limiting binding first**; if DO counters, shard by colo+routeClass+ipPrefix and scope to mutation routes; reads stay in-memory; KV still ruled out. B-R6 added | F6 |
| 3 | 2026-10-15 | **§8/§9** cost guardrail reframed: **Workers Paid ($5/mo) is the Day-1 baseline from P1** with the 240-frames × matches math; B-R3 updated | F7 |
| 3 | 2026-10-15 | **§12** one-line answers corrected (match_commit_action P4; rate limiting native/sharded) | F3, F6 |

---

## 0. Answering the question directly

**Did the migration plan cover placement? Partially — and it left the most important placement question open.**

| Covered in the plan | Not covered |
|---|---|
| Target placement for the *new* pieces (session layer, Durable Object room, private Realtime channels) | A component-by-component inventory of what runs **where today** |
| What must not move (schema, engine, invariants) | An explicit **keep / move / rewrite / new** disposition per component |
| — | **D1 resolved**: DO room (`MatchRoom`) selected as lifecycle authority |

This document closed those four gaps, recorded the resolution of D1 in favour of the Durable Object room (which succeeded in the P0 spike and is fully implemented in `src/room/MatchRoom.ts` and `src/worker.ts`), and documents the production placement with Postgres remaining the system of record and the ledger.

**The framing correction that makes this simple:** compute is *already* on Cloudflare. Your Next.js API routes and `middleware.ts` run in a Worker via OpenNext, and `serviceDb()` already reaches Postgres over HTTP from that Worker. So this is not "Supabase or Cloudflare". It is three narrower questions:

1. **What data may never leave Postgres?** (Answer: all of it that is transactional — §5.)
2. **Which Supabase-hosted *compute* should be co-located with the room?** (Answer: the three Edge Functions and the match fan-out — §3B, *delegated in P3, relocated in P4*.)
3. **Which capabilities do we not have at all and Cloudflare gives us for free?** (Answer: a scheduler, a real rate limiter, and durable per-match state — §3D.)

---

## 1. The rubric

Placement decisions are made against these eight rules, in priority order. When two rules conflict, the lower number wins.

| # | Rule | Consequence |
|---|---|---|
| R1 | **Money and progression math runs in one ACID transaction, in Postgres.** | Ledger, escrow, payouts, vouchers, purchases never leave Postgres — not to D1, not to a Worker. |
| R2 | **Anything that needs a clock per entity runs in a Durable Object.** | Turn timers, AFK strikes, bet window, AI turns. |
| R3 | **Rules validation runs exactly once, from one engine source.** | `lib/engine/core.ts` → every copy via `sync-edge-engine.mjs`; `check:engine` covers all targets. |
| R4 | **Hot-path state that is not a ledger goes to the cheapest correct store.** | Rate-limit counters → native CF Rate Limiting binding (preferred), else **sharded** DO counters; not Postgres, not KV (see §3D). |
| R5 | **Prefer one control plane per concern.** | One deploy pipeline, one secret store, one log surface for game compute. |
| R6 | **Never introduce a second authority, even temporarily.** | Old and new paths are flag-switched either/or. |
| R7 | **Keep the audit trail durable and replayable.** | Every accepted transition lands in Postgres (`match_moves`, `match_rolls`, `match_states`, `match_room_events`). |
| R8 | **Additive, reversible migrations only.** | No drops until a release with zero reads, verified by a static gate. |

---

## 2. Current placement inventory (verified)

| Component | Runs where today | Evidence |
|---|---|---|
| SSR pages, all 47 API routes, `middleware.ts` | **Cloudflare Worker** (OpenNext 1.18) | `open-next.config.ts`, `wrangler.jsonc`, `package.json:9-11` |
| Static assets (89 PNG, 18 GIF, 6 MP3) | **Cloudflare** (Workers static assets, unmetered) | `wrangler.jsonc:14-17` |
| Postgres schema: 43 tables, RLS on all, 9 policies | **Supabase** | `baseline.sql:612-621` + dated migrations |
| Economy/lobby RPCs | **Supabase** — **17 callable `SECURITY DEFINER` functions**: `chips_escrow_place_bet`, `chips_escrow_settle_bets`, `chips_escrow_deposit`, `chips_escrow_withdraw`, `chips_escrow_solvency`, `chips_escrow_spend_purchase`, `chips_escrow_touch`, `purchase_marketplace`, `join_matchmaking`, `join_matchmaking_hybrid`, `join_tournament`, `next_mission_voucher_nonce`, `cash_out_bet`, `settle_match_bets` (frozen), `mark_conversation_read`, `cleanup_matchmaking_queue`, `cleanup_stale_data` | `check-schema.mjs:305-322` counts these and excludes trigger functions |
| Trigger functions *(separate category — not in the 17)* | **Supabase** — `touch_updated_at`, `update_conversation_summary`, `messages_restrict_columns`, `block_coins_mutation`, `prevent_client_player_tampering` | `baseline.sql`, `202609300001`, `202609300018` |
| Rules authority: dice minting, move validation, turn rights | **Supabase Edge Functions** (Deno) | `supabase/functions/{roll-dice,move-auth,resolve-bet}/index.ts` |
| Match lifecycle authority: AI, AFK, timers, bet window, settle trigger, record, stream | **A player's browser tab** | `hooks/useGameEngine.ts:127,428`; `TeamUpContext.tsx:374,740,1460`; `resolve-bet/index.ts:79-115`; `match/record/route.ts:95-132`; `match/stream/route.ts:53-64` |
| Match state fan-out | **Supabase Realtime** public broadcast + **PeerJS** WebRTC | `TeamUpContext.tsx:526`; `lib/peerFactory.ts` |
| Lobby/social realtime | **Supabase Realtime** (`conversations`, `live_chat`, `live_matches`, `matchmaking_queue`) | `202609300016:39`, `202609300018:29` |
| Sessions (app + match) | **Supabase Postgres rows**, token in browser `localStorage` | `app_sessions` / `match_sessions`; `hooks/useAppSession.ts:11` |
| **Intent / protocol surface** *(Rev 2 — MI-6)* | **Shared client code** — `lib/gameProtocol.ts`, `lib/protocol/schemas.ts`, `lib/matchProtocol.ts`. Live union at `gameProtocol.ts:12`: `REQUEST_ROLL`, `REQUEST_MOVE`, `DICE_COMMIT`, `DICE_REVEAL`, `CMD_REQUEST_TRUST`. **There is no `REQUEST_POWER` intent** — power submission goes through `move-auth` `submit-power` | `lib/gameProtocol.ts:12,25,35` |
| Rate limiting | **In-process `Map` in a Worker isolate** — non-distributed by design | `lib/rateLimit.ts:10-19,42`; `hasSharedStore()` unimplemented |
| Push notifications | **Cloudflare Worker** (`web-push` via `nodejs_compat`), subscriptions in Postgres | `wrangler.jsonc:6-9`; `app/api/push/*` |
| Chain event indexer | **Nowhere — skeleton only**, in-memory cache | `lib/chipsIndexer.ts:1-5` ("Minimal event indexer skeleton (Phase 1)") |
| Scheduled jobs | **None exist.** Cleanup functions are granted to `service_role` but nothing calls them | `baseline.sql:575-609`; only cron lines are *commented out* in the frozen archive `migrations/20260904_matchmaking_phase1.sql:38-39` |
| **Durable Object wiring** *(Rev 2 — FE-1; Rev 3 — F1)* | **Absent today**, but the fix is known: a **custom `src/worker.ts` worker entry** that re-exports the OpenNext handler and adds the `MatchRoom`/`RateLimitDO` classes + a WS fast-path + Cron handler, with `wrangler.jsonc` `main` changed from `.open-next/worker.js` to `src/worker.ts` and a `durable_objects`/`migrations` block | `wrangler.jsonc`; `open-next.config.ts`; Doc A §4.4 — this is the P0 spike deliverable |
| Supabase Auth | **Not used** — identity is wallet-signature + custom sessions | no `auth.uid()` in any canonical migration; `lib/supabase.ts` uses the anon key only |
| Supabase Storage | **Not used** — no `.storage.from(` anywhere; avatars are external URLs | grep: zero matches |
| Client direct DB access | **5 tables, read-only, narrow column grants** | `202609300013_db09_grant_hardening.sql:69-83` |

---

## 3. Target placement

### 3A. REWRITE in place (same home, different code)

These are not placement changes — they are correctness changes that happen to live where they already live. Listing them here because "rewrite" and "move" get conflated.

| Component | Today | Target | Why rewrite, not move |
|---|---|---|---|
| Session/auth module | `requireAppSession(wallet, sessionId)` compared against two client-supplied values | `requireSession(scope, capability)` from a cookie | The primitive itself is wrong (bearer UUID vs scoped session); moving it changes nothing |
| SIWE login | Client-chosen nonce, rejected after first use | Server-issued single-use challenge | Same |
| Authority call sites in the client | `computeAuthority`, `isAuthority`, `broadcastAction`, `HOST_ELECT` election | Deleted; `useGameEngine` keeps `computeAuthority` for **offline mode only** | Removing authority from the client is a code deletion, not a relocation |
| Lifecycle endpoints (`/api/match/record`, `/api/match/stream`, `/api/live-matches/window`) | Client-callable, host-signed | Internal room→server calls; endpoints become admin-only | The signature model is the bug (P1/P2) |
| `lib/netcode/*` gates | Authority gate for guests | Client-side UX guards only (optimistic render, resync, dedup) | Authority moves to the room; the gates keep their dedup/resync value |
| `middleware.ts` rate limiting | In-process `Map` | Same file, **DO-backed counter** (§3D) | Home is already correct (it is a Worker); the store is the gap (R4) |
| Onboarding game-track progress | Client-reported deltas → CHIPS vouchers | Derived server-side from recorded matches | Trust-boundary fix, not a move |

### 3B. MOVE Supabase → Cloudflare

> **Implementation Status: COMPLETE (P0–P6 executed).** Every row below was proven in the P0 spike, staged through P1–P5, and finalized in P6. The `roll-dice`, `move-auth`, and `resolve-bet` Edge functions are deleted; rules validation runs in-process in `src/room/engine.ts` via `MatchRoom.ts` with atomic CAS commits via `match_commit_action` RPC.

| Component | From | To | Phase | Rationale | Preserve |
|---|---|---|---|---|---|
| `roll-dice` (dice minting) | Supabase Edge | Room DO (called in-process) | **P4** (P3: the room calls the Edge function) | Removes a network hop from the critical action path; the mint and the state write become one atomic commit (R1) | `match_rolls_match_turn_uniq`; one face per `(match_id, turn_seq)`; `minted_by_kind` records the minter |
| `move-auth` (move/pass/power validation) | Supabase Edge | Worker/DO module, **validation logic kept in TypeScript** | **P4** (P3: the room calls the Edge function) | Engine parity is the crown jewel — do not rewrite rules into SQL | Engine parity gate; golden replay hashes; the CAS becomes one RPC (Doc A §4.6/§5-P3) |
| `resolve-bet` (settle trigger) | Supabase Edge, host-signed | Room DO → Postgres RPC | **P4** | The server already knows the winner; the player signature is the anomaly | `chips_escrow_settle_bets` guard; escrow arming interlock; pool-authority EIP-712 co-sign |
| Match state fan-out | Supabase Realtime public broadcast | Room DO WebSocket (primary), private Realtime channel (fallback) | **P3** | Authorized rooms, hibernating sockets, server-side `seq` | `shouldApplyGameAction` semantics unchanged on clients |
| Rate-limit counters | In-process `Map` | **Native CF Rate Limiting binding preferred; sharded DO counter fallback** (decided — §3D, Rev 3 F6) | **P1** | Currently `limit × isolates` — a documented non-defense | Same limiter API (`checkRateLimit`) |
| Cleanup jobs (`cleanup_matchmaking_queue`, `cleanup_stale_data`) | Never invoked | Cloudflare Cron Trigger → Worker → Postgres RPC | **P1** | They exist and are unreachable; the queue grows unbounded today | `service_role`-only grants |
| Chain event indexer | Skeleton, in-memory | Cron → Worker → Postgres RPC sink | **P6** (productionised) | Production needs a durable cursor and reorg depth; in-memory loses everything on redeploy | `chips_events` U(chain_id, tx_hash, log_index) idempotency |

**The one architectural upgrade that comes with the move — collapse persistence into a single RPC.**

Today `move-auth` performs a compare-and-swap and then *confirms* it (`confirmSequenceAfterWrite` in `_shared/networkBoundary.ts` exists precisely because that is two round trips with a window between them). When validation moves to a Worker, the write must collapse into **one** Postgres RPC:

```
match_commit_action(
  p_match_id, p_expected_seq, p_actor, p_kind, p_payload
) → { seq, state, code }
```

It atomically: checks `seq = p_expected_seq` → validates the roll binding → consumes the roll (`status='consumed'`, `consumed_seq`) → inserts `match_moves` → bumps `match_states.seq` → returns the new state, or returns `STALE_SEQ`. One transaction, no confirmation step, no race window. Validation stays in TypeScript where the engine lives; only the *commit* becomes atomic. This is the single highest-value production-grade change in the whole placement exercise. **It is a P4 deliverable** (Rev 3 — F3): in P3 the room merely *proxies* the untouched Edge functions, so the RPC does not exist yet. **Its gate consequences are scoped in Doc A §5-P4** (`check:schema` A1/A2, DB-mode definer assertions, `check:routes`).

### 3C. KEEP in Supabase

| Component | Why it must stay |
|---|---|
| **Postgres as the system of record** (43 tables) | R1. SQLite/D1 has no RLS, no triggers of this kind, a 100k row-write/day free cap, and **hard-fails over quota** (since Sept 2026) instead of degrading. The ledger cannot live there. |
| **All 17 callable `SECURITY DEFINER` functions** | They are the money path (full list in §2). Each already encodes idempotency and interlock logic in SQL. Rewriting them anywhere else is how money bugs are born. |
| **Trigger functions** *(separate category — also §2)* | `messages_restrict_columns`, `block_coins_mutation`, `prevent_client_player_tampering`, `touch_updated_at`, `update_conversation_summary`. Not client-callable and excluded by the definer gate; they stay because they enforce invariants inside the DB. |
| **RLS + grants model** | The DB-09 hardening reduced the client surface to 5 tables with narrow column grants. That posture is the backstop; it stays. |
| **Invariant constraints** | **Single source of truth: Doc A Appendix B.** Not restated here (Rev 2 — XD-5). |
| **Durable audit tables** | `match_moves`, `match_rolls`, `match_states`, `chips_events`, `chips_escrow_ledger`, `match_room_events` (new). R7. |
| **Session rows** | `sessions` (new) lives in Postgres even though verification happens at the edge — revocation and rotation must be transactional. |
| **Lobby/social Realtime** | `live_chat`, `live_matches`, `matchmaking_queue`, `conversations` postgres_changes already work and are low-risk. No reason to churn them. |
| **Push subscriptions** | Postgres is the right store; the sender is already a Worker. |
| **Supabase Studio / backups / SQL editor** | Operational tooling with no Cloudflare equivalent worth building. |
| **`pgcrypto`, publication, extensions** | Already relied upon; the scratch-cluster replay technique depends on them. |

### 3D. NEW — capabilities Cloudflare gives that do not exist today

| Capability | Why it matters | Free-tier reality |
|---|---|---|
| **Durable Object per match** | The only way to get a server-side clock per match (R2). Hibernating WebSockets, SQLite storage, alarms. | SQLite-backed DOs are available on Workers Free; room traffic shares the Worker's 100k req/day budget. **Integration path unproven — P0 spike.** |
| **Cron Triggers** | We currently have **no scheduler at all** — cleanup functions are unreachable and the indexer is a skeleton. This closes both. | Cron triggers available on the free plan |
| **Distributed rate limiting** *(Rev 2 — MI-2; Rev 3 — F6)* | Turns `limit × isolates` into `limit` | **Prefer the native Cloudflare Rate Limiting binding** (`rate_limiting` config) — it runs in the local colo with zero cross-region hops and no request amplification. If a DO counter is used, **shard it** by `env.RATE_LIMITER.idFromName(\`${colo}_${routeClass}_${ipPrefix}\`)` so counters are colo-local, and apply DO-backed limiting **only to high-value mutations** (`/api/auth/*`, `/api/match/start`, `/api/chips/*`); **read/static routes stay in-memory per isolate**. **KV is ruled out** — its free tier is 1,000 writes/day, unusable for per-IP counters. |
| **Workers Queue** *(conditional)* | Retries and backfill for the indexer and settlement attempts | **Paid plan only** — adopt only if the indexer needs backfill beyond a cron window |
| **R2** *(conditional)* | Only if user-generated uploads appear (custom avatars, replays). Today there are none. | 10 GB free, egress free |
| **Workers Analytics / Logs** | Per-match observability without Sentry round-trips | Basic tier free |

---

## 4. Target placement at a glance

| # | Component | Today | Target | Disposition | Phase |
|---|---|---|---|---|---|
| 1 | SSR + API routes + middleware | CF Worker | CF Worker | KEEP | — |
| 2 | Static assets | CF | CF | KEEP | — |
| 3 | Postgres schema, RLS, constraints | Supabase | Supabase | KEEP | — |
| 4 | 17 callable economy/lobby RPCs + trigger functions | Supabase | Supabase | KEEP | — |
| 5 | `roll-dice` | Supabase Edge | Room DO | MOVE (delegate P3, relocate P4) | P3/P4 |
| 6 | `move-auth` | Supabase Edge | Worker/DO + one commit RPC | MOVE + REWRITE | P3/P4 |
| 7 | `resolve-bet` | Supabase Edge, host-signed | Room DO → RPC | MOVE + REWRITE | P4 |
| 8 | Match state fan-out | Realtime + PeerJS | Room DO sockets | MOVE | P3 |
| 9 | Lobby/social realtime | Supabase Realtime | Supabase Realtime (private channels) | KEEP + harden | P5 |
| 10 | App/match sessions | Postgres rows + localStorage token | Postgres rows + HttpOnly cookie, edge-verified | REWRITE | P1 |
| 11 | Rate limiting | In-process Map | Native CF binding / sharded DO | REWRITE store | P1 |
| 12 | Cleanup jobs | Never run | CF Cron → Worker → RPC | NEW | P1 |
| 13 | Chain indexer | Skeleton, in-memory | CF Cron → Worker → Postgres sink | NEW | P6 |
| 14 | Match lifecycle (AI/AFK/timers/bet/settle/record/stream) | Player device | Room DO | MOVE + REWRITE | P4 |
| 15 | PeerJS | Primary P2P | Demoted fallback, then retired | DEMOTE → RETIRE | P5/P6 |
| 16 | Push notifications | CF Worker + Postgres | Unchanged | KEEP | — |
| 17 | Supabase Auth | Unused | Stay unused | DO NOT ADOPT | — |
| 18 | Supabase Storage | Unused | Stay unused (R2 if uploads appear) | DO NOT ADOPT | — |

---

## 5. Data placement rules (hard)

These are non-negotiable; they are what "production grade" means for data. Game-rule and trust invariants are **not** duplicated here — they are owned by **Doc A Appendix B** (Rev 2 — XD-5).

1. **The ledger never leaves Postgres.** Balances, escrow, payouts, vouchers, purchases, coin mutations: `chips_escrow_*`, `chips_escrow_ledger`, `coin_ledger`, `spectator_bets`. No D1, no KV, no DO storage as a source of truth.
2. **Every balance mutation is a conditional update or an RPC, never a read-modify-write from application code.** Already enforced by the Phase 1 gate; the placement change must not weaken it.
3. **The Durable Object holds hot match state; Postgres holds the truth.** A room may be evicted at any time. On eviction it rehydrates from DO storage and reconciles against `match_states`; the DB row wins on any disagreement.
4. **Room-local storage is disposable.** Nothing may exist only in the room. If the room's SQLite and `match_states` disagree, `match_states` is correct.
5. **Every server-originated lifecycle action is auditable.** Timers fired, AFK strikes, AI turns, bet windows, settlements, recordings → `match_room_events` rows, append-only, with the retention policy in Doc A §4.6.
6. **Session tokens are stored hashed.** `sha256(token)` only; the raw token exists only in the cookie and in transit.
7. **No secret in the client bundle, ever.** Worker secrets for service role and settle keys; a static scan gate asserts no `NEXT_PUBLIC_*` secret-shaped value.
8. **Postgres stays the only writer of record for `seq`.** The room proposes; the RPC disposes.

---

## 6. Production-grade gap analysis

What is *not* production grade today, and which placement decision fixes it.

| # | Gap | Severity | Fixed by | Effect |
|---|---|---|---|---|
| G1 | Rate limiting is per-isolate (`limit × isolates`), self-documented as not a real defense | High | Native CF binding preferred, else sharded DO counter (P1, Rev 3 F6) | A real limiter; also removes the temptation to put limits in Postgres |
| G2 | No scheduler exists; cleanup RPCs are granted but unreachable; matchmaking queue and stale data grow unbounded | High | CF Cron (P1) | Queue hygiene, session reaping, challenge GC, keep-alive |
| G3 | Match lifecycle depends on a player's browser tab (host SPOF) | High | Room DO + alarms (P4) | Matches complete when a player's phone dies |
| G4 | Result integrity is player-declared | Critical | Server-derived winner + room-originated record (P2/P4) | Progression and settlement can no longer be forged |
| G5 | Realtime rooms are public-by-default | High | Room sockets (P3) + private Realtime channels (P5) | Closes the last open netcode finding (NET-03a/b) |
| G6 | Sessions are exfiltratable bearer tokens in `localStorage` | High | Cookie sessions + scopes + rotation (P1) | XSS/URL-leak impact bounded |
| G7 | Two round trips with a window between CAS and confirmation | Medium | `match_commit_action` RPC (**P4** — P3 only proxies the Edge path) | Atomic commits; removes a race class |
| G8 | Chain indexer is in-memory; a redeploy loses the cursor | Medium | Cron + Worker + Postgres cursor (P6) | Correct ingestion with reorg depth |
| G9 | No per-match lifecycle audit | Medium | `match_room_events` (P4) | Disputes become answerable from data |
| G10 | Engine exists in two copies (client, Edge) with no third-target gate if the room validates | Medium | `sync-edge-engine.mjs` + `check:engine` covering all copies (**P4**, scoped in Doc A §5-P4) | Prevents the silent fork that would invalidate golden replays |
| G11 | Compute split across two control planes (CF for app, Supabase for rules) | Low | Consolidate game compute on CF (P4) | One deploy, one secret store, one log surface |
| G12 | **Durable Object integration into an OpenNext Worker is unwired and unproven** *(Rev 2)* | Critical | **P0 spike** (Doc A §5-P0) | **RESOLVED:** Proven via `src/worker.ts` custom entry wrapping OpenNext handler and deploying cleanly. |

---

## 7. Explicit non-moves (anti-patterns)

| Tempting move | Why not |
|---|---|
| Move the ledger/escrow to D1 for "edge speed" | D1 has no RLS, a 100k row-write/day free cap, and hard-fails over quota. Money math needs ACID and idempotency keys that already exist in Postgres RPCs. |
| Move all of Postgres to Cloudflare (D1/Hyperdrive) | 43 tables, 17 definer functions, RLS, triggers, generated columns, publication. The migration cost is total and the benefit is zero — the DB is not on the hot path. |
| Adopt Supabase Auth | We are wallet-first with a custom challenge flow. Adopting Supabase Auth would add a second identity system and rewrite every route for no gain. |
| Rewrite rules validation into SQL | The engine is shared TypeScript with golden-replay hash stability. SQL reimplementation forks it (G10). Keep validation in TS; make only the commit atomic. |
| Move Realtime wholesale to the room | Lobby/social/chat channels are low-risk and working. Churn there buys nothing. |
| Keep PeerJS as a parallel authority "for resilience" | Two authorities is the failure mode this migration exists to remove (R6). |
| Put rate-limit counters in Postgres | Puts the DB on the abuse path — the opposite of R4. |
| Use KV for rate-limit counters *(Rev 2 — MI-2)* | KV's free tier is 1,000 writes/day — it cannot carry per-IP counters. Use the native CF binding, or sharded DO counters (Rev 3 — F6). |
| Delete the host concept from the UI | Rename it to "room owner" (lobby/invite semantics). Removing it is user-visible churn with no security value. |

---

## 8. Resolution of D1 (Delivered & Implemented)

**Delivered: (a) Durable Object per match as lifecycle authority, with Postgres as the system of record and the only writer of `seq`.**

> **Implementation Record:** This architecture was proven in the P0 spike (`src/worker.ts`), delivered across P3/P4, and is live in `src/room/MatchRoom.ts`. The DO room holds hot match state and drives turn deadlines, AFK strikes, and AI turns via timer alarms, committing state transitions atomically to Postgres via the `match_commit_action` RPC.

| Option | Verdict | Reasoning |
|---|---|---|
| **(a) DO per match** | **RESOLVED & IMPLEMENTED** | Only option with a per-match server clock (R2). Free-tier viable (SQLite-backed DOs). Hibernation keeps idle matches cheap. Failover is rehydration, not re-election. Successfully delivered in `src/room/MatchRoom.ts`. |
| (b) Postgres + Realtime + `pg_cron` | Rejected as authority | No per-match clock: `pg_cron` is minute-granularity, so turn deadlines, AFK strikes, and the 3-second bet window cannot be driven server-side. |
| (c) Keep player-as-authority | Rejected & Retired | This was the legacy status quo and source of G3/G4, fully retired in P6. |

**Why not "Postgres-authority with a thin fan-out layer":** it sounds simpler but it does not solve the clock. You would still need *something* per-match holding a timer, and that something is a Durable Object. Choosing (b) means building the room anyway, minus the guarantees.

**Cost guardrail (Rev 3 — F7):** the room's socket traffic shares the Worker's 100k requests/day free budget, and a WebSocket hibernation wake counts as 1 Worker request per frame. An active 4-player match averages ~240 frames, so ~400 completed matches/day ≈ 96k requests/day — the free ceiling is hit with **fewer than ~150 daily active players**. **Workers Paid ($5/mo, 10M requests, 50 ms CPU) is therefore the expected Day-1 baseline from P1, not an emergency contingency**; treat the >70k/day figure as a ceiling alarm, and budget for Paid from day one. Room CPU is billed separately from the Worker's, which is why the 10 ms Worker CPU limit does not constrain room logic.

---

## 9. Cost and limits per placement

| Component | Plan | Limit that matters | Trigger to upgrade |
|---|---|---|---|
| Worker (SSR + API + WS upgrade) | CF Free (**Workers Paid $5/mo is the Day-1 baseline — Rev 3 F7**) | 100k req/day, 10 ms CPU | **Workers Paid ($5, 10M req, 50 ms CPU) from P1**; >70k/day retained as a ceiling alarm. ~240 frames × matches ⇒ ~96k req/day at ~400 matches, so <150 DAP exhausts free (§8) |
| Room DO | CF Free (SQLite-backed) | Shares the Worker request budget; DO CPU separate | Paid baseline covers it (§8) |
| Cron triggers | CF Free | Available on free | n/a |
| Rate-limit store *(Rev 3 — F6)* | CF Free (native binding) or CF Free (sharded DO) | **Native CF Rate Limiting binding preferred** (local colo, zero cross-region hops); if DO counters, shard by colo+routeClass+ipPrefix and scope to mutation routes; reads stay in-memory | Native binding: none. DO: request volume approaching the Worker budget |
| Static assets | CF Free | Unmetered requests | n/a |
| Postgres | Supabase Free | 500 MB, 5 GB egress, pauses after ~1 week idle | Approaching 500 MB or a pause event → Supabase Pro ($25) |
| **Postgres write amplification** *(Rev 2 — MI-5)* | Supabase Free | Each accepted action writes `match_moves` + `match_states` + roll consumption; P4 adds `match_room_events` per lifecycle event. Budget roughly **2–4 rows per action** plus lifecycle rows — the growth driver against the 500 MB cap. | Row growth trending to the cap → retention/GC first (Doc A §4.6), then Pro |
| **Room → PostgREST egress** *(Rev 2 — MI-5)* | Supabase Free | Every commit is an HTTPS round trip from the edge to the Postgres region; it counts against the 5 GB free allowance. Batching lifecycle events reduces it. | Egress trending to 5 GB → batch harder, then Pro |
| Edge Functions | Supabase Free | 500k invocations/month | **Moot from P4** — delegated in P3, relocated in P4, deleted in P6 |
| Realtime | Supabase Free | 200 peak connections, 2M messages/month | Match channels move to DO in P3, so this budget now covers lobby/social only |
| Chain indexer | CF Free (Cron) | Cron frequency; RPC provider rate limits | Backfill needs → Workers Paid + Queues |

---

## 10. Sequencing execution record (P0–P6 COMPLETE)

> **Implementation Record:** All placement work across phases P0 through P6 has been executed, tested, and merged into `main`. The placement architecture is frozen per ADR-002.

| Phase (from Doc A) | Placement work in that phase | Status |
|---|---|---|
| **P0** | Ratified this matrix; filed D1 decision; **ran DO-in-OpenNext spike** (G12) via `src/worker.ts` with all pass criteria met; merged problem register; fixed citations | **COMPLETE (2026-10-18)** |
| **P1** | Sessions in Postgres (`sessions` table, `__Host-ludo_session` cookie, SHA-256 tokens), verified at the edge; **rate-limit store → sharded DO counters scoped to mutations** (`src/rateLimit/RateLimitDO.ts`, G1, F6); **CF Cron for cleanup** (`cleanup_matchmaking_queue`, `cleanup_stale_data`, G2); retention/GC for `auth_challenges` + `sessions`; Workers Paid baseline | **COMPLETE (2026-10-18)** |
| **P2** | Server-derived authority in the existing API routes (winner derivation from `match_states.state.winner`, server-assigned `room_owner`, strict seat authority) | **COMPLETE (2026-10-18)** |
| **P3** | Room DO introduced as **transport + seq + fan-out + reconnect** (`src/room/MatchRoom.ts`); timer min-heap + `blockConcurrencyWhile`/FIFO queue; WS auth via ticket / in-band `join`; fan-out on room sockets; in-flight cutover rule | **COMPLETE (2026-10-18)** |
| **P4** | **Relocation landed**: validation + minting moved in-process into `MatchRoom`; **`match_commit_action` RPC (G7) created + adopted** (atomic commit, one transaction); engine parity verified across copies (`src/room/engine.ts`); server clock drives turn timers and deterministic AI; `match_room_events` audit (G9) + retention | **COMPLETE (2026-10-18)** |
| **P5** | Private Realtime channels with `realtime.messages` RLS policies (G5); PeerJS demoted to degraded fallback | **COMPLETE (2026-10-18)** |
| **P6** | PeerJS host paths retired; **Edge Functions (`roll-dice`, `move-auth`, `resolve-bet`) and `_shared/engine.ts` deleted**; chain indexer productionised with Postgres cursor (G8); docs updated; static host-retirement gate passing | **COMPLETE (2026-10-18)** |

**Placement freeze:** Live and enforced. No component may change home without an ADR entry. Placement churn is how dual authority creeps back in.

---

## 11. Risk register *(Rev 2 — new, per MI-3 / RK-1)*

Doc A's register covers the migration's execution risks. This one covers risks **introduced by the placement decisions themselves** — the trade-offs this document recommends.

| ID | Risk | L | I | Mitigation | Trigger to act |
|---|---|---|---|---|---|
| **B-R1** | **Vendor concentration.** Lifecycle authority moves onto a Cloudflare runtime-specific storage API (DO SQLite + alarms + hibernation), increasing single-vendor coupling — the same class of exposure flagged in the earlier Vercel/Cloudflare tier analysis. | M | H | Keep the room's *logic* vendor-neutral (the shared TS engine, no CF-only business rules); isolate CF-specific code in a thin adapter; record an exit trigger. The portability cost is the room's storage API, not the rules. | Any Cloudflare pricing/terms change affecting Workers, DOs, or free-tier allowances |
| **B-R2** | **Room-local storage is not portable.** Rebuilding the room on another runtime means reimplementing DO SQLite + alarms. | M | M | Rule R7 + §5 rule 4 already forbid room-only state: everything authoritative is in Postgres, so a room rebuild is a transport rewrite, not a data migration. Keep it that way. | Any proposal to store authoritative state only in the room |
| **B-R3** | **Free-tier terms change / budget exhaustion** (DO availability on free, request budget, hibernation billing). | M | M | **Workers Paid ($5/mo) is the expected Day-1 baseline from P1** (Rev 3 — F7); the >70k/day figure is a ceiling alarm, not a trigger-to-upgrade event. 240-frames × matches math tracked per cohort. | Sustained >70k req/day, or a free-tier allowance reduction |
| **B-R4** | **`match_commit_action` becomes a hot-path single point.** One RPC now serves every accepted action. | L | H | It is a single-row CAS on an indexed key (`match_states.match_id`), the shape of the current write path; load-test it in P4 against `test:concurrency`. | p95 commit latency regression, or lock contention in `test:concurrency` |
| **B-R5** | **Placement drift after P3** — a later change quietly re-introduces a second authority or a second store of truth. | M | H | The placement freeze (§10) plus a static gate that fails if a retired identifier reappears (Doc A §5-P6). | Any PR touching authority without an ADR entry |
| **B-R6** | **Rate-limit DO adds cross-region latency / request amplification** (a global DO limiter on every route = 150–250 ms RTT for non-`us` users + 2× request count). | M | H | Prefer the native CF Rate Limiting binding (local colo); if DO counters, shard by colo+routeClass+ipPrefix and scope to mutation routes, reads in-memory (Rev 3 — F6). | Latency regression on non-`us` cohorts, or request-count spike |

---

## 12. Appendix — one-line answers

- **Rewrite:** session/auth module, SIWE login, client authority call sites, lifecycle endpoints' trust model, onboarding game-tracks, the rate-limit *store*.
- **Move Supabase → Cloudflare:** `roll-dice`, `move-auth`, `resolve-bet` (delegated in P3, relocated in P4), match state fan-out (P3), rate-limit counters (P1), cleanup jobs (P1), chain indexer (P6).
- **Keep in Supabase:** Postgres schema + RLS + constraints, all 17 callable `SECURITY DEFINER` RPCs plus the trigger functions, session rows, all audit tables, lobby/social Realtime, push subscriptions, Studio/backups.
- **New on Cloudflare:** Durable Object room (gated on the P0 spike; **delivered as `src/worker.ts` custom worker entry** — Rev 3 F1), Cron triggers, **rate limiting via native CF binding or sharded DO counters scoped to mutations** (Rev 3 F6), `match_commit_action` RPC call path (**P4**; the RPC itself lives in Postgres), conditional R2/Queues.
- **Never move:** the ledger, RLS, money RPCs, the engine source, the `seq` writer.
- **Production-grade wins, ranked:** server-owned clock (G3) → server-derived results (G4) → real rate limiting (G1) → atomic commits (G7) → authorized rooms (G5) → scheduler (G2) → cookie sessions (G6) → durable indexer (G8) → lifecycle audit (G9) → engine parity gate (G10).
- **Matrix validation:** The P0 DO-in-OpenNext spike succeeded in `src/worker.ts`, validating this matrix, and all phases (P0–P6) are now fully implemented and verified in production.
