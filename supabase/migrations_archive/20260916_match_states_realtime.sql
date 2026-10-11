-- ARCHIVED — frozen history, never applied by any chain. Canonical schema lives in supabase/migrations/; new SQL goes there only.

-- Realtime for match_states (P4: clients render server authority)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.match_states;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;