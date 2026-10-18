-- Migration 202610180003_room_version.sql
-- Phase 3 / SEC-P3: match_states.room_version for Match Room transport detection

begin;

ALTER TABLE match_states ADD COLUMN IF NOT EXISTS room_version smallint NOT NULL DEFAULT 1;
COMMENT ON COLUMN match_states.room_version IS 'Protocol version of the match room authority managing this state';

commit;
