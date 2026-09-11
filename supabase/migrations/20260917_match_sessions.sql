-- Match-scoped session keys (EIP-712). One wallet sign per match.
CREATE TABLE IF NOT EXISTS public.match_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    room_code TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS match_sessions_active_uidx
    ON public.match_sessions (match_id, wallet_address)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_match_sessions_exp
    ON public.match_sessions (expires_at);

ALTER TABLE public.match_sessions ENABLE ROW LEVEL SECURITY;
-- No client RLS — service role only (Edge).

-- App-wide SIWE sessions for chat / profile / settings (not match moves).
CREATE TABLE IF NOT EXISTS public.app_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL,
    nonce TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_sessions_wallet_active_uidx
    ON public.app_sessions (wallet_address)
    WHERE revoked_at IS NULL;

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
