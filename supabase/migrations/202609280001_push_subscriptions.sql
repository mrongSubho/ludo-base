-- R5 remote push — VAPID subscription store (REAL_WALLET_PLAN).
-- Service-role only: client POSTs through /api/push/* with an app session.

begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists push_subscriptions_wallet_idx
  on public.push_subscriptions (lower(wallet_address));

-- RLS: default deny; service role / API only (same as wallet_links)
alter table public.push_subscriptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'push_subscriptions_service_only'
  ) then
    create policy push_subscriptions_service_only on public.push_subscriptions
      for all to authenticated, anon
      using (false) with check (false);
  end if;
end $$;

commit;
