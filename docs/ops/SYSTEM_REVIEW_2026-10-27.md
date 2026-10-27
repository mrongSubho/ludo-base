# System Architecture Deep-Dive — 2026-10-27

**Baseline reviewed:** `ccc6beb` (main)
**Method:** two deep-review passes (server-authority layer; client-orchestration layer) plus direct review of the DB/RLS layer, the on-chain settlement surface (relayer, free-match sync, attestations), CI, and configs. All headline findings (C1, C2, H1, H3) were verified first-hand against the code at HEAD.
**Relationship to prior reviews:** `docs/ops/SYSTEM_REVIEW.md` (register, now honest after the 2026-10-20 re-verification) and `docs/ops/REVIEW_VERIFICATION_2026-10-20.md`. This review does not re-open closed items; it reviews the P6 server-authority world that did not exist during the Oct-20 audit, plus the Oct-27 relayer/lazy-sync surface.

---

## 0. TL;DR

The architecture is fundamentally sound and unusually well-instrumented: a genuine single-authority Durable Object, default-deny RLS, a seq-gated state funnel, golden-replay and concurrency CI gates. But the review surfaced **two critical trust-boundary breaks inside the new authority layer itself**:

1. the Durable Object accepts an unvalidated client-authored board as its "authoritative" seed (C1); and
2. the client's degraded-mode authority path is structurally dead — AGENTS.md invariant 4 no longer describes the code, and a mid-match room outage freezes every guest (C2).

Below those: a silent DO↔Postgres commit-failure mode that can strand settlement (H1/H2), an escrow cash-out double-spend (H3), and a hidden-information leak on the room WebSocket that violates AGENTS.md rule 8 (H4).

The Oct-20 lesson — a register that marks unchanged code "Closed" retires findings — has been applied to the register, but the P6 authority layer has re-opened the same *class* of bug in new places. The remediation list in §7 is ordered by trust impact, not by file count.

---

## 1. The system as it stands

```
Client (Next.js SPA, app/page.tsx)
  ├─ RoomClient WS ──▶ Cloudflare Worker ──▶ MatchRoom DO (single authority)
  │     intents REQUEST_ROLL/MOVE/POWER → src/room/engine.ts (generated from lib/engine/core.ts)
  │     every transition: DO SQLite (state,seq) → Postgres RPC match_commit_action → broadcast
  ├─ PeerJS + Supabase relay (intents/lobby/chat only — state verbs peer-transport-only, TU-1)
  └─ HTTP session v2 (SHA-256 tokens, 2h match TTL, seat binding) ──▶ ~58 API routes
On-chain (Base): MatchPool.sol (escrow+settle, edgeSigner+hostSig EIP-712) · MissionSystem (pull claims,
  EIP-712 free-match attestations) · server relayer pays gas for paid matches; players pay for free-match sync
Data (Supabase): deny-by-default RLS on all 27 tables, SECURITY DEFINER RPCs locked to service_role
```

The migration from P2P-host authority to the MatchRoom DO (S0–S5, P6) is well-executed:

- Engine drift is structurally handled: `src/room/engine.ts` is generated verbatim from `lib/engine/core.ts` by `scripts/sync-edge-engine.mjs`, and `npm run check:engine` (hash gate) passes at HEAD.
- Every state transition commits through `match_commit_action` with optimistic concurrency (seq-checked, `FOR UPDATE`, service-role-only grant, seed-once semantics).
- Session v2 has real scope/capability binding: SHA-256-only token storage, seat binding verified against `match_seats` before issuing match scope (`lib/sessionV2.ts:453-466`), atomic single-use challenge consumption.
- `lib/poolAuthority.ts` reads every value-bearing settlement input from the chain, never the body.
- The Oct-27 relayer/lazy-sync work landed with server-side batch caps (`BATCH_SIZE = 10` enforced server-side in `app/api/matches/unsynced/route.ts`) and session gating.

### Strengths worth explicit preservation

