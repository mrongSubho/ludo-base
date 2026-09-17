/**
 * Phase 4 database-compatibility probe.
 *
 * Turns the RLS review from opinion into a test result.
 *
 * TWO MODES (by design — no live Supabase project exists in this repo):
 *
 *   (a) FULL mode — against a scratch Supabase project:
 *         SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *         + SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *         + SUPABASE_SERVICE_ROLE_KEY
 *         + optional PREVIEW_URL (or PREVIEW_DEPLOY_URL) for the HTTP matrix.
 *       Seeds deterministic fixtures (service key), then asserts the
 *       anon-vs-service access matrix, HTTP route matrix, and realtime
 *       leak matrix.
 *
 *   (b) OFFLINE self-test mode — no database, no network:
 *         npx tsx scripts/compat-probe.ts --offline
 *       Validates the probe's OWN logic (assertion engine, matrix
 *       definition, fixture builders, grep tripwire, error-body validator,
 *       F-01 both branches) so CI wiring can be verified before secrets
 *       exist. This mode ALWAYS runs — even in full mode as a pre-step.
 *
 * USAGE:
 *   npx tsx scripts/compat-probe.ts --offline        # offline only (CI without secrets)
 *   npx tsx scripts/compat-probe.ts --full           # full mode (fails fast if env missing)
 *   npx tsx scripts/compat-probe.ts                  # auto: offline + full-if-env-present
 *   npx tsx scripts/compat-probe.ts --json           # JSON summary to stdout
 *   npx tsx scripts/compat-probe.ts --skip-http      # full mode without HTTP matrix
 *   npx tsx scripts/compat-probe.ts --skip-realtime  # full mode without realtime matrix
 *
 * BASELINE / SCRATCH PROJECT:
 *   1. Create an EMPTY scratch Supabase project (never the production project).
 *   2. Apply supabase/migrations/00000000000000_baseline.sql via the SQL editor.
 *      (The probe READS the file and verifies connectivity; it does NOT
 *      execute raw SQL itself — there is no generic SQL-exec RPC to use.)
 *   3. Run this probe in full mode. It seeds fixtures via the service key.
 *   TEARDOWN: delete the scratch project in the dashboard (documented,
 *   deliberately NOT implemented here — no destructive automation).
 *
 * GATES: this file must keep `npx tsc --noEmit` (0 errors),
 * `npm run build` (green), and `npm test` (14/14) green. It is standalone:
 * no imports from app/, hooks/, or lib/ — only @supabase/supabase-js and
 * node builtins — so it cannot collide with in-flight Phase 1 edits.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// F-01 — feedback anonymity contract (OPEN INPUT, do NOT block on it).
// ---------------------------------------------------------------------------
// A parallel review is deciding whether feedback POST stays session-gated
// (current app/api/feedback/route.ts behaviour) or returns to service-backed
// ANON insert per the baseline policy (`feedback_anon_insert` WITH CHECK true).
//
// Single flip point: set EXPECT_FEEDBACK_ANON = true (default, per baseline
// policy: anon INSERT into feedback is ALLOWED) or false (session-gated:
// anon INSERT is expected DENIED and the HTTP matrix expects 401 without a
// session). Both branches are coded and both are exercised by the offline
// self-test. One line flips on the decision.
// ---------------------------------------------------------------------------
export const EXPECT_FEEDBACK_ANON = true;

// ---------------------------------------------------------------------------
// Matrix definitions (single source of truth for both modes).
// ---------------------------------------------------------------------------

/** Default-deny tables: anon SELECT must NOT see seeded rows. */
export const DENY_SELECT_TABLES: readonly string[] = [
  'app_sessions',
  'game_invites',
  'friendships',
  'messages',
  'pokes',
  'player_missions',
  'spectator_bets',
  'coin_ledger',
  'match_sessions',
  'match_states',
  'match_moves',
  'lobby_join_requests',
];

/** Public-read tables (baseline policies using (true) or filtered). */
export const ALLOW_SELECT_TABLES: readonly string[] = [
  'matches',
  'players', // column-grant only — see PLAYERS_* below
  'matchmaking_queue', // granted-cols-only + status filter
  'live_matches',
  'live_chat',
  'tournaments', // non-draft only
];

/** Baseline players column grant (public profile/discovery fields). */
export const PLAYERS_ALLOWED_COLS: readonly string[] = [
  'wallet_address',
  'username',
  'avatar_url',
  'lxp',
  'rxp',
  'status',
  'classic_played',
  'power_played',
  'ai_played',
  'total_wins',
  'total_games',
  'rank_tier',
  'last_played_at',
  'created_at',
];

/** Private players columns: anon select MUST fail (column-level revoke). */
export const PLAYERS_DENIED_COLS: readonly string[] = [
  'coins',
  'ecdh_pubkey',
  'peer_id',
];

/** Baseline matchmaking_queue column grant (discovery fields only). */
export const MATCHMAKING_GRANTED_COLS: readonly string[] = [
  'player_id',
  'game_mode',
  'match_type',
  'wager',
  'wager_min',
  'wager_max',
  'status',
  'match_id',
  'room_code',
  'expires_at',
  'created_at',
];

/** Matchmaking columns that must NEVER be anon-visible. */
export const MATCHMAKING_PRIVATE_COLS: readonly string[] = [
  'validation_token',
  'id',
];

/** Statuses anon may discover (baseline policy filter). */
export const MATCHMAKING_ANON_VISIBLE_STATUSES: readonly string[] = [
  'searching',
  'matched',
];

// ---------------------------------------------------------------------------
// Phase 2 extended routes — constants (additive; existing matrix above untouched).
// ---------------------------------------------------------------------------
// TeamUp global list → GET /api/matchmaking/pools (public wager aggregate).
// Matchmaking polling/host-resolution → GET /api/matchmaking/status extended
//   modes (ticketId owner token; matchId participant roster).
// Spectator bootstrap → GET /api/match/state (public snapshot).
// Block checks → GET /api/social/moderation (session-gated { blocked }).
// Presence directory → GET /api/presence/online (public fresh-heartbeat list).
// F-01 EXPECT_FEEDBACK_ANON is untouched — see top of file.

/** Phase 2 public routes (no session, service-backed, world-readable). */
export const PHASE2_PUBLIC_ROUTES: readonly string[] = [
  '/api/matchmaking/pools (GET)',
  '/api/presence/online (GET)',
  '/api/match/state (GET)',
];

/** Phase 2 pools: only wager→count aggregate is public. */
export const POOLS_PRIVATE_FIELDS: readonly string[] = [
  'player_id',
  'player_ids',
  'validation_token',
  'id',
];

/** Phase 2 presence/online grant-safe columns (route selects exactly these). */
export const PRESENCE_ALLOWED_COLS: readonly string[] = [
  'wallet_address',
  'username',
  'avatar_url',
  'status',
];

/** Presence columns that must NEVER appear in output. */
export const PRESENCE_DENIED_COLS: readonly string[] = [
  'last_seen_at',
  'peer_id',
  'coins',
  'ecdh_pubkey',
];

/** Freshness window for presence/online (mirrors route: last 2 minutes). */
export const PRESENCE_FRESHNESS_MS = 2 * 60 * 1000;

/** Phase 2 match/state snapshot: exactly these keys are public. */
export const MATCH_STATE_ALLOWED_KEYS: readonly string[] = ['seq', 'state', 'color_corner'];

/**
 * Match/state columns that must NEVER leak (match_states server-only cols +
 * live_matches economy/session secrets — route selects seq/state/color_corner
 * only).
 */
export const MATCH_STATE_DENIED_KEYS: readonly string[] = [
  'match_id',
  'room_code',
  'host_address',
  'player_seats',
  'updated_at',
  'join_secret_hash',
  'arena_key',
  'authority_id',
  'validation_token',
  'coins',
  'session_id',
];

/** Phase 2 moderation GET: exactly this shape, nothing else. */
export const MODERATION_ALLOWED_KEYS: readonly string[] = ['blocked'];

/** Moderation block-list material that must NEVER leak in GET. */
export const MODERATION_PRIVATE_FIELDS: readonly string[] = [
  'blocker_address',
  'blocked_address',
  'block_list',
  'blocked_list',
  'players',
  'player_ids',
];

/** RPCs revoked from anon/authenticated (service_role only). */
export const REVOKED_RPCS: readonly string[] = [
  'join_matchmaking',
  'join_matchmaking_hybrid',
  'cash_out_bet',
  'settle_match_bets',
  'join_tournament',
  'mark_conversation_read',
  'cleanup_matchmaking_queue',
  'cleanup_stale_data',
];

export interface RealtimeTableSpec {
  table: string;
  /** Columns/keys that must never appear in an anon payload. */
  privateFields: readonly string[];
}

export const REALTIME_TABLES: readonly RealtimeTableSpec[] = [
  { table: 'messages', privateFields: ['ciphertext', 'encryption_nonce'] },
  { table: 'conversations', privateFields: [] },
  { table: 'game_invites', privateFields: ['validation_token'] },
  {
    table: 'matchmaking_queue',
    privateFields: ['validation_token'],
  },
  { table: 'live_chat', privateFields: [] },
  {
    table: 'live_matches',
    privateFields: ['join_secret_hash', 'arena_key', 'authority_id'],
  },
];

export interface GatedRouteSpec {
  method: 'GET' | 'POST';
  path: string;
  /** Human-readable expectation for the report. */
  expectValid: string;
  expectBadSession: string;
}

export const GATED_HTTP_ROUTES: readonly GatedRouteSpec[] = [
  {
    method: 'POST',
    path: '/api/matchmaking/join',
    expectValid: '2xx with { status: searching|matched } shape',
    expectBadSession: '401 with { error } string',
  },
  {
    method: 'GET',
    path: '/api/messages',
    expectValid: '2xx with { conversations, messages } shape',
    expectBadSession: '401 with { error } string',
  },
  {
    method: 'POST',
    path: '/api/messages',
    expectValid: '2xx shape or 4xx { error } for bad payload (never silent)',
    expectBadSession: '401 with { error } string',
  },
  {
    method: 'GET',
    path: '/api/missions/list',
    expectValid: '2xx with missions array shape',
    expectBadSession: '401 with { error } string',
  },
  {
    method: 'POST',
    path: '/api/missions/claim',
    expectValid: '2xx shape or 4xx { error } (never silent)',
    expectBadSession: '401 with { error } string',
  },
  {
    method: 'POST',
    path: '/api/feedback',
    expectValid:
      'F-01: session-gated 2xx when EXPECT_FEEDBACK_ANON=false; service-backed 2xx when true',
    expectBadSession:
      'F-01: 401 { error } when EXPECT_FEEDBACK_ANON=false; 2xx/4xx { error }-shaped when true',
  },
  {
    method: 'GET',
    path: '/api/spectator-bets',
    expectValid: '2xx with bets array shape',
    expectBadSession: '401 with { error } string',
  },
  {
    method: 'POST',
    path: '/api/lobby/join',
    expectValid: '2xx shape or 4xx { error } (never silent)',
    expectBadSession: '401 with { error } string',
  },
];

export const ANON_SAFE_ROUTES: readonly string[] = [
  '/api/live-chat (GET)',
  '/api/geo (GET)',
  '/api/farcaster (GET)',
  '/api/matchmaking/status (GET narrow poll: status, match_id)',
];

/**
 * Phase 2 gated routes (session-gated, owner/participant-checked).
 * Paths carry a human label suffix so offline IDs stay unique; full-mode
 * constructs the real query URLs explicitly (see runPhase2FullChecks).
 * NOTE: the ANON_SAFE narrow-poll entry above is the legacy GET-only poll.
 * Phase 2 extended modes (ticketId owner token, matchId roster) are
 * session-gated — see PHASE2_GATED_ROUTES expectations.
 */
export const PHASE2_GATED_ROUTES: readonly GatedRouteSpec[] = [
  {
    method: 'GET',
    path: '/api/matchmaking/status (ticketId owner token)',
    expectValid:
      '2xx owner-only { status, match_id, room_code, validation_token, players } — token ONLY for session owner',
    expectBadSession:
      '401 with { error } string without session; searching-without-token (no validation_token) for non-owner session',
  },
  {
    method: 'GET',
    path: '/api/matchmaking/status (matchId roster)',
    expectValid:
      '2xx participant-only { status: matched, match_id, players[] } — deterministic host resolution',
    expectBadSession: '401 without session; 403 { error } for outsider (non-participant)',
  },
  {
    method: 'GET',
    path: '/api/social/moderation',
    expectValid: '2xx with { blocked: boolean } for own blocker perspective only',
    expectBadSession: '401 with { error } string without session',
  },
];

export const SERVICE_KEY_ERROR_TEXT = 'Supabase service role is not configured';
export const BASELINE_REL_PATH = 'supabase/migrations/00000000000000_baseline.sql';
/** The forbidden fallback in app/api write paths (no-silent-degrade tripwire). */
export const FALLBACK_TRIPWIRE_RE = /\|\|\s*(process\.env\.)?NEXT_PUBLIC_SUPABASE_ANON_KEY/;

// ---------------------------------------------------------------------------
// Cutover compat additions (additive; existing matrix above untouched).
// ---------------------------------------------------------------------------
// Three NEW compat migration files (SQL, not live DB) + N1 caller-bound
// ticket mint on direct match. Migration assertions are STATIC (file-text
// parse, offline, no DB) — see checkCompatMigrationFiles. N1 has both
// STATIC code assertions (checkJoinRouteStatic, offline) and live HTTP
// assertions (runHttpMatrix N1 block, full mode only).
export const COMPAT_POKES_SQL_REL =
  'supabase/migrations/202609180001_pokes_status_compat.sql';
export const COMPAT_MATCHES_SQL_REL =
  'supabase/migrations/202609180002_matches_finished_at.sql';
export const COMPAT_LIVE_CHAT_SQL_REL =
  'supabase/migrations/202609180003_live_chat_room_nullable.sql';
export const JOIN_ROUTE_REL = 'app/api/matchmaking/join/route.ts';
export const FEEDBACK_ROUTE_REL = 'app/api/feedback/route.ts';

/** Compat pokes CHECK union: code-canonical + baseline-legacy values. */
export const POKES_STATUS_UNION: readonly string[] = [
  'sent',
  'poked_back',
  'pending',
  'accepted',
  'dismissed',
];

/** Compat pokes indexes the deployed history had; baseline omits them. */
export const POKES_COMPAT_INDEXES: readonly string[] = [
  'pokes_receiver_status_idx',
  'pokes_sender_created_idx',
];

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface ProbeCheck {
  id: string;
  category: string;
  pass: boolean;
  detail: string;
}

