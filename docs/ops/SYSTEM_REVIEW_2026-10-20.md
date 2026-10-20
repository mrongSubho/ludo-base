# In-Depth System Review — Game Systems (Quick Match · Team-Up · Powers · Modes)

**Date:** 2026-10-20 · **Reviewer:** SoftwareArchitect pass · **Repo:** `ludo-base` @ `a9b3a3d`
**Scope:** quick matchmaking, Team-Up private rooms (1v1 / 2v2 / 4P), the power system, classic/power/snakes
modes, and the authority/netcode layer they all ride on. All flows walked end to end.

**Method:** source review of every file on the four paths; live probes against the hosted Supabase project
(`xvwaqxqyjtlsuijgwozi`) to confirm deployment topology and data state; full local gate + test run.

**Gate/test state (all green):** `npm test` 465 tests / 454 pass / 0 fail · `check:rls` clean (36 migrations) ·
`check:schema` clean (35 function defs) · `check:routes` clean (53 routes) · `check:engine` "in sync" ·
`rate-limit` 23/23 · `typecheck`/`lint` clean. **The findings below are all outside what these gates cover.**

---

## 1. What the system actually is

Four independent, only loosely-coupled subsystems, which is the root of most findings:

| Layer | Where it lives | Who is authoritative |
|---|---|---|
| **Rules engine** | `lib/engine/core.ts` (1043 ln) | pure functions, no authority |
| **P2P room** | `hooks/TeamUpContext.tsx` (1519 ln) + PeerJS | the **host browser** |
| **Edge authority** | Supabase Edge fns `roll-dice` / `move-auth` / `resolve-bet` (**deployed, not in repo**) | the edge function, writing `match_states` |
| **Server room (Track A)** | `src/room/MatchRoom.ts` + `engine.ts` | **not deployed** — no DO bindings in `wrangler.jsonc` |

A networked match therefore has **two authorities running concurrently**: the P2P host (which owns the
board, the turn clock, seating, and the win) and the edge `move-auth` function (which owns rolls, move
legality, powers, and the persisted `match_states`). Nothing reconciles them in real time. This is the
single most important structural fact in this review.

**Mode matrix actually reachable:** `classic` × {1v1, 2v2, 4P} and `power` × {1v1, 2v2, 4P} — via Team-Up
(lobby) or offline/AI. `snakes` is unreachable (§6.3). Quick Match reaches only `classic 1v1` in practice
(§3.1). The live arena is labelled `power 4P` but plays classic (§6.2).

---

## 2. Production evidence (live project, 2026-10-20)

| Probe | Result |
|---|---|
| `POST /functions/v1/roll-dice` (no auth) | `401 UNAUTHORIZED_INVALID_JWT_FORMAT` |
| `POST /functions/v1/move-auth` (no auth) | `401` |
| `POST /functions/v1/resolve-bet` (no auth) | `401` |
| `POST /functions/v1/nope` (no auth) | `404 NOT_FOUND` |
| `POST /functions/v1/roll-dice` (anon key, `{"isPreWarm":true}`) | **`200 {"status":"warmed"}`** |
| `POST /functions/v1/move-auth` `{"action":"get","matchId":…}` (anon key, no session/sig) | **`500 INTERNAL`** — handler reached, no row. Not 401. |
| `GET /rest/v1/matches` (anon key) | **200, 163 rows, full roster + `room_code` + `winner_address` + `host_proven` + `metadata`** |
| `match_states` / `match_rolls` / `matchmaking_queue` row counts via anon | 0 (RLS default-deny, no policy) |

**The three edge functions are live but absent from the repository.** `supabase/functions/` contains only
`_shared` — `roll-dice/`, `move-auth/`, `resolve-bet/` were deleted from source
(`docs/ops/IMPLEMENTATION_RECORD.md:824`) yet remain deployed. Everything below that depends on them is
depending on code that is not in version control, has no CI, cannot be reviewed, and cannot be patched.

**Match data state — 163 matches, and the recording path has never once fired:**

```
total 163 | with winner_address 0 | with finished_at 0
prefixes { "local-": 155, "QM-": 5, "CMP": 2, "ARENA": 1 }
by month { "2026-10": 111, "2026-09": 52 }
```

The 5 `QM-*` rows (the only quick matches ever created, all 2026-09-17):

```
QM-8D3EAD seats=2 shape=null mode=classic hostProven=false
QM-B099A3 seats=2 shape=null mode=classic hostProven=false
QM-8F3D79 seats=2 shape=null mode=classic hostProven=false
QM-BD89B9 seats=2 shape=null mode=classic hostProven=false
QM-307402 seats=2 shape=null mode=classic hostProven=false
```

Two things follow immediately: (a) every quick match has exactly **2 participants** regardless of the
requested shape, and `match_shape` was never written — §3.1; (b) **no match in this database has ever been
settled**, so no LXP/RXP, no mission progress, no on-chain oracle call, and no `match_states`/`match_rolls`
row has ever been produced by the live app. Progression is untested end to end in the real environment.

---

## 3. Quick Matchmaking

### 3.1 Flow as built

`QuickMatchPanel` → `useMatchmaking.startSearch` → blocking purge of stale tickets → `POST
/api/matchmaking/join` → `join_matchmaking` RPC (advisory lock on `game_mode:match_type`, pick oldest
non-self `searching` row with a wager in band, else insert a ticket) → 5 s heartbeat re-call + 1 s UI
timer → `GET /api/matchmaking/status` (session-gated) → `dispatchMatch` → deterministic host pick from
`hash(matchId)` over the sorted roster → `hostGame`/`joinGame` → `handlePlayNow`.
A background `attemptEdgeInBackground` races a second, *different* edge transport
(`lib/teamup/edge-server-client.ts`, `NEXT_PUBLIC_EDGE_SERVER_URL`) against the Supabase path.

Then the panel waits for `targetCount = matchType === '1v1' ? 2 : 4` joined slots
(`QuickMatchPanel.tsx:222`), and `handlePlayNow` re-checks `requiredHumans = … ? 2 : 4` (`page.tsx:550`).

### 3.2 Findings

#### MM-1 (High) — Quick Match cannot fill a 2v2 or 4P table
`supabase/migrations/00000000000000_baseline.sql:457-469`:

```sql
select * into opponent from public.matchmaking_queue
 where status = 'searching' and player_id <> p_player_id
   and game_mode = p_game_mode and match_type = p_match_type
   …
insert into public.matches(room_code, game_mode, participants)
  values (room, p_game_mode, array[p_player_id, opponent.player_id]) returning id into m;
```

Exactly **one** opponent is ever selected and the roster is always 2 elements, no matter what
`p_match_type` says. Nothing in the RPC counts tickets, fills a 4-seat table, or respects `slotsNeeded`
(the field is destructured in the route and then unused — `app/api/matchmaking/join/route.ts:73`).
So a 2v2/4P quick search creates a 1v1 match: the host waits for 4 joined slots that can never arrive,
trips the 4 s `isStalled` timer (`QuickMatchPanel.tsx:198-200`), and is offered "Play with AI" or Leave.
Live data confirms it: all 5 `QM-*` rows are `seats=2`, `match_shape=null`.

**Fix:** make the RPC shape-aware — fill until the roster matches the shape inside the advisory lock,
and write `match_shape`. Until then, remove 2v2/4P from the quick-match entry points so the UI cannot
promise a table it cannot fill.

#### MM-2 (Medium) — the "kill the orphan ticket" race never fires
`hooks/useMatchmaking.ts:400-409`:

```ts
if (!edgeMatch || isMatched()) {
    // Lost the race to Supabase: kill our orphan ticket so it can't ghost-match later
    if (edgeMatch && ticketIdRef.current) {
        fetch('/api/matchmaking/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticketId: ticketIdRef.current, playerId: null })
        }).catch(() => {});
    }
    return;
}
```

