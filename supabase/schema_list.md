# Master Supabase Schema (Phase-Wise)

This document provides a clean, production-ready schema for Ludo Base. 
**Important:** If your database is under high stress (Disk IO warnings), run this in three separate phases.

---

## 🛠️ Phase 1: The Core Foundation (Tables & Indexes)
**Copy and run this block first to create the physical structure.**

```sql
-- 1. CLEAN TEARDOWN (Wipe the slate)
DROP TRIGGER IF EXISTS trigger_update_conversation ON public.messages;
DROP FUNCTION IF EXISTS update_conversation_summary();
DROP FUNCTION IF EXISTS public.cleanup_matchmaking_queue();
DROP FUNCTION IF EXISTS public.cleanup_stale_data();

DROP TABLE IF EXISTS public.game_invites CASCADE;
DROP TABLE IF EXISTS public.matchmaking_queue CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.friendships CASCADE;
DROP TABLE IF EXISTS public.user_blocks CASCADE;
DROP TABLE IF EXISTS public.user_reports CASCADE;
DROP TABLE IF EXISTS public.player_missions CASCADE;
DROP TABLE IF EXISTS public.pokes CASCADE;
DROP TABLE IF EXISTS public.matches CASCADE;
DROP TABLE IF EXISTS public.players CASCADE;

-- 2. CREATE CORE TABLES
CREATE TABLE public.players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT UNIQUE NOT NULL,
    username TEXT,
    avatar_url TEXT,
    xp BIGINT DEFAULT 0,
    rating INT DEFAULT 0,
    coins BIGINT DEFAULT 1000,
    season_id INT DEFAULT 20241,
    status TEXT DEFAULT 'Offline',
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    classic_played integer DEFAULT 0,
    power_played integer DEFAULT 0,
    ai_played integer DEFAULT 0,
    last_played_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    CONSTRAINT enforce_lowercase_wallet CHECK (wallet_address = LOWER(wallet_address))
);

-- Automated Total Games (Generated Column)
ALTER TABLE public.players ADD COLUMN total_games INT GENERATED ALWAYS AS (
    COALESCE(classic_played, 0) + COALESCE(power_played, 0) + COALESCE(ai_played, 0)
) STORED;

CREATE INDEX idx_players_xp ON public.players (xp DESC);
CREATE INDEX idx_players_rating ON public.players (rating DESC);
CREATE INDEX idx_players_status ON public.players(status);

-- 3. SOCIAL & MESSAGING
CREATE TABLE public.friendships (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_address text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    friend_address text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_address, friend_address),
    CONSTRAINT valid_friendship_status CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    receiver_id text NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    content text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    last_message_content TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    unread_count_a INTEGER DEFAULT 0,
    unread_count_b INTEGER DEFAULT 0,
    UNIQUE(user_a, user_b)
);

-- 4. MATCHMAKING & INVITES
CREATE TABLE public.matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    game_mode TEXT NOT NULL,
    match_type TEXT NOT NULL,
    wager NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'searching',
    match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
    room_code TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_status CHECK (status IN ('searching', 'matched', 'cancelled'))
);

CREATE TABLE public.game_invites (
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

CREATE TABLE public.matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_code TEXT,
  game_mode TEXT DEFAULT 'classic',
  winner_address TEXT REFERENCES public.players(wallet_address) ON DELETE SET NULL,
  participants TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
```

---

## 🧠 Phase 2: The Intelligence (Triggers & Automation)
**Run this block only AFTER Phase 1 succeeds.**