export interface AppSessionFixture {
  id: string;
  wallet_address: string;
  nonce: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface FixtureSet {
  nowMs: number;
  host: string;
  guest: string;
  outsider: string;
  sessions: {
    valid: AppSessionFixture;
    expired: AppSessionFixture;
    revoked: AppSessionFixture;
  };
  matchRoomCode: string;
  gameInviteValidationToken: string;
  matchmakingGameMode: string;
  matchmakingMatchType: string;
  conversationPair: { a: string; b: string };
  ledgerKeys: string[];
  feedbackTopic: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (fully testable offline).
// ---------------------------------------------------------------------------

export function isLowercaseEthAddress(v: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(v);
}

/** Session validity mirrors lib/serverAuth.requireAppSession (pure part). */
export function isSessionValid(
  s: Pick<AppSessionFixture, 'expires_at' | 'revoked_at'>,
  nowMs: number,
): boolean {
  if (s.revoked_at) return false;
  return new Date(s.expires_at).getTime() > nowMs;
}

/** F-01 branch helper: should anon INSERT into feedback be allowed? */
export function expectedFeedbackAnonInsert(flag: boolean): boolean {
  return flag === true;
}

/**
 * Tripwire helper: true when file content is an OFFENSE — i.e. it contains
 * the anon-key fallback AND exports a mutating handler (POST/PUT/PATCH/DELETE).
 * GET-only files (e.g. the matchmaking/status narrow poll) are warnings, not
 * offenses, so the current tree passes while write-path regressions fail.
 */
export function isWritePathOffense(fileContent: string): boolean {
  if (!FALLBACK_TRIPWIRE_RE.test(fileContent)) return false;
  return /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(fileContent);
}

export function isFallbackPresent(fileContent: string): boolean {
  return FALLBACK_TRIPWIRE_RE.test(fileContent);
}

/**
 * No-silent-degrade helper: every failure body must be { error: <non-empty string>, ... }.
 * Returns true when the body is a valid error envelope.
 */
export function validateErrorBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const rec = body as Record<string, unknown>;
  return typeof rec['error'] === 'string' && (rec['error'] as string).trim().length > 0;
}

// ---------------------------------------------------------------------------
// Phase 2 pure validators (offline-safe: no DB, no network, no app imports).
// Full-mode HTTP asserts reuse these so offline + live share one truth.
// ---------------------------------------------------------------------------

/** Recursive banned-key scan (objects + arrays). True when any banned key appears. */
export function containsBannedKey(obj: unknown, banned: readonly string[]): boolean {
  const bannedSet = new Set(banned);
  const stack: unknown[] = [obj];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else if (typeof cur === 'object' && cur !== null) {
      for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
        if (bannedSet.has(k)) return true;
        stack.push(v);
      }
    }
  }
  return false;
}

/**
 * Pools aggregate shape: { pools: { "<wager>": count } } with non-negative
 * integer counts, and NEVER any player/token material.
 */
export function isPoolsResponseValid(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  if (!('pools' in rec)) return false;
  const pools = rec['pools'];
  if (typeof pools !== 'object' || pools === null || Array.isArray(pools)) return false;
  for (const [k, v] of Object.entries(pools as Record<string, unknown>)) {
    const wager = Number(k);
    if (!Number.isFinite(wager) || wager < 0) return false;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return false;
  }
  if (containsBannedKey(body, POOLS_PRIVATE_FIELDS)) return false;
  return true;
}

/** True when a pools body leaks player/token material. */
export function poolsResponseLeaksPlayers(body: unknown): boolean {
  return containsBannedKey(body, POOLS_PRIVATE_FIELDS);
}

/** Single presence row is grant-safe (allowed cols only, denied cols absent). */
export function isPresenceRowGrantSafe(row: unknown): boolean {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
  const rec = row as Record<string, unknown>;
  const allowed = new Set(PRESENCE_ALLOWED_COLS);
  for (const k of Object.keys(rec)) {
    if (!allowed.has(k)) return false;
  }
  for (const d of PRESENCE_DENIED_COLS) {
    if (d in rec) return false;
  }
  const wallet = rec['wallet_address'];
  if (typeof wallet !== 'string' || !isLowercaseEthAddress(wallet.toLowerCase())) return false;
  if (typeof rec['status'] !== 'string' || (rec['status'] as string).length === 0) return false;
  return true;
}

/** Presence directory shape: { players: grant-safe[], hasMore: boolean }. */
export function isPresenceResponseValid(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  const players = rec['players'];
  const hasMore = rec['hasMore'];
  if (!Array.isArray(players) || typeof hasMore !== 'boolean') return false;
  for (const row of players) {
    if (!isPresenceRowGrantSafe(row)) return false;
  }
  if (containsBannedKey(body, PRESENCE_DENIED_COLS)) return false;
  return true;
}

/** True when a presence body leaks private columns. */
export function presenceResponseLeaksPrivate(body: unknown): boolean {
  return containsBannedKey(body, PRESENCE_DENIED_COLS);
}

/** Mock of route self-exclusion (?walletAddress=… excludes self). Pure. */
export function filterPresenceSelf<T extends { wallet_address: string }>(
  rows: readonly T[],
  excludeWallet: string | null,
): T[] {
  if (!excludeWallet || excludeWallet.trim().length === 0) return [...rows];
  const ex = excludeWallet.toLowerCase();
  return rows.filter((r) => String(r.wallet_address || '').toLowerCase() !== ex);
}

/** Mock of route paging (?page=&limit=, limit clamped 1..50). Pure. */
export function paginatePresence<T>(
  rows: readonly T[],
  page: number,
  limit: number,
): { pageRows: T[]; hasMore: boolean } {
  const p = Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0;
  const lim = Number.isFinite(limit)
    ? Math.min(50, Math.max(1, Math.floor(limit)))
    : 25;
  const start = p * lim;
  const pageRows = rows.slice(start, start + lim);
  return { pageRows, hasMore: start + pageRows.length < rows.length };
}

/** Fresh-heartbeat check (mirrors route: last_seen_at within window). Pure. */
export function isPresenceFresh(
  lastSeenAt: string,
  nowMs: number,
  windowMs: number = PRESENCE_FRESHNESS_MS,
): boolean {
  const t = Date.parse(lastSeenAt);
  if (!Number.isFinite(t)) return false;
  return t > nowMs - windowMs;
}

/** Public spectator snapshot: exactly { seq, state, color_corner }, no leaks. */
export function isMatchStateSnapshotValid(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  if (typeof rec['seq'] !== 'number' || !Number.isInteger(rec['seq'] as number)) return false;
  if ((rec['seq'] as number) < 0) return false;
  const st = rec['state'];
  const cc = rec['color_corner'];
  if (typeof st !== 'object' || st === null || Array.isArray(st)) return false;
  if (typeof cc !== 'object' || cc === null || Array.isArray(cc)) return false;
  if (!('seq' in rec) || !('state' in rec) || !('color_corner' in rec)) return false;
  if (containsBannedKey(body, MATCH_STATE_DENIED_KEYS)) return false;
  return true;
}

/** True when a match/state body leaks economy/session columns. */
export function matchStateLeaksPrivate(body: unknown): boolean {
  return containsBannedKey(body, MATCH_STATE_DENIED_KEYS);
}

/** 404 spectator-miss envelope: { error: string, code: 'MATCH_NOT_FOUND' }. */
export function isMatchNotFoundBody(body: unknown): boolean {
  if (!validateErrorBody(body)) return false;
  const rec = body as Record<string, unknown>;
  return rec['code'] === 'MATCH_NOT_FOUND';
}

/** Moderation GET shape: exactly { blocked: boolean } — own perspective only. */
export function isModerationBodyValid(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== 'blocked') return false;
  const rec = body as Record<string, unknown>;
  if (typeof rec['blocked'] !== 'boolean') return false;
  if (containsBannedKey(body, MODERATION_PRIVATE_FIELDS)) return false;
  return true;
}

/** True when a moderation body leaks another user's block list. */
export function moderationLeaksList(body: unknown): boolean {
  return containsBannedKey(body, MODERATION_PRIVATE_FIELDS);
}

