-- ============================================================================
-- Ludo Base — Matchmaking Phase 1 (finding)
-- Run in Supabase Dashboard > SQL Editor. Section A is REQUIRED.
-- Sections B–D are optional / conditional — read the headers.
-- ============================================================================

-- ── A. REQUIRED: realtime publication for match detection ───────────────────
-- Without this, the host is never pushed its 'matched' ticket update and
-- waits forever. Verified missing live via raw-WS event test (Phase 0).
ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;

-- ── B. REQUIRED HYGIENE: remove the Phase-0 diagnostic ghost ticket ─────────
-- Inert cancelled test ticket (absurd wager, matches nobody). Safe to delete.
DELETE FROM public.matchmaking_queue WHERE id = 'd9beb8ea-a2ff-4fbe-86d3-4875bf525185';

-- ── C. OPTIONAL: schedule the cleanup functions (needs pg_cron) ─────────────
-- 1. Dashboard > Database > Extensions > enable pg_cron (one click).
-- 2. Uncomment + run the two lines below. They delete stale tickets/rows
--    every 5 minutes so ghosts can never pile up again.
-- SELECT cron.schedule('cleanup-matchmaking-5m', '*/5 * * * *', $$SELECT public.cleanup_matchmaking_queue()$$);
-- SELECT cron.schedule('cleanup-stale-5m', '*/5 * * * *', $$SELECT public.cleanup_stale_data()$$);

-- ── D. OPTIONAL, VERIFY FIRST: symmetric wager-range matching (RPC v2) ──────
-- Problem: the queue stores a single absolute `wager` per ticket, so two
-- waiters with overlapping-but-different ranges can never pair, and expanded
-- tickets are deprioritized by ORDER BY (wager = p_wager) DESC.
--
-- DO NOT run a blind CREATE OR REPLACE. The live function already differs
-- from supabase/schema_list.md Phase 2 (e.g. live returns search_timeout 10,
-- and live HAS validation_token which the doc lacks). First dump the live
-- definition and port ONLY the predicate/ordering change into it:
--
--   SELECT pg_get_functiondef('public.join_matchmaking'::regproc);
--
-- Change shopping list for the live definition:
--   1. ALTER TABLE public.matchmaking_queue
--        ADD COLUMN IF NOT EXISTS wager_min NUMERIC,
--        ADD COLUMN IF NOT EXISTS wager_max NUMERIC;
--   2. Accept p_wager_min / p_wager_max (already sent by the client) and
--      persist them on the ticket row at creation.
--   3. Replace the opponent predicate with true overlap logic, treating a
--      NULL bound as unbounded on either side:
--
--      WHERE status = 'searching'
--        AND player_id != p_player_id
--        AND game_mode = p_game_mode
--        AND match_type = p_match_type
--        AND (COALESCE(p_wager_min, waiter.wager, 0) <= COALESCE(waiter.wager_max, waiter.wager))
--        AND (COALESCE(waiter.wager_min, waiter.wager, 0) <= COALESCE(p_wager_max, p_wager))
--
--      (Here waiter.* are the stored ticket's columns; fall back to the
--      absolute wager when bounds are NULL so old tickets keep working.)
--   4. Replace ORDER BY (wager = p_wager) DESC, created_at ASC
--      with ORDER BY created_at ASC (neutral FIFO — no starvation).
