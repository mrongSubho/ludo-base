-- Tournament System Schema

-- 1. Tables
CREATE TABLE IF NOT EXISTS public.tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    entry_fee BIGINT NOT NULL DEFAULT 0,
    prize_pool BIGINT NOT NULL DEFAULT 0,
    min_players INT NOT NULL DEFAULT 4,
    max_players INT NOT NULL DEFAULT 64,
    status TEXT NOT NULL DEFAULT 'upcoming', -- 'upcoming', 'active', 'completed', 'cancelled'
    start_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_tournament_status CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS public.tournament_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    seed INT,
    final_rank INT,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tournament_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.tournament_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
    round_number INT NOT NULL,
    bracket_row INT NOT NULL,
    bracket_col INT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'active', 'completed'
    winner_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX idx_tournaments_status ON public.tournaments(status, start_at);
CREATE INDEX idx_tournament_participants_player ON public.tournament_participants(player_id);
CREATE INDEX idx_tournament_matches_bracket ON public.tournament_matches(tournament_id, round_number);

-- 3. RLS Policies
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view tournaments" ON public.tournaments FOR SELECT USING (true);
CREATE POLICY "Anyone can view tournament participants" ON public.tournament_participants FOR SELECT USING (true);
CREATE POLICY "Anyone can view tournament matches" ON public.tournament_matches FOR SELECT USING (true);

-- 4. RPC: Join Tournament
CREATE OR REPLACE FUNCTION public.join_tournament(
    p_tournament_id UUID,
    p_player_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry_fee BIGINT;
    v_player_coins BIGINT;
    v_participant_count INT;
    v_max_players INT;
    v_status TEXT;
BEGIN
    -- 1. Get tournament details
    SELECT entry_fee, max_players, status INTO v_entry_fee, v_max_players, v_status
    FROM public.tournaments
    WHERE id = p_tournament_id;

    IF v_status != 'upcoming' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tournament is not accepting participants');
    END IF;

    -- 2. Check player balance
    SELECT coins INTO v_player_coins
    FROM public.players
    WHERE wallet_address = p_player_id;

    IF v_player_coins < v_entry_fee THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient coins');
    END IF;

    -- 3. Check capacity
    SELECT count(*) INTO v_participant_count
    FROM public.tournament_participants
    WHERE tournament_id = p_tournament_id;

    IF v_participant_count >= v_max_players THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tournament is full');
    END IF;

    -- 4. Deduct coins and add participant
    UPDATE public.players
    SET coins = coins - v_entry_fee
    WHERE wallet_address = p_player_id;

    INSERT INTO public.tournament_participants (tournament_id, player_id)
    VALUES (p_tournament_id, p_player_id);

    RETURN jsonb_build_object('success', true);
END;
$$;
