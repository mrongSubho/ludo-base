-- Server-authoritative match state (v2 move validation)
CREATE TABLE IF NOT EXISTS public.match_states (
    match_id TEXT PRIMARY KEY,
    room_code TEXT,
    host_address TEXT,
    seq INT NOT NULL DEFAULT 0,
    state JSONB NOT NULL,
    color_corner JSONB NOT NULL,
    player_seats JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.match_states ENABLE ROW LEVEL SECURITY;

-- Read-only for clients (resync / spectator); writes are service-role only.
DROP POLICY IF EXISTS "match_states open read" ON public.match_states;
CREATE POLICY "match_states open read"
    ON public.match_states FOR SELECT USING (true);

-- Append-only move audit
CREATE TABLE IF NOT EXISTS public.match_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    seq INT NOT NULL,
    actor TEXT NOT NULL,
    color TEXT NOT NULL,
    token_index INT NOT NULL,
    dice INT NOT NULL,
    roll_id TEXT,
    from_pos INT,
    to_pos INT,
    captured BOOLEAN DEFAULT FALSE,
    bonus_roll BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS match_moves_match_seq_uidx
    ON public.match_moves (match_id, seq);

ALTER TABLE public.match_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_moves open read" ON public.match_moves;
CREATE POLICY "match_moves open read"
    ON public.match_moves FOR SELECT USING (true);

-- Bind each roll to at most one move
ALTER TABLE public.match_rolls
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS consumed_seq INT NULL;
