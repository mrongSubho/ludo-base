-- ==========================================================
-- STATUS TIMEOUT CLEANUP (IDLE -> OFFLINE)
-- Run this to fix "Forever Online" ghosting
-- ==========================================================

CREATE OR REPLACE FUNCTION update_offline_status()
RETURNS VOID AS $$
BEGIN
    UPDATE players
    SET status = 'Offline'
    WHERE status != 'Offline'
      AND last_seen_at < NOW() - INTERVAL '1 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: In a production Supabase environment, you would 
-- schedule this via pg_cron:
-- SELECT cron.schedule('status-cleanup', '* * * * *', 'SELECT update_offline_status()');
