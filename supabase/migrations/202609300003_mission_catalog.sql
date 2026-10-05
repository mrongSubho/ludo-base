-- Mission catalog: single source of truth for every mission reward.
--
-- WHY: rewards were defined in four places, with two currencies and three
-- different values for the same mission id:
--   lib/missionVoucher.ts      ONBOARDING_REWARDS  whole CHIPS  daily_bonus: 20
--   lib/onboardingShared.ts    ONBOARDING_TRACKS   coins        tutorial: 100, social: 300
--   app/api/missions/claim     REWARDS             coins        daily_bonus: 100
--   app/api/missions/list      DAILY_MISSIONS      coins        daily_bonus: 100
-- Only the first was ever used to issue real value (an EIP-712 MissionClaim
-- voucher). The other three drove coin grants against a column that is now
-- frozen by 202609300001, so the coin paths were already dead and the drift
-- was invisible.
--
-- This table replaces three of the four (the daily/weekly ones). Rewards are
-- CHIPS, whole units, and the 5..20 band is enforced by a CHECK constraint so a
-- bad value cannot be inserted even by a direct psql write.
--
-- SCOPE: daily + weekly only. Onboarding is intentionally excluded and unchanged
-- — its rewards predate the CHIPS cutover (core package 1000, expanded pack
-- 350) and remain in lib/onboardingShared.ts ONBOARDING_TRACKS.
--
-- Design notes:
--  * period drives both the reset cadence and the on-chain periodId:
--      once -> constant epoch (ONBOARDING_PERIOD)
--      day  -> periodIdDay()   (UTC day)
--      week -> periodIdWeek()  (ISO week)
--  * target is the progress threshold; `daily_bonus` uses target 0 because it
--    is claimable on sight.
--  * Nothing reads rewards from code any more. See lib/missionCatalog.ts.

begin;

create table if not exists public.mission_catalog (
  mission_id   text primary key,
  category     text not null check (category in ('onboarding', 'daily', 'weekly')),
  period       text not null check (period in ('once', 'day', 'week')),
  title        text not null,
  description  text not null default '',
  target       integer not null default 1 check (target >= 0),
  -- 5..20 band applies to the redesigned daily/weekly CHIPS missions only.
  -- Onboarding is exempt by decision: its rewards predate the CHIPS cutover and
  -- keep their original values (core package 1000, expanded pack 350), which are
  -- owned by lib/onboardingShared.ts ONBOARDING_TRACKS, not by this table.
  reward_chips numeric(12, 2) not null,  -- see mission_catalog_reward_band below
  active       boolean not null default true,
  sort_order   integer not null default 0,
  updated_at   timestamptz not null default now(),
  -- A daily mission cannot have a week-long cadence and vice versa.
  constraint mission_catalog_period_category check (
    (category = 'onboarding' and period = 'once') or
    (category = 'daily'     and period = 'day')  or
    (category = 'weekly'    and period = 'week')
  ),
  constraint mission_catalog_reward_band check (
    category = 'onboarding'
    or (reward_chips >= 5 and reward_chips <= 20)
  )
);

comment on table public.mission_catalog is
  'Single source of truth for mission targets and CHIPS rewards. Read via lib/missionCatalog.ts. reward_chips is whole CHIPS (on-chain amount = reward_chips * 1e18).';

alter table public.mission_catalog enable row level security;
revoke all on public.mission_catalog from anon, authenticated;

-- Onboarding tracks are deliberately NOT in this table. They predate the CHIPS
-- cutover and their rewards (core package 1000, expanded pack 350) are owned by
-- lib/onboardingShared.ts ONBOARDING_TRACKS, which is browser-safe and already
-- the source the onboarding UI and /api/onboarding/* read. Keeping a second copy
-- here would recreate exactly the drift this table exists to eliminate.
-- The 'onboarding' category stays in the enum so a future migration can add them
-- without another type change.

-- ── Daily (58 CHIPS max per day) ───────────────────────────────────────────
insert into public.mission_catalog
  (mission_id, category, period, title, description, target, reward_chips, sort_order) values
  ('daily_bonus',     'daily', 'day', 'Daily Bonus',   'Claim your daily chips.',                    0, 10,  1),
  ('daily_play_3',    'daily', 'day', 'Warm Up',       'Play 3 matches today.',                      3,  8,  2),
  ('daily_win_1',     'daily', 'day', 'Champion',      'Win at least one match today.',              1, 12,  3),
  ('daily_poke_back', 'daily', 'day', 'Poke Back',     'Poke back friends who poked you.',           1,  6,  4),
  ('daily_capture_2', 'daily', 'day', 'Token Hunter',  'Capture 2 opponent tokens in any match.',    2, 10,  5),
  ('daily_predict_1', 'daily', 'day', 'Sharp Eye',     'Win a spectator prediction today.',          1, 12,  6)
on conflict (mission_id) do update set
  title = excluded.title,
  description = excluded.description,
  target = excluded.target,
  reward_chips = excluded.reward_chips,
  sort_order = excluded.sort_order;

-- ── Weekly (90 CHIPS max per week) ─────────────────────────────────────────
insert into public.mission_catalog
  (mission_id, category, period, title, description, target, reward_chips, sort_order) values
  ('weekly_play_10',      'weekly', 'week', 'Marathon',       'Play 10 matches this week.',                10, 20, 1),
  ('weekly_win_3',        'weekly', 'week', 'Weekly Wins',    'Win 3 matches this week.',                   3, 18, 2),
  ('weekly_capture_10',   'weekly', 'week', 'Hunter',         'Capture 10 tokens this week.',              10, 15, 3),
  ('weekly_pvp_2',        'weekly', 'week', 'Rival',          'Win 2 PvP matches this week.',               2, 15, 4),
  ('weekly_spectate_5',   'weekly', 'week', 'Crowd',          'Spectate 5 matches this week.',              5, 12, 5),
  ('weekly_friend_dm_3',  'weekly', 'week', 'Connector',      'Send 3 DMs to friends this week.',           3, 10, 6)
on conflict (mission_id) do update set
  title = excluded.title,
  description = excluded.description,
  target = excluded.target,
  reward_chips = excluded.reward_chips,
  sort_order = excluded.sort_order;

commit;
