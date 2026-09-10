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
    lxp BIGINT DEFAULT 0,
    rxp INT DEFAULT 0,
    coins BIGINT DEFAULT 1000,
    season_id INT DEFAULT 20241,
    status TEXT DEFAULT 'Offline',
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    classic_played integer DEFAULT 0,
    power_played integer DEFAULT 0,
    ai_played integer DEFAULT 0,
    total_wins integer DEFAULT 0,
    rank_tier TEXT DEFAULT 'Bronze',
    last_played_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    CONSTRAINT enforce_lowercase_wallet CHECK (wallet_address = LOWER(wallet_address))
);

-- Automated Total Games (Generated Column)
ALTER TABLE public.players ADD COLUMN total_games INT GENERATED ALWAYS AS (
    COALESCE(classic_played, 0) + COALESCE(power_played, 0) + COALESCE(ai_played, 0)
) STORED;

CREATE INDEX idx_players_lxp ON public.players (lxp DESC);
CREATE INDEX idx_players_rxp ON public.players (rxp DESC);
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
ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;

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

---

## Phase 5: LXP / RXP Rename (already live — do NOT re-run)

> ✅ Verified 2026-09-04: the live `players` table already carries `lxp`/`rxp`
> (running the RENAME below now fails with `42703: column "xp" does not exist`).
> Fresh setups get the right names from Phase 1 directly. Kept for history.

> ⚠️ Skip this phase on fresh setups — Phase 1 already creates `lxp`/`rxp`.
> Run this block on a **live** database to rename `xp` → `lxp` (Level XP, permanent)
> and `rating` → `rxp` (Rank XP, seasonal) without losing data.
> Run **before** deploying the matching code change.

```sql
-- 1. Rename columns (atomic, preserves all data)
ALTER TABLE public.players RENAME COLUMN xp TO lxp;
ALTER TABLE public.players RENAME COLUMN rating TO rxp;

-- 2. Rename indexes to match
ALTER INDEX IF EXISTS idx_players_xp RENAME TO idx_players_lxp;
ALTER INDEX IF EXISTS idx_players_rating RENAME TO idx_players_rxp;
```

---

## Phase 6: Social Graph, Session Inbox & Live Broadcast (applied 2026-09-06)

> Migration files: `migrations/20260906_social_graph.sql`,
> `migrations/20260906_messages_rls.sql`, `migrations/20260906_messages_flags.sql`,
> `migrations/20260906_live_broadcast.sql` (the `live_chat` table + RLS).
> All files are idempotent — safe to re-run.

### 6.1 Correction to Phase 3 (read this first)

Phase 3's identity-bound policies (`auth.jwt() ->> 'sub'`) **cannot work**: the
app authenticates with the anon key and identity IS the wallet — there is no
Supabase Auth session, so those predicates never match and anon writes 401.
The fix is additive anon policies (CHECK-constrained, documented per table);
permissive policies combine with OR, so nothing old needs dropping. Reads of
ciphertext (`messages.content` is E2E-encrypted) stay safe under open reads.

### 6.2 New tables

#### `pokes`
```sql
CREATE TABLE public.pokes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id TEXT NOT NULL CHECK (char_length(sender_id) BETWEEN 3 AND 64),
    receiver_id TEXT NOT NULL CHECK (char_length(receiver_id) BETWEEN 3 AND 64),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'poked_back')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    poked_back_at TIMESTAMPTZ,
    CHECK (sender_id <> receiver_id)
);
-- Named FK the poke inbox JOIN addresses explicitly:
-- CONSTRAINT pokes_sender_id_fkey FOREIGN KEY (sender_id)
--   REFERENCES public.players(wallet_address) ON DELETE CASCADE
```
**RLS:** open `SELECT`; validated `INSERT`/`UPDATE`. Realtime published.

#### `user_blocks`
`(id, blocker_address, blocked_address, created_at)`, unique pair.
**RLS:** open `SELECT` (profile modal reads block status) + manage-all.

#### `user_reports`
`(id, reporter_address, reported_address, reason, created_at)`.
**RLS:** insert-only for clients.

#### `player_missions`
`(id, player_id, mission_id, progress, is_claimed, last_updated, created_at)`,
unique `(player_id, mission_id)`. Drives Arena missions + poke-back progress.
**RLS:** open read/insert/update (API routes run under anon).

#### `live_chat`
`(id, sender_id, username, avatar_url, content≤140, country, created_at)`
+ created/country/sender indexes. Country is stamped server-side from the
edge IP header. **RLS:** open read, length-checked insert. Pruned
opportunistically (newest 300 kept, no cron).

### 6.3 Altered tables

