-- A wallet authorization created before a match id exists. It is bound to
-- match_sessions only after matchmaking or Team Up creates the final match.
CREATE TABLE IF NOT EXISTS public.provisional_match_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    authorization_key TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    room_code TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provisional_match_sessions_wallet
    ON public.provisional_match_sessions (wallet_address, expires_at);

ALTER TABLE public.provisional_match_sessions ENABLE ROW LEVEL SECURITY;
