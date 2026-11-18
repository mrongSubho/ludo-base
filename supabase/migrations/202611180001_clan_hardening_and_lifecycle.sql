-- Migration: 202611180001_clan_hardening_and_lifecycle.sql
-- Description: Atomic CXP/WP/member-count RPCs, atomic war-call matching,
--              bilateral fixture scheduling columns, claim idempotency index,
--              clan mission progress table, and private realtime policies.

begin;

-- ── 1. War Call Linkage & Bilateral Fixture Scheduling Columns ───────────────
alter table public.clan_wars
  add column if not exists clan_a_call_id uuid references public.clan_war_calls(id),
  add column if not exists clan_b_call_id uuid references public.clan_war_calls(id);

alter table public.clan_war_fixtures
  add column if not exists proposed_by text,
  add column if not exists proposed_at timestamptz;

-- Prevent duplicate claim rows for the same (wallet, claim_type, source_id)
create unique index if not exists clan_claims_unique_source_idx
  on public.clan_claims (wallet_address, claim_type, source_id);

-- ── 2. Clan Mission Progress Table (Daily Contracts & Weekly Objectives) ─────
create table if not exists public.clan_mission_progress (
  id             uuid primary key default gen_random_uuid(),
  clan_id        uuid not null references public.clans(id) on delete cascade,
  wallet_address text not null references public.players(wallet_address),
  mission_key    varchar(48) not null,
  period_key     varchar(24) not null,
  progress       int not null default 0 check (progress >= 0),
  target         int not null check (target > 0),
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (clan_id, wallet_address, mission_key, period_key)
);

alter table public.clan_mission_progress enable row level security;
revoke all on public.clan_mission_progress from anon, authenticated;

