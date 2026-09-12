-- Manual / NAT-hostile join path: guest inserts a request; host polls or realtime-reads.
CREATE TABLE IF NOT EXISTS public.lobby_join_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    username TEXT,
    avatar_url TEXT,
    desired_seat INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lobby_join_requests_room
    ON public.lobby_join_requests (room_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lobby_join_requests_wallet
    ON public.lobby_join_requests (wallet_address);

ALTER TABLE public.lobby_join_requests ENABLE ROW LEVEL SECURITY;

-- Anon may insert (guest without service key). Reads are service-role / host via API.
DROP POLICY IF EXISTS "lobby_join_requests insert" ON public.lobby_join_requests;
CREATE POLICY "lobby_join_requests insert"
    ON public.lobby_join_requests FOR INSERT
    WITH CHECK (char_length(room_code) BETWEEN 3 AND 32 AND char_length(wallet_address) BETWEEN 3 AND 64);

DROP POLICY IF EXISTS "lobby_join_requests read" ON public.lobby_join_requests;
CREATE POLICY "lobby_join_requests read"
    ON public.lobby_join_requests FOR SELECT USING (true);

-- Hash of the host room secret (sha256 hex). Null = open join.
ALTER TABLE public.live_matches
  ADD COLUMN IF NOT EXISTS join_secret_hash TEXT;
