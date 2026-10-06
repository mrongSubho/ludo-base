-- SEC-12 — give every lobby an explicit join door.
--
-- Two facts found while closing SEC-12, both of which explain each other:
--
--   1. `live_matches` rows are created ONLY by the AI arena. A normal hosted
--      lobby has no row at all, so `lobby/join`'s `select ... eq('room_code')`
--      returned null and the entire invite-secret check was skipped.
--   2. `join_secret_hash` is read by that check but never written by any code.
--
-- So the "an invite link requires a secret" gate has never actually run. The
-- session requirement is the real gate, which is correct but leaves the product
-- unable to express *who* may join a lobby.
--
-- Why a new table rather than a column on `live_matches`: `live_matches.match_id`
-- is NOT NULL, so a pre-match lobby row cannot live there. Making it nullable
-- would change what every `.eq('room_code', …)` and `.eq('match_id', …)` query
-- across the app returns. A separate table keyed by room_code has no such blast
-- radius, and drops away cleanly if the lobby model changes.
--
-- `join_policy` says which door a room uses; `lobby/join` enforces the match:
--
--   'matchmaking'  the guest must present the queue's `validation_token`. This is
--                  the "different door" quick match uses: strangers the queue
--                  paired, so friendship is exactly the wrong gate.
--   'invite'       the guest must be an accepted friend of the host AND present
--                  the room secret. This is the door for invite links.
--   'open'         casual open-join by room code; a session is the only gate.
--
-- No row means 'open', so existing rooms keep working and an unregistered room
-- is never silently tightened.

begin;

create table if not exists public.lobby_join_policies (
  room_code text primary key,
  host_address text not null,
  join_policy text not null default 'open',
  -- sha256 of the door credential: the queue validation_token for a
  -- 'matchmaking' room, the invite secret for an 'invite' room.
  credential_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lobby_join_policies_policy_check
    check (join_policy in ('matchmaking', 'invite', 'open'))
);

comment on table public.lobby_join_policies is
  'SEC-12: which door each lobby admits. Absent row = open join with a session, the pre-SEC-12 behaviour.';
comment on column public.lobby_join_policies.credential_hash is
  'sha256 of the door credential. Only ever written by POST /api/lobby/policy, which requires the host session.';

-- Default deny, like every other table in the baseline. The route reads and
-- writes through the service role; the anon key gets nothing.
alter table public.lobby_join_policies enable row level security;

revoke all on public.lobby_join_policies from anon, authenticated;

commit;
