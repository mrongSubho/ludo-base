-- ARCHIVED — frozen history, never applied by any chain. Canonical schema lives in supabase/migrations/; new SQL goes there only.

-- Stamp invite rows with the host join secret so InviteNotification accept
-- can pass it to joinGame. Nullable for legacy invites.
ALTER TABLE public.game_invites
  ADD COLUMN IF NOT EXISTS validation_token TEXT;