```sql
-- 1. CONVERSATION TRACKING TRIGGER
CREATE OR REPLACE FUNCTION update_conversation_summary() RETURNS TRIGGER AS $$
DECLARE
    final_addr_a TEXT := LOWER(NEW.sender_id);
    final_addr_b TEXT := LOWER(NEW.receiver_id);
BEGIN
    IF final_addr_a > final_addr_b THEN
        DECLARE tmp TEXT := final_addr_a; BEGIN final_addr_a := final_addr_b; final_addr_b := tmp; END;
    END IF;
    INSERT INTO conversations (user_a, user_b, last_message_content, last_message_at, unread_count_a, unread_count_b)
    VALUES (final_addr_a, final_addr_b, NEW.content, NEW.created_at, CASE WHEN LOWER(NEW.receiver_id) = final_addr_a THEN 1 ELSE 0 END, CASE WHEN LOWER(NEW.receiver_id) = final_addr_b THEN 1 ELSE 0 END)
    ON CONFLICT (user_a, user_b) DO UPDATE SET last_message_content = EXCLUDED.last_message_content, last_message_at = EXCLUDED.last_message_at, unread_count_a = conversations.unread_count_a + (CASE WHEN LOWER(NEW.receiver_id) = conversations.user_a THEN 1 ELSE 0 END), unread_count_b = conversations.unread_count_b + (CASE WHEN LOWER(NEW.receiver_id) = conversations.user_b THEN 1 ELSE 0 END);
    RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_conversation AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION update_conversation_summary();

-- 2. AUTOMATIC MAINTENANCE FUNCTIONS
CREATE OR REPLACE FUNCTION public.cleanup_stale_data() RETURNS VOID AS $$
BEGIN
    DELETE FROM public.messages WHERE created_at < NOW() - INTERVAL '72 hours';
    UPDATE public.players SET status = 'Offline' WHERE status != 'Offline' AND last_seen_at < NOW() - INTERVAL '2 minutes';
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.cleanup_matchmaking_queue() RETURNS void AS $$
BEGIN
    DELETE FROM public.matchmaking_queue WHERE (status != 'searching' AND created_at < NOW() - INTERVAL '1 hour') OR (status = 'searching' AND expires_at < NOW() - INTERVAL '1 hour');
END; $$ LANGUAGE plpgsql;

-- 3. ENABLE REALTIME PUBLICATION
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_invites;

-- 4. REALTIME INDEXING
CREATE INDEX idx_game_invites_guest ON public.game_invites(guest_address) WHERE status = 'pending';

-- 5. MATCHMAKING RPC
CREATE OR REPLACE FUNCTION public.join_matchmaking(
  p_player_id TEXT,
  p_game_mode TEXT,
  p_match_type TEXT,
  p_wager NUMERIC DEFAULT 0,
  p_wager_min NUMERIC DEFAULT NULL,
  p_wager_max NUMERIC DEFAULT NULL
) 
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match_id UUID;
  v_ticket_id UUID;
  v_opponent_ticket_id UUID;
  v_opponent_id TEXT;
  v_room_code TEXT;
  v_lock_key BIGINT;
  v_result JSONB;
BEGIN
  v_lock_key := hashtext(p_game_mode || p_match_type)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  DELETE FROM public.matchmaking_queue WHERE expires_at < now();

  SELECT id INTO v_ticket_id 
  FROM public.matchmaking_queue 
  WHERE player_id = p_player_id AND status = 'searching' 
  LIMIT 1;

  SELECT id, player_id INTO v_opponent_ticket_id, v_opponent_id
  FROM public.matchmaking_queue
  WHERE status = 'searching'
    AND player_id != p_player_id
    AND game_mode = p_game_mode
    AND match_type = p_match_type
    AND (
      (p_wager_min IS NULL AND p_wager_max IS NULL AND wager = p_wager) OR
      (p_wager_min IS NOT NULL AND p_wager_max IS NOT NULL AND wager BETWEEN p_wager_min AND p_wager_max) OR
      (p_wager_min IS NOT NULL AND p_wager_max IS NULL AND wager >= p_wager_min) OR
      (p_wager_min IS NULL AND p_wager_max IS NOT NULL AND wager <= p_wager_max)
    )
  ORDER BY (wager = p_wager) DESC, created_at ASC
  LIMIT 1;

  IF v_opponent_ticket_id IS NOT NULL THEN
    v_room_code := 'QM-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));

    INSERT INTO public.matches (game_mode, participants, room_code)
    VALUES (p_game_mode, ARRAY[p_player_id, v_opponent_id], v_room_code)
    RETURNING id INTO v_match_id;

    UPDATE public.matchmaking_queue
    SET status = 'matched', match_id = v_match_id, room_code = v_room_code
    WHERE id = v_opponent_ticket_id;

    IF v_ticket_id IS NOT NULL THEN
      UPDATE public.matchmaking_queue
      SET status = 'matched', match_id = v_match_id, room_code = v_room_code
      WHERE id = v_ticket_id;
    END IF;

    v_result := jsonb_build_object(
      'status', 'matched',
      'match_id', v_match_id,
      'room_code', v_room_code,
      'role', 'guest'
    );
  ELSE
    IF v_ticket_id IS NULL THEN
      INSERT INTO public.matchmaking_queue (player_id, game_mode, match_type, wager, expires_at)
      VALUES (p_player_id, p_game_mode, p_match_type, p_wager, now() + interval '30 seconds')
      RETURNING id INTO v_ticket_id;
    ELSE
      UPDATE public.matchmaking_queue 
      SET expires_at = now() + interval '30 seconds'
      WHERE id = v_ticket_id;
    END IF;

    v_result := jsonb_build_object(
      'status', 'searching',
      'ticket_id', v_ticket_id,
      'search_timeout', 30
    );
  END IF;

  RETURN v_result;
END;
$$;
```

