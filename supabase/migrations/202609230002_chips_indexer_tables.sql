-- CHIPS indexer cache (planning 8.3) — apply via SQL editor
create table if not exists public.chips_events (
  chain_id int not null,
  tx_hash text not null,
  log_index int not null,
  event_name text not null,
  wallet_address text,
  amount numeric,
  memo_bytes32 text,
  memo_tag text,
  payload jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index)
);

create table if not exists public.chips_pools (
  pool_id text primary key,
  match_id text,
  room_code text,
  game_mode text,
  entry_fee numeric,
  max_seats int,
  filled_seats int,
  status text,
  gross numeric, protocol_fee numeric, burn numeric, prize_fund numeric,
  chain_id int, tx_create text,
  settled_at timestamptz, settle_tx text,
  result_hash text,
  host_bond numeric,
  settle_by timestamptz,
  claim_unlock_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.chips_pool_seats (
  pool_id text not null,
  seat_index int not null,
  wallet_address text not null,
  join_tx text,
  entry_amount numeric,
  credited_amount numeric,
  claimed_tx text,
  primary key (pool_id, wallet_address)
);

create table if not exists public.chips_claimable (
  wallet_address text not null,
  source text not null,
  ref_id text not null,
  amount numeric not null,
  status text not null default 'credited' check (status in ('credited','claimed')),
  claim_tx text,
  credited_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (wallet_address, source, ref_id)
);

alter table public.chips_events enable row level security;
alter table public.chips_pools enable row level security;
alter table public.chips_pool_seats enable row level security;
alter table public.chips_claimable enable row level security;
