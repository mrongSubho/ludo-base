-- Migration: 20240319_matchmaking_cleanup.sql
-- Description: Implement a cleanup procedure to remove expired or old matchmaking records.

-- 1. Create the cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_matchmaking_queue()
RETURNS void AS $$
BEGIN
    -- Delete records older than 1 hour that are not 'searching'
    -- This handles 'matched' and 'cancelled' tickets that are no longer needed
    DELETE FROM public.matchmaking_queue
    WHERE (status != 'searching' AND created_at < NOW() - INTERVAL '1 hour')
       OR (status = 'searching' AND expires_at < NOW() - INTERVAL '1 hour');
       
    RAISE NOTICE 'Cleaned up old matchmaking records.';
END;
$$ LANGUAGE plpgsql;

-- 2. (Optional) If you have pg_cron enabled, you can schedule it:
-- SELECT cron.schedule('0 * * * *', $$SELECT public.cleanup_matchmaking_queue()$$);

-- Note: On Supabase Nano tier, pg_cron is usually available but needs to be enabled.
-- If not using pg_cron, this can be triggered via a Supabase Edge Function or manually.
