-- Bet cash-out: 50% of potential payout while the window is still open.
-- Apply manually via the Supabase SQL Editor (per repo convention).
-- Safety: only pending own bets, window must still be open. The settle RPC
-- only resolves 'pending' rows, so cashed-out bets can never double-pay.

CREATE OR REPLACE FUNCTION public.cash_out_bet(
    p_bet_id UUID,
    p_player_id TEXT
)
RETURNS TABLE (
    credited BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_payout BIGINT := 0;
    v_mid UUID;
    v_window TIMESTAMPTZ;
BEGIN
    SELECT potential_payout, match_id INTO v_payout, v_mid
    FROM public.spectator_bets
    WHERE id = p_bet_id
      AND player_id = p_player_id
      AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bet not available for cash-out';
    END IF;

    SELECT window_closed_at INTO v_window
    FROM public.live_matches
    WHERE match_id = v_mid;

    IF v_window IS NULL OR v_window <= NOW() THEN
        RAISE EXCEPTION 'Betting window locked';
    END IF;

    v_payout := FLOOR(COALESCE(v_payout, 0) * 0.5);

    UPDATE public.spectator_bets
    SET status = 'cashed_out', resolved_at = NOW()
    WHERE id = p_bet_id;

    UPDATE public.players
    SET coins = coins + v_payout
    WHERE wallet_address = p_player_id;

    RETURN QUERY SELECT v_payout;
END;
$$;
