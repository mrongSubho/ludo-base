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
import { readFileSync, existsSync } from 'node:fs';
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
  const stripped = (() => {
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
  })();
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

test('P0-6: Local development documentation exists', () => {
  const devDocPath = join(root, 'docs/dev/LOCAL_DEVELOPMENT.md');
  assert.ok(existsSync(devDocPath), 'docs/dev/LOCAL_DEVELOPMENT.md must exist');

  const content = readFileSync(devDocPath, 'utf8');
  assert.ok(content.includes('NEXT_PUBLIC_ROOM_WS_URL'), 'Must document NEXT_PUBLIC_ROOM_WS_URL');
  assert.ok(content.includes('Option A: Staging DO Tunnel'), 'Must document Option A');
  assert.ok(content.includes('Option B: Dev WS Sidecar'), 'Must document Option B');
});