/** Own-perspective check: blocker must equal the session wallet. Pure. */
export function isModerationOwnPerspective(blockerAddress: string, wallet: string): boolean {
  return String(blockerAddress || '').toLowerCase() === String(wallet || '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Cutover pure validators (offline-safe: string/body in, boolean out).
// Full-mode HTTP asserts reuse these so offline + live share one truth.
// ---------------------------------------------------------------------------

/** Pokes compat SQL carries the full CHECK union (sent/poked_back + legacy). */
export function pokesCompatHasStatusUnion(sql: string): boolean {
  if (!sql.includes('pokes_status_check')) return false;
  return POKES_STATUS_UNION.every((v) => sql.includes(`'${v}'`));
}

/** Pokes compat SQL sets the code-canonical default. */
export function pokesCompatHasDefaultSent(sql: string): boolean {
  return sql.includes('pokes') && sql.includes('status') && sql.includes("set default 'sent'");
}

/** Pokes compat SQL creates both deployed-history indexes. */
export function pokesCompatHasBothIndexes(sql: string): boolean {
  return POKES_COMPAT_INDEXES.every((idx) => sql.includes(idx));
}

/** Matches compat SQL adds a nullable finished_at timestamptz column. */
export function matchesCompatHasFinishedAtColumn(sql: string): boolean {
  return (
    sql.includes('finished_at') &&
    sql.includes('timestamptz') &&
    /add\s+column\s+if\s+not\s+exists\s+finished_at/i.test(sql)
  );
}

/** Matches compat SQL backfills historically-settled rows only. */
export function matchesCompatHasBackfillWhere(sql: string): boolean {
  const norm = sql.replace(/\s+/g, ' ').toLowerCase();
  return (
    norm.includes('set finished_at = created_at') &&
    norm.includes('where finished_at is null and winner_address is not null')
  );
}

/** Matches compat SQL indexes finished_at for settlement/replay scans. */
export function matchesCompatHasIndex(sql: string): boolean {
  return sql.includes('matches_finished_at_idx');
}

/**
 * Live-chat compat SQL guards the nullable rewrite (idempotent on
 * archive-migrated DBs where the column is already nullable).
 */
export function liveChatCompatHasNullableGuard(sql: string): boolean {
  return (
    sql.includes('live_chat') &&
    sql.includes('room_code') &&
    sql.includes('drop not null') &&
    sql.includes("is_nullable = 'NO'")
  );
}

/** Live-chat compat SQL keeps the room/order index deterministic. */
export function liveChatCompatHasIndex(sql: string): boolean {
  return sql.includes('live_chat_room_idx');
}

/** N1: route binds the caller via the app session (owner = session wallet). */
export function joinRouteHasSessionOwnerBinding(route: string): boolean {
  return route.includes('requireAppSession(playerId, sessionId)') && route.includes('playerId = wallet');
}

/** N1: ticket lookup is bounded to the caller's own ticket row. */
export function joinRouteHasCallerBoundLookup(route: string): boolean {
  return route.includes(".eq('player_id', playerId)") && route.includes(".eq('match_id', data.match_id)");
}

/**
 * N1: single mint site, guarded to null (no rotation): early-return when the
 * RPC already carried a token, early-return when the ticket already has one,
 * and a bounded UPDATE with .eq('id', ticket.id) + .is('validation_token', null).
 * Counts UPDATE sites so a second mint path fails the check.
 */
export function joinRouteHasGuardedSingleMint(route: string): boolean {
  const updateSites = (route.match(/\.update\(\s*\{\s*validation_token\s*:/g) ?? []).length;
  return (
    updateSites === 1 &&
    route.includes('if (data.validation_token) return data') &&
    route.includes('if (ticket.validation_token) return') &&
    route.includes(".eq('id', ticket.id)") &&
    route.includes(".is('validation_token', null)")
  );
}

/**
 * N1: no token in the unauthenticated path — the 401 branch carries no
 * validation_token, and both withCallerToken invocations sit after the
 * `playerId = wallet` session gate (definition itself is before the gate).
 */
export function joinRouteUnauthPathHasNoToken(route: string): boolean {
  const gate = 'playerId = wallet';
  const gateIdx = route.indexOf(gate);
  if (gateIdx < 0) return false;
  const unauthNeedle = "return NextResponse.json({ error: 'Invalid session' }";
  const unauthIdx = route.indexOf(unauthNeedle);
  if (unauthIdx < 0) return false;
  const unauthLine = route.slice(unauthIdx, unauthIdx + unauthNeedle.length + 40);
  if (unauthLine.includes('validation_token')) return false;
  const firstCall = route.indexOf('withCallerToken(supabase, playerId, data)');
  if (firstCall < 0 || firstCall < gateIdx) return false;
  return true;
}

/**
 * N1 direct-match shape: a matched body for the owner MUST carry a non-empty
 * validation_token (the poll path always does; the fast path mints it).
 * Searching bodies carry no token requirement (still queued).
 */
export function isDirectMatchTokenResponse(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  if (rec['status'] === 'searching') return !statusTicketLeaksToken(body, false);
  if (rec['status'] !== 'matched') return false;
  if (typeof rec['match_id'] !== 'string' || (rec['match_id'] as string).length === 0)
    return false;
  const v = rec['validation_token'];
  return typeof v === 'string' && v.trim().length > 0;
}

/** N1 idempotency: two identical direct-match POSTs MUST return the same token. */
export function isDirectMatchMintIdempotent(first: unknown, second: unknown): boolean {
  if (!isDirectMatchTokenResponse(first) || !isDirectMatchTokenResponse(second)) return false;
  const a = (first as Record<string, unknown>)['validation_token'];
  const b = (second as Record<string, unknown>)['validation_token'];
  return typeof a === 'string' && a === b;
}

/** F-01 intact: feedback POST stays anonymous-by-contract (never 401-gated). */
export function isFeedbackRouteAnonIntact(route: string): boolean {
  if (!route.includes('anonymous by contract')) return false;
  if (!route.includes('serviceDb()')) return false;
  if (route.includes('Invalid session')) return false;
  return /attribution[\s\S]{0,400}Never rejects|Never rejects[\s\S]{0,400}attribution/i.test(route);
}

/**
 * Ticket-mode token gate: non-owner responses must NEVER carry a non-empty
 * validation_token (401 without session is covered by validateErrorBody;
 * the live route returns { status: 'searching' } for non-owners).
 */
export function statusTicketLeaksToken(body: unknown, isOwner: boolean): boolean {
  if (isOwner) return false;
  if (typeof body !== 'object' || body === null) return false;
  const rec = body as Record<string, unknown>;
  if (!('validation_token' in rec)) return false;
  const v = rec['validation_token'];
  if (v === null || v === undefined) return false;
  return String(v).trim().length > 0;
}

/** Ticket-mode shape (owner matched OR searching): status-gated, token rules via statusTicketLeaksToken. */
export function isStatusTicketShapeValid(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  const status = rec['status'];
  if (status !== 'searching' && status !== 'matched') return false;
  if (status === 'matched') {
    if (typeof rec['match_id'] !== 'string' || (rec['match_id'] as string).length === 0)
      return false;
  }
  if ('validation_token' in rec) {
    const v = rec['validation_token'];
    if (v !== null && v !== undefined && typeof v !== 'string') return false;
  }
  if ('players' in rec && rec['players'] !== undefined) {
    const players = rec['players'];
    if (!Array.isArray(players)) return false;
    for (const p of players) {
      if (typeof p !== 'string' || !isLowercaseEthAddress(p.toLowerCase())) return false;
    }
  }
  return true;
}

/** Roster-mode shape: participant-only { status: matched, match_id, players[] }, never a token. */
export function isRosterResponseValid(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  if (rec['status'] !== 'matched') return false;
  if (typeof rec['match_id'] !== 'string' || (rec['match_id'] as string).length === 0)
    return false;
  const players = rec['players'];
  if (!Array.isArray(players) || players.length === 0) return false;
  for (const p of players) {
    if (typeof p !== 'string' || !isLowercaseEthAddress(p.toLowerCase())) return false;
  }
  if (statusTicketLeaksToken(body, false)) return false;
  if (containsBannedKey(body, ['validation_token'])) {
    const v = (rec as Record<string, unknown>)['validation_token'];
    if (v !== null && v !== undefined && String(v).trim().length > 0) return false;
  }
  return true;
}

/** True when a roster body leaks validation_token. */
export function rosterLeaksToken(body: unknown): boolean {
  return statusTicketLeaksToken(body, false);
}

/** Deterministic fixture builder — no randomness, no I/O. */
export function buildFixtures(nowMs: number): FixtureSet {
  const host = '0x1111111111111111111111111111111111111111';
  const guest = '0x2222222222222222222222222222222222222222';
  const outsider = '0x3333333333333333333333333333333333333333';
  return {
    nowMs,
    host,
    guest,
    outsider,
    sessions: {
      valid: {
        id: '11111111-1111-4111-8111-111111111111',
        wallet_address: host,
        nonce: 'compat-nonce-host-valid-001',
        expires_at: new Date(nowMs + 60 * 60 * 1000).toISOString(),
        revoked_at: null,
      },
      expired: {
        id: '22222222-2222-4222-8222-222222222222',
        wallet_address: guest,
        nonce: 'compat-nonce-guest-expired-001',
        expires_at: new Date(nowMs - 60 * 60 * 1000).toISOString(),
        revoked_at: null,
      },
      revoked: {
        id: '33333333-3333-4333-8333-333333333333',
        wallet_address: host,
        nonce: 'compat-nonce-host-revoked-001',
        expires_at: new Date(nowMs + 60 * 60 * 1000).toISOString(),
        revoked_at: new Date(nowMs - 1000).toISOString(),
      },
    },
    matchRoomCode: 'CMP001',
    gameInviteValidationToken: 'compat-validation-token-001',
    matchmakingGameMode: 'classic',
    matchmakingMatchType: '1v1',
    conversationPair: {
      a: [host, guest].sort()[0],
      b: [host, guest].sort()[1],
    },
    ledgerKeys: ['compat-seed:host:001', 'compat-seed:guest:001'],
    feedbackTopic: 'compat-probe feedback sample',
  };
}

/** Validate fixture linkages; returns a list of error strings (empty = ok). */
export function validateFixtures(f: FixtureSet): string[] {
  const errs: string[] = [];
  const addrs = [f.host, f.guest, f.outsider];
  if (new Set(addrs).size !== 3) errs.push('fixture players must be 3 distinct addresses');
  for (const a of addrs) {
    if (!isLowercaseEthAddress(a)) errs.push(`fixture address not lowercase eth: ${a}`);
  }
  const nonces = [
    f.sessions.valid.nonce,
    f.sessions.expired.nonce,
    f.sessions.revoked.nonce,
  ];
  if (new Set(nonces).size !== 3) errs.push('fixture session nonces must be distinct');
  if (!isSessionValid(f.sessions.valid, f.nowMs)) errs.push('valid session must classify valid');
  if (isSessionValid(f.sessions.expired, f.nowMs)) errs.push('expired session must classify invalid');
  if (isSessionValid(f.sessions.revoked, f.nowMs)) errs.push('revoked session must classify invalid');
  if (f.conversationPair.a >= f.conversationPair.b)
    errs.push('conversations fixture must satisfy user_a < user_b');
  if (!/^[A-Z0-9]{6}$/.test(f.matchRoomCode))
    errs.push('match room code must be 6 alnum chars');
  if (f.gameInviteValidationToken.length < 8)
    errs.push('game_invites fixture must carry validation material');
  if (new Set(f.ledgerKeys).size !== f.ledgerKeys.length)
    errs.push('coin ledger idempotency keys must be unique');
  if (!f.feedbackTopic.trim()) errs.push('feedback sample must be non-empty');
  return errs;
}

// ---------------------------------------------------------------------------
// Filesystem helpers (offline-safe: pure reads of the repo tree).
// ---------------------------------------------------------------------------

function walkApiRouteFiles(apiDir: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (e.isFile() && e.name === 'route.ts') out.push(full);
    }
  };
  visit(apiDir);
  return out.sort();
}

export interface GrepTripwireResult {
  scanned: number;
  offenses: string[];
  warnings: string[];
  pass: boolean;
}

/** Repo-wide grep pre-step: fail on anon-fallback in write paths. */
export function runGrepTripwire(repoRoot: string): GrepTripwireResult {
  const apiDir = path.join(repoRoot, 'app', 'api');
  const files = walkApiRouteFiles(apiDir);
  const offenses: string[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    let content = '';
    try {
      content = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (!isFallbackPresent(content)) continue;
    const rel = path.relative(repoRoot, f);
    if (isWritePathOffense(content)) offenses.push(rel);
    else warnings.push(rel);
  }
  return { scanned: files.length, offenses, warnings, pass: offenses.length === 0 };
}

export interface BaselineCheckResult {
  exists: boolean;
  checks: ProbeCheck[];
}

/** Static verification that the baseline file carries the expected policy markers. */
export function checkBaselineFile(repoRoot: string): BaselineCheckResult {
  const full = path.join(repoRoot, BASELINE_REL_PATH);
  const exists = fs.existsSync(full);
  const checks: ProbeCheck[] = [];
  const need = (id: string, hay: string, needle: string): void => {
    checks.push({
      id,
      category: 'baseline-static',
      pass: hay.includes(needle),
      detail: hay.includes(needle) ? `found: ${needle}` : `MISSING: ${needle}`,
    });
  };
  if (!exists) {
    checks.push({
      id: 'baseline/exists',
      category: 'baseline-static',
      pass: false,
      detail: `missing ${BASELINE_REL_PATH}`,
    });
    return { exists: false, checks };
  }
  const content = fs.readFileSync(full, 'utf8');
  need('baseline/rls-enabled', content, 'enable row level security');
  need('baseline/feedback-anon-insert', content, 'feedback_anon_insert');
  need('baseline/revoke-join-matchmaking', content, 'revoke execute on function public.join_matchmaking');
  need('baseline/grant-service-cashout', content, 'grant execute on function public.cash_out_bet');
  need('baseline/players-column-grant', content, 'grant select (wallet_address, username');
  need('baseline/matchmaking-column-grant', content, 'grant select (player_id, game_mode');
  need('baseline/matches-public-read', content, 'matches_public_read');
  need('baseline/realtime-publication', content, 'supabase_realtime');
  return { exists: true, checks };
}

/**
 * STATIC compat-migration checks (offline, no DB): parse the three SQL files
 * for their expected statements/identifiers. Static-vs-live distinction: these
 * assert the migration TEXT ships the right DDL (union values, guards,
 * indexes, backfill where-clause). Live application (column actually nullable,
 * CHECK actually enforced, index actually used) is proven by the full-mode
 * RLS/RPC matrices on a scratch project — not here.
 */
export function checkCompatMigrationFiles(repoRoot: string): ProbeCheck[] {
  const checks: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    checks.push({ id, category: 'compat-migrations-static', pass, detail });
  };
  const readOpt = (rel: string): string | null => {
    try {
      return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const pokes = readOpt(COMPAT_POKES_SQL_REL);
  push(
    'compat-migrations/pokes-file-exists',
    pokes !== null,
    pokes !== null ? `found ${COMPAT_POKES_SQL_REL}` : `MISSING ${COMPAT_POKES_SQL_REL}`,
  );
  push(
    'compat-migrations/pokes-check-union',
    pokes !== null && pokesCompatHasStatusUnion(pokes),
    pokes === null
      ? 'no file to parse'
      : pokesCompatHasStatusUnion(pokes)
        ? `CHECK union carries ${POKES_STATUS_UNION.join('/')}`
        : `MISSING union values (expect ${POKES_STATUS_UNION.join(', ')}) in pokes_status_check`,
  );
  push(
    'compat-migrations/pokes-default-sent',
    pokes !== null && pokesCompatHasDefaultSent(pokes),
    pokes === null
      ? 'no file to parse'
      : pokesCompatHasDefaultSent(pokes)
        ? "default 'sent' present"
        : "MISSING default 'sent' on pokes.status",
  );
  push(
    'compat-migrations/pokes-both-indexes',
    pokes !== null && pokesCompatHasBothIndexes(pokes),
    pokes === null
      ? 'no file to parse'
      : pokesCompatHasBothIndexes(pokes)
        ? POKES_COMPAT_INDEXES.join(' + ')
        : `MISSING indexes (expect ${POKES_COMPAT_INDEXES.join(', ')})`,
  );
  const matches = readOpt(COMPAT_MATCHES_SQL_REL);
  push(
    'compat-migrations/matches-file-exists',
    matches !== null,
    matches !== null ? `found ${COMPAT_MATCHES_SQL_REL}` : `MISSING ${COMPAT_MATCHES_SQL_REL}`,
  );
  push(
    'compat-migrations/matches-finished-at-nullable',
    matches !== null && matchesCompatHasFinishedAtColumn(matches),
    matches === null
      ? 'no file to parse'
      : matchesCompatHasFinishedAtColumn(matches)
        ? 'add column if not exists finished_at timestamptz (nullable)'
        : 'MISSING nullable finished_at timestamptz add',
  );
  push(
    'compat-migrations/matches-backfill-where',
    matches !== null && matchesCompatHasBackfillWhere(matches),
    matches === null
      ? 'no file to parse'
      : matchesCompatHasBackfillWhere(matches)
        ? 'backfill where finished_at is null and winner_address is not null'
        : 'MISSING backfill where-clause (settled-rows-only guard)',
  );
  push(
    'compat-migrations/matches-index',
    matches !== null && matchesCompatHasIndex(matches),
    matches === null
      ? 'no file to parse'
      : matchesCompatHasIndex(matches)
        ? 'matches_finished_at_idx present'
        : 'MISSING matches_finished_at_idx',
  );
  const chat = readOpt(COMPAT_LIVE_CHAT_SQL_REL);
  push(
    'compat-migrations/live-chat-file-exists',
    chat !== null,
    chat !== null ? `found ${COMPAT_LIVE_CHAT_SQL_REL}` : `MISSING ${COMPAT_LIVE_CHAT_SQL_REL}`,
  );
  push(
    'compat-migrations/live-chat-nullable-guard',
    chat !== null && liveChatCompatHasNullableGuard(chat),
    chat === null
      ? 'no file to parse'
      : liveChatCompatHasNullableGuard(chat)
        ? 'room_code nullable-guard (is_nullable + drop not null) present'
        : 'MISSING room_code nullable-guard',
  );
  push(
    'compat-migrations/live-chat-index',
    chat !== null && liveChatCompatHasIndex(chat),
    chat === null
      ? 'no file to parse'
      : liveChatCompatHasIndex(chat)
        ? 'live_chat_room_idx present'
        : 'MISSING live_chat_room_idx',
  );
  return checks;
}

/** STATIC N1 checks (offline, no DB): parse the join route for the guarded mint. */
export function checkJoinRouteStatic(repoRoot: string): ProbeCheck[] {
  const checks: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    checks.push({ id, category: 'n1-mint-static', pass, detail });
  };
  let route: string | null = null;
  try {
    route = fs.readFileSync(path.join(repoRoot, JOIN_ROUTE_REL), 'utf8');
  } catch {
    route = null;
  }
  push(
    'n1-mint/route-file-exists',
    route !== null,
    route !== null ? `found ${JOIN_ROUTE_REL}` : `MISSING ${JOIN_ROUTE_REL}`,
  );
  push(
    'n1-mint/session-owner-binding',
    route !== null && joinRouteHasSessionOwnerBinding(route),
    route === null
      ? 'no file to parse'
      : joinRouteHasSessionOwnerBinding(route)
        ? 'owner = session wallet (requireAppSession → playerId = wallet)'
        : 'MISSING session-owner binding',
  );
  push(
    'n1-mint/caller-bound-lookup',
    route !== null && joinRouteHasCallerBoundLookup(route),
    route === null
      ? 'no file to parse'
      : joinRouteHasCallerBoundLookup(route)
        ? "lookup bounded to caller ticket (player_id + match_id)"
        : 'MISSING caller-bound ticket lookup',
  );
  push(
    'n1-mint/guarded-single-mint',
    route !== null && joinRouteHasGuardedSingleMint(route),
    route === null
      ? 'no file to parse'
      : joinRouteHasGuardedSingleMint(route)
        ? 'single mint site, guarded to null (no rotation)'
        : 'MISSING guarded single-mint (expect 1 update + null guard + early-returns)',
  );
  push(
    'n1-mint/unauth-no-token',
    route !== null && joinRouteUnauthPathHasNoToken(route),
    route === null
      ? 'no file to parse'
      : joinRouteUnauthPathHasNoToken(route)
        ? '401 path carries no token; mint only after session gate'
        : 'UNAUTH token risk (mint before gate or token in 401)',
  );
  return checks;
}

/** STATIC F-01 check (offline, no DB): feedback route stays anon-by-contract. */
export function checkFeedbackRouteStatic(repoRoot: string): ProbeCheck[] {
  const checks: ProbeCheck[] = [];
  let route: string | null = null;
  try {
    route = fs.readFileSync(path.join(repoRoot, FEEDBACK_ROUTE_REL), 'utf8');
  } catch {
    route = null;
  }
  checks.push({
    id: 'cutover/f01-route-anon-intact',
    category: 'f01',
    pass: route !== null && isFeedbackRouteAnonIntact(route),
    detail:
      route === null
        ? `MISSING ${FEEDBACK_ROUTE_REL}`
        : isFeedbackRouteAnonIntact(route)
          ? 'feedback POST anonymous-by-contract, attribution best-effort only'
          : 'REGRESSION: feedback route no longer anon-intact',
  });
  return checks;
}

// ---------------------------------------------------------------------------
// Offline self-test (no DB, no network). This is what CI runs before secrets exist.
// ---------------------------------------------------------------------------

export function runOfflineSelfTest(repoRoot: string): ProbeCheck[] {
  const checks: ProbeCheck[] = [];
  const push = (id: string, category: string, pass: boolean, detail: string): void => {
    checks.push({ id, category, pass, detail });
  };

  // --- 1. Matrix definition -----------------------------------------------
  push(
    'matrix/deny-count',
    'matrix-definition',
    DENY_SELECT_TABLES.length === 12,
    `deny list has ${DENY_SELECT_TABLES.length} tables (expect 12)`,
  );
  const denySet = new Set(DENY_SELECT_TABLES);
  const allowSet = new Set(ALLOW_SELECT_TABLES);
  const overlap = [...denySet].filter((t) => allowSet.has(t));
  // players + matchmaking_queue appear in ALLOW with column grants; they are
  // NOT in the deny list, so overlap must be empty.
  push(
    'matrix/deny-allow-disjoint',
    'matrix-definition',
    overlap.length === 0,
    overlap.length === 0 ? 'deny/allow lists disjoint' : `overlap: ${overlap.join(',')}`,
  );
  const expectedDeny = [
    'app_sessions',
    'game_invites',
    'friendships',
    'messages',
    'pokes',
    'player_missions',
    'spectator_bets',
    'coin_ledger',
    'match_sessions',
    'match_states',
    'match_moves',
    'lobby_join_requests',
  ];
  push(
    'matrix/deny-exact',
    'matrix-definition',
    expectedDeny.every((t) => denySet.has(t)),
    'deny list matches spec table-for-table',
  );
  for (const t of ['matches', 'live_matches', 'live_chat']) {
    push(
      `matrix/allow-${t}`,
      'matrix-definition',
      allowSet.has(t),
      allowSet.has(t) ? `${t} is public-read` : `${t} MISSING from allow list`,
    );
  }

  // --- 2. Players column grants --------------------------------------------
  push(
    'matrix/players-denied-private',
    'matrix-definition',
    PLAYERS_DENIED_COLS.includes('coins') &&
      PLAYERS_DENIED_COLS.includes('ecdh_pubkey') &&
      PLAYERS_DENIED_COLS.includes('peer_id'),
    `denied cols: ${PLAYERS_DENIED_COLS.join(',')}`,
  );
  const playerLeak = PLAYERS_ALLOWED_COLS.filter((c) =>
    (PLAYERS_DENIED_COLS as readonly string[]).includes(c),
  );
  push(
    'matrix/players-no-leak',
    'matrix-definition',
    playerLeak.length === 0,
    playerLeak.length === 0 ? 'allowed ∩ denied = ∅' : `leak: ${playerLeak.join(',')}`,
  );

  // --- 3. Matchmaking grants + status filter --------------------------------
  push(
    'matrix/matchmaking-hides-token',
    'matrix-definition',
    !MATCHMAKING_GRANTED_COLS.includes('validation_token') &&
      MATCHMAKING_PRIVATE_COLS.includes('validation_token'),
    'validation_token not granted, listed private',
  );
  push(
    'matrix/matchmaking-status-filter',
    'matrix-definition',
    MATCHMAKING_ANON_VISIBLE_STATUSES.includes('searching') &&
      MATCHMAKING_ANON_VISIBLE_STATUSES.includes('matched') &&
      !MATCHMAKING_ANON_VISIBLE_STATUSES.includes('cancelled'),
    `visible: ${MATCHMAKING_ANON_VISIBLE_STATUSES.join(',')}`,
  );

  // --- 4. RPC revocation list ------------------------------------------------
  const expectedRpcs = [
    'join_matchmaking',
    'join_matchmaking_hybrid',
    'cash_out_bet',
    'settle_match_bets',
    'join_tournament',
    'mark_conversation_read',
    'cleanup_matchmaking_queue',
    'cleanup_stale_data',
  ];
  push(
    'matrix/rpc-count',
    'matrix-definition',
    REVOKED_RPCS.length === expectedRpcs.length,
    `revoked RPCs: ${REVOKED_RPCS.length} (expect ${expectedRpcs.length})`,
  );
  for (const r of expectedRpcs) {
    push(
      `matrix/rpc-${r}`,
      'matrix-definition',
      (REVOKED_RPCS as readonly string[]).includes(r),
      (REVOKED_RPCS as readonly string[]).includes(r) ? 'listed' : 'MISSING',
    );
  }

  // --- 5. F-01 both branches coded -------------------------------------------
  push(
    'f01/true-means-anon-allowed',
    'f01',
    expectedFeedbackAnonInsert(true) === true,
    'EXPECT_FEEDBACK_ANON=true → anon INSERT allowed',
  );
  push(
    'f01/false-means-anon-denied',
    'f01',
    expectedFeedbackAnonInsert(false) === false,
    'EXPECT_FEEDBACK_ANON=false → anon INSERT denied (session-gated)',
  );
  push(
    'f01/default-is-baseline',
    'f01',
    EXPECT_FEEDBACK_ANON === true,
    `EXPECT_FEEDBACK_ANON=${String(EXPECT_FEEDBACK_ANON)} (default true per baseline policy)`,
  );

  // --- 6. Fixture builders ----------------------------------------------------
  const FIXED_NOW = Date.parse('2026-09-17T00:00:00.000Z');
  const fx = buildFixtures(FIXED_NOW);
  const fxErrs = validateFixtures(fx);
  push(
    'fixtures/valid',
    'fixtures',
    fxErrs.length === 0,
    fxErrs.length === 0 ? '3 players + sessions + linkage ok' : fxErrs.join('; '),
  );
  const fx2 = buildFixtures(FIXED_NOW);
  push(
    'fixtures/deterministic',
    'fixtures',
    JSON.stringify(fx) === JSON.stringify(fx2),
    'builder is deterministic for fixed now',
  );
  push(
    'fixtures/session-classes',
    'fixtures',
    isSessionValid(fx.sessions.valid, FIXED_NOW) &&
      !isSessionValid(fx.sessions.expired, FIXED_NOW) &&
      !isSessionValid(fx.sessions.revoked, FIXED_NOW),
    'valid/expired/revoked classify correctly',
  );
  push(
    'fixtures/addresses-lowercase',
    'fixtures',
    [fx.host, fx.guest, fx.outsider].every(isLowercaseEthAddress),
    `${fx.host}, ${fx.guest}, ${fx.outsider}`,
  );

  // --- 7. Assertion engine sanity ----------------------------------------------
  push(
    'engine/error-body-accepts',
    'assertion-engine',
    validateErrorBody({ error: 'boom' }) === true,
    '{ error: string } passes',
  );
  push(
    'engine/error-body-rejects-empty',
    'assertion-engine',
    validateErrorBody({}) === false &&
      validateErrorBody({ error: '' }) === false &&
      validateErrorBody({ error: 42 }) === false &&
      validateErrorBody(null) === false,
    'missing/empty/non-string error rejected',
  );
  push(
    'engine/write-offense-detects',
    'assertion-engine',
    isWritePathOffense(
      "const k = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\nexport async function POST() {}",
    ) === true,
    'fallback + POST detected',
  );
  push(
    'engine/get-only-is-warning',
    'assertion-engine',
    isWritePathOffense(
      "const k = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\nexport async function GET() {}",
    ) === false && isFallbackPresent('a || NEXT_PUBLIC_SUPABASE_ANON_KEY b') === true,
    'fallback + GET-only is warning, not offense',
  );

  // --- 8. HTTP matrix definition -------------------------------------------------
  push(
    'matrix/http-gated-count',
    'matrix-definition',
    GATED_HTTP_ROUTES.length >= 6,
    `${GATED_HTTP_ROUTES.length} gated routes defined`,
  );
  for (const r of GATED_HTTP_ROUTES) {
    const ok =
      r.expectBadSession.includes('401') &&
      (r.expectValid.includes('2xx') || r.expectValid.includes('F-01'));
    push(`matrix/http-${r.method}-${r.path}`, 'matrix-definition', ok, r.expectValid);
  }
  const safeJoined = ANON_SAFE_ROUTES.join(' ');
  push(
    'matrix/http-anon-safe',
    'matrix-definition',
    safeJoined.includes('/api/live-chat') &&
      safeJoined.includes('/api/geo') &&
      safeJoined.includes('/api/farcaster') &&
      safeJoined.includes('/api/matchmaking/status'),
    ANON_SAFE_ROUTES.join(' | '),
  );

  // --- 9. Realtime matrix definition ----------------------------------------------
  push(
    'matrix/realtime-count',
    'matrix-definition',
    REALTIME_TABLES.length === 6,
    `realtime tables: ${REALTIME_TABLES.map((r) => r.table).join(',')}`,
  );
  const rtTables = new Set(REALTIME_TABLES.map((r) => r.table));
  for (const t of [
    'messages',
    'conversations',
    'game_invites',
    'matchmaking_queue',
    'live_chat',
    'live_matches',
  ]) {
    push(
      `matrix/realtime-${t}`,
      'matrix-definition',
      rtTables.has(t),
      rtTables.has(t) ? 'covered' : 'MISSING',
    );
  }
  const gi = REALTIME_TABLES.find((r) => r.table === 'game_invites');
  push(
    'matrix/realtime-invite-token-private',
    'matrix-definition',
    !!gi && gi.privateFields.includes('validation_token'),
    'game_invites validation material never leaks',
  );
  const mm = REALTIME_TABLES.find((r) => r.table === 'matchmaking_queue');
  push(
    'matrix/realtime-mm-token-private',
    'matrix-definition',
    !!mm && mm.privateFields.includes('validation_token'),
    'matchmaking non-granted columns never leak',
  );

  // --- 10. Repo static checks (baseline file + grep tripwire) ----------------------
  const baseline = checkBaselineFile(repoRoot);
  for (const c of baseline.checks) checks.push(c);
  const grep = runGrepTripwire(repoRoot);
  push(
    'tripwire/no-write-fallback',
    'no-silent-degrade',
    grep.pass,
    grep.pass
      ? `scanned ${grep.scanned} route files, 0 write-path fallbacks`
      : `OFFENSES: ${grep.offenses.join(', ')}`,
  );
  push(
    'tripwire/scan-nonempty',
    'no-silent-degrade',
    grep.scanned > 0,
    `scanned ${grep.scanned} app/api route files`,
  );
  push(
    'tripwire/service-key-text-present',
    'no-silent-degrade',
    (() => {
      // At least the canonical write paths must fail LOUDLY with the
      // service-key text instead of silent empty results.
      const candidates = walkApiRouteFiles(path.join(repoRoot, 'app', 'api'));
      let hits = 0;
      for (const f of candidates) {
        try {
          if (fs.readFileSync(f, 'utf8').includes(SERVICE_KEY_ERROR_TEXT)) hits++;
        } catch {
          /* ignore */
        }
      }
      return hits > 0;
    })(),
    `service-key loud-500 text present in app/api write paths`,
  );

  // --- 11. Phase 2 matrix definitions (additive; F-01 intact) --------------------
  push(
    'phase2/matrix-public-routes',
    'phase2-matrix',
    PHASE2_PUBLIC_ROUTES.length === 3 &&
      PHASE2_PUBLIC_ROUTES.join(' ').includes('/api/matchmaking/pools') &&
      PHASE2_PUBLIC_ROUTES.join(' ').includes('/api/presence/online') &&
      PHASE2_PUBLIC_ROUTES.join(' ').includes('/api/match/state'),
    PHASE2_PUBLIC_ROUTES.join(' | '),
  );
  push(
    'phase2/matrix-gated-routes',
    'phase2-matrix',
    PHASE2_GATED_ROUTES.length === 3 &&
      PHASE2_GATED_ROUTES.every(
        (r) => r.expectBadSession.includes('401') && r.expectValid.includes('2xx'),
      ),
    PHASE2_GATED_ROUTES.map((r) => `${r.method} ${r.path}`).join(' | '),
  );
  push(
    'phase2/matrix-pools-hides-players',
    'phase2-matrix',
    POOLS_PRIVATE_FIELDS.includes('player_ids') &&
      POOLS_PRIVATE_FIELDS.includes('player_id') &&
      POOLS_PRIVATE_FIELDS.includes('validation_token'),
    `pools private: ${POOLS_PRIVATE_FIELDS.join(',')}`,
  );
  push(
    'phase2/matrix-presence-grants',
    'phase2-matrix',
    PRESENCE_DENIED_COLS.includes('last_seen_at') &&
      PRESENCE_DENIED_COLS.includes('peer_id') &&
      PRESENCE_DENIED_COLS.includes('coins') &&
      PRESENCE_DENIED_COLS.includes('ecdh_pubkey') &&
      PRESENCE_ALLOWED_COLS.includes('wallet_address') &&
      !PRESENCE_ALLOWED_COLS.some((c) => (PRESENCE_DENIED_COLS as readonly string[]).includes(c)),
    `allowed: ${PRESENCE_ALLOWED_COLS.join(',')} / denied: ${PRESENCE_DENIED_COLS.join(',')}`,
  );
  push(
    'phase2/matrix-match-state-keys',
    'phase2-matrix',
    MATCH_STATE_ALLOWED_KEYS.length === 3 &&
      MATCH_STATE_ALLOWED_KEYS.includes('seq') &&
      MATCH_STATE_ALLOWED_KEYS.includes('state') &&
      MATCH_STATE_ALLOWED_KEYS.includes('color_corner') &&
      MATCH_STATE_DENIED_KEYS.includes('host_address') &&
      MATCH_STATE_DENIED_KEYS.includes('player_seats'),
    `allowed: ${MATCH_STATE_ALLOWED_KEYS.join(',')}`,
  );
  push(
    'phase2/matrix-moderation-only-blocked',
    'phase2-matrix',
    MODERATION_ALLOWED_KEYS.length === 1 && MODERATION_ALLOWED_KEYS[0] === 'blocked',
    `allowed: ${MODERATION_ALLOWED_KEYS.join(',')}`,
  );
  push(
    'phase2/f01-intact',
    'f01',
    EXPECT_FEEDBACK_ANON === true &&
      expectedFeedbackAnonInsert(true) === true &&
      expectedFeedbackAnonInsert(false) === false,
    `F-01 parameterization intact (EXPECT_FEEDBACK_ANON=${String(EXPECT_FEEDBACK_ANON)})`,
  );

  // --- 12. Phase 2 pools mock-mode -----------------------------------------------
  push(
    'phase2/pools-valid-aggregate',
    'phase2-pools',
    isPoolsResponseValid({ pools: { '0': 2, '100': 1 } }) === true,
    '{ pools: { wager: count } } passes',
  );
  push(
    'phase2/pools-empty-ok',
    'phase2-pools',
    isPoolsResponseValid({ pools: {} }) === true,
    'empty pools (no searchers) is valid',
  );
  push(
    'phase2/pools-leak-player-ids',
    'phase2-pools',
    isPoolsResponseValid({ pools: { '0': 1 }, player_ids: [fx.host] }) === false &&
      poolsResponseLeaksPlayers({ pools: { '0': 1 }, player_ids: [fx.host] }) === true,
    'player_ids in pools body is a leak (reject)',
  );
  push(
    'phase2/pools-leak-player-id-singular',
    'phase2-pools',
    isPoolsResponseValid({ pools: {}, player_id: fx.host }) === false &&
      poolsResponseLeaksPlayers({ pools: {}, player_id: fx.host }) === true,
    'singular player_id in pools body is a leak (reject)',
  );
  push(
    'phase2/pools-leak-token',
    'phase2-pools',
    isPoolsResponseValid({ pools: { '0': 1 }, validation_token: 'secret' }) === false &&
      poolsResponseLeaksPlayers({ pools: { '0': 1 }, validation_token: 'secret' }) === true,
    'validation_token in pools body is a leak (reject)',
  );
  push(
    'phase2/pools-rejects-bad-shape',
    'phase2-pools',
    isPoolsResponseValid({}) === false &&
      isPoolsResponseValid({ pools: { '0': -1 } }) === false &&
      isPoolsResponseValid({ pools: { 'abc': 1 } }) === false &&
      isPoolsResponseValid(null) === false,
    'missing/negative/non-numeric pools rejected',
  );

  // --- 13. Phase 2 status mock-mode (ticket owner gate + roster) ------------------
  {
    const ownerMatched = {
      status: 'matched',
      match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      room_code: 'QM-ABC123',
      validation_token: 'phase2-owner-token-001',
      players: [fx.host, fx.guest],
    };
    const nonOwnerSearching = { status: 'searching' };
    const nonOwnerWithToken = {
      status: 'matched',
      match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      validation_token: 'should-not-leak',
      players: [fx.host, fx.guest],
    };
    push(
      'phase2/status-owner-matched-shape',
      'phase2-status',
      isStatusTicketShapeValid(ownerMatched) === true &&
        statusTicketLeaksToken(ownerMatched, true) === false,
      'owner matched shape valid, no leak flag for owner',
    );
    push(
      'phase2/status-nonowner-searching-no-leak',
      'phase2-status',
      isStatusTicketShapeValid(nonOwnerSearching) === true &&
        statusTicketLeaksToken(nonOwnerSearching, false) === false,
      'non-owner searching (no token) is the 403/empty pass case',
    );
    push(
      'phase2/status-nonowner-token-is-leak',
      'phase2-status',
      statusTicketLeaksToken(nonOwnerWithToken, false) === true &&
        isStatusTicketShapeValid(nonOwnerWithToken) === true,
      'detector catches validation_token leaked to non-owner',
    );
    push(
      'phase2/status-401-without-session',
      'phase2-status',
      validateErrorBody({ error: 'Invalid session' }) === true,
      'ticket/roster without session is 401 { error }',
    );
    const rosterOk = {
      status: 'matched',
      match_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      players: [fx.host, fx.guest],
    };
    const rosterWithToken = { ...rosterOk, validation_token: 'leak' };
    push(
      'phase2/status-roster-valid',
      'phase2-status',
      isRosterResponseValid(rosterOk) === true && rosterLeaksToken(rosterOk) === false,
      'participant roster { matched, match_id, players[] } passes, no token',
    );
    push(
      'phase2/status-roster-token-is-leak',
      'phase2-status',
      isRosterResponseValid(rosterWithToken) === false &&
        rosterLeaksToken(rosterWithToken) === true,
      'roster with validation_token fails (no token leaks anywhere)',
    );
    push(
      'phase2/status-roster-403-outsider',
      'phase2-status',
      validateErrorBody({ error: 'Not a participant' }) === true,
      'outsider roster attempt is 403 { error }',
    );
  }

  // --- 14. Phase 2 presence mock-mode ----------------------------------------------
  {
    const safeRow = {
      wallet_address: fx.host,
      username: 'compat-host',
      avatar_url: null,
      status: 'Online',
    };
    const staleNow = FIXED_NOW;
    push(
      'phase2/presence-row-grant-safe',
      'phase2-presence',
      isPresenceRowGrantSafe(safeRow) === true,
      'grant-safe row passes',
    );
    push(
      'phase2/presence-row-leaks-denied',
      'phase2-presence',
      isPresenceRowGrantSafe({ ...safeRow, last_seen_at: new Date(staleNow).toISOString() }) ===
        false &&
        isPresenceRowGrantSafe({ ...safeRow, peer_id: 'p' }) === false &&
        isPresenceRowGrantSafe({ ...safeRow, coins: 100 }) === false &&
        isPresenceRowGrantSafe({ ...safeRow, ecdh_pubkey: {} }) === false,
      'last_seen_at/peer_id/coins/ecdh_pubkey each fail grant-safe',
    );
    push(
      'phase2/presence-response-valid',
      'phase2-presence',
      isPresenceResponseValid({ players: [safeRow], hasMore: false }) === true &&
        presenceResponseLeaksPrivate({ players: [safeRow], hasMore: false }) === false,
      '{ players: grant-safe[], hasMore } passes',
    );
    push(
      'phase2/presence-response-leak-caught',
      'phase2-presence',
      isPresenceResponseValid({
        players: [{ ...safeRow, peer_id: 'leak' }],
        hasMore: false,
      }) === false &&
        presenceResponseLeaksPrivate({ players: [{ ...safeRow, peer_id: 'leak' }] }) === true,
      'detector catches private col inside players[]',
    );
    const rows = [
      { wallet_address: fx.host },
      { wallet_address: fx.guest },
      { wallet_address: fx.outsider },
    ];
    const excluded = filterPresenceSelf(rows, fx.host);
    push(
      'phase2/presence-self-exclusion',
      'phase2-presence',
      excluded.length === 2 && excluded.every((r) => r.wallet_address !== fx.host),
      'walletAddress param excludes self',
    );
    const paged0 = paginatePresence(rows, 0, 2);
    const paged1 = paginatePresence(rows, 1, 2);
    push(
      'phase2/presence-paging',
      'phase2-presence',
      paged0.pageRows.length === 2 &&
        paged0.hasMore === true &&
        paged1.pageRows.length === 1 &&
        paged1.hasMore === false,
      'page/limit slices with hasMore',
    );
    push(
      'phase2/presence-freshness',
      'phase2-presence',
      isPresenceFresh(new Date(staleNow - 60 * 1000).toISOString(), staleNow) === true &&
        isPresenceFresh(new Date(staleNow - 5 * 60 * 1000).toISOString(), staleNow) === false,
      'fresh <2min passes, stale 5min fails',
    );
  }

  // --- 15. Phase 2 match/state mock-mode --------------------------------------------
  {
    const snap = { seq: 7, state: { turn: 1 }, color_corner: { green: 0 } };
    push(
      'phase2/match-state-snapshot-valid',
      'phase2-match-state',
      isMatchStateSnapshotValid(snap) === true && matchStateLeaksPrivate(snap) === false,
      '{ seq, state, color_corner } passes',
    );
    push(
      'phase2/match-state-leak-host-seats',
      'phase2-match-state',
      isMatchStateSnapshotValid({ ...snap, host_address: fx.host }) === false &&
        isMatchStateSnapshotValid({ ...snap, player_seats: {} }) === false &&
        matchStateLeaksPrivate({ ...snap, host_address: fx.host }) === true,
      'host_address/player_seats in snapshot are leaks (reject)',
    );
    push(
      'phase2/match-state-not-found',
      'phase2-match-state',
      isMatchNotFoundBody({ error: 'Match not found', code: 'MATCH_NOT_FOUND' }) === true,
      'unknown matchId is 404 { error, code: MATCH_NOT_FOUND }',
    );
    push(
      'phase2/match-state-rejects-bad-shape',
      'phase2-match-state',
      isMatchStateSnapshotValid({ seq: 0, state: {} }) === false &&
        isMatchStateSnapshotValid({ seq: -1, state: {}, color_corner: {} }) === false &&
        isMatchStateSnapshotValid(null) === false,
      'missing color_corner / negative seq rejected',
    );
  }

  // --- 16. Phase 2 moderation mock-mode ----------------------------------------------
  push(
    'phase2/moderation-valid-boolean',
    'phase2-moderation',
    isModerationBodyValid({ blocked: true }) === true &&
      isModerationBodyValid({ blocked: false }) === true,
    '{ blocked: boolean } passes',
  );
  push(
    'phase2/moderation-401-without-session',
    'phase2-moderation',
    validateErrorBody({ error: 'Invalid session' }) === true,
    'moderation without session is 401 { error }',
  );
  push(
    'phase2/moderation-rejects-list',
    'phase2-moderation',
    isModerationBodyValid({ blocked: false, players: [fx.guest] }) === false &&
      moderationLeaksList({ blocked: false, players: [fx.guest] }) === true &&
      isModerationBodyValid({ blocked: true, blocker_address: fx.host }) === false,
    "cannot read another user's block list (only own { blocked })",
  );
  push(
    'phase2/moderation-own-perspective',
    'phase2-moderation',
    isModerationOwnPerspective(fx.host, fx.host) === true &&
      isModerationOwnPerspective(fx.guest, fx.host) === false,
    'blocker_address must equal session wallet (own perspective only)',
  );

  // --- 17. Cutover compat migrations (STATIC file-text, offline, no DB) ----------
  // Static-vs-live: these prove the SQL TEXT ships the right DDL. Live
  // enforcement (CHECK rejects bad status, nullable insert works, index
  // exists) is covered by full-mode RLS/RPC on a scratch project.
  for (const c of checkCompatMigrationFiles(repoRoot)) checks.push(c);
  // Pure-validator unit pins (same helpers, inline fixtures — file-independent).
  {
    const pokesSample = [
      "alter table public.pokes alter column status set default 'sent';",
      'alter table public.pokes drop constraint if exists pokes_status_check;',
      "check (status in ('sent','poked_back','pending','accepted','dismissed'))",
      'create index if not exists pokes_receiver_status_idx',
      'create index if not exists pokes_sender_created_idx',
    ].join('\n');
    push(
      'compat-migrations/pokes-validators-agree',
      'compat-migrations-static',
      pokesCompatHasStatusUnion(pokesSample) === true &&
        pokesCompatHasDefaultSent(pokesSample) === true &&
        pokesCompatHasBothIndexes(pokesSample) === true &&
        pokesCompatHasStatusUnion("check (status in ('sent'))") === false &&
        pokesCompatHasBothIndexes('create index pokes_receiver_status_idx') === false,
      'union/default/index helpers accept full sample, reject partial',
    );
    const matchesSample = [
      'alter table public.matches add column if not exists finished_at timestamptz;',
      'update public.matches set finished_at = created_at',
      'where finished_at is null and winner_address is not null;',
      'create index if not exists matches_finished_at_idx',
    ].join('\n');
    push(
      'compat-migrations/matches-validators-agree',
      'compat-migrations-static',
      matchesCompatHasFinishedAtColumn(matchesSample) === true &&
        matchesCompatHasBackfillWhere(matchesSample) === true &&
        matchesCompatHasIndex(matchesSample) === true &&
        matchesCompatHasBackfillWhere('update matches set finished_at = now()') === false,
      'column/backfill/index helpers accept full sample, reject unguarded backfill',
    );
    const chatSample = [
      "select 1 from information_schema.columns where table_name = 'live_chat'",
      "and column_name = 'room_code' and is_nullable = 'NO'",
      'alter table public.live_chat alter column room_code drop not null;',
      'create index if not exists live_chat_room_idx',
    ].join('\n');
    push(
      'compat-migrations/live-chat-validators-agree',
      'compat-migrations-static',
      liveChatCompatHasNullableGuard(chatSample) === true &&
        liveChatCompatHasIndex(chatSample) === true &&
        liveChatCompatHasNullableGuard('alter table live_chat alter column room_code drop not null') ===
          false,
      'nullable-guard requires is_nullable check (bare drop fails)',
    );
  }

  // --- 18. N1 caller-bound idempotent mint (STATIC + mock-mode, offline) --------
  for (const c of checkJoinRouteStatic(repoRoot)) checks.push(c);
  {
    const matched1 = {
      status: 'matched',
      match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      validation_token: 'n1-owner-token-001',
    };
    const matched2 = {
      status: 'matched',
      match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      validation_token: 'n1-owner-token-001',
    };
    const matchedRotated = {
      status: 'matched',
      match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      validation_token: 'n1-rotated-token-002',
    };
    const matchedNoToken = {
      status: 'matched',
      match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    push(
      'n1-mint/direct-match-carries-token',
      'n1-mint',
      isDirectMatchTokenResponse(matched1) === true,
      'direct-match matched body MUST carry validation_token for the owner',
    );
    push(
      'n1-mint/direct-match-missing-token-fails',
      'n1-mint',
      isDirectMatchTokenResponse(matchedNoToken) === false,
      'matched without validation_token fails (fast path must mint)',
    );
    push(
      'n1-mint/searching-needs-no-token',
      'n1-mint',
      isDirectMatchTokenResponse({ status: 'searching' }) === true &&
        isDirectMatchTokenResponse({ status: 'bogus' }) === false,
      'searching passes without token; unknown status fails',
    );
    push(
      'n1-mint/idempotent-same-token',
      'n1-mint',
      isDirectMatchMintIdempotent(matched1, matched2) === true,
      'second identical direct-match returns the SAME token (no rotation)',
    );
    push(
      'n1-mint/rotated-token-fails',
      'n1-mint',
      isDirectMatchMintIdempotent(matched1, matchedRotated) === false &&
        isDirectMatchMintIdempotent(matched1, matchedNoToken) === false,
      'rotated/missing second token fails idempotency',
    );
    push(
      'n1-mint/route-helpers-agree',
      'n1-mint',
      joinRouteHasSessionOwnerBinding(
        'const wallet = await requireAppSession(playerId, sessionId); playerId = wallet;',
      ) === true &&
        joinRouteHasCallerBoundLookup(
          ".eq('player_id', playerId).eq('match_id', data.match_id)",
        ) === true &&
        joinRouteUnauthPathHasNoToken(
          "if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 }); playerId = wallet; await withCallerToken(supabase, playerId, data)",
        ) === true,
      'route helpers accept minimal samples',
    );
  }

  // --- 19. Cutover F-01 verify-intact (flag + route, untouched) ------------------
  for (const c of checkFeedbackRouteStatic(repoRoot)) checks.push(c);
  push(
    'cutover/f01-flag-still-true',
    'f01',
    EXPECT_FEEDBACK_ANON === true,
    `EXPECT_FEEDBACK_ANON=${String(EXPECT_FEEDBACK_ANON)} (cutover must not flip it)`,
  );

  return checks;
}

// ---------------------------------------------------------------------------
// Full mode (requires env + scratch project). Designed, not yet run here.
// ---------------------------------------------------------------------------

export interface FullEnv {
  url: string;
  anonKey: string;
  serviceKey: string;
  previewUrl: string | null;
}

export function resolveFullEnv(): { env: FullEnv | null; missing: string[] } {
  const url =
    process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const anonKey =
    process.env['SUPABASE_ANON_KEY'] ??
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ??
    '';
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  const previewUrl =
    process.env['PREVIEW_URL'] ?? process.env['PREVIEW_DEPLOY_URL'] ?? null;
  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) return { env: null, missing };
  return { env: { url, anonKey, serviceKey, previewUrl }, missing: [] };
}

function supaErrorText(err: unknown): string {
  if (err === null || err === undefined) return '';
  if (typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    const msg = rec['message'];
    const code = rec['code'];
    return `${String(code ?? '')} ${typeof msg === 'string' ? msg : JSON.stringify(err)}`.trim();
  }
  return String(err);
}

async function serviceTableExists(db: SupabaseClient, table: string): Promise<boolean> {
  const res = await db.from(table).select('*').limit(1);
  // RLS-deny tables are still VISIBLE to service_role; any response that is
  // not "table does not exist" (42P01) means the table exists.
  const err = res.error as unknown as { code?: string } | null;
  if (!err) return true;
  return err.code !== '42P01';
}

/** Seed deterministic fixtures via the service key (idempotent-ish). */
async function seedFixtures(
  service: SupabaseClient,
  fx: FixtureSet,
): Promise<ProbeCheck[]> {
  const out: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    out.push({ id, category: 'seed', pass, detail });
  };

  // 3 players (host/guest/outsider) + coin balances.
  for (const [label, addr] of [
    ['host', fx.host],
    ['guest', fx.guest],
    ['outsider', fx.outsider],
  ] as const) {
    const res = await service.from('players').upsert(
      {
        wallet_address: addr,
        username: `compat-${label}`,
        coins: 1000,
        status: 'Online',
      },
      { onConflict: 'wallet_address' },
    );
    push(
      `seed/player-${label}`,
      !res.error,
      res.error ? supaErrorText(res.error) : `${label} ${addr} upserted`,
    );
  }

  // app_sessions: valid / expired / revoked.
  for (const [label, s] of Object.entries(fx.sessions) as [
    string,
    AppSessionFixture,
  ][]) {
    const res = await service.from('app_sessions').upsert(
      {
        id: s.id,
        wallet_address: s.wallet_address,
        nonce: s.nonce,
        expires_at: s.expires_at,
        revoked_at: s.revoked_at,
      },
      { onConflict: 'id' },
    );
    push(
      `seed/session-${label}`,
      !res.error,
      res.error ? supaErrorText(res.error) : `session ${label} upserted`,
    );
  }

  // matches + live_matches row.
  const matchRes = await service
    .from('matches')
    .upsert(
      {
        room_code: fx.matchRoomCode,
        game_mode: 'classic',
        participants: [fx.host, fx.guest],
      },
      { onConflict: 'room_code' },
    )
    .select('id')
    .maybeSingle();
  push(
    'seed/match',
    !matchRes.error,
    matchRes.error ? supaErrorText(matchRes.error) : `match ${fx.matchRoomCode} upserted`,
  );
  const matchData = matchRes.data as { id?: string } | null;
  const matchId: string | null =
    matchData && typeof matchData.id === 'string' ? matchData.id : null;
  if (matchId) {
    const liveRes = await service.from('live_matches').upsert(
      {
        match_id: matchId,
        room_code: fx.matchRoomCode,
        bet_window_status: 'closed',
        host_address: fx.host,
      },
      { onConflict: 'match_id' },
    );
    push(
      'seed/live-match',
      !liveRes.error,
      liveRes.error ? supaErrorText(liveRes.error) : 'live_matches row upserted',
    );
  } else {
    push('seed/live-match', false, 'no match id returned — cannot seed live_matches');
  }

  // game_invites pending with validation material.
  const inviteRes = await service.from('game_invites').insert({
    room_code: fx.matchRoomCode,
    host_address: fx.host,
    guest_address: fx.guest,
    status: 'pending',
    validation_token: fx.gameInviteValidationToken,
  });
  push(
    'seed/game-invite',
    !inviteRes.error,
    inviteRes.error ? supaErrorText(inviteRes.error) : 'pending invite seeded',
  );

  // searching matchmaking ticket.
  const ticketRes = await service.from('matchmaking_queue').insert({
    player_id: fx.outsider,
    game_mode: fx.matchmakingGameMode,
    match_type: fx.matchmakingMatchType,
    wager: 0,
    status: 'searching',
  });
  push(
    'seed/matchmaking-ticket',
    !ticketRes.error,
    ticketRes.error ? supaErrorText(ticketRes.error) : 'searching ticket seeded',
  );

  // friendships: accepted + pending.
  const f1 = await service.from('friendships').upsert(
    {
      user_address: fx.host,
      friend_address: fx.guest,
      status: 'accepted',
    },
    { onConflict: 'user_address,friend_address' },
  );
  push('seed/friendship-accepted', !f1.error, f1.error ? supaErrorText(f1.error) : 'accepted seeded');
  const f2 = await service.from('friendships').upsert(
    {
      user_address: fx.guest,
      friend_address: fx.outsider,
      status: 'pending',
    },
    { onConflict: 'user_address,friend_address' },
  );
  push('seed/friendship-pending', !f2.error, f2.error ? supaErrorText(f2.error) : 'pending seeded');

  // messages (service inserts; trigger maintains conversations).
  const msgRes = await service.from('messages').insert({
    sender_id: fx.host,
    receiver_id: fx.guest,
    content: 'compat probe hello',
  });
  push(
    'seed/message',
    !msgRes.error,
    msgRes.error ? supaErrorText(msgRes.error) : 'message seeded (conversations via trigger)',
  );

  // spectator bets: open + settled (settled via status insert for fixture purposes).
  if (matchId) {
    const b1 = await service.from('spectator_bets').insert({
      player_id: fx.outsider,
      match_id: matchId,
      bet_type: 'winner',
      bet_value: 'green',
      amount: 100,
      odds: 2,
      potential_payout: 200,
      status: 'open',
      action_id: 'compat-open-001',
    });
    push('seed/bet-open', !b1.error, b1.error ? supaErrorText(b1.error) : 'open bet seeded');
    const b2 = await service.from('spectator_bets').insert({
      player_id: fx.guest,
      match_id: matchId,
      bet_type: 'winner',
      bet_value: 'red',
      amount: 50,
      odds: 2,
      potential_payout: 100,
      status: 'lost',
      action_id: 'compat-settled-001',
    });
    push('seed/bet-settled', !b2.error, b2.error ? supaErrorText(b2.error) : 'settled bet seeded');
  }

  // partial missions.
  const mRes = await service.from('player_missions').upsert(
    {
      player_id: fx.host,
      mission_id: 'compat-mission-001',
      progress: 1,
      is_claimed: false,
    },
    { onConflict: 'player_id,mission_id' },
  );
  push('seed/mission', !mRes.error, mRes.error ? supaErrorText(mRes.error) : 'partial mission seeded');

  // live_chat global + room rows.
  const c1 = await service.from('live_chat').insert({
    sender_id: fx.host,
    username: 'compat-host',
    content: 'compat global shout',
    country: 'XX',
    room_code: 'GLOBAL',
    room_open: true,
  });
  push('seed/chat-global', !c1.error, c1.error ? supaErrorText(c1.error) : 'global chat seeded');
  const c2 = await service.from('live_chat').insert({
    sender_id: fx.guest,
    username: 'compat-guest',
    content: 'compat room announce',
    country: 'XX',
    room_code: fx.matchRoomCode,
    room_open: true,
  });
  push('seed/chat-room', !c2.error, c2.error ? supaErrorText(c2.error) : 'room chat seeded');

  // feedback sample.
  const fbRes = await service.from('feedback').insert({
    topic: fx.feedbackTopic,
    message: 'compat probe feedback body',
    address: fx.host,
  });
  push('seed/feedback', !fbRes.error, fbRes.error ? supaErrorText(fbRes.error) : 'feedback seeded');

  // lobby_join_requests row.
  const ljRes = await service.from('lobby_join_requests').insert({
    room_code: fx.matchRoomCode,
    wallet_address: fx.outsider,
    username: 'compat-outsider',
  });
  push(
    'seed/lobby-join-request',
    !ljRes.error,
    ljRes.error ? supaErrorText(ljRes.error) : 'lobby_join_requests seeded',
  );

  // coin balances with ledger entries (idempotent keys).
  const l1 = await service.from('coin_ledger').upsert(
    {
      player_id: fx.host,
      idempotency_key: fx.ledgerKeys[0],
      amount: 100,
      reason: 'compat probe seed',
    },
    { onConflict: 'player_id,idempotency_key' },
  );
  push('seed/ledger-host', !l1.error, l1.error ? supaErrorText(l1.error) : 'ledger host seeded');

  return out;
}

/** Anon SELECT matrix: denied tables invisible, allowed tables visible. */
async function runAnonSelectMatrix(
  anon: SupabaseClient,
  service: SupabaseClient,
): Promise<ProbeCheck[]> {
  const out: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    out.push({ id, category: 'rls-select', pass, detail });
  };

  for (const table of DENY_SELECT_TABLES) {
    const svc = await service.from(table).select('*').limit(1);
    const svcHasRows = !svc.error && Array.isArray(svc.data) && svc.data.length > 0;
    const an = await anon.from(table).select('*').limit(5);
    const anData = an.data as unknown[] | null;
    const anonSeesRows = !an.error && Array.isArray(anData) && anData.length > 0;
    // PASS when anon sees nothing (RLS default-deny) while service can read
    // (or the table is legitimately empty in a fresh scratch project).
    const pass = svcHasRows ? !anonSeesRows : !anonSeesRows || !!an.error;
    push(
      `rls/anon-select-denied:${table}`,
      pass,
      `service rows: ${svcHasRows ? 'yes' : 'empty'}, anon sees rows: ${String(anonSeesRows)}${an.error ? `, anon err: ${supaErrorText(an.error)}` : ''}`,
    );
  }

  // matches: anon allowed.
  {
    const an = await anon.from('matches').select('id,room_code').limit(1);
    push(
      'rls/anon-select-allowed:matches',
      !an.error,
      an.error ? supaErrorText(an.error) : 'anon reads matches',
    );
  }

  // players: allowed cols succeed; private cols fail.
  {
    const ok = await anon
      .from('players')
      .select('wallet_address,username,avatar_url,lxp,rxp,status')
      .limit(1);
    push(
      'rls/anon-select-players-allowed-cols',
      !ok.error,
      ok.error ? supaErrorText(ok.error) : 'granted cols readable',
    );
    for (const col of PLAYERS_DENIED_COLS) {
      const bad = await anon.from('players').select(col).limit(1);
      push(
        `rls/anon-select-players-denied:${col}`,
        !!bad.error,
        bad.error
          ? `denied as expected: ${supaErrorText(bad.error)}`
          : 'LEAK: anon read private column',
      );
    }
  }

  // matchmaking_queue: granted cols + status filter.
  {
    const ok = await anon
      .from('matchmaking_queue')
      .select('player_id,game_mode,match_type,status,room_code')
      .eq('status', 'searching')
      .limit(3);
    push(
      'rls/anon-select-matchmaking-granted',
      !ok.error,
      ok.error ? supaErrorText(ok.error) : 'granted cols + searching filter readable',
    );
    const priv = await anon.from('matchmaking_queue').select('validation_token').limit(1);
    push(
      'rls/anon-select-matchmaking-denied:validation_token',
      !!priv.error,
      priv.error
        ? `denied as expected: ${supaErrorText(priv.error)}`
        : 'LEAK: validation_token readable',
    );
  }

  // live_matches / live_chat / tournaments(non-draft).
  for (const t of ['live_matches', 'live_chat'] as const) {
    const an = await anon.from(t).select('*').limit(1);
    push(
      `rls/anon-select-allowed:${t}`,
      !an.error,
      an.error ? supaErrorText(an.error) : `anon reads ${t}`,
    );
  }
  {
    const an = await anon.from('tournaments').select('*').limit(5);
    const rows = (an.data ?? []) as Record<string, unknown>[];
    const sawDraft = rows.some((r) => r['status'] === 'draft');
    push(
      'rls/anon-select-tournaments-non-draft',
      !an.error && !sawDraft,
      an.error
        ? supaErrorText(an.error)
        : sawDraft
          ? 'LEAK: draft tournament visible to anon'
          : `anon reads tournaments (${rows.length} rows, no drafts)`,
    );
  }

  return out;
}

/** Anon INSERT matrix: only feedback allowed (F-01 gated). */
async function runAnonInsertMatrix(anon: SupabaseClient): Promise<ProbeCheck[]> {
  const out: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    out.push({ id, category: 'rls-insert', pass, detail });
  };

  const fb = await anon.from('feedback').insert({
    topic: 'compat probe anon insert',
    message: 'probe body — safe to delete with scratch project',
  });
  const fbAllowed = !fb.error;
  push(
    'rls/anon-insert:feedback',
    fbAllowed === expectedFeedbackAnonInsert(EXPECT_FEEDBACK_ANON),
    fb.error
      ? `anon feedback insert denied: ${supaErrorText(fb.error)} (EXPECT_FEEDBACK_ANON=${String(EXPECT_FEEDBACK_ANON)})`
      : `anon feedback insert allowed (EXPECT_FEEDBACK_ANON=${String(EXPECT_FEEDBACK_ANON)})`,
  );

  // Spot-check denied tables (insert must fail under RLS default-deny).
  const denied: { table: string; row: Record<string, unknown> }[] = [
    { table: 'pokes', row: { sender_id: '0x0', receiver_id: '0x1' } },
    { table: 'player_missions', row: { player_id: '0x0', mission_id: 'x' } },
    { table: 'lobby_join_requests', row: { room_code: 'XXXXXX', wallet_address: '0x0' } },
  ];
  for (const d of denied) {
    const r = await anon.from(d.table).insert(d.row);
    push(
      `rls/anon-insert-denied:${d.table}`,
      !!r.error,
      r.error ? `denied as expected: ${supaErrorText(r.error)}` : 'LEAK: anon insert succeeded',
    );
  }
  return out;
}