No `sessionId` is sent. `/api/matchmaking/cancel` resolves the owner from the ticket and then calls
`requireAppSession(owner, sessionId)` with `sessionId === undefined` → 401. The ticket is never cancelled;
it just expires. `cleanup_matchmaking_queue()` exists in the baseline but nothing schedules it and no
scheduler exists, so a stale `searching` ticket can ghost-match a player who is already in a different
match. The comment asserts the exact opposite of what the code does.

#### MM-3 (Medium) — `expanding` is decoration, and its triggers can be skipped
`expanding` exists only as a client-side state (`useMatchmaking.ts:7,255,272`). There is no server-side
expansion, and `wager_min`/`wager_max` are frozen at join — so the "expand your search" prompt widens
nothing. Worse, `QuickMatchPanel.tsx:189-194` drives the overlay off `searchTime === 15` / `=== 28`; a
throttled background tab misses the exact tick and the overlay never appears or never disappears.

#### MM-4 (Low) — no validation of `gameMode` / `matchType` at the API boundary
`app/api/matchmaking/join/route.ts:107-114` forwards both straight to the RPC. Any string becomes a
queue row and can be pooled against itself. It is masked in practice because the pool key is
`game_mode:match_type`, but the API should reject values outside `{classic,power,snakes}` ×
`{1v1,2v2,4P}` rather than trusting the caller.

#### MM-5 (Low) — two unrelated "Edge" transports
`useMoveAuth.ts:36` posts to `${SUPABASE_URL}/functions/v1/move-auth`, while `attemptEdgeInBackground`
uses `lib/teamup/edge-server-client.ts` against `NEXT_PUBLIC_EDGE_SERVER_URL` and resolves the host from
`edgeMatch.players[0]`. Two different things called "Edge", two different host-resolution rules, one of
which (`resolveIsHost`) is a deterministic hash and the other is "first in the returned roster".

### What is genuinely good here
The session-gated status poll with owner-checked `validation_token`
(`app/api/matchmaking/status/route.ts:51-93`), the mint-on-read guarded single-mint in
`withCallerToken`, the 10-minute stale-match fail-closed, the lineage-preferring fallback, owner-scoped
cancel, the deterministic host pick with a degraded-mode callback, and the `beforeunload`/`visibilitychange`
cleanup are all correct and well-reasoned. The bug is scope (MM-1), not plumbing.

---

## 4. Team-Up private rooms — 1v1 / 2v2 / 4P

### 4.1 Flow as built

`hostQuickLobby(matchType, gameMode, entryFee)` → `generateRoomCode()` → `hostGame(code)` → PeerJS host +
`initQuickLobby` (seats slot 0 as host, colour from `LOBBY_COLORS`) + `declareLobbyPolicy`.
Guest joins by room code (+ optional `?seat=N`, `?s=<secret>`) → `joinGame` → `POST /api/lobby/join`
→ host polls the pending list → `seatGuestPlayer` fills a slot → `LOBBY_SYNC` broadcast. During the match
the host runs `useGameActions` locally and broadcasts; guests send `REQUEST_ROLL`/`REQUEST_MOVE` intents
(strictly validated by `lib/gameProtocol.ts` — no face, no `diceValue`) which the host resolves. Every
client additionally polls `match_states` through the edge `move-auth` and applies it through the seq-gated
`applyServerState`. Win → `recordMatchResult` → wallet signature → `/api/match/record`.

**Seating is correct.** `LOBBY_COLORS['2v2']` is derived from `TEAM_PAIRINGS`
(`lib/gameLogic.ts:531-538`), `assignCorners2v2` puts partners on opposite diagonals, `assignJoinerToSlot`
fills the teammate slot first (`gameLogic.ts:631-637`), and `shufflePlayers('1v1')` reuses the seated axis
rather than re-rolling it. ENG-02/ENG-19 are genuinely closed. Traps, capture force, shield immunity and
team victory all read `TEAM_ID`/`getTeam`. No second pairing exists.

### 4.2 Findings

#### TU-1 (Critical) — the Supabase relay channel is an unauthenticated control channel
`hooks/useSupabaseRelay.ts:105-107` subscribes to `supabase.channel('game-room-<roomCode>')` —
a **public broadcast topic**. Membership requires nothing. NET-03a/b (private realtime) is documented as
*failed on hosted* (`permission denied for schema realtime`), so channel authorization is not in force.

Room codes are enumerable, not secret: `matches` is world-readable
（`baseline.sql:623 create policy matches_public_read … using (true)`) — verified live, 163 rows including
`room_code` and `participants`. `generateRoomCode()` (`gameLogic.ts:599-606`) and the inline
`Math.random().toString(36).substring(2,8)` (`TeamUpContext.tsx:1022`) are two different 36⁶ generators.

Once on the channel, an attacker can inject any action, and three of them are applied by the host:

**(a) `START_GAME` is applied unconditionally** — it is not in the gate's `MUTATING` set and the gate
verdict is simply not consulted for it (`TeamUpContext.tsx:843-852`):

```ts
if (type === 'START_GAME') {
    setGameState(prev => ({ ...prev,
        isStarted: true,
        isBotMatch: data.isBotMatch === true,
        playerCount: data.playerCount === '1v1' || … ? data.playerCount : prev.playerCount,
        initialBoardConfig: data.initialBoardConfig as GameState['initialBoardConfig'],
        matchId: typeof data.matchId === 'string' ? data.matchId : prev.matchId,
        lastUpdate: Date.now() }));
```

`initialBoardConfig` is the full seed — every player, colour, corner. An injected `START_GAME` re-seeds
the match on **every** client in the room, with an arbitrary board and an attacker-chosen `matchId`.

**(b) `MOVE_TOKEN` is applied by the host with no sender check and no legality check**
(`TeamUpContext.tsx:874-884`):

```ts
} else if (type === 'MOVE_TOKEN' && isMatchAuthority) {
    const payload = (data.payload && typeof data.payload === 'object' ? data.payload : data) as …;
    const color = payload.color as PlayerColor;
    const tokenIndex = Number(payload.tokenIndex);
    const targetPosition = Number(payload.targetPosition);
    setGameState(prev => {
        const newPos = { ...prev.positions };
        newPos[color as PlayerColor] = [...newPos[color as PlayerColor]];
        newPos[color as PlayerColor][tokenIndex] = targetPosition;   // ← arbitrary write
```

`isMatchAuthority = isHost || isComputeHost` (`:737`) describes the **receiver**, not the sender. On the
host it is always true. `targetPosition` is never validated against `calculateNextPosition`. Same shape
for `TURN_SWITCH` (`:885-895`) and `ROLL_DICE` with a caller-chosen `value` (`:866-873`).

**(c) `JOIN_REQUEST` seats an unauthenticated guest** (`:777-798`). `seatGuestPlayer` enforces a
validation token only when `expectedValidationTokenRef.current` is set — and `hostGame(code)` with no
token sets it to `null` (`:1019`), which is exactly what `hostQuickLobby` does. Every Team-Up lobby is an
open door on the relay.

The gate that exists, `shouldApplyGameAction` (`lib/netcode/authorityGate.ts`), is the right idea but is
consulted only at `:828-841` and only for the `snapshot` verdict; the verb branches above it bypass it.

#### TU-2 (Critical) — `playerCoins` is taken from the peer payload
`seatGuestPlayer` (`TeamUpContext.tsx:586-588, 610, 620`):

```ts
const coins = typeof payload.coins === 'number' && Number.isFinite(payload.coins) ? payload.coins : null;
… { …s, status: 'joined', playerId: payload.address, playerName: …, peerId, playerCoins: coins }
```

SEC-12 removed exactly this field from `POST /api/lobby/join` because "the host saw a number the guest
chose" (route comment, `:126-129`). The PeerJS/relay path still accepts it, and it is what renders the
"Low chip" affordance (`TeamUpMatchPanel.tsx:220-221, 627-628`). Fix on one path, leave the other open.

#### TU-3 (High) — the REST join fallback can never deliver a seat
The host's 2 s poll (`TeamUpContext.tsx:1186-1231`) calls `GET /api/lobby/join`, which requires a
`live_matches` row and the canonical host (`app/api/lobby/join/route.ts:156-166`):

