# Production-Ready Supabase Database Schema (Refactored)

This document contains the refactored database schema, optimized for security, data integrity, and performance in a Web3/Wallet-based production environment.

---

## 1. Core User Data (Players Table)
*Extends the base players table with progression, economy, and strict address validation.*

```sql
-- 1.1 Strict Case-Sensitivity and Progression Columns
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS xp BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS rating INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS coins BIGINT DEFAULT 1000,
ADD COLUMN IF NOT EXISTS season_id INT DEFAULT 20241;

-- 1.2 Case-Insensitive Wallet Enforcement
-- Prevents duplicate records for the same wallet (e.g., 0xA... and 0xa...)
ALTER TABLE public.players 
ADD CONSTRAINT enforce_lowercase_wallet CHECK (wallet_address = LOWER(wallet_address));

-- 1.3 presence Tracking
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Offline',
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 1.4 Match Statistics and Automated Total Games
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS classic_played integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS power_played integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_played integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_played_at timestamp with time zone DEFAULT timezone('utc'::text, now());

-- Automatically calculate total_games to reduce trigger maintenance
ALTER TABLE public.players DROP COLUMN IF EXISTS total_games;
ALTER TABLE public.players ADD COLUMN total_games INT GENERATED ALWAYS AS (
    COALESCE(classic_played, 0) + COALESCE(power_played, 0) + COALESCE(ai_played, 0)
) STORED;

-- 1.5 Performance Indexes
CREATE INDEX IF NOT EXISTS idx_players_xp ON public.players (xp DESC);
CREATE INDEX IF NOT EXISTS idx_players_rating ON public.players (rating DESC);
CREATE INDEX IF NOT EXISTS idx_players_status ON public.players(status);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON public.players(last_seen_at);
```

---

## 2. Social System (Friendships, Blocks, Reports)
*Handles user interactions with strict RLS and referential integrity.*

```sql
-- 2.1 Friendships Table with Constraints
CREATE TABLE IF NOT EXISTS public.friendships (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_address text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    friend_address text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_address, friend_address),
    CONSTRAINT valid_friendship_status CHECK (status IN ('pending', 'accepted', 'rejected'))
);

-- 2.2 User Blocks Table
CREATE TABLE IF NOT EXISTS public.user_blocks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    blocker_address text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    blocked_address text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(blocker_address, blocked_address)
);

-- 2.3 User Reports Table
CREATE TABLE IF NOT EXISTS public.user_reports (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reporter_address text NOT NULL REFERENCES public.players(wallet_address) ON DELETE RESTRICT,
    reported_address text NOT NULL REFERENCES public.players(wallet_address) ON DELETE SET NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT valid_report_status CHECK (status IN ('open', 'reviewed', 'resolved'))
);

-- 2.4 Secure identity-Based Policies
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- Note: Adjust (auth.jwt() ->> 'sub') if your JWT stores the wallet in a different claim
CREATE POLICY "Users can manage their own friendships" 
ON public.friendships FOR ALL 
USING (user_address = (auth.jwt() ->> 'sub')::text OR friend_address = (auth.jwt() ->> 'sub')::text);

CREATE POLICY "Users can manage their own blocks" 
ON public.user_blocks FOR ALL 
USING (blocker_address = (auth.jwt() ->> 'sub')::text);

CREATE POLICY "Authenticated users can submit reports" 
ON public.user_reports FOR INSERT 
WITH CHECK (reporter_address = (auth.jwt() ->> 'sub')::text);

CREATE INDEX IF NOT EXISTS idx_friendships_user ON public.friendships(user_address);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON public.friendships(friend_address);
```

---

## 3. Messaging & Conversations System
*Self-cleaning messaging with unread count triggers.*

