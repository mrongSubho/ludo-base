-- ─── Live room announcements (Session parties in chat + matches) ────────────
-- Apply manually via the Supabase SQL Editor.
--
-- One row per announced room (upserted by sender+room_code via the
-- /api/live-chat route, which runs with the service role — anon clients
-- have no UPDATE policy by design). Seat fills rewrite the row's content
-- so counts stay live; start/close flips room_open instead of deleting,
-- so history survives. The 300-row opportunistic prune still bounds growth.

alter table public.live_chat
    add column if not exists room_code text;
alter table public.live_chat
    add column if not exists room_open boolean not null default true;

create index if not exists live_chat_room_idx
    on public.live_chat (room_code, created_at desc);