-- ── 3. Atomic RPC: increment_member_cxp_wp ───────────────────────────────────
create or replace function public.increment_member_cxp_wp(
  p_clan_id uuid,
  p_wallet  text,
  p_wp      int default 0,
  p_cxp     int default 0
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clan_members
     set war_points = greatest(0, war_points + coalesce(p_wp, 0)),
         weekly_cxp = greatest(0, weekly_cxp + coalesce(p_cxp, 0)),
         total_cxp  = greatest(0, total_cxp + coalesce(p_cxp, 0))
   where clan_id = p_clan_id
     and wallet_address = lower(trim(p_wallet));
end;
$$;

revoke all on function public.increment_member_cxp_wp(uuid, text, int, int) from public;
grant execute on function public.increment_member_cxp_wp(uuid, text, int, int) to service_role;

-- ── 4. Atomic RPC: increment_clan_cxp (with automatic level-up) ──────────────
create or replace function public.increment_clan_cxp(
  p_clan_id   uuid,
  p_cxp_delta int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_new_cxp   bigint;
  v_cur_level int;
  v_new_level int;
begin
  update public.clans
     set cxp = greatest(0, cxp + coalesce(p_cxp_delta, 0))
   where id = p_clan_id
   returning cxp, level into v_new_cxp, v_cur_level;

  if v_new_cxp is null then
    return jsonb_build_object('cxp', 0, 'level', 1);
  end if;

  select coalesce(max(level), v_cur_level)
    into v_new_level
    from public.clan_level_config
   where cxp_required <= v_new_cxp;

  if v_new_level > v_cur_level then
    update public.clans
       set level = v_new_level
     where id = p_clan_id;
  else
    v_new_level := v_cur_level;
  end if;

  return jsonb_build_object('cxp', v_new_cxp, 'level', v_new_level);
end;
$$;

revoke all on function public.increment_clan_cxp(uuid, int) from public;
grant execute on function public.increment_clan_cxp(uuid, int) to service_role;

-- ── 5. Atomic RPC: clan_adjust_member_count ──────────────────────────────────
create or replace function public.clan_adjust_member_count(
  p_clan_id uuid,
  p_delta   int
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  update public.clans
     set member_count = greatest(0, member_count + coalesce(p_delta, 0))
   where id = p_clan_id
   returning member_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.clan_adjust_member_count(uuid, int) from public;
grant execute on function public.clan_adjust_member_count(uuid, int) to service_role;

-- ── 6. Atomic RPC: clan_credit_treasury_donation ─────────────────────────────
create or replace function public.clan_credit_treasury_donation(
  p_clan_id uuid,
  p_wallet  text,
  p_amount  numeric,
  p_tx_hash text
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_new_bal numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;

  update public.clans
     set treasury_balance = treasury_balance + p_amount
   where id = p_clan_id
     and status = 'active'
   returning treasury_balance into v_new_bal;

  if v_new_bal is null then
    raise exception 'CLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.clan_treasury_ledger (clan_id, amount, reason, ref)
  values (p_clan_id, p_amount, 'donation', lower(trim(p_wallet)) || ':' || trim(p_tx_hash));

  return v_new_bal;
end;
$$;

revoke all on function public.clan_credit_treasury_donation(uuid, text, numeric, text) from public;
grant execute on function public.clan_credit_treasury_donation(uuid, text, numeric, text) to service_role;

-- ── 7. Atomic RPC: clan_match_war_calls ──────────────────────────────────────
create or replace function public.clan_match_war_calls(
  p_call_a_id uuid,
  p_call_b_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_first_id  uuid;
  v_second_id uuid;
  v_call_a    public.clan_war_calls%rowtype;
  v_call_b    public.clan_war_calls%rowtype;
  v_stake     numeric;
  v_war_start timestamptz := now() + interval '48 hours';
  v_war_end   timestamptz := now() + interval '96 hours';
  v_war       public.clan_wars%rowtype;
begin
  if p_call_a_id = p_call_b_id then
    raise exception 'SELF_MATCH_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  -- Lock in deterministic order to avoid deadlocks
  if p_call_a_id < p_call_b_id then
    v_first_id := p_call_a_id;
    v_second_id := p_call_b_id;
  else
    v_first_id := p_call_b_id;
    v_second_id := p_call_a_id;
  end if;

  perform 1 from public.clan_war_calls where id = v_first_id for update;
  perform 1 from public.clan_war_calls where id = v_second_id for update;

  select * into v_call_a from public.clan_war_calls where id = p_call_a_id;
  select * into v_call_b from public.clan_war_calls where id = p_call_b_id;

  if v_call_a.id is null or v_call_b.id is null then
    raise exception 'CALL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_call_a.clan_id = v_call_b.clan_id then
    raise exception 'SELF_MATCH_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if v_call_a.bracket <> v_call_b.bracket then
    raise exception 'BRACKET_MISMATCH' using errcode = 'P0001';
  end if;
  if v_call_a.status <> 'searching' or v_call_b.status <> 'searching' then
    raise exception 'CALL_NOT_SEARCHING' using errcode = 'P0001';
  end if;

  v_stake := least(v_call_a.total_stake, v_call_b.total_stake);
  if v_stake <= 0 then
    raise exception 'ZERO_STAKE' using errcode = 'P0001';
  end if;

  update public.clan_war_calls
     set status = 'matched'
   where id in (p_call_a_id, p_call_b_id);

  insert into public.clan_wars (
    clan_a_id,
    clan_b_id,
    clan_a_call_id,
    clan_b_call_id,
    bracket,
    stake_per_clan,
    status,
    war_start_at,
    war_end_at
  ) values (
    v_call_a.clan_id,
    v_call_b.clan_id,
    v_call_a.id,
    v_call_b.id,
    v_call_a.bracket,
    v_stake,
    'prep_phase',
    v_war_start,
    v_war_end
  )
  returning * into v_war;

  return to_jsonb(v_war);
end;
$$;

revoke all on function public.clan_match_war_calls(uuid, uuid) from public;
grant execute on function public.clan_match_war_calls(uuid, uuid) to service_role;

-- ── 8. Private Realtime Authorization for Clan & War Channels ────────────────
do $mig$
declare
  owns_realtime boolean := has_schema_privilege(current_user, 'realtime', 'CREATE');
begin
  if not owns_realtime then
    raise warning
      'private-realtime clan extension NOT APPLIED: role % lacks CREATE on realtime.',
      current_user;
    return;
  end if;

  if to_regclass('realtime.messages') is not null then
    drop policy if exists "realtime_messages_select" on realtime.messages;
    create policy "realtime_messages_select"
    on realtime.messages
    for select
    using (
      auth.role() = 'service_role'
      or (auth.role() = 'authenticated' and (
        topic like 'match:%'
        or topic like 'game-room-%'
        or topic like 'clan-%'
        or topic like 'clan-war-%'
      ))
      or topic like 'match:%'
    );

    drop policy if exists "realtime_messages_insert" on realtime.messages;
    create policy "realtime_messages_insert"
    on realtime.messages
    for insert
    with check (
      auth.role() = 'service_role'
      or (auth.role() = 'authenticated' and (
        topic like 'match:%'
        or topic like 'game-room-%'
        or topic like 'clan-%'
        or topic like 'clan-war-%'
      ))
    );
  end if;
end
$mig$;

commit;
