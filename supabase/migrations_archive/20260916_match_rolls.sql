-- Server-side dice receipts. Edge Function is the only writer (service role).
-- Clients may SELECT for audit / spectator verification.
CREATE TABLE IF NOT EXISTS public.match_rolls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    action_id TEXT,
    result INT NOT NULL CHECK (result BETWEEN 1 AND 6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One face per (match, actionId) — blocks retry-until-six.
CREATE UNIQUE INDEX IF NOT EXISTS match_rolls_match_action_uidx
    ON public.match_rolls (match_id, action_id)
    WHERE action_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_match_rolls_match
    ON public.match_rolls (match_id, created_at DESC);

ALTER TABLE public.match_rolls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_rolls open read" ON public.match_rolls;
CREATE POLICY "match_rolls open read"
    ON public.match_rolls FOR SELECT USING (true);

-- No client INSERT/UPDATE/DELETE — Edge Function uses service role only.