```sql
-- 3.1 Messages Table with Referential Integrity
CREATE TABLE IF NOT EXISTS public.messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    receiver_id text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    content text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_by_sender boolean DEFAULT false NOT NULL,
    deleted_by_receiver boolean DEFAULT false NOT NULL
);

-- 3.2 Conversations Metadata Table
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    last_message_content TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    unread_count_a INTEGER DEFAULT 0,
    unread_count_b INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_a, user_b)
);

-- 3.3 Automating Conversation Summaries (Trigger)
CREATE OR REPLACE FUNCTION update_conversation_summary()
RETURNS TRIGGER AS $$
DECLARE
    final_addr_a TEXT := LOWER(NEW.sender_id);
    final_addr_b TEXT := LOWER(NEW.receiver_id);
BEGIN
    -- Deterministic alphabetical order
    IF final_addr_a > final_addr_b THEN
        DECLARE tmp TEXT := final_addr_a; BEGIN final_addr_a := final_addr_b; final_addr_b := tmp; END;
    END IF;

    INSERT INTO conversations (user_a, user_b, last_message_content, last_message_at, unread_count_a, unread_count_b)
    VALUES (
        final_addr_a, final_addr_b, NEW.content, NEW.created_at,
        CASE WHEN LOWER(NEW.receiver_id) = final_addr_a THEN 1 ELSE 0 END,
        CASE WHEN LOWER(NEW.receiver_id) = final_addr_b THEN 1 ELSE 0 END
    )
    ON CONFLICT (user_a, user_b) DO UPDATE SET
        last_message_content = EXCLUDED.last_message_content,
        last_message_at = EXCLUDED.last_message_at,
        unread_count_a = conversations.unread_count_a + (CASE WHEN LOWER(NEW.receiver_id) = conversations.user_a THEN 1 ELSE 0 END),
        unread_count_b = conversations.unread_count_b + (CASE WHEN LOWER(NEW.receiver_id) = conversations.user_b THEN 1 ELSE 0 END);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_conversation
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_summary();

-- 3.4 Identity-Based Security Policies
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their sent/received messages" 
ON public.messages FOR ALL 
USING (sender_id = (auth.jwt() ->> 'sub')::text OR receiver_id = (auth.jwt() ->> 'sub')::text);

CREATE POLICY "Users can view their own conversations" 
ON conversations FOR SELECT 
USING (user_a = (auth.jwt() ->> 'sub')::text OR user_b = (auth.jwt() ->> 'sub')::text);

-- Realtime performance optimization
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
CREATE INDEX IF NOT EXISTS idx_conversations_users ON public.conversations(user_a, user_b);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON public.messages(receiver_id) WHERE is_read = false;
```

---

## 4. Matchmaking System
*Refactored with foreign keys to prevent orphan queue tickets.*

```sql
-- 4.1 Matchmaking Queue Table
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    game_mode TEXT NOT NULL,
    match_type TEXT NOT NULL,
    wager NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'searching',
    match_id UUID,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_status CHECK (status IN ('searching', 'matched', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_matchmaking_search 
ON public.matchmaking_queue (game_mode, match_type, wager, status) 
WHERE status = 'searching';

-- 4.2 join_matchmaking RPC remains optimized with advisory locks.
```

---

## 5. Gameplay & Economy (Matches, Invites, Missions)
*Ensures all related tables respect player lifespan.*

```sql
-- 5.1 Matches Table
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_code TEXT,
  game_mode TEXT DEFAULT 'classic',
  winner_address TEXT REFERENCES public.players(wallet_address) ON DELETE SET NULL,
  participants TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 5.2 Game Invites
CREATE TABLE IF NOT EXISTS public.game_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL,
  host_address TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
  guest_address TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
  match_type TEXT,
  entry_fee NUMERIC,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_invite_status CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'))
);

-- Realtime indexing
CREATE INDEX IF NOT EXISTS idx_game_invites_guest ON public.game_invites(guest_address) WHERE status = 'pending';

-- 5.3 Missions & Pokes
ALTER TABLE public.player_missions DROP CONSTRAINT IF EXISTS player_missions_player_id_fkey;
ALTER TABLE public.player_missions ADD CONSTRAINT fk_player_missions FOREIGN KEY (player_id) REFERENCES public.players(wallet_address) ON DELETE CASCADE;

ALTER TABLE public.pokes DROP CONSTRAINT IF EXISTS pokes_sender_id_fkey;
ALTER TABLE public.pokes DROP CONSTRAINT IF EXISTS pokes_receiver_id_fkey;
ALTER TABLE public.pokes ADD CONSTRAINT fk_pokes_sender FOREIGN KEY (sender_id) REFERENCES public.players(wallet_address) ON DELETE CASCADE;
ALTER TABLE public.pokes ADD CONSTRAINT fk_pokes_receiver FOREIGN KEY (receiver_id) REFERENCES public.players(wallet_address) ON DELETE CASCADE;
```

---

## 6. Maintenance & Automation
*Background cleanup tasks for IO and data health.*

```sql
-- 6.1 Matchmaking Cleanup
CREATE OR REPLACE FUNCTION public.cleanup_matchmaking_queue()
RETURNS void AS $$
BEGIN
    DELETE FROM public.matchmaking_queue
    WHERE (status != 'searching' AND created_at < NOW() - INTERVAL '1 hour')
       OR (status = 'searching' AND expires_at < NOW() - INTERVAL '1 hour');
END;
$$ LANGUAGE plpgsql;

-- 6.2 Status & Messaging Cleanup
CREATE OR REPLACE FUNCTION public.cleanup_stale_data()
RETURNS VOID AS $$
BEGIN
    -- Clear messages older than 72 hours
    DELETE FROM public.messages WHERE created_at < NOW() - INTERVAL '72 hours';
    -- Reset online status of inactive players
    UPDATE public.players SET status = 'Offline'
    WHERE status != 'Offline' AND last_seen_at < NOW() - INTERVAL '2 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```
