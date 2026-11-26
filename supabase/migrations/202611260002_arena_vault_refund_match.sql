-- ============================================================================
-- Migration: 202611260002_arena_vault_refund_match.sql
-- Description: Atomic 100% ArenaVault refund RPC for dead/aborted matches
--              invoked by MatchRoom DO under the 30s dead-match abort SLO.
-- ============================================================================

begin;

create or replace function public.arena_vault_refund_match(
  p_match_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stake public.arena_match_stakes%rowtype;
  v_count int := 0;
  v_total numeric := 0;
  v_ref   text;
begin
  perform pg_advisory_xact_lock(hashtext('arena_settle:' || p_match_id));

  for v_stake in
    select *
      from public.arena_match_stakes
     where match_id = p_match_id
       and status = 'committed'
     order by id
     for update
  loop
    perform pg_advisory_xact_lock(hashtext('arena_vault:' || v_stake.wallet_address));

    update public.arena_match_stakes
       set status = 'released',
           updated_at = now()
     where id = v_stake.id;

    insert into public.arena_vault_accounts (wallet_address, balance, updated_at)
    values (v_stake.wallet_address, v_stake.amount, now())
    on conflict (wallet_address) do update
      set balance = public.arena_vault_accounts.balance + v_stake.amount,
          updated_at = now();

    v_ref := 'match_refund:' || p_match_id || ':' || v_stake.id::text;
    insert into public.arena_vault_ledger (wallet_address, delta, reason, ref)
    values (v_stake.wallet_address, v_stake.amount, 'match_refund', v_ref)
    on conflict (wallet_address, reason, ref) do nothing;

    v_count := v_count + 1;
    v_total := v_total + v_stake.amount;
  end loop;

  if v_count = 0 then
    return jsonb_build_object(
      'refunded', false,
      'reason', 'no_committed_stakes',
      'refunded_count', 0,
      'refunded_total', 0,
      'match_id', p_match_id
    );
  end if;

  return jsonb_build_object(
    'refunded', true,
    'refunded_count', v_count,
    'refunded_total', v_total,
    'match_id', p_match_id
  );
end;
$$;

revoke all on function public.arena_vault_refund_match(text) from public, anon, authenticated;
grant execute on function public.arena_vault_refund_match(text) to service_role;

commit;
