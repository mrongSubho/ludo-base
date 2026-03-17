-- 2. Atomic Matchmaking RPC (Improved with Waiting Lock)
-- This version replaces pg_try_advisory_xact_lock with pg_advisory_xact_lock to ensure
-- that simultaneous joiners don't skip each other.

CREATE OR REPLACE FUNCTION public.join_matchmaking(
    p_player_id TEXT,
    p_game_mode TEXT,
    p_match_type TEXT,
    p_wager NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_match_id UUID;
    v_opponent_id UUID;
    v_opponent_ticket_id UUID;
    v_ticket_id UUID;
    v_lock_key BIGINT;
BEGIN
    -- 1. Generate a unique lock key based on the parameters
    -- Using a hash of the criteria ensures we only bottleneck exactly matching buckets
    v_lock_key := ('x' || substr(md5(p_game_mode || p_match_type || p_wager::text), 1, 15))::bit(60)::bigint;

    -- 2. Wait for the lock. 
    -- This is crucial: it prevents the race where Player B fails to find Player A 
    -- because A is still in the middle of their RPC transaction.
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- 3. Search for an available opponent who is ALREADY in the queue
    SELECT id, player_id INTO v_opponent_ticket_id, v_opponent_id
    FROM public.matchmaking_queue
    WHERE game_mode = p_game_mode
      AND match_type = p_match_type
      AND wager = p_wager
      AND status = 'searching'
      AND player_id != p_player_id  -- Ensure we don't match our own stale tickets
      AND expires_at > NOW()
    ORDER BY created_at ASC -- Fairness: longest waiting player first
    LIMIT 1
    FOR UPDATE SKIP LOCKED; -- Strongly lock the selected row to prevent double-matching

    IF v_opponent_ticket_id IS NOT NULL THEN
        -- Match Found!
        v_match_id := gen_random_uuid();
        
        -- Update opponent's ticket to 'matched'
        UPDATE public.matchmaking_queue
        SET status = 'matched', match_id = v_match_id
        WHERE id = v_opponent_ticket_id;
        
        -- Create record for self (already matched)
        INSERT INTO public.matchmaking_queue (player_id, game_mode, match_type, wager, status, match_id, expires_at)
        VALUES (p_player_id, p_game_mode, p_match_type, p_wager, 'matched', v_match_id, NOW() + INTERVAL '60 seconds')
        RETURNING id INTO v_ticket_id;

        -- Return match details and the opponent's ID (useful for game setup)
        RETURN jsonb_build_object(
            'status', 'matched', 
            'match_id', v_match_id, 
            'ticket_id', v_ticket_id,
            'opponent_id', v_opponent_id
        );
    ELSE
        -- No match found, create a searching ticket and wait for someone else to find US
        -- Note: We check for existing active 'searching' tickets for THIS player first to prevent duplicates
        -- but for simplicity in this RPC we just treat every request as an intent to search.
        -- Frontend should manage the ticket life-cycle.
        
        INSERT INTO public.matchmaking_queue (player_id, game_mode, match_type, wager, expires_at)
        VALUES (p_player_id, p_game_mode, p_match_type, p_wager, NOW() + INTERVAL '60 seconds')
        RETURNING id INTO v_ticket_id;
        
        RETURN jsonb_build_object('status', 'searching', 'ticket_id', v_ticket_id);
    END IF;
END;
$$ LANGUAGE plpgsql;
