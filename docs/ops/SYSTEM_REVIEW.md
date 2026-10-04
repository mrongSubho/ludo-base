# System code review — Ludo Base

| Field | Value |
| --- | --- |
| **Date** | 2026-10-05 |
| **Commit** | `e49600a` (`main`) |
| **Scope** | Full system: engine · Edge authority · API routes · netcode · economics/contracts · crypto/DMs · React/Next · DB/migrations |
| **Method** | 8 parallel subsystem reviews + independent verification of every Critical claim (2 empirical engine repros, 1 proven-against-live-Postgres migration replay) |
| **Findings** | 154 (16 Critical · 39 High · 59 Medium · 40 Low) |
| **Baseline gates** | `tsc` **0 errors** · `eslint` **clean** · `npm test` **91/91** · `check:engine` **in sync** · `check:rls` **clean** |
| **Verdict** | **Do not ship wagered/2v2 play until Phase 0–2 close.** See [`REMEDIATION_CHECKLIST.md`](./REMEDIATION_CHECKLIST.md). |

**Explicit links:** remediation tracker → [`REMEDIATION_CHECKLIST.md`](./REMEDIATION_CHECKLIST.md) · netcode drills → [`NETCODE_DRILLS.md`](./NETCODE_DRILLS.md) · rules spec → [`ENGINE_LOGIC.md`](../../ENGINE_LOGIC.md) · agent contract → [`AGENTS.md`](../../AGENTS.md)

---

## 1. The meta-finding

**The gate suite is 100% green while the system contains 14 Critical defects.** Green here means *untested*, not *correct*.

| Gate | What it actually proves | What it misses |
| --- | --- | --- |
| `npm test` (91 tests) | `lib/gameLogic.ts` math | **`lib/engine/core.ts` — the canonical authority engine — has zero unit coverage.** No test imports it. `scripts/golden-replay.ts` pins the *other* engine, so the divergence in ENG-01 is invisible. |
| `scripts/mp.harness.ts` | a local `Set` works | **Never imports `TeamUpContext`, `useGameActions`, `useSupabaseRelay`, or `useMoveAuth`.** No host, no guest, no transport, no `move-auth` call. At `:189-192` it even models the guest's resync mutating `host.state` — trust direction backwards. |
| `scripts/net.chaos.ts`, `drill.runner.ts`, `drill.deep.ts` | their own local Sets | Re-implement dedup/FSM/counters locally. Never import `createDedupStore`/`rememberIntent`, never drive `processGameAction`. The drill row *"Intent flood + duplicates → 10 unique applies, 90 net_intent_dup"* is a tautology about `Set`. |
| `npm run check:rls` (regex scan) | RLS `enable`d per file | **A regex cannot catch a DDL error.** DB-01 is a runtime `ERROR`; DB-02 is a `column_default` mismatch. Both pass. |
| `npm run check:engine` | `core.ts` ≡ `_shared/engine.ts` | Does not compare `lib/engine/*` against `lib/constants` / `lib/boardLayout` (ENG-17). |

**Consequence:** every Critical finding below is in a path the gates do not execute. Closing them requires *new* gates, not just new assertions.

---

## 2. How to read this document

**ID scheme** — stable, domain-prefixed. Cite these in PRs and commits.

| Prefix | Domain | Count |
| --- | --- | --- |
| `SEC` | Trust boundary — authn, authz, replay, signature binding | 35 |
| `ENG` | Engine & rules correctness | 20 |
| `NET` | Netcode & multiplayer liveness | 27 |
| `DB` | Schema, migrations, RLS, types | 27 |
| `ECO` | Economics, settlement, contracts | 8 |
| `CRY` | Crypto & privacy | 8 |
| `REA` | React/Next architecture & performance | 29 |

**Severity**

| Severity | Definition |
| --- | --- |
| **Critical** | Attacker-reachable with money/ledger/settlement impact, or a correctness divergence between client and authority that desyncs matches. |
| **High** | Breaks a documented invariant, or makes a class of match unplayable/unsettleable. |
| **Medium** | Correctness or operability defect with a workaround. |
| **Low** | Hygiene, drift risk, or defence-in-depth. |

**Status** — track in [`REMEDIATION_CHECKLIST.md`](./REMEDIATION_CHECKLIST.md). Defaults to `open`.

**Evidence tags** — `✅ verified` means I read the code path and confirmed it independently. `◐ reported` means a subsystem reviewer found it and it is internally consistent but I did not personally re-verify.

---

## 3. Executive summary — risk posture

Seven distinct structural problems account for nearly every finding:

1. **Authority is authenticated but not authorized.** Signature verification is genuinely solid (see §8). What is missing is *resource* authorization: "is this signature valid" is checked, "is this signature the right signer **for this pool / match / seat**" frequently is not. → SEC-03…07, ECO.
2. **Money paths are read-then-write.** No `SECURITY DEFINER` RPC with an advisory lock wraps the coin/CHIPS balance mutations, so every grant and claim is a TOCTOU. The one correct implementation (`purchase_marketplace`, 202609170001) was **silently overwritten by a freeze stub**. → SEC-05/09/10, DB-01, ECO.
3. **Two engines, one declared canonical.** `lib/engine/core.ts` (Edge/authority) and `lib/gameLogic.ts` (offline/bot/AI/golden) implement capture differently and are both live. → ENG-01.
4. **A second team-pairing table.** `AGENTS.md` invariant 1 says `TEAM_PAIRINGS` is the single source of truth; `LOBBY_COLORS` forks it and contradicts it. → ENG-02.
5. **The DB cannot be rebuilt from source.** A migration aborts mid-file, so a reset DB ≠ a migrated DB, and the canonical baseline disagrees with the archive on betting-window guards, counters, and retention. → DB-01…06.
6. **Netcode resolves turn transitions client-side.** `passTurn` exists and is never called, so any turn with no legal move — a very common Ludo outcome — permanently desyncs `match_states` and 403s the next player. → NET-01.
7. **Presence- and clock-derived authority.** Compute-host election sorts a client-supplied `joinedAt`; the turn timer is a bare `setInterval`. Both are forgeable and neither is server-authoritative. → NET-06, NET-13.

---

## 4. Findings register

### 4.1 SEC — Trust boundary

| ID | Sev | Title | Location |
| --- | --- | --- | --- |
| SEC-01 | **C** | `roll-dice` unauthenticated; receipt never bound to roller or turn ✅ | `roll-dice/index.ts:21` · `move-auth:529` |
| SEC-02 | **C** | `REQUEST_ROLL` schema permits a client-chosen dice face ✅ | `gameProtocol.ts:21` · `useGameEngine.ts:386` · `useGameActions.ts:406` |
| SEC-03 | **C** | `PUT /api/chips/settle/propose` has no auth → unauth Edge abandon co-signature ✅ | `chips/settle/propose/route.ts:142` |
| SEC-04 | **C** | Mode-B settle has no sender authorization → pot + host bond theft ✅ | `MatchPool.sol:430` · `settle/propose/route.ts:31` |
| SEC-05 | **C** | Spectator bets: no stake debit, no window gate → coin mint ✅ | `spectator-bets/route.ts:61` · `baseline.sql:525` |
| SEC-06 | **C** | `/api/match/start` unauthenticated → voids the `/api/match/record` trust anchor ✅ | `match/start/route.ts:11` |
| SEC-07 | **C** | `/api/live-arena/power4p` `PATCH` unauthenticated → authority hijack ✅ | `live-arena/power4p/route.ts:76` |
| SEC-08 | **H** | `/api/friends` PostgREST `.or()` injection → full social-graph dump ✅ | `friends/route.ts:19` |
| SEC-09 | **H** | `/api/missions/claim` TOCTOU double-claim ✅ | `missions/claim/route.ts:66` |
| SEC-10 | **H** | `/api/missions/voucher` no eligibility check + client-chosen `periodId` ✅ | `missions/voucher/route.ts:39` |
| SEC-11 | **H** | `/api/chips/lobby-ticket` no host/resource authorization ◐ | `chips/lobby-ticket/route.ts:50` |
| SEC-12 | **H** | `POST /api/lobby/join` unauthenticated, unverified identity, unbounded ◐ | `lobby/join/route.ts:14` |
| SEC-13 | **H** | `friendships` `remove` IDOR — any row by UUID ◐ | `friendships/route.ts:56` |
| SEC-14 | **H** | `push/subscribe` `unsubscribe` IDOR — caller-supplied endpoint ◐ | `push/subscribe/route.ts:21` |
| SEC-15 | **H** | Optimistic-concurrency write never verified → losers report success ✅ | `move-auth:563` |
| SEC-16 | **H** | `seed` signature commits to nothing about the board it installs ◐ | `matchProof.ts:112` · `move-auth:409` |
| SEC-17 | **M** | `provisional_match_sessions` cross-tenant clobber ◐ | `move-auth:292` · `GameLobby.tsx:192` |
| SEC-18 | **M** | `pass` lets client override legality via `reason:'forced'` ◐ | `move-auth:676` |
| SEC-19 | **M** | `pass` under `host-assist` omits the human-seat restriction `move` enforces ◐ | `move-auth:656` |
| SEC-20 | **M** | `body.chainId` selects the RPC; 8453 allowlist drift; `move-auth` unauth → free amplification ◐ | `_shared/walletVerify.ts:47,76` |
| SEC-21 | **M** | `/api/siwe/verify` `domain` is attacker-supplied; no server-issued nonce ◐ | `siwe/verify/route.ts:44` |
| SEC-22 | **M** | `/api/social/poke` sybil coin farming (21k coins/day/operator) ◐ | `social/poke/route.ts:85` |
| SEC-23 | **M** | Unauthenticated paid-API proxies, no rate limit ◐ | `farcaster/route.ts:11` · `activity/route.ts:39` · `matchmaking/pools:10` |
| SEC-24 | **M** | `/api/wallet-links` GET identity-graph disclosure; POST no freshness ◐ | `wallet-links/route.ts:14,49` |
| SEC-25 | **M** | `/api/profile/ecdh` cross-user key read; no key-shape validation ◐ | `profile/ecdh/route.ts:19,51` |
| SEC-26 | **M** | `/api/notices` presents an FNV hash in a field named `signature` ◐ | `notices/route.ts:35` |
| SEC-27 | **M** | `/api/feedback` client-controlled throttle key + spoofed attribution ◐ | `feedback/route.ts:43,56` |
| SEC-28 | **M** | `/api/social/moderation` no rate limits; dedup defeated by varying `requestId` ◐ | `social/moderation/route.ts:65,77` |
| SEC-29 | **L** | `resolve-bet` never validates signed `result`/`betType` vs authority ◐ | `resolve-bet/index.ts:123` |
| SEC-30 | **L** | `pass` never resets `powerSpentThisTurn` → next player locked out of powers ◐ | `move-auth:682` |
| SEC-31 | **L** | Internal error text + engine error strings returned to unauthenticated callers ◐ | `move-auth:886` · `roll-dice:101` · `resolve-bet:140` |
| SEC-32 | **L** | `seed` persists arbitrary client `GameState`; only `powerTiles` is stripped ◐ | `move-auth:447` · `engine.ts:464` |
| SEC-33 | **L** | Bot rolls violate the `match_rolls.wallet_address` FK → hosted bots cannot roll ◐ | `useGameActions.ts:410` · `baseline.sql:289` |
| SEC-34 | **L** | No `middleware.ts` → zero rate limiting on any route ◐ | — |
| SEC-35 | **L** | Telemetry deny-list omits message-shaped keys (`content`, `body`, `epk`, `iv`) ◐ | `telemetryPolicy.ts:66` |

### 4.2 ENG — Engine & rules

