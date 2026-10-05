-- Corrective re-application of the legacy coin freeze.
--
-- WHY THIS EXISTS: 202609230003_freeze_legacy_coin_writers.sql raised
--   ERROR: cannot change name of input parameter "p_request_id"
-- at its purchase_marketplace stub (it renamed p_request_id -> p_kind and
-- p_item_ids -> p_items). That file was NOT wrapped in a transaction, so
-- statements after the failure were silently skipped. Net effect in every
-- environment that applied it:
--
--   cash_out_bet              frozen   (line 5 ran)
--   settle_match_bets         frozen   (line 14 ran)
--   purchase_marketplace      NOT frozen
--   block_coins_mutation()    DOES NOT EXIST
--   players_coins_frozen      ABSENT  -> players.coins has no DB-level guard
--
-- 202609230003 has been corrected in place (correct arg names + explicit
-- transaction) so fresh installs are right. This migration re-applies the
-- freeze idempotently so already-migrated environments converge too.
--
-- Idempotent by construction: every statement is CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER, or a COMMENT ON.
-- Safe to run against an environment where the freeze already fully applied.
--
-- See docs/ops/SYSTEM_REVIEW.md DB-01 / DB-03.

begin;

-- 1) Coin-mutating RPCs throw.
--
-- purchase_marketplace needs an explicit DROP first. Production carries the
-- signature from the broken revision of 202609230003 —
--   (p_wallet text, p_kind text, p_items text[], p_total bigint)
-- — because that statement succeeded there before the file later failed on the
-- revoke step, and the CLI recorded 202609230003 as applied regardless. A
-- CREATE OR REPLACE naming p_request_id/p_item_ids against that function
-- raises `cannot change name of input parameter "p_kind"` and aborts the whole
-- transaction (SQLSTATE 42P13).
--
-- Dropping by type signature (not by name) is what makes this work in all three
-- states: fresh install (canonical names from 202609170001), production (p_kind
-- names), or already-corrected. It also normalises production back onto the
-- canonical argument names so PostgREST named-arg calls resolve.
drop function if exists public.purchase_marketplace(text, text, text[], bigint);

create or replace function public.cash_out_bet(p_bet_id uuid, p_player_id text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'LEGACY_COINS_FROZEN';
end;
$$;

create or replace function public.settle_match_bets(
  p_match_id uuid, p_result text, p_bet_type text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'LEGACY_COINS_FROZEN';
end;
$$;

create function public.purchase_marketplace(
  p_wallet text, p_request_id text, p_item_ids text[], p_total bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'LEGACY_COINS_FROZEN';
end;
$$;

-- 2) Revoke execute on any coin entry RPC (ignore missing signatures).
do $$
declare fn text;
begin
  for fn in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('cash_out_bet','settle_match_bets','purchase_marketplace','join_tournament')
  loop
    begin
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    exception when others then
      null;
    end;
  end loop;
end $$;

-- 3) Block any coins UPDATE (defense in depth). This is the statement that
--    never ran anywhere before this migration.
create or replace function public.block_coins_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.coins is distinct from old.coins then
    raise exception 'LEGACY_COINS_FROZEN';
  end if;
  return new;
end;
$$;

drop trigger if exists players_coins_frozen on public.players;
create trigger players_coins_frozen
  before update on public.players
  for each row execute function public.block_coins_mutation();

comment on column public.players.coins is
  'FROZEN 2026-09-22: display mirror only. CHIPS on-chain is money. Trigger blocks mutation.';

commit;
