-- DB-17, DB-18, DB-23, DB-27.
--
-- A note on scope. Several items in this batch turned out to be **moot**, and
-- the honest thing is to say so rather than make a change that looks like work:
--
--   DB-07  `messages_restrict_columns` compares with `<>`, which is NULL-unsafe.
--          Checked: `sender_id`, `receiver_id` and `content` are all NOT NULL
--          (only `ciphertext` is nullable, and that column already uses
--          `IS DISTINCT FROM`). NULL can never reach the comparison, so there is
--          no hole. Left alone — swapping to `IS DISTINCT FROM` would be a
--          cosmetic change that made the file look reviewed without changing
--          behaviour.
--
--   DB-04/05/06/25  `settle_match_bets`, `cleanup_stale_data`,
--          `mark_conversation_read` and friends already exist and already carry
--          the guards. `update_offline_status` does not exist anywhere in the
--          codebase, so it is not a thing to harden.
--
-- What is below is the residue that was real.

begin;

-- ── DB-27 ──────────────────────────────────────────────────────────────────
-- `game_invites` is a member of the `supabase_realtime` publication but has
-- **zero RLS policies**. RLS with no policy denies, so any client subscription
-- delivers nothing: a dead channel that looks configured. And it is the wrong
-- table to leave on a publication at all — it carries `validation_token`, the
-- invite secret that SEC-12 moved to a server-minted value.
--
-- Nothing subscribes to it either (only `scripts/compat-probe.ts` names it, and
-- that is a probe, not a client). So remove it rather than invent policies for
-- a feature that does not read it.
--
-- `conversations`, `live_chat`, `live_matches`, `messages` and
-- `matchmaking_queue` are all genuinely used and all carry policies — left in
-- place. Note `matchmaking_queue` holds `validation_token` and is protected by
-- policy + the DB-09 grant revocation, not by absence from the publication;
-- its realtime use is the queue-watch path, which is why it stays.
alter publication supabase_realtime drop table public.game_invites;

-- ── DB-23 ──────────────────────────────────────────────────────────────────
-- One live SIWE app session per wallet.
--
-- `/api/siwe/verify` revokes the old row (`.update({revoked_at}).is('revoked_at', null)`)
-- and *then* inserts, so this index cannot deadlock against the normal login
-- path. What it closes is the ordering that isn't: two concurrent verifies for
-- the same wallet both read "no live session" and both insert, leaving a wallet
-- with two valid app sessions. `app_sessions_active_idx` is a plain btree on
-- `(wallet_address, expires_at)` and does not prevent that.
create unique index app_sessions_one_live_per_wallet
  on public.app_sessions (wallet_address)
  where revoked_at is null;

-- ── DB-17, DB-18 ───────────────────────────────────────────────────────────
-- `status` on `pokes`, `tournaments` and `tournament_matches` are free text with
-- no constraint, so `'poked_back'`, `'SENT'`, `' '` and `''` are all storable
-- and a UI that switches on status silently falls through.
--
-- Deliberately NOT done: pinning the full enum. All three tables are empty in
-- production and the code paths that would write them are not exercised, so the
-- real domain is not knowable from here — and a CHECK built from a guess is a
-- CHECK that breaks the first real write. What is enforced is the part that is
-- unambiguously true of any status column: it is present and it is not padding.
-- Filling in the domain is a job for whoever owns those features.
alter table public.pokes
  add constraint pokes_status_present
  check (status is not null and length(btrim(status)) between 1 and 32);

alter table public.tournaments
  add constraint tournaments_status_present
  check (status is not null and length(btrim(status)) between 1 and 32);

alter table public.tournament_matches
  add constraint tournament_matches_status_present
  check (status is not null and length(btrim(status)) between 1 and 32);

commit;