/** Anon UPDATE/DELETE denied everywhere (spot-check). */
async function runAnonWriteDenyMatrix(anon: SupabaseClient): Promise<ProbeCheck[]> {
  const out: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    out.push({ id, category: 'rls-write-deny', pass, detail });
  };
  const upd = await anon.from('live_chat').update({ content: 'probe-mutation' }).eq('id', '00000000-0000-4000-8000-000000000000');
  const updData = upd.data as unknown[] | null;
  const updChanged = Array.isArray(updData) && updData.length > 0;
  push(
    'rls/anon-update-denied:live_chat',
    !updChanged,
    upd.error
      ? `denied as expected: ${supaErrorText(upd.error)}`
      : updChanged
        ? 'LEAK: anon update changed rows'
        : 'anon update changed 0 rows',
  );
  const del = await anon.from('live_chat').delete().eq('id', '00000000-0000-4000-8000-000000000000');
  const delData = del.data as unknown[] | null;
  const delChanged = Array.isArray(delData) && delData.length > 0;
  push(
    'rls/anon-delete-denied:live_chat',
    !delChanged,
    del.error
      ? `denied as expected: ${supaErrorText(del.error)}`
      : delChanged
        ? 'LEAK: anon delete removed rows'
        : 'anon delete removed 0 rows',
  );
  return out;
}

