-- CHIPS marketplace rail (Phase 0 exit / CHIPS migration).
--
-- WHY: `/api/marketplace/purchase` calls the frozen `purchase_marketplace`
-- coins RPC and returns 409 with a raw LEGACY_COINS_FROZEN message. Coins are
-- frozen (202609300001); cosmetics need a CHIPS path or the caller goes.
-- This is the CHIPS path: spend freshly-deposited escrow CHIPS, not coins.
--
-- MODEL — purchase-intent, no contract:
--   * Prices are whole CHIPS, server-owned in the route (the client submits
--     SKU ids only). Amounts move in base units (numeric, 1e18).
--   * The buyer signs a canonical purchase-intent message
--     (`lib/purchaseIntent.ts`) over {buyer, itemIds, total, requestId,
--     issuedAt}; the route verifies session + signature + freshness before
--     calling the RPC. The signature is non-repudiation for a value-moving
--     debit; the idempotency key is `requestId`.
--   * Funding is the buyer's `chips_escrow_accounts` balance (deposited CHIPS
--     via `chips_escrow_deposit`, reconciled against `chips_events` by the
--     indexer — same funding model as spectator bets). The full price is
--     credited to `chips_escrow_config.treasury_wallet` as sale revenue.
--   * Ownership stays local (`lib/inventory.ts`); the server row in
--     `chips_marketplace_purchases` is the proof-of-payment, mirroring the
--     old `marketplace_purchases` shape with a numeric total.
--
-- GATES (same as the bet RPCs): config `enabled` interlock, per-wallet
-- advisory lock, conditional debit (no overdraft under concurrency),
-- idempotent replay on (wallet, request_id), service_role-only.

begin;

-- ── 1. Proof-of-payment table ──────────────────────────────────────────
create table if not exists public.chips_marketplace_purchases (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  request_id     text not null,
  item_ids       jsonb not null,
  total_base     numeric not null check (total_base > 0),
  created_at     timestamptz not null default now(),
  unique (wallet_address, request_id)
);
alter table public.chips_marketplace_purchases enable row level security;
revoke all on public.chips_marketplace_purchases from anon, authenticated;

-- ── 2. Ledger reasons for the purchase legs ────────────────────────────
alter table public.chips_escrow_ledger
  drop constraint if exists chips_escrow_ledger_reason_check;
alter table public.chips_escrow_ledger
  add constraint chips_escrow_ledger_reason_check
  check (reason in
    ('deposit', 'bet_stake', 'bet_payout', 'bet_refund', 'rake', 'withdrawal',
     'purchase', 'sale'));

-- ── 3. Spend RPC: atomic debit + treasury credit + proof row ────────────
create or replace function public.chips_escrow_spend_purchase(
  p_wallet      text,
  p_request_id  text,
  p_item_ids    text[],
  p_total_base  numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg      public.chips_escrow_config%rowtype;
  buyer    text := lower(p_wallet);
  treasury text;
  new_bal  numeric;
  prior    jsonb;
begin
  select * into cfg from public.chips_escrow_config where id for update;
  if not cfg.enabled then
    raise exception 'ESCROW_DISABLED' using errcode = 'P0001';
  end if;
  if cfg.treasury_wallet is null then
    raise exception 'TREASURY_UNSET' using errcode = 'P0001';
  end if;
  if p_total_base is null or p_total_base <= 0 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null
     or array_length(p_item_ids, 1) > 30 then
    raise exception 'BAD_ITEMS' using errcode = 'P0001';
  end if;

  -- Serialize per buyer: the prior-purchase check below is only an
  -- idempotency replay because concurrent same-key calls queue here.
  perform pg_advisory_xact_lock(hashtext(buyer));

  -- Idempotent replay: same (wallet, request_id) returns the original
  -- balance instead of debiting twice (e.g. a retried request).
  select jsonb_build_object('balance', a.balance, 'idempotent', true) into prior
    from public.chips_marketplace_purchases mp
    join public.chips_escrow_accounts a on a.wallet_address = mp.wallet_address
   where mp.wallet_address = buyer and mp.request_id = p_request_id;
  if prior is not null then return prior; end if;

  -- Conditional debit: 0 rows means insufficient funds. No read-then-write.
  perform public.chips_escrow_touch(buyer);
  update public.chips_escrow_accounts
     set balance = balance - p_total_base, updated_at = now()
   where wallet_address = buyer and balance >= p_total_base
   returning balance into new_bal;
  if new_bal is null then
    raise exception 'INSUFFICIENT_ESCROW' using errcode = 'P0001';
  end if;

  insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
  values (buyer, -p_total_base, 'purchase', 'purchase:' || p_request_id);

  -- Full price to the treasury as sale revenue (purchases are not raked;
  -- the rake applies to bet payouts in chips_escrow_settle_bets).
  treasury := lower(cfg.treasury_wallet);
  perform public.chips_escrow_touch(treasury);
  update public.chips_escrow_accounts
     set balance = balance + p_total_base, updated_at = now()
   where wallet_address = treasury;
  insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
  values (treasury, p_total_base, 'sale', 'sale:' || buyer || ':' || p_request_id)
  on conflict (wallet_address, reason, ref) do nothing;

  insert into public.chips_marketplace_purchases
    (wallet_address, request_id, item_ids, total_base)
  values (buyer, p_request_id, to_jsonb(p_item_ids), p_total_base)
  on conflict (wallet_address, request_id) do nothing;

  return jsonb_build_object('balance', new_bal, 'idempotent', false);
end;
$$;

-- service_role only (PUBLIC gets EXECUTE by default on new functions).
revoke execute on function public.chips_escrow_spend_purchase(text, text, text[], numeric) from public, anon, authenticated;
grant execute on function public.chips_escrow_spend_purchase(text, text, text[], numeric) to service_role;

commit;
