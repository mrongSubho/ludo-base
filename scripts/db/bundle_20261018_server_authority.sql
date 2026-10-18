-- ============================================================================
-- LUDO BASE — SERVER AUTHORITY MIGRATIONS BUNDLE (2026-10-18)
--
-- This bundle contains all 7 migrations from the Server Authority Migration:
--   1. 202610180001_session_v2.sql
--   2. 202610180002_room_owner.sql
--   3. 202610180003_room_version.sql
--   4. 202610180004_room_lifecycle.sql
--   5. 202610180005_private_realtime.sql
--   6. 202610180006_indexer_cursor.sql
--   7. 202610180007_mission_vouchers_pending_cleanup.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 202610180001_session_v2.sql
-- ----------------------------------------------------------------------------
-- ============================================================================
-- Migration: 202610180001_session_v2.sql
-- Description: Session v2 (auth_challenges, sessions) + Retention RPCs
-- Scope: Server Authority Migration Phase 1 (P1)
-- ============================================================================

BEGIN;

-- 1. auth_challenges — server-issued single-use challenges (kills P4 replay)
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nonce TEXT NOT NULL,
    wallet_address TEXT,
    ip TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_challenges_nonce_idx ON auth_challenges(nonce);
CREATE INDEX IF NOT EXISTS auth_challenges_expires_at_idx ON auth_challenges(expires_at);

ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;
-- Default deny: no policies for anon/authenticated. service_role only.

-- 2. sessions — unified session store with scope model (app, match, spectator)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL REFERENCES players(wallet_address) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('app', 'match', 'spectator')),
    match_id TEXT,
    device_id TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    idle_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    rotated_from UUID REFERENCES sessions(id) ON DELETE SET NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_wallet_scope_idx ON sessions(wallet_address, scope);

-- One active app session per wallet at any given time
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_app_per_wallet 
    ON sessions(wallet_address) 
    WHERE scope = 'app' AND revoked_at IS NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- Default deny: no policies for anon/authenticated. service_role only.

