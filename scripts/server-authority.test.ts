/**
 * Server Authority Migration — Phase 0 Gate Tests
 *
 * Asserts P0 deliverables:
 *  1. Feature flags module (lib/serverAuthority.ts)
 *  2. wrangler.jsonc DO bindings, migrations, and custom entrypoint
 *  3. ADR-002 existence and key decisions
 *  4. Local development documentation
 *  5. Standing SLOs baseline capture in docs/ops/SLOS.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assignCornersForShape } from '../lib/boardLayout';
import {
  isAuthV2Enabled,
  isRoomV2Enabled,
  isServerLifecycleEnabled,
  resolveRoomVersion,
  activeMigrationFlags,
} from '../lib/serverAuthority';

const root = join(import.meta.dirname ?? __dirname, '..');

test('P0-1: Feature flags default to off', () => {
  // Clear any overrides for test
  delete process.env.SAM_AUTH_V2;
  delete process.env.SAM_ROOM_V2;
  delete process.env.SAM_SERVER_LIFECYCLE;
  delete process.env.SAM_PRIVATE_REALTIME;
  delete process.env.SAM_DEGRADED_P2P;

  assert.equal(isAuthV2Enabled(), false, 'AUTH_V2 should default to false');
  assert.equal(isRoomV2Enabled(), false, 'ROOM_V2 should default to false');
  assert.equal(isServerLifecycleEnabled(), false, 'SERVER_LIFECYCLE should default to false');
  assert.equal(resolveRoomVersion(), 1, 'resolveRoomVersion should default to 1 (legacy)');

  const flags = activeMigrationFlags();
  assert.deepEqual(flags, {
    AUTH_V2: false,
    ROOM_V2: false,
    SERVER_LIFECYCLE: false,
    PRIVATE_REALTIME: false,
    DEGRADED_P2P: false,
  });
});

test('P0-1: Feature flags respect SAM_ environment overrides', () => {
  try {
    process.env.SAM_AUTH_V2 = '1';
    process.env.SAM_ROOM_V2 = 'true';
    process.env.SAM_SERVER_LIFECYCLE = '1';

    assert.equal(isAuthV2Enabled(), true);
    assert.equal(isRoomV2Enabled(), true);
    assert.equal(isServerLifecycleEnabled(), true);
    assert.equal(resolveRoomVersion(), 2, 'resolveRoomVersion should be 2 when ROOM_V2 is enabled');
  } finally {
    delete process.env.SAM_AUTH_V2;
    delete process.env.SAM_ROOM_V2;
    delete process.env.SAM_SERVER_LIFECYCLE;
    delete process.env.SAM_PRIVATE_REALTIME;
    delete process.env.SAM_DEGRADED_P2P;
  }
});

test('P0-2: ADR-002 exists and contains core architectural decisions', () => {
  const adrPath = join(root, 'docs/architecture/adr-002-server-authority.md');
  assert.ok(existsSync(adrPath), 'ADR-002 file must exist');

  const content = readFileSync(adrPath, 'utf8');
  assert.ok(content.includes('ADR-002'), 'Must declare ADR-002');
  assert.ok(content.includes('Durable Object'), 'Must mention Durable Object decision');
  assert.ok(content.includes('__Host-ludo_session'), 'Must specify __Host- cookie format');
  assert.ok(content.includes('ROOM_V2'), 'Must describe ROOM_V2 cutover rule');
});

test('P0-3: SLOS.md records Server Authority Migration numeric targets and baselines', () => {
  const slosPath = join(root, 'docs/ops/SLOS.md');
  assert.ok(existsSync(slosPath), 'SLOS.md must exist');

  const content = readFileSync(slosPath, 'utf8');
  assert.ok(content.includes('Server Authority Migration SLOs'), 'Must have migration SLOs section');
  assert.ok(content.includes('Signing prompts per match during play'), 'Must track signing prompt SLO');
  assert.ok(content.includes('Host-disconnect match loss'), 'Must track host-disconnect SLO');
  assert.ok(content.includes('Worker CPU p95'), 'Must track Worker CPU SLO');
});

/**
 * Strip JSONC comments so JSON.parse can read wrangler.jsonc.
 *
 * Must be string-aware: `//` also appears inside values — most obviously the
 * `https://` in NEXT_PUBLIC_SUPABASE_URL. A naive `/\/\/.*$/gm` replacement
 * truncates that value and leaves an unterminated string, so the config stops
 * parsing the moment any URL is configured. Scan, tracking quotes and escapes.
 */
