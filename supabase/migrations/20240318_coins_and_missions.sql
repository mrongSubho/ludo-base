-- Coins and Mission System
-- Migration: 20240318_coins_and_missions.sql

-- 1. Add coins to players table if not already present
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS coins BIGINT DEFAULT 1000;

-- 2. Create mission tracking table
CREATE TABLE IF NOT EXISTS public.player_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    mission_id TEXT NOT NULL,
    progress INT DEFAULT 0,
    is_claimed BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(player_id, mission_id)
);

-- 3. Create Poke system table
CREATE TABLE IF NOT EXISTS public.pokes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    receiver_id TEXT NOT NULL REFERENCES public.players(wallet_address) ON DELETE CASCADE,
    status TEXT DEFAULT 'sent', -- 'sent', 'poked_back'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    poked_back_at TIMESTAMP WITH TIME ZONE,
    CHECK (sender_id != receiver_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_player_missions_player ON public.player_missions(player_id);
CREATE INDEX IF NOT EXISTS idx_pokes_receiver ON public.pokes(receiver_id) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_pokes_sender_receiver ON public.pokes(sender_id, receiver_id);

-- Enable Realtime for missions and pokes
ALTER PUBLICATION supabase_realtime ADD TABLE public.player_missions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pokes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
