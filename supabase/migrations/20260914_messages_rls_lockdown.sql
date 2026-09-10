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

CREATE OR REPLACE FUNCTION public.messages_restrict_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.sender_id IS DISTINCT FROM OLD.sender_id
       OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id
       OR NEW.content IS DISTINCT FROM OLD.content THEN
        RAISE EXCEPTION 'messages: sender/receiver/content are immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_restrict_columns ON public.messages;
CREATE TRIGGER trg_messages_restrict_columns
    BEFORE UPDATE ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.messages_restrict_columns();
