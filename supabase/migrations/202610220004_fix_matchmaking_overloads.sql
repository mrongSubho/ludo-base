-- ============================================================================
-- Migration: 202610220004_fix_matchmaking_overloads.sql
-- Description: Remove the accidental `integer` overloads of join_matchmaking and
--              join_matchmaking_hybrid and restore the canonical `numeric` ones.
-- Scope: hotfix for a live HTTP 500 on POST /api/matchmaking/join
-- ============================================================================
--
-- Root cause. The baseline declares
--     public.join_matchmaking(text, text, text, numeric, numeric, numeric)
-- and 202610220002 re-declared it with `integer` wagers. In Postgres,
-- CREATE OR REPLACE FUNCTION with a DIFFERENT argument list creates an OVERLOAD,
-- it does not replace. So the database held both, and PostgREST refused to pick:
--
--   Could not choose the best candidate function between:
--     public.join_matchmaking(p_player_id => text, p_game_mode => text, ...)
--
-- Every quick-match join returned 500. The same drift hit join_matchmaking_hybrid.
--
-- Fix. Drop the integer overloads and re-create the canonical `numeric`
-- signatures, carrying the seat-assignment logic from 202610220002. `numeric` is
-- the baseline signature, so the REVOKE/GRANT issued at baseline time keeps
-- meaning what it meant; DROP removes those grants, so they are re-issued below.
--
-- Why this was not caught: `check:schema` counts migrations and function
-- definitions. It never compared a redefinition's argument types against the
-- original, so a silent overload looked like a normal update.

BEGIN;

DROP FUNCTION IF EXISTS public.join_matchmaking(text, text, text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.join_matchmaking_hybrid(text, text, text, integer, integer, integer, text);

CREATE OR REPLACE FUNCTION public.join_matchmaking(
  p_player_id text,
  p_game_mode text,
  p_match_type text,
  p_wager numeric default 0,
  p_wager_min numeric default null,
  p_wager_max numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q uuid;
  m uuid;
  room text;
  slots_needed int;
  opponents_needed int;
  opponents_found record;
  matched_player_ids text[];
  matched_ticket_ids uuid[];
begin
  slots_needed := case when p_match_type in ('2v2', '4P') then 4 else 2 end;
  opponents_needed := slots_needed - 1;

  with candidates as (
    select id, player_id
    from public.matchmaking_queue
    where game_mode = p_game_mode
      and match_type = p_match_type
      and status = 'searching'
      and player_id <> p_player_id
      and (
        p_wager = wager
        or (p_wager_min is not null and wager >= p_wager_min and (p_wager_max is null or wager <= p_wager_max))
        or (wager_min is not null and p_wager >= wager_min and (wager_max is null or p_wager <= wager_max))
      )
    order by created_at asc
    limit opponents_needed
    for update skip locked
  )
  select
    coalesce(array_agg(player_id), array[]::text[]) as player_ids,
    coalesce(array_agg(id), array[]::uuid[]) as ticket_ids
  into opponents_found
  from candidates;

  if cardinality(opponents_found.player_ids) = opponents_needed then
    room := 'QM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    matched_player_ids := array_prepend(p_player_id, opponents_found.player_ids);
    matched_ticket_ids := opponents_found.ticket_ids;

    insert into public.matches(room_code, game_mode, match_shape, participants)
      values (room, p_game_mode, p_match_type, matched_player_ids)
      returning id into m;

    -- S1: Assign and persist deterministic match seats
    perform public.assign_match_seats(m, p_match_type, matched_player_ids);

    -- Update matched opponents to 'matched'
    update public.matchmaking_queue
      set status = 'matched', match_id = m, room_code = room
      where id = any(matched_ticket_ids);

    -- Insert caller's ticket with 'matched' status so all participants exist in matchmaking_queue
    insert into public.matchmaking_queue(player_id, game_mode, match_type, wager, wager_min, wager_max, status, match_id, room_code)
      values (p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max, 'matched', m, room)
      returning id into q;

    return jsonb_build_object(
      'status', 'matched',
      'match_id', m,
      'room_code', room,
      'match_shape', p_match_type,
      'participants', matched_player_ids,
      'ticket_id', q
    );
  end if;

  insert into public.matchmaking_queue(player_id, game_mode, match_type, wager, wager_min, wager_max, status)
    values (p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max, 'searching')
    returning id into q;

  return jsonb_build_object('status', 'searching', 'ticket_id', q);
end;
$$;

CREATE OR REPLACE FUNCTION public.join_matchmaking_hybrid(
  p_player_id text,
  p_game_mode text,
  p_match_type text,
  p_wager numeric default 0,
  p_wager_min numeric default null,
  p_wager_max numeric default null,
  p_room_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_opponent_ticket_id uuid;
  v_opponent_id text;
  v_match_id uuid;
begin
  if p_room_code is null or length(trim(p_room_code)) = 0 then
    return jsonb_build_object('error', 'Hybrid join requires a host room_code');
  end if;

  update public.matchmaking_queue
  set
    game_mode = p_game_mode,
    match_type = p_match_type,
    wager = p_wager,
    wager_min = p_wager_min,
    wager_max = p_wager_max,
    room_code = trim(p_room_code),
    expires_at = now() + interval '30 seconds'
  where player_id = p_player_id
    and status = 'searching'
  returning id into v_ticket_id;

  if v_ticket_id is null then
    insert into public.matchmaking_queue (
      player_id, game_mode, match_type, wager, wager_min, wager_max, room_code, status, expires_at
    )
    values (
      p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max,
      trim(p_room_code), 'searching', now() + interval '30 seconds'
    )
    returning id into v_ticket_id;
  end if;

  select id, player_id into v_opponent_ticket_id, v_opponent_id
  from public.matchmaking_queue
  where status = 'searching'
    and player_id <> p_player_id
    and game_mode = p_game_mode
    and match_type = p_match_type
    and (room_code is null or length(trim(room_code)) = 0)
    and (p_wager_min is null or wager >= p_wager_min)
    and (p_wager_max is null or wager <= p_wager_max)
  order by created_at asc
  limit 1
  for update skip locked;

  if v_opponent_ticket_id is not null then
    insert into public.matches (game_mode, participants, room_code)
    values (p_game_mode, array[p_player_id, v_opponent_id], trim(p_room_code))
    returning id into v_match_id;

    -- S1: Assign and persist deterministic match seats
    perform public.assign_match_seats(v_match_id, p_match_type, array[p_player_id, v_opponent_id]);

    update public.matchmaking_queue
    set status = 'matched', match_id = v_match_id, room_code = trim(p_room_code)
    where id = v_opponent_ticket_id;

    return jsonb_build_object(
      'status', 'matched',
      'ticket_id', v_ticket_id,
      'match_id', v_match_id,
      'room_code', trim(p_room_code),
      'guest_id', v_opponent_id
    );
  end if;

  return jsonb_build_object('status', 'searching', 'ticket_id', v_ticket_id);
end;
$$;

REVOKE EXECUTE ON FUNCTION public.join_matchmaking(text, text, text, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_matchmaking(text, text, text, numeric, numeric, numeric) TO service_role;
REVOKE EXECUTE ON FUNCTION public.join_matchmaking_hybrid(text, text, text, numeric, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_matchmaking_hybrid(text, text, text, numeric, numeric, numeric, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
