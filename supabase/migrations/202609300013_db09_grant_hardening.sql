-- DB-09 — stop relying on RLS alone.
--
-- In production `anon` and `authenticated` held FULL table privileges
-- (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) on 36 public
-- tables. RLS was the only thing denying access. That is one policy away from a
-- data breach: a permissive policy, a SECURITY DEFINER function with a search
-- path someone can influence, or a future migration that creates a policy by
-- accident — and the grant is already there waiting for it.
--
-- Defence in depth means the grant is not the backstop. The backstop is RLS,
-- and the grant should be as narrow as RLS already is.
--
-- The allowlist below is derived from the code, not from taste. A table is
-- listed only if a CLIENT-side file (a component or hook, never `app/api/**`
-- and never `lib/serverAuth.ts`) queries it with the anon/authenticated key:
--
--   players             directory reads; the baseline's narrow column grant stays
--   live_chat           spectator feed, plus postgres_changes
--   live_matches        arena/match directory, plus postgres_changes
--   matches             profile "recent matches" panels
--   tournaments         rankings panel
--
-- Everything else goes to zero grants. Server routes use the service role,
-- which bypasses RLS and needs no grant at all.
--
-- Two deliberate non-additions:
--
--   matchmaking_queue  stays revoked. The baseline already revoked SELECT
--                      because it holds `validation_token`, and it must stay that
--                      way. Note that `ActivityFeed` and `LiveMatchmakingFeed`
--                      query it client-side and have therefore been reading
--                      nothing since the baseline landed — that is a pre-existing
--                      bug, not something this migration causes.
--
--   lobby_join_policies already has zero grants (202609300012) and is not
--                      client-reachable.
--
--   pokes, player_missions, game_invites  these have `postgres_changes`
--                      subscriptions in the client but **no RLS policy at all**,
--                      so default-deny already stops them — the subscription has
--                      been delivering nothing since the baseline landed, grant
--                      or no grant. `pokes` is also absent from the
--                      `supabase_realtime` publication, so it could not fire
--                      either way. Granting them here would be a grant with no
--                      effect and a wider blast radius, so they are left at zero.
--                      Making those three subscriptions actually work is a
--                      separate change (DB-27) and needs a policy decision: a
--                      row-level `player_id = auth.uid()` equivalent for
--                      player_missions, and for game_invites a filter on
--                      guest_address, which currently carries `validation_token`.

begin;

do $$
declare
  t text;
begin
  -- Every public table, whatever its current grants.
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- ── The allowlist ───────────────────────────────────────────────────────────
-- Read-only, and only for the tables a client actually queries.

grant select on public.players         to anon, authenticated;
grant select on public.live_chat       to anon, authenticated;
grant select on public.live_matches    to anon, authenticated;
grant select on public.matches         to anon, authenticated;
grant select on public.tournaments     to anon, authenticated;

-- `players` is directory data only. This is the baseline's narrow column list and
-- it must stay narrow: `coins`, `peer_id`, `ecdh_pubkey` and `current_room_code`
-- are server-only.
revoke select on public.players from anon, authenticated;
grant select (
  wallet_address, username, avatar_url, lxp, rxp, status,
  classic_played, power_played, ai_played, total_wins, total_games,
  rank_tier, last_played_at, created_at
) on public.players to anon, authenticated;

-- ── Sequence access ─────────────────────────────────────────────────────────
-- REVOKE ALL ON TABLE also drops sequence privileges on owned columns. Nothing in
-- the allowlist is written by a client, so no sequence grants are needed. This is
-- recorded explicitly so a future insert does not silently acquire one.

do $$
declare
  s text;
begin
  for s in select sequencename from pg_sequences where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from anon', s);
    execute format('revoke all on public.%I from authenticated', s);
  end loop;
end $$;

commit;

comment on table public.live_chat is
  'DB-09: anon/authenticated hold SELECT only, and only via the allowlist in 202609300013. RLS remains the actual policy.';
