-- Compat: restore archive semantics for live_chat.room_code.
-- Global shouts carry NULL room_code; room announces carry room_code +
-- room_open. Idempotent on archive-migrated DBs (already nullable).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_chat'
      and column_name = 'room_code' and is_nullable = 'NO'
  ) then
    alter table public.live_chat alter column room_code drop not null;
  end if;
end $$;

-- Already in baseline; guarded no-op for determinism across both lineages.
create index if not exists live_chat_room_idx
  on public.live_chat (room_code, created_at desc);