```ts
const { data: room } = await sb.from('live_matches').select('match_id, host_address').eq('room_code', roomCode).maybeSingle();
…
if (!room?.match_id || canonicalHost !== hostAddress) {
    return NextResponse.json({ error: 'Not the room host' }, { status: 403 });
}
```

`live_matches` is only written by `/api/live-matches/window`, which itself needs a `matches` row
(`window/route.ts:8-11`), which only exists after `/api/match/start` — which runs at `handlePlayNow`, i.e.
*after* the lobby is already `playing`. During `forming` the poll always 403s, and the handler swallows it
(`if (!res.ok || cancelled) return;`). The documented "works when PeerJS and realtime broadcast fail"
fallback is dead code. Also note `/api/lobby/join` is called by the guest at `TeamUpContext.tsx:1115`
before the host may have a session at all.

#### TU-4 (High) — two authorities diverge for moves and powers
`hooks/useGameActions.ts:159` and `:721`:

```ts
const useServer = isLobbyConnected && !!moveAuth && !!matchId && matchId !== 'local';
const useServer = isLobbyConnected && !!moveAuth?.submitPower && !!matchId && matchId !== 'local';
```

`isLobbyConnected` is set true for **every** P2P room (`TeamUpContext.tsx:1036, 1130, 1141, 819`). So in a
Team-Up match a guest's move and a guest's power are resolved by the edge function against `match_states`
and merged into **that guest's own view** (`useGameActions.ts:777-785`), while the host — still the de-facto
authority — only learns of it through `useMatchStates`, which polls **once on mount plus on error/online**
(`useMatchStates.ts:76-98`). `broadcastAction` is host-only (`:371-372`), so a guest never publishes its own
resolved state. `powerSpentThisTurn`, `activeBoost`, `activeShields` and `positions` can therefore differ
between host and guest for seconds at a time, and the host's turn clock keeps running.

#### TU-5 (Medium) — disconnect / abandon has no settlement teeth
`classifyAbandon` (`lib/netcode/abandon.ts:37-64`) is pure classification with `ABANDON_BURN_SPLIT_ENABLED
= false` and no writer; the compute-host election (`useGamePresence.ts:63-78`) trusts a **client-supplied**
`joinedAt` from `channel.track`, so the "oldest player is the compute host" rule is spoofable — and the
`getMatchState` path it needs for `computeAuthority`'s snapshot guard is unauthenticated (SA-1 below), so
the NET-07 guard is satisfiable by an attacker. A kicked/AFK seat is filled by a host-orchestrated bot and
the match continues, but nothing ever settles the abandoned player's stake or marks the match unrated.

### What is genuinely good here
`lib/gameProtocol.ts` intent validation (a guest may ask for a roll, never choose a face; `diceValue` is
rejected structurally rather than stripped); the dedup stores with TTL + LRU and eviction metering
(`TeamUpContext.tsx:282`, `useSupabaseRelay.ts:26-33`); the seq-gated `applyServerState` with the
NET-24 power-type re-attachment; the match FSM with illegal-transition metering; `computeAuthority`'s
snapshot requirement; the owner-scoped, rate-limited `/api/lobby/join` with the SEC-12 door model
(`matchmaking` / `invite` / `open`) and the two-query friendship check.

---

## 5. The power system

### 5.1 Mechanics as implemented

`powerTiles` are seeded once per match from 5 deterministic non-colliding cells
(`useGameEngine.ts:141-146`), typed from `POWER_RARITY` (boost .40 / shield .25 / teleport .20 / nuke .15).
Respawn is driven by a **deterministic 32-bit LCG seeded from the match-committed `powerTileSeed`**
(`core.ts:884-930`), never `Date.now()`, so every authority holding the same state spawns the same tile —
a genuinely good determinism decision. Landing exactly on a tile grants it (duplicates refresh expiry),
one replacement spawns. `applyPower` requires `currentPlayer === color`, `gamePhase === 'rolling'`,
`powerSpentThisTurn === false`, and that the colour actually holds the type; nuke/teleport return `armed`
without consuming inventory when no target token is given, and `kept` when the blast/target is empty.
Nuke respects `NUKE_RADIUS = 3` on track indices, skips safe cells, skips shielded tokens, and skips the
2v2 teammate. Teleport jumps to the next safe star ahead, or straight to 57 from 49-56, and re-evaluates
victory (ENG-03) so a 2v2 team cannot be left in a terminal deadlock.

### 5.2 Findings

#### PW-1 (Critical) — any client can read any match's authority state, including every player's powers
`hooks/useMoveAuth.ts:503-511`:

```ts
const sessionId = sharedMoveSessions.get(matchId);
const actor = (myAddress || '').toLowerCase();
const useProof = Boolean(sessionId && actor);
const r = await callMoveAuth(useProof ? 'resync' : 'get', useProof ? {…} : { matchId });
```

`get` is sent with **no session and no signature**. Live probe confirms the action is unauthenticated
(500 INTERNAL from the handler, not 401). `pickPersistedState` (`lib/engine/core.ts:588-596`) whitelists
**`playerPowers`** into the persisted row — every colour's held power type and expiry — along with
`positions`, `matchStats`, `winners` and `strikes`. So the full authority state of any match is readable by
anyone who knows a `matchId`, and `matchId`s are trivially enumerable from the world-readable `matches`
table. The whitelist was built to stop a client writing fields; nobody audited what it lets the world read.

#### PW-2 (High) — `playerPowers` is broadcast to every peer
`TeamUpContext.tsx:512-517` puts the same sanitized state on both transports:

```ts
stateOverride: fullState ? sanitizeGameStateForWire(fullState) : undefined,
gameState: fullState ? sanitizeGameStateForWire(fullState)
          : type === 'SYNC_STATE' ? sanitizeGameStateForWire(gameStateRef.current)
          : sanitizeGameStateForWire({ ...gameStateRef.current, lastAction: { type, payload } }
```

`sanitizeGameStateForWire` (`lib/wireSanitize.ts:6-14`) strips **only** `powerTiles[].type`. `playerPowers`
— the opponent's hand — goes out in full to `broadcastToAll` and `relayViaSupabase`. The SEC-32 comment
("the tile a guest must not learn") protects tile *types* while the whole power economy leaks. Combined
with PW-1 there is no version of a power that is not public.

#### PW-3 (High) — a guest's power never reaches the host's board
See TU-4. The power is applied on the edge and only on the guest; the host's board, its
`powerSpentThisTurn` budget and its turn clock are untouched. Symmetrically, the host applying a power
locally (`useGameActions.ts:796-943`) never writes it back to `match_states`, so the guest's snapshot poll
can overwrite the host's authoritative board with a stale one.

#### PW-4 (High) — three implementations of power semantics
`lib/engine/core.ts`, `src/room/engine.ts`, and `hooks/useGameActions.ts:796-943` each implement
shield/nuke/teleport. `check:engine` compares only the first two, and passes vacuously with
"*(Edge copy retired in P6)*". The third copy is the one that actually runs for every offline match and
every host-side power, and it is the one nothing checks.

#### PW-5 (Medium) — power state is partly wall-clock
`liveInventory` filters on `expiresAt > now` with `now = Date.now()` on each client
(`core.ts:744-746`, `useGameActions.ts:800`). A guest whose clock is behind keeps a "live" power the
authority has already swept; the nuke/shield/teleport decisions in `useGameActions.ts` re-derive the
inventory locally rather than from the authority's sweep. Two clients with a few seconds of skew see
different hands.

#### PW-6 (Low) — `useGameActions` re-implements the LCG reseed formula
`useGameActions.ts:339-347` duplicates the `powerTileSeed + r*31 + c*17 + remaining*101` reseed from
`core.ts:966-968`. Two copies of a magic reseed, with no test asserting they agree.

### What is genuinely good here
Deterministic seeded respawn (ENG-11); `armed`/`kept` protocol so a targeted power is only consumed on a
valid target; the ENG-13 step-ceiling of 12 for boosted moves; `countNukeVictims` honouring shields, safe
cells and the 2v2 truce; ENG-03's victory re-evaluation after teleport; and `engine-core.test.ts`
covering the power guards explicitly (wrong turn, wrong phase, already-spent, not-held, bad index,
armed-without-target, kept-on-empty-blast).

