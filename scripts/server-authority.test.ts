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