| ID | Sev | Title | Location |
| --- | --- | --- | --- |
| ENG-01 | **C** | Capture force computed from **different boards** in the two engines ✅ | `engine/core.ts:300,384` vs `gameLogic.ts:376` |
| ENG-02 | **C** | `LOBBY_COLORS['2v2']` is a second, contradicting pairing source ✅ | `gameLogic.ts:523` vs `constants.ts:14` |
| ENG-03 | **H** | `applyPower` teleport has no victory check → 2v2 deadlock, no winner ◐ | `engine/core.ts:657` |
| ENG-04 | **H** | `activeColorsForTurns` drops the teammate → assist unreachable on Edge ◐ | `engine/core.ts:453` · `move-auth:194` |
| ENG-05 | **H** | Three-sixes unenforced on `submit-move`; `consecutiveSixes` never incremented server-side ◐ | `move-auth:677` vs `engine/core.ts:414` |
| ENG-06 | **H** | `buildPayoutPlan` single-winner early return precedes the 2v2 guard ◐ | `payoutPlan.ts:57` · `MatchStatsOverlay.tsx:194` |
| ENG-07 | **H** | `/api/match/state` returns raw state — leaks hidden power-tile `type` ✅ | `match/state/route.ts:16` |
| ENG-08 | **M** | AI scores captures against the pre-move board → under-values double captures ◐ | `aiEngine.ts:110` |
| ENG-09 | **M** | AI `progression` term uses global track index, not distance-to-finish ◐ | `aiEngine.ts:137` |
| ENG-10 | **M** | `getBestMove` 2v2 assist returns an index into the *teammate's* array ◐ | `aiEngine.ts:33` · `useAIBrain.ts:146` |
| ENG-11 | **M** | `applyPowerPickup` respawn seeded from `Date.now()` → board not replayable ◐ | `engine/core.ts:710` |
| ENG-12 | **M** | Trap resolution has no 2v2 teammate truce ◐ | `engine/core.ts:355` |
| ENG-13 | **M** | No dice-domain validation; `steps===0` bypasses the no-op guard; negative roll escapes the home lane ◐ | `move-auth:527` · `engine/core.ts:348,191` |
| ENG-14 | **M** | Trap branch skips shield cleanup, boost consumption, capture stats, win re-check ◐ | `engine/core.ts:358` |
| ENG-15 | **L** | `checkWinStatus` is a live no-op always returning `'playing'` ◐ | `gameLogic.ts:387` |
| ENG-16 | **L** | `AI_SCORES` drifted from `ENGINE_LOGIC.md` §5.2 ◐ | `constants.ts:60` |
| ENG-17 | **L** | `TEAM_PAIRINGS`/`SHARED_PATH`/`CORNER_SLOTS`/`SAFE_POSITIONS` triplicated, no cross-check ◐ | `constants.ts:16` · `engine/core.ts:19` · `boardLayout.ts:24` |
| ENG-18 | **L** | AI spends Boost unconditionally ◐ | `aiEngine.ts:168` |
| ENG-19 | **L** | `shufflePlayers('1v1')` re-picks a different diagonal than `assignCornersFFA('1v1')` ◐ | `boardLayout.ts:346` |
| ENG-20 | **L** | `getStarIndices`/`nearestStarAhead`/`getGridCellInfo` triplicated ◐ | `engine/core.ts:479` ≡ `gameLogic.ts:105` ≡ `boardLayout.ts:221` |

### 4.3 NET — Netcode

| ID | Sev | Title | Location |
| --- | --- | --- | --- |
| NET-01 | **C** | `passTurn` is dead code → turn never advances on no-move / three-sixes → 403 deadlock ✅ | `useMoveAuth.ts:319` · `useGameActions.ts:489` · `move-auth:512` |
| NET-02 | **C** | Two independent `serverSeq` refs → every guest move `STALE_SEQ`-dropped, no retry ✅ | `useGameEngine.ts:215` vs `TeamUpContext.tsx:146` |
| NET-03 | **C** | Unauthenticated `MOVE_TOKEN`/`TURN_SWITCH`/`ROLL_DICE` on a public broadcast channel ◐ | `TeamUpContext.tsx:655` · `useSupabaseRelay.ts:52` |
| NET-04 | **H** | Intents marked processed then dropped; single-slot `lastIntent`, no NACK/queue ◐ | `TeamUpContext.tsx:570` · `useGameEngine.ts:395` |
| NET-05 | **H** | One failed resync latches `reconnecting` forever → match freeze, no error ◐ | `useMatchStates.ts:44` · `resync.ts:65` |
| NET-06 | **H** | Split-brain authority via client-supplied `joinedAt` in sessionStorage ◐ | `useGamePresence.ts:29,90` |
| NET-07 | **H** | Post-migration every human is muted; handoff unauthenticated, non-atomic, unverified ◐ | `useGameEngine.ts:381,108` · `HostMigrationPanel.tsx` |
| NET-08 | **H** | Unbounded/unscoped dedup sets; `createDedupStore` evicts live IDs at `max:512` ◐ | `useSupabaseRelay.ts:21` · `TeamUpContext.tsx:895` · `dedup.ts:34` |
| NET-09 | **H** | PeerJS intent path skips validation **and** dedup; `rememberIntent(undefined)==='skip'` passes the guard ◐ | `TeamUpContext.tsx:719` · `dedup.ts:83` |
| NET-10 | **M** | Spectator subscribes to `match-states-room-*`; every publisher uses `game-room-*` ◐ | `useSpectatorSync.ts:92` |
| NET-11 | **M** | Relay tears down and re-subscribes the room channel on unrelated renders ◐ | `useSupabaseRelay.ts:82` |
| NET-12 | **M** | Two competing guest→`localGameState` sync effects; the careful one is unreachable ◐ | `useGameEngine.ts:305,451` |
| NET-13 | **M** | Turn timer is a bare client `setInterval`, no wall-clock deadline ◐ | `useGameTimer.ts:28` |
| NET-14 | **M** | The "landing" safety net performs an unauthorized client-side turn switch ◐ | `useGameEngine.ts:284` |
| NET-15 | **M** | Retry ladders survive `leaveGame` / room switch (9.6s of stale broadcasts) ◐ | `TeamUpContext.tsx:823` |
| NET-16 | **M** | Successful move response overwrites host local turn state with the server's stale copy ◐ | `useGameActions.ts:183` |
| NET-17 | **M** | `handleRoll` reads `matchId` from a closure missing it from deps ✅ | `useGameActions.ts:413,580` |
| NET-18 | **M** | `useAIBrain` timers deliberately survive cleanup → post-unmount Edge writes ◐ | `useAIBrain.ts:76,160` |
| NET-19 | **M** | AFK auto-move resets `timeLeft` before attempting → retries forever, never kicks ◐ | `useAFKManager.ts:120` |
| NET-20 | **L** | `usePeerManager` entirely unused → no P2P liveness detection, no heartbeat ◐ | `hooks/usePeerManager.ts` |
| NET-21 | **L** | `net_authority_switch`, `net_heartbeat_ok` never bumped in production; `HOST_ELECT` never sent ◐ | `netcode/counters.ts` · `matchFsm.ts:23` |
| NET-22 | **L** | `classifyAbandon` bumps `net_intent_ok`, polluting drill row A1 ◐ | `netcode/abandon.ts:46` |
| NET-23 | **L** | `purgeExpired` full O(n) scan on every `has()`/`add()` → O(n²) under intent flood ◐ | `netcode/dedup.ts:34` |
| NET-24 | **L** | `stripPowerTypesForWire` merge destroys the host's own power-tile types ◐ | `TeamUpContext.tsx:84,170` |
| NET-25 | **L** | `edge-server-client` never clears `messageHandlers` on disconnect; no connect timeout ◐ | `teamup/edge-server-client.ts:69,148` |
| NET-26 | **L** | `useMoveAuth` silently downgrades a 401 to the public unauthenticated `get` ◐ | `useMoveAuth.ts:396` |
| NET-27 | **L** | `buildMatchReceipt` receives no `seq`/`replay` → receipt carries neither ◐ | `MatchStatsOverlay.tsx:222` |

### 4.4 DB — Schema, migrations, RLS

| ID | Sev | Title | Location |
| --- | --- | --- | --- |
| DB-01 | **C** | `202609230003` aborts mid-file → coin freeze silently unenforced ✅ | `202609230003:24` |
| DB-02 | **C** | `match_rolls.status` default `'available'` vs `isDuplicateAction` requiring `'open'` ✅ | `baseline.sql:292` vs `networkBoundary.ts:36` |
| DB-03 | **C** | Fresh `supabase db reset` cannot complete the chain ◐ | consequence of DB-01 |
| DB-04 | **H** | `settle_match_bets` lost its `window_closed_at` guard; not idempotent ◐ | `baseline.sql:538` vs `archive/20260908:24` |
| DB-05 | **H** | `mark_conversation_read` zeroes counters instead of reconciling ◐ | `baseline.sql:437` vs `archive/20260911:38` |
| DB-06 | **H** | `cleanup_stale_data` reverted to the 72h delete-all-read rule ◐ | `baseline.sql:583` vs `archive/20260912:18` |
| DB-07 | **H** | `messages_restrict_columns` uses `<>` not `IS DISTINCT FROM` (latent if `content` becomes nullable) ◐ | `baseline.sql:417` |
| DB-08 | **H** | Archive `messages` UPDATE policy is world-writable — must never be re-applied ✅ | `archive/20260914:12` |
| DB-09 | **H** | Supabase default `GRANT ALL` survives on 30 tables; RLS is the only barrier ◐ | baseline (no revoke loop) |
| DB-10 | **H** | `live_matches_public_read using (true)` exposes `join_secret_hash`, `arena_key`, `authority_id` ◐ | baseline |
| DB-21 | **H** | `check-rls.mjs` blind spots (6 classes, incl. no DDL/signature/default checking) ◐ | `scripts/check-rls.mjs:44,52,59` |
| DB-22 | **H** | `types/database.types.ts` drift: 8 tables, ~25 columns, 3 phantom functions ◐ | `types/database.types.ts` |
| DB-11 | **M** | `RESET_FOR_FRESH_BASELINE.sql` no-ops when `pgcrypto` is in `public` ◐ | `RESET:28` |
| DB-12 | **M** | RESET path ≠ migration path (publication not cleaned) ◐ | `RESET` |
| DB-13 | **M** | `spectator_bets` idempotency key unenforceable (`action_id` nullable + unique) ◐ | `baseline.sql:246` |
| DB-14 | **M** | `coin_ledger` has zero writers — implies a double-entry guarantee that does not exist ◐ | `baseline.sql:261` |
| DB-15 | **M** | `messages.content` CHECK is 4000; route caps at 10000 → 500 on 4001–10000 ◐ | `baseline:154` vs `messages/route.ts:41` |
| DB-16 | **M** | `live_chat.content` CHECK 1000 vs route `.slice(0,500)` ◐ | `baseline:222` vs `live-chat:67` |
| DB-17 | **M** | `pokes.status` CHECK admits a legacy vocabulary no writer produces ◐ | `202609180001:9` |
| DB-18 | **M** | `tournaments.status` CHECK is disjoint from the archive vocabulary ◐ | `baseline:348` vs `archive/20260326:12` |
| DB-19 | **M** | `join_tournament` return contract diverged completely from archive ◐ | `baseline:554` vs `archive/20260326:56` |
| DB-20 | **M** | `join_matchmaking_hybrid` return contract changed ◐ | `baseline:478` vs `migrations/20260904:90` |
| DB-23 | **M** | Missing hot-path indexes + 19 unindexed FK columns ◐ | see §10.3 |
| DB-27 | **M** | Realtime publication internally inconsistent (3 dead entries, 3 missing) ◐ | see §10.2 |
| DB-24 | **L** | `prevent_client_player_tampering` exists only in the archive ◐ | `archive/20260920:7` |
| DB-25 | **L** | `update_offline_status()` — `security definer`, unpinned `search_path`, outside the chain ◐ | `migrations/status_cleanup_job.sql:6` |
| DB-26 | **L** | `schema_list.md` / `README.md` claims diverge from the chain ◐ | `supabase/schema_list.md:17` |

### 4.5 ECO — Economics, settlement, contracts