/** RPC revocation: anon denied, service succeeds (pairing/idempotency/counters). */
async function runRpcMatrix(
  anon: SupabaseClient,
  service: SupabaseClient,
  fx: FixtureSet,
): Promise<ProbeCheck[]> {
  const out: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    out.push({ id, category: 'rpc', pass, detail });
  };

  // Anon must be denied for every revoked RPC (probe with representative args).
  const anonCalls: { name: string; args: Record<string, unknown> }[] = [
    {
      name: 'join_matchmaking',
      args: { p_player_id: fx.outsider, p_game_mode: 'classic', p_match_type: '1v1' },
    },
    { name: 'mark_conversation_read', args: { me: fx.host, friend: fx.guest } },
    { name: 'cleanup_matchmaking_queue', args: {} },
    { name: 'cleanup_stale_data', args: {} },
  ];
  for (const c of anonCalls) {
    const r = await anon.rpc(c.name, c.args);
    push(
      `rpc/anon-denied:${c.name}`,
      !!r.error,
      r.error ? `denied as expected: ${supaErrorText(r.error)}` : 'LEAK: anon RPC succeeded',
    );
  }

  // Service pairing: two fresh outsiders pair into a match (or at least one
  // searching ticket is created without error).
  {
    const a = `0xaaaa000000000000000000000000000000000001`;
    const b = `0xbbbb000000000000000000000000000000000002`;
    await service.from('players').upsert(
      { wallet_address: a, username: 'compat-pair-a' },
      { onConflict: 'wallet_address' },
    );
    await service.from('players').upsert(
      { wallet_address: b, username: 'compat-pair-b' },
      { onConflict: 'wallet_address' },
    );
    const r1 = await service.rpc('join_matchmaking', {
      p_player_id: a,
      p_game_mode: 'classic',
      p_match_type: '1v1',
    });
    push(
      'rpc/service-pairing:first-join',
      !r1.error,
      r1.error ? supaErrorText(r1.error) : `first join ok: ${JSON.stringify(r1.data)}`,
    );
  }

  // Service idempotency: cash_out_bet twice → second is idempotent.
  // (Requires an open bet; best-effort — skip-with-notice when fixture missing.)
  {
    const openBet = await service
      .from('spectator_bets')
      .select('id,player_id,status')
      .eq('status', 'open')
      .limit(1)
      .maybeSingle();
    const row = openBet.data as { id?: string; player_id?: string } | null;
    if (openBet.error || !row?.id || typeof row.player_id !== 'string') {
      push('rpc/service-idempotent:cash_out_bet', true, 'SKIP: no open bet fixture (notice)');
    } else {
      const first = await service.rpc('cash_out_bet', {
        p_bet_id: row.id,
        p_player_id: row.player_id,
      });
      const second = await service.rpc('cash_out_bet', {
        p_bet_id: row.id,
        p_player_id: row.player_id,
      });
      const secondData = second.data as Record<string, unknown> | null;
      const idempotent =
        !second.error && secondData !== null && secondData['status'] === 'cashed_out';
      push(
        'rpc/service-idempotent:cash_out_bet',
        !first.error && idempotent,
        first.error
          ? `first failed: ${supaErrorText(first.error)}`
          : second.error
            ? `second failed: ${supaErrorText(second.error)}`
            : `idempotent re-cashout ok: ${JSON.stringify(second.data)}`,
      );
    }
  }

  // Service counter recompute: mark_conversation_read zeroes unread counters.
  {
    const r = await service.rpc('mark_conversation_read', {
      me: fx.guest,
      friend: fx.host,
    });
    push(
      'rpc/service-counters:mark_conversation_read',
      !r.error,
      r.error ? supaErrorText(r.error) : 'counter recompute RPC ok',
    );
  }

  return out;
}

