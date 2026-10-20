# Review Verification — October 2026 Remediation Claims

**Date:** 2026-10-20 · **Audits:** `docs/ops/SYSTEM_REVIEW.md` §4.8 / §5 · `docs/ops/IMPLEMENTATION_RECORD.md` Part XI
**Baseline of the original review:** `a9b3a3d` · **HEAD verified:** `5ff39c5`
**Method:** read every remediation commit diff (`dc943f8`, `4970cae`, `ab1ce8a`, `148b702`, `255d95d`, `5ff39c5`),
diffed `a9b3a3d..HEAD` per file, re-read each claimed-closed site, and re-ran every gate.

---

## 0. Verdict

The register marks **all 30 findings "Closed."** Verified against the code:

| Outcome | Count | Findings |
|---|---|---|
| **Genuinely closed** (real code change, correct) | **4** | `TU-2`, `MM-2`, `MM-4`, `MO-2` |
| **Partially closed** (real change, residual defect) | **1** | `MM-1` |
| **Mitigated but bypassable** | **1** | `TU-1` |
| **Fixed with a new regression** | **1** | `PW-2` |
| **No code change at all** — documentation only | **19** | `SA-1`, `SA-2`, `PW-1`, `PW-3`, `PW-4`, `TU-3`, `TU-4`, `TU-5`, `MM-3`, `MM-5`, `MO-1`, `MO-3`, `MO-4`, `MO-5`, `PW-5`, `PW-6`, `SA-3`, `SA-4`, `SA-5` |

The five `CHAIN-*` items are outside the game-systems scope of my review; spot-checking `CHAIN-02`
(`useChipsPool` 12-tuple decode) and `CHAIN-05` (`lib/chips.ts` `isAddress`/`getAddress`) shows both are
real, correctly-implemented fixes.

**Two of the three Critical items from the original review — `SA-2` and `PW-1` — have had no code change
whatsoever and are still open.** `SA-2` is the one that pays progression.

---

## 1. Corrections to my own original review (read this first)

Two claims in `SYSTEM_REVIEW_2026-10-20.md` were **wrong**, and I carried them from stale notes instead of
verifying them. They must be corrected before anything else, because the replacement findings are sharper:

**1.1 "Track A is not started — `wrangler.jsonc` has no DO bindings."** — **False.**
`wrangler.jsonc` declares both bindings, a `new_sqlite_classes` migration, and a cron:

```jsonc
"durable_objects": { "bindings": [
    { "name": "MATCH_ROOM",   "class_name": "MatchRoom" },
    { "name": "RATE_LIMITER", "class_name": "RateLimitDO" } ] },
"migrations": [ { "tag": "v1", "new_sqlite_classes": [ "MatchRoom", … ] } ],
"triggers": { "crons": [ "0 * * * *" ] }
```

`src/worker.ts` (154 ln) is the real entry: it re-exports the OpenNext handler, exports both DO classes,
handles the `/api/room/:matchId/ws` upgrade, and runs `handleScheduledCleanups`.

**1.2 "No scheduler exists."** — **False.** `handleScheduledCleanups` runs hourly and calls
`cleanup_matchmaking_queue` and `cleanup_stale_data` over PostgREST. So `MM-2`'s stale-ticket exposure was
already bounded; only the orphan-ticket cancel was genuinely broken.

**1.3 The corrected finding — which is stronger, not weaker.** The Durable Objects are *built, bound,
migration-tagged, unit-tested and never called*:

- `lib/netcode/roomClient.ts` (378 ln, a full `RoomClient`) is imported by **one test** and no production code.
- `NEXT_PUBLIC_ROOM_WS_URL` appears in `AGENTS.md` and the migration plan — and in **zero** source files.
- `lib/rateLimit.ts` never references `RATE_LIMITER`; it is still `const buckets = new Map<string, Bucket>()`.
- Meanwhile `hooks/useMoveAuth.ts:36` still targets `${SUPABASE_URL}/functions/v1/move-auth`.

So the platform work is done and the runtime never adopts it. That is the accurate `SA-1`/`SA-5` finding,
and it is a wiring problem, not a "not started" problem.

---

## 2. Genuinely closed — verified

| ID | Change | Evidence |
|---|---|---|
| `TU-2` | `const coins: number \| null = null;` in `seatGuestPlayer` | `TeamUpContext.tsx:594`; peer `payload.coins` no longer reaches `playerCoins` |
| `MM-2` | Cancel now resolves a session before posting | `useMatchmaking.ts:403-414` — `ensureAppSession().then(sId => … { ticketId, playerId: null, sessionId: sId })` |
| `MM-4` | Mode/shape whitelist at the API boundary | `app/api/matchmaking/join/route.ts:78-82` — `ALLOWED_MODES` / `ALLOWED_TYPES`, 400 on miss |
| `MO-2` | Spectator derives shape and mode from the match | `app/page.tsx:920-921` — `playerCount={spectatorGameState?.playerCount \|\| "4P"}` · `gameMode={(spectatorGameState?.powerTiles?.length ?? 0) > 0 ? "power" : "classic"}` |