---

## 6. Modes: classic / power / snakes, and 1v1 / 2v2 / 4P

### 6.1 What "classic" actually is
`powerTiles` is populated **only** when `gameMode === 'power'` (`useGameEngine.ts:141-146`), and
`applyPowerPickup` returns early on an empty tile list. So classic = power with zero tiles. Clean and
minimal — there is no duplicated rule path, and no way to hold a power in a classic match. This is the
healthiest part of the mode matrix.

### 6.2 Findings

#### MO-1 (Medium) — the "Power 4P" live arena plays classic rules and mislabels the match
`app/api/live-arena/power4p/route.ts:79-190` builds its state from `lib/gameLogic` (whose only power
code is the empty initialiser at `gameLogic.ts:66-69`), rolls with `Math.random()`, and never calls
`applyPower` or `applyPowerPickup`:

```ts
const roll = Math.floor(Math.random() * 6) + 1;
…
? processMove({ ...state, diceValue: roll, gamePhase: 'moving' }, color, getBestMove(…).tokenIndex ?? legal[0], roll, '4P', row.data.color_corner).newState
```

…while writing `game_mode: 'power'` into the canonical `matches` row (`:90-94`) and participant ids
`ai-green`/`ai-red`/`ai-yellow`/`ai-blue` that are not wallet addresses. So a viewer watches a
rules-incorrect match that is then counted as `power_played` for progression, in a match whose roster can
never satisfy `/api/match/record`'s participant/settlability rules. It also builds its own service client
instead of using `serviceDb()` (`:14-19`).

#### MO-2 (Medium) — the spectator view hardcodes shape and mode
`app/page.tsx:920-921`:

```tsx
playerCount="4P"
gameMode="power"
```

Every spectated match renders as a 4-player power board regardless of what was actually played. A 1v1
classic stream is displayed with four seats and power tiles that do not exist in the match.

#### MO-3 (Medium) — `snakes` is unreachable dead code
`app/page.tsx:304` types `selectedMode` as `'classic' | 'power' | 'snakes'`, but the only setter is
`GameLobby`'s `setGameMode`, typed `(mode: 'classic' | 'power') => void`, and the lobby renders exactly
`['classic','power']` (`GameLobby.tsx:371`). Nothing can ever set `'snakes'`. Dead: 670-line
`SnakesBoard.tsx`, 64-line `lib/snakesLogic.ts`, `GAME_MODE_CODE.snakes`, the `snakes-board-bg` class and
the `Snakes` mode label. It is also a separate 100-cell 1D snakes-and-ladders game rather than a Ludo
ruleset, so if it were ever wired to `/api/match/record` it would be counted on `classic_played`/`power_played`
and fed to an engine that does not implement it.

#### MO-4 (Low) — quick match creates two `matches` rows for one room
`join_matchmaking` inserts a row for `QM-xxxxxx`; `page.tsx:627-640` then inserts a **second** row with the
same `room_code` via `/api/match/start`. `QuickMatchPanel.tsx:271-277` reads the rival off
`matches` by `room_code` with `.maybeSingle()` — which errors with PGRST116 the moment both rows exist. It
does not bite today only because the 5 QM matches never reached `handlePlayNow` (MM-1).

#### MO-5 (Low) — board geometry conventions are inconsistent
`getBoardCoordinate` ignores `color` below index 52 (`boardLayout.ts:198-211`) because track indices are
a global ring frame, while `buildPlayerPaths` builds a *rotated* per-colour path
(`boardLayout.ts:177-196`) — the two disagree. `buildPlayerPaths` is imported by `useGameEngine.ts` and
is otherwise unused. Two conventions for the same thing, with only one exercised.

### What is genuinely good here
The single `TEAM_PAIRINGS` source of truth for 2v2 with derived `LOBBY_COLORS` and `getTeammateColor`;
`assignCorners2v2`/`assignCornersFFA` separating team seating from free-for-all; `evaluateVictory` owning
the one team-vs-individual win rule; `activeColorsForTurns` collapsing what used to be four copies of the
turn cycle; `ECO-08` making `match_shape` a stored, validated, signed value instead of an inference from
seat colours (a real bug that would have mis-paid 4P podiums as 2v2 50/50).

---

## 7. Authority, recording and settlement

### 7.1 Where the trust actually sits

`/api/match/record` is the only route that moves progression. Its checks, in order: the caller must have a
signature proof **or** any `scope: 'app'` session (`:74-83`); the winner must be a participant
(`:142-143`); the payload must equal the stored canonical row (`:160-164`); the row must be
`host_proven` or have a `room_owner` (`:170-178`); it must not already be settled (`:179-181`); and if
`match_states.state.winner` exists, the claim must match it (`:186-232`). Then it writes the winner
(`:239-251`, first-write-wins on `finished_at is null`) and awards LXP/RXP with `wager`-scaled amounts.

### 7.2 Findings

#### SA-1 (High) — the three deployed edge functions are not in this repository
`supabase/functions/` contains only `_shared`. `roll-dice`, `move-auth`, `resolve-bet` were deleted from
source (`IMPLEMENTATION_RECORD.md:824`) and are **still live** (verified: 401 unauthenticated, 200 with the
anon key, 404 only for a name that does not exist). The roll RNG, move legality, `match_states`
seeding/commit, session minting, bet resolution and the public `get` snapshot all execute from source that
has no version control, no review, no CI, and no way to be redeployed or rolled back from this repo.
`npm run check:engine` reports "in sync" against a copy that "retired in P6" — a vacuous pass. Every
authority claim in this document is therefore unverifiable from the repo, including the SEC-01/SEC-02
receipt binding that the whole abort-on-failure design rests on.

This is the top structural risk in the system. Either restore the source (and redeploy from CI), or
remove the functions and move their logic into `src/room/` behind the MatchRoom DO that the migration plan
already specifies.

#### SA-2 (Critical) — a result can be recorded with no proof of who won, and an unbounded wager
`app/api/match/record/route.ts:74-83`:

```ts
const hasSignatureProof = Boolean(message && signature && issuedAt);
if (!hasSignatureProof) {
    const session = (await requireSession(request, { scope: 'match', matchId: String(matchId) })) ||
                    (await requireSession(request, { scope: 'app' }));
    if (!session) return NextResponse.json({ error: 'Missing session or signature proof' }, { status: 401 });
}
```

With no signature, **any authenticated app session** is enough. The winner must be *a* participant and the
roster must equal the stored row — both of which are public, because `matches` is world-readable
(`baseline.sql:623`, verified: 163 rows with `room_code` and `participants`). The only counter-check,
`match_states.state.winner`, requires a state row to exist **and** to have been written with a winner;
empirically `match_states` has never been written by the live app.

And the LXP award is driven by a caller-supplied `wager` with no ceiling (`:69`, `:268`):

```ts
if (typeof wager !== 'number' || !Number.isFinite(wager) || wager < 0) { … 400 }
const winLxpGain = 150 + Math.floor(wager * 0.1);
```

`lib/matchRecorder.ts:25` hardcodes `wager = 0` for the honest path, so the only way to reach a non-zero
wager is to *omit* the signature and take the session path — at which point `wager = 1e9` yields
~100 M LXP, and any participant can file themselves as winner first (`.is('finished_at', null)` makes
settlement first-write-wins). This is the F2/F3 finding the migration plan already flags, and it is still
open in the signed path too: nothing verifies that the signer is the winner, only that they are
`participants[0]`.

**Fix:** drop the no-signature branch entirely (or require a match-scoped session **and** a
`match_states.state.winner` that the client cannot influence); take `wager` from the canonical
`matches`/pool row, never from the body; require every settled participant to have a `match_states` /
`match_rolls` row for that `matchId`.

#### SA-3 (Medium) — session v2 is not bound to the seat
`lib/serverAuth.ts:107-110` binds a `match`-scoped session to a `matchId`, but not to a seat/colour, and
`/api/match/record`'s session fallback accepts `scope: 'app'` — a session minted for a chat/profile action
can settle a match. The `match_sessions` table has an active-unique index on `(match_id, wallet)` but no
seat column, so a wallet holding two seats cannot be distinguished.

