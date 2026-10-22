BEGIN;

-- 1. Create match_seats table
CREATE TABLE IF NOT EXISTS public.match_seats (
  match_id uuid not null references public.matches(id) on delete cascade,
  color text not null check (color in ('green','red','yellow','blue')),
  wallet_address text not null,
  seat_index int not null,
  assigned_at timestamptz not null default now(),
  primary key (match_id, color),
  unique (match_id, wallet_address)
);

ALTER TABLE public.match_seats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_seats_select_all" ON public.match_seats;
CREATE POLICY "match_seats_select_all"
  ON public.match_seats
  FOR SELECT
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.match_seats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.match_seats TO PUBLIC, anon, authenticated;
GRANT ALL ON public.match_seats TO service_role;

-- 2. Helper to assign and persist deterministic match seats
CREATE OR REPLACE FUNCTION public.assign_match_seats(
    p_match_id uuid,
    p_match_shape text,
    p_participants text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_colors text[];
    v_sorted_wallets text[];
    v_wallet text;
    v_idx integer;
BEGIN
    IF p_match_shape = '1v1' THEN
        v_colors := ARRAY['green', 'yellow'];
    ELSE
        v_colors := ARRAY['green', 'red', 'yellow', 'blue'];
    END IF;

    -- Sort wallets with explicit "C" collation (byte-for-byte ASCII order)
    SELECT coalesce(array_agg(w ORDER BY w COLLATE "C"), ARRAY[]::text[])
    INTO v_sorted_wallets
    FROM (
        SELECT DISTINCT lower(trim(unnest(p_participants))) AS w
    ) sub;

    FOR v_idx IN 1..cardinality(v_sorted_wallets) LOOP
        v_wallet := v_sorted_wallets[v_idx];
        IF v_idx <= cardinality(v_colors) THEN
            INSERT INTO public.match_seats (match_id, color, wallet_address, seat_index, assigned_at)
            VALUES (p_match_id, v_colors[v_idx], v_wallet, v_idx - 1, now())
            ON CONFLICT (match_id, color) DO NOTHING;
        END IF;
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_match_seats(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_match_seats(uuid, text, text[]) TO service_role;

-- 3. Update join_matchmaking to assign match_seats on match formation
CREATE OR REPLACE FUNCTION public.join_matchmaking(
  p_player_id text,
  p_game_mode text,
  p_match_type text,
  p_wager integer default 0,
  p_wager_min integer default null,
  p_wager_max integer default null
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

-- 4. Update join_matchmaking_hybrid to assign match_seats on hybrid match formation
CREATE OR REPLACE FUNCTION public.join_matchmaking_hybrid(
  p_player_id text,
  p_game_mode text,
  p_match_type text,
  p_wager integer default 0,
  p_wager_min integer default null,
  p_wager_max integer default null,
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

COMMIT;
