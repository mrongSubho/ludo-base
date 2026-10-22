#!/usr/bin/env node
/**
 * Migration-applied gate.
 *
 * Why this exists: on 2026-10-22 the server-owned-lobby work shipped three
 * migrations that were never pushed to the remote database. Every static gate
 * passed — `check:schema` and `check:rls` verify the migration *files* are
 * consistent with each other, and they never touch the database. So the suite was
 * green while `match_seats` did not exist remotely, `assign_match_seats` was a
 * 404, no seats were ever written, the room could not self-seed, and every 1v1
 * match stalled on "Still linking both players…" with no error anywhere.
 *
 * A static gate cannot catch that class of failure. This one compares local
 * migration files against the remote `supabase_migrations` history and fails when
 * a local migration has no remote counterpart.
 *
 * Skips (exit 0, with a notice) when the check cannot run — no CLI, no linked
 * project, or no credentials — so CI without database access is unaffected. A
 * skip is reported as a skip, never as a pass.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;

function findSupabaseBin() {
  const candidates = [
    process.env.LUDO_SUPABASE_BIN,
    join(ROOT, 'node_modules', '.bin', 'supabase'),
    join(homedir(), '.local', 'bin', 'supabase'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    execFileSync('which', ['supabase'], { stdio: 'ignore' });
    return 'supabase';
  } catch {
    return null;
  }
}

function localMigrations() {
  const dir = join(ROOT, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => /^\d{6,}\d*_.*\.sql$/.test(f))
    .map((f) => f.split('_')[0])
    .sort();
}

const bin = findSupabaseBin();
if (!bin) {
  console.log('○ migrations-applied gate SKIPPED (no supabase CLI found)');
  process.exit(0);
}
if (!existsSync(join(ROOT, 'supabase', '.temp', 'linked-project.json'))) {
  console.log('○ migrations-applied gate SKIPPED (project not linked)');
  process.exit(0);
}

let out;
try {
  out = execFileSync(bin, ['migration', 'list'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  const msg = String(err?.stderr || err?.message || err);
  if (/password|credentials|login|unauthorized|token/i.test(msg)) {
    console.log('○ migrations-applied gate SKIPPED (no database credentials)');
    process.exit(0);
  }
  console.error('✗ migrations-applied gate could not read the remote history');
  console.error(msg.trim().slice(0, 400));
  process.exit(1);
}

// Rows look like:  `202610220001`   | `202610220001`   | `202610220001`
//                  `202610220001`   | ` `              | `202610220001`
// Columns: local | remote | time. An empty remote column means "not applied".
const pending = [];
for (const line of out.split('\n')) {
  if (!line.includes('|')) continue;
  const cols = line.split('|').map((c) => c.replace(/`/g, '').trim());
  const [local, remote] = cols;
  if (!local || !/^\d{6,}$/.test(local)) continue;
  if (!remote) pending.push(local);
}

const local = localMigrations();
const unknownLocally = pending.filter((v) => !local.includes(v));

if (pending.length > 0) {
  console.error(`✗ ${pending.length} local migration(s) are NOT applied to the remote database:`);
  for (const v of pending) console.error(`    ${v}`);
  if (unknownLocally.length > 0) {
    console.error('  (some of these have no local file — the remote is ahead; reconcile first)');
  }
  console.error('\n  Fix:  ~/.local/bin/supabase --yes db push');
  console.error('  Then:  ~/.local/bin/supabase migration list   (Remote column must be filled)');
  console.error('\n  A green `check:schema` does NOT mean the schema is deployed — it only');
  console.error('  compares migration files to each other. That gap is why the 2026-10-22');
  console.error('  1v1 stall shipped with every gate green.');
  process.exit(1);
}

console.log(`✓ migrations-applied gate clean (${local.length} local migrations, all applied remotely)`);