| ID | Sev | Title | Location |
| --- | --- | --- | --- |
| ECO-01 | **M** | `_applySettle` overwrites rather than accumulates credits → funds permanently stranded ◐ | `MatchPool.sol:606` |
| ECO-02 | **M** | Float→bigint conversion; `prizeFund` is a client-side guess, not read from chain ◐ | `MatchStatsOverlay.tsx:194` · `MatchPool.sol:558` |
| ECO-03 | **M** | `_applySettle` ignores `burnWithMemo`/`transferWithMemo` return values ◐ | `MatchPool.sol:613` · `IChips.sol:15,18` |
| ECO-08 | **M** | `MatchPool` infers 2v2-vs-4P from colours + winner count; needs a `shape`/`gameMode` discriminator ◐ | `MatchPool.sol:562,696` |
| ECO-04 | **L** | `expirePool` accepts a caller-chosen `lobbyTtl` → instant lobby griefing ◐ | `MatchPool.sol:411` |
| ECO-05 | **L** | `MissionClaim.claim` mixes `msg.sender` and `tx.origin` (dead branch) ◐ | `MissionClaim.sol:103` |
| ECO-06 | **L** | `mission_vouchers` bookkeeping best-effort; unique key attacker-shaped; mixed units ◐ | `missions/voucher:84` · `202609230001:42` |
| ECO-07 | **L** | `deriveSharedKey` legacy path is publicly derivable from two public addresses ◐ | `encryption.ts:175` |

> SEC-03/04/05 are the app-side roots for the pool-cancel and pot-theft findings; their contract-side consequences are tracked there. SEC-04 ↔ `MatchPool.settlePool`, SEC-03 ↔ `MatchPool.submitAbandon`, SEC-05 ↔ `cash_out_bet`.

### 4.6 CRY — Crypto & privacy

| ID | Sev | Title | Location |
| --- | --- | --- | --- |
| CRY-01 | **H** | KDF is one SHA-256 over `constant ‖ Z` — not HKDF; `epk` unbound; sender never folded in ◐ | `encryption.ts:112` |
| CRY-02 | **H** | No sender authentication in the sealed box → P2P message spoofing ◐ | `encryption.ts:131` · `usePeerChat.ts:32` |
| CRY-03 | **H** | "No plaintext downgrade" is enforced only in the client ◐ | `useDataActions.ts:171` · `messages/route.ts:41` |
| CRY-04 | **M** | Unfiltered `players` UPDATE realtime leaks `coins` + `ecdh_pubkey` to any anon subscriber ◐ | `useDataSync.ts:37` · `baseline.sql:624` |
| CRY-05 | **M** | `ecdh_pubkey` persisted with no key-shape validation ◐ | `profile/ecdh/route.ts:30` · `matchProof.ts:170` |
| CRY-06 | **M** | ECDH private key is `extractable: true` and persisted in `localStorage`; silent regen strands DMs ◐ | `encryption.ts:63,48` |
| CRY-07 | **L** | Two divergent `messages_restrict_columns` definitions are live in the repo ◐ | see DB-07, DB-08 |
| CRY-08 | **L** | `messages` is in the `supabase_realtime` publication with no consumer ◐ | `baseline.sql:644` |

### 4.7 REA — React / architecture / performance

| ID | Sev | Title | Location |
| --- | --- | --- | --- |
| REA-01 | **C** | One Supabase channel allocated per broadcast, never released ◐ | `useSupabaseRelay.ts:51` |
| REA-02 | **H** | `GameDataContext` publishes an unmemoized value → whole-tree re-render ◐ | `GameDataContext.tsx:387` |
| REA-03 | **H** | Unfiltered `players` realtime → N ECDH decrypts + full re-render per unrelated write ◐ | `useDataSync.ts:37` · `GameDataContext.tsx:316` |
| REA-04 | **H** | `useDataBoot` swallows a `/api/messages` failure → permanent degraded boot, empty-not-loading UI ◐ | `useDataBoot.ts:35,134` |
| REA-05 | **H** | `matchConnectionStatus` in the context value but missing from memo deps → stale `'syncing'` ◐ | `TeamUpContext.tsx:1115` vs `:1119-1125` |
| REA-06 | **H** | `FrameProvider` runs a document-wide `querySelectorAll` on every animation frame ◐ | `FrameProvider.tsx:152,170` |
| REA-07 | **H** | `usePreferences` has no provider/store → mid-match toggles never reach the board ◐ | `usePreferences.ts:17` |
| REA-08 | **H** | One error-boundary mount in the repo; no `global-error.tsx` ◐ | `GameLobby.tsx:608` · `page.tsx:686` |
| REA-09 | **M** | `playSound` sets `volume` on the element it never plays — clone plays at 1.0 ◐ | `useSoundEffects.ts:28` |
| REA-10 | **M** | `processMove` alias-returns the live state object; `useGameActions` mutates it in place ◐ | `gameLogic.ts:426` · `useGameActions.ts:245` |
| REA-11 | **M** | Whole-state write-up re-renders the app ~1Hz between lobby start and `seedMatch` ◐ | `useGameEngine.ts:441` |
| REA-12 | **M** | One `AudioContext` per `useAudio()` call site (5); `GainNode`s never disconnected ◐ | `useAudio.ts:36` |
| REA-13 | **M** | `AudioToggle` creates an `AudioContext` outside a gesture; component unreachable ◐ | `AudioToggle.tsx:13` |
| REA-14 | **M** | `LandscapeGuard` also fires on narrow desktop windows ◐ | `LandscapeGuard.tsx:11` |
| REA-15 | **M** | Two conflicting `<meta name="viewport">` declarations ◐ | `layout.tsx:37,59` |
| REA-16 | **M** | `localStorage` read in a `useState` initializer → hydration mismatch, full-page flash ◐ | `page.tsx:281` |
| REA-17 | **M** | `handleWatchMatch` has no `try/catch` or `AbortSignal` → unhandled rejection ◐ | `page.tsx:337` |
| REA-18 | **M** | Broadcast feed runs 5 channels + a 15s poll with the card closed; duplicate dead panels ◐ | `ActivityFeed.tsx:1381,97` |
| REA-19 | **M** | `TokenPiece` leaks `setTimeout`s and untracked GSAP timelines on capture-mid-hop ◐ | `board/TokenPiece.tsx:65,83` |
| REA-20 | **L** | `useScreenWakeLock` writes a ref during render ◐ | `useScreenWakeLock.ts:22` |
| REA-21 | **L** | A hook is called inside JSX props — order stability is incidental ◐ | `Board.tsx:340` |
| REA-22 | **L** | `INITIAL_GAME_STATE` carries a module-load timestamp; `leaveGame` reset can identity-bail ◐ | `gameLogic.ts:87` · `TeamUpContext.tsx:1018` |
| REA-23 | **L** | `GuestWallContext` value is an inline object literal ◐ | `GuestWallContext.tsx:44` |
| REA-24 | **L** | `handlePlayNow` not memoized → `onStartGame` identity churns every render ◐ | `page.tsx:599,433` |
| REA-25 | **L** | Stale closure in the searches subscription → your own search appears in the public feed ◐ | `ActivityFeed.tsx:819,861` |
| REA-26 | **L** | Board square floor can overflow a short landscape viewport ◐ | `Board.tsx:238` |
| REA-27 | **L** | Duplicate `Leaderboard` import — a never-rendered dynamic plus a static one ◐ | `page.tsx:36` · `Board.tsx:4` |
| REA-28 | **L** | `@x402/core|evm|extensions|svm` + `x402-fetch` declared but imported nowhere ◐ | `package.json` |
| REA-29 | **L** | OnchainKit API key hardcoded in `Providers.tsx` (public by design — confirm intent) ◐ | `Providers.tsx:71` |

---

## 5. Critical findings — detail

### SEC-01 · `roll-dice` is unauthenticated and receipts are never bound to the roller ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `supabase/functions/roll-dice/index.ts:21`, `:59` · `move-auth/index.ts:529` |
| Invariant broken | `AGENTS.md` #3 — "Edge `roll-dice` only" |

**Evidence** — no signature, no seat check, no turn check, no match-existence check, no rate limit; `walletAddress` is a free-text body field:

```ts
// roll-dice/index.ts:21
const { matchId, walletAddress, actionId, isPreWarm } = await req.json();
if (isPreWarm) return json({ status: 'warmed' });
if (!matchId || !walletAddress) { return json({ error: 'Missing required parameters…' }, 400); }
```
```ts
// roll-dice/index.ts:59 — service-role insert, no status, no actor proof
.from('match_rolls').insert({ match_id, wallet_address: String(walletAddress).toLowerCase(), action_id, result })
```
```ts
// move-auth/index.ts:529 — wallet_address is not even selected
.from('match_rolls').select('id, result, match_id, status').eq('id', rollId).maybeSingle()
```
`grep -n "lastRollId" move-auth/index.ts` → no match. The persisted `state.lastRollId` is never compared either, so a roll is not tied to the turn that produced it. `pass` has the identical gap at `:665-673`.

**Impact** — a seated player calls `roll-dice` N times with distinct `actionId`s, keeps the sixs, then `submit-move` with the best `rollId`. **Guaranteed 6 on demand**, which is the only way out of base (`engine.ts:185-192`), plus deterministic sixes for `three-sixes` forfeits. A third party can also mint unlimited `match_rolls` rows for any `matchId`, including nonexistent matches.

**Recommendation**
1. Require the caller's session/signature in `roll-dice`; verify the caller is seated and `state.currentPlayer === seatColor`; bind `wallet_address` to the **recovered** signer.
2. In `move`/`pass`, select `wallet_address` and reject unless `roll.wallet_address === recovered`.
3. Require `state.lastRollId === rollId` (or store `roll_id` on the state row and CAS it) so a roll can only be spent by the turn that minted it.

---

### SEC-02 · A seated guest chooses their own dice face ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `lib/gameProtocol.ts:21-23` → `hooks/useGameEngine.ts:386` → `hooks/useGameActions.ts:406` |
| Invariant broken | `AGENTS.md` #3 |

**Evidence** — the protocol schema explicitly permits the face:

```ts
// gameProtocol.ts:21
case 'REQUEST_ROLL':
    return payload.value === undefined
        || (typeof payload.value === 'number' && Number.isInteger(payload.value) && payload.value >= 1 && payload.value <= 6);
```
```ts
// useGameEngine.ts:386 — host calls handleRoll with the guest-supplied value
if (type === 'REQUEST_ROLL') { handleRoll(payload?.value); }
```
```ts
// useGameActions.ts:406 — truthy `value` skips the Edge branch entirely
let rollValue: number = value || 0;
if (!value) { /* … fetch roll-dice … */ }
```

**Impact** — guest sends `{type:'REQUEST_ROLL', payload:{value:6}}` → passes `isGameIntent` → host calls `handleRoll(6)` → `roll-dice` is **never called**, `rollValue=6`, `rollReceiptId=null`. Three consequences: the dice face is attacker-chosen (cleanest path to SEC-01); the entire `match_rolls` ledger is bypassable by any seated guest; and `lastRollIdRef.current` is not updated (line 434 skipped), so it still holds the previous turn's already-`consumed` `rollId` and the next `submitMove` hits `409 DUPLICATE_ACTION` and is dropped.

**Recommendation** — delete `payload.value` from the `REQUEST_ROLL` schema and from `isGameIntent`; the host must never accept a face. If a forced value is genuinely needed for AFK, route it through Edge `roll-dice` with an explicit `forcedBy:'afk'` flag and a receipt. Independently, make `handleRoll` refuse rather than fall through when `isLobbyConnected`.

---

### SEC-03 · `PUT /api/chips/settle/propose` has no auth → unauthenticated Edge abandon co-signature ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `app/api/chips/settle/propose/route.ts:142-195` |

**Evidence** — `POST` authenticates at `:52`; `PUT` has no `requireAppSession` anywhere, and every field of the signed digest is attacker-chosen:

