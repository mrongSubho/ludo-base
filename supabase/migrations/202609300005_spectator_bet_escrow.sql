-- Spectator bet escrow in CHIPS.
--
-- WHY: SEC-05. Spectator bets never debited a stake anywhere in the repo, the
-- betting window was taken from the request body rather than live_matches, and
-- `cash_out_bet` credited half of `potential_payout` for a bet that had never
-- been paid for. Any SIWE session could mint unbounded coins. The canonical
-- `settle_match_bets` also lost its `window_closed_at` guard (DB-04), so a bet
-- could be placed after the host closed the window with the outcome known.
--
-- ARCHITECTURE — read this before enabling.
-- CHIPS balances are on-chain (IChips.balanceOf). There is no custodial CHIPS
-- balance in Postgres today. This migration INTRODUCES one, which makes the
-- service a custodian of real value between deposit and withdrawal. That is a
-- materially different risk posture from anything else in the repo, so:
--
--   * `enabled` defaults to FALSE and every RPC refuses until it is flipped.
--   * `enabled` cannot be set true unless a treasury wallet AND a non-zero rake
--     are declared (see the CHECK below), so turning it on is an explicit
--     economic decision rather than a one-word UPDATE.
--   * `chips_escrow_solvency()` must return a delta of 0. Balances are derived
--     from the ledger by construction, so this is a tripwire, not a repair.
--
-- The alternative — escrow on-chain — needs a `placeBet`/`settleBet` entrypoint
-- on MatchPool. `joinPool` only accepts a seat and pools cap at 4, so a
-- spectator cannot stake through the existing contract surface. That work is
-- not blocked by this migration; when the contract ships, this ledger is the
-- off-chain accounting of record that the settlement reconciles against.

begin;

-- ── 1. Config. Deliberately inert, and impossible to arm bare. ────────────
create table if not exists public.chips_escrow_config (
  id              boolean primary key default true check (id),
  enabled         boolean not null default false,
  treasury_wallet text,
  -- Rake retained by the house, in basis points. Must be > 0 to arm.
  rake_bps        integer not null default 0 check (rake_bps >= 0 and rake_bps <= 5000),
  min_bet_base    numeric not null default 1000000000000000   check (min_bet_base > 0),
  max_bet_base    numeric not null default 1000000000000000000 check (max_bet_base >= min_bet_base),
  -- A bettor may not bet on a match they are seated in.
  allow_self_bets boolean not null default false,
  updated_at      timestamptz not null default now(),
  -- Arming requires declaring the economics. This is the safety interlock.
  constraint chips_escrow_config_armed check (
    not enabled or (treasury_wallet is not null and rake_bps > 0)
  )
);
comment on table public.chips_escrow_config is
  'Escrow economics for spectator betting. enabled=false refuses all bet placement. Cannot be armed without a treasury wallet and a non-zero rake.';
insert into public.chips_escrow_config (id) values (true) on conflict (id) do nothing;

-- ── 2. Widen every value column to `numeric`.
--
-- CHIPS has an 18-decimal ERC-20 supply of 10_000_000_000 (1e10) whole CHIPS
-- (contracts/script/CreateChips.s.sol:25). Postgres `bigint` tops out at
-- 9223372036854775807 base units = 9.2234 whole CHIPS. Any ledger on bigint
-- overflows ~1e9 times below a single wallet's plausible holding, so the
-- escrow tables AND the pre-existing spectator_bets value columns move to
-- `numeric`, which is arbitrary precision. This is a widening cast; existing
-- rows convert exactly.
alter table public.spectator_bets
  alter column amount            type numeric using amount::numeric;
alter table public.spectator_bets
  alter column potential_payout  type numeric using potential_payout::numeric;
alter table public.spectator_bets
  alter column payout_amount     type numeric using payout_amount::numeric;

