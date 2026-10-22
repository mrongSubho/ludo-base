BEGIN;

-- Unblock persistence (S0): allow match_commit_action to insert initial seed state when match_states row does not exist yet
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
BEGIN
    SELECT seq, state INTO v_cur_seq, v_cur_state
    FROM public.match_states
    WHERE match_id = p_match_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- S0: Allow initial state seed (p_expected_seq <= 0) when row does not exist yet
        IF p_expected_seq <= 0 THEN
            INSERT INTO public.match_states (match_id, seq, state, updated_at)
            VALUES (p_match_id, 0, p_new_state, now())
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
    WHERE match_id = p_match_id;

    INSERT INTO public.match_room_events (match_id, event_type, seq, payload)
    VALUES (p_match_id, p_event_type, v_next_seq, p_event_payload);

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
