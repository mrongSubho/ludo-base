-- Compat: matches.finished_at for settlement idempotency / replay protection.
-- winner_address alone cannot guard: draws record with null winner while
-- progression still runs, so a null-winner match would stay re-recordable.
alter table public.matches
  add column if not exists finished_at timestamptz;

-- Historically settled matches (winner set pre-column) must stay un-re-recordable.
update public.matches
  set finished_at = created_at
  where finished_at is null and winner_address is not null;

-- Draws recorded pre-column (winner_address null) are indistinguishable from
-- unsettled; they stay re-recordable exactly once by design. Accepted.
create index if not exists matches_finished_at_idx
  on public.matches (finished_at desc nulls last);
