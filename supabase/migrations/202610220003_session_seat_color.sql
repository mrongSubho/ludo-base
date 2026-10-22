-- ============================================================================
-- Migration: 202610220003_session_seat_color.sql
-- Description: Add seat_color to sessions table for seat-bound sessions
-- Scope: Server-Owned Lobby Phase S2 (closes SA-3)
-- ============================================================================

BEGIN;

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS seat_color text CHECK (seat_color IS NULL OR seat_color IN ('green', 'red', 'yellow', 'blue'));

COMMIT;