```ts
export async function PUT(request: Request) {
    const { chainId, poolId, accusedSeat, seqAtDisconnect, afkStrikes, deadline, dual, hostSig } = body ?? {};
    if (!poolId || !accusedSeat) { return NextResponse.json({ error: "Missing abandon fields" }, { status: 400 }); }
    const digest = abandonDigest(params, pool, chainId);
    const edgeSig = await edgeSign(digest);          // ← no auth above this line
```
`deadline` defaults to `now+600` but is overridable (`:170`).

**Impact** — `MatchPool.submitAbandon` (`MatchPool.sol:446`) requires **only** `edgeSig`; `_abandon(..., dual=false)` sets `Status.Cancelled`, calls `_refundAllJoins`, and returns the host bond **without slashing** (`MatchPool.sol:690-693`). Any anonymous caller can grief-cancel any `Locked` wagered pool. A losing host calls it once after `lockPool` and recovers `hostBond` in full — `BOND_BPS_OF_PRIZE = 200` (`:110`) has no enforcement behind it. Secondary: griefs every other seat's in-flight pot, and permanently burns the accused seat's `creditedJoin`.

**Recommendation** — require a valid app session **and** verify `wallet === live_matches.host_address` for that `poolId`. Move abandon-evidence validation into the Edge policy (reject unless `match_states.seq` is stalled and `afkStrikes >= 3` for `accusedSeat`). Sign a digest binding the *reason code*, not free-form `seq`/`strikes`. Validate that `accusedSeat` is actually seated and `deadline <= settleBy`.

---

### SEC-04 · Mode-B settle has no sender authorization → pot + host bond theft ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `contracts/src/MatchPool.sol:419-444`, `:556`, `:609` · `app/api/chips/settle/propose/route.ts:31-136` |
| Pinned by | `contracts/test/MatchPoolSecurity.t.sol:140-141` (an unrelated address may submit) |

**Evidence** — the host signature is dropped once the settle window lapses, with no `msg.sender` check at all:

```solidity
bool modeB = block.timestamp > eff;                       // :430
if (!modeB) { if (!_verifyHost(d, hostSig, p.authority)) revert BadSignature(); }   // :437-439
if (_recover(d, edgeSig) != edgeSigner) revert BadSignature();                     // :440
```
```solidity
if (slashBond && payoutPlan.length == 1) { credit[poolId][payoutPlan[0].addr] += p.hostBond; }   // :609-611
```
The co-sign route's only gate is *any* SIWE session (`:52`); `authority` is read from the body (`:39`, `:108`) and never compared to the caller, and the "winner is a participant" check is skipped when `participants` is omitted. The `mode:"edge-only"` body flag is cosmetic — the contract derives `modeB` from `block.timestamp`, so the attacker need not send it. The `chips_pools` cache sum-check is fail-soft (`try/catch`), trivially bypassed with a `poolId` that has no cached row.

**Impact** — a player seated in a paid pool who is losing simply waits past `settleBy`, calls `POST /api/chips/settle/propose` with `payoutPlan: [{addr: self, amount: prizeFund}]`, and submits `settlePool(..., hostSig = "0x", edgeSig)`. `sum == p.prizeFund` and `seatIndex[me] != 0` both hold. They take **100% of `prizeFund` plus the entire host bond**. Nobody loses coins, so there is no victim complaint — the losers simply get nothing.

**Recommendation**
1. Require session **and** `wallet === pool.authority` (or an EIP-712 host proof over the same digest) before returning `edgeSig`, in **all** modes.
2. Read `prizeFund`, `hostBond`, `settleNonce` from `getPoolSummary`; ignore client amounts; keep the sum check as defence-in-depth but make it a hard 400.
3. In Mode B, require the Edge signature only when `match_states.status` is terminal, and restrict Mode-B plans to the ratio the contract already enforces (`payoutPlan.length == 2` for 4-seat pools).

---

### SEC-05 · Spectator bets mint coins from nothing ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `app/api/spectator-bets/route.ts:61-72` · `supabase/migrations/00000000000000_baseline.sql:512-552` |

**Evidence** — service-role insert, no stake debit anywhere in the repo, client-supplied `window_closed_at`:

```ts
const { data, error } = await db.from('spectator_bets').insert({
    match_id: String(matchId), player_id: wallet, bet_type: betType,
    bet_value: String(betValue || '').slice(0, 80), amount: numericAmount, odds,
    potential_payout: Math.floor(numericAmount * odds), window_closed_at: windowClosedAt,
}).select('id').single();
```
```sql
-- baseline.sql:525 — cash_out_bet credits half the payout of a bet that was never paid for
credited := floor(bet.potential_payout * 0.5);
update public.players set coins = coins + credited where wallet_address = lower(p_player_id);
```
`settle_match_bets` (`:544-548`) resolves every `status='open'` row regardless of placement time. `unique(player_id, action_id)` does not help — `action_id` is nullable and never sent (see DB-13).

**Impact** — fresh wallet → `POST {betType:'dice_roll', betValue:'6', amount:1000000}` (route caps at 1e6) → `potential_payout = 5,000,000` → `POST {action:'cash_out'}` → **+2,500,000 coins**. Repeatable and parallelisable. Separately, a participant may bet after the host closed the window with the outcome already known, and `settle_match_bets` marks it `won` — precisely the front-running `ENGINE_LOGIC.md:231` claims is prevented. *(Currently dormant: DB-01 froze `cash_out_bet`. It goes live the moment coins are unfrozen.)*

**Recommendation** — route placement through one `SECURITY DEFINER` RPC that debits `players.coins` (`UPDATE … WHERE coins >= p_amount`) in the same transaction, requires `live_matches.bet_window_status='open'`, reads `window_closed_at` from that row, and validates `bet_type`/`bet_value` against the declared window. Reject the raw insert path. Restore the `NOW() > window_closed_at` guard and the payout join that the archive version had (`migrations_archive/20260325_bet_resolution.sql:21-46`). Forbid `player_id IN (matches.participants)`.

---

### SEC-06 · `/api/match/start` is unauthenticated, voiding the settlement trust anchor ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `app/api/match/start/route.ts:11-31` · `app/api/match/record/route.ts:95-232` |

**Evidence** — no auth, no signature, `participants` from body:

```ts
export async function POST(request: Request) {
    const { roomCode, gameMode, participants } = await request.json();
    const { data, error } = await supabase.from('matches')
        .insert({ room_code: roomCode, game_mode: gameMode, participants }).select('id').single();
```
`/api/match/record` then derives the canonical host from the **stored** row:
```ts
const canonicalHost = String(existing.participants?.[0] || '').toLowerCase();
if (!canonicalHost || recovered !== canonicalHost) return 403;
```

**Impact** — an anonymous caller creates a match with themselves as `participants[0]`, signs `buildMatchRecordMessage` (they *are* the canonical host), and settles. Effects: free `total_wins`/`total_games`/`lxp`/`rxp`; `wager` is bounded only by `Number.isFinite(wager) && wager >= 0` (`:71`), so `winLxpGain = 150 + floor(wager*0.1)` (`:172`) writes ~1e11 lxp in one request — instant top of the leaderboard and `rank_tier`. Simultaneously `:206-228` writes `total_games`/`lxp`/`rxp` to **every address in `participants`** via `.ilike('wallet_address', addr)` on the service role, and fires `updateMissionProgress` for them — so an anonymous caller writes arbitrary progression deltas to any victim wallet.

**Recommendation** — require a wallet signature (or an app session bound to `participants[0]`) on `/api/match/start`. In `/api/match/record`, drop body-supplied `wager` in favour of the canonical `matches`/`chips_pools` value, and require every settled participant to have a `match_rolls` or `match_states` row for that `matchId` before writing their stats.

---

### SEC-07 · `/api/live-arena/power4p` `PATCH` is unauthenticated → authority hijack ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `app/api/live-arena/power4p/route.ts:76-101` |

**Evidence** — `requestedMatchId` taken verbatim, `arena_key` never checked, no auth:
```ts
export async function PATCH(request: Request) {
    const { matchId: requestedMatchId, arenaKey, authorityId } = await request.json();
    const matchId = requestedMatchId || (await sb.from('live_matches').select('match_id').eq('arena_key', ARENA_KEY)…).data?.match_id;
    const claim = await sb.from('live_matches')
        .update({ authority_id: authorityId, authority_heartbeat: now, updated_at: now })
        .eq('match_id', matchId)
        .or(`authority_id.is.null,authority_heartbeat.lt.${new Date(Date.now() - 8000).toISOString()}`);
    const updated = await sb.from('match_states')
        .update({ state: next, seq: Number(row.data.seq) + 1, updated_at: now })
        .eq('match_id', matchId).eq('seq', row.data.seq).select('seq').maybeSingle();
```
`POST` (`:19`) is equally unauthenticated and creates `matches`/`match_states`/`live_matches` rows under the service role. `matchId` UUIDs are public (`/api/match/state` is unauthenticated, plus the lobby broadcast).

**Impact** — anonymous `PATCH {"matchId":"<live wagered match uuid>","authorityId":"pwn"}`. The `authority_id.is.null` disjunct always holds for any match not yet ticked, so the claim succeeds and the attacker holds server-authoritative write on `match_states` for a real money match — they can CAS-loop `seq` to force a winner or stall forever to keep the pot locked. `POST` in a loop floods three tables.

**Note** — the client design is explicitly "any spectator claims authority" (`app/page.tsx:351-359`), so this is a *deliberate* trust-boundary break, not an oversight. It needs an explicit product decision plus a gate, not just a patch.

**Recommendation** — delete `requestedMatchId`; accept only `arenaKey` and derive `matchId` server-side from `live_matches.arena_key = 'power4p-ai'`. Require a host wallet signature (or app session equal to `live_matches.host_address`) before any `authority_id` write. Require a session on `POST`.

---

### ENG-01 · Capture force is computed from different boards in the two engines ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `lib/engine/core.ts:300,384` vs `lib/gameLogic.ts:376` |
| Invariant broken | `AGENTS.md` #2 — engine math is the single authority |

**Evidence** — identical `+1` in both, but fed **different boards**:

```ts
// engine/core.ts:300 — inside checkMultiCapture, applied to whatever `state` was passed
const actingForce = getTeamForceAtPoint(actingTeam, nextPos, state, playerCount) + 1;
```
```ts
// engine/core.ts:384 — the caller passes the POST-move board, so the mover is ALREADY counted
const captures = checkMultiCapture(tokenColor, nextPos, { ...state, positions: movedPositions }, cc, playerCount);
```
```ts
// gameLogic.ts:318-319 — the author's own comment says it is the pre-move board
// Force AFTER move.
// State passed is BEFORE the move. We add 1 to acting team's force.
const actingForce = getTeamForceAtPoint(actingTeam, nextPos, state, playerCount) + 1;
```

`actingForce` is therefore `F_pre + 2` on Edge and `F_pre + 1` in the app/AI. **The authority engine over-counts its own force by exactly 1**, so it captures strictly more.

**Empirical proof** — differential fuzz over both real modules (`/tmp/ludorev/fuzz.ts`):

```
[4P ] green=[38,38,28,26] red=[19,52,44,44] roll 6 → 44
      engine: captured=true  red=[19,52,-1,-1]     ← 2 tokens captured
      app   : captured=true  red=[19,52,44,44]     ← stack survives
[2v2] engine captured=true, app captured=false (identical positions) → turn economy diverges
```
Across 200k random legal moves per mode the divergence rate is **0.13%–0.18%**; in a 300-turn match it fires roughly once.

**Path split** — networked moves go `move-auth` → `_shared/engine.ts`; offline, bot, **host-local, AI, and the golden corpus** go `lib/gameLogic.ts`. `scripts/golden-replay.ts:22` imports `lib/gameLogic`, so the golden corpus pins the *wrong* engine and cannot see this. A token the UI shows alive is server-side dead; `match_moves.captured` disagrees with the client's `matchStats`.

**Recommendation** — pick one side. Since `lib/engine/core.ts` is declared canonical, change `core.ts:384` to pass pre-move `state` and keep the `+1` (equivalently, delete the `+1` at `:300` — but that is less readable). Then:
1. Add a differential test that runs N seeded matches through **both** implementations and asserts identical `positions`/`captured`/`winner`.
2. Repoint `scripts/golden-replay.ts` at `lib/engine/core.ts`.
3. Update ENG-08 (AI scoring) in the same change.

