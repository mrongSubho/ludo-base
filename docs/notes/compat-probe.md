# Phase 4 compat-probe — operator notes

> Probe: `scripts/compat-probe.ts` (run via tsx, like the engine tests).
> CI: `.github/workflows/compat-probe.yml` (job `ci-compat-probe`).
> Baseline under test: `supabase/migrations/00000000000000_baseline.sql` (read-only — the probe never edits it).

## What it proves

Turns the RLS review from opinion into a test result:

- **Anon vs service matrix** — 12 default-deny tables invisible to anon
  (`app_sessions`, `game_invites`, `friendships`, `messages`, `pokes`,
  `player_missions`, `spectator_bets`, `coin_ledger`, `match_sessions`,
  `match_states`, `match_moves`, `lobby_join_requests`) vs public reads
  (`matches`; `players` column-grant only; `matchmaking_queue`
  granted-cols-only + `searching`/`matched` filter; `live_matches`,
  `live_chat`, `tournaments` non-draft). Anon INSERT allowed only for
  `feedback` (F-01 gated); anon UPDATE/DELETE denied everywhere.
- **RPC revocation** — `join_matchmaking`, `join_matchmaking_hybrid`,
  `cash_out_bet`, `settle_match_bets`, `join_tournament`,
  `mark_conversation_read`, `cleanup_*` denied for anon, succeed for
  service (pairing, idempotency, counter recompute exercised).
- **HTTP matrix** — gated routes 2xx-with-shape on valid session, 401
  `{ error }` on bad session, loud 500 with service-key text when the
  service key is missing (never silent empty). Anon-safe routes
  (`live-chat` GET, `geo`, `farcaster`, `matchmaking/status` narrow poll)
  keep working.
- **Realtime leaks** — anon channels on `messages`/`conversations`/
  `game_invites`/`matchmaking_queue`/`live_chat`/`live_matches` never
  observe private fields (`validation_token`, non-granted columns,
  `join_secret_hash`, …).
- **No-silent-degrade tripwires** — failure bodies always carry `error`
  strings; repo-wide grep fails on `|| NEXT_PUBLIC_SUPABASE_ANON_KEY`
  fallbacks reintroduced in `app/api` **write** paths (POST/PUT/PATCH/DELETE).

## Two modes

```bash
# Offline self-test — no DB, no network. Verifies the probe's own logic.
npx tsx scripts/compat-probe.ts --offline

# Full scratch-project mode — needs env (below).
npx tsx scripts/compat-probe.ts --full

# Auto (default): offline always + full only when env present, else skip-with-notice.
npx tsx scripts/compat-probe.ts
```

## F-01 — feedback anonymity contract (one-line flip)

Open input: parallel review deciding session-gated POST vs service-backed
ANON insert per baseline policy.

- Single constant in `scripts/compat-probe.ts`: **`EXPECT_FEEDBACK_ANON`
  (default `true` per baseline policy).**
- `true` → probe expects anon INSERT into `feedback` ALLOWED; HTTP matrix
  accepts 2xx/4xx `{ error }`-shaped feedback responses without a session.
- `false` → probe expects anon INSERT DENIED and HTTP `POST /api/feedback`
  without a valid session to be `401 { error }`.
- Both branches are coded and both are exercised by `--offline`
  (`f01/true-means-anon-allowed`, `f01/false-means-anon-denied`).
- **On decision: flip that one line, re-run `--offline`, done.**

## Manual steps remaining (no live project exists in this repo)

1. **Create a scratch project** — Supabase dashboard → New project
   (e.g. `ludo-compat-scratch`). Never use production.
2. **Apply the baseline** — open the scratch project's SQL editor, paste
   the full contents of `supabase/migrations/00000000000000_baseline.sql`,
   run. (The probe verifies table presence via the service key; it does not
   execute raw SQL itself. Teardown is project delete — documented,
   deliberately not automated.)
3. **Wire secrets** (repo → Settings → Secrets and variables → Actions):
   - `SUPABASE_URL` — scratch project URL
   - `SUPABASE_ANON_KEY` — scratch anon key
   - `SUPABASE_SERVICE_ROLE_KEY` — scratch service_role key
   - `PREVIEW_URL` (optional) — preview deploy URL for the HTTP matrix
4. **First scratch run** (local):
   ```bash
   SUPABASE_URL=https://<scratch>.supabase.co \
   SUPABASE_ANON_KEY=<anon> \
   SUPABASE_SERVICE_ROLE_KEY=<service> \
   PREVIEW_URL=https://<preview>.vercel.app \
   npx tsx scripts/compat-probe.ts --full
   ```
   Expect: `full/connect:*` pass, seed ok, RLS/RPC/HTTP/realtime matrices green.
   Without `PREVIEW_URL` the HTTP matrix skips with notice (`--skip-http`).
