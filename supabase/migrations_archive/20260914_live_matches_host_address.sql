-- ARCHIVED — frozen history, never applied by any chain. Canonical schema lives in supabase/migrations/; new SQL goes there only.

-- Host-address binding for signed bet settlement.
-- resolve-bet only accepts a result signed by this wallet.
ALTER TABLE public.live_matches
  ADD COLUMN IF NOT EXISTS host_address TEXT;

CREATE INDEX IF NOT EXISTS idx_live_matches_host
  ON public.live_matches(host_address)
  WHERE host_address IS NOT NULL;