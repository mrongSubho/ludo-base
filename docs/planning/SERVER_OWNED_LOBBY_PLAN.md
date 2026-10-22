# Ludo Base — Server-Owned Lobby: retiring host/guest

**Rev 1 · 2026-10-22 · status: proposed, awaiting owner decisions (§11)**

Companion to `SERVER_AUTHORITY_MIGRATION_PLAN.md` (Rev 3, the *what/when*) and
`WORKLOAD_PLACEMENT_MATRIX.md` (the *where*). This document covers one thing those two
did not deliver: **who forms a match**. Read §1 first — it is the part that is awkward.

---

## 1. Why this document exists

`SERVER_AUTHORITY_MIGRATION_PLAN.md` is headed "FULLY IMPLEMENTED" and its P4 is marked
COMPLETED with the deliverable *"the clock, the lifecycle, and the relocation"*. §4.4 of that
same document lists the room's responsibilities as including:

> **Membership** — Validates the session cookie/token, resolves `matchId` → seats, admits only
> participants + spectators with `spectator` scope.

**That responsibility is not implemented.** The room validates a session and derives a role, but
it never resolves `matchId` → seats, and the client only opens the room socket *after* the lobby
has already formed. Concretely, in `hooks/TeamUpContext.tsx`, `connectRoom` — the only thing that
opens the socket — is called at exactly two places, **both inside the `START_GAME` handler**
(lines 556 and 1098).

So the authority split today is:

| Layer | Authority | Where |
|---|---|---|
| Match formation (who plays, which colour, who decides) | **P2P host** | `hostGame` / `joinGame` / `seatGuestPlayer` / validation token / door policy |
| In-match state (dice, turns, move validation, commit) | **Server** | MatchRoom DO, opened at `START_GAME` |

The red half is not vestigial. It is load-bearing, and it is where **every bug from 2026-10-22
lived** — MM-12, MM-13, MM-14, MM-15, four separate stalls, none of which touched the Durable
Object. See §3.

**The ask:** finish the migration for the formation layer, so that no client is ever the authority
on who is in a match.

---

## 2. What "no host, no guest" means precisely

Worth being exact, because "no roles at all" is not achievable and not desirable.

**Roles that stay (data, not authority):**

- **Owner** — the wallet that created the lobby. It exists so lobby *settings* have an author
  (mode, wager, shape). It confers no authority over play. Today this is conflated with "host".
- **Seat** — a `(match_id, colour, wallet)` row. Assigned by the server.

**Authority that must leave the client:**

| Concern | Today | Target |
|---|---|---|
| Who is in the match | host's `lobbyState.slots` + token exchange | server, at formation |
| Which colour each player gets | host's `assignJoinerToSlot` | server, deterministic |
| Who seeds the board | host's `START_GAME.initialBoardConfig` | room, from `match_seats` |
| Who may act | host, as "match authority" | room, from session → seat |
| Roster propagation | host broadcast (`LOBBY_SYNC`) | room fan-out |
| Turn clock / AFK | host's `useAIBrain` + `useAFKManager` | room alarms |

The distinction that matters: **an owner may configure a lobby; only the server may decide who
plays and what the board contains.**

---

## 3. What the current split costs (evidence)

All four of these are formation-layer defects. None involves the DO.

| ID | Defect | Why it only exists because of P2P formation |
|---|---|---|
| **MM-12** | Guest dispatched a `JOIN_REQUEST` with no validation token; host's door rejected it | Two peers must authenticate to *each other*, so a shared secret has to be delivered |
| **MM-13** | Guest minted its own roster via `shufflePlayers` | The roster is host-owned state that must be *broadcast*, and a missed broadcast is unrecoverable |
| **MM-14** | Host's `lobby_join_policies` row landed 5.06 s after the guest's join, so the host's own poll 403'd | `resolveRoomHost` exists only because the *host* has to prove ownership to its own server |
| **MM-15** | A second route to the board bypassed the roster gate | Two independent entry points (`handlePlayNow`, the START_GAME recovery effect) each had to be gated separately |

With server-owned formation, the token has no reason to exist (the server knows both seats), the
door has nothing to prove (authorisation is the session), the roster cannot be missed (it is the
room's own state), and there is one entry point (the room's `joined` frame).

That is the argument: **these are not four bugs, they are one architectural gap presenting four
times.**

---

## 4. Current state — what already works

Do not rebuild these.

