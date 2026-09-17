-- Ludo Base canonical fresh-install baseline.
-- This migration is intentionally additive and must be applied to an empty
-- Supabase project before the dated compatibility migrations.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  username text,
  avatar_url text,
  peer_id text,
  ecdh_pubkey jsonb,
  lxp bigint not null default 0 check (lxp >= 0),
  rxp integer not null default 0 check (rxp >= 0),
  coins bigint not null default 1000 check (coins >= 0),
  season_id integer not null default 20241,
  status text not null default 'Offline',
  last_seen_at timestamptz not null default now(),
  classic_played integer not null default 0 check (classic_played >= 0),
  power_played integer not null default 0 check (power_played >= 0),
  ai_played integer not null default 0 check (ai_played >= 0),
  total_wins integer not null default 0 check (total_wins >= 0),
  total_games integer generated always as
    (classic_played + power_played + ai_played) stored,
  rank_tier text not null default 'Bronze',
  last_played_at timestamptz,
  current_room_code text,
  created_at timestamptz not null default now(),
  constraint players_wallet_lowercase check (wallet_address = lower(wallet_address))
);
create index players_lxp_idx on public.players (lxp desc);
create index players_rank_idx on public.players (rank_tier, lxp desc);
create index players_status_idx on public.players (status);

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  nonce text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index app_sessions_active_idx on public.app_sessions(wallet_address, expires_at)
  where revoked_at is null;

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_code text unique,
  game_mode text not null default 'classic',
  winner_address text references public.players(wallet_address) on delete set null,
  participants text[] not null default '{}',
  streaming_enabled boolean not null default false,
  total_bet_volume bigint not null default 0 check (total_bet_volume >= 0),
  spectator_count integer not null default 0 check (spectator_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index matches_created_idx on public.matches(created_at desc);
create index matches_live_idx on public.matches(streaming_enabled, created_at desc);

create table public.matchmaking_queue (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(wallet_address) on delete cascade,
  game_mode text not null,
  match_type text not null,
  wager numeric not null default 0 check (wager >= 0),
  wager_min numeric check (wager_min is null or wager_min >= 0),
  wager_max numeric check (wager_max is null or wager_max >= wager_min),
  status text not null default 'searching'
    check (status in ('searching','matched','cancelled','expired')),
  match_id uuid references public.matches(id) on delete set null,
  room_code text,
  validation_token text,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);
create unique index matchmaking_one_active_player_idx
  on public.matchmaking_queue(player_id) where status = 'searching';
create index matchmaking_search_idx on public.matchmaking_queue
  (game_mode, match_type, status, created_at);

create table public.game_invites (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  host_address text not null references public.players(wallet_address) on delete cascade,
  guest_address text not null references public.players(wallet_address) on delete cascade,
  match_type text,
  entry_fee numeric not null default 0 check (entry_fee >= 0),
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','expired')),
  validation_token text,
  created_at timestamptz not null default now()
);
create index game_invites_guest_idx on public.game_invites(guest_address, status);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_address text not null references public.players(wallet_address) on delete cascade,
  friend_address text not null references public.players(wallet_address) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  unique(user_address, friend_address),
  check (user_address <> friend_address)
);
create index friendships_friend_idx on public.friendships(friend_address, status);

