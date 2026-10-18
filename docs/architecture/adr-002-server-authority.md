# ADR-002: Server Authority for Identity, Rules, and Match Lifecycle

## Status
Proposed — pending owner sign-off on §10 of `docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md`.

## Context

Match rules are already server-validated (Supabase Edge Functions `roll-dice`, `move-auth`, `resolve-bet`), but:

- **Identity** is a `localStorage` bearer UUID appearing in query strings and server logs, with no `HttpOnly` cookie, no rotation, and no revocation on wallet changes.
- **Lifecycle authority** sits on a player's browser tab: the compute host drives AI/AFK/turn orchestration, opens the bet window, triggers settlement with a host wallet signature, and records the result with a host signature. If that device leaves, the match degrades or stalls.
- **Realtime rooms** are public-by-default broadcast channels; anyone with a room code can subscribe (NET-03a/b).

This produces four failure classes that cannot be fixed inside the current architecture:
1. **F1:** Host device is a single point of failure for match lifecycle.
2. **F2:** Result integrity rests on a player's honesty (`/api/match/record` accepts `winnerAddress` from the body).
3. **F3:** Sessions are exfiltratable and replayable bearer tokens.
4. **F4:** Realtime rooms are not authorized.

## Decision

Adopt a three-layer target architecture:

1. **Cookie sessions with a scope model** — server-issued challenge → verified signature → `__Host-ludo_session` cookie with scopes (`app`, `match`, `spectator`), rotation, and revocation.
2. **Single server-side validation authority** — all authorization derived from server-computed capabilities, never from client-supplied roles, rosters, or results.
3. **Per-match Durable Object room** — one Cloudflare DO per match for sockets, timers, `seq` ownership, and fan-out. Delivered as a `src/worker.ts` custom worker entry wrapping the OpenNext handler.

After this migration, **"host" is not a privilege — the server is the host**, and players hold only *seats*.

### Key design constraints
- `match_states.seq` remains the authority — Postgres is the system of record and the only writer of `seq`.
- The Durable Object holds hot match state; Postgres holds the truth. Room-local storage is disposable.
- The `ROOM_V2` flag is evaluated at match creation; a match finishes on the path that seeded it (§4.12 in-flight cutover rule).
- The shared TypeScript engine (`lib/engine/core.ts`) is the single source of rules validation across all copies (`check:engine`).

### Phased delivery
- **P0:** Flags, baselines, DO-in-OpenNext spike.
- **P1:** Cookie sessions, distributed rate limiting, cron cleanup.
- **P2:** Server-derived authority (winner, roles, identity).
- **P3:** Room DO as transport + sequencer (delegates rules to existing Edge functions).
- **P4:** Room owns the clock, lifecycle, and relocated validation/minting. Atomic `match_commit_action` RPC.
- **P5:** Private Realtime channels, PeerJS demotion.
- **P6:** Retire host-centric paths, Edge Functions, and legacy code.

## Consequences

### Positive
- Removes the host SPOF — matches complete when a player's phone dies.
- Result integrity is server-derived — progression and settlement can no longer be forged.
- Closes NET-03a/b — realtime rooms become authorized.
- Drops signing prompts to zero during play (one signature at login).

### Negative
- A new per-match infrastructure component (DO room) whose integration path required a P0 spike to validate.
- A migration window where old and new paths coexist behind flags (either/or, never dual authority; live matches drain rather than hand back).
- Worker key custody concentration (`EDGE_SETTLE_PRIVATE_KEY`, service role).
- Workers Paid ($5/mo) is the expected Day-1 baseline from P1.

### Alternatives rejected
- **Auth-only migration** — fixes F3/F4 but leaves F1/F2 untouched.
- **Postgres + Realtime as authority** — no per-match clock; `pg_cron`'s minute granularity cannot drive the 3-second bet window.
- **Keep host signature as a second key** — preserves the F2 class of failure.
- **Keep player-as-authority** — the status quo and the source of F1–F4.

## References
- `docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md` — the full plan (Rev 3)
- `docs/architecture/WORKLOAD_PLACEMENT_MATRIX.md` — placement decisions (Rev 3)
- `docs/planning/PLANNING_REVIEW_2026-10-13.md` — independent review
- `docs/architecture/adr-001-betting-window-protocol.md` — prior ADR
- `ENGINE_LOGIC.md` — engine rules and invariants
