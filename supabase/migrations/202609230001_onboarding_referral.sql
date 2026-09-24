-- Onboarding / referral support (CHIPS_PLANNING 7.7)
-- Apply manually via Supabase SQL editor or Management API.

create table if not exists public.referral_links (
  referrer_wallet text not null references public.players(wallet_address) on delete cascade,
  referee_wallet text not null references public.players(wallet_address) on delete cascade,
  code text not null,
  status text not null default 'pending'
    check (status in ('pending','successful','unsuccessful')),
  tier_paid int check (tier_paid is null or tier_paid in (50, 10)),
  claim_tx text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (referrer_wallet, referee_wallet),
  check (referrer_wallet <> referee_wallet)
);

create index if not exists referral_links_referrer_idx
  on public.referral_links(referrer_wallet, status);

create table if not exists public.onboarding_progress (
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  track text not null check (track in ('tutorial','ai_classic','ai_power','ai_snakes','pvp','playtime','social','day2','day3','friend_dm','clan')),
  progress int not null default 0,
  target int not null default 1,
  is_claimed boolean not null default false,
  voucher_id text,
  updated_at timestamptz not null default now(),
  primary key (wallet_address, track)
);

create table if not exists public.mission_vouchers (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.players(wallet_address) on delete cascade,
  mission_id text not null,
  period_id text not null,
  amount numeric not null check (amount > 0),
  signature text not null,
  deadline timestamptz not null,
  claimed_tx text,
  created_at timestamptz not null default now(),
  unique (wallet_address, mission_id, period_id)
);

-- RLS: default deny; service role only for writes.
alter table public.referral_links enable row level security;
alter table public.onboarding_progress enable row level security;
alter table public.mission_vouchers enable row level security;
