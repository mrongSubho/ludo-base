-- Migration: 202611020001_clan_system_core.sql
-- Description: Core Schema for Tactical Clans, Leveling, Stake-Backed Clan Wars, and Pull Claims.
-- Invariants: Strictly service-role access, RLS enabled, 100% pull-based claims (D16), 10,000 CHIPS escrow spend.

begin;

-- ── 1. Update Escrow Ledger Reasons ──────────────────────────────────────────
alter table public.chips_escrow_ledger
  drop constraint if exists chips_escrow_ledger_reason_check;
alter table public.chips_escrow_ledger
  add constraint chips_escrow_ledger_reason_check
  check (reason in
    ('deposit', 'bet_stake', 'bet_payout', 'bet_refund', 'rake', 'withdrawal',
     'purchase', 'sale', 'clan_create', 'clan_rename', 'clan_war_stake'));

-- ── 2. Clan Level Configuration (D1, D10) ───────────────────────────────────
create table if not exists public.clan_level_config (
  level         int primary key,
  cxp_required  bigint not null,
  member_cap    int not null,
  officer_slots int not null,
  unlocks       jsonb not null default '{}'
);

-- Seed Levels 1 to 20
insert into public.clan_level_config (level, cxp_required, member_cap, officer_slots, unlocks)
values
  (1,  0,       20, 2, '{"feature":"hall_chat"}'),
  (2,  1000,    20, 2, '{}'),
  (3,  4000,    22, 2, '{"feature":"war_eligible"}'),
  (4,  9000,    22, 2, '{"feature":"vault_t4"}'),
  (5,  16000,   25, 3, '{"cosmetic":"crest_frame_1"}'),
  (6,  25000,   25, 3, '{}'),
  (7,  36000,   25, 3, '{"feature":"vault_t5"}'),
  (8,  49000,   30, 3, '{"cosmetic":"custom_tag_color"}'),
  (9,  64000,   30, 3, '{}'),
  (10, 81000,   30, 4, '{"cosmetic":"crest_frame_2"}'),
  (11, 100000,  35, 4, '{}'),
  (12, 121000,  35, 4, '{"cosmetic":"animated_banner"}'),
  (13, 144000,  35, 4, '{}'),
  (14, 169000,  40, 5, '{}'),
  (15, 196000,  40, 5, '{"cosmetic":"crest_frame_3"}'),
  (16, 225000,  40, 5, '{}'),
  (17, 256000,  45, 5, '{}'),
  (18, 289000,  45, 5, '{}'),
  (19, 324000,  45, 5, '{}'),
  (20, 361000,  50, 6, '{"cosmetic":"crest_frame_4","feature":"hall_of_fame"}')
on conflict (level) do update
  set cxp_required = excluded.cxp_required,
      member_cap = excluded.member_cap,
      officer_slots = excluded.officer_slots,
      unlocks = excluded.unlocks;

-- ── 3. Clans Master Table ───────────────────────────────────────────────────
create table if not exists public.clans (
  id                uuid primary key default gen_random_uuid(),
  name              varchar(24) not null unique,
  tag               varchar(5) not null unique,
  bio               varchar(200),
  crest             jsonb not null default '{"emblem":"shield","primary":"#00E5FF","secondary":"#0D1117"}',
  leader_wallet     text not null references public.players(wallet_address),
  level             int not null default 1 references public.clan_level_config(level),
  cxp               bigint not null default 0 check (cxp >= 0),
  division          varchar(16) not null default 'Bronze',
  cwr               int not null default 1000,
  join_policy       varchar(16) not null default 'request' check (join_policy in ('open', 'request', 'invite_only')),
  min_rxp           int not null default 0,
  min_level         int not null default 1,
  member_count      int not null default 1,
  treasury_balance  numeric not null default 0 check (treasury_balance >= 0),
  farcaster_channel varchar(64),
  status            varchar(16) not null default 'active' check (status in ('active', 'archived')),
  created_at        timestamptz not null default now(),
  constraint clans_tag_uppercase check (tag = upper(tag)),
  constraint clans_leader_wallet_lower check (leader_wallet = lower(leader_wallet))
);
create index if not exists clans_cwr_idx on public.clans (cwr desc);
create index if not exists clans_level_idx on public.clans (level desc);

