-- ============================================================================
-- Migration: 202610180001_session_v2.sql
-- Description: Session v2 (auth_challenges, sessions) + Retention RPCs
-- Scope: Server Authority Migration Phase 1 (P1)
-- ============================================================================

BEGIN;

-- 1. auth_challenges — server-issued single-use challenges (kills P4 replay)
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nonce TEXT NOT NULL,
    wallet_address TEXT,
    ip TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_challenges_nonce_idx ON auth_challenges(nonce);
CREATE INDEX IF NOT EXISTS auth_challenges_expires_at_idx ON auth_challenges(expires_at);

ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;
-- Default deny: no policies for anon/authenticated. service_role only.

-- 2. sessions — unified session store with scope model (app, match, spectator)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL REFERENCES players(wallet_address) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('app', 'match', 'spectator')),
    match_id TEXT,
    device_id TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    idle_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    rotated_from UUID REFERENCES sessions(id) ON DELETE SET NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_wallet_scope_idx ON sessions(wallet_address, scope);

-- One active app session per wallet at any given time
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_app_per_wallet 
    ON sessions(wallet_address) 
    WHERE scope = 'app' AND revoked_at IS NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- Default deny: no policies for anon/authenticated. service_role only.

-- 3. Retention RPCs — invoked by Cron worker
CREATE OR REPLACE FUNCTION cleanup_auth_challenges(p_keep_hours integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM auth_challenges
     WHERE (consumed_at IS NOT NULL OR expires_at < now())
       AND created_at < now() - (p_keep_hours || ' hours')::interval;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_sessions(p_keep_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM sessions
     WHERE (revoked_at IS NOT NULL OR expires_at < now() OR idle_expires_at < now())
       AND last_seen_at < now() - (p_keep_days || ' days')::interval;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION cleanup_auth_challenges(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_auth_challenges(integer) TO service_role;

REVOKE ALL ON FUNCTION cleanup_sessions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_sessions(integer) TO service_role;

COMMIT;