1. **The thin-shell/core DO split** (`MatchRoom.ts` → `MatchRoomCore.ts`), with a documented reason and test-real construction (the core compiles without `cloudflare:workers`).
2. **The generated-engine hash gate** — eliminates the dual-engine drift class; engine comments carry deep regression history (ENG-01..14).
3. **`match_commit_action` optimistic concurrency** — seq check, `FOR UPDATE`, service-role-only grant, seed-once semantics, and honest hotfix migration history.
4. **Session v2 shape** — SHA-256-only storage, default-deny RLS on `sessions`/`auth_challenges`, scope model, seat binding, honest doc-comments on dual-read fallbacks.
5. **`lib/poolAuthority.ts` philosophy** — all value-bearing inputs from the chain; authority compared against the on-chain record; explicit refusal of lone-winner 4-seat settlements (host-bond capture).
6. **`/api/match/record` idempotency** — canonical match identity comparison, `finished_at` conditional-update replay block, winner derived from `match_states`, wager caps applied symmetrically to win and loss branches (the Oct-20 residual R1 is fixed).
7. **Pure decision modules** (`authorityGate`, `flushGate`, `resync`, `matchFsm`, `matchTimer`, `hostIntent`) harness-tested without React.
8. **`DedupStore`** (`lib/netcode/dedup.ts`) — TTL + LRU + high-water replay guard, memory-bounded *and* replay-safe.
9. **Layered, honestly-documented rate limiting** — each layer's file states exactly what it does not buy; pinned by `scripts/rate-limit.test.ts`.
10. **CI posture** — golden replay (≥50 deterministic matches), engine diff (1200 seeded matches), concurrency gate on real Postgres, route-auth matrix, motion/RLS/schema gates, Foundry suite.
11. **Docs discipline** — ADR-002, workload placement matrix, and a findings register that now says "Open" when it means Open.

---

## 2. Critical

### C1 — The authority adopts a client-authored board verbatim

`src/room/MatchRoomCore.ts:470-519`

The `seed` frame handler checks only `meta.role === 'seat'` — **any** authenticated seat may seed, not just the host (the comment says host; the code does not enforce it). The payload is cast `as GameState` with zero validation: no check against `match_seats`, no shape check, no `pickPersistedState` whitelist (the SEC-32 whitelist exists in the engine but is unused here), no digest.

The self-seed path (`MatchRoomCore.ts:252-337`) normally pre-empts client seeding, **but it silently no-ops when `match_seats` rows are missing — and `/api/match/start` swallows seat-assignment failures with only `console.warn` (`app/api/match/start/route.ts:178-184, 217-223`).**

Exploit: a seat in that failure window (or winning the connect race) seeds a doctored board — opponents' tokens in the yard, own tokens at position 50, typed power tiles placed on their own path. Everything downstream then derives from attacker-authored fiction: engine decisions, the recorded `match_states.state.winner`, `/api/match/record`'s winner cross-check, and the `player_free_matches` sync attestations. The "server authority" becomes a rubber stamp. (Wagered pools still settle by on-chain host/edge signatures, but progression, missions, and any bet outcome keyed to the recorded winner are falsifiable.)

**Fix:** host-only seed, validated against `match_seats` and the match shape and passed through the engine's persisted-state whitelist — or drop the client-seed path entirely, since the room self-seed already covers the networked flow.

### C2 — The P2P-degraded authority path is dead code; AGENTS.md invariant 4 no longer describes the system

`hooks/useGameEngine.ts:127-133`

`computeAuthority` is called with hardcoded `isHost: false` (S5, commit `386dc82`), and the HOST_ELECT election was retired in P6 (`TeamUpContext.tsx:665-672`) — so no client can ever qualify as the P2P authority. But the degraded path is still fully armed end-to-end:

- `handleRoll` / `moveToken` send intents when the room is down (`hooks/useGameActions.ts:400-404, 830-833`).
- TeamUpContext enqueues them and ACKs them as "accepted" (`TeamUpContext.tsx:1059-1074, 1310-1323`), so the guest's ACK-watch stops retrying.
- The queue's only consumer is the effect gated on `isAuthority` (`useGameEngine.ts:468-500`) — which can never fire.
- The host's `ENGINE_STATE` broadcasts carry `seq: serverSeqRef.current`, which stays `0` in pure P2P, and `authorityGate` requires `seq > knownSeq` plus `source:'match_states'` (`lib/netcode/authorityGate.ts:59-63`) — guests reject every hint.
- The REA-11 engine→context flush is dead for the same reason (`shouldFlushServerState` always returns `'hold'`, `lib/netcode/flushGate.ts:33`).

