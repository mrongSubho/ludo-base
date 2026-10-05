-- Fix match_rolls.status vocabulary so networked moves work on a fresh install.
--
-- WHY: the canonical baseline declares
--     status text not null default 'available'
-- but the only consumers/writers of that column are:
--   - supabase/functions/_shared/networkBoundary.ts  isDuplicateAction(status)
--       return status !== 'open';          <- treats anything but 'open' as spent
--   - supabase/functions/move-auth/index.ts:580  update status = 'consumed'
--   - supabase/functions/move-auth/index.ts:711  update status = 'passed'
--   - supabase/functions/roll-dice/index.ts       inserts WITHOUT status,
--                                                  so the column default applies
--
-- 'available' is a third vocabulary that no writer produces and no reader
-- accepts. On a fresh install every receipt therefore lands as 'available',
-- isDuplicateAction('available') === true, and every submit-move / pass-turn
-- returns 409 DUPLICATE_ACTION at move-auth:536 / :671.
--
-- (The archive table had no status column at all; 'available' was introduced by
-- the baseline. Production appears to carry a hand-patched default of 'open',
-- which is why this only bites fresh installs and resets.)
--
-- There was also no CHECK constraint, so 'available'/'open'/'consumed'/'passed'
-- were all accepted and the invariant lived only in JS.
--
-- See docs/ops/SYSTEM_REVIEW.md DB-02.

begin;

-- 1) Backfill unconsumed receipts. Any row still on 'available' was never
--    consumed (move-auth would have rewritten it to 'consumed'), so this is
--    a semantics-preserving rename, not a grant.
update public.match_rolls set status = 'open' where status = 'available';

-- 2) Correct the default so roll-dice inserts land spendable.
alter table public.match_rolls alter column status set default 'open';

-- 3) Constrain the vocabulary at the database, not just in JS.
alter table public.match_rolls drop constraint if exists match_rolls_status_check;
alter table public.match_rolls add constraint match_rolls_status_check
  check (status in ('open','consumed','passed'));

commit;
