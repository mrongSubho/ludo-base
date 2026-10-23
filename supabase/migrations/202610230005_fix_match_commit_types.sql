-- ============================================================================
-- Migration: 202610230005_fix_match_commit_types.sql
-- Description: Fix match_commit_action so it can actually write match_states.
-- Scope: hotfix for the last link in the server-owned lobby chain
-- ============================================================================
--
-- Two defects, both present since 202610180004 (which is why `match_states` has
-- never contained a row):
--
-- 1. TYPE MISMATCH. `match_states.match_id` is `text` (baseline line 300) while
--    this RPC takes `p_match_id uuid`. `WHERE match_id = p_match_id` is therefore
--    `text = uuid`, and Postgres has no such operator:
--
--      {"code":"42883","message":"operator does not exist: text = uuid"}
--
--    Every call failed, and MatchRoom's commitToPostgres catches its own error
--    and only warns — so the room believed it had persisted. Note the asymmetry:
--    `match_room_events.match_id` IS uuid (it references matches.id), so only the
--    match_states comparisons need the cast.
--
-- 2. MISSING NOT-NULL COLUMNS. The S0 seed INSERT supplied
--    (match_id, seq, state, updated_at), but `match_states` also declares
--    `room_code text not null` and `host_address text not null` with no defaults.
--    Even with the type fixed the insert would fail with a NOT NULL violation.
--    Both are now derived from `matches` / `match_seats`.
--
-- Verified live before writing this: a direct RPC call returned 42883, and
-- `match_states` stayed empty while `match_seats` was written correctly.

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
BEGIN
    -- match_states.match_id is TEXT; p_match_id is UUID. Cast explicitly —
    -- see the header note. This comparison is why nothing ever persisted.
    SELECT seq, state INTO v_cur_seq, v_cur_state
    FROM public.match_states
    WHERE match_id = p_match_id::text
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Allow an initial seed (p_expected_seq <= 0) when no row exists yet.
        IF p_expected_seq <= 0 THEN
            -- room_code / host_address are NOT NULL with no default.
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

            -- match_room_events.match_id IS uuid — no cast here.
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

    RETURN jsonb_build_object(
        'ok', true,
        'seq', v_next_seq,
        'state', p_new_state
    );
END;
$$;

-- DROP removed the grants issued on the previous definition.
REVOKE EXECUTE ON FUNCTION public.match_commit_action(uuid, integer, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_commit_action(uuid, integer, jsonb, text, jsonb) TO service_role;

COMMIT;
