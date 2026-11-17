-- ── Migration: 202611170001_arena_vault_system.sql ──────────────────────
-- Reusable Arena Match Vault + EIP-712 Pull-Claim ledger for Quick Match & TeamUp wagers.
-- Server-only (service_role) access under strict RLS; client reads/writes go via authenticated API routes.

begin;

-- ── 1. Vault Balances (stored in whole CHIPS) ───────────────────────────────
create table if not exists public.arena_vault_accounts (
  wallet_address text primary key,
  balance        numeric not null default 0 check (balance >= 0),
  updated_at     timestamptz not null default now(),
  constraint arena_vault_wallet_lower check (wallet_address = lower(wallet_address))
);
alter table public.arena_vault_accounts enable row level security;
revoke all on public.arena_vault_accounts from public, anon, authenticated;

-- ── 2. Per-Match Reserved / Committed Stakes ────────────────────────────────
create table if not exists public.arena_match_stakes (
  id             uuid primary key default gen_random_uuid(),
  match_key      text not null,
  match_id       text,
  wallet_address text not null,
  amount         numeric not null check (amount > 0),
  status         varchar(20) not null default 'reserved'
                 check (status in ('reserved', 'committed', 'settled', 'released', 'forfeited')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (match_key, wallet_address)
);
create index if not exists arena_match_stakes_wallet_idx on public.arena_match_stakes (wallet_address, status);
create index if not exists arena_match_stakes_match_idx on public.arena_match_stakes (match_id) where match_id is not null;
alter table public.arena_match_stakes enable row level security;
revoke all on public.arena_match_stakes from public, anon, authenticated;

-- ── 3. Pull-Claim Vouchers (Match Prizes, Refunds & Vault Withdrawals) ──────
create table if not exists public.arena_vault_claims (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  claim_type     varchar(24) not null check (claim_type in ('match_prize', 'vault_withdraw', 'match_refund')),
  amount         numeric not null check (amount > 0),
  match_id       text,
  status         varchar(20) not null default 'claimable' check (status in ('claimable', 'rolled', 'claimed')),
  tx_hash        text,
  created_at     timestamptz not null default now(),
  claimed_at     timestamptz
);
create index if not exists arena_vault_claims_wallet_idx on public.arena_vault_claims (wallet_address, status);
alter table public.arena_vault_claims enable row level security;
revoke all on public.arena_vault_claims from public, anon, authenticated;

-- ── 4. Idempotent Vault Audit Ledger ────────────────────────────────────────
create table if not exists public.arena_vault_ledger (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  delta          numeric not null,
  reason         text not null,
  ref            text not null,
  created_at     timestamptz not null default now(),
  unique (wallet_address, reason, ref)
);
alter table public.arena_vault_ledger enable row level security;
revoke all on public.arena_vault_ledger from public, anon, authenticated;

-- ── 5. RPC: Idempotent On-Chain Deposit Credit ──────────────────────────────
create or replace function public.arena_vault_credit_deposit(
  p_wallet  text,
  p_amount  numeric,
  p_tx_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet text := lower(trim(p_wallet));
  v_ref    text := lower(trim(p_tx_hash));
  v_bal    numeric;
  v_exists boolean;
begin
  if p_amount <= 0 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('arena_vault:' || v_wallet));

  insert into public.arena_vault_accounts (wallet_address, balance, updated_at)
  values (v_wallet, 0, now())
  on conflict (wallet_address) do nothing;

  select exists (
    select 1 from public.arena_vault_ledger
    where wallet_address = v_wallet and reason = 'deposit' and ref = v_ref
  ) into v_exists;

  if v_exists then
    select balance into v_bal from public.arena_vault_accounts where wallet_address = v_wallet;
    return jsonb_build_object('balance', v_bal, 'idempotent', true);
  end if;

  insert into public.arena_vault_ledger (wallet_address, delta, reason, ref)
  values (v_wallet, p_amount, 'deposit', v_ref);

  update public.arena_vault_accounts
     set balance = balance + p_amount, updated_at = now()
   where wallet_address = v_wallet
  returning balance into v_bal;

  return jsonb_build_object('balance', v_bal, 'idempotent', false);
end;
$$;

-- ── 6. RPC: Reserve Match Fee from Vault ────────────────────────────────────
create or replace function public.arena_vault_reserve(
  p_wallet    text,
  p_match_key text,
  p_amount    numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet text := lower(trim(p_wallet));
  v_key    text := trim(p_match_key);
  v_existing public.arena_match_stakes%rowtype;
  v_diff   numeric;
  v_bal    numeric;
begin
  if p_amount <= 0 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('arena_vault:' || v_wallet));

  insert into public.arena_vault_accounts (wallet_address, balance, updated_at)
  values (v_wallet, 0, now())
  on conflict (wallet_address) do nothing;

  select * into v_existing
    from public.arena_match_stakes
   where match_key = v_key and wallet_address = v_wallet
   for update;

  if v_existing.id is not null then
    if v_existing.status = 'committed' then
      raise exception 'MATCH_ALREADY_COMMITTED' using errcode = 'P0001';
    end if;
    if v_existing.status = 'reserved' then
      v_diff := p_amount - v_existing.amount;
      if v_diff = 0 then
        select balance into v_bal from public.arena_vault_accounts where wallet_address = v_wallet;
        return jsonb_build_object('balance', v_bal, 'reserved', p_amount);
      end if;
      update public.arena_vault_accounts
         set balance = balance - v_diff, updated_at = now()
       where wallet_address = v_wallet and balance >= v_diff
      returning balance into v_bal;
      if v_bal is null then
        raise exception 'INSUFFICIENT_VAULT' using errcode = 'P0001';
      end if;
      update public.arena_match_stakes
         set amount = p_amount, updated_at = now()
       where id = v_existing.id;
      return jsonb_build_object('balance', v_bal, 'reserved', p_amount);
    end if;
  end if;

  update public.arena_vault_accounts
     set balance = balance - p_amount, updated_at = now()
   where wallet_address = v_wallet and balance >= p_amount
  returning balance into v_bal;

  if v_bal is null then
    raise exception 'INSUFFICIENT_VAULT' using errcode = 'P0001';
  end if;

  insert into public.arena_match_stakes (match_key, wallet_address, amount, status)
  values (v_key, v_wallet, p_amount, 'reserved')
  on conflict (match_key, wallet_address) do update
    set amount = excluded.amount, status = 'reserved', updated_at = now();

  return jsonb_build_object('balance', v_bal, 'reserved', p_amount);
end;
$$;

-- ── 7. RPC: Release Unused Stake Back to Reusable Vault (0 Gas) ─────────────
create or replace function public.arena_vault_release(
  p_wallet    text,
  p_match_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet text := lower(trim(p_wallet));
  v_key    text := trim(p_match_key);
  v_stake  public.arena_match_stakes%rowtype;
  v_bal    numeric;
begin
  perform pg_advisory_xact_lock(hashtext('arena_vault:' || v_wallet));

  select * into v_stake
    from public.arena_match_stakes
   where match_key = v_key and wallet_address = v_wallet and status = 'reserved'
   for update;

  if v_stake.id is null then
    select balance into v_bal from public.arena_vault_accounts where wallet_address = v_wallet;
    return jsonb_build_object('balance', coalesce(v_bal, 0), 'released', 0);
  end if;

  update public.arena_match_stakes
     set status = 'released', updated_at = now()
   where id = v_stake.id;

  update public.arena_vault_accounts
     set balance = balance + v_stake.amount, updated_at = now()
   where wallet_address = v_wallet
  returning balance into v_bal;

  return jsonb_build_object('balance', coalesce(v_bal, 0), 'released', v_stake.amount);
end;
$$;

-- ── 8. RPC: Commit Reserved Stakes When Match Begins ────────────────────────
create or replace function public.arena_vault_commit_match(
  p_match_keys text[],
  p_match_id   text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_updated int;
begin
  update public.arena_match_stakes
     set status = 'committed', match_id = p_match_id, updated_at = now()
   where match_key = any(p_match_keys) and status = 'reserved';
  get diagnostics v_updated = row_count;
  return jsonb_build_object('committed', v_updated, 'match_id', p_match_id);
end;
$$;

-- ── 9. RPC: Request Pull-Claim Withdrawal from Vault ────────────────────────
create or replace function public.arena_vault_request_withdraw(
  p_wallet text,
  p_amount numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet   text := lower(trim(p_wallet));
  v_bal      numeric;
  v_claim_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('arena_vault:' || v_wallet));

  update public.arena_vault_accounts
     set balance = balance - p_amount, updated_at = now()
   where wallet_address = v_wallet and balance >= p_amount
  returning balance into v_bal;

  if v_bal is null then
    raise exception 'INSUFFICIENT_VAULT' using errcode = 'P0001';
  end if;

  insert into public.arena_vault_claims (wallet_address, claim_type, amount, status)
  values (v_wallet, 'vault_withdraw', p_amount, 'claimable')
  returning id into v_claim_id;

  return jsonb_build_object('balance', v_bal, 'claimId', v_claim_id, 'amount', p_amount);
end;
$$;

-- ── 10. RPC: Move Claimable Match Prize to Vault (0 Gas) ────────────────────
create or replace function public.arena_vault_roll_prize(
  p_wallet   text,
  p_claim_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet text := lower(trim(p_wallet));
  v_claim  public.arena_vault_claims%rowtype;
  v_bal    numeric;
begin
  perform pg_advisory_xact_lock(hashtext('arena_vault:' || v_wallet));

  select * into v_claim
    from public.arena_vault_claims
   where id = p_claim_id and wallet_address = v_wallet and status = 'claimable'
   for update;

  if v_claim.id is null then
    raise exception 'CLAIM_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  update public.arena_vault_claims
     set status = 'rolled', claimed_at = now()
   where id = v_claim.id;

  insert into public.arena_vault_accounts (wallet_address, balance, updated_at)
  values (v_wallet, v_claim.amount, now())
  on conflict (wallet_address) do update
    set balance = public.arena_vault_accounts.balance + v_claim.amount, updated_at = now()
  returning balance into v_bal;

  return jsonb_build_object('balance', v_bal, 'rolledAmount', v_claim.amount);
end;
$$;

-- ── 11. RPC: Settle Match Pot to Winners' Claim Hub ─────────────────────────
create or replace function public.arena_vault_settle_match(
  p_match_id   text,
  p_winners    text[],
  p_shares_bps int[],
  p_rake_bps   int default 500
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_total_pot  numeric;
  v_rake       numeric;
  v_net_pot    numeric;
  v_len        int := coalesce(array_length(p_winners, 1), 0);
  v_i          int;
  v_winner     text;
  v_payout     numeric;
  v_distributed numeric := 0;
begin
  if v_len = 0 or v_len <> coalesce(array_length(p_shares_bps, 1), 0) then
    raise exception 'BAD_WINNERS' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('arena_settle:' || p_match_id));

  select coalesce(sum(amount), 0) into v_total_pot
    from public.arena_match_stakes
   where match_id = p_match_id and status = 'committed';

  if v_total_pot <= 0 then
    return jsonb_build_object('settled', false, 'reason', 'no_committed_pot');
  end if;

  v_rake := floor((v_total_pot * p_rake_bps) / 10000);
  v_net_pot := v_total_pot - v_rake;

  for v_i in 1..v_len loop
    v_winner := lower(trim(p_winners[v_i]));
    if v_i = v_len then
      v_payout := v_net_pot - v_distributed;
    else
      v_payout := floor((v_net_pot * p_shares_bps[v_i]) / 10000);
      v_distributed := v_distributed + v_payout;
    end if;

    if v_payout > 0 then
      insert into public.arena_vault_claims (wallet_address, claim_type, amount, match_id, status)
      values (v_winner, 'match_prize', v_payout, p_match_id, 'claimable');
    end if;
  end loop;

  update public.arena_match_stakes
     set status = 'settled', updated_at = now()
   where match_id = p_match_id and status = 'committed';

  return jsonb_build_object(
    'settled', true,
    'total_pot', v_total_pot,
    'rake', v_rake,
    'net_pot', v_net_pot
  );
end;
$$;

revoke all on function public.arena_vault_credit_deposit(text, numeric, text) from public, anon, authenticated;
revoke all on function public.arena_vault_reserve(text, text, numeric) from public, anon, authenticated;
revoke all on function public.arena_vault_release(text, text) from public, anon, authenticated;
revoke all on function public.arena_vault_commit_match(text[], text) from public, anon, authenticated;
revoke all on function public.arena_vault_request_withdraw(text, numeric) from public, anon, authenticated;
revoke all on function public.arena_vault_roll_prize(text, uuid) from public, anon, authenticated;
revoke all on function public.arena_vault_settle_match(text, text[], int[], int) from public, anon, authenticated;

grant execute on function public.arena_vault_credit_deposit(text, numeric, text) to service_role;
grant execute on function public.arena_vault_reserve(text, text, numeric) to service_role;
grant execute on function public.arena_vault_release(text, text) to service_role;
grant execute on function public.arena_vault_commit_match(text[], text) to service_role;
grant execute on function public.arena_vault_request_withdraw(text, numeric) to service_role;
grant execute on function public.arena_vault_roll_prize(text, uuid) to service_role;
grant execute on function public.arena_vault_settle_match(text, text[], int[], int) to service_role;

commit;
