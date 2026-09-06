-- ============================================================================
-- Ludo Base — DM soft-delete flags
-- Run in Supabase Dashboard > SQL Editor, top to bottom. Safe to re-run.
--
-- WHY: the Session Inbox (per-side vanish) flags rows via deleted_by_sender /
-- deleted_by_receiver, but Phase 1 never created those columns — every flag
-- write 400s and vanished messages keep reappearing. This adds them.
-- ============================================================================

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS deleted_by_sender BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS deleted_by_receiver BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS messages_participant_flags_idx
    ON public.messages (sender_id, receiver_id, deleted_by_sender, deleted_by_receiver);
