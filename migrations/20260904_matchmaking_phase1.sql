-- ============================================================================
-- Ludo Base — Matchmaking Phase 1 SQL (CORRECTED 2026-09-04)
-- Run in Supabase Dashboard > SQL Editor, top to bottom. Safe to re-run.
--
-- Correction history: the publication ADD was verified live to be unnecessary
-- (error 42710 "already member"). Event delivery for matchmaking_queue was
-- then proven end-to-end with a raw-WS test (INSERT + UPDATE events arrive).
-- ============================================================================

-- ── 0. VERIFY (read-only): publication membership ───────────────────────────
-- Expect a row for matchmaking_queue. If missing, run section A.
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('matchmaking_queue', 'messages', 'conversations', 'game_invites');

-- ── 0b. VERIFY (read-only): current queue state ─────────────────────────────
SELECT status, count(*), max(created_at) AS newest
FROM public.matchmaking_queue
GROUP BY status;

-- ── A. PUBLICATION (fresh setups only — SKIP if section 0 shows the row) ────
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;

-- ── B. GHOST CLEANUP (safe, qualified) ──────────────────────────────────────
-- Cancelled rows are dead by definition. Searching rows expired over an hour
-- ago cannot be live (client ticket TTL is ~30s with heartbeat refresh).
DELETE FROM public.matchmaking_queue WHERE status = 'cancelled';
DELETE FROM public.matchmaking_queue
WHERE status = 'searching' AND expires_at < NOW() - INTERVAL '1 hour';

-- ── C. OPTIONAL: schedule the cleanup functions (needs pg_cron) ─────────────
-- 1. Dashboard > Database > Extensions > enable pg_cron (one click).
-- 2. Uncomment + run the two lines below. They sweep stale tickets/rows
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
