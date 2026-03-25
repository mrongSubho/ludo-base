-- consolidated spectator system migration

-- 1. Extend matches table
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS streaming_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_bet_volume BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spectator_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- 2. Live Matches table (Real-time discovery)
CREATE TABLE IF NOT EXISTS public.live_matches (
    room_code TEXT PRIMARY KEY,
    match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
    bet_window_status TEXT DEFAULT 'closed',
    window_opened_at TIMESTAMPTZ,
    window_closed_at TIMESTAMPTZ,
    current_bet_type TEXT,
    spectator_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_window_status CHECK (
        bet_window_status IN ('open', 'closed', 'resolving')
    )
);

-- 3. Spectator Bets table
CREATE TABLE IF NOT EXISTS public.spectator_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    bet_type TEXT NOT NULL,
    bet_value TEXT NOT NULL,
    amount BIGINT NOT NULL,
    odds NUMERIC(10, 2),
    potential_payout BIGINT,
    status TEXT DEFAULT 'pending',
    action_id TEXT,
    window_closed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,

    CONSTRAINT positive_bet_amount CHECK (amount > 0),
    CONSTRAINT valid_bet_status CHECK (status IN ('pending', 'won', 'lost', 'cancelled'))
);

-- 4. Enable RLS
ALTER TABLE public.spectator_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_matches ENABLE ROW LEVEL SECURITY;

-- 5. Policies
DROP POLICY IF EXISTS "Anyone can view bets" ON public.spectator_bets;
CREATE POLICY "Anyone can view bets" ON public.spectator_bets FOR SELECT USING (true);

DROP POLICY IF EXISTS "Players insert own bets" ON public.spectator_bets;
CREATE POLICY "Players insert own bets" ON public.spectator_bets FOR INSERT
  WITH CHECK (player_id = (auth.jwt() ->> 'sub')::text OR player_id = auth.uid()::text);

DROP POLICY IF EXISTS "No user updates on bets" ON public.spectator_bets;
CREATE POLICY "No user updates on bets" ON public.spectator_bets FOR UPDATE USING (false);

DROP POLICY IF EXISTS "Anyone can view live matches" ON public.live_matches;
CREATE POLICY "Anyone can view live matches" ON public.live_matches FOR SELECT USING (true);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_bets_match_pending ON public.spectator_bets(match_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bets_player ON public.spectator_bets(player_id);
CREATE INDEX IF NOT EXISTS idx_bets_window ON public.spectator_bets(window_closed_at, created_at);
