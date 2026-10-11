-- ARCHIVED — frozen history, never applied by any chain. Canonical schema lives in supabase/migrations/; new SQL goes there only.

-- Carry the host join secret on REST join requests so seatGuestPlayer can
-- enforce matchmaking tokens when PeerJS/realtime JOIN_REQUEST is unavailable.
ALTER TABLE public.lobby_join_requests
  ADD COLUMN IF NOT EXISTS validation_token TEXT;