- **`src/worker.ts:92`** routes `/api/room/:matchId/ws` straight to the DO. Complete.
- **`src/room/MatchRoom.ts`** (885 lines): hibernatable WebSockets, `verifyTicket` / `verifyCookie`
  → wallet + `role: 'seat' | 'spectator'`, `IntentKind = REQUEST_ROLL | REQUEST_MOVE |
  REQUEST_POWER`, in-process engine (`resolveNetworkedMove`), alarm-driven timers, fan-out,
  `match_commit_action` commit.
- **`lib/netcode/roomClient.ts`** (393 lines): connect, seed, sendIntent, status callbacks.
- **`hooks/TeamUpContext.tsx`**: `connectRoom`, `sendRoomIntent`, `roomAuthority` derived from
  socket status; `useGameActions` already branches on `roomAuthority` at lines 177, 439, 652.
- **`sessions`** carries `scope: 'match' | 'spectator' | 'app'` and `match_id`.

## 5. What is missing

Three things, in dependency order.

### 5.1 Seat resolution (the room cannot say who should be playing)

`MatchRoom.verifyTicket` returns `role: db.scope === 'match' ? 'seat' : 'spectator'`. **Role is
derived from the session's scope alone.** It never checks that the wallet is a participant of this
match, and it has no notion of *which* colour that wallet holds. Any holder of a `match`-scoped
session for a `matchId` is a seat.

There is no `match_seats` table. `matches.participants` is an unordered array; colour assignment
exists only inside the host's `lobbyState`.

### 5.2 Seat binding in the session (SA-3)

`sessions` has `match_id` but **no `seat_color`** — verified against the migration chain;
`seat_color` exists only on `match_rolls`. So a session cannot express "this wallet is yellow in
this match".

SA-3 is currently recorded as *blocked on SA-1* because the writer was going to be `move-auth`,
whose source was deleted. **It does not have to be.** A Next.js route can mint match-scoped
sessions; nothing about it needs the edge function. This plan unblocks SA-3 by moving the writer
into the app.

### 5.3 The room is not open during formation

`connectRoom` fires at `START_GAME`. Formation happens entirely before that, over PeerJS and the
relay. Moving `connectRoom` earlier is the enabling change for everything else.

### 5.4 Blocking defect found during this audit

**`match_states` is empty in production — no match has ever been seeded.** Verified by direct
query, and by probing the edge function (`move-auth` answers `400`/`500`, not `404`, so it is
deployed and reachable). `moveAuth.seedMatch` calls it and nothing lands.

A server-owned room must persist. **This must be fixed before S3**, and it is independent of the
rest of this plan — it is a live defect today, since `/api/match/record`'s SA-2 check reads
`match_states.state.winner` and can therefore never pass.

---

## 6. Target design

### 6.1 One formation path for every lobby type

The instinct is to migrate *quick match* and leave invite lobbies alone. Don't. Invite lobbies
have the same shape — an owner, N invitees, a fixed colour set — so a second path would keep the
whole token/door machinery alive for a smaller audience. **One mechanism:**

```
POST /api/lobby/open      owner creates a lobby  → lobby row + seats reserved (owner seat 0)
POST /api/lobby/seat      wallet takes a free seat → server assigns the next colour
GET  /api/lobby/:code     lobby state (seats, mode, wager, status)
POST /api/lobby/start     owner starts → server flips status, opens the room, room seeds itself
```

`/api/lobby/open` replaces the client-generated room code. `/api/lobby/seat` replaces
`joinGame` + `JOIN_REQUEST` + `seatGuestPlayer` + `/api/lobby/join`. `/api/lobby/start` replaces
`handlePlayNow` + `START_GAME` broadcast.

Quick match keeps its RPC — `join_matchmaking` already forms the match server-side and writes
`matches.participants`. It only needs to **also write `match_seats`** with colours.

### 6.2 Seat assignment is deterministic and server-side

```sql
create table public.match_seats (
  match_id  uuid not null references public.matches(id) on delete cascade,
  color     text not null check (color in ('green','red','yellow','blue')),
  wallet_address text not null,
  seat_index int not null,
  assigned_at timestamptz not null default now(),
  primary key (match_id, color),
  unique (match_id, wallet_address)
);
```

Colour order per shape comes from the existing `LOBBY_COLORS` / `seatedColorsFor` table in
`lib/engine/core.ts` — the same list the turn cycle already uses (TU-6). Do **not** introduce a
second ordering; that is how `LOBBY_COLORS` and the turn cycle drifted apart before.

