-- ── Migration: 202611190001_spectator_parimutuel_vault.sql ───────────────
-- ArenaVault-backed Pari-Mutuel Spectator Betting System:
--   1. Bets debit directly from `arena_vault_accounts` (0 gas per bet).
--   2. Fixed early-match betting window enforced server-side (`live_matches.window_closed_at`).
--   3. Opposed Pari-Mutuel Pool: losers' stakes pay winners proportionally after 5% protocol rake.
--   4. Unopposed Winners: 100% refund (`match_refund`) to Claim Hub when no opposition bet exists.
--   5. Unopposed Losers: 100% forfeited to House Pool when no bet backed the winning side.

begin;

-- ── 1. RPC: Place Spectator Bet from Arena Match Vault ──────────────────────
create or replace function public.arena_vault_place_spectator_bet(
  p_player    text,
  p_match_id  uuid,
  p_bet_type  text,
  p_bet_value text,
  p_amount    numeric,
  p_action_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player    text := lower(trim(p_player));
  v_bet_type  text := lower(trim(p_bet_type));
  v_bet_value text := left(lower(trim(coalesce(p_bet_value, ''))), 80);
  v_action_id text := trim(coalesce(p_action_id, ''));
  v_lm        public.live_matches%rowtype;
  v_finished  timestamptz;
  v_parts     text[];
  v_existing  uuid;
  v_new_bal   numeric;
  v_bet_id    uuid;
  v_ref       text;
begin
  if v_player = '' or v_bet_value = '' or v_action_id = '' then
    raise exception 'INVALID_BET_INPUT' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'BET_OUT_OF_RANGE' using errcode = 'P0001';
  end if;

  -- Serialize on live_matches row so a bet cannot slip past an expiring window.
  select * into v_lm
    from public.live_matches
   where match_id = p_match_id
   for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_lm.window_closed_at is not null and now() >= v_lm.window_closed_at then
    if v_lm.bet_window_status = 'open' then
      update public.live_matches
         set bet_window_status = 'closed', updated_at = now()
       where match_id = p_match_id;
    end if;
    raise exception 'BET_WINDOW_CLOSED' using errcode = 'P0001';
  end if;

  if v_lm.bet_window_status <> 'open' or v_lm.window_closed_at is null then
    raise exception 'BET_WINDOW_NOT_OPEN' using errcode = 'P0001';
  end if;

  if v_lm.current_bet_type is not null and lower(v_lm.current_bet_type) is distinct from v_bet_type then
    raise exception 'BET_TYPE_NOT_CURRENT' using errcode = 'P0001';
  end if;

  select finished_at, participants into v_finished, v_parts
    from public.matches
   where id = p_match_id;

  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_finished is not null then
    raise exception 'BET_WINDOW_CLOSED' using errcode = 'P0001';
  end if;

  if v_parts is not null and v_player = any(select lower(x) from unnest(v_parts) as t(x)) then
    raise exception 'SELF_BET_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  -- Idempotency replay for (player_id, action_id).
  select id into v_existing
    from public.spectator_bets
   where player_id = v_player and action_id = v_action_id;

  if v_existing is not null then
    select balance into v_new_bal
      from public.arena_vault_accounts
     where wallet_address = v_player;
    return jsonb_build_object(
      'id', v_existing,
      'betId', v_existing,
      'balance', coalesce(v_new_bal, 0),
      'idempotent', true
    );
  end if;

  -- Ensure FK target exists in players before inserting spectator_bets.
  insert into public.players (wallet_address)
  values (v_player)
  on conflict (wallet_address) do nothing;

  perform pg_advisory_xact_lock(hashtext('arena_vault:' || v_player));

  insert into public.arena_vault_accounts (wallet_address, balance, updated_at)
  values (v_player, 0, now())
  on conflict (wallet_address) do nothing;

  update public.arena_vault_accounts
     set balance = balance - p_amount, updated_at = now()
   where wallet_address = v_player and balance >= p_amount
  returning balance into v_new_bal;

  if v_new_bal is null then
    raise exception 'INSUFFICIENT_VAULT' using errcode = 'P0001';
  end if;

  v_ref := 'sbet:' || p_match_id::text || ':' || v_action_id;

  insert into public.arena_vault_ledger (wallet_address, delta, reason, ref)
  values (v_player, -p_amount, 'spectator_bet_stake', v_ref)
  on conflict (wallet_address, reason, ref) do nothing;

  insert into public.spectator_bets (
    player_id,
    match_id,
    bet_type,
    bet_value,
    amount,
    odds,
    potential_payout,
    status,
    action_id,
    window_closed_at,
    stake_settled,
    escrow_ref,
    bet_metadata
  ) values (
    v_player,
    p_match_id,
    v_bet_type,
    v_bet_value,
    p_amount,
    1,
    p_amount,
    'open',
    v_action_id,
    v_lm.window_closed_at,
    true,
    v_ref,
    jsonb_build_object('source', 'arena_vault', 'model', 'parimutuel')
  )
  returning id into v_bet_id;

  update public.matches
     set total_bet_volume = coalesce(total_bet_volume, 0) + p_amount
   where id = p_match_id;

  return jsonb_build_object(
    'id', v_bet_id,
    'betId', v_bet_id,
    'balance', v_new_bal,
    'idempotent', false
  );
end;
$$;

-- ── 2. RPC: Settle Pari-Mutuel Spectator Bets to Claim Hub ──────────────────
create or replace function public.arena_vault_settle_spectator_bets(
  p_match_id       uuid,
  p_winning_values text[],
  p_rake_bps       int default 500
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_winners      text[];
  v_total_pot    numeric := 0;
  v_winning_pool numeric := 0;
  v_losing_pool  numeric := 0;
  v_win_count    int := 0;
  v_rake         numeric := 0;
  v_net_pot      numeric := 0;
  v_distributed  numeric := 0;
  v_win_idx      int := 0;
  v_payout       numeric;
  v_claim_id     uuid;
  v_bet          record;
begin
  perform pg_advisory_xact_lock(hashtext('arena_spectator_settle:' || p_match_id::text));

  select coalesce(array_agg(distinct lower(trim(x))), array[]::text[])
    into v_winners
    from unnest(coalesce(p_winning_values, array[]::text[])) as t(x)
   where trim(x) <> '';

  update public.live_matches
     set bet_window_status = 'settled',
         window_closed_at = least(coalesce(window_closed_at, now()), now()),
         updated_at = now()
   where match_id = p_match_id;

  if coalesce(array_length(v_winners, 1), 0) = 0 then
    return jsonb_build_object('settled', false, 'reason', 'no_winners');
  end if;

  for v_bet in
    select id, player_id, bet_value, amount
      from public.spectator_bets
     where match_id = p_match_id and status = 'open' and bet_type = 'winner'
     order by created_at asc, id asc
     for update
  loop
    v_total_pot := v_total_pot + v_bet.amount;
    if lower(trim(v_bet.bet_value)) = any(v_winners) then
      v_winning_pool := v_winning_pool + v_bet.amount;
      v_win_count := v_win_count + 1;
    else
      v_losing_pool := v_losing_pool + v_bet.amount;
    end if;
  end loop;

  if v_total_pot <= 0 then
    return jsonb_build_object('settled', false, 'reason', 'no_open_bets', 'totalPot', 0);
  end if;

  if v_winning_pool > 0 and v_losing_pool > 0 then
    -- Opposed pari-mutuel pool: 5% protocol rake capped at losing pool so winners never lose principal.
    v_rake := least(floor((v_total_pot * p_rake_bps) / 10000), v_losing_pool);
    v_net_pot := v_total_pot - v_rake;

    for v_bet in
      select id, player_id, bet_value, amount, bet_metadata
        from public.spectator_bets
       where match_id = p_match_id and status = 'open' and bet_type = 'winner'
       order by created_at asc, id asc
    loop
      if lower(trim(v_bet.bet_value)) = any(v_winners) then
        v_win_idx := v_win_idx + 1;
        if v_win_idx = v_win_count then
          v_payout := v_net_pot - v_distributed;
        else
          v_payout := floor((v_net_pot * v_bet.amount) / v_winning_pool);
          v_distributed := v_distributed + v_payout;
        end if;

        insert into public.arena_vault_claims (wallet_address, claim_type, amount, match_id, status)
        values (lower(v_bet.player_id), 'match_prize', v_payout, p_match_id::text, 'claimable')
        returning id into v_claim_id;

        insert into public.arena_vault_ledger (wallet_address, delta, reason, ref)
        values (lower(v_bet.player_id), v_payout, 'spectator_bet_payout', 'sbet_claim:' || v_claim_id::text)
        on conflict (wallet_address, reason, ref) do nothing;

        update public.spectator_bets
           set status = 'won',
               payout_amount = v_payout,
               odds = round(v_payout / greatest(v_bet.amount, 1), 4),
               resolved_at = now(),
               bet_metadata = coalesce(v_bet.bet_metadata, '{}'::jsonb) ||
                 jsonb_build_object('outcome', 'parimutuel_win', 'claim_id', v_claim_id, 'rake', v_rake)
         where id = v_bet.id;
      else
        update public.spectator_bets
           set status = 'lost',
               payout_amount = 0,
               resolved_at = now(),
               bet_metadata = coalesce(v_bet.bet_metadata, '{}'::jsonb) ||
                 jsonb_build_object('outcome', 'parimutuel_loss')
         where id = v_bet.id;
      end if;
    end loop;

    return jsonb_build_object(
      'settled', true,
      'mode', 'parimutuel',
      'totalPot', v_total_pot,
      'winningPool', v_winning_pool,
      'losingPool', v_losing_pool,
      'rake', v_rake,
      'netPot', v_net_pot
    );
  elsif v_winning_pool > 0 and v_losing_pool = 0 then
    -- Unopposed winners only: 100% refund (0% rake) delivered to Claim Hub.
    for v_bet in
      select id, player_id, amount, bet_metadata
        from public.spectator_bets
       where match_id = p_match_id and status = 'open' and bet_type = 'winner'
       order by created_at asc, id asc
    loop
      insert into public.arena_vault_claims (wallet_address, claim_type, amount, match_id, status)
      values (lower(v_bet.player_id), 'match_refund', v_bet.amount, p_match_id::text, 'claimable')
      returning id into v_claim_id;

      insert into public.arena_vault_ledger (wallet_address, delta, reason, ref)
      values (lower(v_bet.player_id), v_bet.amount, 'spectator_bet_refund', 'sbet_claim:' || v_claim_id::text)
      on conflict (wallet_address, reason, ref) do nothing;

      update public.spectator_bets
         set status = 'won',
             payout_amount = v_bet.amount,
             odds = 1,
             resolved_at = now(),
             bet_metadata = coalesce(v_bet.bet_metadata, '{}'::jsonb) ||
               jsonb_build_object('outcome', 'unopposed_refund', 'claim_id', v_claim_id)
       where id = v_bet.id;
    end loop;

    return jsonb_build_object(
      'settled', true,
      'mode', 'unopposed_refund',
      'totalPot', v_total_pot,
      'winningPool', v_winning_pool,
      'losingPool', 0,
      'rake', 0,
      'netPot', v_winning_pool
    );
  else
    -- Unopposed losers only: nobody backed the winner; stakes forfeit to House Pool.
    update public.spectator_bets
       set status = 'lost',
           payout_amount = 0,
           resolved_at = now(),
           bet_metadata = coalesce(bet_metadata, '{}'::jsonb) ||
             jsonb_build_object('outcome', 'house_forfeit')
     where match_id = p_match_id and status = 'open' and bet_type = 'winner';

    return jsonb_build_object(
      'settled', true,
      'mode', 'house_forfeit',
      'totalPot', v_total_pot,
      'winningPool', 0,
      'losingPool', v_losing_pool,
      'rake', v_losing_pool,
      'netPot', 0
    );
  end if;
end;
$$;

revoke all on function public.arena_vault_place_spectator_bet(text, uuid, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.arena_vault_settle_spectator_bets(uuid, text[], int) from public, anon, authenticated;
grant execute on function public.arena_vault_place_spectator_bet(text, uuid, text, text, numeric, text) to service_role;
grant execute on function public.arena_vault_settle_spectator_bets(uuid, text[], int) to service_role;

commit;
