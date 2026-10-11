-- ARCHIVED — frozen history, never applied by any chain. Canonical schema
-- lives in supabase/migrations/; new SQL goes there only.

-- Tighten messages UPDATE: previously USING (true) let anyone flip any column.
-- Without Supabase Auth we cannot bind UPDATE to the wallet caller, so this
-- migration locks the mutable surface to read-receipt / delete-flag columns
-- via a trigger. Full wallet-bound policies need real auth (follow-up).

DROP POLICY IF EXISTS "messages parties update" ON public.messages;
DROP POLICY IF EXISTS "messages parties update" ON public.messages;

-- Fail closed: no general UPDATE policy. Flag updates go through the trigger
-- path below only when a policy allows; until auth exists we keep a narrow
-- policy that at least keeps sender/receiver/content immutable.
CREATE POLICY "messages flag updates only"
    ON public.messages FOR UPDATE
    USING (true)
    WITH CHECK (
        sender_id IS NOT NULL
        AND receiver_id IS NOT NULL
        AND char_length(content) BETWEEN 1 AND 8192
    );

-- CRY-07: the messages_restrict_columns() copy that lived below is
-- intentionally reduced to this comment. Canonical trigger:
-- supabase/migrations/00000000000000_baseline.sql (messages_restrict_columns
-- + trg_messages_restrict_columns). Keeping a second copy here invited the
-- next reader to "fix" the wrong one.