---

## 🛡️ Phase 3: Zero-Trust Security (RLS Policies)
**Run this block LAST to re-secure the newly created tables.**

```sql
-- 1. ENABLE RLS ON ALL TABLES
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- 2. PUBLIC READ POLICIES (Data everyone needs to see)
CREATE POLICY "Anyone can view players" ON public.players FOR SELECT USING (true);
CREATE POLICY "Anyone can view match history" ON public.matches FOR SELECT USING (true);

-- 3. IDENTITY-BOUND POLICIES (Users manage their own data)
-- Use (auth.jwt() ->> 'sub') for identity matching

-- Friendships
CREATE POLICY "Users manage own friendships" 
ON public.friendships FOR ALL 
USING (user_address = (auth.jwt() ->> 'sub')::text OR friend_address = (auth.jwt() ->> 'sub')::text);

-- Messages & Conversations
CREATE POLICY "Users manage own messages" 
ON public.messages FOR ALL 
USING (sender_id = (auth.jwt() ->> 'sub')::text OR receiver_id = (auth.jwt() ->> 'sub')::text);

CREATE POLICY "Users view own conversations" 
ON public.conversations FOR SELECT 
USING (user_a = (auth.jwt() ->> 'sub')::text OR user_b = (auth.jwt() ->> 'sub')::text);

-- Matchmaking & Invites
CREATE POLICY "Users manage own matchmaking tickets" 
ON public.matchmaking_queue FOR ALL 
USING (player_id = (auth.jwt() ->> 'sub')::text);

CREATE POLICY "Users manage own invites" 
ON public.game_invites FOR ALL 
USING (host_address = (auth.jwt() ->> 'sub')::text OR guest_address = (auth.jwt() ->> 'sub')::text);
```

---

## Phase 4: Spectator & GambleFi Betting System

> Migration name: `phase1_spectator_betting_foundation`
> Applied: 2026-03-23

### 4.1 Modified Tables

#### `matches` — New Columns
```sql
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS streaming_enabled  BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_bet_volume   BIGINT    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spectator_count    INT       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata           JSONB     DEFAULT '{}';
```

| Column | Type | Purpose |
|--------|------|---------|
| `streaming_enabled` | boolean | Host opts this match into the Live Arena directory |
| `total_bet_volume` | bigint | Running total of all coins wagered by spectators |
| `spectator_count` | int | Cached live spectator count (synced via Presence) |
| `metadata` | jsonb | Extensible match metadata (e.g. bet market config) |

---

### 4.2 New Tables

#### `live_matches`
Tracks the betting window lifecycle for each live match. Entry is created when host enables streaming.

```sql
CREATE TABLE public.live_matches (
    match_id           UUID        PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
    room_code          TEXT        NOT NULL,
    bet_window_status  TEXT        NOT NULL DEFAULT 'closed',  -- 'open' | 'closed' | 'resolving'
    window_opened_at   TIMESTAMPTZ,
    window_closed_at   TIMESTAMPTZ,  -- spectator bets MUST have created_at < this
    current_bet_type   TEXT,
    spectator_count    INT         NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT valid_window_status CHECK (bet_window_status IN ('open', 'closed', 'resolving'))
);

CREATE INDEX idx_live_matches_streaming ON public.live_matches(bet_window_status);
```

**RLS:**
- `SELECT`: public (needed for Live Arena directory)
- `INSERT/UPDATE/DELETE`: blocked for all users — only the `resolve-bet` Edge Function (service role) may write

---

#### `spectator_bets`
All wagers placed by the audience during a live match.

