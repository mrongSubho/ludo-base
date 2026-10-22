# Ludo Base — Server-Owned Lobby: retiring host/guest

**Rev 2 · 2026-10-22 · status: approved — all four decisions accepted (§11), implementation begins at S0**

Companion to `SERVER_AUTHORITY_MIGRATION_PLAN.md` (Rev 3, the *what/when*) and
`WORKLOAD_PLACEMENT_MATRIX.md` (the *where*). This document covers one thing those two
did not deliver: **who forms a match**. Read §1 first — it is the part that is awkward.

| Rev | Change |
|---|---|
| 1 | Initial proposal, four decisions open |
| 2 | All four decisions accepted (D1–D4, §11); added §6.6 deterministic seats and §6.7 offline isolation; named `scripts/room-two-client.test.ts` as the S3 gate |

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

### 6.1 One formation path for every lobby type — **decided (D3)**

The instinct is to migrate *quick match* and leave invite lobbies alone. **Rejected (D3):** invite
lobbies have the same shape — an owner, N invitees, a fixed colour set — so a second path would keep
the whole token/door machinery alive for a smaller audience and guarantee the same bugs in private
games. **One mechanism, serving both:**

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

### 6.2 The `match_seats` table

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

Assignment rule: **see §6.6.** One writer sorts the participants and indexes into the shape's colour
list, then persists the result; nothing else sorts. Do not re-derive the order on read.

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

### 6.6 Deterministic seat assignment — one writer, no second sort

The requirement is that the SQL side and the room arrive at the *same* seat index. The obvious
implementation is "both sort the wallets the same way", and that is the version that breaks:

- JS `.sort()` on strings is **UTF-16 code-unit order**.
- Postgres `ORDER BY text` uses the **database collation**, which for Supabase is typically
  `en_US.UTF-8` (locale-aware), not byte order.
- I could not verify the live collation: there is no `exec_sql` RPC (404 by design), so this is an
  *unverified assumption*, and assumptions are what this plan exists to remove.

For lowercase `0x…` hex these orders happen to coincide — I checked against real participants from
`matches` — but "happens to coincide on this data" is not a guarantee, and it would be a silent,
data-dependent seat swap if it ever diverged.

**Therefore: assign once, persist, and never re-derive.**

1. One writer computes seat order. It reads `matches.participants`, normalises
   (`toLowerCase()`), sorts with an explicit comparator, and indexes into
   `seatedColorsFor(matchShape)` from `lib/engine/core.ts` (the same list the turn cycle uses, TU-6 —
   do **not** introduce a second ordering).
2. It writes one `match_seats` row per `(match_id, colour, wallet, seat_index)`.
3. Everyone else — the room, the API, the client — **reads the persisted rows**. No component sorts
   wallets. If you find yourself sorting wallets outside the writer, that is the bug.

If a sort must appear in SQL, force byte order explicitly: `order by wallet_address collate "C"`.
Never rely on the default collation for anything that determines a seat.

Add a gate: `match_seats` for a given match, read back and compared to
`seatedColorsFor(shape)` length and set, must match. That catches a divergent writer immediately.

### 6.7 Offline / pass-and-play stays entirely local

A server-owned lobby must not capture local play. Two modes, decided by an explicit predicate — not
by inference from whichever flag happens to be set:

```ts
const isLocalMatch =
  isBotMatch ||
  !matchId ||
  matchId === 'local' ||
  matchId.startsWith('local-');

if (isLocalMatch) {
  // existing local engine. No DO, no socket, no session, no seat rows.
} else {
  // networked: room DO is the only authority. No client-side formation.
}
```

`handlePlayNow` must branch on exactly this. Today it branches on
`isInLobby && lobbyState && !effectiveIsBotMatch`, which is how a networked match fell through into
the offline/bot path four times (MM-13, MM-15). The predicate above is total: every match is either
local or networked, with no third case to fall through.

`local-${Date.now()}` is already the room code for a lobby-less local match (`page.tsx:645`), so the
`startsWith('local-')` arm is grounded in existing behaviour rather than invented.

**Acceptance for 6.7:** grep proves `handlePlayNow` has exactly two arms; a bot match produces no
`match_seats` row and opens no socket.

---

## 7. Phases

Each phase is independently shippable and gated. Do not start a phase before its predecessor's
acceptance criteria are met.

### S0 — Unblock persistence (independent, do first)

**Decided (D1): the room seeds `match_states` itself.** Not the Edge function, not a Next route.

- The room persists its initial state through `match_commit_action`, or a new `seed_match_state`
  RPC if the commit path cannot express an initial write. Prefer the existing RPC.
- `moveAuth.seedMatch` is removed from the seeding path (it stays only as the legacy `roomAuthority
  === false` path until S4 deletes that branch entirely).
- **Acceptance:** a real 1v1 match produces a `match_states` row written by the room; `db:migrate:verify`
  passes; `/api/match/record`'s SA-2 check (`match_states.state.winner`) can now succeed.
- **Gate:** a test that seeds through the room and asserts the row, with no client seed frame and no
  Edge call.
- **Note:** this removes SA-1 from the S0 critical path. Nothing here touches the three orphaned
  Edge functions, so S0 can ship while they remain undeployed.

### S1 — `match_seats` + server colour assignment

- Additive migration; write seats from `join_matchmaking` and from `/api/lobby/open`.
- The writer follows §6.6 exactly: one writer, explicit comparator, persist, never re-derive.
- Backfill nothing (no live matches).
- **Acceptance:** for a formed match, `match_seats` holds one row per participant with the
  colours `seatedColorsFor(shape)` expects, and a read-back comparison passes.