Assignment rule: sort the participant wallets, index into the shape's colour list. Deterministic,
so both clients and the room agree without a round-trip.

### 6.3 Session carries the seat

```sql
alter table public.sessions add column if not exists seat_color text;
```

A `match`-scoped session is minted only for a wallet holding a row in `match_seats`, and
`seat_color` is copied from it. `MatchRoom.verifyTicket` then returns the seat, and
`REQUEST_MOVE` validates that the acting colour matches the session's seat — which removes the
need for the client to declare `color` at all.

### 6.4 The room seeds itself

Today the host sends a `seed` frame with `initialBoardConfig`. Target: the room reads
`match_seats` + `matches.match_shape` and constructs the initial state itself. `seedState` becomes
an owner-only "reset" operation, not the normal path. This deletes the entire class of "the guest
never received the roster" bugs.

### 6.5 AI, AFK and the clock move into the room

`useAIBrain` and `useAFKManager` are host-orchestrated (`isLobbyConnected && !isHost → return`).
Plan §4.4 already specifies server-driven AI with `lcg32` seeded per `(matchId, turn_seq)`. The
room's alarm min-heap already exists; this is wiring, not new architecture. It is also what makes
`isHost` deletable from those hooks.

---

## 7. Phases

Each phase is independently shippable and gated. Do not start a phase before its predecessor's
acceptance criteria are met.

### S0 — Unblock persistence (independent, do first)

- Fix `seedMatch`. Decide: (a) restore `move-auth` source, (b) undeploy the three orphaned edge
  functions and seed through a Next.js route, or (c) seed from the room only.
- **Recommendation: (c)** — it is where the state belongs, and it removes the SA-1 dependency.
- **Acceptance:** a real 1v1 match produces a `match_states` row; `db:migrate:verify` and
  `/api/match/record`'s SA-2 check pass against it.
- **Gate:** a test that seeds via the room and asserts the row.

### S1 — `match_seats` + server colour assignment

- Additive migration; write seats from `join_matchmaking` and from `/api/lobby/open`.
- Backfill nothing (no live matches).
- **Acceptance:** for a formed match, `match_seats` holds one row per participant with the
  colours `seatedColorsFor(shape)` expects.
- **Gate:** `check:schema`, `check:rls`, plus a test asserting seat count and colour set per shape.

### S2 — Seat-bound sessions (closes SA-3)

- `sessions.seat_color`; mint match-scoped sessions only for seat holders; move the writer into
  the app (a route, not an edge function).
- **Acceptance:** a wallet with no seat in match X cannot obtain a `match`-scoped session for X.
- **Gate:** a test that attempts it and expects rejection; `check:rls`.

### S3 — Open the room at formation, seed server-side

- `connectRoom` at match-formed; room seeds from `match_seats`.
- Keep the client `seed` frame working behind `roomAuthority === false` so nothing breaks mid-flight.
- **Acceptance:** both devices show the same roster with zero roster broadcast; `initialBoardConfig`
  is absent from the wire and nothing misses it.
- **Gate:** a two-client integration test. **This does not exist yet** — `room-transport.test.ts` is
  unit-level only (single client). Building it is part of S3, and it is the only way to prove the
  acceptance criterion without two browsers.

### S4 — Delete the P2P formation path

- Remove from the gameplay path: `hostGame`, `joinGame`, `seatGuestPlayer`, `validationToken`,
  `lobby_join_policies`, `JOIN_REQUEST`, `resolveRoomHost`, `handlePlayNow`'s lobby branch.
- Keep `/api/lobby/join` only if something non-gameplay still uses it (verify first).
- **Acceptance:** `grep -r "seatGuestPlayer\|JOIN_REQUEST" hooks app` returns only the room path.
- **Gate:** new `check:no-p2p-formation.mjs` gate so it cannot come back.

### S5 — Move AI/AFK/timers to the room; delete `isHost`

- `isHost` in 25 files → `isSeat` where it means "am I a player", deleted where it means "am I the
  authority".
- **Acceptance:** `isHost` gone from `hooks/`; a dropped host does not pause the match.
- **Gate:** the AFK/turn-timeout tests, plus a host-disconnect drill.

---

## 8. Failure modes

