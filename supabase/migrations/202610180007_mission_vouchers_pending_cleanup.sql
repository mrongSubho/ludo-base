-- 202610180007_mission_vouchers_pending_cleanup.sql
--
-- Reclaim orphaned voucher reservations — the bug class that locked the
-- Welcome Grant as "already claimed".
--
-- Background: the claim routes reserve the (wallet, mission, period) slot with
-- `signature = 'pending'` BEFORE signing, so a concurrent racer is rejected by
-- the `mission_vouchers_claim_uniq` index. When the signature step fails, the
-- route's own error path deletes the row — but a crash, a timeout, or (as
-- actually happened) an unset `MISSION_OP_PRIVATE_KEY` leaves the row behind.
-- A `pending` row is a RESERVATION, never a payout, and it burned the reward
-- for that period with no reclamation path.
--
-- Migration 202609300010 ¶4 added `reserved_at` + the
-- `mission_vouchers_pending_idx` partial index (`where signature = 'pending'`)
-- and documented this sweep. This file performs it.
--
-- SAFETY PROPERTIES
--   * Only rows with `signature = 'pending'` are touched — a signed voucher is
--     real value and is never removed.
--   * Only rows past the grace window (24h) are swept, so a reservation that is
--     genuinely in flight right now is never deleted under a live claim.
--   * Rows are ARCHIVED before deletion, so the sweep is reversible.
--   * Idempotent: re-running finds nothing left to reclaim and changes nothing.
--
-- Apply: npm run db:migrate            (or paste into the Dashboard SQL Editor)
-- Verify: npm run db:migrate:verify
-- Rollback: see the ROLLBACK block at the bottom of this file.

begin;

-- ---------------------------------------------------------------------------
-- 0. Pre-flight. Fail loudly rather than half-applying if the chain is behind.
-- ---------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'mission_vouchers'
          and column_name = 'reserved_at'
    ) then
        raise exception
            'mission_vouchers.reserved_at is missing — apply 202609300010_phase1_unblock.sql first';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Archive table. Restoring from it is the rollback path, so it keeps every
--    original column (including `id`, so a restore is exact) plus when the
--    sweep ran. Server-only: RLS on, and no anon/authenticated surface.
-- ---------------------------------------------------------------------------
create table if not exists public.mission_vouchers_reclaimed (
    -- Original row identity; primary key so a re-run cannot double-archive.
    id uuid primary key,
    wallet_address text not null,
    mission_id text not null,
    period_id text not null,
    amount numeric not null,
    signature text not null,
    deadline timestamptz,
    claimed_tx text,
    created_at timestamptz,
    reserved_at timestamptz,
    -- Sweep bookkeeping.
    reclaimed_at timestamptz not null default now(),
    reclaim_reason text not null default 'orphaned pending reservation'
);

comment on table public.mission_vouchers_reclaimed is
    'Orphaned mission_vouchers reservations removed by 202610180007. Rows here are reversible — see the ROLLBACK block at the bottom of that migration.';

comment on column public.mission_vouchers_reclaimed.reclaim_reason is
    'Why the row was reclaimed. "orphaned pending reservation" = signature never completed; it was never a payout.';

alter table public.mission_vouchers_reclaimed enable row level security;
revoke all on public.mission_vouchers_reclaimed from anon, authenticated;

create index if not exists mission_vouchers_reclaimed_mission_idx
    on public.mission_vouchers_reclaimed (mission_id, reclaimed_at);

-- ---------------------------------------------------------------------------
-- 2. The sweep. Temp table (on commit drop) holds exactly the rows being
--    reclaimed, so the archive insert and the delete cannot drift apart.
-- ---------------------------------------------------------------------------

-- Grace window: a reservation younger than this is still in flight.
create temporary table _reclaim_ids on commit drop as
    select v.id
    from public.mission_vouchers v
    where v.signature = 'pending'
      and coalesce(v.reserved_at, v.created_at) < now() - interval '24 hours';

-- Archive first — if the delete fails the transaction rolls back and the rows
-- are still live, which is the safe failure direction.
insert into public.mission_vouchers_reclaimed (
    id, wallet_address, mission_id, period_id, amount, signature,
    deadline, claimed_tx, created_at, reserved_at
)
select
    v.id, v.wallet_address, v.mission_id, v.period_id, v.amount, v.signature,
    v.deadline, v.claimed_tx, v.created_at, v.reserved_at
from public.mission_vouchers v
join _reclaim_ids r on r.id = v.id
on conflict (id) do nothing;

delete from public.mission_vouchers v
using _reclaim_ids r
where v.id = r.id;

-- Report what happened, so the apply log carries evidence.
do $$
declare
    archived int;
    remaining int;
begin
    select count(*) into archived from public.mission_vouchers_reclaimed;
    select count(*) into remaining
        from public.mission_vouchers v
        where v.signature = 'pending'
          and coalesce(v.reserved_at, v.created_at) < now() - interval '24 hours';
    raise notice 'mission_vouchers pending cleanup: % row(s) archived, % still pending past the grace window', archived, remaining;
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION (run after apply — see `npm run db:migrate:verify`)
--
--   1. No stale pending reservations remain in the target window:
--        select count(*) as still_stuck from public.mission_vouchers
--        where signature = 'pending'
--          and coalesce(reserved_at, created_at) < now() - interval '24 hours';
--      -- MUST be 0
--
--   2. The reclaimed rows are archived and nothing was lost:
--        select mission_id, count(*) as reclaimed, min(created_at) as oldest, max(reclaimed_at) as swept_at
--        from public.mission_vouchers_reclaimed
--        group by mission_id order by mission_id;
--
--   3. No live pending row sits inside the grace window that we just swept
--      past (these were deliberately left alone; they are still claimable):
--        select count(*) as in_flight from public.mission_vouchers
--        where signature = 'pending'
--          and coalesce(reserved_at, created_at) >= now() - interval '24 hours';
--
--   4. Signed vouchers are untouched — this count must never drop:
--        select count(*) as signed from public.mission_vouchers
--        where signature is not null and signature <> 'pending';
-- ---------------------------------------------------------------------------
--
-- ROLLBACK (manual, only if this sweep was a mistake)
--
-- Every deleted row is preserved verbatim in mission_vouchers_reclaimed.
-- Restore them all:
--
--   insert into public.mission_vouchers
--       (id, wallet_address, mission_id, period_id, amount, signature,
--        deadline, claimed_tx, created_at, reserved_at)
--   select id, wallet_address, mission_id, period_id, amount, signature,
--          deadline, claimed_tx, created_at, reserved_at
--   from public.mission_vouchers_reclaimed
--   on conflict do nothing;
--
-- This is safe: those rows were `pending` reservations that were never signed
-- and never paid, so restoring them recreates exactly the pre-sweep state
-- (rewards still unclaimed, still locked — but recoverable, and the claim
-- routes will now clear them on the next sweep).
--
-- CONFLICT HANDLING
--   * A concurrent racer is stopped by `mission_vouchers_claim_uniq`, not by
--     this file, and is out of scope here: the 24h grace window means any
--     legitimate in-flight reservation is not visible to the sweep.
--   * If the archive insert and the delete ever disagree, the whole file runs
--     in one transaction, so an error rolls BOTH back and leaves the live table
--     exactly as it was.
--   * `on conflict (id) do nothing` makes the archive step idempotent if the
--     file is replayed after a partial failure.