**User scenario:** when the room WS dies mid-match (the implementation record documents live "HOST MIGRATING / Connection Lost" incidents from 2026-10-24), the host keeps playing on local compute while every guest's taps ACK, do nothing, and their boards never move. No `HostMigrationPanel` appears because `app/page.tsx:1082` requires `!isLobbyConnected`, which is false in a P2P lobby. The intent queue grows unboundedly.

The Oct-20 audit's core lesson applies here: a register claiming "Closed" for code that no longer exists retires findings. AGENTS.md invariant 4 ("while it is not connected the P2P host is the authority and guests ask it via the same intents") is now doing exactly that.

**Fix:** decide the world — either restore P2P host authority (restore `isHost` in `computeAuthority` behind the snapshot-proof gate) or delete the intent path and make room-loss fail loudly with an explicit UX. Then update AGENTS.md to match the decision.

---

## 3. High

### H1 — `commitToPostgres` ignores the RPC result entirely

`src/room/MatchRoomCore.ts:1119-1137`

The `match_commit_action` fetch never checks `res.ok` or the body. The RPC returns HTTP 200 with `{ok:false, error:'STALE_SEQ'}` on rejection (`supabase/migrations/202610230005_fix_match_commit_types.sql:112-118`), which is indistinguishable from success here. Because `applyNewState` (`:1144-1156`) advances DO storage *before* committing, a Supabase outage or a rejected commit means the DO plays on while `match_states` freezes — no retry, no reconcile, no alert beyond `console.warn`.

Failure end-to-end: the winning move commits in-DO only → `match_states` never records a winner → `/api/match/record` refuses session-based settlement (`SERVER_WINNER_REQUIRED`, `app/api/match/record/route.ts:231-252`) → progression lost and bet-settlement windows stuck.

### H2 — `state` and `seq` are two separate DO-storage puts

`src/room/MatchRoomCore.ts:1148-1149`

DO storage puts are individually atomic, but the pair is not. A kill between them reloads (`:200-208`) with new state + old seq; the next commit then sends `expected_seq = old_seq` while Postgres already holds `old_seq+1` → permanent `STALE_SEQ`, which H1 silently swallows.

**Fix (with H1):** single `storage.put({state, seq})` map call; treat `{ok:false}` as an authority-stop with a reconcile path.

### H3 — Escrow cash-out double-spend

`app/api/spectator-bets/route.ts:41-77` + `supabase/migrations/202609300005_spectator_bet_escrow.sql:342-365`

Verified first-hand: `chips_escrow_withdraw` debits the balance unconditionally (`update … set balance = balance - p_amount where … and balance >= p_amount`) while the ledger insert is `on conflict (wallet_address, reason, ref) do nothing`. The route's read-then-`status='won'`-flip is not atomic with the RPC. Two concurrent POSTs on the same won bet both pass the status check, both RPCs debit, both flag updates "succeed" (the second matches 0 rows silently). The ledger shows one entry; the file's own solvency tripwire (`:368-384`) breaks. The in-file comment "Both idempotent on (wallet, reason, ref)" is true of the ledger, not the balance mutation.

**Fix:** gate the debit on the ledger conflict — insert the ledger row first and debit only on a fresh insert — inside the RPC.

### H4 — The room WS broadcasts hidden authority state to everyone

`src/room/MatchRoomCore.ts:1171-1185` (broadcast) · `:504-510` (seed broadcast) · `hooks/TeamUpContext.tsx:706-715` (seed payload)

