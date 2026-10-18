BEGIN;

-- P5: Private Realtime Authorization (NET-03a/b)
CREATE SCHEMA IF NOT EXISTS realtime;

CREATE TABLE IF NOT EXISTS realtime.messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic text NOT NULL,
    extension text NOT NULL,
    inserted_at timestamptz DEFAULT now()
);

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "realtime_messages_select" ON realtime.messages;
CREATE POLICY "realtime_messages_select"
ON realtime.messages
FOR SELECT
USING (
    auth.role() = 'service_role'
    OR (auth.role() = 'authenticated' AND (topic LIKE 'match:%' OR topic LIKE 'game-room-%'))
    OR topic LIKE 'match:%'
);

DROP POLICY IF EXISTS "realtime_messages_insert" ON realtime.messages;
CREATE POLICY "realtime_messages_insert"
ON realtime.messages
FOR INSERT
WITH CHECK (
    auth.role() = 'service_role'
    OR (auth.role() = 'authenticated' AND (topic LIKE 'match:%' OR topic LIKE 'game-room-%'))
);

COMMIT;
