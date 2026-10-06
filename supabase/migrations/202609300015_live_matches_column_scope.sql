-- DB-10 — column-scope the `live_matches` grant.
--
-- `live_matches_public_read` is `using (true)`, so *any* granted column is
-- world-readable. With a table-wide SELECT grant that published, to the anon key:
--
--   join_secret_hash    the invite/matchmaking secret, if one is ever set
--   arena_key           identifies the AI arena row
--   authority_id        who currently holds the arena tick
--   host_address        every host wallet in the game
--
-- None of those are needed by a spectator. The client reads exactly:
--
--   match_id, room_code, bet_window_status, spectator_count,
--   current_bet_type, created_at
--
-- (LiveArenaDirectory, and useSpectatorSync which selects match_id alone.)
--
-- The fix is at the GRANT, not the policy. Narrowing the policy would break
-- other readers; narrowing the grant removes the columns from reach entirely,
-- and a client that later selects a secret column gets a clear 42501 naming it
-- rather than silently succeeding.

begin;

revoke select on public.live_matches from anon, authenticated;

grant select (
  match_id,
  room_code,
  bet_window_status,
  spectator_count,
  current_bet_type,
  created_at
) on public.live_matches to anon, authenticated;

-- Sequences owned by the revoked columns are not reachable either.
do $$
declare s text;
begin
  for s in select sequencename from pg_sequences where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from anon', s);
    execute format('revoke all on public.%I from authenticated', s);
  end loop;
end $$;

commit;
