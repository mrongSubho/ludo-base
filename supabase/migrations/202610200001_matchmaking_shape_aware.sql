-- 202610200001_matchmaking_shape_aware.sql
--
-- MM-1: Make join_matchmaking shape-aware so 2v2 and 4P tables accumulate
-- the required 4 participants instead of hardcoding 1 opponent.

begin;

create or replace function public.join_matchmaking(
  p_player_id text, p_game_mode text, p_match_type text,
  p_wager numeric default 0, p_wager_min numeric default null,
  p_wager_max numeric default null
) returns jsonb language plpgsql security definer set search_path = public
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
  perform pg_advisory_xact_lock(hashtext(p_game_mode || ':' || p_match_type));

  slots_needed := case when p_match_type in ('2v2', '4P') then 4 else 2 end;
  opponents_needed := slots_needed - 1;

  -- Select up to opponents_needed distinct searching players
  with candidates as (
    select id, player_id from public.matchmaking_queue
     where status = 'searching' and player_id <> p_player_id
       and game_mode = p_game_mode and match_type = p_match_type
       and (p_wager_min is null or wager >= p_wager_min)
       and (p_wager_max is null or wager <= p_wager_max)
     order by created_at asc
     limit opponents_needed
     for update skip locked
  )
  select
    coalesce(array_agg(player_id), array[]::text[]) as player_ids,
    coalesce(array_agg(id), array[]::uuid[]) as ticket_ids
  into opponents_found
  from candidates;

  -- If we gathered the full set of opponents, create the match
  if cardinality(opponents_found.player_ids) = opponents_needed then
    room := 'QM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    matched_player_ids := array_prepend(p_player_id, opponents_found.player_ids);
    matched_ticket_ids := opponents_found.ticket_ids;

    insert into public.matches(room_code, game_mode, match_shape, participants)
      values (room, p_game_mode, p_match_type, matched_player_ids)
      returning id into m;

    update public.matchmaking_queue
      set status = 'matched', match_id = m, room_code = room
      where id = any(matched_ticket_ids)
         or (player_id = p_player_id and status = 'searching');

    return jsonb_build_object(
      'status', 'matched',
      'match_id', m,
      'room_code', room,
      'match_shape', p_match_type,
      'participants', matched_player_ids
    );
  end if;

  -- Insufficient opponents: insert searching ticket
  insert into public.matchmaking_queue(player_id, game_mode, match_type, wager, wager_min, wager_max)
    values (p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max)
    returning id into q;

  return jsonb_build_object('status', 'searching', 'ticket_id', q);
end;
$$;

commit;