- `friendships` — added the two **named** FKs the inbox JOINs address
  (`friendships_user_address_fkey`, `friendships_friend_address_fkey`,
  `NOT VALID` so legacy orphans can't block), pair unique, RLS opened
  (read / validated insert / parties update+delete), realtime published.
- `messages` — added `deleted_by_sender` / `deleted_by_receiver`
  (`BOOLEAN NOT NULL DEFAULT FALSE`) powering the per-side Session Inbox
  vanish; RLS opened (read / validated insert ≤8192 chars / parties update);
  realtime published alongside `conversations`.
- `players` — RLS opened (read/insert/update) so pre-registration upserts
  (`{ wallet_address }` only) land; required by the `messages` FKs.

---

## Phase 7: User Feedback Inbox (applied 2026-09-08)

> Migration file: `migrations/20260910_feedback.sql` (idempotent — safe to re-run).
> Powers Settings → Feedback. Submits carry the sender's wallet-or-guest id.

### 7.1 New table

#### `feedback`
```sql
CREATE TABLE public.feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic TEXT NOT NULL DEFAULT 'Other',
    message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**RLS:** `ENABLE ROW LEVEL SECURITY` + `feedback_insert_any` allows `INSERT`
to `anon, authenticated` with `WITH CHECK (true)` — anyone (wallet or guest)
may submit. No client `SELECT`/`UPDATE`/`DELETE` policies: reads stay
service-role only.

---

## Phase 8: Read-Repair RPC (applied 2026-09-09)

> Migration file: `migrations/20260911_mark_conversation_read.sql`
> (`create or replace` — idempotent, safe to re-run).

### 8.1 Why

Opening a thread zeroed `conversations.unread_count_*` only in local state.
The insert trigger (`update_conversation_summary`) only ever increments, so
every reboot resurrected the header badge for long-read threads.

### 8.2 `mark_conversation_read(me, friend)`

`SECURITY DEFINER` (bypasses RLS — anon clients call it directly):

1. Marks the friend's messages to `me` read (`is_read = true`).
2. **Recomputes** both counters from remaining unread per direction —
   never blind-zeroes, so a message arriving mid-call stays counted.
3. Uses the trigger's canonical pair ordering (`least`/`greatest`), so the
   `WHERE user_a/u2` row always matches.

Client (`useDataActions.markChatAsRead`) awaits it with a direct-update
fallback; opening each thread once repairs legacy inflated counts.

---

## Phase 9: Server-Side Retention (applied 2026-09-09)

> Migration file: `migrations/20260912_message_retention.sql`
> (`create or replace` — idempotent, safe to re-run).
> Schedule it: enable **pg_cron** (Dashboard > Database > Extensions), then
> `SELECT cron.schedule('dm-retention-daily', '0 3 * * *',
> $$SELECT public.cleanup_stale_data()$$);`
> Run `SELECT public.cleanup_stale_data();` once for immediate effect.

### 9.1 Retention inventory (whole backend)

| Data | Rule | Enforced by |
|------|------|-------------|
| DM `messages` — **read** | deleted after **24h** | `cleanup_stale_data()` (this phase) |
| DM `messages` — unread | absolute backstop **7 days** (unread otherwise survives forever) | same |
| `conversations` counters | reconciled from remaining rows after every purge (badges can't inflate from deleted mail) | same |
| `matchmaking_queue` tickets | expire **30s** (`expires_at`), swept inline by the join RPC | `hybrid_matchmaking` RPC |
| `matchmaking_queue` dead rows | cancelled + `searching` older than **1h** | `cleanup_matchmaking_queue()` (pg_cron, commented schedule in `migrations/20260904_matchmaking_phase1.sql`) |
| `game_invites` | no server TTL (status machine only) | — |
| `live_chat` | newest **300** rows kept, pruned opportunistically on every POST | `app/api/live-chat/route.ts` |
| `live_matches` / `spectator_bets` | no TTL (settled bets stay as audit trail) | — |
| `players.status` | idle → `Offline` after **1–2 min** (`last_seen_at`) | `cleanup_stale_data()` (+ `update_offline_status()` variant) |

### 9.2 Notes

- This phase **replaces** the old Phase-2 `cleanup_stale_data()` message rule
  (`DELETE … < 72 hours` regardless of read state), which violated
  "unread always survives". Same function name, coherent semantics.
- Purge touches only conversations with deleted rows (`_purged_pairs` temp
  table) — no full-table counter rewrite.
- Nothing above runs itself: every row requires either an inline trigger
  (matchmaking join, live-chat POST) or a pg_cron schedule. If pg_cron was
  never enabled, no periodic cleanup has ever run.

---

## Phase 10: Live Room Announcements (applied 2026-09-09)

> Migration file: `migrations/20260913_live_room_announce.sql`
> (idempotent — safe to re-run). No RLS change: anon still has no UPDATE
> policy; the `/api/live-chat` route upserts with the service role.

### 10.1 Altered table

- `live_chat` — added `room_code TEXT NULL` + `room_open BOOLEAN NOT NULL
  DEFAULT TRUE`, index `(room_code, created_at DESC)`. One row per announced
  room (upserted by sender+room): seat fills rewrite `content`
  (`Classic · 2v2 · Free · 3/4 · join`, no code shown), start/leave flips
  `room_open` instead of deleting. The 300-row opportunistic prune still
  bounds growth. Guests (`guest_` ids) may announce; identity falls back
  to `Guest XXXX`.

### 10.2 Consumers (all realtime)

- Live chat: whole-row tap joins open rooms; started rows dim with an
  Over chip. UPDATEs merge in place (INSERT-only before).
- Live Matches tab: Open-rooms section — backfilled (latest open row per
  room) + INSERT/UPDATE subscription; whole-row join.
- Broadcast card: ON AIR deep-links to the matches tab; right block shows
  the live joinable count (searching tickets + distinct open rooms).

---

## Phase 11: Signed settlement + messages column lock (applied 2026-09-11)

> Migration files:
> - `supabase/migrations/20260914_live_matches_host_address.sql`
> - `supabase/migrations/20260914_messages_rls_lockdown.sql`
>
> Edge Function **must** be redeployed after this phase:
> `supabase functions deploy resolve-bet --project-ref <ref>`

### 11.1 `live_matches.host_address`

```sql
ALTER TABLE public.live_matches
  ADD COLUMN IF NOT EXISTS host_address TEXT;

CREATE INDEX IF NOT EXISTS idx_live_matches_host
  ON public.live_matches(host_address)
  WHERE host_address IS NOT NULL;
```

**Who writes it:** client host on `hostGame()` upsert and again on `START_GAME` (lowercased wallet).  
**Who reads it:** `supabase/functions/resolve-bet` — recovers the signer from a `buildBetResolveMessage` payload and requires `host_address` match (fail closed if null). Window timing (`NOW() > window_closed_at`) is still enforced inside `settle_match_bets`.

### 11.2 Messages UPDATE lockdown

Replaces the open `USING (true)` update policy surface:

- Policy `messages flag updates only` — UPDATE still allowed for read-receipt / delete flags, but content/sender/receiver must stay well-formed.
- Trigger `trg_messages_restrict_columns` (`BEFORE UPDATE`) raises if `sender_id`, `receiver_id`, or `content` change.

**Known limitation (no Supabase Auth):** policies cannot bind UPDATE to the wallet caller. The trigger is the real immutability guard. Full wallet-bound RLS needs auth.

---

## Phase 12: ECDH public keys for DMs (applied 2026-09-11)

> Migration file: `supabase/migrations/20260915_players_ecdh_pubkey.sql`

### 12.1 Column

```sql
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS ecdh_pubkey JSONB;
```

JWK of the identity's static **ECDH P-256** public key. Private key stays in browser `localStorage` (`ludo-ecdh-v1:<wallet>`).

### 12.2 Wire format (`messages.content` JSON)

| Kind | Shape | Opened with |
|------|--------|-------------|
| Sealed box (current) | `{ v: 1, epk, iv, content }` | Recipient static private + sender ephemeral `epk` → AES-GCM |
| Legacy (decrypt-only) | `{ iv, content }` | `SHA-256(sorted wallets + salt)` AES key |

Send path (`useDataActions.sendMessage`): publish own pubkey → fetch peer `ecdh_pubkey` → `encryptForPeer`. **If peer has no pubkey, send fails closed** (no plaintext fallback). Boot (`GameDataContext`) publishes the local pubkey on first load so friends can seal DMs.

### 12.3 Client helpers

`lib/encryption.ts`: `getOrCreateIdentityKey`, `exportPublicKeyJwk`, `encryptForPeer`, `decryptSealedBox`, `decryptAnyMessage` (sealed → legacy).

---

## Quick reference: security-sensitive objects

| Object | Purpose |
|--------|---------|
| `live_matches.host_address` | Bind signed bet settlement to host wallet |
| `settle_match_bets(match_id, result, bet_type)` | Atomic spectator payout; requires `window_closed_at` in the past |
| `resolve-bet` edge fn | Verifies host signature + host_address, then calls RPC |
| `roll-dice` edge fn | CSPRNG 1–6 for networked human rolls (no client fallback in app) |
| `/api/match/record` | Wallet-signed match history / progression only (no coin mint) |
| `messages_restrict_columns` trigger | Immutable sender/receiver/content on UPDATE |
| `players.ecdh_pubkey` | Static ECDH JWK for sealed-box DMs |