-- ── 4. Clan Members ─────────────────────────────────────────────────────────
create table if not exists public.clan_members (
  id             uuid primary key default gen_random_uuid(),
  clan_id        uuid not null references public.clans(id) on delete cascade,
  wallet_address text not null unique references public.players(wallet_address),
  role           varchar(16) not null default 'member' check (role in ('commander', 'officer', 'elite', 'member')),
  weekly_cxp     int not null default 0 check (weekly_cxp >= 0),
  total_cxp      bigint not null default 0 check (total_cxp >= 0),
  war_points     int not null default 0 check (war_points >= 0),
  joined_at      timestamptz not null default now(),
  constraint clan_members_wallet_lower check (wallet_address = lower(wallet_address))
);
create index if not exists clan_members_clan_idx on public.clan_members (clan_id);

-- ── 5. Clan Join Requests ───────────────────────────────────────────────────
create table if not exists public.clan_join_requests (
  id             uuid primary key default gen_random_uuid(),
  clan_id        uuid not null references public.clans(id) on delete cascade,
  wallet_address text not null references public.players(wallet_address),
  status         varchar(16) not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '7 days'),
  unique (clan_id, wallet_address)
);

-- ── 6. Clan Chat (Plaintext, D8) ────────────────────────────────────────────
create table if not exists public.clan_chat (
  id             uuid primary key default gen_random_uuid(),
  clan_id        uuid not null references public.clans(id) on delete cascade,
  wallet_address text not null references public.players(wallet_address),
  sender_name    text not null,
  content        varchar(280) not null check (length(content) > 0),
  created_at     timestamptz not null default now()
);
create index if not exists clan_chat_clan_time_idx on public.clan_chat (clan_id, created_at desc);

-- ── 7. Stake-Backed Clan Wars, Calls & Stakes ───────────────────────────────
create table if not exists public.clan_war_calls (
  id                uuid primary key default gen_random_uuid(),
  clan_id           uuid not null references public.clans(id) on delete cascade,
  bracket           int not null check (bracket in (5, 10, 15, 20)),
  member_fee        numeric not null check (member_fee >= 500),
  stakers_pct       int not null default 50 check (stakers_pct between 0 and 100),
  treasury_pct      int not null default 25 check (treasury_pct between 0 and 100),
  leader_pct        int not null default 15 check (leader_pct between 0 and 50),
  officers_pct      int not null default 10 check (officers_pct between 0 and 50),
  treasury_subsidy  numeric not null default 0 check (treasury_subsidy >= 0),
  booster_buffer    numeric not null default 0 check (booster_buffer >= 0),
  total_stake       numeric not null default 0 check (total_stake >= 0),
  status            varchar(20) not null default 'notice_open' check (status in ('notice_open', 'searching', 'matched', 'cancelled', 'expired')),
  search_expires_at timestamptz,
  created_at        timestamptz not null default now(),
  constraint clan_war_split_sum check (stakers_pct + treasury_pct + leader_pct + officers_pct = 100)
);

create table if not exists public.clan_war_stakes (
  id             uuid primary key default gen_random_uuid(),
  war_call_id    uuid not null references public.clan_war_calls(id) on delete cascade,
  wallet_address text not null references public.players(wallet_address),
  stake_amount   numeric not null check (stake_amount > 0),
  kind           varchar(16) not null default 'member_fee' check (kind in ('member_fee', 'booster', 'treasury_subsidy')),
  status         varchar(20) not null default 'locked' check (status in ('locked', 'claimable_refund', 'settled')),
  created_at     timestamptz not null default now(),
  unique (war_call_id, wallet_address, kind)
);

create table if not exists public.clan_wars (
  id              uuid primary key default gen_random_uuid(),
  clan_a_id       uuid not null references public.clans(id),
  clan_b_id       uuid not null references public.clans(id),
  bracket         int not null check (bracket in (5, 10, 15, 20)),
  stake_per_clan  numeric not null check (stake_per_clan > 0),
  status          varchar(20) not null default 'prep_phase' check (status in ('prep_phase', 'active_war', 'settling', 'completed', 'draw_refunded')),
  matched_at      timestamptz not null default now(),
  war_start_at    timestamptz not null,
  war_end_at      timestamptz not null,
  winner_clan_id  uuid references public.clans(id),
  clan_a_score    int not null default 0,
  clan_b_score    int not null default 0,
  created_at      timestamptz not null default now()
);

