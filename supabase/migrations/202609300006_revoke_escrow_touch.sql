-- Revoke anon/authenticated EXECUTE on the escrow touch helper.
--
-- Found by `npm run check:schema` (DB mode), which flags any SECURITY DEFINER
-- function that anon or authenticated can reach, directly or via PUBLIC.
--
-- 202609300005 declared chips_escrow_touch as SECURITY DEFINER so the other
-- escrow functions could call it under a pinned search_path, but never revoked
-- the EXECUTE that Postgres grants to PUBLIC on every new function. PostgREST
-- exposes public-schema functions, so `POST /rest/v1/rpc/chips_escrow_touch`
-- was reachable with the anon key.
--
-- Impact is low — it only inserts a zero-balance escrow account row for a
-- caller-supplied wallet, moving no value — but it is an unauthenticated write
-- into a server-only table and it is exactly the DB-09 anti-pattern the gate
-- exists to catch.
--
-- Editing 202609300005 would not help: the CLI has already recorded that file as
-- applied, so `db push` reports the remote as up to date and never re-runs it.
-- Migrations are forward-only; this is the corrective.

begin;

revoke execute on function public.chips_escrow_touch(text) from public, anon, authenticated;

-- Defense in depth: the helper is only ever called from inside other
-- SECURITY DEFINER functions, so service_role is the only legitimate caller.
grant execute on function public.chips_escrow_touch(text) to service_role;

commit;