`MO-2`'s heuristic is reasonable: `powerTiles` is populated only in power mode (`useGameEngine.ts:141-146`),
so tile-presence is a sound discriminator for a match already in flight.

---

## 3. `MM-1` — real fix, with a residual defect

`supabase/migrations/202610200001_matchmaking_shape_aware.sql` genuinely replaces the 2-player
`join_matchmaking`: `slots_needed := case when p_match_type in ('2v2','4P') then 4 else 2 end`, a CTE over
`limit opponents_needed … for update skip locked`, and the roster written with `match_shape`.

**Residual defect:** the triggering player never gets a queue row. The `update … where id = any(matched_ticket_ids)
or (player_id = p_player_id and status = 'searching')` clause has nothing to match for the caller — they have
not inserted a ticket yet (the insert is the *fall-through* branch). Consequences:

- `/api/matchmaking/status?matchId=…` builds the roster from `matchmaking_queue` where `match_id = …`, so the
  triggering player is **missing from the 3-of-4 roster**.
- `withCallerToken` looks up the caller's ticket by `player_id + match_id`; for the triggering player there is
  none, so `dispatchMatch` receives `validationToken: undefined`.
- The caller is structurally unable to be resolved as host (`authority === me` is never true for them).

Fix: insert the caller's ticket row first (or include them in the `update` via a `returning`), then match.
Also worth adding a `matchmaking-shape` test that asserts against the **SQL text**, since the current test
cannot fail (see §6).

**Remotely applied?** Unverifiable from here. `.supabase-applied.json` only records `db:migrate` runs and is
dated 2026-10-19, before this file; `db push` does not write it. The claim needs a
`select pg_get_functiondef('public.join_matchmaking'::regproc)` on the hosted project.

---

## 4. `TU-1` — mitigated, but trivially bypassable

The fix adds a sender comparison to each verb:

```ts
if (isHost && data.sender && myAddress && String(data.sender).toLowerCase() !== myAddress.toLowerCase()) {
    console.warn('⚠️ [Host] Dropping unauthorized external START_GAME from:', data.sender);
    return;
}
```

Three independent bypasses, all one line:

1. **`data.sender` is attacker-controlled.** It is just a field in the broadcast payload
   (`useSupabaseRelay.ts:75` sets `sender: myAddress?.toLowerCase() || 'host'`). An attacker sets it to the
   host's address — which is public, since `matches.participants[0]` and `live_matches.host_address` are both
   world-readable.
2. **`data.sender &&` short-circuits.** Omit `sender` entirely and the guard is skipped.
3. **`START_GAME`'s check is gated on `isHost`.** On a guest client `isHost` is false, so the condition is
   never evaluated and any injected `START_GAME` still applies — including `initialBoardConfig`.

And the deeper gap is untouched: `MOVE_TOKEN` still writes `payload.targetPosition` into
`positions[color][tokenIndex]` with no check against `calculateNextPosition`. The channel is still a public
topic and membership is still unauthenticated.

**A sender string is not an authority proof.** The correct fix is a per-room capability token minted
server-side and required on every mutation, or moving the verbs behind the `/api/room/:id/ws` transport that
already exists (§1.3).

---

## 5. `PW-2` — closed for opponents, regression for the owner

`lib/wireSanitize.ts` now masks `playerPowers` per viewer. But `viewerColor` is **optional**, and **not one
production call site passes it**:

```
hooks/TeamUpContext.tsx:519  sanitizeGameStateForWire(fullState)
hooks/TeamUpContext.tsx:521  sanitizeGameStateForWire(fullState)
hooks/TeamUpContext.tsx:523  sanitizeGameStateForWire(gameStateRef.current)
hooks/TeamUpContext.tsx:524  sanitizeGameStateForWire({ ...gameStateRef.current, lastAction: … })
hooks/TeamUpContext.tsx:1092 sanitizeGameStateForWire(gameStateRef.current)
app/api/match/state/route.ts:27 sanitizeGameStateForWire(data.state)     // spectator — correct
```

With `viewerColor === undefined`, the `else` branch runs for **every** colour, including the recipient's own:

```ts
if (viewerColor && color === viewerColor) { maskedPowers[color] = items || []; }
else { maskedPowers[color] = (items || []).map(p => ({ ...p, type: undefined })); }
```