#### SA-4 (Medium) — nothing reconciles the two authorities (§1)
`moveToken`/`handleUsePower` take the edge path for guests and the local path for the host
(`useGameActions.ts:159-253`, `:721-794`); the host never writes its own locally-resolved state back to
`match_states`; and `useMatchStates` polls once on mount. There is no ack/no-op loop, no continuous
poll, and no sequence reconciliation between the host's board and the persisted authority.

#### SA-5 (Low) — Hardening that *is* in place
`/api/match/start` validates `matchShape` against a whitelist, normalises and validates every roster
entry, rejects duplicates, requires a session for `participants[0]` and records `host_proven`;
`/api/chips/lobby-ticket` reads the canonical row, refuses `host_proven=false`, fails closed on a missing
`game_mode_code` or `match_shape`, and cross-checks shape against seat count before signing — that route
is the strongest authz in the codebase. The rate limiter is in-process and IP-keyed, so it is
per-isolate and not shared; `RATE_LIMIT_SHARED_URL` remains unimplemented, which matters the moment this
runs more than one isolate.

---

## 8. Findings register

| ID | Sev | Finding | Location |
|---|---|---|---|
| SA-1 | **High** | Roll/move/bet authority runs from three edge functions that are deployed but absent from the repo; `check:engine` passes vacuously | `supabase/functions/` · `useMoveAuth.ts:36` · live probe §2 |
| SA-2 | **Critical** | A match can be settled with no signature proof, from any app session, with an arbitrary `wager` driving unbounded LXP/RXP; only counter-check has never been populated | `app/api/match/record/route.ts:69,74-83,268` |
| TU-1 | **Critical** | Public broadcast channel `game-room-<code>` is an unauthenticated control channel; `START_GAME` applied unconditionally; `MOVE_TOKEN` writes an unvalidated `targetPosition` on the host; `JOIN_REQUEST` seats unauthenticated guests | `useSupabaseRelay.ts:105` · `TeamUpContext.tsx:737,843,774-798,874-895` |
| TU-2 | **Critical** | `playerCoins` accepted from the peer payload — the exact field SEC-12 removed from the REST route | `TeamUpContext.tsx:586-588,610,620` |
| PW-1 | **Critical** | `move-auth` action `get` is unauthenticated and `pickPersistedState` whitelists `playerPowers`, `positions`, `matchStats`; `matchId`s enumerable from the public `matches` table | `useMoveAuth.ts:503-511` · `engine/core.ts:588-596` |
| PW-2 | High | `playerPowers` broadcast to every peer; the wire sanitizer strips only `powerTiles[].type` | `TeamUpContext.tsx:512-517` · `lib/wireSanitize.ts:6-14` |
| MM-1 | High | Quick Match pairs exactly one opponent regardless of shape → 2v2/4P can never fill; confirmed by all 5 live `QM-*` rows | `baseline.sql:457-469` · `QuickMatchPanel.tsx:222` · `page.tsx:550` |
| PW-3 | High | A guest's power never reaches the host's board; two authority models diverge | `useGameActions.ts:159,721` · `useMatchStates.ts:76-98` |
| PW-4 | High | Three implementations of power semantics; only two compared, and that gate is vacuous | `engine/core.ts` · `src/room/engine.ts` · `useGameActions.ts:796-943` |
| TU-4 | High | Moves and powers take the edge path for guests and the local path for the host, with no reconciliation loop | `useGameActions.ts:159-253,721-794` |
| TU-3 | High | The REST join fallback can never deliver a seat — `live_matches` has no row during `forming` | `lobby/join/route.ts:156-166` · `TeamUpContext.tsx:1186-1231` |
| TU-5 | Medium | Abandon has classification but no writer and no settlement; the presence election trusts a client-supplied `joinedAt` | `netcode/abandon.ts:37-64` · `useGamePresence.ts:63-78` |
| MM-2 | Medium | The orphan-ticket "race kill" posts without a `sessionId`, so it always 401s; no scheduler exists to sweep | `useMatchmaking.ts:400-409` |
| MM-3 | Medium | `expanding` widens nothing server-side; its overlay triggers are equality-gated on a throttled timer | `useMatchmaking.ts:7,255,272` · `QuickMatchPanel.tsx:189-194` |
| SA-3 | Medium | Session v2 is not bound to a seat; an `app`-scoped session can settle a match | `serverAuth.ts:107-110` · `record/route.ts:76-80` |
| SA-4 | Medium | No reconciliation between host board and `match_states`; single poll, no continuous sync | `useMatchStates.ts` · `useGameActions.ts` |
| MO-1 | Medium | The "Power 4P" arena uses `lib/gameLogic` (no power logic) and `Math.random()` while writing `game_mode: 'power'` and `ai-*` participant ids | `live-arena/power4p/route.ts:79-95,185-190` |
| MO-2 | Medium | Spectator view hardcodes `playerCount="4P" gameMode="power"` | `page.tsx:920-921` |
| MO-3 | Medium | `snakes` is unreachable dead code (670 + 64 lines) and is not a Ludo ruleset | `page.tsx:304` · `GameLobby.tsx:371` |
| PW-5 | Medium | Power expiry is swept on each client's `Date.now()`, so clock skew changes a player's hand | `engine/core.ts:744-746` · `useGameActions.ts:800` |
| MM-4 | Low | `gameMode`/`matchType` unvalidated at the API boundary | `matchmaking/join/route.ts:107-114` |
| MO-4 | Low | Quick match inserts two `matches` rows for one `room_code`; rival reveal uses `maybeSingle()` | `page.tsx:627-640` · `QuickMatchPanel.tsx:271-277` |
| MO-5 | Low | `getBoardCoordinate` and `buildPlayerPaths` disagree on the frame; the latter is unused | `boardLayout.ts:177-211` |
| MM-5 | Low | Two unrelated transports both called "Edge", with two host-resolution rules | `useMoveAuth.ts:36` · `teamup/edge-server-client.ts` |
| PW-6 | Low | `useGameActions` duplicates the LCG reseed formula | `useGameActions.ts:339-347` |
| SA-5 | Low | Rate limiting is per-isolate; `RATE_LIMIT_SHARED_URL` unimplemented | `lib/rateLimit.ts` · `middleware.ts` |

---

## 9. Prioritised remediation

**P0 — before any real-money or progression value is exposed**
1. **SA-2.** Remove the no-signature branch from `/api/match/record`; take `wager` from the canonical row;
   require a `match_states` row per settled participant.
2. **TU-1.** Authenticate the room channel — either private channels with server-minted capability
   tokens per room, or route every action through an authenticated endpoint. Add a `sender` check to the
   verb branches and put `START_GAME` behind the gate plus an authority-only marker.
3. **TU-2 / PW-1 / PW-2.** Stop trusting peer-supplied `coins`; require a session on `move-auth` `get`
   and strip `playerPowers` from both the persisted whitelist and the wire sanitizer.

**P1 — correctness of the advertised modes**
4. **SA-1.** Decide the authority story: restore + redeploy the three edge functions from CI, or delete
   them and finish Track A. A live authority that is not in the repo is worse than either option.
5. **MM-1.** Make `join_matchmaking` shape-aware, or remove 2v2/4P from quick match.
6. **PW-3 / TU-4.** Pick one authority per match and add a reconciliation loop; stop letting guests
   self-apply powers and moves.
7. **TU-3.** Make the host's join-request poll work during `forming` (create the `live_matches` row at
   `hostGame`, not at `START_GAME`).

**P2 — hygiene**
8. Fix MM-2 (send the `sessionId` with the orphan-ticket cancel), MM-3 (drop or implement expansion),
   MM-4/MM-5, MO-1 (use the real engine and `serviceDb`), MO-2 (pass the actual shape/mode to the
   spectator view), MO-3 (delete or wire up `snakes`), MO-4, MO-5, PW-4–PW-6, SA-3, SA-4.
