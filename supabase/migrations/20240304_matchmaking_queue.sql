-- Phase 1: Matchmaking Table and Atomic RPC

-- 1. Create the matchmaking_queue table
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL,
    game_mode TEXT NOT NULL, -- 'classic', 'power'
    match_type TEXT NOT NULL, -- '1v1', '2v2', '4P'
    wager NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'searching', -- 'searching', 'matched', 'cancelled'
    match_id UUID, -- populated when matched
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_status CHECK (status IN ('searching', 'matched', 'cancelled'))
);

-- Index for fast searching
CREATE INDEX IF NOT EXISTS idx_matchmaking_search 
ON public.matchmaking_queue (game_mode, match_type, wager, status) 
WHERE status = 'searching';

-- 2. Atomic Matchmaking RPC
-- This function uses advisory locks to ensure no two players "claim" the same opponent.
CREATE OR REPLACE FUNCTION public.join_matchmaking(
    p_player_id TEXT,
    p_game_mode TEXT,
    p_match_type TEXT,
    p_wager NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_match_id UUID;
    v_opponent_id UUID;
    v_ticket_id UUID;
    v_lock_key BIGINT;
BEGIN
    -- Generate a unique lock key based on the parameters to prevent concurrent claims for the same bucket
    -- Using a hash of the criteria
    v_lock_key := ('x' || substr(md5(p_game_mode || p_match_type || p_wager::text), 1, 15))::bit(60)::bigint;

    -- Try to get an advisory lock. If it fails, another process is matching in this bucket.
    IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
        -- If we can't get the lock, we just wait a tiny bit or create a ticket
        -- For simplicity, let's just create a ticket if we can't lock immediately
        INSERT INTO public.matchmaking_queue (player_id, game_mode, match_type, wager, expires_at)
        VALUES (p_player_id, p_game_mode, p_match_type, p_wager, NOW() + INTERVAL '60 seconds')
        RETURNING id INTO v_ticket_id;
        
        RETURN jsonb_build_object('status', 'searching', 'ticket_id', v_ticket_id);
    END IF;

    -- 1. Search for an available opponent
    SELECT id INTO v_opponent_id
    FROM public.matchmaking_queue
    WHERE game_mode = p_game_mode
      AND match_type = p_match_type
      AND wager = p_wager
      AND status = 'searching'
      AND player_id != p_player_id
      AND expires_at > NOW()
    LIMIT 1
    FOR UPDATE SKIP LOCKED; -- Lock the opponent row

    IF v_opponent_id IS NOT NULL THEN
        -- Match Found!
        v_match_id := gen_random_uuid();
        
        -- Update opponent
        UPDATE public.matchmaking_queue
        SET status = 'matched', match_id = v_match_id
        WHERE id = v_opponent_id;
        
        -- Create record for self (already matched)
        INSERT INTO public.matchmaking_queue (player_id, game_mode, match_type, wager, status, match_id, expires_at)
        VALUES (p_player_id, p_game_mode, p_match_type, p_wager, 'matched', v_match_id, NOW() + INTERVAL '60 seconds')
        RETURNING id INTO v_ticket_id;

        RETURN jsonb_build_object('status', 'matched', 'match_id', v_match_id, 'ticket_id', v_ticket_id);
    ELSE
        -- No match found, create a searching ticket
        INSERT INTO public.matchmaking_queue (player_id, game_mode, match_type, wager, expires_at)
        VALUES (p_player_id, p_game_mode, p_match_type, p_wager, NOW() + INTERVAL '60 seconds')
        RETURNING id INTO v_ticket_id;
        
        RETURN jsonb_build_object('status', 'searching', 'ticket_id', v_ticket_id);
    END IF;
END;
$$ LANGUAGE plpgsql;
