-- ============================================================================
-- Migration: 202611260001_commit_roll_receipt.sql
-- Description: Restore atomic provably-fair match_rolls receipts inside
--              match_commit_action after P6 retired the roll-dice Edge function.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_commit_action(
    p_match_id uuid,
    p_expected_seq integer,
    p_new_state jsonb,
    p_event_type text DEFAULT 'move_committed',
    p_event_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cur_seq integer;
    v_cur_state jsonb;
    v_next_seq integer;
    v_room_code text;
    v_host text;
    v_roll_val integer;
    v_seat_color text;
    v_roll_wallet text;
BEGIN
    SELECT seq, state, host_address INTO v_cur_seq, v_cur_state, v_host
    FROM public.match_states
    WHERE match_id = p_match_id::text
    FOR UPDATE;

    IF NOT FOUND THEN
        IF p_expected_seq <= 0 THEN
            SELECT m.room_code,
                   COALESCE(
                       (SELECT s.wallet_address FROM public.match_seats s
                        WHERE s.match_id = p_match_id AND s.seat_index = 0),
                       m.participants[1]
                   )
            INTO v_room_code, v_host
            FROM public.matches m
            WHERE m.id = p_match_id;

            IF v_room_code IS NULL OR v_host IS NULL THEN
                RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
            END IF;

            INSERT INTO public.match_states (
                match_id, room_code, host_address, seq, state,
                color_corner, player_seats, updated_at
            )
            VALUES (
                p_match_id::text,
                v_room_code,
                v_host,
                0,
                p_new_state,
                COALESCE(p_new_state->'initialBoardConfig'->'colorCorner', '{}'::jsonb),
                COALESCE(p_new_state->'initialBoardConfig'->'players', '[]'::jsonb),
                now()
            )
            ON CONFLICT (match_id) DO UPDATE
            SET state = EXCLUDED.state, updated_at = now()
            WHERE public.match_states.seq = 0;

            INSERT INTO public.match_room_events (match_id, event_type, seq, payload)
            VALUES (p_match_id, p_event_type, 0, p_event_payload);

            RETURN jsonb_build_object(
                'ok', true,
                'seq', 0,
                'state', p_new_state
            );
        ELSE
            RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
        END IF;
    END IF;

    IF v_cur_seq <> p_expected_seq THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'STALE_SEQ',
            'current_seq', v_cur_seq,
            'state', v_cur_state
        );
    END IF;

    v_next_seq := v_cur_seq + 1;

    UPDATE public.match_states
    SET
        state = p_new_state,
        seq = v_next_seq,
        updated_at = now()
    WHERE match_id = p_match_id::text;

    INSERT INTO public.match_room_events (match_id, event_type, seq, payload)
    VALUES (p_match_id, p_event_type, v_next_seq, p_event_payload);

    IF p_event_payload IS NOT NULL AND p_event_payload ? 'rollValue' THEN
        BEGIN
            v_roll_val := (p_event_payload->>'rollValue')::integer;
        EXCEPTION WHEN OTHERS THEN
            v_roll_val := NULL;
        END;
        v_seat_color := p_event_payload->>'seatColor';

        IF v_roll_val IS NOT NULL
           AND v_roll_val BETWEEN 1 AND 6
           AND v_seat_color IN ('green', 'red', 'yellow', 'blue') THEN
            v_roll_wallet := lower(NULLIF(trim(COALESCE(p_event_payload->>'walletAddress', '')), ''));
            IF v_roll_wallet IS NULL OR NOT EXISTS (
                SELECT 1 FROM public.players WHERE wallet_address = v_roll_wallet
            ) THEN
                v_roll_wallet := v_host;
            END IF;

            IF v_roll_wallet IS NOT NULL THEN
                INSERT INTO public.match_rolls (
                    match_id,
                    wallet_address,
                    seat_color,
                    turn_seq,
                    result,
                    status,
                    consumed_seq
                )
                VALUES (
                    p_match_id::text,
                    v_roll_wallet,
                    v_seat_color,
                    v_next_seq,
                    v_roll_val,
                    CASE WHEN p_event_type = 'roll_minted' THEN 'available' ELSE 'consumed' END,
                    CASE WHEN p_event_type = 'roll_minted' THEN NULL ELSE v_next_seq END
                )
                ON CONFLICT (match_id, turn_seq) WHERE turn_seq IS NOT NULL DO NOTHING;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'seq', v_next_seq,
        'state', p_new_state
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_commit_action(uuid, integer, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_commit_action(uuid, integer, jsonb, text, jsonb) TO service_role;

COMMIT;