5. **Manual dispatch** — Actions → `compat-probe` → Run workflow (nightly
   `0 3 * * *` runs automatically once secrets exist).
6. **Missing-service-key 500 check** (manual, once): deploy a throwaway
   preview *without* `SUPABASE_SERVICE_ROLE_KEY`, hit any gated POST with a
   bad session, confirm `500 { "error": "Supabase service role is not configured" }`
   (never silent empty). The probe statically asserts the loud-500 text is
   present in write paths; this live step confirms the deploy wiring.

## Enabling as blocking (only after green-once)

`compat-probe.yml` has **no** `push`/`pull_request` triggers on purpose.
After the first green full run on a scratch project:

```yaml
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:
```

Then add the job (or its status check) to branch protection. Do not enable
before green-once — the full matrix has never run against a live project
from this checkout.

## Fixtures (deterministic, teardown = project delete)

3 players (`0x111…`, `0x222…`, `0x333…` host/guest/outsider) + `app_sessions`
(valid/expired/revoked) + `matches`/`live_matches` (`CMP001`) + pending
`game_invites` with validation material + searching matchmaking ticket +
friendships (accepted + pending) + message (conversations via trigger) +
open + settled spectator bets + partial mission + `live_chat` global + room
rows + feedback sample + `lobby_join_requests` row + coin balances with
ledger entries (unique idempotency keys). Nonces/addresses fixed in
`buildFixtures()`; seeding is upsert-based and re-runnable.

## Known limitations

- **Never run against a live project here** — full mode was designed and
  typechecked but not executed (no secrets, no network project). First
  scratch run may surface baseline-drift (e.g. newer migrations in
  `supabase/migrations/` beyond the baseline) — treat failures as signal.
- **RLS-deny reads as empty, not error** — the SELECT matrix asserts anon
  sees 0 seeded private rows while service sees them; column-grant
  violations assert on Postgres 42501 errors.
- **Realtime is best-effort** — if the scratch project has realtime
  disabled, channels report `SKIP-NOTICE` instead of failing; enable the six
  tables in the realtime publication (baseline does) for full coverage.
- **`matchmaking/status` fallback** — the one remaining
  `|| NEXT_PUBLIC_SUPABASE_ANON_KEY` in `app/api/matchmaking/status/route.ts`
  is GET-only (narrow `status, match_id` poll) and classified as warning,
  not offense. Any fallback in a POST/PUT/PATCH/DELETE route fails the run.
- **Cash-out idempotency needs an open bet** — if the fixture bet was
  already consumed, the check reports skip-with-notice rather than red.

## Phase 2 extended routes (probe coverage)

Phase 2 added four new API routes (+ `status` extended modes) that the
pre-Phase-2 probe did not cover. TeamUp global list, matchmaking
polling/host-resolution, spectator bootstrap, and block checks now flow
through these — so the probe asserts their contracts offline (mock-mode,
zero DB/network) and live in full mode (scratch project + preview deploy).

| Route | Access | Contract asserted |
| --- | --- | --- |
| `GET /api/matchmaking/pools?gameMode=…&matchType=…[&walletAddress=…]` | Public, no session, service-backed | `{ pools: { "<wager>": count } }` aggregate only; **never** `player_id`/`player_ids`/`validation_token`. Caller: `hooks/useMatchmaking.ts:fetchNearbyPools` (TeamUp nearby-pool presets). |
| `GET /api/matchmaking/status?ticketId=…&walletAddress=…&sessionId=…` | Session-gated, owner-checked | `validation_token` ONLY for the session owner; non-owner session gets `searching`-without-token (empty) and no-session gets `401 { error }`. No token leaks to non-owners anywhere. Caller: `checkTicketStatus` ticket poll. |
| `GET /api/matchmaking/status?matchId=…&walletAddress=…&sessionId=…` | Session-gated, participant-checked | `{ status: matched, match_id, players[] }` ONLY for participants (deterministic host resolution in `resolveIsHost`); outsider gets `403 { error }`, no-session gets `401`. Never carries `validation_token`. |
| `GET /api/presence/online?page=0&limit=25[&walletAddress=0x…]` | Public, no session, service-backed | Only fresh-heartbeat rows (last 2 min, `last_seen_at` never exposed) with grant-safe cols `wallet_address, username, avatar_url, status` — **never** `last_seen_at`/`peer_id`/`coins`/`ecdh_pubkey`. Paging (`page`/`limit`, `hasMore`) works; `walletAddress` excludes self. Caller: `TeamUpMatchPanel.tsx:fetchOnlinePage` global strangers list. |
| `GET /api/match/state?matchId=…` | Public, no session, service-backed | `{ seq, state, color_corner }` snapshot or `404 { error, code: MATCH_NOT_FOUND }`; **never** economy/session cols (`host_address`, `room_code`, `player_seats`, `join_secret_hash`, `arena_key`, `authority_id`, …). Caller: `hooks/useSpectatorSync.ts` spectator bootstrap. |
| `GET /api/social/moderation?walletAddress=…&sessionId=…&target=0x…` | Session-gated, own-perspective | Exactly `{ blocked: boolean }` for the caller's own `blocker_address = session wallet`; `401 { error }` without session; a user cannot read another user's block list. Caller: `PublicProfileModal.tsx` + `TeamUpContext.tsx` block checks. |

