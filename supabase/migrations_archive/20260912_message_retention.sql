-- ─── DM retention overhaul (Session Inbox) ───────────────────────────────────
-- Apply manually via the Supabase SQL Editor.
--
-- Semantics (replaces the old 72h delete-everything rule, which also killed
-- unread mail and violated "unread always survives"):
--   1. READ messages older than 24h are deleted.
--   2. Absolute backstop: ANY message older than 7 days is deleted
--      (prevents unbounded growth from never-opened threads).
--   3. Conversations counters are reconciled from remaining rows, so deleted
--      mail can never inflate badges.
--
-- Scheduling (needs the pg_cron extension, one click in Dashboard >
-- Database > Extensions). Daily is plenty for a 24h rule:
--   SELECT cron.schedule('dm-retention-daily', '0 3 * * *',
--     $$SELECT public.cleanup_stale_data()$$);
-- To take effect immediately, run: SELECT public.cleanup_stale_data();

create or replace function public.cleanup_stale_data()
returns void
language plpgsql
security definer
as $$
begin
    -- 1+2. Purge read mail older than 24h, plus the 7-day absolute backstop.
    -- Capture canonical conversation pairs touched by the delete.
    create temporary table _purged_pairs(user_a text, user_b text) on commit drop;

    with del as (
        delete from public.messages
        where (is_read = true and created_at < now() - interval '24 hours')
           or (created_at < now() - interval '7 days')
        returning lower(sender_id) as s, lower(receiver_id) as r
    )
    insert into _purged_pairs(user_a, user_b)
    select distinct least(s, r), greatest(s, r) from del;

    -- 3. Reconcile counters for touched conversations only.
    update public.conversations c
    set unread_count_a = (
            select count(*)
            from public.messages m
            where lower(m.sender_id) = c.user_b
              and lower(m.receiver_id) = c.user_a
              and m.is_read = false
        ),
        unread_count_b = (
            select count(*)
            from public.messages m
            where lower(m.sender_id) = c.user_a
              and lower(m.receiver_id) = c.user_b
              and m.is_read = false
        )
    where exists (
        select 1 from _purged_pairs p
        where p.user_a = c.user_a and p.user_b = c.user_b
    );

    drop table _purged_pairs;

    -- 4. AFK sweep (unchanged): ghost presence goes Offline after 2 minutes.
    update public.players
    set status = 'Offline'
    where status != 'Offline'
      and last_seen_at < now() - interval '2 minutes';
end;
$$;
