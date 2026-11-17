-- ── Migration: 202611020002_clan_create_escrow_overload.sql ────────────────
-- Fixes clan_create_with_escrow RPC signature:
-- 1. Sets default gen_random_uuid()::text for p_request_id
-- 2. Sets default null for p_bio and default shield crest for p_crest
-- 3. Adjusts tag validation to between 2 and 5 chars (matching UI "Clan Tag 2-5 chars")
-- 4. Grants execute to authenticated and service_role

begin;

create or replace function public.clan_create_with_escrow(
  p_leader_wallet text,
  p_name          text,
  p_tag           text,
  p_bio           text default null,
  p_crest         jsonb default '{"emblem":"shield","primary":"#00E5FF","secondary":"#0D1117"}'::jsonb,
  p_request_id    text default gen_random_uuid()::text,
  p_fee_base      numeric default 10000000000000000000000 -- 10,000 CHIPS in 1e18
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg        public.chips_escrow_config%rowtype;
  v_leader   text := lower(trim(p_leader_wallet));
  v_name     text := trim(p_name);
  v_tag      text := upper(trim(p_tag));
  v_req_id   text := coalesce(p_request_id, gen_random_uuid()::text);
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
  if v_tag is null or length(v_tag) < 2 or length(v_tag) > 5 then
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
  values (v_leader, -p_fee_base, 'clan_create', 'clan_create:' || v_req_id);

  -- Credit protocol treasury with 100% of creation fee (D5)
  v_treasury := lower(cfg.treasury_wallet);
  perform public.chips_escrow_touch(v_treasury);
  update public.chips_escrow_accounts
     set balance = balance + p_fee_base, updated_at = now()
   where wallet_address = v_treasury;

  insert into public.chips_escrow_ledger (wallet_address, delta, reason, ref)
  values (v_treasury, p_fee_base, 'clan_create', 'clan_create_credit:' || v_leader || ':' || v_req_id)
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

revoke all on function public.clan_create_with_escrow(text, text, text, text, jsonb, text, numeric) from public;
grant execute on function public.clan_create_with_escrow(text, text, text, text, jsonb, text, numeric) to authenticated, service_role;

commit;
