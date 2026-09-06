-- ============================================================================
-- Ludo Base — DM messages RLS
-- Run in Supabase Dashboard > SQL Editor, top to bottom. Safe to re-run.
--
-- WHY: sending a DM inserts into public.messages through the anon key and
-- gets 401 without an INSERT policy — every send lands as "Failed to send".
-- The app has no Supabase Auth (identity IS the wallet), so policies below
-- are permissive but CHECK-constrained. Privacy holds because message
-- content is E2E-encrypted ciphertext (only sender/receiver derive the key).
-- Conversation rows are maintained by the existing DB trigger; nothing to
-- create there — we only ensure anon can read them + receive realtime.
-- ============================================================================

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- Ciphertext is opaque without the shared key: open read is safe.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'messages open read' AND tablename = 'messages') THEN
        CREATE POLICY "messages open read"
            ON public.messages FOR SELECT USING (true);
    END IF;

    -- The send path (useDataActions.sendMessage).
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'messages validated insert' AND tablename = 'messages') THEN
        CREATE POLICY "messages validated insert"
            ON public.messages FOR INSERT
            WITH CHECK (
                char_length(sender_id) BETWEEN 3 AND 64
                AND char_length(receiver_id) BETWEEN 3 AND 64
                AND sender_id <> receiver_id
                AND char_length(content) BETWEEN 1 AND 8192
            );
    END IF;

    -- Read receipts + local deletes (is_read / deleted_by_* flags).
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'messages parties update' AND tablename = 'messages') THEN
        CREATE POLICY "messages parties update"
            ON public.messages FOR UPDATE USING (true);
    END IF;
END $$;

-- Conversations list must stay readable (trigger-maintained rows).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'conversations open read' AND tablename = 'conversations') THEN
        BEGIN
            CREATE POLICY "conversations open read"
                ON public.conversations FOR SELECT USING (true);
        EXCEPTION WHEN undefined_table THEN
            NULL;
        END;
    END IF;
END $$;

-- Realtime thread updates (INSERT + read-flag UPDATEs).
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
