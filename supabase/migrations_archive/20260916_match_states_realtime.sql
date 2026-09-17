-- Realtime for match_states (P4: clients render server authority)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.match_states;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
