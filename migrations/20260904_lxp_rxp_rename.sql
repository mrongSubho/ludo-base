-- ============================================================================
-- Ludo Base — LXP/RXP column rename: ALREADY LIVE, DO NOT RUN.
-- Verified 2026-09-04: `players` carries `lxp`/`rxp` (both 0 for existing
-- rows). The RENAME below fails with `42703: column "xp" does not exist`.
-- Kept as a record. Code at b44d1df+ reads the new names — just deploy.
-- ============================================================================

-- ALTER TABLE public.players RENAME COLUMN xp TO lxp;      -- obsolete live
-- ALTER TABLE public.players RENAME COLUMN rating TO rxp;  -- obsolete live

-- Optional sanity check (read-only):
-- SELECT lxp, rxp, total_wins, total_games, coins FROM public.players LIMIT 5;
