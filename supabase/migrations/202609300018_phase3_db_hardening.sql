-- Phase 3 DB hardening: chat cap alignment, dead realtime channel, players
-- tamper trigger (DB-16, CRY-08, DB-24).
begin;

-- ── DB-16 ──────────────────────────────────────────────────────────────
-- `live_chat.content` CHECK 1000 → 500, matching MAX_CHAT_LEN in
-- lib/constants.ts (the route already slices to it). One constant, not two
-- numbers. Safe to validate: production max content length measured 66 chars
-- across all 39 rows on 2026-10-11, via the service role.
alter table public.live_chat
  drop constraint if exists live_chat_content_check;
alter table public.live_chat
  add constraint live_chat_content_check
  check (length(trim(content)) between 1 and 500);

-- ── CRY-08 ─────────────────────────────────────────────────────────────
-- Remove `messages` from the `supabase_realtime` publication. Nothing
-- subscribes to it — verified across app/, hooks/, lib/, Edge functions and
-- routes (only scripts/compat-probe.ts named it, as a probe spec, updated
-- alongside this migration). An unreadable-by-anon table on a live
-- publication is a push channel waiting for a grant mistake.
do $$ begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    alter publication supabase_realtime drop table public.messages;
  end if;
end $$;

-- ── DB-24 ──────────────────────────────────────────────────────────────
-- Port `prevent_client_player_tampering` from
-- supabase/migrations_archive/20260920_players_authorization_lockdown.sql as
-- canonical. Second layer behind the grant revocations: if a future grant
-- ever re-exposes `players` to anon/authenticated, direct UPDATEs still
-- cannot touch server-owned columns. NULL-safe throughout (IS DISTINCT FROM)
-- — the DB-07 lesson applied, unlike the old messages trigger it replaces
-- in spirit. Plain (non-definer) trigger function: it only RAISEs, so it
-- needs no elevated privilege, and `check:schema` DB mode excludes
-- `returns trigger` from the definer EXECUTE gate.
create or replace function public.prevent_client_player_tampering()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.wallet_address is distinct from old.wallet_address
       or new.coins is distinct from old.coins
       or new.total_wins is distinct from old.total_wins
       or new.total_games is distinct from old.total_games
       or new.classic_played is distinct from old.classic_played
       or new.power_played is distinct from old.power_played
       or new.ai_played is distinct from old.ai_played
       or new.lxp is distinct from old.lxp
       or new.rxp is distinct from old.rxp
       or new.season_id is distinct from old.season_id
       or new.rank_tier is distinct from old.rank_tier
       or new.created_at is distinct from old.created_at
       or new.last_played_at is distinct from old.last_played_at
       or new.ecdh_pubkey is distinct from old.ecdh_pubkey then
      raise exception 'protected player fields are server-owned';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists players_prevent_client_tampering on public.players;
create trigger players_prevent_client_tampering
  before update on public.players
  for each row execute function public.prevent_client_player_tampering();

commit;