---

### ENG-02 · `LOBBY_COLORS['2v2']` is a second, contradicting pairing source ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `lib/gameLogic.ts:523-533` vs `lib/constants.ts:14` |
| Invariant broken | `AGENTS.md` #1 — `TEAM_PAIRINGS` is the single source of truth |

**Evidence**
```ts
const LOBBY_COLORS: Record<string, PlayerColor[]> = {
    '1v1': ['green', 'yellow'],
    '2v2': ['green', 'yellow', 'red', 'blue'],   // ← yellow in the 'teammate' seat
    '4P':  ['green', 'red', 'yellow', 'blue'],
};
const LOBBY_ROLES: Record<string, Array<'host'|'teammate'|'opponent'>> = {
    '2v2': ['host', 'teammate', 'opponent', 'opponent'],
};
```
```ts
// constants.ts:14 — the documented intent
// Lobby order is [host, teammate, opponent, opponent] → Green hosts with Blue.
export const TEAM_PAIRINGS = { green: 'blue', blue: 'green', red: 'yellow', yellow: 'red' } as const;
```

**Reproduced**
```
slot 0: color=green role=host
slot 1: color=yellow role=teammate      ← labelled teammate
TEAM_PAIRINGS says green's teammate is blue
MATCH? *** NO — CONTRADICTION ***
```
`assignJoinerToSlot` (`gameLogic.ts:618-624`) fills slot 1 first, so the first joiner is seated as green's *teammate* while being green's *opponent*.

**Impact** — two players who queue together land on opposite teams; the host is left without a partner. They can capture each other and receive no assist. `TeamUpMatchPanel.tsx:306` renders them as a pair (`role === 'host' || role === 'teammate'`), while `assignCorners2v2` seats them on **opposite diagonals**. Live in `TeamUpContext.tsx:949` (host lobby) and `hooks/useLobbyManager.ts`.

**Recommendation** — derive `LOBBY_COLORS['2v2']` from `TEAM_PAIRINGS` (`[host, TEAM_PAIRINGS[host], ...opponents]`) rather than hardcoding. Add a test asserting `getTeammateColor(slots[0].color) === slots[1].color` for every match type. Also fold ENG-19 (`shufflePlayers('1v1')` axis) into the same change since both are lobby-seating consistency bugs.

---

### DB-01 · `202609230003_freeze_legacy_coin_writers.sql` aborts mid-file ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `supabase/migrations/202609230003_freeze_legacy_coin_writers.sql:24-32` |

**Evidence** — `CREATE OR REPLACE` cannot rename input parameters, and **both** parameters were renamed:

```sql
-- 202609170001_marketplace_purchase.sql:13
create or replace function public.purchase_marketplace(
  p_wallet text, p_request_id text, p_item_ids text[], p_total bigint)
-- 202609230003_freeze_legacy_coin_writers.sql:25
create or replace function public.purchase_marketplace(
  p_wallet text, p_kind text, p_items text[], p_total bigint)   -- ERROR: cannot change name of input parameter
```
Postgres raises at execution. The file is **not wrapped in a transaction** (verified: zero `begin;`), so psql/CLI statement-by-statement execution committed everything before line 34 and never applied the rest.

**Actual vs intended** (proven by replaying the full chain against a live PostgreSQL 16):

| Object | Intended | Actual |
| --- | --- | --- |
| `cash_out_bet` | frozen | **frozen** (line 5 ran) |
| `settle_match_bets` | frozen | **frozen** (line 14 ran) |
| `purchase_marketplace` | frozen | **NOT frozen** |
| `block_coins_mutation()` | exists | **does not exist** |
| `players_coins_frozen` trigger | present | **absent** |

Proven on the post-chain DB:
```
set role service_role; update public.players set coins=999999 … → UPDATE 1   (trigger absent)
set role service_role; select public.purchase_marketplace('0xtest','req1',array['s1'],100);
  → {"balance": 999899}                                                     (coins still spendable)
```

**Impact** — `players.coins` has **no DB-level guard**, defeating the stated purpose of the migration. Simultaneously the freeze **breaks the live economy**: `/api/marketplace/purchase/route.ts:20` calls `purchase_marketplace` and `/api/spectator-bets/route.ts:50` calls `cash_out_bet`; the frozen RPCs now raise `LEGACY_COINS_FROZEN`, so **every marketplace SKU is unpurchasable (409)** and the error surfaces as a raw Postgres message.

**Recommendation** — never `CREATE OR REPLACE` over a live signature to freeze it. Fix and wrap in a transaction:
```sql
begin;
create or replace function public.purchase_marketplace(
  p_wallet text, p_request_id text, p_item_ids text[], p_total bigint
) returns jsonb language plpgsql security definer set search_path = public as $$
begin raise exception 'LEGACY_COINS_FROZEN'; end; $$;
commit;
```
Better: rename the stubs (`purchase_marketplace_frozen()`) and rely on the `players_coins_frozen` trigger plus the revoke loop. Add the CI check from DB-21 that every `rpc('name', {named args})` in `app/api` resolves against a migration-defined signature — that check alone would have caught this.

---

### DB-02 · `match_rolls.status` vocabulary mismatch breaks every networked move on a fresh install ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `supabase/migrations/00000000000000_baseline.sql:292` vs `supabase/functions/_shared/networkBoundary.ts:35-37` |

**Evidence**
```sql
status text not null default 'available',          -- canonical baseline:292
```
```ts
export function isDuplicateAction(status: string | null | undefined): boolean {
  return status !== 'open';                          // networkBoundary.ts:36
}
```
`roll-dice` never writes `status` (verified: no `status` key in its insert), so the DB default applies. `move-auth/index.ts:536` and `:671` then return `409 DUPLICATE_ACTION` for **every** `submit-move` and `pass-turn`. The archive lineage used `'open'` (`migrations_archive/20260916_match_states.sql:48`), which is why production works and a fresh `db reset` does not.

There is also **no CHECK constraint** on `match_rolls.status` anywhere, so `'consumed'`/`'passed'`/`'available'`/`'open'` are all accepted — the invariant lives only in JS. `scripts/network-boundary.test.ts:48-51` only exercises the pure function against hand-written literals, never the schema, so CI is green either way.

**Recommendation**
```sql
alter table public.match_rolls alter column status set default 'open';
alter table public.match_rolls add constraint match_rolls_status_check
  check (status in ('open','consumed','passed')) not valid;
alter table public.match_rolls validate constraint match_rolls_status_check;
```
Make `isDuplicateAction` an explicit allowlist so a future default cannot silently flip it, and add an integration test that inserts a receipt through the Edge path and then consumes it via `move-auth`.

---

### DB-03 · Fresh `supabase db reset` cannot complete the migration chain ◐

| | |
| --- | --- |
| Severity | **Critical** |
| Location | consequence of DB-01 · `supabase/migrations/` |
| Fixed by | DB-01 |

**Evidence** — because DB-01 raises mid-file, `supabase db reset` aborts and `supabase_migrations.schema_migrations` never records `202609230003`, `202609250001`, or `202609280001`. Combined with the partial commit, a "reset" database and a "migrated" database are **not equivalent**.

**Impact** — three compounding consequences:
1. Anyone provisioning a fresh Supabase project gets a schema missing three migrations, with **no error surfaced** — `db reset` reports success up to the failing statement.
2. `players.coins` has no DB-level guard (DB-01), so the one table the freeze was meant to protect is the one left open.
3. Two environments claiming to be "the same version" have different schemas, which makes every subsequent bug report ambiguous.

**Recommendation** — fixed by DB-01 (wrap `202609230003` in a transaction). Then add the `check:schema` gate from §7 so a future mid-file abort fails CI instead of silently truncating the chain. Also see DB-11 and DB-12 — even after DB-01, `RESET_FOR_FRESH_BASELINE.sql` no-ops when `pgcrypto` is installed into `public`, so the reset path needs its own fix and its own equality assertion against the migration path.

---

### NET-01 · `passTurn` is dead code — turns with no legal move permanently deadlock the match ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `hooks/useMoveAuth.ts:319,510` · `hooks/useGameActions.ts:54,489-511` · `supabase/functions/move-auth/index.ts:512,686` |

**Evidence** — `passTurn` is defined, typed into the consumer, and **called from zero app sites** (grep-verified across `app/`, `hooks/`, `lib/`; only `scripts/`). The Edge `pass` action is the only path that advances `state.currentPlayer` without a move:

```ts
// move-auth:686-694 — the only server-side turn advance without a move
next.currentPlayer = getNextPlayer(color, state.playerCount || '4P', activeColors(state), cc);
next.diceValue = null;
next.gamePhase = 'rolling';
```
But both "no move possible" and "three sixes" are resolved **client-side only**:
```ts
// useGameActions:489-511
if (isThreeSixes)      { pNextPlayer = getNextPlayer(color, currentState.positions); pDelayedAction = 'turnSwitch'; … }
if (validMovesCount === 0) { pNextPlayer = getNextPlayer(color, currentState.positions); pDelayedAction = 'turnSwitch'; … }
```
```ts
// move-auth:512 — the next player is hard-rejected
if (state.currentPlayer !== color) return json({ error: 'Not this color turn', currentPlayer: state.currentPlayer }, 403);
```

**Impact** — *Case A:* green rolls 1 with all tokens in base → `getLegalTokenIndices` returns `[]` → host switches to red **locally**. `match_states.state.currentPlayer` is still `'green'`. Red's `submitMove` → `403 Not this color turn` → `useGameActions.ts:167-175` logs and returns with **no retry**. The match is permanently stuck. *Case B:* `consecutiveSixes=2` + a 6 → three-sixes fires client-side, but `match_states.state.consecutiveSixes` is frozen at 2 forever, so the server never observes the third six.

This breaks on **any turn with no legal move** — an extremely common Ludo outcome — so networked matches are not reliably completable.

**Recommendation** — call `moveAuth.passTurn({matchId, rollId, expectedSeq, source:'host-assist', reason:'three-sixes'|'no-legal'})` from both branches, apply the returned `state` via `applyServerState`, and broadcast from *that*. Add a `.then` that retries once on `STALE_SEQ`. Resolve ENG-05 (three-sixes on the move path) in the same change so the counter has one implementation.

---

### NET-02 · Two independent `serverSeq` trackers reject every guest move ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `hooks/TeamUpContext.tsx:146` vs `hooks/useGameEngine.ts:215` · `hooks/useGameActions.ts:163` |

**Evidence** — two refs with the same name in two hooks:
```ts
// TeamUpContext.tsx:146 — advanced by applyServerState, the Edge broadcast, and resync
const serverSeqRef = useRef(0);
// useGameEngine.ts:215 — advanced ONLY by this client's own submitMove/submitPower
const serverSeqRef = useRef(0);
```
`expectedSeq` is sent from the **engine** ref (`useGameActions.ts:163`), and `_shared/networkBoundary.ts:13-21` is strict equality (`currentSeq === expectedSeq`).

**Impact** — after turn 1: `hostEngineSeq=1, hostCtxSeq=1, guestEngineSeq=0, guestCtxSeq=1`. Ada's move sends `expectedSeq=0` against `match_states.seq=1` → `{ok:false, code:'STALE_SEQ', seq:1}`. The recovery branch at `useGameActions.ts:169-173` updates the refs but there is **no retry**, so the move is lost. Every guest hits this the first time another actor advances the seq (a teammate's power, or any move after a turn switch). The player must wait out `timeLeft` and get AFK-auto-played.

**Recommendation** — delete `useGameEngine.ts:215` and thread `TeamUpContext.serverSeq` (expose the ref, not just the number) into `useGameActions`. Replace the two call sites at `:170` and `:177` with nothing — the shared ref is already updated by `applyServerState`. Add one bounded retry on `code === 'STALE_SEQ'`: re-read the snapshot, re-submit with the fresh `expectedSeq` and the **same** `rollId`.

