-- Self-reported guest balance at join so the host can badge low-balance seats.
ALTER TABLE public.lobby_join_requests
  ADD COLUMN IF NOT EXISTS coins BIGINT;
