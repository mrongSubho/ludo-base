begin;

alter table public.players
  add column if not exists is_public boolean not null default true,
  add column if not exists allow_requests boolean not null default true;

grant select (is_public, allow_requests) on public.players to anon, authenticated;

commit;