9. Add regression tests that the gates *cannot* express: `join_matchmaking` shape filling; a record
   attempt without a signature; an injected `MOVE_TOKEN` from a non-authority sender; `playerPowers`
   absence from the wire.

## 10. Verdict

The **rules engine and the seat/team model are in good shape** — 454 tests green, every static gate clean,
`TEAM_PAIRINGS` genuinely single-sourced, powers deterministic and well-guarded at the function boundary.
The problem is everything *around* it: the app now runs on an authority that exists only in production
(SA-1), on an unauthenticated control channel (TU-1), and on a settlement route that will pay progression
to whoever asks first (SA-2). Quick Match's headline promise — 2v2 and 4P — does not work (MM-1), and
the entire recording path has never once executed in the live database (0/163 settled).

**Fix P0 before exposing any wagered or progression value; fix P1 before advertising 2v2/4P quick match
or the power 4P arena as working features.**

---

# Follow-up review — current tree and implemented contract surface

**Review date:** 2026-10-20  
**Source ref:** `a9b3a3d9f8757084f00c31c0f73daaa08ac8725e`  
**Review mode:** source-first, repository-local review of the current tree  
**Additional scope:** Durable Object room authority, current API/session model, `MatchPool` /
`ClaimHub` Solidity, contract-to-frontend settlement integration, indexer, CI coverage, and
the findings above.

## Scope and evidence boundary

This follow-up reconciles the 2026-10-20 findings with the post-migration source currently in the
repository. It does **not** establish production deployment state, live contract addresses,
Cloudflare bindings, Supabase Realtime policy state, or whether the current `MatchRoom` path is
the path used by every production client. Those remain owner-observed validation items.

The source review found that several earlier findings are now stale as written: the repository
contains the MatchRoom Durable Object, Session v2, private-realtime migration, atomic room commits,
and the retirement gate for the deleted Edge functions. They should not be carried forward as
current source claims without a deployment check. The remaining risk is now concentrated at
authority selection, contract/UI integration, and operational proof that the new path is deployed.

## New findings

### CHAIN-01 — High: settlement proposal request contract is incompatible with its caller

`app/api/chips/settle/propose/route.ts:43-47` requires a non-empty `winners` array:

```ts
if (!poolId || !Array.isArray(winners) || winners.length === 0) {
    return NextResponse.json({ error: "Missing settle fields" }, { status: 400 });
}
```

The only current hook caller, `hooks/useSettlePool.ts:65-83`, sends
`winnerAddresses` and `payoutPlan`, but does not send `winners` or `split`. The route therefore
rejects the implemented `SettlePoolButton` path before it can produce an Edge signature. This is
not a wallet or contract authorization failure; it is an API schema drift that makes the paid
settlement flow unusable.

**Recommendation:** define one typed request/response contract shared by the route and hook.
Prefer sending only `poolId`, the ordered winner addresses, and an optional split intent; derive
the payout amounts server-side and return the canonical plan. Add a route-level regression test
that exercises the exact JSON emitted by `useSettlePool`.

### CHAIN-02 — High: `getPoolSummary` is decoded with stale, off-by-one indexes in the client

`contracts/src/MatchPool.sol:286-318` and `lib/chips.ts:62-77` define twelve return values:

`status, maxSeats, filledSeats, shape, authority, entryFee, gross, prizeFund, hostBond,
settleBy, claimUnlockAt, settleNonce`.

`hooks/useChipsPool.ts:167-180` still documents and decodes a ten-field tuple, treating `shape` as
`authority`, `authority` as `entryFee`, and every subsequent field as the preceding field. The
same stale index `a[9]` is used for the claim clock at `hooks/useChipsPool.ts:213-220`, even though
`a[10]` is `claimUnlockAt`.

The server-side decoder in `lib/poolAuthority.ts:96-125` is correct, so this is specifically a
frontend integration split. It can display invalid pool ownership, amounts, deadlines, and claim
readiness; it also causes the UI to build payout plans from the wrong `prizeFund`.

**Recommendation:** stop casting the tuple to `unknown[]` in the hook. Use the ABI-inferred
named result when available, or centralize one twelve-field decoder shared by the hook and
`poolAuthority`. Add a fixture test that asserts every returned field, especially `shape`,
`prizeFund`, `settleBy`, `claimUnlockAt`, and `settleNonce`.

### CHAIN-03 — High: the hook signs the server plan but submits a different client plan

`app/api/chips/settle/propose/route.ts:81-105` derives `plan` and `planHash` from on-chain
`shape`, `prizeFund`, `authority`, and the server-selected winners. In contrast,
`hooks/useSettlePool.ts:86-123` uses the returned `planHash`, nonce, and Edge signature but
submits `args.plan` to `MatchPool.settlePool` at lines 130-140.

The contract hashes the submitted payout array inside `settleStructHash`
(`contracts/src/MatchPool.sol:716-730`), so any difference in winner ordering, dust assignment,
shape interpretation, or amount makes the Edge signature invalid and the transaction reverts.
The client must not be allowed to construct a second economic plan after the server has signed
the canonical one.

**Recommendation:** submit the server-returned `data.plan`, normalize it into `PayoutEntry[]`,
and assert locally that `payoutPlanHash(submittedPlan) === planHash` before requesting the host
signature or sending the transaction. Treat a mismatch as a hard error and never fall back to
the caller-provided plan.

### CHAIN-04 — Medium: contract behavior is not a CI gate

`package.json:56-62` exposes Foundry tests, but `.github/workflows/ci.yml` installs Foundry only
for deploy-guardrail tests and does not run `forge build` or the MatchPool/ClaimHub suites.
`scripts/anvil-e2e.sh:1-19` runs the in-process E2E test by default; it starts Anvil only when
`WITH_ANVIL=1`, so it is not a deployed-contract integration test.

The Solidity suites cover important settlement invariants—seat binding, signature binding,
Mode A/B, payout ratios, refunds, claim timing, and failed token transfers—but a contract change
can merge while TypeScript CI remains green and the Solidity tests are never executed.

**Recommendation:** add a CI job that runs `forge fmt --check`, `forge build`, and the focused
MatchPool/ClaimHub tests. Add a separate local Anvil integration job that deploys the exact
artifacts consumed by the app and verifies ABI tuple decoding, settlement proposal, settlement,
claim, cancellation, and timeout refund end to end.

### CHAIN-05 — Medium: chain/address configuration is not self-validating

`lib/chips.ts:135-145,199-201` accepts any environment value beginning with `0x` as a contract
address. `hooks/useSettlePool.ts:54` defaults an absent or unrecognized chain selection to
Base Sepolia. Deployment scripts require operators to manually copy addresses into app and
contract environments.

A mismatched CHIPS token, MatchPool, ClaimHub, or chain can therefore pass configuration checks
and fail later, or present data from one deployment while signing against another. The source
does not validate chain ID, bytecode presence, or the expected contract relationships.

**Recommendation:** make chain selection explicit and fail closed; validate address syntax and
checksum; require a deployment manifest containing chain ID, contract addresses, bytecode/codehash,
and the MatchPool's configured CHIPS/ClaimHub relationships. Load the manifest in both server and
client configuration checks and add a startup/CI consistency test.

## Architecture and game-system recommendations

### A. Make authority selection observable, not just documented

The repository now has a coherent server-room design: `src/worker.ts` routes room traffic to
`MatchRoom`, `src/room/MatchRoom.ts` serializes intents and persists sequence/state, and
`202610180004_room_lifecycle.sql` provides the atomic commit. The remaining architectural risk is
deployment ambiguity: legacy PeerJS/realtime paths, room-version selection, and the retired Edge
terminology remain visible in code and documentation.

Publish a per-match authority record containing `room_version`, room endpoint, engine version,
and deployment revision. Reject a client that attempts to use a transport other than the recorded
authority, and expose a health check that proves the selected room can authenticate, roll, move,
commit, reconnect, and recover from a timeout.

### B. Make the engine contract executable across every surface

