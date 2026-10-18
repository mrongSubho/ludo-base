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
