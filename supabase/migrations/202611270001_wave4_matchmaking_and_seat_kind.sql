-- Wave 4: Shape-aware hybrid matchmaking party support, game_mode_code propagation,
-- and explicit free-only server bot seat tracking.

BEGIN;

-- 1. Track human vs bot seats explicitly (never spoof human wallets for AI seats)
ALTER TABLE public.match_seats
  ADD COLUMN IF NOT EXISTS seat_kind text NOT NULL DEFAULT 'human'
  CHECK (seat_kind IN ('human', 'bot'));

-- 2. Keep join_matchmaking (exact 6-arg signature) while populating game_mode_code (0=classic, 1=power, 2=quick)
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
  v_mode_code smallint;
begin
  slots_needed := case when p_match_type in ('2v2', '4P') then 4 else 2 end;
  opponents_needed := slots_needed - 1;
  v_mode_code := case p_game_mode when 'power' then 1 when 'quick' then 2 else 0 end;

  with candidates as (
    select id, player_id
    from public.matchmaking_queue
    where game_mode = p_game_mode
      and match_type = p_match_type
      and status = 'searching'
      and expires_at > now()
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

    insert into public.matches(room_code, game_mode, game_mode_code, match_shape, participants)
      values (room, p_game_mode, v_mode_code, p_match_type, matched_player_ids)
      returning id into m;

    perform public.assign_match_seats(m, p_match_type, matched_player_ids);

    update public.matchmaking_queue
      set status = 'matched', match_id = m, room_code = room
      where id = any(matched_ticket_ids);

    update public.matchmaking_queue
      set
        game_mode = p_game_mode,
        match_type = p_match_type,
        wager = p_wager,
        wager_min = p_wager_min,
        wager_max = p_wager_max,
        status = 'matched',
        match_id = m,
        room_code = room,
        expires_at = now() + interval '10 minutes'
      where player_id = p_player_id
        and status = 'searching'
      returning id into q;

    if q is null then
      insert into public.matchmaking_queue(player_id, game_mode, match_type, wager, wager_min, wager_max, status, match_id, room_code, expires_at)
        values (p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max, 'matched', m, room, now() + interval '10 minutes')
        returning id into q;
    end if;

    return jsonb_build_object(
      'status', 'matched',
      'match_id', m,
      'room_code', room,
      'match_shape', p_match_type,
      'participants', matched_player_ids,
      'ticket_id', q
    );
  end if;

  update public.matchmaking_queue
    set
      game_mode = p_game_mode,
      match_type = p_match_type,
      wager = p_wager,
      wager_min = p_wager_min,
      wager_max = p_wager_max,
      expires_at = now() + interval '30 seconds'
    where player_id = p_player_id
      and status = 'searching'
    returning id into q;

  if q is null then
    insert into public.matchmaking_queue(player_id, game_mode, match_type, wager, wager_min, wager_max, status, expires_at)
      values (p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max, 'searching', now() + interval '30 seconds')
      returning id into q;
  end if;

  return jsonb_build_object('status', 'searching', 'ticket_id', q);
end;
$$;

-- 3. Drop old 7-param overload before recreating 9-param hybrid RPC (single live signature)
DROP FUNCTION IF EXISTS public.join_matchmaking_hybrid(text, text, text, numeric, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.join_matchmaking_hybrid(
  p_player_id text,
  p_game_mode text,
  p_match_type text,
  p_wager numeric default 0,
  p_wager_min numeric default null,
  p_wager_max numeric default null,
  p_room_code text default null,
  p_slots_needed int default null,
  p_party_wallets text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_total_seats int;
  v_opponents_needed int;
  v_opponents_found record;
  v_party text[];
  v_participants text[];
  v_match_id uuid;
  v_mode_code smallint;
begin
  if p_room_code is null or length(trim(p_room_code)) = 0 then
    return jsonb_build_object('error', 'Hybrid join requires a host room_code');
  end if;

  -- Normalize distinct lowercased non-empty party wallets including caller
  select coalesce(array_agg(w ORDER BY ord), array[]::text[])
  into v_party
  from (
    select w, min(ord) as ord
    from (
      select lower(trim(x)) as w, row_number() over () as ord
      from unnest(coalesce(p_party_wallets, array[]::text[]) || array[p_player_id]) as x
      where x is not null and length(trim(x)) > 0
    ) raw
    group by w
  ) dedup;

  v_total_seats := case when p_match_type in ('2v2', '4P') then 4 else 2 end;
  v_opponents_needed := greatest(
    1,
    least(v_total_seats - 1, coalesce(p_slots_needed, v_total_seats - cardinality(v_party)))
  );
  v_mode_code := case p_game_mode when 'power' then 1 when 'quick' then 2 else 0 end;

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

  with candidates as (
    select id, player_id
    from public.matchmaking_queue
    where status = 'searching'
      and expires_at > now()
      and not (lower(player_id) = any(v_party))
      and game_mode = p_game_mode
      and match_type = p_match_type
      and (room_code is null or length(trim(room_code)) = 0)
      and (p_wager_min is null or wager >= p_wager_min)
      and (p_wager_max is null or wager <= p_wager_max)
    order by created_at asc
    limit v_opponents_needed
    for update skip locked
  )
  select
    coalesce(array_agg(player_id), array[]::text[]) as player_ids,
    coalesce(array_agg(id), array[]::uuid[]) as ticket_ids
  into v_opponents_found
  from candidates;

  if cardinality(v_opponents_found.player_ids) = v_opponents_needed then
    v_participants := v_party || v_opponents_found.player_ids;

    insert into public.matches (game_mode, game_mode_code, match_shape, participants, room_code)
    values (p_game_mode, v_mode_code, p_match_type, v_participants, trim(p_room_code))
    returning id into v_match_id;

    perform public.assign_match_seats(v_match_id, p_match_type, v_participants);

    update public.matchmaking_queue
    set status = 'matched', match_id = v_match_id, room_code = trim(p_room_code), expires_at = now() + interval '10 minutes'
    where id = any(v_opponents_found.ticket_ids) or id = v_ticket_id;

    return jsonb_build_object(
      'status', 'matched',
      'ticket_id', v_ticket_id,
      'match_id', v_match_id,
      'room_code', trim(p_room_code),
      'match_shape', p_match_type,
      'participants', v_participants,
      'guest_id', v_opponents_found.player_ids[1]
    );
  end if;

  return jsonb_build_object('status', 'searching', 'ticket_id', v_ticket_id);
end;
$$;

REVOKE EXECUTE ON FUNCTION public.join_matchmaking(text, text, text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_matchmaking(text, text, text, numeric, numeric, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.join_matchmaking_hybrid(text, text, text, numeric, numeric, numeric, text, int, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_matchmaking_hybrid(text, text, text, numeric, numeric, numeric, text, int, text[]) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
