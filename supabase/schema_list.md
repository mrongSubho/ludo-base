# Canonical Supabase schema

The canonical fresh-install schema is
`supabase/migrations/00000000000000_baseline.sql`.

It is dependency ordered and covers:

- wallet-based players, app sessions, progression, missions, activities, and
  idempotent `coin_ledger`;
- social graph, encrypted-message payloads, conversations, pokes, blocks,
  reports, and feedback;
- matches, matchmaking, invites, lobby requests, match sessions, provisional
  sessions, authoritative states, rolls, and moves;
- live matches/chat, spectator bets, settlement-compatible fields, and
  tournaments.

Rolls (`match_rolls.status`) carry a closed vocabulary — `open` | `consumed`
| `passed`, default `open`, CHECK-constrained, with `isDuplicateAction` an
explicit allowlist (migration `202609300002`). Historical rows written before
that migration may have a NULL status; the Edge boundary fails closed on them
rather than backfilling a guess.

RLS is default-deny. Public reads are explicitly limited to spectator-facing
match/live/tournament data; writes affecting identity, authority, economy,
keys, sessions, or game state require service-role/server RPC execution.

The dated files in `supabase/migrations/` are retained for deployed-database
compatibility and historical context. The root `migrations/` directory and
`supabase/migrations_archive/` are **frozen archives** (every file carries an
ARCHIVED header; `scripts/archive-guard.test.ts` fails any that does not) and
are not required for a fresh install. All new SQL goes in
`supabase/migrations/`. This document contains no teardown or reset SQL.

DB-01 note: `202609230003_freeze_legacy_coin_writers.sql` once aborted
mid-file on a fresh apply. It is wrapped in `begin; … commit;` and its stub
args match the live signature; the full chain now applies clean (static +
DB-mode `npm run check:schema`).
