-- Make player_missions period-aware so daily/weekly missions need no reset job.
--
-- WHY: progress was reset ad hoc in two places with duplicated logic —
--   app/api/match/record/route.ts   `shouldReset = lastUpdated < startOfToday`
--   app/api/missions/list/route.ts  a separate inline reset
-- Neither supports weekly missions, and both are bypassed whenever a mission is
-- claimed from any other path. `unique(player_id, mission_id)` also meant a
-- daily mission could only ever be claimed once per player, ever.
--
-- Adding period_id to the uniqueness key makes a new period a new row, so the
-- reset logic disappears entirely and daily/weekly cadence falls out of the
-- schema rather than out of ad-hoc date comparisons.
--
-- Existing rows are backfilled with the sentinel 'legacy' so historical progress
-- stays attached to the player instead of orphaning it. Callers that have not
-- migrated yet keep matching on (player_id, mission_id) as before, because
-- 'legacy' is the only value present at migration time.

begin;

alter table public.player_missions
  add column if not exists period_id text not null default 'legacy';

comment on column public.player_missions.period_id is
  'UTC period bucket for the mission: ISO day, ISO week, or ''legacy'' for pre-2026-09-30 rows. Part of the uniqueness key.';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.player_missions'::regclass
       and conname = 'player_missions_player_id_mission_id_key'
  ) then
    alter table public.player_missions
      drop constraint player_missions_player_id_mission_id_key;
  end if;
end $$;

alter table public.player_missions
  drop constraint if exists player_missions_period_uniq;
alter table public.player_missions
  add constraint player_missions_period_uniq unique (player_id, mission_id, period_id);

create index if not exists player_missions_period_idx
  on public.player_missions (player_id, period_id);

commit;
