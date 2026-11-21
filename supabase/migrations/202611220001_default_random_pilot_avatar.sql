begin;

-- Assign a random pilot avatar from the 18 custom portraits whenever a player
-- row is created without an avatar, and backfill all existing players who
-- currently have a null or empty avatar_url.

create or replace function public.random_pilot_avatar()
returns text
language sql
volatile
security invoker
set search_path = public
as $$
  select (array[
    'avatar:pilot-kairo',
    'avatar:pilot-valkyrie',
    'avatar:pilot-aria',
    'avatar:pilot-blaze',
    'avatar:pilot-spark',
    'avatar:pilot-mika',
    'avatar:pilot-lyra',
    'avatar:pilot-nova',
    'avatar:pilot-jett',
    'avatar:pilot-bolt',
    'avatar:pilot-titan',
    'avatar:pilot-sora',
    'avatar:pilot-vex',
    'avatar:pilot-elena',
    'avatar:pilot-vance',
    'avatar:pilot-stark',
    'avatar:pilot-aegis',
    'avatar:pilot-kestrel'
  ])[1 + floor(random() * 18)::int];
$$;

alter table public.players
  alter column avatar_url set default public.random_pilot_avatar();

create or replace function public.assign_default_pilot_avatar()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.avatar_url is null or btrim(new.avatar_url) = '' then
    new.avatar_url := public.random_pilot_avatar();
  end if;
  return new;
end;
$$;

drop trigger if exists players_default_random_avatar on public.players;
create trigger players_default_random_avatar
  before insert on public.players
  for each row
  execute function public.assign_default_pilot_avatar();

update public.players
set avatar_url = public.random_pilot_avatar()
where avatar_url is null
   or btrim(avatar_url) = '';

commit;
