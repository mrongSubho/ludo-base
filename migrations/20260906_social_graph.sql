-- ============================================================================
-- Ludo Base — Social Graph SQL
-- Run in Supabase Dashboard > SQL Editor, top to bottom. Safe to re-run.
--
-- WHY: Add Friend / Poke / Block / Report / Missions all write through the
-- anon key (the app has no Supabase Auth — identity IS the wallet). Two
-- tables never existed (pokes, user_blocks, user_reports, player_missions),
-- so those actions 500'd; the rest need explicit RLS or anon writes die.
--
-- SECURITY NOTE: with no auth.jwt, policies below are intentionally
-- permissive but CHECK-constrained (length caps, status enums, no self-links).
-- Abuse levers that remain: 10s slow-mode + daily caps live in API routes.
-- ============================================================================

-- ── 1. pokes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pokes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id TEXT NOT NULL CHECK (char_length(sender_id) BETWEEN 3 AND 64),
    receiver_id TEXT NOT NULL CHECK (char_length(receiver_id) BETWEEN 3 AND 64),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'poked_back')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    poked_back_at TIMESTAMPTZ,
    CHECK (sender_id <> receiver_id)
);

-- The poke inbox JOIN (GET /api/social/poke) addresses this FK by name —
-- keep the constraint name EXACT.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pokes_sender_id_fkey'
    ) THEN
        ALTER TABLE public.pokes
            ADD CONSTRAINT pokes_sender_id_fkey
            FOREIGN KEY (sender_id) REFERENCES public.players(wallet_address)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS pokes_receiver_status_idx
    ON public.pokes (receiver_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS pokes_sender_created_idx
    ON public.pokes (sender_id, created_at DESC);

-- ── 2. user_blocks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_address TEXT NOT NULL CHECK (char_length(blocker_address) BETWEEN 3 AND 64),
    blocked_address TEXT NOT NULL CHECK (char_length(blocked_address) BETWEEN 3 AND 64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (blocker_address <> blocked_address)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_pair_uniq'
    ) THEN
        ALTER TABLE public.user_blocks
            ADD CONSTRAINT user_blocks_pair_uniq UNIQUE (blocker_address, blocked_address);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_blocks_blocker_idx ON public.user_blocks (blocker_address);

-- ── 3. user_reports (write-only for clients) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_address TEXT NOT NULL CHECK (char_length(reporter_address) BETWEEN 3 AND 64),
    reported_address TEXT NOT NULL CHECK (char_length(reported_address) BETWEEN 3 AND 64),
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (reporter_address <> reported_address)
);

-- ── 4. player_missions (drives Arena missions + poke-back progress) ─────────
CREATE TABLE IF NOT EXISTS public.player_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL CHECK (char_length(player_id) BETWEEN 3 AND 64),
    mission_id TEXT NOT NULL CHECK (char_length(mission_id) BETWEEN 2 AND 64),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
    is_claimed BOOLEAN NOT NULL DEFAULT FALSE,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'player_missions_pair_uniq'
    ) THEN
        ALTER TABLE public.player_missions
            ADD CONSTRAINT player_missions_pair_uniq UNIQUE (player_id, mission_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS player_missions_player_idx ON public.player_missions (player_id);

-- ── 5. friendships (may already exist — only fill gaps) ─────────────────────
CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT NOT NULL,
    friend_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (user_address <> friend_address)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'friendships_pair_uniq'
    ) THEN
        ALTER TABLE public.friendships
            ADD CONSTRAINT friendships_pair_uniq UNIQUE (user_address, friend_address);
    END IF;
END $$;

-- The requests inbox JOINs players on both columns by these exact FK names
-- (see FriendsPanel). NOT VALID so legacy orphan rows can never block it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_user_address_fkey') THEN
        ALTER TABLE public.friendships
            ADD CONSTRAINT friendships_user_address_fkey
            FOREIGN KEY (user_address) REFERENCES public.players(wallet_address)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_friend_address_fkey') THEN
        ALTER TABLE public.friendships
            ADD CONSTRAINT friendships_friend_address_fkey
            FOREIGN KEY (friend_address) REFERENCES public.players(wallet_address)
            ON DELETE CASCADE NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS friendships_friend_status_idx
    ON public.friendships (friend_address, status);

-- ── 6. RLS (additive only — never touches existing policies) ────────────────
ALTER TABLE public.pokes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol RECORD;
BEGIN
    -- friendships: open read, validated writes either direction
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'friendships open read' AND tablename = 'friendships') THEN
        CREATE POLICY "friendships open read" ON public.friendships FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'friendships validated insert' AND tablename = 'friendships') THEN
        CREATE POLICY "friendships validated insert" ON public.friendships FOR INSERT
            WITH CHECK (char_length(user_address) BETWEEN 3 AND 64 AND char_length(friend_address) BETWEEN 3 AND 64);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'friendships parties update' AND tablename = 'friendships') THEN
        CREATE POLICY "friendships parties update" ON public.friendships FOR UPDATE USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'friendships parties delete' AND tablename = 'friendships') THEN
        CREATE POLICY "friendships parties delete" ON public.friendships FOR DELETE USING (true);
    END IF;

    -- pokes: open read, validated lifecycle
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pokes open read' AND tablename = 'pokes') THEN
        CREATE POLICY "pokes open read" ON public.pokes FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pokes validated insert' AND tablename = 'pokes') THEN
        CREATE POLICY "pokes validated insert" ON public.pokes FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pokes parties update' AND tablename = 'pokes') THEN
        CREATE POLICY "pokes parties update" ON public.pokes FOR UPDATE USING (true);
    END IF;

    -- user_blocks: blocker manages own rows (open, CHECK-constrained)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'blocks open read' AND tablename = 'user_blocks') THEN
        CREATE POLICY "blocks open read" ON public.user_blocks FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'blocks manage' AND tablename = 'user_blocks') THEN
        CREATE POLICY "blocks manage" ON public.user_blocks FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- user_reports: insert-only for clients
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reports insert' AND tablename = 'user_reports') THEN
        CREATE POLICY "reports insert" ON public.user_reports FOR INSERT WITH CHECK (true);
    END IF;

    -- player_missions: driven by API routes under anon
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'missions open read' AND tablename = 'player_missions') THEN
        CREATE POLICY "missions open read" ON public.player_missions FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'missions insert' AND tablename = 'player_missions') THEN
        CREATE POLICY "missions insert" ON public.player_missions FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'missions update' AND tablename = 'player_missions') THEN
        CREATE POLICY "missions update" ON public.player_missions FOR UPDATE USING (true);
    END IF;

    -- players: ensure the pre-registration upsert (wallet_address only) can land
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'players open insert' AND tablename = 'players') THEN
        CREATE POLICY "players open insert" ON public.players FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'players open update' AND tablename = 'players') THEN
        CREATE POLICY "players open update" ON public.players FOR UPDATE USING (true);
    END IF;
END $$;

-- ── 7. Realtime: request + poke arrivals push live to both ends ─────────────
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pokes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