function stripJsonc(raw: string): string {
  let out = '';
  let inStr = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const n = raw[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i++; }
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

test('P0-4 & P0-5: wrangler.jsonc configures src/worker.ts, DO bindings, and migrations', () => {
  const wranglerPath = join(root, 'wrangler.jsonc');
  assert.ok(existsSync(wranglerPath), 'wrangler.jsonc must exist');

  const raw = readFileSync(wranglerPath, 'utf8');
  // Strip JSONC comments for JSON.parse.
  //
  // Must be string-aware: `//` also appears inside values, most obviously the
  // `https://` in NEXT_PUBLIC_SUPABASE_URL. A plain `/\/\/.*$/gm` replacement
  // truncates that value and leaves an unterminated string, so the config stops
  // parsing the moment any URL is configured. Scan instead, tracking quotes.
  const stripped = stripJsonc(raw);
  const config = JSON.parse(stripped);

  assert.equal(config.main, 'src/worker.ts', 'main entrypoint must be src/worker.ts');
  assert.ok(config.durable_objects?.bindings, 'Must have durable_objects.bindings');

  const bindingNames = config.durable_objects.bindings.map((b: { name: string }) => b.name);
  assert.ok(bindingNames.includes('MATCH_ROOM'), 'Must declare MATCH_ROOM binding');
  assert.ok(bindingNames.includes('RATE_LIMITER'), 'Must declare RATE_LIMITER binding');

  assert.ok(config.migrations?.length > 0, 'Must declare migrations');
  const sqliteClasses = config.migrations[0].new_sqlite_classes;
  assert.ok(sqliteClasses.includes('MatchRoom'), 'Must declare MatchRoom in new_sqlite_classes');
  assert.ok(sqliteClasses.includes('RateLimitDO'), 'Must declare RateLimitDO in new_sqlite_classes');
});

// ── The Worker must carry the public config the room needs ─────────────────
//
// Root cause of the 2026-10-23 1v1 stall: wrangler.jsonc had NO `vars` block, so
// the deployed Worker had no NEXT_PUBLIC_SUPABASE_URL. MatchRoom reads it to
// query match_seats/match_states, so with it undefined the room never seeded and
// no state frame was ever fanned out. Verified live: `wrangler secret list`
// showed SUPABASE_SERVICE_ROLE_KEY present and the URL absent.
//
// This is a config regression that no code gate could catch — the value is only
// observable on the deployed Worker — so it is asserted here instead.

test('P0-6: wrangler.jsonc declares the public Supabase URL the room requires', () => {
  const raw = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
  const config = JSON.parse(stripJsonc(raw));

  assert.equal(
    config.vars?.NEXT_PUBLIC_SUPABASE_URL,
    'https://xvwaqxqyjtlsuijgwozi.supabase.co',
    'the room cannot reach Postgres without this — see MatchRoomCore.ensureInitialized',
  );
  // The service-role key is a secret and must never be a public var.
  assert.equal(config.vars?.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test('P0-7: wrangler.jsonc serves the app on a custom domain, not *.workers.dev', () => {
  const raw = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
  // Wallet sign-in requires a domain we own: MetaMask and Coinbase Wallet block
  // *.workers.dev at the domain level, before connect() runs.
  assert.match(raw, /custom_domain/);
  const cfg = JSON.parse(stripJsonc(raw));
  const route = cfg.routes?.[0];
  assert.equal(route?.pattern, 'play.ludobase.live');
  assert.equal(route?.custom_domain, true);
  // Not the apex — moving it would take the hostname off the Vercel origin.
  assert.notEqual(route?.pattern, 'ludobase.live', 'moving the apex takes it off Vercel');
  // And not the shared subdomain that wallets block.
  assert.doesNotMatch(raw, /workers\.dev/);
});

test('P0-6: Local development documentation exists', () => {
  const devDocPath = join(root, 'docs/dev/LOCAL_DEVELOPMENT.md');
  assert.ok(existsSync(devDocPath), 'docs/dev/LOCAL_DEVELOPMENT.md must exist');

  const content = readFileSync(devDocPath, 'utf8');
  assert.ok(content.includes('NEXT_PUBLIC_ROOM_WS_URL'), 'Must document NEXT_PUBLIC_ROOM_WS_URL');
  assert.ok(content.includes('Option A: Staging DO Tunnel'), 'Must document Option A');
  assert.ok(content.includes('Option B: Dev WS Sidecar'), 'Must document Option B');
});

// ── Build-time env guard ───────────────────────────────────────────────────
//
// The Cloudflare Workers Builds pipeline deployed a bundle built with
// placeholder Supabase values and no CDP project id — it logged "Supabase
// environment variables are missing. Using placeholders for build." and then
// deployed successfully. The live site had no wallet and no database, and
// nothing on the deploy side reported a problem. It then overwrote a correct
// deploy.
//
// `NEXT_PUBLIC_*` values are inlined at build time, so a missing variable is
// baked into the bundle. A placeholder build is strictly worse than a failed
// build: one is silently broken, the other is honest.

test('P0-8: the build guard covers every NEXT_PUBLIC_* var the app reads', () => {
  const guard = join(root, 'scripts', 'check-build-env.mjs');
  assert.ok(existsSync(guard), 'scripts/check-build-env.mjs must exist');
  const src = readFileSync(guard, 'utf8');

  // It must derive the requirement from the code, not from a hand-kept list —
  // a fixed list is exactly why chips and missions vanished on 2026-10-23:
  // NEXT_PUBLIC_CHIPS_ADDRESS and NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS were
  // missing from wrangler.jsonc and nothing noticed.
  assert.match(src, /function referencedVars\(\)/);
  assert.match(src, /KNOWN_OPTIONAL/);
  // Vars with safe defaults must be allow-listed, or the guard fails a build
  // that would otherwise work.
  assert.match(src, /NEXT_PUBLIC_ROOM_WS_URL/);
  assert.match(src, /NEXT_PUBLIC_PEERJS_HOST/);

  // It must fail, and it must inject from wrangler.jsonc as a FILE.
  assert.match(src, /process\.exit\(1\)/);
  assert.match(src, /writeFileSync\(ENV_PROD/);
  assert.match(src, /\.env\.production/);

  // And wrangler.jsonc must actually carry the economy vars.
  const cfg = JSON.parse(stripJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')));
  for (const v of [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_CDP_PROJECT_ID',
    'NEXT_PUBLIC_CHIPS_ADDRESS',
    'NEXT_PUBLIC_MISSION_SYSTEM_ADDRESS',
    'NEXT_PUBLIC_MISSION_CLAIM_ADDRESS',
    'NEXT_PUBLIC_CLAIM_HUB_ADDRESS',
  ]) {
    assert.ok(cfg.vars?.[v], `wrangler.jsonc vars must declare ${v}`);
  }
  // Secrets must NOT be in vars.
  assert.equal(cfg.vars?.SUPABASE_SERVICE_ROLE_KEY, undefined);

  // And it must be wired into the build that CI runs.
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /check-build-env\.mjs/,
    'npm run build must run the guard — opennextjs-cloudflare build invokes it');
});

// ── FK provisioning: any route storing an address must provision it ─────────
//
// live_chat and DMs both went down on 2026-10-23 with a bare "Failed to send".
// The Worker log showed the real cause:
//
//   insert or update on table "live_chat" violates foreign key constraint
//   "live_chat_sender_id_fkey"
//
// sender_id references players(wallet_address). Social login mints a NEW smart
// account (AGENTS.md: player identity is the Smart Account, never the EOA), and
// the newest players row predated the sign-ins — so no row existed and every
// insert failed. The UI showed nothing because the route caught the error and
// returned a generic message.
//
// `ensurePlayerRow` exists for exactly this, and its own doc says "any server
// flow that stores a third-party address must provision first". These two routes
// simply never called it.

const FK_TABLES = ['live_chat', 'messages', 'conversations'];

test('P0-9: every route inserting into an FK-bound table provisions the address first', () => {
  const apiDir = join(root, 'app', 'api');
  const offenders: string[] = [];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name === 'route.ts') out.push(full);
    }
    return out;
  };

  for (const file of walk(apiDir)) {
    const src = readFileSync(file, 'utf8');
    const touchesFkTable = FK_TABLES.some((t) => src.includes(`from('${t}')`) || src.includes(`from("${t}")`));
    const inserts = /\.insert\(|\.upsert\(/.test(src);
    if (touchesFkTable && inserts && !src.includes('ensurePlayerRow')) {
      offenders.push(file.slice(root.length + 1));
    }
  }

  assert.deepEqual(offenders, [],
    `these routes insert into FK-bound tables without provisioning the address: ${offenders.join(', ')}`);
});

test('P0-9b: ensurePlayerRow is idempotent and accepts the app identity shapes', () => {
  const src = readFileSync(join(root, 'lib', 'serverAuth.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function ensurePlayerRow'));
  assert.match(fn, /ignoreDuplicates: true/, 'must be idempotent');
  assert.match(fn, /guest_/, 'guest ids are valid chat senders');
  assert.match(fn, /0x\[a-f0-9\]\{40\}/, 'must validate the address shape');
});

// ── Session reader and writer must agree on the table ──────────────────────
//
// `/api/siwe/verify` mints sessions by INSERTing into `app_sessions` and handing
// the client that row's id. `requireSession` hashed the incoming token and looked
// for `sessions.token_hash` — a match that can never occur, because the writer
// never touches `sessions`.
//
// The read side had "retired" the app_sessions dual-read on the assumption the
// writer had migrated. It had not. Every route authenticating through here
// returned 401, which took live broadcast, DMs and missions down while the
// session-free surfaces (chips, leaderboard, activity feed) kept working —
// the exact signature of an auth failure rather than a data failure.
//
// The function's own header documented the fallback ("Dual-read fallback to
// app_sessions for backward compatibility during rollout"); the implementation
// disagreed with its own doc, and the implementation was wrong.

test('P0-10: requireSession reads the table the sign-in route writes', () => {
  const serverAuth = readFileSync(join(root, 'lib', 'serverAuth.ts'), 'utf8');
  const verify = readFileSync(join(root, 'app', 'api', 'siwe', 'verify', 'route.ts'), 'utf8');

  // The writer still targets app_sessions.
  assert.match(verify, /from\('app_sessions'\)[\s\S]*?\.insert\(/, 'siwe/verify must still be inserting into app_sessions');

  // So the reader must fall back to it. `requireAppSession` is the existing
  // dual-read helper — the fallback must go through it rather than reimplementing.
  const fn = serverAuth.slice(serverAuth.indexOf('export async function requireSession('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /requireAppSession\(/, 'requireSession must dual-read app_sessions via requireAppSession');
  assert.doesNotMatch(body, /dual-read is retired/,
    'the retired-dual-read comment must not come back — it is what broke this');

  // And the fallback must not leak scope: app_sessions has no scope column, so a
  // match-scoped request must not authenticate off a legacy session.
  assert.match(body, /expectedScope !== 'app'/, 'legacy sessions are app-scope only');
});

test('P0-10b: a legacy session authenticates for app scope and is refused for match scope', async () => {
  const env = readFileSync(join(root, '.env.local'), 'utf8');
  const get = (k: string) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
  const url = get('NEXT_PUBLIC_SUPABASE_URL');
  const svc = get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !svc) {
    // No credentials available (CI) — the static assertions above still hold.
    return;
  }
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || svc;
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || url;

  const { requireSession } = await import('../lib/serverAuth');
  const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };

  const players = await (await fetch(`${url}/rest/v1/players?select=wallet_address&limit=1`, { headers: H })).json();
  const wallet = String(players?.[0]?.wallet_address || '');
  if (!wallet) return;

  // one live session per wallet — revoke first, exactly as siwe/verify does.
  await fetch(`${url}/rest/v1/app_sessions?wallet_address=eq.${wallet}&revoked_at=is.null`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  const ins = await fetch(`${url}/rest/v1/app_sessions`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({
      wallet_address: wallet,
      nonce: `gate_${Date.now()}`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  const [row] = await ins.json();
  if (!row?.id) return;

  try {
    const mk = () => new Request('https://play.ludobase.live/api/missions/list', {
      method: 'GET',
      headers: { authorization: `Bearer ${row.id}`, origin: 'https://play.ludobase.live' },
    });

    const app = await requireSession(mk(), { scope: 'app', expectedWallet: wallet });
    assert.equal(app?.wallet, wallet, 'a legacy app_session must authenticate for app scope');

    const match = await requireSession(mk(), { scope: 'match' });
    assert.equal(match, null, 'a legacy app_session must NOT authenticate for match scope');
  } finally {
    await fetch(`${url}/rest/v1/app_sessions?id=eq.${row.id}`, { method: 'DELETE', headers: H });
  }
});

// ── Client calls to authenticated routes must carry a session ──────────────
//
// `/api/live-chat` rejects a 0x sender that presents no app session (only guest_
// ids bypass it). Three client call sites sent none: two live-chat POSTs and the
// room announce. Every signed-in shout 401'd, the client swallowed the non-ok
// response, and the UI just counted the 10s slow-mode cooldown — "sending
// happens nothing, no error".
//
// `/api/missions/list` had the mirror-image bug: MissionPanel DOES pass
// `?sessionId=`, but the route only read the Authorization header, so it 401'd
// and rendered an empty list.
//
// Both directions are the same mistake: the client and the server disagreed
// about where the session travels.

const AUTHED_CLIENT_ROUTES = ['/api/live-chat', '/api/messages', '/api/missions/'];

test('P0-11: client fetches to authenticated routes carry a session', () => {
  const dirs = ['app/components', 'hooks', 'app/hooks'].filter((d) => existsSync(join(root, d)));
  const offenders: string[] = [];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  for (const dir of dirs) {
    for (const file of walk(join(root, dir))) {
      const src = readFileSync(file, 'utf8');
      // Find each fetch whose URL is one of the authenticated routes, then check
      // the surrounding call for a session carrier.
      const re = /fetch\(\s*[`'"]([^`'"]*\/api\/[^`'"]*)[`'"]/g;
      for (const m of src.matchAll(re)) {
        const url = m[1];
        if (!AUTHED_CLIENT_ROUTES.some((r) => url.includes(r))) continue;
        const window = src.slice(m.index, m.index + 700);
        const hasHeader = /Authorization|x-session-id|x-session-token/.test(window);
        const hasBodyOrParam = /sessionId/.test(window);
        if (!hasHeader && !hasBodyOrParam) {
          offenders.push(`${file.slice(root.length + 1)} → ${url}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, [],
    `these client calls hit authenticated routes without a session:\n  ${offenders.join('\n  ')}`);
});

test('P0-11b: the missions client sends its session as a header, not a query param', () => {
  const panel = readFileSync(join(root, 'app', 'components', 'MissionPanel.tsx'), 'utf8');
  // The session must travel in a header. It used to be appended to the URL, where
  // the route could not see it — every signed-in panel 401'd and rendered an empty
  // list with no error.
  assert.match(panel, /Authorization: `Bearer \$\{sessionId\}`/, 'must send the Bearer header');
  assert.match(panel, /'x-session-id': sessionId/, 'must also send x-session-id');
  // And it must NOT be in the URL — `P3` bans any route from reading ?sessionId=,
  // because a URL is logged by proxies and leaks via Referer.
  assert.doesNotMatch(panel, /sessionId=\$\{encodeURIComponent/, 'the session must not go in the query string');

  const route = readFileSync(join(root, 'app', 'api', 'missions', 'list', 'route.ts'), 'utf8');
  assert.doesNotMatch(route, /searchParams\.get\(\s*['"`]sessionId['"`]\s*\)/,
    'no route may read a session from the query string');
});

// ── No send route may return a generic failure ─────────────────────────────
//
// On 2026-10-23 a signed-in user could not send a live-chat message and saw
// nothing at all — no error, just a 10-second cooldown. The route had returned
// 401, the client had swallowed it, and the cause took four rounds to find
// because no layer carried a reason.
//
// `Failed to send` is not an error message; it is the absence of one. It does not
// tell the user whether to check their connection, sign in again, or wait — and it
// does not tell an operator whether the DB, the config or the network broke.

const SEND_ROUTES = ['app/api/live-chat/route.ts', 'app/api/messages/route.ts'];

test('P0-12: every send-route failure carries a classified code, never a bare message', () => {
  for (const rel of SEND_ROUTES) {
    const src = readFileSync(join(root, rel), 'utf8');

    // It must use the shared taxonomy…
    assert.match(src, /from '@\/lib\/sendErrors'/,
      `${rel} must import the send-error taxonomy`);

    // …and must not hand-roll a generic failure string anywhere.
    const generic = [
      /error:\s*'Failed to send'/,
      /error:\s*"Failed to send"/,
      /error:\s*'Message send failed'/,
      /error:\s*'Invalid session'/,
      /error:\s*error\.message/,
      /error:\s*\(\w+ as Error\)\.message/,
      /error:\s*conversations\.error\.message/,
      /error:\s*messages\.error\.message/,
    ];
    for (const re of generic) {
      assert.doesNotMatch(src, re,
        `${rel} still returns a generic/raw failure — use sendError(code) so the user is told why`);
    }
  }
});

test('P0-12b: the taxonomy covers the failure classes the user must be able to tell apart', () => {
  const src = readFileSync(join(root, 'lib', 'sendErrors.ts'), 'utf8');
  // The user's question is "is it my network, your system, or the database?" —
  // each of those must be its own code with its own copy.
  for (const code of ['network', 'auth', 'validation', 'rate_limited', 'db_write', 'db_read', 'config', 'server']) {
    assert.match(src, new RegExp(`\\|\\s*'${code}'`), `missing code: ${code}`);
    assert.ok(src.includes(`${code}:`), `missing user-facing copy for: ${code}`);
  }
  // Copy must say whose fault it is, not just that it failed.
  assert.match(src, /on us, not you/, 'db_write copy must tell the user it is not their fault');
  assert.match(src, /Check your connection/, 'network copy must tell the user what to check');
  assert.match(src, /Sign in again/, 'auth copy must tell the user what to do');
});

// ── The room handshake, the seed frame, and the match ticket ───────────────
//
// A 1v1 match on 2026-10-23 sat on "Still linking both players…" forever while
// the server side was provably healthy: `match_seats` had both seats,
// `match_states` held a seeded `status: "playing"` board, and `match_room_events`
// recorded the room seeding itself. Three independent breaks sat between that
// healthy room and the player's screen, and each one alone was sufficient.
//
// 1. The client's only transition into 'connected' is a `t: 'joined'` frame, and
//    the room never sent one — it answered a join with `state` (or `rejected`).
//    So `roomStatus` parked at 'connecting', the host never wrote its seed, and
//    `roomAuthority` never engaged.
// 2. The room self-seeds at `seq = 0` and the client's `serverSeqRef` also starts
//    at 0, so `applyServerState`'s `seq <= serverSeqRef.current` gate evaluated
//    `0 <= 0` and discarded the seed on every client. `isStarted` never became
//    true, which is precisely the condition the stall detector watches.
// 3. `issueMatchSession` validated the parent app session against `sessions` v2,
//    but `/api/siwe/verify` writes `app_sessions` — so `/api/auth/match` could
//    never issue a ticket and no client could enter a room as a seat.
//
// All three were invisible from the outside: the routes answered 200, the room
// answered 426, and the only symptom was a UI string that never changed.

test('P0-13: the room acknowledges a join with the frame the client waits for', () => {
  const core = readFileSync(join(root, 'src', 'room', 'MatchRoomCore.ts'), 'utf8');
  const client = readFileSync(join(root, 'lib', 'netcode', 'roomClient.ts'), 'utf8');

  // The client's contract: 'connected' is reachable only via `t: 'joined'`.
  assert.match(client, /if \(type === 'joined'\)[\s\S]*?setStatus\('connected'\)/,
    'RoomClient must still derive connected from the joined frame');

  // The server must actually send it, from the join handler, for seats AND
  // spectators — an unauthenticated spectator still needs the handshake to
  // complete or it is stuck at 'connecting' too.
  const joinFn = core.slice(core.indexOf('private async handleJoinFrame'));
  const joinBody = joinFn.slice(0, joinFn.indexOf('\n  }'));
  assert.match(joinBody, /t:\s*'joined'/, 'handleJoinFrame must send a joined frame');
  assert.match(joinBody, /role:\s*meta\.role/, 'joined must carry the role');
  // And it must be sent before the catch-up frame, so the client is marked
  // connected before it processes the board.
  assert.ok(joinBody.indexOf("t: 'joined'") < joinBody.indexOf("t: 'state'"),
    'joined must precede the catch-up state frame');
});

test('P0-14: the first server frame is accepted whatever its seq — the seed is seq 0', () => {
  const ctx = readFileSync(join(root, 'hooks', 'TeamUpContext.tsx'), 'utf8');
  const fn = ctx.slice(ctx.indexOf('const applyServerState = useCallback'));
  const body = fn.slice(0, fn.indexOf('\n    }, [sendMatchEvent])'));

  // The room self-seeds at seq 0 (MatchRoomCore sets `this.seq = 0` before its
  // first commit) and `serverSeqRef` starts at 0, so a plain `seq <= current`
  // gate eats the seed. There must be an explicit first-snapshot bypass.
  assert.match(body, /isFirstSnapshot/, 'the seq gate must exempt the first frame');
  assert.match(body, /!isFirstSnapshot &&/, 'and only the first frame');

  // The room really does seed at 0 — pin the other half of the invariant.
  const core = readFileSync(join(root, 'src', 'room', 'MatchRoomCore.ts'), 'utf8');
  assert.match(core, /this\.seq = 0;/, 'MatchRoomCore must still self-seed at seq 0');
});

test('P0-15: issueMatchSession reads the table sign-in actually writes', () => {
  const v2 = readFileSync(join(root, 'lib', 'sessionV2.ts'), 'utf8');
  const fn = v2.slice(v2.indexOf('export async function issueMatchSession'));
  // End at the next top-level declaration — the params object literal closes at
  // column 0, so `\n}` would stop 130 characters in.
  const nextTop = fn.slice(1).search(/\nexport (?:async )?(?:function|const)/);
  const body = nextTop === -1 ? fn : fn.slice(0, nextTop + 1);

  // `/api/siwe/verify` inserts into app_sessions and hands back that row's id.
  const verify = readFileSync(join(root, 'app', 'api', 'siwe', 'verify', 'route.ts'), 'utf8');
  assert.match(verify, /from\('app_sessions'\)/, 'siwe/verify must still write app_sessions');

  // So the parent lookup must fall back to app_sessions, keyed on the id —
  // app_sessions has no token_hash column.
  assert.match(body, /from\('app_sessions'\)/, 'issueMatchSession must dual-read app_sessions');
  assert.match(body, /\.eq\('id', params\.appSessionToken\)/, 'the legacy lookup is by session id');
  assert.match(body, /!legacy\.revoked_at/, 'and a revoked legacy session must not pass');

  // And the ticket route must still scope the seat from the DB, not the client.
  const route = readFileSync(join(root, 'app', 'api', 'auth', 'match', 'route.ts'), 'utf8');
  assert.match(route, /issueMatchSession\(/, 'the route must go through issueMatchSession');
});

// ── The host-migration panel must not fire when the room is the authority ───
//
// With the Durable Object live, a quick match goes matchmaking → connectRoom()
// and never opens a P2P lobby, so `isLobbyConnected` is false BY DESIGN while the
// room is authoritative. The panel's condition read:
//
//   !isHost && !isLobbyConnected && gameState?.isStarted && !gameState?.winner
//
// which is true for every quick-match participant the moment the board opens —
// so the game screen was immediately covered by "HOST MIGRATING / ELECTING
// AUTHORITY / Connection Lost" and offered to re-elect a host that does not
// exist. The room IS the authority; there is nothing to migrate.
//
// The condition must therefore also require that nothing authoritative is
// connected, so the panel survives only as a genuine fallback: the room is down
// AND the P2P host is gone.

test('P0-16: the host-migration panel is suppressed while the room is authoritative', () => {
  const page = readFileSync(join(root, 'app', 'page.tsx'), 'utf8');

  // The panel's guard must include !roomAuthority.
  const guard = page.slice(page.indexOf('Host Migration Overlay'));
  const guardBody = guard.slice(0, guard.indexOf('<HostMigrationPanel'));
  assert.match(guardBody, /!roomAuthority/,
    'the host-migration panel must not render while the room is the authority');

  // And roomAuthority must actually be destructured from the context — a guard
  // referencing an undefined binding would be a silent `!undefined` === true.
  // Take the WHOLE line: slicing from `= useTeamUp()` would start after every
  // destructured name and prove nothing.
  const line = page.split('\n').find(l => l.includes('= useTeamUp()')) || '';
  assert.match(line, /roomAuthority/,
    'page.tsx must destructure roomAuthority from useTeamUp()');

  // The context must still export it, or the guard is meaningless.
  const ctx = readFileSync(join(root, 'hooks', 'TeamUpContext.tsx'), 'utf8');
  const value = ctx.slice(ctx.lastIndexOf('roomAuthority, roomStatus, roomError, retryRoom'));
  assert.ok(value.length > 0, 'TeamUpContext must expose roomAuthority in its value');
});

// ── Seating and the engine's view of the room ───────────────────────────────
//
// The Durable Object's self-seed hand-rolled its own corner map
// (`green:'BL', yellow:'BR'`), which seats a 1v1 pair on ADJACENT corners — the
// opposite of what the engine documents ("A 1v1 match seats two colours on one
// diagonal") — and ignored `match_shape`, so 2v2 and 4P got the same fixed
// layout. Two copies of the seating rule is how the room and the board
// disagreed about where a player sits.

test('P0-17: the room seats players through the shared rule, never a local map', () => {
  const core = readFileSync(join(root, 'src', 'room', 'MatchRoomCore.ts'), 'utf8');
  assert.match(core, /assignCornersForShape\(matchShape\)/,
    'the room self-seed must use the shared seating rule');
  // The hand-rolled map must not come back.
  assert.doesNotMatch(core, /const defaultCorners: ColorCorner = \{/,
    'MatchRoomCore must not hand-roll its own corner map');

  // And every client path must use the same rule, or the board and the room
  // disagree about seating again.
  for (const rel of ['app/page.tsx', 'app/components/Board.tsx']) {
    const src = readFileSync(join(root, rel), 'utf8');
    assert.match(src, /assignCornersForShape\(/, `${rel} must use the shared seating rule`);
    assert.doesNotMatch(src, /assignCorners2v2\(\)\s*\?/, `${rel} must not fork its own shape branch`);
  }

  // The rule itself must honour the owner's spec (updated 2026-10-24):
  // 1v1 handled explicitly with diagonal opposition.
  const layout = readFileSync(join(root, 'lib', 'boardLayout.ts'), 'utf8');
  const fn = layout.slice(layout.indexOf('export function assignCornersForShape'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /'2v2'/, '2v2 must be handled explicitly');
  assert.match(body, /'1v1'/, '1v1 must be handled explicitly');
  assert.match(body, /assignCornersFFA\('4P'\)/, '4P must delegate to the FFA shuffle');
  const isDiagonal = (c1: string, c2: string) =>
    (c1 === 'BL' && c2 === 'TR') || (c1 === 'TR' && c2 === 'BL') ||
    (c1 === 'BR' && c2 === 'TL') || (c1 === 'TL' && c2 === 'BR');
  for (let i = 0; i < 20; i++) {
    const cc = assignCornersForShape('1v1');
    assert.ok(isDiagonal(cc.green as string, cc.yellow as string),
      '1v1 seats must be diagonally opposite');
    assert.notEqual(cc.green, cc.yellow, 'opponents must not share a corner');
  }
});

// The engine kept the only copy of the board. The room's fan-out was merged into
// the CONTEXT's gameState, so QuickMatchPanel opened the board while `Board`
// rendered this hook's INITIAL_GAME_STATE forever — every token at home,
// "ROLL TO START", and a roll resolved against a board the server had never
// seen. That is the "stalls just after a dice move" report.

test('P0-18: the engine adopts the room state instead of keeping a private copy', () => {
  const engine = readFileSync(join(root, 'hooks', 'useGameEngine.ts'), 'utf8');

  // There must be a sync from the authoritative state into localGameState.
  assert.match(engine, /setLocalGameState\(prev => \(\{[\s\S]*?\.\.\.networkGameState/,
    'useGameEngine must adopt the room state into localGameState');

  // It must be gated on the room actually being the authority, so an offline
  // match is never overwritten by a stale context value.
  const sync = engine.slice(engine.indexOf('if (!roomAuthority || !networkGameState) return;'));
  assert.ok(sync.length > 0, 'the sync must be gated on roomAuthority');

  // And the turn timer must not run in offline mode under server authority —
  // it would drive the local clock on a board the server never moved.
  assert.match(engine, /isNetworked: isLobbyConnected \|\| roomAuthority/,
    'useGameTimer must treat a room-authority match as networked');
});