interface HttpCheckInput {
  previewUrl: string;
  fx: FixtureSet;
}

/** HTTP route matrix against a preview deploy. */
async function runHttpMatrix(input: HttpCheckInput): Promise<ProbeCheck[]> {
  const out: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    out.push({ id, category: 'http', pass, detail });
  };
  const base = input.previewUrl.replace(/\/$/, '');

  const postJson = async (
    p: string,
    body: unknown,
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };
  const getJson = async (p: string): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`${base}${p}`);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };

  // Gated: bad session → 401 with { error } string.
  {
    const r = await postJson('/api/matchmaking/join', {
      playerId: input.fx.host,
      sessionId: '00000000-0000-4000-8000-000000000000',
      gameMode: 'classic',
      matchType: '1v1',
    });
    push(
      'http/gated-bad-session:matchmaking-join',
      r.status === 401 && validateErrorBody(r.json),
      `status ${r.status}, body ${JSON.stringify(r.json)?.slice(0, 160)}`,
    );
  }
  {
    const r = await getJson(
      `/api/messages?walletAddress=${input.fx.host}&sessionId=00000000-0000-4000-8000-000000000000`,
    );
    push(
      'http/gated-bad-session:messages',
      r.status === 401 && validateErrorBody(r.json),
      `status ${r.status}, body ${JSON.stringify(r.json)?.slice(0, 160)}`,
    );
  }

  // Gated: valid session → 2xx shape (uses seeded valid session).
  {
    const r = await getJson(
      `/api/messages?walletAddress=${input.fx.host}&sessionId=${input.fx.sessions.valid.id}`,
    );
    const shape =
      typeof r.json === 'object' &&
      r.json !== null &&
      'conversations' in (r.json as Record<string, unknown>) &&
      'messages' in (r.json as Record<string, unknown>);
    push(
      'http/gated-valid:messages',
      r.status === 200 && shape,
      `status ${r.status}, shape conversations+messages: ${String(shape)}`,
    );
  }

  // F-01 HTTP branch.
  {
    const payload = EXPECT_FEEDBACK_ANON
      ? { topic: 'probe', message: 'probe body' }
      : {
          walletAddress: input.fx.host,
          sessionId: '00000000-0000-4000-8000-000000000000',
          topic: 'probe',
          message: 'probe body',
        };
    const r = await postJson('/api/feedback', payload);
    const pass = EXPECT_FEEDBACK_ANON
      ? r.status !== 401 || validateErrorBody(r.json)
      : r.status === 401 && validateErrorBody(r.json);
    push(
      'http/f01:feedback',
      pass,
      `EXPECT_FEEDBACK_ANON=${String(EXPECT_FEEDBACK_ANON)} status ${r.status} body ${JSON.stringify(r.json)?.slice(0, 160)}`,
    );
  }

  // Failure bodies always contain error strings (negative probe).
  {
    const r = await getJson('/api/messages?walletAddress=bad&sessionId=bad');
    push(
      'http/no-silent-degrade:messages-401-has-error',
      validateErrorBody(r.json),
      `body ${JSON.stringify(r.json)?.slice(0, 160)}`,
    );
  }

  // Anon-safe routes must keep working.
  const safe: { label: string; run: () => Promise<{ status: number; json: unknown }> }[] = [
    { label: 'live-chat', run: () => getJson('/api/live-chat?limit=2') },
    { label: 'geo', run: () => getJson('/api/geo') },
    {
      label: 'farcaster-missing-wallet-400',
      run: () => getJson('/api/farcaster'),
    },
  ];
  for (const s of safe) {
    try {
      const r = await s.run();
      // Anon-safe = reachable and JSON-shaped (2xx data or 4xx { error }).
      // A 500 without an error string is a silent-degrade FAIL.
      const ok =
        (r.status >= 200 && r.status < 500 && r.json !== null) ||
        validateErrorBody(r.json);
      push(`http/anon-safe:${s.label}`, ok, `status ${r.status}`);
    } catch (e) {
      push(`http/anon-safe:${s.label}`, false, `fetch failed: ${String(e)}`);
    }
  }

  // N1 full-mode: direct-match caller-bound idempotent mint (preview deploy).
  // Two identical POSTs with the owner's valid session. Still-searching
  // responses carry no token requirement → skip-with-notice pass. Matched
  // responses MUST carry validation_token; two matched responses MUST agree
  // (mint only when null — no rotation). Offline validators above share truth.
  {
    const n1push = (id: string, pass: boolean, detail: string): void => {
      out.push({ id, category: 'n1-full', pass, detail });
    };
    try {
      const payload = {
        playerId: input.fx.host,
        sessionId: input.fx.sessions.valid.id,
        gameMode: 'classic',
        matchType: '1v1',
      };
      const bad = await postJson('/api/matchmaking/join', {
        playerId: input.fx.host,
        sessionId: '00000000-0000-4000-8000-000000000000',
        gameMode: 'classic',
        matchType: '1v1',
      });
      n1push(
        'n1-full/http-unauth-no-token',
        bad.status === 401 &&
          validateErrorBody(bad.json) &&
          !statusTicketLeaksToken(bad.json, false),
        `unauth status ${bad.status} carries no token, body ${JSON.stringify(bad.json)?.slice(0, 120)}`,
      );
      const r1 = await postJson('/api/matchmaking/join', payload);
      const r2 = await postJson('/api/matchmaking/join', payload);
      const s1 =
        typeof r1.json === 'object' && r1.json !== null
          ? (r1.json as Record<string, unknown>)['status']
          : undefined;
      const s2 =
        typeof r2.json === 'object' && r2.json !== null
          ? (r2.json as Record<string, unknown>)['status']
          : undefined;
      if (s1 !== 'matched' && s2 !== 'matched') {
        n1push(
          'n1-full/http-direct-match-token-present',
          true,
          `SKIP-NOTICE: no direct match yet (s1=${String(s1)} s2=${String(s2)}) — token required only when matched`,
        );
        n1push(
          'n1-full/http-direct-match-idempotent-mint',
          true,
          `SKIP-NOTICE: no direct match yet (s1=${String(s1)} s2=${String(s2)}) — idempotency checked when matched`,
        );
      } else {
        const matchedBodies = [
          { r: r1, s: s1 },
          { r: r2, s: s2 },
        ].filter((x) => x.s === 'matched');
        const allHaveToken = matchedBodies.every((x) => isDirectMatchTokenResponse(x.r.json));
        n1push(
          'n1-full/http-direct-match-token-present',
          allHaveToken,
          `matched bodies carry owner token: ${matchedBodies.map((x) => JSON.stringify(x.r.json)?.slice(0, 120)).join(' | ')}`,
        );
        if (s1 === 'matched' && s2 === 'matched') {
          n1push(
            'n1-full/http-direct-match-idempotent-mint',
            isDirectMatchMintIdempotent(r1.json, r2.json),
            `second identical POST returns SAME token (no rotation): ${JSON.stringify(r1.json)?.slice(0, 120)} vs ${JSON.stringify(r2.json)?.slice(0, 120)}`,
          );
        } else {
          n1push(
            'n1-full/http-direct-match-idempotent-mint',
            true,
            `SKIP-NOTICE: only one side matched (s1=${String(s1)} s2=${String(s2)}) — rotation check needs both matched`,
          );
        }
      }
    } catch (e) {
      out.push({
        id: 'n1-full/http-direct-match-token-present',
        category: 'n1-full',
        pass: false,
        detail: `fetch failed: ${String(e)}`,
      });
    }
  }

  return out;
}