`lib/engine/core.ts`, `src/room/engine.ts`, offline orchestration, AI decisions, and payout
derivation must share generated types and fixtures. The existing byte-sync gate proves only that
the room copy matches the core copy; it does not prove that UI-side power execution, contract
shape mapping, or settlement winner mapping consumes the same semantic model.

Add a canonical match fixture containing: 1v1, 2v2, 4P, capture/truce, three sixes, no-legal-move,
power pickup/expiry, teleport victory, AFK replacement, room reconnect, settlement plan, and claim.
Run it through the room engine, client projection, receipt, API record path, and payout-plan
builder. Compare hashes and reject any surface that changes authority-owned fields.

### C. Separate economic state from presentation state

The UI currently has a display-only estimate path and an on-chain authoritative path, but the
same components still carry both. Make `PoolSummary` and `SettlementPlan` server-owned domain
objects; do not let a display estimate satisfy the type expected by a settlement button.
`prizeFund`, `shape`, `settleBy`, `claimUnlockAt`, `settleNonce`, and `authority` should be
immutable fields in the settlement workflow after the chain read.

### D. Finish the operational proof for the new architecture

The implementation record says the MatchRoom migration and private Realtime controls are complete,
but source alone cannot prove Cloudflare bindings, Supabase migration application, production
room-version defaults, Edge signer rotation, or contract/environment alignment. Before enabling
real-value play, record owner-observed evidence for:

1. Worker routes `/api/room/:matchId/ws` to the deployed MatchRoom binding.
2. A newly created match stores and preserves `room_version = 2`.
3. Anonymous sockets cannot join seats or submit intents.
4. Private Realtime policies are applied in the hosted project.
5. The deployed MatchPool bytecode/codehash matches the reviewed artifact and its CHIPS,
   ClaimHub, owner, and Edge signer addresses are the intended ones.
6. A funded test pool completes join → lock → settlement → delayed claim and a cancelled pool
   completes timeout refund.

## Reconciliation of earlier findings

The following prior findings should be carried as **deployment validation**, not repeated as
current source findings without re-checking the current path:

| Earlier item | Current source observation |
|---|---|
| SA-1 deployed Edge functions absent from repo | The directories remain deleted and a retirement gate exists; current source selects MatchRoom/room engine. Verify production route/binding state. |
| TU-1 public unauthenticated game-room control channel | Current migration/source claims private Realtime and PeerJS demotion. Verify hosted Realtime RLS and ensure no legacy client is shipped. |
| SA-2 arbitrary `/api/match/record` winner/wager path | Current implementation record says winner is derived from `match_states`; re-verify current route and run a route-matrix test against the deployed schema before relying on the closure. |
| PW-1 unauthenticated Edge `get` snapshot | The retired Edge path is no longer source-visible; verify no deployed legacy function remains reachable and that public snapshots use the sanitizer. |
| MM-1 quick-match shape filling | Still source-relevant until the matchmaking RPC and current UI are verified together; the prior live evidence is historical, not proof of the current deployment. |

## Updated priority order

1. **P0:** fix CHAIN-01, CHAIN-02, and CHAIN-03 together; the paid settlement path must be
   request-compatible, decode the twelve-field summary correctly, and submit exactly the
   server-signed plan.
2. **P0:** add contract tests to CI and an Anvil app-integration test before enabling funded pools.
3. **P1:** enforce a deployment manifest and explicit chain selection; fail closed on address or
   bytecode mismatch.
4. **P1:** publish per-match authority/version telemetry and remove or hard-disable legacy
   transports once the room path is confirmed in production.
5. **P1:** run the complete game-to-settlement fixture across room, API, client projection, and
   contracts; include 2v2 and 4P winner ordering/dust cases.

## Follow-up verdict

The current Solidity `MatchPool` design has strong source-level protections around seat binding,
EIP-712 plan/authority/nonce binding, payout ratios, delayed claims, cancellation, timeout refunds,
bond slashing, and failed-token-transfer handling. The dominant current risk is not an obvious
missing contract check; it is that the application does not yet prove it can drive the reviewed
contract consistently. Until CHAIN-01 through CHAIN-03 and the deployment/CI gates are closed,
the paid-pool feature should be treated as **not release-ready**, even though the Solidity unit
tests and static application gates are reported green.

---

# Part III: Independent Analysis, Root-Cause Synthesis, and Technical Remediation Specifications

**Analysis Date:** 2026-10-20  
**Focus:** Architectural validation, defect root causes, interface alignment, and actionable implementation specs.

## 1. Cross-Layer Architectural Analysis

The system review establishes a critical dichotomy across the stack:
- **Core Engine Mechanics (Healthy):** Pure mathematical functions in `lib/engine/core.ts`, single-sourced 2v2 diagonal seating in `TEAM_PAIRINGS`, and seeded LCG pseudo-random power tile mechanics are strictly guarded and passing 454 unit tests.
- **Network Authority & Orchestration (High Risk):** Three disjoint network designs have overlapped in history:
  1. *Legacy P2P / Supabase Realtime Relay:* `TeamUpContext.tsx` where the host browser is de facto authority.
  2. *Legacy Edge Authority:* Deployed Supabase Edge functions (`roll-dice`, `move-auth`, `resolve-bet`) deleted from the git repository yet still active in production.
  3. *Track A MatchRoom Durable Object:* `src/room/MatchRoom.ts` and `src/room/engine.ts` designed to centralize game state, turns, and atomic database commits.
- **On-Chain Settlement Bridge (Broken Glue):** The Solidity contracts (`contracts/src/MatchPool.sol`) implement robust EIP-712 signature verification, delay periods, and seat binding, but the React hooks and Next.js API routes are disconnected by schema drift and off-by-one tuple offsets.

---

## 2. Deep-Dive Defect Analysis

### 2.1 CHAIN-01: API Schema Drift in Settlement Propose
- **Defect Point:** `app/api/chips/settle/propose/route.ts:47-58` vs `hooks/useSettlePool.ts:70-86`.
- **Mechanism:**
  - Route validation requires:
    ```ts
    const { poolId, winners, split } = body ?? {};
    if (!poolId || !Array.isArray(winners) || winners.length === 0) {
        return NextResponse.json({ error: "Missing settle fields" }, { status: 400 });
    }
    ```
  - Hook invocation sends:
    ```ts
    body: JSON.stringify({
        walletAddress: address,
        sessionId,
        chainId,
        poolId: args.poolId,
        authority: args.authority,
        participants: args.participants ?? args.plan.map((p) => p.addr),
        winnerAddresses: args.winnerAddresses ?? args.plan.map((p) => p.addr),
        payoutPlan: args.plan.map((p) => ({ addr: p.addr, amount: p.amount.toString() })),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        mode: args.modeB ? "edge-only" : "dual",
    })
    ```
- **Consequence:** `winners` is `undefined`, triggering a `400 Missing settle fields` on every single settlement proposal. No on-chain settlement can proceed via the UI.

### 2.2 CHAIN-02: Off-By-One Tuple Decoding in `useChipsPool`
- **Defect Point:** `hooks/useChipsPool.ts:167-180` vs `contracts/src/MatchPool.sol:286-318`.
- **Mechanism:**
  - `MatchPool.getPoolSummary` returns 12 values:
    `[0: status, 1: maxSeats, 2: filledSeats, 3: shape, 4: authority, 5: entryFee, 6: gross, 7: prizeFund, 8: hostBond, 9: settleBy, 10: claimUnlockAt, 11: settleNonce]`
  - Hook decodes a stale 10-value tuple:
    ```ts
    const a = data as unknown as readonly unknown[];
    return {
        status: Number(a[0] ?? 0),
        maxSeats: Number(a[1] ?? 0),
        filledSeats: Number(a[2] ?? 0),
        authority: a[3] as `0x${string}` | undefined, // ACTUALLY `shape` (uint8)
        entryFee: (a[4] as bigint) ?? BigInt(0),       // ACTUALLY `authority` (address)
        gross: (a[5] as bigint) ?? BigInt(0),          // ACTUALLY `entryFee`
        prizeFund: (a[6] as bigint) ?? BigInt(0),      // ACTUALLY `gross`
        hostBond: (a[7] as bigint) ?? BigInt(0),       // ACTUALLY `prizeFund`
        settleBy: (a[8] as bigint) ?? BigInt(0),       // ACTUALLY `hostBond`
        claimUnlockAt: a[9] as bigint | undefined,     // ACTUALLY `settleBy`
    };
    ```