`applyNewState` fans out `this.state` verbatim to every socket including spectators, and the client seed sends typed `powerTiles` and full `playerPowers`. Masking exists on the HTTP snapshot path (`/api/match/state` via `stripPowerTypesForWire`) and on the legacy `move-auth.seedMatch` path, but never inside the DO transport. Every opponent and spectator receives the exact locations *and types* of hidden power tiles and the type of every held power — a direct cheat in wagered matches and an explicit violation of AGENTS.md rule 8 ("power tile types stay on the authority").

**Fix:** per-viewer sanitization at the DO (per-socket `viewerColor` is available in socket meta), mirroring the PW-2/NET-24 re-attach pattern on the client.

### H5 — Session lifetime is not enforced at the authority socket, and tokens travel in URLs

`src/room/MatchRoomCore.ts:1460-1485` · `lib/sessionV2.ts:136-146, 497-499` · `app/api/auth/match/route.ts:50-54`

The DO validates sessions with only `revoked_at is null` — it selects `expires_at` (`:1471`) and never compares it, and never touches `idle_expires_at`. The 2h absolute / 5min idle match-session TTLs enforced on HTTP routes (`lib/serverAuth.ts:91-98`) are void at the WS authority. Only the 30-day cron (`src/worker.ts:71-76`) eventually removes rows.

Worse, `issueMatchSession` returns the **full session token** as the "ticket" (`sessionV2.ts:497-499`), which `/api/auth/match` returns and the client appends as `?ticket=` to the WS upgrade. The advertised 30-second single-use ticket (`MATCH_TICKET_TTL_MS`, `sessionV2.ts:48`) does not exist as such. A ticket captured from any proxy/log/history is a replayable seat credential — able to roll, move, spend powers, and seed (C1) — for weeks.

**Fix:** enforce `expires_at`/`idle_expires_at` at socket auth; mint true short-TTL single-use tickets bound to the match session; stop accepting tokens from URL query parameters on HTTP routes.

---

## 4. Medium

### Money-adjacent paths

**M1 — `sync-confirm` marks matches on-chain-synced on trust.** `app/api/matches/sync-confirm/route.ts:20-27` writes `onchain_synced=true, sync_tx_hash=<client string>` with zero on-chain validation, no txHash format check. The client calls it right after `writeContractAsync`, which resolves on *submission*, not receipt (`hooks/useUnsyncedMatches.ts:139-160`): a tx that later reverts (attestation deadline is 1h, `app/api/matches/unsynced/route.ts:71`) still flips the rows, and since the unsynced query filters `onchain_synced=false`, those matches are permanently excluded from re-attestation — silent loss of the player's on-chain mission progress; hostile callers can forge audit-trail hashes. **Fix:** verify the tx receipt (or the contract's `matchSynced` view) before flagging.

**M2 — The relayer broadcasts client-shaped settle payloads with server gas.** `app/api/chips/settle/relay/route.ts:22-45` forwards body-supplied `plan/deadline/nonce/hostSig/edgeSig` to `relaySettlePool` (`lib/poolRelayer.ts:36-56`) without re-verifying the plan against a real `propose`, checking the caller is the pool authority, or locally recovering `edgeSig`. The contract's EIP-712 checks are the only line of defense; residual exposure is gas griefing (bounded at 10/min) and arbitrary-timing Mode-B forced settlement. Additionally `relaySettlePool` **swallows failures** (`return null`, no retry) despite the design promise that paid pools "guarantee to settle" — and the fire-and-forget `void reportProgress(...)` calls (`poolRelayer.ts:60-72`) risk unhandled rejections in the Worker runtime, and fire on unverified client-supplied `winnerAddresses`/`participants`. **Fix:** locally verify the edge signature and plan provenance before broadcasting; add a retry queue for failed settles; wrap progress reports.

**M3 — Solo-match win farming feeds the sync queue.** `/api/match/record`'s signature path (`app/api/match/record/route.ts:105-134`) accepts host-signed results with no requirement a server room observed the match (correct for offline play), and `participants:[A]` is allowed (`app/api/match/start/route.ts:73`). Each recorded win becomes a `player_free_matches` row with `won=true` → oracle attestation → on-chain mission credit. Bounded by mission targets at claim time, but LXP/RXP per recorded match (~150-180 XP) is farmable at 20/min. **Fix:** a `networked_only` flag on syncable matches, or a daily cap, and an explicit risk acceptance in the register.