---

### NET-03 · Any anon client can rewrite every board in the room ✅

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `hooks/TeamUpContext.tsx:655-676` · `hooks/useSupabaseRelay.ts:52,69` |

**Evidence** — three branches gate on `isHost`/`!isHost`; the state-mutating branches have **no** gate:
```ts
} else if (type === 'MOVE_TOKEN') {
    const color = payload.color as PlayerColor;
    const tokenIndex = Number(payload.tokenIndex);
    const targetPosition = Number(payload.targetPosition);
    setGameState(prev => { … newPos[color][tokenIndex] = targetPosition; … });   // no legality, no seq, no bounds
} else if (type === 'TURN_SWITCH') {
    const nextPlayer = (data.nextPlayer || data.currentPlayer) as PlayerColor;
    setGameState((prev) => ({ ...prev, currentPlayer: nextPlayer, diceValue: null, … }));
```
`game-room-<roomCode>` is a **public** broadcast channel: created with the public anon key, no `private: true`, no `supabase.realtime.setAuth`, and no `realtime.messages` RLS anywhere in `supabase/migrations/`.

**Impact** — with the anon key and a 6-character room code from any invite link:
```js
supabase.channel('game-room-'+code).send({type:'broadcast', event:'game-action',
  payload:{type:'MOVE_TOKEN', payload:{color:'green', tokenIndex:0, targetPosition:57}}})
```
Every peer — **including the host** — applies it. `color` is unvalidated (`[...undefined]` throws → crash; `tokenIndex: 99` appends a phantom token), `targetPosition` is unvalidated, and there is no seq comparison. The injected state then propagates back out, because `broadcastAction` reads `gameStateRef.current` (`TeamUpContext.tsx:415`) *before* the host's own correction effect can run, and `useGameEngine.ts:305-309` copies it wholesale into every guest. `TURN_SWITCH` alone lets an outsider hand the turn to any color on any client.

**Recommendation** — gate every mutating branch on `isHost || isComputeHost`. Require `data.source === 'match_states'` (or a host signature) before touching `positions`/`currentPlayer`. On a networked match, **drop** `MOVE_TOKEN`/`TURN_SWITCH` broadcasts entirely and rely solely on `match_states` — they are legacy transport hints per the comment at `TeamUpContext.tsx:611-613`, but they are in fact load-bearing for guests' boards. Then make the room channel `private: true` + `realtime.setAuth` with a match-session JWT, or move broadcasts behind Edge.

---

### REA-01 · One Supabase channel allocated per broadcast, never released ◐

| | |
| --- | --- |
| Severity | **Critical** |
| Location | `hooks/useSupabaseRelay.ts:51` |

**Evidence** — `RealtimeClient.channel()` unconditionally does `this.channels.push(chan)`; the only remover is `removeChannel()` → `unsubscribe()`. This is called from `relayViaSupabase` on **every** `broadcastAction` and every `sendIntent`:
```ts
processedActionIds.current.add(actionId);
supabase.channel(`game-room-${targetCode}`)
    .send({ type: 'broadcast', event: 'game-action', payload })
    .then((status) => { if (status !== 'ok') console.error('🚨 Supabase Relay Error:', status); });
```

**Impact** — a 4P match ≈ 60 rolls × ~5 actions ≈ 300 calls; with chat and emotes a long session reaches thousands. Each retained `RealtimeChannel` keeps its bindings, state, and timeout handle alive for the page's lifetime. Because the channel is never `subscribe()`d, `_canPush()` is false and realtime-js falls back to the REST broadcast endpoint with a deprecation warning — so **every** game action also pays an extra HTTP round trip.

**Recommendation** — create and subscribe one channel per room in the same effect that subscribes at `useSupabaseRelay.ts:69`, send via a `channelRef`, and `removeChannel` on room teardown. This also removes the double-subscribe hazard in NET-11.

---

## 6. Remediation phases

Full tracker with per-item checkboxes: **[`REMEDIATION_CHECKLIST.md`](./REMEDIATION_CHECKLIST.md)**.

| Phase | Goal | Findings | Gate to exit |
| --- | --- | --- | --- |
| **0 — Un-break the build** | A fresh `db reset` produces a schema equivalent to a migrated one | DB-01, DB-02, DB-03, DB-11, DB-12 | `npm run check:rls` extended to apply the chain to a scratch PG with zero errors |
| **1 — Close the money paths** | No unauthenticated or TOCTOU path can move value | SEC-03, SEC-04, SEC-05, SEC-06, SEC-09, SEC-10, SEC-11, ECO-01, ECO-02, ECO-03 | New scratch-DB test asserting every balance mutation is a conditional update or RPC |
| **2 — Restore dice + engine integrity** | Dice are unforgeable; one engine; one team table | SEC-01, SEC-02, ENG-01, ENG-02, ENG-08, ENG-13 | Differential engine test + `REQUEST_ROLL` schema test |
| **3 — Trust boundary hardening** | Authority is bound to resources | SEC-07, SEC-08, SEC-12…16, SEC-21, SEC-34, CRY-01…03 | Route matrix reviewed; `middleware.ts` rate limits in place |
| **4 — Netcode liveness** | Matches always complete | NET-01…09, REA-05 | `mp.harness` rewritten to drive real modules + hook harness |
| **5 — DB hardening** | Grants, RLS, publication, types | DB-04…10, DB-13…23, DB-27, ECO-08 | Scratch-DB assertions on grants, `pg_proc`, `column_default` |
| **6 — Client architecture** | No render storms, no leaks, real error isolation | REA-01…19 | `react-test-renderer` harness; profiler trace on a mid-range device |
| **7 — Hygiene** | Drift and dead code | ENG-15…20, NET-20…27, REA-20…29, SEC-29…35, ECO-04…07, CRY-04…08 | `check-rls` + a new `check:drift` gate |

---

## 7. Verification plan — new gates

The current suite cannot detect any Critical finding. These are the gates that would have.

| Gate | Catches | Implementation sketch |
| --- | --- | --- |
| **`check:schema`** | DB-01, DB-02, DB-03, DB-22 | Apply the full migration chain to a scratch PostgreSQL 16 in CI. Assert: zero errors; `column_default` for `match_rolls.status`; expected `pg_proc` signatures; no `anon`/`authenticated` EXECUTE on `security definer`; no `anon` table grants beyond the allowlist; `supabase_migrations.schema_migrations` contains every file. |
| **`check:rpc-args`** | DB-01 | Parse every `rpc('name', {named args})` in `app/api` + `lib` and resolve each named arg against a migration-defined signature. Fails on `p_request_id` vs `p_kind`. |
| **`test:engine-diff`** | ENG-01, ENG-08 | Run N seeded matches through both `lib/engine/core.ts` and `lib/gameLogic.ts`; assert identical `positions`/`captured`/`winner`/`bonusRoll` at every step. Fuzz with `fast-check`. |
| **`test:engine-core`** | ENG-03, ENG-04, ENG-05, ENG-11, ENG-12, ENG-14 | Direct unit coverage of `resolveNetworkedMove`, `applyPower` (all branches), `applyPowerPickup`, `activeColorsForTurns`, `effectiveMoveSteps`, `countNukeVictims`, `applyEngineCaptureEvents`, `stripPowerTypesForWire`. Currently **zero**. |
| **`test:golden-authority`** | ENG-01, ENG-03, ENG-06 | Repoint `scripts/golden-replay.ts` at `lib/engine/core.ts`; extend the corpus to terminate matches (currently `finished 0 / 50`) and to use `assignCorners2v2` + `getNextPlayer` for turn order. |
| **`test:netcode`** | NET-01…09, REA-05 | A `react-test-renderer` harness mounting `TeamUpProvider` with a fake Supabase channel + fake PeerJS peer. Assert: (a) one intent on both transports applies once; (b) `STALE_SEQ` retries; (c) a non-host `MOVE_TOKEN` is dropped; (d) a compute-host consumes `lastIntent`; (e) two intents in one tick both apply. |
| **`test:protocol`** | SEC-02, NET-04, NET-09 | Table-driven cases over `parseGameIntent` for every `GameIntentType`, asserting a hostile payload is rejected on **both** transports. |
| **`check:drift`** | ENG-17, ENG-20, DB-26 | Deep-compare `lib/engine/*` exports against `lib/constants` and `lib/boardLayout`; assert doc claims in `ENGINE_LOGIC.md` §5.2 match `AI_SCORES`. |
| **Route auth matrix** | SEC-08…14, SEC-21…28 | A generated table of `{route, method, auth, service-role, verdict}` diffed against a checked-in expectation, so a new unauthenticated mutation fails CI. |
| **`test:settlement`** | ECO-01, ECO-02, ENG-06 | Foundry test asserting `settlePool` reverts on a duplicate `payoutPlan` address and that `sum(plan) == prizeFund` on-chain for 1v1/2v2/4P shapes. |

---

## 8. Verified-correct inventory — do not regress

These were checked adversarially and are sound. Any change here needs the same scrutiny.

**Signature ↔ actor binding** — `authorizeActor` (`move-auth:219-245`) has exactly two mutually exclusive paths and no third: session → `verifyMatchSession`; signature → byte-compare of a server-rebuilt message + `verifyActorSignature` → `recoverMessageAddress` compared to the claim. `recovered` is always derived from the verified actor; **no body field is trusted unverified**. EIP-712 grants recover-and-compare before the row is written.

**Session scoping** — `verifyMatchSession` checks `match_id`, `wallet_address` (case-insensitive), `revoked_at`, and expiry. A `sessionId` alone cannot act as another player. Minting requires a `human` seat in `match_states.player_seats` or the recorded host. One active session per wallet+match via partial unique index `match_sessions_active_idx`.

**Turn and seat authority on Edge** — `Not this color turn` (`:512`), `host-assist requires recovered === row.host_address` (`:515`), `seatOwnsColor` (`:521`), `isTerminalMatch` (`:511`), and legality from `getLegalTokenIndices` (`:538`). `applyPower` re-checks turn/phase/spend itself.

**No client-supplied game results** — dice from the DB receipt, destination/capture/bonus/winner from `resolveNetworkedMove` → `processMove`. Never `pos + roll`, never a client `to_pos`/`captured`/`winner`. Power `type` validated against authority inventory.

**`resolve-bet` host gate** — `verifyPersonalSign` against `hostAddress` **plus** an independent `live_matches.host_address` comparison that fails closed when unset. `settle_match_bets` only touches `status='open'` rows, so replay credits nothing twice.

**Rule math** — no `pos + roll` anywhere outside `calculateNextPosition`. Exact gate crossing 52–57 verified for all four corners; overshoot rejected not clamped; six-to-leave gate; home entry capture-immune; all four start cells are safe stars; `assignCorners2v2` respects `TEAM_PAIRINGS` over 3000 sampled seatings.

**Board geometry** — `SHARED_PATH.length === 52` with 52 unique cells; per color positions `0..57` map to **58 distinct** cells with no duplicates or nulls; 20 home cells all unique; `startCell === SHARED_PATH[startIdx]` for every corner. `boardLayout.ts` and `engine/core.ts` copies verified byte-identical.

**`getBestMove` never returns an illegal index** — 20,000 random 4P positions × random rolls, 0 illegal picks.

**Contracts** — `nonReentrant` on every mutator; CEI ordering in `_applySettle`; `settleNonce` monotonic with pre-increment making settle single-use; `claimed[poolId][player]` shared between `_claim` and `refundJoin` making prize-and-refund mutually exclusive; `NotSeated` on every payout; `seatIndex != 0` prevents squatting and re-join; malleability-safe ECDSA (`s <= n/2`, `v ∈ {27,28}`, zero-signer rejected at every call site).

**`MatchPool` payout math** — `dustToFirst` computes `extra = prizeFund - sum` and adds it to the lowest-`seatIndex` entry; 4P computes `first = prize*75n/100n; second = prize - first`, summing exactly by construction. The contract recomputes identically and re-derives from `seatIndex` so plan ordering cannot redirect dust.