- **Gate:** `check:schema`, `check:rls`, plus a test asserting seat count, colour set and the
  read-back equality from §6.6.

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
- **Gate: `scripts/room-two-client.test.ts` — this must be built, and it is the highest-value item in
  the plan.** Two WebSocket clients against one room instance, asserting both receive an identical
  roster and seed state. Named explicitly so it cannot be quietly skipped or assumed to exist.
  `room-transport.test.ts` does **not** cover this: it instantiates a single client and tests URL
  resolution, `hashToken`, `isMutatingIntent`, spectator rejection and `computeAuthority`.
- **Also gate:** a client that cannot connect gets the D2 error and does **not** start a match.

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
| Room socket unreachable | silent fallback to P2P host; nobody can tell | **fail loudly** (D2): the lobby does not start; UI shows *"Unable to connect to game room — retrying…"* with backoff. No downgrade. |
| A seat never connects | host stalls on `seatsReady` | room holds the seat; `ABANDON_GRACE_MS` expires it and the match starts or voids explicitly |
| Room restarts (DO eviction) | n/a | room reloads from `match_states`; clients resume by `seq` (already implemented) |
| Client clock skew | turn timers are client-driven on the host | room alarms only |

**D2 is a breaking change and is accepted as one.** A player on a network that blocks WebSockets can
no longer play a networked match at all — they get a retryable error instead of a degraded match that
silently desyncs. That is the intended trade: a visible failure beats a match where one device is
the authority and the other is guessing.

The one non-obvious consequence: `roomAuthority === false` stops being "an alternate mode" and
becomes "the match cannot start". Every `if (roomAuthority)` branch in `useGameActions` (lines 177,
439, 652) either keeps its room path or is deleted — none keeps a client-authority path for a
networked match.


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
| Unit | `match_seats` assignment is deterministic for both shapes; colour set matches `seatedColorsFor`; the read-back comparison in §6.6 |
| Route | a non-participant cannot obtain a seat session; a double seat call is idempotent |
| **`scripts/room-two-client.test.ts`** | two clients, one room: identical roster and seed, no broadcast. **Highest-value item — build it first.** |
| Isolation | `handlePlayNow` has exactly two arms; a bot match writes no `match_seats` row and opens no socket (§6.7) |
| Drill | kill the host mid-match; the room continues (this is the whole point) |
| Gate | `check:no-p2p-formation.mjs` — the deleted machinery stays deleted |

**There is no two-client harness today.** I checked before writing this: `scripts/room-transport.test.ts`
instantiates a **single** `RoomClient` and tests URL resolution, `hashToken`, `isMutatingIntent`,
spectator rejection (`SPECTATOR_READ_ONLY`), seat acceptance and `computeAuthority`. It never runs two
clients against one room. That is the single largest under-estimated item in this plan, and it is what
would actually prove "both devices see the same roster" without a browser.

Existing coverage to extend rather than duplicate: `scripts/matchmaking-shape.test.ts` (formation
shape), `scripts/session-v2.test.ts` (session scopes), `scripts/room-lifecycle.test.ts` (room
lifecycle).

---

## 11. Decisions — accepted 2026-10-22

All four settled by the owner. Recorded with the reasoning, because the reasoning is what constrains
the implementation.

### D1 — S0 approach: **seed only from the Durable Object**

Rejected: restoring the orphaned Edge source, and seeding from a Next route.

> The Durable Object is already the single source of truth for the engine, turns, dice RNG and
> atomic CAS commits (`match_commit_action`). Asking an orphaned Edge function or a client route to
> seed `match_states` re-introduces dual authority and race hazards.

**Consequence for S0:** the room persists the initial state itself, via `match_commit_action` or a
new `seed_match_state` RPC. `moveAuth.seedMatch` stops being the seeding path. This also removes the
SA-1 dependency from S0 entirely — nothing in the seeding path touches the deleted Edge functions.

### D2 — Silent P2P fallback: **remove it completely**

> The silent fallback is why these defects survived the migration: it created split-brain
> architecture where one path masked failures in the other.

**Required behaviour:** if the room socket cannot connect, the lobby does **not** start. The UI
shows a retryable error — *"Unable to connect to game room — retrying…"* — and retries with
backoff. Never silently downgrade to a P2P host.

**Consequence:** `connectRoom`'s `catch` branch (`console.warn('🏟️ [Room] unavailable, host remains
the authority')`) is deleted, not kept as a fallback. `roomAuthority === false` becomes a hard
precondition for starting a networked match, not an alternate mode. This is a breaking change for
anyone on a network where WebSockets are blocked — accepted deliberately.

### D3 — Invite lobbies: **migrate them too**

> Two separate lobby architectures double the surface area, keep the legacy token validation alive,
> and guarantee the bugs persist in private games.

**Consequence:** `/api/lobby/open` / `/seat` / `/start` serve **both** quick match and invite
lobbies. The invite path keeps only its *credential* (an invite secret gating who may take a seat) —
not its own formation machinery. S4 therefore deletes the token/door path outright rather than
scoping it to quick match.

### D4 — Sequencing: **S0–S3 directly, no P2P patching**

> Chasing P2P stalls across mobile browsers, NAT configurations and token races is fighting symptoms.

**Consequence:** the four MM-1x fixes already landed are the last P2P patches. From here, work goes
into S0–S3. If a new stall appears, it is diagnosed but not patched on the P2P path unless it blocks
S0–S3 themselves.


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
