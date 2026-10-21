-- 202610210001_fix_hybrid_matchmaking.sql
--
-- Fix hybrid matchmaking RPC so the host correctly advertises its room_code
-- and hunts for public queue waiters to fill party slots.

begin;

create or replace function public.join_matchmaking_hybrid(
  p_player_id text, p_game_mode text, p_match_type text,
  p_wager numeric default 0, p_wager_min numeric default null,
  p_wager_max numeric default null, p_room_code text default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_match_id uuid;
  v_opponent_id text;
  v_opponent_ticket_id uuid;
  v_lock_key bigint;
begin
  -- If no room_code provided, fallback to standard public queue matching
  if p_room_code is null or length(trim(p_room_code)) = 0 then
    return public.join_matchmaking(p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max);
  end if;

  v_lock_key := hashtext(p_game_mode || ':' || p_match_type)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- Host party path: advertise party ticket for this room_code
  select id into v_ticket_id
  from public.matchmaking_queue
  where player_id = p_player_id and status = 'searching'
  limit 1;

  if v_ticket_id is null then
    insert into public.matchmaking_queue
      (player_id, game_mode, match_type, wager, wager_min, wager_max, room_code, expires_at)
    values
      (p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max, trim(p_room_code), now() + interval '30 seconds')
    returning id into v_ticket_id;
  else
    update public.matchmaking_queue
    set expires_at = now() + interval '30 seconds',
        room_code = trim(p_room_code),
        wager = p_wager,
        wager_min = p_wager_min,
        wager_max = p_wager_max
    where id = v_ticket_id;
  end if;

  -- Hunt for ONE public waiter who queued without a room code
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

  return jsonb_build_object(
    'status', 'searching',
    'ticket_id', v_ticket_id,
    'room_code', trim(p_room_code)
  );
end;
$$;

revoke execute on function public.join_matchmaking_hybrid(text,text,text,numeric,numeric,numeric,text) from public;
grant execute on function public.join_matchmaking_hybrid(text,text,text,numeric,numeric,numeric,text) to service_role;

commit;