**M4 — `/api/match/stream` session path doesn't verify the caller is the host.** `app/api/match/stream/route.ts:53-60` computes `canonicalHost` but the session branch only checks that a session exists; `host_address` is taken from the body (`:103`). Any logged-in wallet can flip `streaming_enabled` on any match and spoof the recorded host that spectator betting and the AFK-abandon evidence reader (`app/api/chips/settle/propose/route.ts:275-294`) later trust.

### Authority correctness

**M5 — Dice has modulo bias at the authority.** `src/room/MatchRoomCore.ts:694-696`: `crypto.getRandomValues(new Uint8Array(1))` then `(rand[0] % 6) + 1` — faces 1-4 occur 43/256 vs 42/256 for 5-6. This is the server-authoritative RNG shown to players in a game branded "provably fair," used in wagered matches. Trivially fixable with rejection sampling.

**M6 — Rate-limit holes exactly where writes are free-form.** Distributed layers are real (worker DO shard `src/worker.ts:112-146`; native RL_MUT bindings `middleware.ts:47-80`; Postgres-backed shared counters for join/record). Gaps: `messages` POST, `missions/voucher`, `spectator-bets` POST, and `live-arena/power4p` POST are session-gated but absent from `RATE_LIMITS` (unlimited); `match/stream` sits in `NEVER_LIMIT` (`lib/rateLimitRoutes.ts:94-98`) despite being state-changing (compounding M4); the WS upgrade path (`src/worker.ts:92-106`) bypasses limiting and the DO caps neither sockets per IP nor per room — unauthenticated spectators can open unbounded hibernating sockets against any matchId.

**M7 — Client seq-gate bypasses.** `resyncFromServer` does `serverSeqRef.current = snap.seq ?? serverSeqRef.current` (`hooks/useGameActions.ts:355`) and `useAFKManager` the same (`hooks/useAFKManager.ts:150`) — both can *lower* the ref (no `Math.max`, unlike `applyServerState` at `TeamUpContext.tsx:255`), re-opening the gate for already-applied frames. Separately, `hasAuthoritativeSnapshot` is cleared on any reconnecting/syncing blip (`TeamUpContext.tsx:574-579`) and `applyServerState` accepts the next frame "whatever its seq" (`:253-254`) — `resyncMatch` emits `'syncing'` on every run (`lib/netcode/resync.ts:52`), so a flapping WS re-arms the bypass repeatedly. Masked today by monotonic end-to-end seqs; the invariant is enforced nowhere. **Fix:** `Math.max` the ref in one place; never blindly clear the snapshot flag.

### User-visible breakage

**M8 — Intent rejections are silent everywhere.** `handleRoll`/`moveToken`/`handleUsePower` return `'applied'|'failed'|'deferred'` (NET-19) precisely so callers can surface refusals — nothing consumes the outcome: `Board.tsx:320, 490` passes `handleRoll` straight through, room rejections only `console.warn` (`useGameActions.ts:189-197, 420-424, 653-655`), AI/AFK ignore results. A guest rejected with `NOT_YOUR_TURN`/`ROOM_NOT_READY` sees the tap do nothing. Dice desync compounds it: a WS drop between the tumble and the fan-out leaves `isRolling: true` forever (`useGameActions.ts:406-425` guard at `:384`) — a permanently tumbling die with no error. The DEGRADED strip shows for 3 seconds then hides (`app/page.tsx:221-225`).

**M9 — Spectators never parse `ENGINE_STATE`.** The host's primary broadcast verb is now `ENGINE_STATE` (`TeamUpContext.tsx:304, 337, 540, 603`), but the spectator parser allow-list predates it (`lib/protocol/schemas.ts:186-192`) and `useSpectatorSync` drops it via `default: dropSchema('unhandled')` (`useSpectatorSync.ts:212-213`). Even legacy verbs mostly no-op because `broadcastAction` puts state inside `gameState`/`stateOverride`, not top-level fields. Spectating runs entirely on the 5-second snapshot poll: up to 5s stale board per move, one poll hit per spectator per 5s, plus a dead broadcast handler that misleads maintainers.

