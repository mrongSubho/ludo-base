-- W3 — optional wallet linking (DUAL_PATH_WALLET_PLAN §3.3)
-- Two wallets opt in; progression is NOT auto-merged (separate players rows until product says otherwise).
-- CHIPS funds never move on link.

begin;

create table if not exists public.wallet_links (
  id uuid primary key default gen_random_uuid(),
  primary_wallet text not null,
  linked_wallet text not null,
  link_type text not null default 'external_ingingame',
  created_at timestamptz not null default now(),
  constraint wallet_links_distinct check (lower(primary_wallet) <> lower(linked_wallet)),
  constraint wallet_links_unique unique (primary_wallet, linked_wallet)
);

create index if not exists wallet_links_primary_idx on public.wallet_links (lower(primary_wallet));
create index if not exists wallet_links_linked_idx on public.wallet_links (lower(linked_wallet));

-- RLS: default deny; service role / API only (consistent with players wallet-only app)
alter table public.wallet_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'wallet_links' and policyname = 'wallet_links_service_only'
  ) then
    create policy wallet_links_service_only on public.wallet_links
      for all to authenticated, anon
      using (false) with check (false);
  end if;
end $$;

commit;