### Offline self-test (`--offline`, always green, zero DB/network)

Pure validators in `scripts/compat-probe.ts` (shared with full mode so both
share one truth): `isPoolsResponseValid` / `poolsResponseLeaksPlayers`,
`isStatusTicketShapeValid` / `statusTicketLeaksToken`,
`isRosterResponseValid` / `rosterLeaksToken`,
`isPresenceRowGrantSafe` / `isPresenceResponseValid` /
`presenceResponseLeaksPrivate` / `filterPresenceSelf` / `paginatePresence` /
`isPresenceFresh`, `isMatchStateSnapshotValid` / `matchStateLeaksPrivate` /
`isMatchNotFoundBody`, `isModerationBodyValid` / `moderationLeaksList` /
`isModerationOwnPerspective`, plus generic `containsBannedKey`.

Mock-mode cases (all in `runOfflineSelfTest`, categories `phase2-*`):

- `phase2/matrix-*` — public/gated route lists, private-field lists, F-01 intact.
- `phase2/pools-*` (6) — valid aggregate, empty ok, `player_ids`/`player_id`/`validation_token` leaks rejected, bad shapes rejected.
- `phase2/status-*` (7) — owner matched shape, non-owner searching no-leak (403/empty pass), non-owner token leak detector, 401 without session, roster valid, roster token leak, outsider 403.
- `phase2/presence-*` (7) — grant-safe row, each denied col rejected, response valid, nested leak caught, self-exclusion, paging, freshness window.
- `phase2/match-state-*` (4) — snapshot valid, host/seats leaks rejected, 404 envelope, bad shapes rejected.
- `phase2/moderation-*` (4) — `{ blocked }` true/false, 401 without session, list-read rejected (only own perspective), own-perspective equality.

F-01 `EXPECT_FEEDBACK_ANON` parameterization is untouched
(`phase2/f01-intact` re-asserts both branches + default `true`).

Run: `npx tsx scripts/compat-probe.ts --offline` → currently **95/95**
(60 legacy + 35 Phase 2).

### Full mode (`--full`, scratch project + preview deploy)

`runPhase2FullChecks` (category `phase2-full`) runs after the legacy matrices:

- **RLS (always):** `user_blocks` anon SELECT sees 0 rows while service sees the seeded `host → guest` block (same deny-reads-as-empty convention).
- **Seed (best-effort, idempotent):** Phase 2 sessions (`host` + `outsider` valid), `CMP002` match + two `matched` tickets sharing `match_id` (owner token `phase2-owner-token-001`), `match_states` snapshot (`seq: 7`), `host → guest` block (outsider→guest cleared), presence heartbeats forced `Online`+fresh.
- **HTTP (only with `PREVIEW_URL`, else skip-with-notice):** pools aggregate + self-exclusion + 400 on missing params; status ticket 401 / owner-token / non-owner-no-token (accepts `403 { error }` OR `200 searching`-without-token); roster participant `players[]` (no token) / outsider `403` / 401; presence grant-safe + self-exclusion + paging (`limit=1` pages); match/state snapshot (no leaks) + unknown-id `404 MATCH_NOT_FOUND`; moderation 401 / own-`true` / other-`false` (outsider cannot read host list).

Status note: the legacy `ANON_SAFE_ROUTES` narrow-poll entry is the pre-Phase-2
GET-only poll. Phase 2 extended modes are session-gated — the probe documents
both (`PHASE2_GATED_ROUTES` expectations) and the live route enforces
`401`/`403`/owner-only token.