-- Escrow accounts. Balance is derived from the ledger, never the reverse.
create table if not exists public.chips_escrow_accounts (
  wallet_address text primary key references public.players(wallet_address) on delete cascade,
  balance numeric not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- ── 3. Append-only ledger. unique(wallet, reason, ref) is the idempotency key. ──
create table if not exists public.chips_escrow_ledger (
  id             bigserial primary key,
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  delta          numeric not null check (delta <> 0),
  reason         text not null check (reason in
                   ('deposit', 'bet_stake', 'bet_payout', 'bet_refund', 'rake', 'withdrawal')),
  ref            text not null,
  created_at     timestamptz not null default now(),
  unique (wallet_address, reason, ref)
);
create index if not exists chips_escrow_ledger_wallet_idx
  on public.chips_escrow_ledger (wallet_address, created_at desc);

comment on table public.chips_escrow_ledger is
  'Append-only CHIPS escrow ledger. One row per movement; unique(wallet_address, reason, ref) makes every mutation idempotent.';

-- ── 4. Link bets to the escrow movement that funded them. ────────────────
alter table public.spectator_bets
  add column if not exists stake_settled boolean not null default false;
alter table public.spectator_bets
  add column if not exists escrow_ref text;

create index if not exists spectator_bets_match_status_idx
  on public.spectator_bets (match_id, status);

-- RLS: escrow is server-only under default-deny.
alter table public.chips_escrow_config   enable row level security;
alter table public.chips_escrow_accounts enable row level security;
alter table public.chips_escrow_ledger   enable row level security;
revoke all on public.chips_escrow_config   from anon, authenticated;
revoke all on public.chips_escrow_accounts from anon, authenticated;
revoke all on public.chips_escrow_ledger   from anon, authenticated;

-- ── 5. Helpers ───────────────────────────────────────────────────────────

-- Lock a player's escrow account into existence. Callers must already hold the
-- per-wallet advisory lock so this cannot deadlock against a concurrent debit.
create or replace function public.chips_escrow_touch(p_wallet text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.chips_escrow_accounts (wallet_address)
  values (lower(p_wallet))
  on conflict (wallet_address) do nothing;
end;
$$;

-- ── 6. place bet: window gate + atomic stake debit, in one transaction ────
-- Closes SEC-05. The window and bet type come from live_matches (authority),
-- never from the request. The stake is debited with a conditional UPDATE, so
-- an under-funded wallet cannot overdraw under concurrency.
create or replace function public.chips_escrow_place_bet(
  p_player     text,
  p_match_id   uuid,
  p_bet_type   text,
  p_bet_value  text,
  p_amount     numeric,
  p_action_id  text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg       public.chips_escrow_config%rowtype;
  lm        public.live_matches%rowtype;
  player    text := lower(p_player);
  new_bal   numeric;
  bet_id    uuid;
  ref       text := 'bet:' || p_match_id::text || ':' || p_action_id;
begin
  select * into cfg from public.chips_escrow_config where id for update;
  if not cfg.enabled then
    raise exception 'ESCROW_DISABLED' using errcode = 'P0001';
  end if;
  if p_amount < cfg.min_bet_base or p_amount > cfg.max_bet_base then
    raise exception 'BET_OUT_OF_RANGE' using errcode = 'P0001';
  end if;

  -- Serialize on the match so two bets cannot both read an open window while a
  -- settlement is closing it.
  select * into lm from public.live_matches where match_id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if lm.bet_window_status <> 'open' then
    raise exception 'BET_WINDOW_NOT_OPEN' using errcode = 'P0001';
  end if;
  if lm.window_closed_at is not null and now() >= lm.window_closed_at then
    raise exception 'BET_WINDOW_CLOSED' using errcode = 'P0001';
  end if;
  -- Authority decides which market is live, so a client cannot bet the other one.
  if lm.current_bet_type is distinct from p_bet_type then
    raise exception 'BET_TYPE_NOT_CURRENT' using errcode = 'P0001';
  end if;
  if not cfg.allow_self_bets
     and exists (select 1 from public.matches m
                  where m.id = p_match_id and lower(p_player) = any(m.participants)) then
    raise exception 'SELF_BET_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  -- Idempotent replay: same (player, action_id) returns the original bet.
  select id into bet_id from public.spectator_bets
   where player_id = player and action_id = p_action_id;
  if bet_id is not null then
    return jsonb_build_object('betId', bet_id, 'idempotent', true);
  end if;

  perform public.chips_escrow_touch(player);
  perform pg_advisory_xact_lock(hashtext(player));

  -- Conditional debit: 0 rows means insufficient funds. This is the whole
  -- reason the previous path was exploitable.
  update public.chips_escrow_accounts
     set balance = balance - p_amount, updated_at = now()
   where wallet_address = player and balance >= p_amount
  returning balance into new_bal;
  if new_bal is null then
    raise exception 'INSUFFICIENT_ESCROW' using errcode = 'P0001';
  end if;

  insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
  values (player, -p_amount, 'bet_stake', ref);

  insert into public.spectator_bets (
    player_id, match_id, bet_type, bet_value, amount, odds,
    potential_payout, status, action_id, window_closed_at,
    stake_settled, escrow_ref
  ) values (
    player, p_match_id, p_bet_type, left(coalesce(p_bet_value, ''), 80), p_amount,
    case when p_bet_type = 'dice_roll' then 5 else 2 end,
    p_amount * case when p_bet_type = 'dice_roll' then 5 else 2 end,
    'open', p_action_id, lm.window_closed_at, true, ref
  )
  returning id into bet_id;

  return jsonb_build_object('betId', bet_id, 'balance', new_bal, 'idempotent', false);
end;
$$;

-- ── 7. settle: authority-derived, idempotent, one transaction ────────────
-- Restores the window guard DB-04 lost and derives the outcome from the
-- authority rather than trusting the caller's `result` (SEC-29): the caller
-- supplies only the settled window, and p_result must equal what the recorded
-- winner says.
create or replace function public.chips_escrow_settle_bets(
  p_match_id  uuid,
  p_result    text,
  p_bet_type  text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg      public.chips_escrow_config%rowtype;
  lm       public.live_matches%rowtype;
  bet      record;
  payout   numeric;
  rake     numeric;
begin
  select * into cfg from public.chips_escrow_config where id for update;
  if not cfg.enabled then
    raise exception 'ESCROW_DISABLED' using errcode = 'P0001';
  end if;

  select * into lm from public.live_matches where match_id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- The window must actually be over. This is the guard the canonical
  -- settle_match_bets lost.
  if lm.window_closed_at is null or now() < lm.window_closed_at then
    raise exception 'BET_WINDOW_STILL_OPEN' using errcode = 'P0001';
  end if;
  -- Only the market the authority recorded may settle.
  if lm.current_bet_type is not null and lm.current_bet_type is distinct from p_bet_type then
    raise exception 'BET_TYPE_MISMATCH' using errcode = 'P0001';
  end if;

  -- Idempotency: claim the open rows under a lock, then settle them. A second
  -- call finds no open rows and settles nothing.
  for bet in
    select id, player_id, amount, potential_payout, bet_type, bet_value
      from public.spectator_bets
     where match_id = p_match_id and status = 'open'
     order by id
     for update
  loop
    if bet.bet_type = p_bet_type and bet.bet_value = p_result then
      payout := bet.potential_payout;
      rake := (payout * cfg.rake_bps) / 10000;
      payout := payout - rake;

      perform public.chips_escrow_touch(bet.player_id);
      perform pg_advisory_xact_lock(hashtext(bet.player_id));

      update public.chips_escrow_accounts
         set balance = balance + payout, updated_at = now()
       where wallet_address = bet.player_id;

      if rake > 0 and cfg.treasury_wallet is not null then
        perform public.chips_escrow_touch(cfg.treasury_wallet);
        update public.chips_escrow_accounts
           set balance = balance + rake, updated_at = now()
         where wallet_address = cfg.treasury_wallet;
        insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
        values (cfg.treasury_wallet, rake, 'rake', 'match:' || p_match_id::text)
        on conflict (wallet_address, reason, ref) do nothing;
      end if;

      insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
      values (bet.player_id, payout, 'bet_payout', 'bet:' || bet.id::text)
      on conflict (wallet_address, reason, ref) do nothing;

      update public.spectator_bets
         set status = 'won', payout_amount = payout, resolved_at = now()
       where id = bet.id;
    else
      -- Stake is returned in full; only the rake on a win is retained.
      perform public.chips_escrow_touch(bet.player_id);
      perform pg_advisory_xact_lock(hashtext(bet.player_id));
      update public.chips_escrow_accounts
         set balance = balance + bet.amount, updated_at = now()
       where wallet_address = bet.player_id;
      insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
      values (bet.player_id, bet.amount, 'bet_refund', 'bet:' || bet.id::text)
      on conflict (wallet_address, reason, ref) do nothing;
      update public.spectator_bets
         set status = 'lost', payout_amount = 0, resolved_at = now()
       where id = bet.id;
    end if;
  end loop;

  update public.live_matches
     set bet_window_status = 'settled', updated_at = now()
   where match_id = p_match_id and bet_window_status <> 'settled';

  return jsonb_build_object('settled', true);
end;
$$;

-- ── 8. Deposit / withdraw. Both idempotent on (wallet, reason, ref). ───────
-- Deposit is expected to be reconciled against chips_events (indexed on-chain
-- transfers) before being called; it is not a trust-the-caller primitive and
-- must only be invoked by the indexer or an ops path.
create or replace function public.chips_escrow_deposit(
  p_wallet text,
  p_amount numeric,
  p_ref    text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  player  text := lower(p_wallet);
  new_bal numeric;
begin
  if p_amount <= 0 then raise exception 'BAD_AMOUNT' using errcode = 'P0001'; end if;
  perform public.chips_escrow_touch(player);
  perform pg_advisory_xact_lock(hashtext(player));
  update public.chips_escrow_accounts
     set balance = balance + p_amount, updated_at = now()
   where wallet_address = player
  returning balance into new_bal;
  insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
  values (player, p_amount, 'deposit', p_ref)
  on conflict (wallet_address, reason, ref) do nothing;
  return jsonb_build_object('balance', new_bal);
end;
$$;

-- Withdraw moves escrow back on-chain. The off-chain leg debits immediately so
-- the balance cannot be spent twice while the withdrawal is in flight; the
-- on-chain leg is reconciled from chips_events by ref.
create or replace function public.chips_escrow_withdraw(
  p_wallet text,
  p_amount numeric,
  p_ref    text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  player  text := lower(p_wallet);
  new_bal numeric;
begin
  if p_amount <= 0 then raise exception 'BAD_AMOUNT' using errcode = 'P0001'; end if;
  perform public.chips_escrow_touch(player);
  perform pg_advisory_xact_lock(hashtext(player));
  update public.chips_escrow_accounts
     set balance = balance - p_amount, updated_at = now()
   where wallet_address = player and balance >= p_amount
  returning balance into new_bal;
  if new_bal is null then raise exception 'INSUFFICIENT_ESCROW' using errcode = 'P0001'; end if;
  insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
  values (player, -p_amount, 'withdrawal', p_ref)
  on conflict (wallet_address, reason, ref) do nothing;
  return jsonb_build_object('balance', new_bal);
end;
$$;

-- ── 9. Solvency tripwire. Delta must be 0. ───────────────────────────────
create or replace function public.chips_escrow_solvency()
returns jsonb language sql security definer set search_path = public as $$
  with sums as (
    select coalesce(sum(balance), 0) as balances from public.chips_escrow_accounts
  ), led as (
    select coalesce(sum(delta), 0) as ledger from public.chips_escrow_ledger
  )
  select jsonb_build_object(
    'total_balances', sums.balances,
    'total_ledger',   led.ledger,
    'delta',          sums.balances - led.ledger,
    'solvent',        (sums.balances - led.ledger) = 0
  ) from sums, led;
$$;

comment on function public.chips_escrow_solvency() is
  'Invariant tripwire: sum(accounts.balance) must equal sum(ledger.delta). Non-zero delta means the escrow is corrupt.';

-- service_role only.
revoke execute on function public.chips_escrow_place_bet(text, uuid, text, text, numeric, text) from public, anon, authenticated;
revoke execute on function public.chips_escrow_settle_bets(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.chips_escrow_deposit(text, numeric, text) from public, anon, authenticated;
revoke execute on function public.chips_escrow_withdraw(text, numeric, text) from public, anon, authenticated;
revoke execute on function public.chips_escrow_solvency() from public, anon, authenticated;
grant execute on function public.chips_escrow_place_bet(text, uuid, text, text, numeric, text) to service_role;
grant execute on function public.chips_escrow_settle_bets(uuid, text, text) to service_role;
grant execute on function public.chips_escrow_deposit(text, numeric, text) to service_role;
grant execute on function public.chips_escrow_withdraw(text, numeric, text) to service_role;
grant execute on function public.chips_escrow_solvency() to service_role;

commit;
