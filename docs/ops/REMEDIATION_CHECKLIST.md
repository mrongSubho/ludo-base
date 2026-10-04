# Remediation checklist — system review

| Field | Value |
| --- | --- |
| **Source** | [`SYSTEM_REVIEW.md`](./SYSTEM_REVIEW.md) @ `e49600a`, 2026-10-05 |
| **Status** | 0 / 154 closed · **16 Critical open** |
| **Baseline gates** | `tsc` 0 · `lint` clean · `npm test` 91/91 · `check:engine` sync · `check:rls` clean |
| **Rule** | Do not close an item until its **exit gate** passes. A finding closed by assertion, not by test, reopens. |

**How to use.** Work one phase at a time. Each phase has an ordered task list and an exit gate. Tick the boxes as you land commits. Reference finding IDs (`SEC-01`, `ENG-01`, …) in the PR description so the register stays authoritative.

**Phases are ordered by dependency, not by severity.** Phase 0 first: until a fresh `db reset` produces a schema equivalent to a migrated one, nothing else can be validated.

---

## Phase 0 — Un-break the build from source

**Why first.** `202609230003` aborts mid-file, so a reset DB ≠ a migrated DB. Every schema claim below is unverifiable until this is fixed.

### Tasks

- [ ] **DB-01** — Fix `202609230003_freeze_legacy_coin_writers.sql`. Rename the stub args to match the live signature (`p_request_id`, `p_item_ids`) **or** rename the stub function to `purchase_marketplace_frozen()`. Wrap the whole file in `begin; … commit;`.
- [ ] **DB-01** — Decide the intended coin model. The freeze and the live economy contradict each other: `/api/marketplace/purchase` and `/api/spectator-bets` both call frozen RPCs and return 409. Either lift the freeze behind the RPCs below, or remove the callers.
- [ ] **DB-01** — Verify `players.coins` actually has a guard after the fix: on a scratch DB, `set role service_role; update players set coins=…` must fail.
- [ ] **DB-02** — `alter table public.match_rolls alter column status set default 'open';`
- [ ] **DB-02** — Add `match_rolls_status_check check (status in ('open','consumed','passed'))`, then `validate`.
- [ ] **DB-02** — Make `isDuplicateAction` an explicit allowlist so a future default cannot silently flip it.
- [ ] **DB-03** — Confirm `supabase db reset` completes the full chain and records every file in `supabase_migrations.schema_migrations`.
- [ ] **DB-11** — Fix `RESET_FOR_FRESH_BASELINE.sql`: exclude extension-owned objects from the drop loop (`not exists (select 1 from pg_depend …)`).
- [ ] **DB-12** — Drop `supabase_realtime` publication members inside the reset loop so reset ≡ migrated.
- [ ] **DB-21** — Add `npm run check:schema`: apply the chain to a scratch PostgreSQL 16 in CI. Assert zero errors, expected `column_default` values, expected `pg_proc` signatures, no `anon`/`authenticated` EXECUTE on `security definer`, and no `anon` table grants beyond the allowlist.
- [ ] **DB-21** — Add `npm run check:rpc-args`: resolve every `rpc('name', {named args})` in `app/api` + `lib` against a migration-defined signature. *(This gate alone catches DB-01.)*
- [ ] **DB-21** — Extend `check-rls.mjs` or replace it with `check:schema`; see the six blind spots in [`SYSTEM_REVIEW.md` §10.1](./SYSTEM_REVIEW.md).

### Exit gate

- [ ] `npm run check:schema` green on a scratch DB with the chain applied from empty.
- [ ] `supabase db reset` completes; schema diff against a migrated DB is empty.
- [ ] A receipt inserted through Edge `roll-dice` is consumable by `move-auth` (integration test, not unit test of `isDuplicateAction`).
- [ ] `/api/marketplace/purchase` returns 200 on a real SKU, or its caller is removed.

---

## Phase 1 — Close the money paths

**Why.** Three unauthenticated or TOCTOU paths can currently move value. All balance mutations are read-then-write with no DB-level atomicity.

### Tasks — authentication and authorization