**Merkle claims** — leaves bind `chainId` + claiming contract, so a `SeasonClaim` leaf cannot be replayed as `LegacyClaim` or across chains. Roots are on-chain, challenge-gated (48h), once per epoch. Leaves recomputed on-chain from `msg.sender`, so a wrong amount fails `BadProof`. `hashPair` is OpenZeppelin-compatible and matches both `_verify` implementations.

**Crypto primitives** — AES-256-GCM with a 128-bit tag (authenticated, not malleable); 12 CSPRNG bytes per message under a per-message-derived key, so no IV reuse; no ECB anywhere. WebCrypto `importKey('jwk', …, {name:'ECDH', namedCurve:'P-256'})` validates `kty`, `crv`, and curve membership, so key-confusion and off-curve attacks are unavailable.

**Message authorization** — `/api/messages` derives `sender_id` from the SIWE session, never the body. Delete is restricted to sender/receiver and computes *which* flag to write from that same comparison. `mark_conversation_read` is service-role-only and bounded to the caller's thread.

**Key publication** — `/api/profile/ecdh` POST rebuilds the canonical message server-side, recomputes the fingerprint, verifies against the claimed wallet, and writes only under `recovered`. Uses a distinct `Ludo Base message key` prefix, separate from record/bet/move/seed/power/stream, so an ECDH-registration signature cannot be replayed as a settlement or move authorization.

**RLS** — all 37 tables have RLS enabled; **no `using (true)` write policy exists** in the canonical chain. `players` uses a column-level grant excluding `coins`, `peer_id`, `ecdh_pubkey`, `current_room_code` — best-in-class. Every `security definer` function in the chain pins `search_path = public` and is granted only to `postgres`/`service_role`.

**Client-side correctness** — Edge RNG is authoritative in networked seats with **no** client fallback (`useGameActions:435-441` aborts the roll). Move submission carries `expectedSeq` and the server `rollId` receipt. `applyServerState`'s seq gate rejects non-finite, `<`, and (absent `allowEqual`) `<=` seqs, so a stale snapshot cannot regress. `resyncProof` fails closed (rejects `matchId === 'local'`, requires `sessionId` + `actor`), and `resyncMatch` hard-rejects local matches — **a guest cannot force the host to adopt arbitrary state via resync**.

**Error handling** — `authorizeActor` has no internal `try/catch`; every verification failure returns 401/403 and execution never continues. The three broadcast `try {} catch {}` blocks wrap only the Realtime send, after state is committed.

---

## 9. Test coverage gaps

Structural gaps first — these are why the suite is green.

| # | Gap | Consequence |
| --- | --- | --- |
| 1 | **No test imports `lib/engine/core.ts` at all.** `engine.test.ts`, `engine.props.test.ts`, `golden-replay.ts`, `mp.harness.ts` all import `lib/gameLogic`. | The canonical Edge engine — `resolveNetworkedMove`, `applyPower`, `applyPowerPickup`, `activeColorsForTurns`, `effectiveMoveSteps`, `countNukeVictims`, `getStarIndices`, `nearestStarAhead`, `applyEngineCaptureEvents`, `stripPowerTypesForWire` — has **zero** coverage. |
| 2 | No differential test between `core.ts` and `gameLogic.ts`. | Would have caught ENG-01 immediately. |
| 3 | `scripts/replay.ts` never re-simulates — it parses JSONL and fingerprints it. | There is no independent replay verifier despite `npm run replay`. |
| 4 | Golden corpus never terminates a match (`finished 0 / 50`); `MAX_TURNS_PER_MATCH = 40` from positions `0..9`. `runGoldenMatch` hardcodes `playerCount:'4P'`, a fixed `CC`, and rotates turns with `COLORS[(i+1)%4]` instead of `getNextPlayer`. | `winner`, `winners`, `status:'finished'`, the entire 2v2 team-win path, and corner-based turn rotation are all unpinned. |
| 5 | `scripts/gameplay-gaps.test.ts` does not test gameplay — only `lib/localRoom`, `lib/notices`, `lib/emotes`, `EmoteTray`. | Contributes nothing to engine coverage despite the name. |
| 6 | No test asserts `TEAM_PAIRINGS` (engine copy) ≡ `TEAM_PAIRINGS` (constants), nor `SHARED_PATH`/`CORNER_SLOTS`/`SAFE_POSITIONS` across the three modules. | ENG-17 drift is silent today (verified byte-identical) and unasserted tomorrow. |
| 7 | No test for `lib/payoutPlan.buildPayoutPlan`. | ENG-06's 2v2 `throw` and the single-winner bypass are untested; production calls it inside a `try/catch` that swallows errors (`MatchStatsOverlay.tsx:205`). |
| 8 | No test for `lib/aiEngine.ts` scoring beyond a bench (`ai.bench.ts`, not in `npm test`) and a smoke (`hardening.test.ts:109`). | `calculateMoveScore`, `getBestPowerUsage`, `bestNukeTarget`, `checkShieldNeed` unasserted. |
| 9 | The four netcode drill scripts test none of the production code they claim to cover. | Every NET finding is structurally untestable today. |
| 10 | `abandon.ts` has no call sites; `classifyAbandon` tests assert on hand-built evidence objects. | Drill row D4 has no implementation to verify. |
| 11 | No resync-divergence test — nothing computes or compares a state digest in the client path. | `lib/replay/hash.ts` is imported only by `mp.harness.ts` and `hardening.test.ts`. |
| 12 | Spectator untested — `n6.test.ts` exercises only `parseSpectatorBroadcast` against one garbage input. | NET-10's channel-name mismatch is invisible. |
| 13 | No browser or hook harness in CI (`.github/workflows/ci.yml` runs `npx tsx --test`). | Every effect/dependency finding is structurally untestable. |

