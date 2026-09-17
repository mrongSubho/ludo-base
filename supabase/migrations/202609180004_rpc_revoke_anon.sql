-- Compat: explicit per-role EXECUTE revoke on privileged RPCs.
-- Fresh Supabase projects carry default privileges granting EXECUTE on new
-- public-schema functions to anon/authenticated, so `REVOKE ... FROM PUBLIC`
-- alone does not remove access (verified live: anon could still execute
-- mark_conversation_read/cleanup_* after the baseline). Revoke per role;
-- service_role keeps access. Idempotent — safe to re-run.
do $$
declare
    fn text;
    funcs text[] := array[
        'join_matchmaking(text,text,text,numeric,numeric,numeric)',
        'join_matchmaking_hybrid(text,text,text,numeric,numeric,numeric,text)',
        'cash_out_bet(uuid,text)',
        'settle_match_bets(uuid,text,text)',
        'join_tournament(uuid,text)',
        'mark_conversation_read(text,text)',
        'cleanup_matchmaking_queue()',
        'cleanup_stale_data()'
    ];
begin
    foreach fn in array funcs loop
        execute format('revoke execute on function public.%s from anon', fn);
        execute format('revoke execute on function public.%s from authenticated', fn);
        execute format('revoke execute on function public.%s from public', fn);
        execute format('grant execute on function public.%s to service_role', fn);
    end loop;
end $$;