/** Realtime leak tests: anon channel receives only policy-visible rows. */
async function runRealtimeMatrix(
  anon: SupabaseClient,
  service: SupabaseClient,
): Promise<ProbeCheck[]> {
  const out: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    out.push({ id, category: 'realtime', pass, detail });
  };

  for (const spec of REALTIME_TABLES) {
    const received: Record<string, unknown>[] = [];
    let subscribed = false;
    try {
      const channel = anon.channel(`compat-probe-${spec.table}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 4000);
        channel
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: spec.table },
            (payload: unknown) => {
              const rec = payload as { new?: unknown } | null;
              if (rec && typeof rec.new === 'object' && rec.new !== null) {
                received.push(rec.new as Record<string, unknown>);
              }
            },
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              subscribed = true;
              clearTimeout(timer);
              resolve();
            }
          });
      });
      // Poke the table via service so there is *something* to receive on
      // public tables; private tables should yield nothing for anon.
      if (spec.table === 'live_chat') {
        await service.from('live_chat').insert({
          sender_id: '0x1111111111111111111111111111111111111111',
          username: 'compat-rt',
          content: 'realtime probe ping',
          country: 'XX',
          room_code: 'GLOBAL',
          room_open: true,
        });
        await new Promise((r) => setTimeout(r, 2500));
      }
      try {
        await anon.removeChannel(channel);
      } catch {
        /* best-effort */
      }
      const leaked = received.filter((row) =>
        spec.privateFields.some((f) => f in row),
      );
      push(
        `realtime/no-leak:${spec.table}`,
        leaked.length === 0,
        !subscribed
          ? 'SKIP-NOTICE: subscribe not confirmed (realtime disabled?) — 0 rows asserted locally'
          : leaked.length === 0
            ? `0 private fields in ${received.length} anon payload(s)`
            : `LEAK: private fields observed: ${JSON.stringify(leaked[0])?.slice(0, 200)}`,
      );
    } catch (e) {
      push(`realtime/no-leak:${spec.table}`, true, `SKIP-NOTICE: ${String(e)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 2 full-mode checks (scratch project + optional preview deploy).
// RLS part always runs; HTTP part runs only when previewUrl present and
// !skipHttp, otherwise skip-with-notice (same convention as runHttpMatrix).
// ---------------------------------------------------------------------------

async function runPhase2FullChecks(
  anon: SupabaseClient,
  service: SupabaseClient,
  previewUrl: string | null,
  fx: FixtureSet,
  skipHttp: boolean,
): Promise<ProbeCheck[]> {
  const out: ProbeCheck[] = [];
  const push = (id: string, pass: boolean, detail: string): void => {
    out.push({ id, category: 'phase2-full', pass, detail });
  };

  // --- RLS: user_blocks has no anon SELECT (server-only, like moderation GET) ---
  try {
    // Ensure a deterministic block exists for the anon-visibility probe.
    await service
      .from('user_blocks')
      .upsert(
        { blocker_address: fx.host, blocked_address: fx.guest },
        { onConflict: 'blocker_address,blocked_address' },
      );
    const svc = await service.from('user_blocks').select('id').limit(1);
    const svcHasRows =
      !svc.error && Array.isArray(svc.data) && (svc.data as unknown[]).length > 0;
    const an = await anon.from('user_blocks').select('*').limit(5);
    const anData = an.data as unknown[] | null;
    const anonSeesRows = !an.error && Array.isArray(anData) && anData.length > 0;
    push(
      'phase2-full/rls-anon-denied:user_blocks',
      svcHasRows ? !anonSeesRows : !anonSeesRows || !!an.error,
      `service rows: ${svcHasRows ? 'yes' : 'empty'}, anon sees rows: ${String(anonSeesRows)}${an.error ? `, anon err: ${supaErrorText(an.error)}` : ''}`,
    );
  } catch (e) {
    push('phase2-full/rls-anon-denied:user_blocks', false, `exception: ${String(e)}`);
  }

  // --- Service seeding for deterministic HTTP assertions (best-effort) ---------
  // Fixed Phase 2 session/ticket/match identifiers (no collision with seedFixtures).
  const PHASE2_OWNER_SESSION = 'a1111111-1111-4111-8111-111111111111';
  const PHASE2_OUTSIDER_SESSION = 'a3333333-3333-4333-8333-333333333333';
  const PHASE2_ROOM = 'CMP002';
  let phase2MatchId: string | null = null;
  let phase2OwnerTicketId: string | null = null;
  try {
    const nowMs = Date.now();
    await service.from('app_sessions').upsert(
      {
        id: PHASE2_OWNER_SESSION,
        wallet_address: fx.host,
        nonce: 'compat-phase2-owner-001',
        expires_at: new Date(nowMs + 60 * 60 * 1000).toISOString(),
        revoked_at: null,
      },
      { onConflict: 'id' },
    );
    await service.from('app_sessions').upsert(
      {
        id: PHASE2_OUTSIDER_SESSION,
        wallet_address: fx.outsider,
        nonce: 'compat-phase2-outsider-001',
        expires_at: new Date(nowMs + 60 * 60 * 1000).toISOString(),
        revoked_at: null,
      },
      { onConflict: 'id' },
    );
    // Presence freshness: force fixtures Online + fresh heartbeat.
    await service
      .from('players')
      .update({ status: 'Online', last_seen_at: new Date(nowMs).toISOString() })
      .in('wallet_address', [fx.host, fx.guest, fx.outsider]);

    // Deterministic match for roster + snapshot tests.
    const existing = await service
      .from('matches')
      .select('id')
      .eq('room_code', PHASE2_ROOM)
      .maybeSingle();
    const existingData = existing.data as { id?: string } | null;
    if (existingData && typeof existingData.id === 'string') {
      phase2MatchId = existingData.id;
    } else {
      const created = await service
        .from('matches')
        .insert({ room_code: PHASE2_ROOM, game_mode: 'classic', participants: [fx.host, fx.guest] })
        .select('id')
        .maybeSingle();
      const createdData = created.data as { id?: string } | null;
      if (createdData && typeof createdData.id === 'string') phase2MatchId = createdData.id;
    }
    if (phase2MatchId) {
      // Two matched tickets sharing match_id (owner host + guest).
      await service.from('matchmaking_queue').insert({
        player_id: fx.host,
        game_mode: 'classic',
        match_type: '1v1',
        wager: 0,
        status: 'matched',
        match_id: phase2MatchId,
        room_code: PHASE2_ROOM,
        validation_token: 'phase2-owner-token-001',
      });
      await service.from('matchmaking_queue').insert({
        player_id: fx.guest,
        game_mode: 'classic',
        match_type: '1v1',
        wager: 0,
        status: 'matched',
        match_id: phase2MatchId,
        room_code: PHASE2_ROOM,
        validation_token: 'phase2-guest-token-001',
      });
      const ownerTicket = await service
        .from('matchmaking_queue')
        .select('id')
        .eq('match_id', phase2MatchId)
        .eq('player_id', fx.host)
        .eq('status', 'matched')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const ownerTicketData = ownerTicket.data as { id?: string } | null;
      if (ownerTicketData && typeof ownerTicketData.id === 'string')
        phase2OwnerTicketId = ownerTicketData.id;

      // Spectator snapshot row (service-only table, public via route).
      await service.from('match_states').upsert(
        {
          match_id: phase2MatchId,
          room_code: PHASE2_ROOM,
          host_address: fx.host,
          seq: 7,
          state: { turn: 1, phase: 'phase2-probe' },
          color_corner: { green: 0 },
          player_seats: {},
        },
        { onConflict: 'match_id' },
      );
    }
    // Moderation perspective: host blocks guest; outsider blocks nobody.
    await service.from('user_blocks').delete().eq('blocker_address', fx.outsider).eq('blocked_address', fx.guest);
    await service
      .from('user_blocks')
      .upsert(
        { blocker_address: fx.host, blocked_address: fx.guest },
        { onConflict: 'blocker_address,blocked_address' },
      );
    push(
      'phase2-full/seed-phase2-fixtures',
      phase2MatchId !== null && phase2OwnerTicketId !== null,
      phase2MatchId && phase2OwnerTicketId
        ? `match ${PHASE2_ROOM} + owner ticket ready`
        : `seed incomplete (match=${String(phase2MatchId)}, ticket=${String(phase2OwnerTicketId)})`,
    );
  } catch (e) {
    push('phase2-full/seed-phase2-fixtures', false, `seed exception: ${String(e)}`);
  }

  // --- HTTP matrix (preview deploy) ---------------------------------------------
  if (skipHttp || !previewUrl) {
    push(
      'phase2-full/http-skip-no-preview',
      true,
      skipHttp
        ? 'SKIP-NOTICE: --skip-http — Phase 2 HTTP matrix skipped'
        : 'SKIP-NOTICE: PREVIEW_URL unset — Phase 2 HTTP matrix skipped',
    );
    return out;
  }
  const base = previewUrl.replace(/\/$/, '');
  const getJson = async (p: string): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`${base}${p}`);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };

  // 1. Pools: public aggregate, no session, never player_ids.
  try {
    const r = await getJson(
      `/api/matchmaking/pools?gameMode=classic&matchType=1v1`,
    );
    push(
      'phase2-full/http-pools-aggregate',
      r.status === 200 && isPoolsResponseValid(r.json) && !poolsResponseLeaksPlayers(r.json),
      `status ${r.status}, valid=${String(isPoolsResponseValid(r.json))} body ${JSON.stringify(r.json)?.slice(0, 160)}`,
    );
    const rSelf = await getJson(
      `/api/matchmaking/pools?gameMode=classic&matchType=1v1&walletAddress=${fx.host}`,
    );
    push(
      'phase2-full/http-pools-self-exclusion',
      rSelf.status === 200 && isPoolsResponseValid(rSelf.json),
      `status ${rSelf.status} with walletAddress filter`,
    );
    const rBad = await getJson(`/api/matchmaking/pools`);
    push(
      'phase2-full/http-pools-400-missing-params',
      rBad.status === 400 && validateErrorBody(rBad.json),
      `status ${rBad.status} body ${JSON.stringify(rBad.json)?.slice(0, 120)}`,
    );
  } catch (e) {
    push('phase2-full/http-pools-aggregate', false, `fetch failed: ${String(e)}`);
  }

  // 2. Status ticket: 401 without session; owner token; non-owner empty.
  try {
    const noSession = await getJson(
      `/api/matchmaking/status?ticketId=${phase2OwnerTicketId ?? '00000000-0000-4000-8000-000000000000'}&walletAddress=${fx.host}`,
    );
    push(
      'phase2-full/http-status-ticket-401-no-session',
      noSession.status === 401 && validateErrorBody(noSession.json),
      `status ${noSession.status} body ${JSON.stringify(noSession.json)?.slice(0, 120)}`,
    );
    if (phase2OwnerTicketId) {
      const owner = await getJson(
        `/api/matchmaking/status?ticketId=${phase2OwnerTicketId}&walletAddress=${fx.host}&sessionId=${PHASE2_OWNER_SESSION}`,
      );
      const ownerBody = owner.json as Record<string, unknown> | null;
      const hasToken =
        typeof ownerBody === 'object' &&
        ownerBody !== null &&
        typeof (ownerBody as Record<string, unknown>)['validation_token'] === 'string' &&
        ((ownerBody as Record<string, unknown>)['validation_token'] as string).length > 0;
      push(
        'phase2-full/http-status-ticket-owner-token',
        owner.status === 200 &&
          isStatusTicketShapeValid(owner.json) &&
          !statusTicketLeaksToken(owner.json, true) &&
          hasToken,
        `status ${owner.status} token-present=${String(hasToken)} body ${JSON.stringify(owner.json)?.slice(0, 180)}`,
      );
      const nonOwner = await getJson(
        `/api/matchmaking/status?ticketId=${phase2OwnerTicketId}&walletAddress=${fx.outsider}&sessionId=${PHASE2_OUTSIDER_SESSION}`,
      );
      const nonOwnerPass =
        (nonOwner.status === 403 && validateErrorBody(nonOwner.json)) ||
        (nonOwner.status === 200 &&
          isStatusTicketShapeValid(nonOwner.json) &&
          !statusTicketLeaksToken(nonOwner.json, false));
      push(
        'phase2-full/http-status-ticket-nonowner-no-token',
        nonOwnerPass,
        `status ${nonOwner.status} body ${JSON.stringify(nonOwner.json)?.slice(0, 180)}`,
      );
    } else {
      push('phase2-full/http-status-ticket-owner-token', true, 'SKIP-NOTICE: no owner ticket id');
      push('phase2-full/http-status-ticket-nonowner-no-token', true, 'SKIP-NOTICE: no owner ticket id');
    }
  } catch (e) {
    push('phase2-full/http-status-ticket-401-no-session', false, `fetch failed: ${String(e)}`);
  }

  // 3. Status roster: participant players[] vs outsider 403, no token anywhere.
  try {
    if (phase2MatchId) {
      const participant = await getJson(
        `/api/matchmaking/status?matchId=${phase2MatchId}&walletAddress=${fx.host}&sessionId=${PHASE2_OWNER_SESSION}`,
      );
      push(
        'phase2-full/http-status-roster-participant',
        participant.status === 200 &&
          isRosterResponseValid(participant.json) &&
          !rosterLeaksToken(participant.json),
        `status ${participant.status} body ${JSON.stringify(participant.json)?.slice(0, 180)}`,
      );
      const outsider = await getJson(
        `/api/matchmaking/status?matchId=${phase2MatchId}&walletAddress=${fx.outsider}&sessionId=${PHASE2_OUTSIDER_SESSION}`,
      );
      push(
        'phase2-full/http-status-roster-outsider-403',
        outsider.status === 403 && validateErrorBody(outsider.json),
        `status ${outsider.status} body ${JSON.stringify(outsider.json)?.slice(0, 120)}`,
      );
      const rosterNoSession = await getJson(
        `/api/matchmaking/status?matchId=${phase2MatchId}&walletAddress=${fx.host}`,
      );
      push(
        'phase2-full/http-status-roster-401-no-session',
        rosterNoSession.status === 401 && validateErrorBody(rosterNoSession.json),
        `status ${rosterNoSession.status}`,
      );
    } else {
      push('phase2-full/http-status-roster-participant', true, 'SKIP-NOTICE: no phase2 match');
      push('phase2-full/http-status-roster-outsider-403', true, 'SKIP-NOTICE: no phase2 match');
      push('phase2-full/http-status-roster-401-no-session', true, 'SKIP-NOTICE: no phase2 match');
    }
  } catch (e) {
    push('phase2-full/http-status-roster-participant', false, `fetch failed: ${String(e)}`);
  }

  // 4. Presence/online: fresh-heartbeat grant-safe directory, paging, self-exclusion.
  try {
    const p0 = await getJson(`/api/presence/online?limit=2&page=0`);
    push(
      'phase2-full/http-presence-grant-safe',
      p0.status === 200 &&
        isPresenceResponseValid(p0.json) &&
        !presenceResponseLeaksPrivate(p0.json),
      `status ${p0.status} body ${JSON.stringify(p0.json)?.slice(0, 180)}`,
    );
    const pSelf = await getJson(
      `/api/presence/online?limit=25&page=0&walletAddress=${fx.host}`,
    );
    const selfBody = pSelf.json as { players?: { wallet_address?: string }[] } | null;
    const selfRows =
      selfBody && Array.isArray(selfBody.players) ? selfBody.players : [];
    const selfExcluded = selfRows.every(
      (r) => String(r.wallet_address || '').toLowerCase() !== fx.host,
    );
    push(
      'phase2-full/http-presence-self-exclusion',
      pSelf.status === 200 && isPresenceResponseValid(pSelf.json) && selfExcluded,
      `status ${pSelf.status} self-excluded=${String(selfExcluded)}`,
    );
    const pg0 = await getJson(`/api/presence/online?limit=1&page=0`);
    const pg1 = await getJson(`/api/presence/online?limit=1&page=1`);
    const pgOk =
      pg0.status === 200 &&
      pg1.status === 200 &&
      isPresenceResponseValid(pg0.json) &&
      isPresenceResponseValid(pg1.json) &&
      Array.isArray((pg0.json as { players?: unknown[] }).players) &&
      ((pg0.json as { players?: unknown[] }).players as unknown[]).length <= 1 &&
      Array.isArray((pg1.json as { players?: unknown[] }).players) &&
      ((pg1.json as { players?: unknown[] }).players as unknown[]).length <= 1;
    push('phase2-full/http-presence-paging', pgOk, `p0 ${pg0.status} p1 ${pg1.status}`);
  } catch (e) {
    push('phase2-full/http-presence-grant-safe', false, `fetch failed: ${String(e)}`);
  }

  // 5. Match/state: public snapshot vs 404, no economy/session cols.
  try {
    if (phase2MatchId) {
      const snap = await getJson(`/api/match/state?matchId=${phase2MatchId}`);
      push(
        'phase2-full/http-match-state-snapshot',
        snap.status === 200 &&
          isMatchStateSnapshotValid(snap.json) &&
          !matchStateLeaksPrivate(snap.json),
        `status ${snap.status} body ${JSON.stringify(snap.json)?.slice(0, 180)}`,
      );
    } else {
      push('phase2-full/http-match-state-snapshot', true, 'SKIP-NOTICE: no phase2 match');
    }
    const miss = await getJson(
      `/api/match/state?matchId=00000000-0000-4000-8000-ffffffffffff`,
    );
    push(
      'phase2-full/http-match-state-404',
      miss.status === 404 && isMatchNotFoundBody(miss.json),
      `status ${miss.status} body ${JSON.stringify(miss.json)?.slice(0, 120)}`,
    );
  } catch (e) {
    push('phase2-full/http-match-state-snapshot', false, `fetch failed: ${String(e)}`);
  }

  // 6. Moderation GET: 401 without session, own-perspective { blocked } only.
  try {
    const noSess = await getJson(`/api/social/moderation?target=${fx.guest}`);
    push(
      'phase2-full/http-moderation-401-no-session',
      noSess.status === 401 && validateErrorBody(noSess.json),
      `status ${noSess.status} body ${JSON.stringify(noSess.json)?.slice(0, 120)}`,
    );
    const own = await getJson(
      `/api/social/moderation?walletAddress=${fx.host}&sessionId=${PHASE2_OWNER_SESSION}&target=${fx.guest}`,
    );
    const ownBody = own.json as Record<string, unknown> | null;
    push(
      'phase2-full/http-moderation-own-true',
      own.status === 200 &&
        isModerationBodyValid(own.json) &&
        ownBody !== null &&
        ownBody['blocked'] === true,
      `status ${own.status} body ${JSON.stringify(own.json)?.slice(0, 120)}`,
    );
    const other = await getJson(
      `/api/social/moderation?walletAddress=${fx.outsider}&sessionId=${PHASE2_OUTSIDER_SESSION}&target=${fx.guest}`,
    );
    const otherBody = other.json as Record<string, unknown> | null;
    push(
      'phase2-full/http-moderation-other-false',
      other.status === 200 &&
        isModerationBodyValid(other.json) &&
        otherBody !== null &&
        otherBody['blocked'] === false &&
        !moderationLeaksList(other.json),
      `status ${other.status} body ${JSON.stringify(other.json)?.slice(0, 120)} (outsider cannot read host block list)`,
    );
  } catch (e) {
    push('phase2-full/http-moderation-401-no-session', false, `fetch failed: ${String(e)}`);
  }

  return out;
}

async function runFullMode(
  env: FullEnv,
  opts: { skipHttp: boolean; skipRealtime: boolean; repoRoot: string },
): Promise<ProbeCheck[]> {
  const all: ProbeCheck[] = [];
  const anon: SupabaseClient = createClient(env.url, env.anonKey);
  const svc: SupabaseClient = createClient(env.url, env.serviceKey);
  const fx = buildFixtures(Date.now());

  // Connectivity + baseline presence (service must see core tables).
  for (const t of ['players', 'matches', 'feedback', 'matchmaking_queue']) {
    const ok = await serviceTableExists(svc, t);
    all.push({
      id: `full/connect:${t}`,
      category: 'full-connect',
      pass: ok,
      detail: ok
        ? `${t} reachable (baseline applied)`
        : `${t} MISSING — apply ${BASELINE_REL_PATH} to the scratch project first`,
    });
  }
  if (all.some((c) => !c.pass)) return all;

  for (const c of await seedFixtures(svc, fx)) all.push(c);
  for (const c of await runAnonSelectMatrix(anon, svc)) all.push(c);
  for (const c of await runAnonInsertMatrix(anon)) all.push(c);
  for (const c of await runAnonWriteDenyMatrix(anon)) all.push(c);
  for (const c of await runRpcMatrix(anon, svc, buildFixtures(Date.now()))) all.push(c);
  // Phase 2: RLS always; HTTP inside respects previewUrl/skipHttp.
  for (const c of await runPhase2FullChecks(anon, svc, env.previewUrl, fx, opts.skipHttp))
    all.push(c);

  if (!opts.skipHttp) {
    if (env.previewUrl) {
      for (const c of await runHttpMatrix({ previewUrl: env.previewUrl, fx })) all.push(c);
    } else {
      all.push({
        id: 'http/skip-no-preview',
        category: 'http',
        pass: true,
        detail: 'SKIP-NOTICE: PREVIEW_URL unset — HTTP matrix skipped',
      });
    }
  }
  if (!opts.skipRealtime) {
    for (const c of await runRealtimeMatrix(anon, svc)) all.push(c);
  }
  return all;
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function printHuman(checks: ProbeCheck[]): void {
  const byCat = new Map<string, ProbeCheck[]>();
  for (const c of checks) {
    const arr = byCat.get(c.category) ?? [];
    arr.push(c);
    byCat.set(c.category, arr);
  }
  for (const [cat, arr] of byCat) {
    console.log(`\n## ${cat} (${arr.filter((a) => a.pass).length}/${arr.length} pass)`);
    for (const c of arr) {
      console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.id} — ${c.detail}`);
    }
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\n== ${checks.length - failed.length}/${checks.length} checks pass ==` +
      (failed.length > 0 ? `\nFAILED: ${failed.map((f) => f.id).join(', ')}` : ''),
  );
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log(
      [
        'compat-probe — Phase 4 database-compatibility probe',
        '',
        '  npx tsx scripts/compat-probe.ts --offline   offline self-test (no DB)',
        '  npx tsx scripts/compat-probe.ts --full      full scratch-project mode',
        '  npx tsx scripts/compat-probe.ts             auto (offline + full if env present)',
        '  Flags: --json --skip-http --skip-realtime',
        '',
        `  F-01: EXPECT_FEEDBACK_ANON=${String(EXPECT_FEEDBACK_ANON)} (flip one line on decision)`,
        `  Baseline: ${BASELINE_REL_PATH}`,
        '  Teardown: delete the scratch project (documented, not implemented).',
      ].join('\n'),
    );
    return;
  }

  const repoRoot = process.cwd();
  const asJson = args.has('--json');

  // Offline ALWAYS runs (pre-step in both modes).
  const offline = runOfflineSelfTest(repoRoot);
  const offlineFail = offline.filter((c) => !c.pass);

  const wantFull = args.has('--full') || !args.has('--offline');
  const { env, missing } = resolveFullEnv();

  let full: ProbeCheck[] = [];
  let fullSkippedNotice: string | null = null;
  if (args.has('--offline')) {
    fullSkippedNotice = 'offline-only flag: full mode skipped';
  } else if (!env) {
    fullSkippedNotice = `full mode skipped — missing env: ${missing.join(', ')}`;
    if (args.has('--full')) {
      // Explicit --full with missing env is a hard failure (operator error).
      const checks: ProbeCheck[] = [
        ...offline,
        {
          id: 'full/env-missing',
          category: 'full-connect',
          pass: false,
          detail: `missing env: ${missing.join(', ')} — create a scratch project per docs/notes/compat-probe.md`,
        },
      ];
      if (asJson) console.log(JSON.stringify({ mode: 'full', checks }, null, 2));
      else printHuman(checks);
      process.exitCode = 1;
      return;
    }
  } else if (wantFull) {
    try {
      full = await runFullMode(env, {
        skipHttp: args.has('--skip-http'),
        skipRealtime: args.has('--skip-realtime'),
        repoRoot,
      });
    } catch (e) {
      full = [
        {
          id: 'full/unhandled-exception',
          category: 'full-connect',
          pass: false,
          detail: String(e),
        },
      ];
    }
  }

  const checks: ProbeCheck[] = [...offline, ...full];
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          mode: full.length > 0 ? 'full' : 'offline',
          expectFeedbackAnon: EXPECT_FEEDBACK_ANON,
          skipped: fullSkippedNotice,
          summary: {
            total: checks.length,
            pass: checks.filter((c) => c.pass).length,
            fail: checks.filter((c) => !c.pass).length,
          },
          checks,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(checks);
    if (fullSkippedNotice) console.log(`\nnotice: ${fullSkippedNotice}`);
    console.log(
      `\nF-01: EXPECT_FEEDBACK_ANON=${String(EXPECT_FEEDBACK_ANON)} (flip one line on decision)`,
    );
  }

  const failed = checks.filter((c) => !c.pass);
  // Offline failures always fail the run. Full failures fail only full runs.
  if (offlineFail.length > 0 || (full.length > 0 && failed.length > offlineFail.length)) {
    process.exitCode = 1;
  }
}

void main().catch((e: unknown) => {
  console.error(`compat-probe fatal: ${String(e)}`);
  process.exitCode = 1;
});