**M10 — The Supabase relay channel is torn down and rebuilt on every dice-commit cycle.** `ensureChannel` depends on `processGameAction` (`hooks/useSupabaseRelay.ts:49-80`), whose identity changes whenever `commitments` state changes (`useProvablyFairDice.ts:110-150` → `finalizeDiceRoll` → `handleRevealReceived`) — i.e., every `DICE_COMMIT` received. Each change → `removeChannel` + fresh `subscribe()`, dropping in-flight broadcasts. The entire commit/reveal protocol is also dead weight (`initiateDiceRoll` has no caller; the room mints dice now). **Fix:** memoize the channel on room code; route `processGameAction` through a ref (as `useMatchStates` correctly does with `onServerStateRef`).

**M11 — No `START_GAME` producer exists.** No component calls `broadcastAction('START_GAME', …)`; the only handler is `TeamUpContext.tsx:687-688`. The host's start is `LOBBY_SYNC(status:'playing', matchId)` (`app/page.tsx:593-595`), which carries no `initialBoardConfig`. The documented recovery effect (`app/page.tsx:505-541`, "robust recovery path if the primary START_GAME action is missed") protects against a verb nobody sends. When the room is unreachable, the MM-15 fallback silently invents a random board per client (`Board.tsx:139-160`) — same root cause as C2.

**M12 — Turn-timer deadline re-arms on every state write.** `useGameTimer`'s turnKey includes `localGameState.lastUpdate` (`hooks/useGameTimer.ts:50-56`), which changes on every `applyServerState` fan-out; any snapshot arriving mid-turn resets the 15s deadline and AFK escalation (`useAFKManager.ts:68`) can be starved indefinitely by busy traffic. The RoomClient `onTimer` callback is never wired (`TeamUpContext.tsx:421-463`), so server clock frames are ignored client-side.

**M13 — No Content-Security-Policy.** `next.config.ts:59-96` sets HSTS / nosniff / referrer / X-XSS-Protection but no CSP and no `frame-ancestors`. For a wallet-connected app shipping third-party SDKs (CDP, WalletConnect, Farcaster), CSP is meaningful XSS defense-in-depth.

---

## 5. Low / hygiene

- **Dead edge-function remnants.** The DO still proxies fallbacks to retired `roll-dice`/`move-auth` with the anon key (`MatchRoomCore.ts:791-798, 946-953`) — retired in P6, so dead code that would become a client-payload trust boundary if re-enabled. TeamUpContext still pre-warms `/functions/v1/roll-dice` on every match start (`TeamUpContext.tsx:690-697`) — wasted latency in the START_GAME critical path.
- **No DO teardown.** Won/abandoned rooms never `storage.deleteAll` (`MatchRoomCore.ts`) — storage accumulates forever (bounded per room, unbounded in count). Related register opens: SA-1 (hosted edge functions), TU-5 (abandonment penalty, product decision).
- **`connectRoom` in-flight race.** The idempotence guard checks `roomClientRef.current` (`TeamUpContext.tsx:363-367`), but the ref is assigned only after two awaited network calls (`:384-418`). Quick-match legitimately calls `connectRoom` twice (`QuickMatchPanel.tsx:132`, `page.tsx:643`); a duplicate `RoomClient` can survive with live callbacks.
- **Private-realtime policy oddity.** `supabase/migrations/202610180005_private_realtime.sql` — the SELECT policy's trailing `OR topic LIKE 'match:%'` opens match topics to *anon* (making the authenticated clause redundant for those topics); and the whole migration no-ops on hosted Supabase pending the manual FALLBACK block, so the real state is unverified.
- **Source-grep test pattern persists.** 15 test suites still use `assert.match(src, …)` assertions (`scripts/auth-boundary.test.ts`, `relay-hardening.test.ts`, `power-privacy.test.ts`, etc.). Per the Oct-20 review: they assert text exists, not behavior holds — exactly how the R1/R2 residuals slipped through a green suite. The genuinely behavioral tests (concurrency on real Postgres, golden replay, 1200-match engine diff, hostile-payload protocol table) are the model; port greps into the pure decision modules.
- **`TeamUpContext.tsx` (1827 lines) is a god context.** Lobby seating, transport lifecycle, state application, intent queue, dedup, matchmaking, and betting all live in one provider; every change re-renders the tree through one memo (`:1793-1810`). The pure-decision-module extraction already in use is the right exit ramp.
- **`/api/match/start` failure silently converts a networked lobby into a host-only offline game** (`app/page.tsx:597-599`): guests never receive `LOBBY_SYNC(playing)` and stay in the lobby with no message.
- **Two competing room-reconnect mechanisms.** RoomClient auto-reconnects internally with `lastSeq` resync (`lib/netcode/roomClient.ts:211-220`); TeamUpContext additionally tears down and recreates the client on any `roomStatus === 'failed'` (`TeamUpContext.tsx:497-510`) — a transient `ws.onerror` can kill a healthy socket. Pick one owner.
- **Misc.** `REQUEST_MOVE` defaults a missing `tokenIndex` to 0 rather than rejecting (`MatchRoomCore.ts:879`); declared timer kinds `bet_window`/`afk_strike`/`reconnect_grace` are never handled in `alarm()` (`:1358-1394`) — a reconnect-grace design that was never wired; idle-session refresh lacks `waitUntil` (`lib/serverAuth.ts:129-137`); `sendIntent`'s retry handle is single-slot so a fast second tap cancels intent #1's retry (`TeamUpContext.tsx:916, 970-977`).

