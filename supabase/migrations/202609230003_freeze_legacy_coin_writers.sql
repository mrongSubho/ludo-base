-- Freeze all legacy players.coins writers (CHIPS cutover).
-- Apply via supabase db push. Coins become display-only.

-- 1) Coin-mutating RPCs throw (keep signatures — do not change return types).
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

create or replace function public.purchase_marketplace(
  p_wallet text, p_kind text, p_items text[], p_total bigint
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

-- 3) Block any coins UPDATE (defense in depth).
create or replace function public.block_coins_mutation()
returns trigger
language plpgsql
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
