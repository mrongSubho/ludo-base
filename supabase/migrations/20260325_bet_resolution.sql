-- Atomic Bet Resolution & Payouts

CREATE OR REPLACE FUNCTION public.settle_match_bets(
    p_match_id UUID,
    p_result TEXT,
    p_bet_type TEXT
)
RETURNS TABLE (
    payout_count INT,
    total_payout BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated permissions to update player coins
AS $$
DECLARE
    v_payout_count INT := 0;
    v_total_payout BIGINT := 0;
    v_window_closed TIMESTAMPTZ;
BEGIN
    -- 0. Security Check: Has the betting window actually closed?
    SELECT window_closed_at INTO v_window_closed
    FROM public.live_matches
    WHERE match_id = p_match_id;

    IF v_window_closed IS NULL OR v_window_closed > NOW() THEN
        RAISE EXCEPTION 'Betting window still open or match not found';
    END IF;

    -- 1. Mark winners and update their coins
    WITH winners AS (
        UPDATE public.spectator_bets
        SET status = 'won',
            resolved_at = NOW()
        WHERE match_id = p_match_id
          AND status = 'pending'
          AND bet_type = p_bet_type
          AND bet_value = p_result
        RETURNING player_id, potential_payout
    ),
    coin_updates AS (
        UPDATE public.players p
        SET coins = p.coins + w.potential_payout
        FROM winners w
        WHERE p.wallet_address = w.player_id
        RETURNING w.potential_payout
    )
    SELECT count(*), COALESCE(sum(potential_payout), 0)
    INTO v_payout_count, v_total_payout
    FROM winners;

    -- 2. Mark losers
    UPDATE public.spectator_bets
    SET status = 'lost',
        resolved_at = NOW()
    WHERE match_id = p_match_id
      AND status = 'pending'
      AND bet_type = p_bet_type
      AND bet_value != p_result;

    RETURN QUERY SELECT v_payout_count, v_total_payout;
END;
$$;