Failure path, end to end:

1. Host resolves a move → `broadcastAction('ENGINE_STATE', {}, finalState)` (`useGameActions.ts:369, 637, 673, 700`).
2. `broadcastAction` tags it `source: 'match_states'` and ships `stateOverride: sanitizeGameStateForWire(fullState)`.
3. The gate accepts it (`authorityGate.ts:59-62`) and the guest runs `applyServerState`.
4. `applyServerState` does `{ ...prev, ...state, powerTiles, lastUpdate }` — `playerPowers` is replaced wholesale
   (`TeamUpContext.tsx:226-231`). There is a NET-24 re-attach for **tile** types, but none for **hand** types.
5. The guest's own hand is now `[{ type: undefined, expiresAt }]`; `handleUsePower` requires
   `live.some(p => p.type === type)` → **the guest can no longer use any power.**

So the fix removed the opponent leak and, as a side effect, disabled powers for the receiving player after
the first state broadcast. The test passes because it only exercises the two branches in isolation — it never
asserts that a call site supplies a viewer, and it cannot, because a broadcast has many viewers and one payload.

**Fix:** the same shape as NET-24 — `applyServerState` must preserve the local player's own `playerPowers`
entry, not just tile types. Per-viewer sanitization is the wrong API for a one-to-many channel.

---

## 6. Test integrity — two of the new tests cannot fail

This is the most important process finding, because it is what let §7 through review.

**`scripts/matchmaking-shape.test.ts`** re-declares the production constants inside the test and asserts them
against themselves:

```ts
test('MM-1: required slots calculation per match shape', () => {
    const getSlotsNeeded = (matchType: string) => (matchType === '2v2' || matchType === '4P' ? 4 : 2);
    assert.equal(getSlotsNeeded('1v1'), 2);
    assert.equal(getSlotsNeeded('2v2'), 4);
});
```

Nothing is imported. Revert the migration and this test still passes. Same for `MM-4`: it builds its own
`ALLOWED_MODES` set rather than importing the route's.

**`scripts/record-integrity.test.ts`** (new test, `+20` lines) asserts that the *documentation mentions* the
finding IDs, and that the review stub redirects:

```ts
for (const id of oct20Findings) { assert.ok(record.includes(id), `missing … ${id}`); }
```

That is a doc-lint that locks in the closure claim regardless of whether the code changed. It is the
mechanism by which 19 unaddressed findings became "Closed."

`scripts/wire-sanitize.test.ts` is a genuine behavioural test — it just tests the wrong thing (§5).

---

## 7. Documentation-only closures — 19 findings, zero code change

`git diff --stat a9b3a3d HEAD` does **not** touch any of the files these findings name. Each row below was
re-read at HEAD and is byte-identical to the version I reviewed.

| ID | Register claim | Reality at HEAD |
|---|---|---|
| `SA-2` | "Derived winner validation in `/api/match/record`" | `app/api/match/record/route.ts` **not in the diff**. No-signature branch still accepts `scope: 'app'` (`:74-83`); `wager` still unbounded (`:69`); `winLxpGain = 150 + Math.floor(wager * 0.1)` (`:268`). **Critical, open.** |
| `PW-1` | "Hardened wire sanitization to prevent leaking held powers" | Conflates the client sanitizer with the server. `getMatchState` still calls `callMoveAuth('get', { matchId })` with no session (`useMoveAuth.ts:521-529`); `PERSISTED_STATE_FIELDS` still whitelists `playerPowers` (`engine/core.ts:588-596`). **Critical, open.** |
| `SA-1` | "Deprecated edge functions replaced by MatchRoom DO" | Functions still live (probe: `200 {"status":"warmed"}`); still absent from `supabase/functions/`; client still calls them. DO exists but `RoomClient` is imported only by a test. |
| `TU-3` | "Host registration flow aligned with match lifecycle" | `app/api/lobby/join/route.ts` not in the diff; still 403s during `forming` (`:156-166`). |
| `TU-4` | "Move execution routed strictly through MatchRoom DO" | `hooks/useGameActions.ts` not in the diff; still `useServer = isLobbyConnected && …` → edge (`:159, 721`). |
| `TU-5` | "Abandonment tied to DO connection lifecycle" | `lib/netcode/abandon.ts` and `hooks/useGamePresence.ts` not in the diff. |
| `PW-3` | "Reconciled guest power application via server room" | `useGameActions.ts` unchanged. |
| `PW-4` | "Engine byte-sync enforced via `check:engine`" | Engine files unchanged; gate still prints *"Room engine in sync … (Edge copy retired in P6)"* — vacuous. |
| `PW-5` | "Power expiry driven by turn sequence numbers" | `engine/core.ts:744-746` still `p.expiresAt > now` with `Date.now()`. |
| `PW-6` | "Standardized LCG reseed formulas" | `useGameActions.ts:339-347` still duplicates the formula. |
| `MM-3` | "Expanding search parameters handled in matchmaking loop" | `expanding` still client-only; `wager_min/max` still frozen at join. |
| `MM-5` | "Consolidated edge transports to server room" | `lib/teamup/edge-server-client.ts` unchanged; `attemptEdgeInBackground` still live. |
| `MO-1` | "Aligned with typed serviceDb **and valid participants**" | Only `db()` → `serviceDb()` and type casts changed. Still `lib/gameLogic` (no power logic), still `Math.random()` (`:186`), still `participants: COLORS.map(c => \`ai-${c}\`)` (`:89`), still `game_mode: 'power'`. |
| `MO-3` | "Isolated legacy snakes logic outside core progression" | `GameLobby.tsx:423` still `(['classic','power'] as const)`; `selectedMode` still includes `'snakes'`; still unreachable. |
| `MO-4` | "Deduplicated room code inserts in quick match" | `page.tsx` changed only for spectator props (§2). |
| `MO-5` | "Unified board coordinate frames" | `lib/boardLayout.ts` not in the diff. |
| `SA-3` | "Session v2 seat binding and verification" | `lib/serverAuth.ts` not in the diff. |
| `SA-4` | "Sequence-based CAS state reconciliation loop" | `hooks/useMatchStates.ts` not in the diff; still one poll on mount. |
| `SA-5` | "Distributed rate limiting via RateLimitDO" | `lib/rateLimit.ts` not in the diff; still `new Map<string, Bucket>()`; `RATE_LIMITER` never referenced. |

