begin;

alter table public.clans
    add column if not exists treasury_public boolean not null default false;

alter table public.clans
    add column if not exists rename_count int not null default 0 check (rename_count >= 0);

commit;