| Failure | Today | Target |
|---|---|---|
| Room socket unreachable | silent fallback to P2P host; nobody can tell | **fail loudly**: the lobby does not start, with a named error. A silent second authority is how this bug class survives. |
| A seat never connects | host stalls on `seatsReady` | room holds the seat; `ABANDON_GRACE_MS` expires it and the match starts or voids explicitly |
| Room restarts (DO eviction) | n/a | room reloads from `match_states`; clients resume by `seq` (already implemented) |
| Client clock skew | turn timers are client-driven on the host | room alarms only |

The one non-obvious decision: **do not keep a silent P2P fallback.** It is what allowed MM-12–15
to persist for four rounds — every fix looked green because the other path still worked.

---

## 9. Security delta

**Improves:**

- No shared secret between peers → MM-12 class gone.
- `REQUEST_MOVE` authorised by `session.seat_color` instead of a client-declared `color`.
- The relay stops carrying anything that can move a client between rooms (already removed, TU-1).

**New surface:**

- `/api/lobby/open` and `/api/lobby/seat` need rate limits and must not let a wallet take two
  seats. Both belong in `lib/rateLimitRoutes.ts` and `scripts/check-routes.mjs` (the two registry
  edits every new route needs).
- Seat assignment must be idempotent — a double `seat` call must not create two rows. The
  `unique (match_id, wallet_address)` constraint is the guard; the route must handle `23505`.

---

## 10. Test plan

| Level | What it proves |
|---|---|
| Unit | `match_seats` assignment is deterministic for both shapes; colour set matches `seatedColorsFor` |
| Route | a non-participant cannot obtain a seat session; a double seat call is idempotent |
| **Two-client harness (must be built)** | both clients receive an identical roster from the room, with no broadcast |
| Drill | kill the host mid-match; the room continues (this is the whole point) |
| Gate | `check:no-p2p-formation.mjs` — the deleted machinery stays deleted |

**There is no two-client harness today — S3 has to build one.** I checked before writing this:
`scripts/room-transport.test.ts` instantiates a **single** `RoomClient` and tests URL resolution,
`hashToken`, `isMutatingIntent`, spectator rejection (`SPECTATOR_READ_ONLY`), seat acceptance and
`computeAuthority`. It never runs two clients against one room. That is the single largest
under-estimated item in this plan, and it is what would actually prove "both devices see the same
roster" without a browser.

Existing coverage to extend rather than duplicate: `scripts/matchmaking-shape.test.ts` (formation
shape), `scripts/session-v2.test.ts` (session scopes), `scripts/room-lifecycle.test.ts` (room
lifecycle).

---

## 11. Decisions needed from you

1. **S0 approach** — (a) restore the edge source, (b) undeploy and use a Next route, or (c) seed
   only from the room. I recommend **(c)**.
2. **Silent fallback** — accept the recommendation to remove it, so a room that cannot connect
   fails loudly instead of quietly reverting to a P2P host? This is the change that would have
   surfaced MM-12 on day one.
3. **Invite lobbies** — migrate them onto the same formation path (§6.1), or keep them on the
   current path for now? Migrating them is *less* total work than maintaining two paths.
4. **Sequencing vs. the live stall** — S0–S5 is a multi-day migration. Do you want it done before
   the next gameplay test, or should I keep chasing the current stall on the P2P path in parallel?

---

## 12. Non-goals

- Removing the relay entirely (chat, presence and lobby pings can stay).
- Spectator mode changes.
- On-chain settlement changes.
- Replacing `matches` / `matchmaking_queue` — they stay; `match_seats` is additive.

---

## Appendix A — Claimed vs. delivered, one table

| Plan §4.4 responsibility | Delivered? | Evidence |
|---|---|---|
| Membership: session → **seats** | **No** — session → role only | `MatchRoom.verifyTicket`: `role: db.scope === 'match' ? 'seat' : 'spectator'` |
| State in DO SQLite + Postgres | Yes | `MatchRoom` + `match_commit_action` |
| Rules validation in-process | Yes | `resolveNetworkedMove` |
| Roll minting in-process | Yes | `crypto.getRandomValues` |
| Timers via alarms | Yes (built) | alarm min-heap |
| **AI turns server-driven** | **No** — host-driven | `useAIBrain`: `if (isLobbyConnected && !isHost) return` |
| Fan-out with `seq` | Yes | `applyServerState` |
| Lifecycle: server-originated record/settle | Partial | `/api/match/record` exists but its SA-2 check needs `match_states`, which is empty |
| Spectators | Yes | `role: 'spectator'` |

The three "No/Partial" rows are exactly the scope of this document.