---

## 6. Open verification items (not closable from code)

1. **Worker env:** whether `SUPABASE_SERVICE_ROLE_KEY` is actually set in the deployed Worker env — its absence triggers H1's silent no-commit path (`MatchRoomCore.ts:1109-1117` logs and continues).
2. **Hosted realtime RLS:** whether the private-realtime FALLBACK SQL was ever applied (`SELECT * FROM pg_policies WHERE schemaname = 'realtime'` on the hosted project).
3. **`match_seats` write ordering:** whether `join_matchmaking`'s seat insertion always precedes the room connect — determines the practical frequency of C1's fallback path.
4. **Seat writers:** whether `/api/match/start`'s `assignAndPersistSeats` can disagree with seats already written by the matchmaking RPC (two writers on `match_seats`).
5. **DO hibernation restore:** whether SQLite-persisted `state` can lag the last fanned seq (would make M7 exploitable rather than theoretical).
6. **Contracts deep-review:** MatchPool.sol Mode-B/settle semantics and MissionSystem.sol `syncFreeMatches` replay binding were reviewed only via ABI + TS comments; a dedicated Solidity review is recommended before mainnet funds scale.

---

## 7. Prioritized remediation order

| # | Item | Severity | Effort |
|---|---|---|---|
| 1 | C1 — validate/restrict the seed frame (host-only + `match_seats`/shape/whitelist) | Critical | small |
| 2 | H1+H2 — check RPC result, single-map storage put, reconcile-on-mismatch | High | small |
| 3 | H3 — ledger-first escrow withdraw (money) | High | small |
| 4 | H4 — per-viewer power sanitization at the DO transport (rule 8) | High | medium |
| 5 | H5 — expiry at socket auth + real single-use tickets | High | medium |
| 6 | C2 — make AGENTS.md invariant 4 true again (restore P2P authority or delete the path) | Critical | decision + medium |
| 7 | M1/M2 — sync-confirm receipt verification; relayer pre-verify + retry | Medium | small each |
| 8 | M5/M6 — dice rejection sampling; rate-limit gaps + WS socket caps | Medium | small |
| 9 | M13 — CSP headers | Medium | small |
| 10 | M8-M12 UX batch — rejection surfacing, spectator `ENGINE_STATE`, relay channel memoization, timer key | Medium | medium |

Per the Oct-20 process rule: each item above should close with a **behavioral test that fails on the pre-fix code**, not a source-grep assertion.