-- 3. Retention RPCs — invoked by Cron worker
CREATE OR REPLACE FUNCTION cleanup_auth_challenges(p_keep_hours integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM auth_challenges
     WHERE (consumed_at IS NOT NULL OR expires_at < now())
       AND created_at < now() - (p_keep_hours || ' hours')::interval;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_sessions(p_keep_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM sessions
     WHERE (revoked_at IS NOT NULL OR expires_at < now() OR idle_expires_at < now())
       AND last_seen_at < now() - (p_keep_days || ' days')::interval;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION cleanup_auth_challenges(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_auth_challenges(integer) TO service_role;

REVOKE ALL ON FUNCTION cleanup_sessions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_sessions(integer) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- 2. 202610180002_room_owner.sql
-- ----------------------------------------------------------------------------
-- Migration 202610180002_room_owner.sql
-- Phase 2 / SEC-P2: Server-assigned room_owner on matches table

begin;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS room_owner text;
COMMENT ON COLUMN matches.room_owner IS 'Authoritative session wallet assigned as room owner at creation';

CREATE INDEX IF NOT EXISTS matches_room_owner_idx ON matches(room_owner) WHERE room_owner IS NOT NULL;

commit;

-- ----------------------------------------------------------------------------
-- 3. 202610180003_room_version.sql
-- ----------------------------------------------------------------------------
-- Migration 202610180003_room_version.sql
-- Phase 3 / SEC-P3: match_states.room_version for Match Room transport detection

begin;

ALTER TABLE match_states ADD COLUMN IF NOT EXISTS room_version smallint NOT NULL DEFAULT 1;
COMMENT ON COLUMN match_states.room_version IS 'Protocol version of the match room authority managing this state';

commit;

-- ----------------------------------------------------------------------------
-- 4. 202610180004_room_lifecycle.sql
-- ----------------------------------------------------------------------------
BEGIN;

-- 1. Table for room lifecycle event audit log
CREATE TABLE IF NOT EXISTS public.match_room_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    seq integer,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS match_room_events_match_id_idx ON public.match_room_events(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS match_room_events_seq_idx ON public.match_room_events(match_id, seq);

ALTER TABLE public.match_room_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_room_events open read" ON public.match_room_events;
CREATE POLICY "match_room_events open read"
    ON public.match_room_events FOR SELECT USING (true);

-- 2. Atomic action commit RPC (P15/G7, Rev 3 F3)
CREATE OR REPLACE FUNCTION public.match_commit_action(
    p_match_id uuid,
    p_expected_seq integer,
    p_new_state jsonb,
    p_event_type text DEFAULT 'move_committed',
    p_event_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cur_seq integer;
    v_cur_state jsonb;
    v_next_seq integer;
BEGIN
    SELECT seq, state INTO v_cur_seq, v_cur_state
    FROM public.match_states
    WHERE match_id = p_match_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
    END IF;

    IF v_cur_seq <> p_expected_seq THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'STALE_SEQ',
            'current_seq', v_cur_seq,
            'state', v_cur_state
        );
    END IF;

    v_next_seq := v_cur_seq + 1;

    UPDATE public.match_states
    SET
        state = p_new_state,
        seq = v_next_seq,
        updated_at = now()
    WHERE match_id = p_match_id;

    INSERT INTO public.match_room_events (match_id, event_type, seq, payload)
    VALUES (p_match_id, p_event_type, v_next_seq, p_event_payload);

    RETURN jsonb_build_object(
        'ok', true,
        'seq', v_next_seq,
        'state', p_new_state
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_commit_action(uuid, integer, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_commit_action(uuid, integer, jsonb, text, jsonb) TO service_role;

-- 3. Retention RPC: cleanup_match_room_events
CREATE OR REPLACE FUNCTION public.cleanup_match_room_events(p_keep_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted integer;
BEGIN
    DELETE FROM public.match_room_events
    WHERE created_at < (now() - (p_keep_days || ' days')::interval);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_match_room_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_match_room_events(integer) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- 5. 202610180005_private_realtime.sql
-- ----------------------------------------------------------------------------
BEGIN;

-- P5: Private Realtime Authorization (NET-03a/b)
--
-- HOSTED-SUPABASE REALITY (found 2026-10-18, when this chain first reached the
-- real project): on a hosted project the `realtime` schema is owned by the
-- managed `supabase_realtime_admin` role, and the pooler `postgres.<ref>` user
-- does NOT hold CREATE on it. The DDL below is Supabase's documented Realtime
-- authorization pattern, so it needs the schema owner. That is why this file
-- passed on a local stack (where `postgres` is the superuser) and failed on the
-- hosted project with
--     ERROR: permission denied for schema realtime (SQLSTATE 42501)
--     At statement: 2 / CREATE TABLE IF NOT EXISTS realtime.messages (
--
-- The DDL is therefore applied by a role check. A local/self-hosted stack, where
-- postgres owns `realtime`, still gets the full protection. A hosted project,
-- where it does not, gets a loud WARNING plus the exact one-time fallback SQL at
-- the bottom of this file — so the migration chain can advance without this file
-- ever reporting NET-03a/b as closed when it is not.

DO $mig$
DECLARE
    owns_realtime boolean := has_schema_privilege(current_user, 'realtime', 'CREATE');
BEGIN
    IF NOT owns_realtime THEN
        RAISE WARNING
            'private-realtime authorization (NET-03a/b) NOT APPLIED: role % has no CREATE on schema realtime, which hosted Supabase owns via supabase_realtime_admin. Private-channel RLS is therefore NOT enforced. Apply the FALLBACK block at the bottom of this file once, with a role that owns the schema, to close it.',
            current_user;
        RETURN;
    END IF;

    CREATE SCHEMA IF NOT EXISTS realtime;

    CREATE TABLE IF NOT EXISTS realtime.messages (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        topic text NOT NULL,
        extension text NOT NULL,
        inserted_at timestamptz DEFAULT now()
    );

    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "realtime_messages_select" ON realtime.messages;
    CREATE POLICY "realtime_messages_select"
    ON realtime.messages
    FOR SELECT
    USING (
        auth.role() = 'service_role'
        OR (auth.role() = 'authenticated' AND (topic LIKE 'match:%' OR topic LIKE 'game-room-%'))
        OR topic LIKE 'match:%'
    );

    DROP POLICY IF EXISTS "realtime_messages_insert" ON realtime.messages;
    CREATE POLICY "realtime_messages_insert"
    ON realtime.messages
    FOR INSERT
    WITH CHECK (
        auth.role() = 'service_role'
        OR (auth.role() = 'authenticated' AND (topic LIKE 'match:%' OR topic LIKE 'game-room-%'))
    );
END
$mig$;

-- Final state check, so the apply log always says whether protection is on.
DO $check$
BEGIN
    IF to_regclass('realtime.messages') IS NULL THEN
        RAISE WARNING 'realtime.messages does not exist — private realtime authorization is inactive (see the FALLBACK block below).';
    END IF;
END
$check$;

COMMIT;

-- ---------------------------------------------------------------------------
-- FALLBACK (hosted Supabase only) — run ONCE where the connecting role owns the
-- `realtime` schema: the Supabase Dashboard SQL editor
-- (https://supabase.com/dashboard/project/<ref>/sql/new), or a role granted
-- CREATE on that schema by Supabase support. This is the exact DDL guarded
-- above, unguarded.
--
--   CREATE TABLE IF NOT EXISTS realtime.messages (
--       id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--       topic text NOT NULL,
--       extension text NOT NULL,
--       inserted_at timestamptz DEFAULT now()
--   );
--
--   ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
--
--   DROP POLICY IF EXISTS "realtime_messages_select" ON realtime.messages;
--   CREATE POLICY "realtime_messages_select"
--   ON realtime.messages FOR SELECT USING (
--       auth.role() = 'service_role'
--       OR (auth.role() = 'authenticated' AND (topic LIKE 'match:%' OR topic LIKE 'game-room-%'))
--       OR topic LIKE 'match:%'
--   );
--
--   DROP POLICY IF EXISTS "realtime_messages_insert" ON realtime.messages;
--   CREATE POLICY "realtime_messages_insert"
--   ON realtime.messages FOR INSERT WITH CHECK (
--       auth.role() = 'service_role'
--       OR (auth.role() = 'authenticated' AND (topic LIKE 'match:%' OR topic LIKE 'game-room-%'))
--   );
--
-- VERIFY:  SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'realtime';
--          -- must list realtime_messages_select + realtime_messages_insert
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 6. 202610180006_indexer_cursor.sql
-- ----------------------------------------------------------------------------
-- Migration: 202610180006_indexer_cursor.sql
-- Description: Chain indexer durable cursor in Postgres (P16/G8)
-- Supports reorg-safe log indexing with atomic block progression.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chain_indexer_cursors (
  chain_id INT PRIMARY KEY,
  last_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chain_indexer_cursors ENABLE ROW LEVEL SECURITY;

-- Service role has full access; anon and authenticated cannot write
CREATE POLICY chain_indexer_cursors_service_policy
  ON public.chain_indexer_cursors
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RPC to get current cursor block
CREATE OR REPLACE FUNCTION public.get_chain_indexer_cursor(p_chain_id INT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_block BIGINT;
BEGIN
  SELECT last_block INTO v_last_block
  FROM public.chain_indexer_cursors
  WHERE chain_id = p_chain_id;

  RETURN COALESCE(v_last_block, 0);
END;
$$;

-- RPC to update cursor block atomically
CREATE OR REPLACE FUNCTION public.update_chain_indexer_cursor(p_chain_id INT, p_last_block BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.chain_indexer_cursors (chain_id, last_block, updated_at)
  VALUES (p_chain_id, p_last_block, now())
  ON CONFLICT (chain_id)
  DO UPDATE SET
    last_block = EXCLUDED.last_block,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_chain_indexer_cursor(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_chain_indexer_cursor(INT, BIGINT) TO service_role;

COMMENT ON TABLE public.chain_indexer_cursors IS 'Durable block cursor for the CHIPS chain event indexer (P16/G8).';

COMMIT;

-- ----------------------------------------------------------------------------
-- 7. 202610180007_mission_vouchers_pending_cleanup.sql
-- ----------------------------------------------------------------------------
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