### Phase 2 fixtures (additive to section Fixtures)

`CMP002` match + `matched` host/guest tickets (shared `match_id`, distinct
`validation_token`s) + Phase 2 owner/outsider `app_sessions` + `match_states`
`seq 7` snapshot + `host → guest` block + forced fresh `Online` heartbeats.
Teardown remains project delete.

## Cutover additions (2026-09-18 — static-vs-live, N1, F-01 verify)

> Append-only: everything above is untouched. New categories are additive;
> the 95 pre-cutover offline checks stay green (now **122/122**).

### Static-vs-live distinction for migration assertions

The three NEW compat files are **SQL files, not a live DB** — the probe
covers them with **STATIC assertions (file-text parse, offline, no DB)**:

- `supabase/migrations/202609180001_pokes_status_compat.sql` — CHECK union
  `('sent','poked_back','pending','accepted','dismissed')` + default
  `'sent'` + both indexes (`pokes_receiver_status_idx`,
  `pokes_sender_created_idx`).
- `supabase/migrations/202609180002_matches_finished_at.sql` — nullable
  `finished_at timestamptz` (`add column if not exists`) + backfill
  `where finished_at is null and winner_address is not null`
  (`set finished_at = created_at`) + `matches_finished_at_idx`.
- `supabase/migrations/202609180003_live_chat_room_nullable.sql` —
  `room_code` nullable-guard (`is_nullable = 'NO'` + `drop not null`,
  idempotent on archive-migrated DBs) + `live_chat_room_idx`.

Category `compat-migrations-static` (11 file checks + 3 validator-agreement
pins): `checkCompatMigrationFiles()` reads each file and asserts the
statements/identifiers above; pure helpers (`pokesCompatHasStatusUnion`,
`matchesCompatHasBackfillWhere`, `liveChatCompatHasNullableGuard`, …) are
unit-pinned against inline samples (accept full, reject partial/unguarded).
These prove the migration **TEXT** ships the right DDL. **Live**
enforcement (CHECK rejects bad status, nullable insert works, index exists)
is proven by the full-mode RLS/RPC matrices on a scratch project — not here.

### N1 — caller-bound ticket mint on direct match (`app/api/matchmaking/join/route.ts`)

`withCallerToken` mints only when null, owner = session wallet. Probe
coverage (offline + full share one truth via pure validators):

- **Static (offline, category `n1-mint-static`, `checkJoinRouteStatic`):**
  `session-owner-binding` (`requireAppSession(playerId, sessionId)` →
  `playerId = wallet`), `caller-bound-lookup`
  (`.eq('player_id', playerId)` + `.eq('match_id', data.match_id)`),
  `guarded-single-mint` (exactly 1 `.update({ validation_token:` site +
  `if (data.validation_token) return` + `if (ticket.validation_token) return`
  + `.eq('id', ticket.id)` + `.is('validation_token', null)` — no rotation),
  `unauth-no-token` (401 branch carries no token; both mint invocations sit
  after the `playerId = wallet` gate).
- **Mock-mode (offline, category `n1-mint`):** `isDirectMatchTokenResponse`
  (matched MUST carry non-empty `validation_token`; searching needs none;
  unknown status fails) + `isDirectMatchMintIdempotent` (two identical
  matched bodies MUST agree — rotated/missing second token fails) + helper
  agreement pins.
- **Full-mode HTTP (category `n1-full`, in `runHttpMatrix`, preview deploy
  only):** `http-unauth-no-token` (bad-session 401 carries no token),
  `http-direct-match-token-present` (matched direct-match carries owner
  token), `http-direct-match-idempotent-mint` (second identical POST returns
  the SAME token). Still-searching responses are skip-with-notice passes
  (token required only when matched); single-matched-side is a partial skip
  for the rotation check (needs both matched).

### F-01 verify-intact (cutover)

`EXPECT_FEEDBACK_ANON` untouched (`true`); `checkFeedbackRouteStatic`
asserts `app/api/feedback/route.ts` stays anonymous-by-contract
(`anonymous by contract` + `serviceDb()` + best-effort attribution that
`Never rejects`, no `Invalid session` gate). Offline: `cutover/f01-route-anon-intact`
+ `cutover/f01-flag-still-true` alongside the existing `phase2/f01-intact`.

Run: `npx tsx scripts/compat-probe.ts --offline` → **122/122**
(95 legacy + 14 compat-migrations-static + 5 n1-mint-static + 6 n1-mint + 2 cutover F-01).
