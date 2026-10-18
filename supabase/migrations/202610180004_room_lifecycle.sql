BEGIN;

-- 1. Table for room lifecycle event audit log
CREATE TABLE IF NOT EXISTS public.match_room_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    seq integer,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS match_room_events_match_id_idx ON public.match_room_events(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS match_room_events_seq_idx ON public.match_room_events(match_id, seq);

ALTER TABLE public.match_room_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_room_events open read" ON public.match_room_events;
CREATE POLICY "match_room_events open read"
    ON public.match_room_events FOR SELECT USING (true);

-- 2. Atomic action commit RPC (P15/G7, Rev 3 F3)
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
        RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
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

-- 3. Retention RPC: cleanup_match_room_events
CREATE OR REPLACE FUNCTION public.cleanup_match_room_events(p_keep_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted integer;
BEGIN
    DELETE FROM public.match_room_events
    WHERE created_at < (now() - (p_keep_days || ' days')::interval);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_match_room_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_match_room_events(integer) TO service_role;

COMMIT;
