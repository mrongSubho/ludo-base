-- ARCHIVED — frozen history, never applied by any chain. Canonical schema lives in supabase/migrations/; new SQL goes there only.

-- Self-reported guest balance at join so the host can badge low-balance seats.
ALTER TABLE public.lobby_join_requests
  ADD COLUMN IF NOT EXISTS coins BIGINT;