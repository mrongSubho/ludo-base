-- ECO-08: record the pool shape and a numeric game mode on `matches`.
--
-- Why this exists
-- ---------------
-- `chips/lobby-ticket` used to hardcode `gameMode: 0` in the signed lobby
-- ticket. Its own comment claimed "gameMode comes from the stored game_mode",
-- but the value was never read, so the selected column was dead code and every
-- ticket claimed classic regardless of the actual mode.
--
-- The contract needs a numeric `gameMode` (uint8, <= 2), while this column is
-- free text ('classic' | 'power' | 'snakes'). This migration stores both sides:
--
--   match_shape    '1v1' | '2v2' | '4P'   -- the declared pool shape
--   game_mode_code 0 | 1 | 2               -- numeric form for the contract
--
-- ECO-08 also had the contract *infer* 2v2-vs-4P from seat colours plus winner
-- count. That is wrong: `LOBBY_COLORS['4P']` in lib/gameLogic.ts seats players
-- green,red,yellow,blue, i.e. colour numbers 1,2,3,4, and MatchPool._isTeamPair
-- treats colours {1,4} as teammates. So in any 4P game where the top two were
-- green and blue, settlement applied the 2v2 50/50 split instead of the 75/25
-- podium. Storing the shape lets the contract branch on a declared, signed
-- value instead.

begin;

-- ---------------------------------------------------------------------------
-- game_mode_code: numeric game mode for MatchPool.LobbyTicket.gameMode
-- ---------------------------------------------------------------------------
alter table public.matches
    add column if not exists game_mode_code smallint;

comment on column public.matches.game_mode_code is
    'Numeric MatchPool game mode: 0=classic, 1=power, 2=snakes. Derived from game_mode; NULL means unknown and must fail closed.';

-- ---------------------------------------------------------------------------
-- match_shape: declared pool shape, source of truth for the payout split
-- ---------------------------------------------------------------------------
alter table public.matches
    add column if not exists match_shape text;

comment on column public.matches.match_shape is
    'Declared pool shape: 1v1 | 2v2 | 4P. Drives MatchPool settlement splits; must not be inferred from seat colours.';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'matches_match_shape_check'
    ) then
        alter table public.matches
            add constraint matches_match_shape_check
            check (match_shape is null or match_shape in ('1v1', '2v2', '4P'));
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill game_mode_code from the existing text column.
-- Unknown/absent modes stay NULL so the ticket route rejects them rather than
-- silently signing "classic".
-- ---------------------------------------------------------------------------
update public.matches
set game_mode_code = case game_mode
    when 'classic' then 0
    when 'power' then 1
    when 'snakes' then 2
    else null
end
where game_mode_code is null;

-- ---------------------------------------------------------------------------
-- Backfill match_shape from the stored roster.
--
-- A 4-entry roster is ambiguous on its own: both 2v2 and 4P use four seats.
-- The seat-count split below is therefore only a best-effort default. It is
-- deliberately conservative — 4-seat rows are marked NULL rather than guessed,
-- because guessing wrong here silently pays the wrong split. The match-start
-- route writes the true value; host_proven rows with a NULL shape simply cannot
-- obtain a signed lobby ticket until re-saved.
--
-- Rows with a 2-entry roster are unambiguously 1v1 and can be filled in.
-- ---------------------------------------------------------------------------
update public.matches
set match_shape = '1v1'
where match_shape is null
  and host_proven is true
  and coalesce(array_length(participants, 1), 0) = 2;

-- ---------------------------------------------------------------------------
-- Index for the settle path, which looks matches up by shape when co-signing.
-- ---------------------------------------------------------------------------
create index if not exists matches_shape_idx
    on public.matches (match_shape)
    where match_shape is not null;

commit;
