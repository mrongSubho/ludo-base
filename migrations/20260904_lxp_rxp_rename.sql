-- ============================================================================
-- Ludo Base — LXP/RXP column rename (REQUIRED before deploying b44d1df+)
-- Run in Supabase Dashboard > SQL Editor BEFORE the renamed code goes live.
-- The code in b44d1df reads `lxp`/`rxp`; old code reads `xp`/`rating` —
-- so deploy order is: (1) run this, (2) deploy. Safe to re-run.
-- ============================================================================

ALTER TABLE public.players RENAME COLUMN xp TO lxp;
ALTER TABLE public.players RENAME COLUMN rating TO rxp;