- [ ] **SEC-03** — `requireAppSession` on `PUT /api/chips/settle/propose`; require `wallet === live_matches.host_address` for `poolId`.
- [ ] **SEC-03** — Validate abandon evidence in the Edge policy: pool exists, `status === Locked`, `accusedSeat` is seated, `deadline <= settleBy`, `match_states.seq` stalled, `afkStrikes >= 3`.
- [ ] **SEC-03** — Sign a digest binding a **reason code**, not free-form `seq`/`strikes`.
- [ ] **SEC-04** — `settle/propose` `POST`: require `wallet === pool.authority` (or an EIP-712 host proof over the same digest) **in all modes**, not just pre-window.
- [ ] **SEC-04** — Read `prizeFund`, `hostBond`, `settleNonce` from `getPoolSummary`; ignore client amounts. Make the sum check a hard 400, not `try/catch`.
- [ ] **SEC-04** — Require `participants` to be present and non-empty; reject empty.
- [ ] **SEC-04** — Foundry: assert `settlePool` is not callable by a non-authority after `settleBy`. *(Note `MatchPoolSecurity.t.sol:140-141` currently pins the opposite — update it deliberately.)*
- [ ] **SEC-06** — Require a wallet signature or an app session bound to `participants[0]` on `POST /api/match/start`.
- [ ] **SEC-05** — One `SECURITY DEFINER` RPC for bet placement: debit `players.coins` (`UPDATE … WHERE coins >= p_amount`) in the same transaction, require `live_matches.bet_window_status='open'`, read `window_closed_at` from that row, validate `bet_type`/`bet_value` against the declared window. Reject the raw insert path.
- [ ] **SEC-05** — Restore the `NOW() > window_closed_at` guard and the payout join from `migrations_archive/20260325_bet_resolution.sql:21-46`.
- [ ] **SEC-05** — Forbid `player_id IN (matches.participants)`.
- [ ] **ECO-01** — `MatchPool._applySettle`: accumulate credits (`+=`) **or** reject duplicate addresses in the validation loop. A ≥3-entry plan with a repeated address currently passes `sum == prizeFund` and strands funds permanently.
- [ ] **ECO-02** — `MatchStatsOverlay:194` — read `prizeFund` from `getPoolSummary`; keep every amount in `bigint` end-to-end (`(prizeFund * 75n) / 100n`). No `Number` in the settle path.
- [ ] **ECO-03** — Check the return values of `burnWithMemo` and `transferWithMemo` in `_applySettle`; make `burnWithMemo` return `bool` in `IChips.sol`.
- [ ] **ECO-08** — Add a `shape`/`gameMode` discriminator to `Pool` so the contract stops inferring 2v2-vs-4P from colours + winner count.

### Tasks — atomicity

- [ ] **SEC-09** — One `SECURITY DEFINER` RPC for mission claims: `UPDATE player_missions SET is_claimed=true WHERE id=… AND is_claimed=false RETURNING *` → abort on 0 rows → `UPDATE players SET coins = coins + amount` in the same transaction. Model it on `purchase_marketplace` (202609170001:18-33), the only correct coin path in the repo.
- [ ] **SEC-09** — Reconcile the two reward tables: route `daily_bonus` is 100, `ONBOARDING_REWARDS.daily_bonus` is 20.
- [ ] **SEC-10** — `missions/voucher`: gate signing on real eligibility (`player_missions.progress >= target AND NOT is_claimed`, or the `onboarding_progress` check that `/api/onboarding/claim:86-107` already does).
- [ ] **SEC-10** — Derive `periodId` server-side only (`periodIdDay()`); derive `nonce` from a DB sequence, not `Date.now()`.
- [ ] **SEC-10** — Make the `mission_vouchers` bookkeeping insert load-bearing *after* the uniqueness check, not inside `try/catch`.
- [ ] **ECO-06** — `mission_vouchers`: normalize case in the unique key, unify units (whole CHIPS vs wei), stop swallowing the insert failure.
- [ ] **SEC-11** — `chips/lobby-ticket`: load the canonical `live_matches`/`matches` row for `matchId`; require `host_address == wallet` there; build `seats`/`colors`/`gameMode`/`maxSeats` from the stored match, not the body.
- [ ] **DB-13** — Make `spectator_bets.action_id` `not null`, or add `unique (player_id, match_id, bet_type, bet_value) where action_id is null`.
- [ ] **DB-14** — Wire CHIPS writes through `coin_ledger`, or document it as reserved. It currently has `unique(player_id, idempotency_key)` and **zero** writers, implying a double-entry guarantee that does not exist.

### Exit gate

- [ ] A test asserts every balance mutation in `app/api` is a conditional update or a `SECURITY DEFINER` RPC — no read-then-write remains.
- [ ] `check:schema` asserts no `security definer` coin function is executable by `anon`/`authenticated`.
- [ ] Parallel-claim test: N concurrent `missions/claim` for the same mission credit exactly once.
- [ ] Parallel-bet test: N concurrent `spectator-bets` with insufficient balance debit at most the balance.
- [ ] Every route in [`SYSTEM_REVIEW.md` §10.7](./SYSTEM_REVIEW.md) marked CRIT/HIGH is closed or has a written, signed-off risk acceptance.

---

## Phase 2 — Restore dice and engine integrity

**Why.** A seated guest can currently choose their own dice face, and the two live engines resolve the same capture differently.

### Tasks — dice

- [ ] **SEC-02** — Delete `payload.value` from the `REQUEST_ROLL` branch of `isGameIntent` (`lib/gameProtocol.ts:21-23`). The host must never accept a face.
- [ ] **SEC-02** — `useGameEngine.ts:386` — call `handleRoll()` with no argument on the networked path.
- [ ] **SEC-02** — If AFK forced rolls are genuinely needed, route them through Edge `roll-dice` with a `forcedBy:'afk'` flag so a receipt still exists. Do **not** add a client fallback.
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