**Untested engine branches** — `applyPower` teleport (`from >= 49 && from <= 56 → 57`, the `nearestStarAhead` branch, `dest < 0` keep, and the absent victory check); `applyPower` nuke (`idx > 3`, zero victims, write-back, teammate exclusion, safe-star/shield exclusion, `nukeFlash`); shield (`tokensOnBoard` filter, dedupe); `applyPowerPickup` (every branch, incl. the `!tile.type` wire-sanitized guard, same-type clock refresh, the 32-try respawn loop, `POWER_EXPIRY_MS` fallback); `resolveNetworkedMove` (boost consumption + `boostTrail`, `!result.applied`, `powerSpentThisTurn` reset, boosted-six bonus); `countNukeVictims` (early return, ±3 window edges `=== 3` and `=== 4`, circular-track wrap); `nearestStarAhead` (`stars.length === 0`, wrap from 51 to 0, `dist === 0`); `getNextPlayer` (`currentIdx === -1`, empty `activeOrder`, no-seating fallback); `processMove` early exits (`state.winner`, `!targetPoint`, trap path, `steps === 0`); win block (`teamWon`, `status !== 'finished'` gating, `winners` dedupe); capture sub-cases (3+ stack, exact tie, capture on an opponent's own start cell, shielded token with a non-shielded victim-sibling, mixed 2v2 stacks); `handleThreeSixes` at `currentSixes >= 3`; `calculateNextPosition` for `steps > 6` / `<= 0` / non-integer / missing `cc[color]`; `getBoardCoordinate` for `pos = 58`, `-2`, `NaN`, missing corner; `applyEngineCaptureEvents` with `stats === undefined` and mixed-colour victims; `getTeamForceAtPoint` with `playerCount` omitted.

**Boundary positions** — token at 57 as a blocker; token at 57 as a mover's target; `0→52` and `51→52` in one hop; entering the home lane at 52 with roll 5 from 50; all four tokens home in 4P vs 2v2; capturing the last yard token (which also affects `activeColorsForTurns`).

**Lobby** — `createLobbySlots('2v2')` role/color vs `TEAM_PAIRINGS` (ENG-02); `assignJoinerToSlot` 2v2 fill order; `swapSlots` with duplicate `playerId`; `removePlayerFromSlot` + `canStartMatch`; `shufflePlayers` legacy branch (no `cc`) for `2v2`, which ignores `activeIndices` entirely (`:336`); `getIntermediatePathCoords` (`gameLogic.ts:259-280`) — the `i < 6` cap silently truncates a 6-step gate-crossing hop list.

---

## 10. Appendices

### 10.1 CI gate blind spots — `scripts/check-rls.mjs`

The gate passes (`✓ RLS static gate clean (11 migrations)`) while DB-01 through DB-06 are all live.

1. **Function bodies / DDL errors.** It is a regex scanner — no parse, no apply. DB-01 is a runtime `ERROR` and is invisible.
2. **RLS enabled ≠ privileged.** It never inspects `security definer`, `search_path`, or EXECUTE grants — DB-09 is out of scope.
3. **Over-broad table grants.** Line 44's `MONEY_COLUMNS` regex requires the column name inside the `grant` statement; Supabase's default `GRANT ALL ON <table>` never names columns, so it never fires.
4. **Its own `anon` check is vacuous.** Line 52 catches `grant insert/update … to anon`, but the baseline grants nothing, so it is green by absence.
5. **Per-file, not per-table.** Lines 59-62 fall back to `&& !/enable\s+row\s+level\s+security/i.test(sql)`, so a file with **one** `enable row level security` anywhere passes **every** table in it. `202609230002` and `202609230001` rely on this coincidence.
6. **It does not scan `migrations/` or `migrations_archive/`.** The world-writable `messages` UPDATE policy (DB-08) and the unpinned `update_offline_status()` (DB-25) are never examined.

### 10.2 Realtime publication — internally inconsistent

Verified contents after the canonical chain: `conversations`, `game_invites`, `live_chat`, `live_matches`, `matchmaking_queue`, `messages` (6).

| Table | In publication | Subscriber | Verdict |
| --- | --- | --- | --- |
| `messages` | yes | none (`postgres_changes`) | **Dead** — RLS has 0 policies, so events never deliver. `useMessages.ts` falls back to a 15s poll, which is why it is invisible. |
| `conversations` | yes | none | **Dead** — same reason. |
| `game_invites` | yes | none | **Dead** — 0 policies. |
| `matchmaking_queue` | yes | `useMatchmaking.ts:576` | **Partial** — column grant omits `id`, so the `filter` references a non-selectable column. Likely never matches. |
| `live_chat` | yes | broadcast | **Redundant** — public read is served by polling `/api/live-chat`; the SELECT policy allows full-row reads via `payload.new` incl. `sender_id`. |
| `live_matches` | yes | none | **Leaks** `join_secret_hash`, `arena_key`, `authority_id` in `payload.new` to any subscriber. Highest-severity realtime finding. |
| `players` | **no** | `useDataSync.ts:40`, `useMessages.ts:81`, `useCurrentUser.ts:94` | **Broken** — never in the canonical publication. Live leaderboard/status sync is dead on a fresh install. Also see CRY-04. |
| `player_missions` | **no** | `useDataSync.ts:79` | **Broken** — same. |
| `pokes` | **no** | `useNotifications.ts:143` | **Broken** — legacy `migrations/20260906_social_graph.sql:225` added it; canonical dropped it. |
| `match_states` | no | deliberately none (`useMatchStates.ts:58-60`) | **Intentional** — matches default-deny. |

### 10.3 Missing indexes and unindexed FKs

| Table | Missing index | Query path |
| --- | --- | --- |
| `messages` | `(receiver_id, sender_id, created_at desc)` | `api/messages:21-22` — the existing `messages_conversation_idx (sender_id, receiver_id, created_at desc)` only serves the leading branch; the `receiver_id` branch and the `OR` both seq-scan. |
| `match_rolls` | `(match_id, created_at desc)` | Present in `archive/20260916:17`, **absent from baseline**. Roll-audit/replay reads seq-scan. |
| `lobby_join_requests` | `(wallet_address)` | Present in `archive/20260917:17`, absent from baseline. |
| `match_sessions` | `(expires_at)` | Present in `archive/20260917:16`, absent from baseline. |
| `provisional_match_sessions` | `(wallet_address, expires_at)` | Present in `archive/20260918:12`, absent from baseline. |
| `app_sessions` | `unique (wallet_address) where revoked_at is null` | Archive has it; baseline's `app_sessions_active_idx` is **non-unique** → multiple live SIWE sessions per wallet are allowed. |
| `live_chat` | `(created_at desc)`, `(country, created_at desc)`, `(sender_id, created_at desc)` | All three in `migrations/20260906:21-23`, **all missing from baseline**. |
| `friendships` | `(user_address, status)` | `api/friendships:14` filters on both; only `friendships_friend_idx` exists. |
| `match_states` | `(host_address)` | The host-authority path filters on it. |

**19 unindexed FK columns** (verified via `pg_constraint` × `pg_index`), which makes every `ON DELETE CASCADE` from `players` a seq-scan. Highest value: `messages_receiver_id_fkey`, `match_rolls_wallet_address_fkey`, `lobby_join_requests_wallet_address_fkey`, `live_chat_sender_id_fkey`, `match_states_host_address_fkey`, `match_moves_actor_fkey`.

### 10.4 `security definer` functions — all sound

Verified via `pg_proc.proacl` on the post-chain DB.

| Function | `search_path` | EXECUTE | anon/authenticated? |
| --- | --- | --- | --- |
| `join_matchmaking(text,text,text,numeric,numeric,numeric)` | `= public` | `postgres`, `service_role` | no |
| `join_matchmaking_hybrid(text,text,text,numeric,numeric,numeric,text)` | `= public` | `postgres`, `service_role` | no |
| `cash_out_bet(uuid,text)` | `= public` | `postgres`, `service_role` | no |
| `settle_match_bets(uuid,text,text)` | `= public` | `postgres`, `service_role` | no |
| `join_tournament(uuid,text)` | `= public` | `postgres`, `service_role` | no |
| `mark_conversation_read(text,text)` | `= public` | `postgres`, `service_role` | no |
| `cleanup_matchmaking_queue()` | `= public` | `postgres`, `service_role` | no |
| `cleanup_stale_data()` | `= public` | `postgres`, `service_role` | no |
| `purchase_marketplace(text,text,text[],bigint)` | `= public` | `postgres`, `service_role` | no |
| `messages_restrict_columns()` *(trigger)* | `= public` | default `PUBLIC` | yes — but returns `trigger`, no callable entry point |
| `update_conversation_summary()` *(trigger)* | `= public` | default `PUBLIC` | yes — same |

The only unpinned `security definer` in the repo is `update_offline_status()` (DB-25), outside the chain.

### 10.5 `types/database.types.ts` drift

**Function mismatches (3 phantom + 1 missing + 1 absent)**

| Declared | Reality |
| --- | --- |
| `cleanup_old_messages` (`:820`) | does not exist in any migration |
| `increment_coins(p_amount, p_wallet)` (`:822-825`) | does not exist anywhere in the repo |
| `update_offline_status` (`:841`) | exists only in legacy `migrations/status_cleanup_job.sql` |
| `purchase_marketplace` | **absent** from `Functions` — callers need `as never` casts (`marketplace/purchase:20`) |
| `join_tournament` | absent from `Functions` despite existing in the DB |

**Missing tables (10 created by the chain, absent from `Tables`)** — `marketplace_purchases`, `referral_links`, `onboarding_progress`, `mission_vouchers`, `chips_events`, `chips_pools`, `chips_pool_seats`, `chips_claimable`, `wallet_links`, `push_subscriptions`.

**Column drift** — `matches`: `game_mode`, `participants`, `spectator_count`, `streaming_enabled`, `total_bet_volume`, `metadata` are `NOT NULL` but typed `| null`; `finished_at` missing entirely. `players`: 12 columns typed `| null` but `NOT NULL`; `rank_tier` missing entirely. `messages`: `ciphertext`, `encryption_nonce`, `encryption_version` missing entirely. Also `match_states.room_code`/`host_address`, `match_sessions.room_code`, `live_chat.room_open`, `spectator_bets.bet_metadata`/`odds`/`potential_payout`, `pokes.status`, `messages.deleted_by_*` all mis-nullable; `spectator_bets.payout_amount` is in the DB and read by `spectator-bets:39,46` but absent from the type; `tournaments` has 3 of 9 columns typed.

**RPC named-argument audit** — all 6 call sites resolve correctly against migration-defined signatures. `marketplace/purchase:20` passes `p_request_id`/`p_item_ids`, which is **exactly** what DB-01 tries to rename.

**Recommendation** — regenerate with `supabase gen types typescript --project-id <ref> --schema public`. Hand-maintenance has drifted on 8 tables, ~25 columns, and 3 functions.

### 10.6 Recommended DB-09 remediation

```sql
do $$ declare t text; begin
  foreach t in array array['players','app_sessions','matches','matchmaking_queue','game_invites',
    'friendships','user_blocks','user_reports','conversations','messages','pokes','activities',
    'player_missions','live_matches','live_chat','spectator_bets','coin_ledger','match_sessions',
    'provisional_match_sessions','match_rolls','match_states','match_moves','lobby_join_requests',
    'tournaments','tournament_participants','tournament_matches','feedback'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop; end $$;
grant select (wallet_address, username, avatar_url, lxp, rxp, status, classic_played,
  power_played, ai_played, total_wins, total_games, rank_tier, last_played_at, created_at)
  on public.players to anon, authenticated;
```
And for DB-10, column-scope `live_matches`:
```sql
revoke select on public.live_matches from anon, authenticated;
grant select (match_id, room_code, bet_window_status, window_opened_at, window_closed_at,
  current_bet_type, spectator_count, created_at, updated_at) on public.live_matches to anon, authenticated;
```

### 10.7 Route auth matrix — unauthenticated mutations and IDOR

| Route | Method | Auth | Service role | Verdict |
| --- | --- | --- | --- | --- |
| `/api/chips/settle/propose` | `PUT` | **none** | yes (edge key) | **CRIT** SEC-03 |
| `/api/chips/settle/propose` | `POST` | session only | yes | **CRIT** SEC-04 |
| `/api/live-arena/power4p` | `PATCH` | **none** | yes | **CRIT** SEC-07 |
| `/api/live-arena/power4p` | `POST` | **none** | yes | unauth mutation (arena only) |
| `/api/match/start` | `POST` | **none** | yes | **CRIT** SEC-06 |
| `/api/lobby/join` | `POST` | **none** | yes | **HIGH** SEC-12 |
| `/api/spectator-bets` | `POST` | session only | yes | **CRIT** SEC-05 |
| `/api/missions/claim` | `POST` | session only | yes | **HIGH** SEC-09 |
| `/api/missions/voucher` | `POST` | session only | yes | **HIGH** SEC-10 |
| `/api/chips/lobby-ticket` | `POST` | session only | yes | **HIGH** SEC-11 |
| `/api/friends` | `GET` | **none** | yes | **HIGH** SEC-08 |
| `/api/friendships` | `POST remove` | session only | yes | **IDOR** SEC-13 |
| `/api/push/subscribe` | `POST unsubscribe` | session only | yes | **IDOR** SEC-14 |
| `/api/profile/ecdh` | `POST` | signature | yes | OK — self-scoped |
| `/api/wallet-links` | `POST` | dual signature | yes | self-authorized, but no `isFreshIssuedAt` (SEC-24) |
| `/api/match/record` | `POST` | signature | yes | guarded *given* a canonical match — anchor broken by SEC-06 |
| `/api/match/stream` | `POST` | signature | yes | correct (canonical host + freshness) |
| `/api/live-matches/window` | `POST` | session = `participants[0]` | yes | correct |
| `/api/matchmaking/{join,status,cancel}` | * | session + owner | yes | correct |
| `/api/messages`, `/api/social/*`, `/api/profile`, `/api/onboarding/*`, `/api/lobby/invite(s)`, `/api/marketplace/purchase`, `/api/presence` | * | session, self-scoped | yes | no IDOR found; all `.or()` inputs regex-validated via `requireAppSession` |

Unauthenticated **read-only** service-role routes (disclosure, not privilege): `/api/match/state` (by design, but see ENG-07), `/api/farcaster`, `/api/friends`, `/api/wallet-links` GET, `/api/predictors/board`, `/api/presence/online`, `/api/matchmaking/pools`, `/api/notices`, `/api/geo`, `/api/activity`, `/api/activities`.

**Cross-cutting:** no `middleware.ts` → no rate limiting anywhere; `/api/siwe/verify` mints 7-day sessions without throttling, which is what makes every "session-authed" attacker scenario one HTTP round-trip away.

---

## 11. Artifacts and repros

Repro scripts were written to `/tmp/ludorev/` (outside the repo — nothing in the working tree was modified):

| Script | Proves |
| --- | --- |
| `fuzz.ts` | ENG-01 — differential fuzz of `lib/engine/core.ts` vs `lib/gameLogic.ts` |
| `divergence.ts` | ENG-01 — single hand-built capture scenario with per-engine force readout |
| `lobby2v2.ts` | ENG-02 — `createLobbySlots('2v2')` vs `TEAM_PAIRINGS` contradiction |

Run with `npx tsx`. The DB findings (DB-01, DB-02, DB-09, DB-22, §10.4) were proven by replaying the full migration chain against a live PostgreSQL 16 scratch database.

**Not empirically proven** (static trace only, flagged for honesty): all `◐ reported` findings; REA-06's frame cost (needs a device profiler trace); REA-01's channel growth (proven from `realtime-js` source plus call-site counting, not a heap snapshot).

---

## 12. Doc-drift items to reconcile alongside

Fixing these findings changes documented behaviour. Update in the same PR:

| Doc | Claim | Finding |
| --- | --- | --- |
| `ENGINE_LOGIC.md:231` | "`settle_match_bets` … performs a server-side check ensuring `NOW() > window_closed_at`. This prevents front-running even if the client-side Edge Function trigger is spoofed." | DB-04 — the guard does not exist in the canonical schema |
| `ENGINE_LOGIC.md:201` | DM send "fails closed (no plaintext downgrade)" | CRY-03 — client-only, not a server property |
| `ENGINE_LOGIC.md:217` | spectator channel is `game-room-` | NET-10 — the code subscribes to `match-states-room-` |
| `ENGINE_LOGIC.md` §3.5 | "Tiles render NOTHING pre-pickup" | ENG-07 — `/api/match/state` publishes every tile's `type` |
| `ENGINE_LOGIC.md` §5.2 | "Reach Finish Zone (+200)"; no `PROMOTION` | ENG-16 — `constants.ts:60` has `PROMOTION: 150, REACH_FINISH: 150` |
| `ENGINE_LOGIC.md` §5.4 | Boost is "used strategically" | ENG-18 — the AI spends it unconditionally |
| `AGENTS.md:40` | `messages_restrict_columns` cited to the archived migration | CRY-07/DB-07 — canonical is `baseline.sql:417` and is stronger |
| `AGENTS.md:41` | invariant 7 "send fails closed (no plaintext downgrade)" | CRY-03 |
| `AGENTS.md` invariant 3 | "Edge `roll-dice` only" | SEC-01, SEC-02 |
| `AGENTS.md` invariant 1 | `TEAM_PAIRINGS` is the single source of truth | ENG-02 |
| `AGENTS.md` invariant 2 | "always `calculateNextPosition`" | holds — keep, but see ENG-01 (correct rule, divergent force input) |
| `supabase/schema_list.md:17` | "Public reads are explicitly limited to spectator-facing match/live/tournament data" | DB-10 — `live_matches` exposes `join_secret_hash` |
| `docs/ops/NETCODE_DRILLS.md:39` | counter list to graph during drills | NET-21 — `net_authority_switch` and `net_heartbeat_ok` are never bumped in production |
| `docs/ops/NETCODE_DRILLS.md` rows D3/A4 | host-elect / intent-flood pass criteria | NET-21, and the drills re-implement dedup locally |
| `docs/ops/UNPARK_CHECKLIST.md` | "Code gate green — needs device + live-drill sign-off" | still true, but the code gate does not cover the authority engine or the schema |
