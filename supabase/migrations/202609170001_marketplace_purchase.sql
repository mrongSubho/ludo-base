create table if not exists public.marketplace_purchases (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  request_id text not null,
  item_ids jsonb not null,
  total bigint not null check (total > 0),
  created_at timestamptz not null default now(),
  unique(wallet_address, request_id)
);
alter table public.marketplace_purchases enable row level security;
revoke all on public.marketplace_purchases from anon, authenticated;

create or replace function public.purchase_marketplace(
  p_wallet text, p_request_id text, p_item_ids text[], p_total bigint
) returns jsonb language plpgsql security definer set search_path = public as $$
declare current_balance bigint; prior jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(lower(p_wallet)));
  select jsonb_build_object('balance', coins) into prior
    from marketplace_purchases mp join players p on p.wallet_address = mp.wallet_address
    where mp.wallet_address = lower(p_wallet) and mp.request_id = p_request_id;
  if prior is not null then return prior; end if;
  update players set coins = coins - p_total
    where wallet_address = lower(p_wallet) and coins >= p_total
    returning coins into current_balance;
  if not found then raise exception 'insufficient coins'; end if;
  insert into marketplace_purchases(wallet_address, request_id, item_ids, total)
    values (lower(p_wallet), p_request_id, to_jsonb(p_item_ids), p_total)
    on conflict (wallet_address, request_id) do nothing;
  if current_balance is null then
    select coins into current_balance from players where wallet_address = lower(p_wallet);
  end if;
  return jsonb_build_object('balance', current_balance);
end; $$;

revoke execute on function public.purchase_marketplace(text, text, text[], bigint) from public, anon, authenticated;
grant execute on function public.purchase_marketplace(text, text, text[], bigint) to service_role;
