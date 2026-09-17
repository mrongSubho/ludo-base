# Canonical migration chain

`00000000000000_baseline.sql` is the fresh-install authority for Ludo Base. It
creates the dependency-ordered schema foundation for the current application,
including compatibility columns for wallet identity, sessions, live play,
missions, tournaments, and server-authoritative game state.

Apply the baseline to a new Supabase project, followed by the active dated
migrations in this directory in filename order. The marketplace migration is
intentionally kept here because it depends on `players` from the baseline.
The files under `supabase/migrations_archive/` are historical compatibility
records and are not part of the CLI migration chain.

All authority, economy, key, match-state, and session mutations are server-only:
use the Supabase service role or the baseline `SECURITY DEFINER` RPCs. RLS is
enabled on every table and deliberately has no client write policies except
anonymous feedback submission. Public reads are limited to match/live/tournament
surfaces needed by spectators.

The root `migrations/` directory is also a legacy archive and is not part of
the fresh-install chain. Do not run its destructive/reset snippets in
production.

The baseline currently establishes the database boundary first: direct client
writes to authority, economy, identity, key, session, and game-state tables are
denied. Existing UI paths that still write those tables directly must be routed
through the server APIs before enabling this baseline for a deployed app.