-- ── 8. Fixtures Matrix & Scheduling (3N Table) ──────────────────────────────
create table if not exists public.clan_war_fixtures (
  id              uuid primary key default gen_random_uuid(),
  war_id          uuid not null references public.clan_wars(id) on delete cascade,
  fixture_index   int not null,
  game_shape      varchar(8) not null check (game_shape in ('1v1', '2v2')),
  clan_a_seats    text[] not null,
  clan_b_seats    text[] not null,
  scheduled_at    timestamptz,
  status          varchar(24) not null default 'unscheduled' check (status in ('unscheduled', 'scheduled_agreed', 'reschedule_pending', 'in_progress', 'completed', 'walkover', 'mutual_void')),
  winner_clan_id  uuid references public.clans(id),
  match_id        text,
  created_at      timestamptz not null default now(),
  unique (war_id, fixture_index)
);
create index if not exists clan_war_fixtures_war_idx on public.clan_war_fixtures (war_id, fixture_index);

-- ── 9. Clan War Points Ledger ───────────────────────────────────────────────
create table if not exists public.clan_war_points (
  id             uuid primary key default gen_random_uuid(),
  war_id         uuid not null references public.clan_wars(id) on delete cascade,
  fixture_id     uuid not null references public.clan_war_fixtures(id) on delete cascade,
  clan_id        uuid not null references public.clans(id) on delete cascade,
  wallet_address text not null references public.players(wallet_address),
  wp_amount      int not null check (wp_amount > 0),
  kind           varchar(24) not null check (kind in ('base_win', 'walkover', 'loss', 'capture', 'home_sweep', 'underdog', 'perfect_slate', 'mobilization')),
  created_at     timestamptz not null default now(),
  unique (war_id, fixture_id, wallet_address, kind)
);

-- ── 10. Universal Pull-Based Claims Ledger (D16) ───────────────────────────
create table if not exists public.clan_claims (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.players(wallet_address),
  clan_id        uuid not null references public.clans(id),
  claim_type     varchar(24) not null check (claim_type in ('war_principal', 'war_merit_wp', 'war_gov_share', 'war_refund', 'weekly_vault', 'treasury_grant')),
  amount         numeric not null check (amount > 0),
  source_id      uuid not null,
  status         varchar(16) not null default 'claimable' check (status in ('claimable', 'claimed')),
  tx_hash        text,
  created_at     timestamptz not null default now(),
  claimed_at     timestamptz
);
create index if not exists clan_claims_wallet_idx on public.clan_claims (wallet_address, status);

-- ── 11. Clan Treasury Ledger ────────────────────────────────────────────────
create table if not exists public.clan_treasury_ledger (
  id             uuid primary key default gen_random_uuid(),
  clan_id        uuid not null references public.clans(id) on delete cascade,
  amount         numeric not null,
  reason         varchar(32) not null check (reason in ('war_cut', 'donation', 'subsidy_return', 'war_subsidy', 'stake_adjust_topup', 'member_grant', 'clan_upgrade')),
  ref            text,
  created_at     timestamptz not null default now()
);

-- ── 12. Match Scoring Queue (Outbox Pattern) ────────────────────────────────
create table if not exists public.clan_score_queue (
  id             uuid primary key default gen_random_uuid(),
  match_id       text not null unique,
  war_id         uuid references public.clan_wars(id),
  fixture_id     uuid references public.clan_war_fixtures(id),
  status         varchar(16) not null default 'pending' check (status in ('pending', 'processed', 'error')),
  attempts       int not null default 0,
  created_at     timestamptz not null default now(),
  processed_at   timestamptz
);

-- ── 13. Enable RLS & Revoke All from Public/Authenticated ───────────────────
alter table public.clan_level_config enable row level security;
alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_join_requests enable row level security;
alter table public.clan_chat enable row level security;
alter table public.clan_war_calls enable row level security;
alter table public.clan_war_stakes enable row level security;
alter table public.clan_wars enable row level security;
alter table public.clan_war_fixtures enable row level security;
alter table public.clan_war_points enable row level security;
alter table public.clan_claims enable row level security;
alter table public.clan_treasury_ledger enable row level security;
alter table public.clan_score_queue enable row level security;

