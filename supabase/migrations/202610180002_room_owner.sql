-- Migration 202610180002_room_owner.sql
-- Phase 2 / SEC-P2: Server-assigned room_owner on matches table

begin;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS room_owner text;
COMMENT ON COLUMN matches.room_owner IS 'Authoritative session wallet assigned as room owner at creation';

CREATE INDEX IF NOT EXISTS matches_room_owner_idx ON matches(room_owner) WHERE room_owner IS NOT NULL;

commit;