- **Consequence:** Corrupts UI rendering of pool authority, computes fees against wrong fields, miscalculates claim countdowns (using `settleBy` instead of `claimUnlockAt`), and causes payout estimators to derive amounts from `gross` instead of `prizeFund`.

### 2.3 CHAIN-03: Dual Economic Plan Construction
- **Defect Point:** `hooks/useSettlePool.ts:126-134` vs `contracts/src/MatchPool.sol:716-730`.
- **Mechanism:**
  - Route derives canonical payout entries and edge signature for `planHash`.
  - Hook submits `args.plan` directly into contract function `settlePool`:
    ```ts
    args: [
        args.poolId,
        args.plan.map((p) => ({ addr: p.addr, amount: p.amount })),
        dl,
        n,
        hostSig,
        edgeSig,
    ]
    ```
- **Consequence:** If client `args.plan` differs by a single wei (rounding/dust), entry order, or address formatting from the server-calculated plan, the smart contract's `settleStructHash` does not match `edgeSig`, causing an instant transaction revert.

### 2.4 TU-1 / PW-1 / PW-2: Unauthenticated Relay & Wire Privacy Leaks
- **Defect Point:** `hooks/useSupabaseRelay.ts:105`, `hooks/TeamUpContext.tsx:843-895`, `lib/wireSanitize.ts:6-14`.
- **Mechanism:**
  - Public broadcast channel `game-room-<roomCode>` accepts messages without membership authorization.
  - `START_GAME` and `MOVE_TOKEN` are executed by the receiver without checking whether the sender matches the room authority or seat owner.
  - State broadcast sanitizer only strips `powerTiles[].type`, leaving `playerPowers` (opponent held hands) completely visible on the wire.

### 2.5 MM-1: Matchmaking Roster Truncation
- **Defect Point:** `supabase/migrations/00000000000000_baseline.sql:457-469`.
- **Mechanism:**
  - `join_matchmaking` RPC queries:
    ```sql
    select * into opponent from public.matchmaking_queue ... limit 1;
    insert into public.matches(..., participants) values (..., array[p_player_id, opponent.player_id]);
    ```
- **Consequence:** The roster is hardcoded to 2 players regardless of `match_type` (`2v2` or `4P`). Clients waiting for 4 players stall and default to AI bot play.

---

## 3. Concrete Remediation Specifications

### Remediation Spec 1: Unify Settle Propose Contract (CHAIN-01 & CHAIN-03)

**Shared Types (`lib/types/settle.ts`):**
```ts
export interface PayoutEntryWire {
    addr: `0x${string}`;
    amount: string; // BigInt serialized in wei
}

export interface SettleProposalRequest {
    walletAddress: `0x${string}`;
    sessionId: string;
    chainId?: number;
    poolId: `0x${string}`;
    authority?: `0x${string}`;
    winnerAddresses: `0x${string}`[];
    split?: 'standard' | 'even' | 'custom';
    nonce?: string;
    deadline?: string;
    mode?: 'dual' | 'edge-only';
}

export interface SettleProposalResponse {
    poolId: `0x${string}`;
    plan: PayoutEntryWire[];
    planHash: `0x${string}`;
    edgeSig: `0x${string}`;
    nonce: string;
    deadline: string;
    effectiveSettleBy: number;
    claimUnlockAt: number;
}
```

**Implementation Steps:**
1. Update `app/api/chips/settle/propose/route.ts` to accept `winnerAddresses` (and alias `winners` for backwards-compatibility).
2. Update `hooks/useSettlePool.ts`:
   - Transmit `winnerAddresses` matching the schema.
   - Replace submission of `args.plan` with the server-returned `data.plan`.
   - Calculate and verify `payoutPlanHash(data.plan) === data.planHash` before dispatching wallet signatures or contract transactions.

### Remediation Spec 2: Fix 12-Tuple Pool Summary (CHAIN-02)

**Implementation in `hooks/useChipsPool.ts`:**
```ts
export interface PoolSummaryView {
    status: number;
    maxSeats: number;
    filledSeats: number;
    shape: number;
    authority: `0x${string}` | undefined;
    entryFee: bigint;
    gross: bigint;
    prizeFund: bigint;
    hostBond: bigint;
    settleBy: bigint;
    claimUnlockAt: bigint | undefined;
    settleNonce: bigint;
}

// In useChipsPoolSummary:
const a = data as unknown as readonly unknown[];
return {
    status: Number(a[0] ?? 0),
    maxSeats: Number(a[1] ?? 0),
    filledSeats: Number(a[2] ?? 0),
    shape: Number(a[3] ?? 0),
    authority: a[4] as `0x${string}` | undefined,
    entryFee: (a[5] as bigint) ?? BigInt(0),
    gross: (a[6] as bigint) ?? BigInt(0),
    prizeFund: (a[7] as bigint) ?? BigInt(0),
    hostBond: (a[8] as bigint) ?? BigInt(0),
    settleBy: (a[9] as bigint) ?? BigInt(0),
    claimUnlockAt: (a[10] as bigint) ?? undefined,
    settleNonce: (a[11] as bigint) ?? BigInt(0),
};
```

### Remediation Spec 3: Wire Privacy Sanitization (PW-1 / PW-2)

**Implementation in `lib/wireSanitize.ts`:**
```ts
export function sanitizeGameStateForWire(state: GameState, viewerColor?: PlayerColor): GameState {
    const sanitized = { ...state };
    
    // Mask board power tiles
    if (sanitized.powerTiles) {
        sanitized.powerTiles = sanitized.powerTiles.map(pt => ({
            ...pt,
            type: undefined as unknown as PowerType,
        }));
    }
    
    // Redact opponent held powers
    if (sanitized.playerPowers) {
        const maskedPowers = { ...sanitized.playerPowers };
        for (const color of Object.keys(maskedPowers) as PlayerColor[]) {
            if (viewerColor && color !== viewerColor) {
                maskedPowers[color] = maskedPowers[color].map(p => ({
                    ...p,
                    type: 'masked' as unknown as PowerType,
                }));
            }
        }
        sanitized.playerPowers = maskedPowers;
    }
    
    return sanitized;
}
```

### Remediation Spec 4: Shape-Aware Matchmaking Accumulation (MM-1)

**Implementation in `supabase/migrations/`:**
Update `join_matchmaking` RPC:
- Inspect `p_match_type`: determine `required_slots = (p_match_type = '1v1' ? 2 : 4)`.
- Query `searching` tickets matching `game_mode` and `match_type` up to `required_slots - 1`.
- If sufficient tickets exist, bundle all participant IDs into `matches.participants`, update all ticket statuses to `matched`, and return the room.
- If insufficient, remain `searching`.
- *UI Fallback:* Until migration applies, disable 2v2/4P tabs in `app/components/QuickMatchPanel.tsx` with a "Coming Soon" badge.

---

## 4. Verification & Gate Strategy

| Gate / Test | File / Target | Objective |
|---|---|---|
| **Settle API Integration** | `scripts/settle-propose.test.ts` | Verify JSON contract between `useSettlePool` and `/api/chips/settle/propose` passes with valid signature generation. |
| **Pool Summary Decoding** | `scripts/pool-summary.test.ts` | Unit test verifying 12-tuple ABI return decoding against mock `MatchPool` outputs. |
| **Contract CI Gate** | `.github/workflows/ci.yml` | Add `forge test --root contracts` to run Solidity unit tests in GitHub Actions. |
| **Realtime Policy Check** | Hosted Supabase RLS | Verify channel RLS policies exist on `realtime.messages` for `game-room-*`. |
| **DO Room Lifecycle** | `scripts/room-lifecycle.test.ts` | Verify end-to-end intent processing, atomic CAS commit, and turn timeout alarm execution. |