revoke all on public.clan_level_config, public.clans, public.clan_members,
               public.clan_join_requests, public.clan_chat, public.clan_war_calls,
               public.clan_war_stakes, public.clan_wars, public.clan_war_fixtures,
               public.clan_war_points, public.clan_claims, public.clan_treasury_ledger,
               public.clan_score_queue
from anon, authenticated;

-- ── 14. Atomic RPC: clan_create_with_escrow ────────────────────────────────
create or replace function public.clan_create_with_escrow(
  p_leader_wallet text,
  p_name          text,
  p_tag           text,
  p_bio           text,
  p_crest         jsonb,
  p_request_id    text,
  p_fee_base      numeric default 10000000000000000000000 -- 10,000 CHIPS in 1e18
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg        public.chips_escrow_config%rowtype;
  v_leader   text := lower(trim(p_leader_wallet));
  v_name     text := trim(p_name);
  v_tag      text := upper(trim(p_tag));
  v_treasury text;
  v_new_bal  numeric;
  v_clan_id  uuid;
  v_result   jsonb;
begin
  select * into cfg from public.chips_escrow_config where id for update;
  if not cfg.enabled then
    raise exception 'ESCROW_DISABLED' using errcode = 'P0001';
  end if;
  if cfg.treasury_wallet is null then
    raise exception 'TREASURY_UNSET' using errcode = 'P0001';
  end if;
  if v_name is null or length(v_name) < 3 or length(v_name) > 24 then
    raise exception 'BAD_NAME' using errcode = 'P0001';
  end if;
  if v_tag is null or length(v_tag) < 3 or length(v_tag) > 5 then
    raise exception 'BAD_TAG' using errcode = 'P0001';
  end if;

  -- Ensure leader has an active player row
  if not exists (select 1 from public.players where wallet_address = v_leader) then
    raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Ensure leader is not already in a clan
  if exists (select 1 from public.clan_members where wallet_address = v_leader) then
    raise exception 'ALREADY_IN_CLAN' using errcode = 'P0001';
  end if;

  -- Lock buyer escrow
  perform pg_advisory_xact_lock(hashtext(v_leader));

  -- Debit creation fee from buyer's escrow
  perform public.chips_escrow_touch(v_leader);
  update public.chips_escrow_accounts
     set balance = balance - p_fee_base, updated_at = now()
   where wallet_address = v_leader and balance >= p_fee_base
   returning balance into v_new_bal;

  if v_new_bal is null then
    raise exception 'INSUFFICIENT_ESCROW' using errcode = 'P0001';
  end if;

  insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
  values (v_leader, -p_fee_base, 'clan_create', 'clan_create:' || p_request_id);

  -- Credit protocol treasury with 100% of creation fee (D5)
  v_treasury := lower(cfg.treasury_wallet);
  perform public.chips_escrow_touch(v_treasury);
  update public.chips_escrow_accounts
     set balance = balance + p_fee_base, updated_at = now()
   where wallet_address = v_treasury;

  insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
  values (v_treasury, p_fee_base, 'clan_create', 'clan_create_credit:' || v_leader || ':' || p_request_id)
  on conflict (wallet_address, reason, ref) do nothing;

  -- Create clan record
  insert into public.clans (name, tag, bio, crest, leader_wallet, level, member_count)
  values (v_name, v_tag, p_bio, coalesce(p_crest, '{"emblem":"shield","primary":"#00E5FF","secondary":"#0D1117"}'::jsonb), v_leader, 1, 1)
  returning id into v_clan_id;

  -- Insert leader as commander
  insert into public.clan_members (clan_id, wallet_address, role)
  values (v_clan_id, v_leader, 'commander');

  select jsonb_build_object(
    'clan_id', v_clan_id,
    'name', v_name,
    'tag', v_tag,
    'leader_wallet', v_leader,
    'remaining_escrow', v_new_bal
  ) into v_result;

  return v_result;
end;
$$;

commit;
