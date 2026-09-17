-- ─── Read-repair RPC (Session Inbox badges) ─────────────────────────────────
-- Applied manually via the Supabase SQL Editor.
--
-- Why this exists: opening a thread zeroed unread counts only in local
-- state. Nothing ever decremented conversations.unread_count_* server-side
-- (the insert trigger only increments), so every reboot resurrected the
-- header badge. This RPC makes "open thread" durable: it marks the
-- friend's messages read AND recomputes both counters from whatever is
-- still actually unread. Opening each thread once repairs legacy counts.

create or replace function public.mark_conversation_read(me text, friend text)
returns void
language plpgsql
security definer
as $$
declare
    a text := lower(me);
    b text := lower(friend);
    u1 text;
    u2 text;
begin
    -- Canonical pair order (matches update_conversation_summary trigger).
    if a > b then
        u1 := b; u2 := a;
    else
        u1 := a; u2 := b;
    end if;

    -- 1. Mark the friend's messages to me as read.
    update public.messages
    set is_read = true
    where lower(sender_id) = b
      and lower(receiver_id) = a
      and is_read = false;

    -- 2. Recompute both counters from remaining unread (never just zero:
    --    a message arriving mid-call stays counted).
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
    where c.user_a = u1 and c.user_b = u2;
end;
$$;
