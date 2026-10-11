-- ARCHIVED — frozen history, never applied by any chain. Canonical schema lives in supabase/migrations/; new SQL goes there only.

ALTER TABLE public.live_matches
  ADD COLUMN IF NOT EXISTS arena_key TEXT,
  ADD COLUMN IF NOT EXISTS authority_id TEXT,
  ADD COLUMN IF NOT EXISTS authority_heartbeat TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS live_matches_arena_key_uidx
  ON public.live_matches(arena_key) WHERE arena_key IS NOT NULL;