-- ============================================================================
-- Ludo Base — Hybrid party fill (Fill Remaining with Quick Match)
-- Run in Supabase Dashboard > SQL Editor.
--
-- SAFE: creates ONE new function + touches nothing existing. The base
-- join_matchmaking flow is byte-for-byte unaffected.
--
-- Design: the host advertises a party ticket carrying its room_code (it stays
-- `searching` across fills — one guest per call). Public-pool guests prefer
-- party tickets and land directly in the host's room (role: guest), then
-- joinGame + seat via the normal SYNC_PROFILE path. With no parties around,
-- guests fall back to regular public matching.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.join_matchmaking_hybrid(
    p_player_id TEXT,
    p_game_mode TEXT,
    p_match_type TEXT,
    p_wager NUMERIC DEFAULT 0,
    p_wager_min NUMERIC DEFAULT NULL,
    p_wager_max NUMERIC DEFAULT NULL,
    p_room_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ticket_id UUID;
    v_match_id UUID;
    v_opponent_id TEXT;
    v_opponent_ticket_id UUID;
    v_room TEXT;
    v_host_wager NUMERIC;
    v_lock_key BIGINT;
    v_result JSONB;
BEGIN
    -- Same lock domain as the base join: serializes against public matching.
    v_lock_key := hashtext(p_game_mode || p_match_type)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    DELETE FROM public.matchmaking_queue WHERE expires_at < now();

    -- ── HOST path: advertise (or refresh) the party ticket, hunt one guest ──
    IF p_room_code IS NOT NULL THEN
        SELECT id INTO v_ticket_id
        FROM public.matchmaking_queue
        WHERE player_id = p_player_id AND status = 'searching'
        LIMIT 1;

        IF v_ticket_id IS NULL THEN
            INSERT INTO public.matchmaking_queue
                (player_id, game_mode, match_type, wager, room_code, expires_at)
            VALUES
                (p_player_id, p_game_mode, p_match_type, p_wager, p_room_code, now() + interval '30 seconds')
            RETURNING id INTO v_ticket_id;
        ELSE
            UPDATE public.matchmaking_queue
            SET expires_at = now() + interval '30 seconds',
                room_code = p_room_code
            WHERE id = v_ticket_id;
        END IF;

        -- Hunt ONE regular waiter (no room of their own): oldest first,
        -- within the host's bounds (NULL bound = accept anyone).
        SELECT id, player_id INTO v_opponent_ticket_id, v_opponent_id
        FROM public.matchmaking_queue
        WHERE status = 'searching'
          AND player_id != p_player_id
          AND game_mode = p_game_mode
          AND match_type = p_match_type
          AND room_code IS NULL
          AND (p_wager_min IS NULL OR wager >= p_wager_min)
          AND (p_wager_max IS NULL OR wager <= p_wager_max)
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_opponent_ticket_id IS NOT NULL THEN
            INSERT INTO public.matches (game_mode, participants, room_code)
            VALUES (p_game_mode, ARRAY[p_player_id, v_opponent_id], p_room_code)
            RETURNING id INTO v_match_id;

            UPDATE public.matchmaking_queue
            SET status = 'matched', match_id = v_match_id, room_code = p_room_code
            WHERE id = v_opponent_ticket_id;
            -- NOTE: the host ticket deliberately STAYS searching so the next
            -- heartbeat can fill the next seat.
        END IF;

        v_result := jsonb_build_object(
            'status', 'searching',
            'ticket_id', v_ticket_id,
            'search_timeout', 30,
            'room_code', p_room_code
        );
        RETURN v_result;
    END IF;

    -- ── GUEST path: prefer party tickets, else regular pool ──
    -- A party matches when the guest's bounds contain the host's wager
    -- (NULL bound = unbounded). Oldest party first.
    SELECT q.id, q.player_id, q.room_code, q.wager
    INTO v_opponent_ticket_id, v_opponent_id, v_room, v_host_wager
    FROM public.matchmaking_queue q
    WHERE q.status = 'searching'
      AND q.player_id != p_player_id
      AND q.game_mode = p_game_mode
      AND q.match_type = p_match_type
      AND q.room_code IS NOT NULL
      AND (p_wager_min IS NULL OR q.wager >= p_wager_min)
      AND (p_wager_max IS NULL OR q.wager <= p_wager_max)
    ORDER BY q.created_at ASC
    LIMIT 1;

    IF v_opponent_ticket_id IS NOT NULL THEN
        INSERT INTO public.matches (game_mode, participants, room_code)
        VALUES (p_game_mode, ARRAY[p_player_id, v_opponent_id], v_room)
        RETURNING id INTO v_match_id;

        -- Guest gets their own matched ticket (normal client detection path).
        -- The host ticket is deliberately UNTOUCHED: it stays searching so
        -- the next heartbeat can fill the next seat.
        INSERT INTO public.matchmaking_queue
            (player_id, game_mode, match_type, wager, status, match_id, room_code, expires_at)
        VALUES
            (p_player_id, p_game_mode, p_match_type, p_wager, 'matched', v_match_id, v_room, now() + interval '30 seconds')
        RETURNING id INTO v_ticket_id;

        RETURN jsonb_build_object(
            'status', 'matched',
            'match_id', v_match_id,
            'room_code', v_room,
            'role', 'guest'
        );
    END IF;

    -- No parties around: regular public matching via the base function.
    SELECT public.join_matchmaking(
        p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max
    ) INTO v_result;
    RETURN v_result;
END;
$$;

-- ── OPTIONAL, VERIFY FIRST: keep the base pool from eating party tickets ────
-- A base join_matchmaking call can pair a host's advertised party ticket as a
-- regular opponent (it doesn't know about room_code). Rare (needs exact
-- mode/type/wager overlap with another searcher), self-healing (host
-- heartbeat re-advertises; client swallows its own match events while
-- hybrid-hosting) — but if you want it airtight, port this predicate into
-- your LIVE base definition (dump it first, do NOT blindly rewrite):
--
--   SELECT pg_get_functiondef('public.join_matchmaking'::regproc);
--
-- In the live opponent scan, add one line:
--      AND room_code IS NULL
-- (All current searching rows have NULL room_code, so this changes nothing
-- for existing flows — it only fences off future party tickets.)