```sql
CREATE TABLE public.spectator_bets (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id        TEXT        NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    match_id         UUID        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    bet_type         TEXT        NOT NULL,   -- 'winner' | 'dice_roll' | 'elimination' | 'custom'
    bet_value        TEXT        NOT NULL,   -- predicted outcome
    bet_metadata     JSONB       DEFAULT '{}',
    amount           BIGINT      NOT NULL,
    odds             NUMERIC(10, 2),
    potential_payout BIGINT,
    status           TEXT        NOT NULL DEFAULT 'pending',   -- 'pending' | 'won' | 'lost' | 'cancelled'
    action_id        TEXT,                   -- game action that resolved this bet (audit trail)
    window_closed_at TIMESTAMPTZ NOT NULL,   -- snapshot at bet time — timing guard
    created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    resolved_at      TIMESTAMPTZ,
    CONSTRAINT positive_bet_amount CHECK (amount > 0),
    CONSTRAINT valid_bet_status    CHECK (status IN ('pending', 'won', 'lost', 'cancelled'))
);

CREATE INDEX idx_bets_match_pending  ON public.spectator_bets(match_id, status) WHERE status = 'pending';
CREATE INDEX idx_bets_player         ON public.spectator_bets(player_id);
CREATE INDEX idx_bets_window_timing  ON public.spectator_bets(match_id, window_closed_at, created_at);
```

**RLS:**
- `SELECT`: public (for live odds calculation)
- `INSERT`: authenticated users, own bets only (`player_id = auth.jwt() ->> 'sub'`)
- `UPDATE/DELETE`: blocked for all users — only Edge Function (service role)

---

### 4.3 Settle Match Bets RPC

```sql
-- Called by resolve-bet Edge Function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.settle_match_bets(
    p_match_id UUID,
    p_result TEXT,
    p_bet_type TEXT
)
RETURNS TABLE (
    payout_count INT,
    total_payout BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated permissions to update player coins
AS $$
DECLARE
    v_payout_count INT := 0;
    v_total_payout BIGINT := 0;
    v_window_closed TIMESTAMPTZ;
BEGIN
    -- 0. Security Check: Has the betting window actually closed?
    SELECT window_closed_at INTO v_window_closed
    FROM public.live_matches
    WHERE match_id = p_match_id;

    IF v_window_closed IS NULL OR v_window_closed > NOW() THEN
        RAISE EXCEPTION 'Betting window still open or match not found';
    END IF;

    -- 1. Mark winners and update their coins
    WITH winners AS (
        UPDATE public.spectator_bets
        SET status = 'won',
            resolved_at = NOW()
        WHERE match_id = p_match_id
          AND status = 'pending'
          AND bet_type = p_bet_type
          AND bet_value = p_result
        RETURNING player_id, potential_payout
    ),
    coin_updates AS (
        UPDATE public.players p
        SET coins = p.coins + w.potential_payout
        FROM winners w
        WHERE p.wallet_address = w.player_id
        RETURNING w.potential_payout
    )
    SELECT count(*), COALESCE(sum(potential_payout), 0)
    INTO v_payout_count, v_total_payout
    FROM winners;

    -- 2. Mark losers
    UPDATE public.spectator_bets
    SET status = 'lost',
        resolved_at = NOW()
    WHERE match_id = p_match_id
      AND status = 'pending'
      AND bet_type = p_bet_type
      AND bet_value != p_result;

    RETURN QUERY SELECT v_payout_count, v_total_payout;
END;
$$;
```

---

### 4.4 Realtime Publication

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.spectator_bets;
```

Spectators subscribe to `live_matches` changes to power the Live Arena directory.

---

### 4.5 Edge Function: `resolve-bet`

| Property | Value |
|----------|-------|
| Slug | `resolve-bet` |
| Version | 1 |
| Status | ACTIVE |
| Auth | JWT required |
| Idempotency | `WHERE status = 'pending'` on every UPDATE |

**Request body:**
```json
{
  "matchId": "uuid",
  "actionId": "string",
  "betType": "dice_roll | winner | elimination | custom",
  "resultValue": "string",
  "participants": ["0xabc...", "0xdef..."]
}
```

**Tokenomics (on `betType='winner'`):**
| Recipient | Cut |
|-----------|-----|
| Match Players | 3.0% of `total_bet_volume` |
| Protocol Treasury | 2.0% of `total_bet_volume` |
| **Total Fee** | **5.0%** |

