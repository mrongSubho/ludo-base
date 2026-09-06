-- ============================================================================
-- Ludo Base — Live Broadcast Chat SQL
-- Run in Supabase Dashboard > SQL Editor, top to bottom. Safe to re-run.
-- ============================================================================

-- ── live_chat: global + country-scoped shoutbox ─────────────────────────────
-- Clients render the last 20 per scope; older rows vanish from view and are
-- pruned server-side (opportunistic prune in POST /api/live-chat keeps the
-- newest 300). Content capped at 140 chars. Country is stamped server-side
-- from the Vercel IP-country header — never trust the client for it.
CREATE TABLE IF NOT EXISTS public.live_chat (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id TEXT NOT NULL,
    username TEXT,
    avatar_url TEXT,
    content TEXT NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 140),
    country CHAR(2) NOT NULL DEFAULT 'XX',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_chat_created_idx ON public.live_chat (created_at DESC);
CREATE INDEX IF NOT EXISTS live_chat_country_created_idx ON public.live_chat (country, created_at DESC);
CREATE INDEX IF NOT EXISTS live_chat_sender_created_idx ON public.live_chat (sender_id, created_at DESC);

-- ── RLS: open read, guarded insert (API enforces 10s slow-mode) ─────────────
ALTER TABLE public.live_chat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_chat open read" ON public.live_chat;
CREATE POLICY "live_chat open read"
    ON public.live_chat FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "live_chat guarded insert" ON public.live_chat;
CREATE POLICY "live_chat guarded insert"
    ON public.live_chat FOR INSERT
    WITH CHECK (char_length(content) >= 1 AND char_length(content) <= 140);

-- ── Realtime: surfaced INSERTs drive the live feed ──────────────────────────
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_chat;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