create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_address text not null references public.players(wallet_address) on delete cascade,
  blocked_address text not null references public.players(wallet_address) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_address, blocked_address),
  check (blocker_address <> blocked_address)
);

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_address text not null references public.players(wallet_address) on delete cascade,
  reported_address text not null references public.players(wallet_address) on delete cascade,
  reason text not null check (length(trim(reason)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a text not null references public.players(wallet_address) on delete cascade,
  user_b text not null references public.players(wallet_address) on delete cascade,
  last_message_content text,
  last_message_at timestamptz,
  unread_count_a integer not null default 0 check (unread_count_a >= 0),
  unread_count_b integer not null default 0 check (unread_count_b >= 0),
  unique(user_a, user_b),
  check (user_a < user_b)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null references public.players(wallet_address) on delete cascade,
  receiver_id text not null references public.players(wallet_address) on delete cascade,
  content text not null check (length(trim(content)) between 1 and 4000),
  ciphertext text,
  encryption_nonce text,
  encryption_version smallint not null default 1 check (encryption_version > 0),
  is_read boolean not null default false,
  deleted_by_sender boolean not null default false,
  deleted_by_receiver boolean not null default false,
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);
create index messages_conversation_idx on public.messages(sender_id, receiver_id, created_at desc);

create table public.pokes (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null constraint pokes_sender_id_fkey references public.players(wallet_address) on delete cascade,
  receiver_id text not null references public.players(wallet_address) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  poked_back_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null references public.players(wallet_address) on delete cascade,
  type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activities_actor_idx on public.activities(actor_id, created_at desc);

create table public.player_missions (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(wallet_address) on delete cascade,
  mission_id text not null,
  progress integer not null default 0 check (progress >= 0),
  is_claimed boolean not null default false,
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(player_id, mission_id)
);

create table public.live_matches (
  match_id uuid primary key references public.matches(id) on delete cascade,
  room_code text not null,
  bet_window_status text not null default 'closed'
    check (bet_window_status in ('open','closed','settled')),
  window_opened_at timestamptz,
  window_closed_at timestamptz,
  current_bet_type text,
  spectator_count integer not null default 0 check (spectator_count >= 0),
  host_address text references public.players(wallet_address) on delete set null,
  join_secret_hash text,
  arena_key text,
  authority_id text,
  authority_heartbeat timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index live_matches_arena_key_idx on public.live_matches(arena_key)
  where arena_key is not null;
create index live_matches_status_idx on public.live_matches(bet_window_status);
create index live_matches_host_idx on public.live_matches(host_address);

create table public.live_chat (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null references public.players(wallet_address) on delete cascade,
  username text,
  avatar_url text,
  content text not null check (length(trim(content)) between 1 and 1000),
  country text,
  room_code text not null,
  room_open boolean not null default true,
  created_at timestamptz not null default now()
);
create index live_chat_room_idx on public.live_chat(room_code, created_at desc);

create table public.spectator_bets (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(wallet_address) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  bet_type text not null,
  bet_value text not null,
  bet_metadata jsonb not null default '{}'::jsonb,
  amount bigint not null check (amount > 0),
  odds numeric not null check (odds > 0),
  potential_payout bigint not null check (potential_payout >= 0),
  status text not null default 'open' check (status in ('open','won','lost','cashed_out','cancelled')),
  action_id text,
  window_closed_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  payout_amount bigint check (payout_amount is null or payout_amount >= 0),
  unique(player_id, action_id)
);
create index spectator_bets_match_idx on public.spectator_bets(match_id, status);

create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(wallet_address) on delete cascade,
  idempotency_key text not null,
  amount bigint not null check (amount <> 0),
  balance_after bigint,
  reason text not null,
  reference_type text,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(player_id, idempotency_key)
);
create index coin_ledger_player_idx on public.coin_ledger(player_id, created_at desc);

create table public.match_sessions (
  id uuid primary key default gen_random_uuid(),
  match_id text not null,
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  room_code text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index match_sessions_active_idx on public.match_sessions(match_id, wallet_address)
  where revoked_at is null;

create table public.provisional_match_sessions (
  id uuid primary key default gen_random_uuid(),
  authorization_key text not null unique,
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  room_code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.match_rolls (
  id uuid primary key default gen_random_uuid(),
  match_id text not null,
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  action_id text,
  result integer not null check (result between 1 and 6),
  status text not null default 'available',
  consumed_seq integer,
  created_at timestamptz not null default now()
);
create unique index match_rolls_action_idx on public.match_rolls(match_id, action_id)
  where action_id is not null;

create table public.match_states (
  match_id text primary key,
  room_code text not null,
  host_address text not null references public.players(wallet_address) on delete cascade,
  seq integer not null default 0 check (seq >= 0),
  state jsonb not null default '{}'::jsonb,
  color_corner jsonb not null default '{}'::jsonb,
  player_seats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.match_moves (
  id uuid primary key default gen_random_uuid(),
  match_id text not null,
  seq integer not null check (seq >= 0),
  actor text not null references public.players(wallet_address) on delete cascade,
  color text,
  token_index integer,
  dice integer check (dice between 1 and 6),
  roll_id text,
  from_pos integer,
  to_pos integer,
  captured boolean not null default false,
  bonus_roll boolean not null default false,
  created_at timestamptz not null default now(),
  unique(match_id, seq)
);

create table public.lobby_join_requests (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  username text,
  avatar_url text,
  desired_seat integer,
  validation_token text,
  coins bigint,
  created_at timestamptz not null default now()
);
create index lobby_requests_room_idx on public.lobby_join_requests(room_code, created_at);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  entry_fee bigint not null default 0 check (entry_fee >= 0),
  prize_pool bigint not null default 0 check (prize_pool >= 0),
  min_players integer not null default 2 check (min_players > 0),
  max_players integer not null check (max_players >= min_players),
  status text not null default 'draft'
    check (status in ('draft','open','running','completed','cancelled')),
  start_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id text not null references public.players(wallet_address) on delete cascade,
  seed integer,
  final_rank integer,
  joined_at timestamptz not null default now(),
  unique(tournament_id, player_id)
);
create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  bracket_row integer not null check (bracket_row >= 0),
  bracket_col integer not null check (bracket_col >= 0),
  status text not null default 'pending',
  winner_id text references public.players(wallet_address) on delete set null,
  created_at timestamptz not null default now(),
  unique(tournament_id, match_id)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (length(trim(topic)) between 1 and 200),
  message text not null check (length(trim(message)) between 1 and 5000),
  address text,
  created_at timestamptz not null default now()
);

create trigger live_matches_touch_updated_at before update on public.live_matches
for each row execute function public.touch_updated_at();
create trigger tournaments_touch_updated_at before update on public.tournaments
for each row execute function public.touch_updated_at();

create or replace function public.update_conversation_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare a text; b text;
begin
  a := least(new.sender_id, new.receiver_id);
  b := greatest(new.sender_id, new.receiver_id);
  insert into public.conversations(user_a, user_b, last_message_content, last_message_at,
    unread_count_a, unread_count_b)
  values (a, b, new.content, new.created_at,
    case when new.receiver_id = a then 1 else 0 end,
    case when new.receiver_id = b then 1 else 0 end)
  on conflict (user_a, user_b) do update set
    last_message_content = excluded.last_message_content,
    last_message_at = excluded.last_message_at,
    unread_count_a = public.conversations.unread_count_a +
      case when new.receiver_id = public.conversations.user_a then 1 else 0 end,
    unread_count_b = public.conversations.unread_count_b +
      case when new.receiver_id = public.conversations.user_b then 1 else 0 end;
  return new;
end;
$$;
create trigger trigger_update_conversation after insert on public.messages
for each row execute function public.update_conversation_summary();

create or replace function public.messages_restrict_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender_id <> old.sender_id
     or new.receiver_id <> old.receiver_id
     or new.content <> old.content
     or new.ciphertext is distinct from old.ciphertext
     or new.encryption_nonce is distinct from old.encryption_nonce then
    raise exception 'message identity and encrypted content are immutable';
  end if;
  return new;
end;
$$;
create trigger trg_messages_restrict_columns before update on public.messages
for each row execute function public.messages_restrict_columns();

create or replace function public.mark_conversation_read(me text, friend text)
returns void language sql security definer set search_path = public
as $$
  update public.messages set is_read = true
  where sender_id = friend and receiver_id = me and is_read = false;
  update public.conversations set
    unread_count_a = case when user_a = me then 0 else unread_count_a end,
    unread_count_b = case when user_b = me then 0 else unread_count_b end
  where (user_a = least(me, friend) and user_b = greatest(me, friend));
$$;

create or replace function public.join_matchmaking(
  p_player_id text, p_game_mode text, p_match_type text,
  p_wager numeric default 0, p_wager_min numeric default null,
  p_wager_max numeric default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare q uuid; opponent record; m uuid; room text;
begin
  perform pg_advisory_xact_lock(hashtext(p_game_mode || ':' || p_match_type));
  select * into opponent from public.matchmaking_queue
   where status = 'searching' and player_id <> p_player_id
     and game_mode = p_game_mode and match_type = p_match_type
     and (p_wager_min is null or wager >= p_wager_min)
     and (p_wager_max is null or wager <= p_wager_max)
   order by created_at limit 1 for update skip locked;
  if opponent.id is not null then
    room := 'QM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    insert into public.matches(room_code, game_mode, participants)
      values (room, p_game_mode, array[p_player_id, opponent.player_id]) returning id into m;
    update public.matchmaking_queue set status='matched', match_id=m, room_code=room
      where id in (opponent.id, (select id from public.matchmaking_queue
        where player_id=p_player_id and status='searching' limit 1));
    return jsonb_build_object('status','matched','match_id',m,'room_code',room);
  end if;
  insert into public.matchmaking_queue(player_id, game_mode, match_type, wager, wager_min, wager_max)
    values (p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max)
    returning id into q;
  return jsonb_build_object('status','searching','ticket_id',q);
end;
$$;
create or replace function public.join_matchmaking_hybrid(
  p_player_id text, p_game_mode text, p_match_type text,
  p_wager numeric default 0, p_wager_min numeric default null,
  p_wager_max numeric default null, p_room_code text default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare host_ticket record; guest_match uuid; room text;
begin
  if p_room_code is null or length(trim(p_room_code)) = 0 then
    return public.join_matchmaking(p_player_id,p_game_mode,p_match_type,p_wager,p_wager_min,p_wager_max);
  end if;
  select * into host_ticket from public.matchmaking_queue
   where room_code = trim(p_room_code) and status = 'searching'
     and game_mode = p_game_mode and match_type = p_match_type
     and player_id <> p_player_id and expires_at > now()
   order by created_at limit 1 for update;
  if host_ticket.id is null then
    raise exception 'requested matchmaking room is unavailable';
  end if;
  room := host_ticket.room_code;
  insert into public.matches(room_code, game_mode, participants)
    values (room, p_game_mode, array[host_ticket.player_id, p_player_id])
    returning id into guest_match;
  update public.matchmaking_queue
    set status = 'matched', match_id = guest_match, room_code = room
    where id = host_ticket.id;
  insert into public.matchmaking_queue(player_id, game_mode, match_type, wager, wager_min, wager_max,
                                       status, match_id, room_code)
    values (p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max,
            'matched', guest_match, room);
  return jsonb_build_object('status','matched','match_id',guest_match,'room_code',room);
end;
$$;

create or replace function public.cash_out_bet(p_bet_id uuid, p_player_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare bet record; credited bigint; balance bigint;
begin
  select * into bet from public.spectator_bets
    where id = p_bet_id and player_id = lower(p_player_id)
    for update;
  if bet.id is null then raise exception 'bet not found'; end if;
  if bet.status = 'cashed_out' then
    return jsonb_build_object('bet_id',p_bet_id,'status','cashed_out','credited',coalesce(bet.payout_amount, 0),'idempotent',true);
  end if;
  if bet.status <> 'open' then raise exception 'bet is not eligible for cash out'; end if;
  credited := floor(bet.potential_payout * 0.5);
  update public.players set coins = coins + credited
    where wallet_address = lower(p_player_id)
    returning coins into balance;
  if not found then raise exception 'player not found'; end if;
  insert into public.coin_ledger(player_id, idempotency_key, amount, balance_after, reason, reference_type, reference_id)
    values (lower(p_player_id), 'cashout:' || p_bet_id::text, credited, balance, 'spectator bet cash out', 'spectator_bet', p_bet_id::text);
  update public.spectator_bets set status='cashed_out', resolved_at=now(), payout_amount=credited
    where id=p_bet_id;
  return jsonb_build_object('bet_id',p_bet_id,'status','cashed_out','credited',credited);
end;
$$;

create or replace function public.settle_match_bets(
  p_match_id uuid, p_result text, p_bet_type text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare payout_count integer;
begin
  update public.spectator_bets
     set status = case when bet_type = p_bet_type and bet_value = p_result
                       then 'won' else 'lost' end,
         resolved_at = now()
   where match_id = p_match_id and status = 'open';
  get diagnostics payout_count = row_count;
  return jsonb_build_object('payout_count', payout_count);
end;
$$;

create or replace function public.join_tournament(
  p_tournament_id uuid, p_player_id text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare participant_id uuid;
begin
  insert into public.tournament_participants(tournament_id, player_id)
    select p_tournament_id, p_player_id
     where (select count(*) from public.tournament_participants
              where tournament_id = p_tournament_id)
       < (select max_players from public.tournaments where id = p_tournament_id
            and status = 'open')
  on conflict (tournament_id, player_id) do nothing
  returning id into participant_id;
  if participant_id is null then
    raise exception 'tournament is full, closed, or player already joined';
  end if;
  return jsonb_build_object('participant_id', participant_id);
end;
$$;

create or replace function public.cleanup_matchmaking_queue()
returns void language sql security definer set search_path = public
as $$
  delete from public.matchmaking_queue
   where (status = 'searching' and expires_at < now())
      or (status <> 'searching' and created_at < now() - interval '1 hour');
$$;

create or replace function public.cleanup_stale_data()
returns void language plpgsql security definer set search_path = public
as $$
begin
  delete from public.messages where created_at < now() - interval '72 hours'
    and is_read = true;
  update public.players set status = 'Offline'
   where status <> 'Offline' and last_seen_at < now() - interval '2 minutes';
end;
$$;

revoke execute on function public.join_matchmaking(text,text,text,numeric,numeric,numeric) from public;
revoke execute on function public.join_matchmaking_hybrid(text,text,text,numeric,numeric,numeric,text) from public;
revoke execute on function public.cash_out_bet(uuid,text) from public;
revoke execute on function public.settle_match_bets(uuid,text,text) from public;
revoke execute on function public.join_tournament(uuid,text) from public;
revoke execute on function public.mark_conversation_read(text,text) from public;
revoke execute on function public.cleanup_matchmaking_queue() from public;
revoke execute on function public.cleanup_stale_data() from public;
grant execute on function public.join_matchmaking(text,text,text,numeric,numeric,numeric) to service_role;
grant execute on function public.join_matchmaking_hybrid(text,text,text,numeric,numeric,numeric,text) to service_role;
grant execute on function public.cash_out_bet(uuid,text) to service_role;
grant execute on function public.settle_match_bets(uuid,text,text) to service_role;
grant execute on function public.join_tournament(uuid,text) to service_role;
grant execute on function public.mark_conversation_read(text,text) to service_role;
grant execute on function public.cleanup_matchmaking_queue() to service_role;
grant execute on function public.cleanup_stale_data() to service_role;

-- Default deny. Service-role (and SECURITY DEFINER server functions) bypasses RLS.
do $$
declare t text;
begin
  foreach t in array array['players','app_sessions','matches','matchmaking_queue','game_invites',
    'friendships','user_blocks','user_reports','conversations','messages','pokes','activities',
    'player_missions','live_matches','live_chat','spectator_bets','coin_ledger','match_sessions',
    'provisional_match_sessions','match_rolls','match_states','match_moves','lobby_join_requests',
    'tournaments','tournament_participants','tournament_matches','feedback']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

create policy matches_public_read on public.matches for select using (true);
-- These are deliberately limited to public profile/discovery fields. Private
-- wallet balances, session material, peer keys, and matchmaking tokens remain
-- server-only.
revoke select on public.players from anon, authenticated;
grant select (wallet_address, username, avatar_url, lxp, rxp, status,
  classic_played, power_played, ai_played, total_wins, total_games,
  rank_tier, last_played_at, created_at) on public.players to anon, authenticated;
create policy players_public_directory_read on public.players for select using (true);
revoke select on public.matchmaking_queue from anon, authenticated;
grant select (player_id, game_mode, match_type, wager, wager_min, wager_max,
  status, match_id, room_code, expires_at, created_at) on public.matchmaking_queue to anon, authenticated;
create policy matchmaking_public_discovery_read on public.matchmaking_queue
  for select using (status in ('searching', 'matched'));
create policy live_matches_public_read on public.live_matches for select using (true);
create policy live_chat_public_read on public.live_chat for select using (true);
create policy tournaments_public_read on public.tournaments for select using (status <> 'draft');
create policy feedback_anon_insert on public.feedback for insert with check (true);

do $$
begin
  alter publication supabase_realtime add table public.messages;
  alter publication supabase_realtime add table public.conversations;
  alter publication supabase_realtime add table public.game_invites;
  alter publication supabase_realtime add table public.matchmaking_queue;
  alter publication supabase_realtime add table public.live_chat;
  alter publication supabase_realtime add table public.live_matches;
exception when duplicate_object then null;
end $$;
