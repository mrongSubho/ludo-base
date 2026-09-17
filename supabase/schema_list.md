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

RLS is default-deny. Public reads are explicitly limited to spectator-facing
match/live/tournament data; writes affecting identity, authority, economy,
keys, sessions, or game state require service-role/server RPC execution.

The dated files in `supabase/migrations/` are retained for deployed-database
compatibility and historical context. The root `migrations/` directory is a
legacy archive and is not required for a fresh install. This document contains
no teardown or reset SQL.
