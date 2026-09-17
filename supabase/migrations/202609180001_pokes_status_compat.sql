-- Compat: accept code-canonical sent/poked_back plus baseline-legacy values.
-- No destructive rewrite; legacy rows stay readable, new writes use sent/poked_back.
alter table public.pokes alter column status set default 'sent';

alter table public.pokes drop constraint if exists pokes_status_check;

alter table public.pokes
  add constraint pokes_status_check
  check (status in ('sent','poked_back','pending','accepted','dismissed'))
  not valid;
alter table public.pokes validate constraint pokes_status_check;

-- Indexes the deployed history had; baseline omits them. Read path is
-- receiver_id+status (GET inbox) and sender_id (daily-limit scan).
create index if not exists pokes_receiver_status_idx
  on public.pokes (receiver_id, status, created_at desc);
create index if not exists pokes_sender_created_idx
  on public.pokes (sender_id, created_at desc);