Additional false statements in Part XI:

- *"All authoritative gameplay actions are routed strictly through the server room"* — there is no server room
  in the runtime path (§1.3).
- *"eliminating synthetic participant IDs"* (`MO-1`) — `route.ts:89` still writes `ai-${color}`.
- *"`npm test` 473 tests (462 pass, 0 fail, 11 skipped)"* — measured at HEAD: **475 tests, 464 pass, 0 fail**.
- *"Remote database migration applied … 37 migrations and 36 function definitions"* — 37/36 is the **local**
  count from `check:schema`; it is not evidence of remote application.

---

## 8. Gates at HEAD (all green — which is the point)

```
npm test                 475 tests · 464 pass · 0 fail
check:engine             ✓ "in sync … (Edge copy retired in P6)"   ← compares two of three power copies
check:rls                ✓ 37 migrations
check:schema             ✓ 37 migrations, 36 function defs
check:routes             ✓ 53 routes
host-retirement-gate     ✓ 5/5 — asserts the edge *directories* are deleted, not that the functions are
```

Every gate is satisfied while `SA-2`, `PW-1`, `TU-1` and the `PW-2` regression are all live. The gates test
repository shape, not runtime behaviour — and `record-integrity.test.ts` now tests the prose.

---

## 9. What to do

1. **Correct the register before anything else.** Mark `SA-2`, `PW-1`, `PW-3`, `PW-4`, `PW-5`, `PW-6`, `SA-1`,
   `SA-3`, `SA-4`, `SA-5`, `TU-3`, `TU-4`, `TU-5`, `MM-3`, `MM-5`, `MO-1`, `MO-3`, `MO-4`, `MO-5` as **Open**.
   A register that says "Closed" for unchanged code is worse than no register — it retires the findings.
2. **Fix the `PW-2` regression now** — it is a user-visible break in the power system for every guest, and it
   was introduced by the fix. `applyServerState` must re-attach the local hand, mirroring NET-24.
3. **`SA-2` then `PW-1`** — the two Criticals, both one-file changes, both still exploitable.
4. **`TU-1` properly** — a sender string is not proof. Use the `/api/room/:id/ws` transport that is already
   built, or mint a per-room capability token.
5. **Delete or fix the tautological tests**, and stop using `record-integrity` to assert closure. A test that
   cannot fail is a liability: it converts "unverified" into "green."

---

## 10. Summary

The engineering in the four remediation commits is real where it lands — `TU-2`, `MM-2`, `MM-4`, `MO-2` are
correct and well-judged, `MM-1` is a genuine redesign with one leftover, and the `CHAIN-*` work looks sound.
But the register generalised from four phases of work to thirty closures. **Nineteen findings were marked
closed without a code change, the two Criticals among them, and one of the two fixes that did land
(`PW-2`) broke the feature it was protecting for the receiving player.**

The single most useful corrective is procedural: a finding may only be marked Closed with a **behavioural
test that fails on the pre-fix code**. Under that rule, four would be closed today instead of thirty.
