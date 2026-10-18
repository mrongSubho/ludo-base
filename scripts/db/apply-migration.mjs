#!/usr/bin/env node
/**
 * Repeatable migration task (Phase 3 / DB).
 *
 * Applies ONE canonical migration file to the target Supabase database, then
 * runs its verification queries — so "apply" and "confirm" are a single repeat.
 *
 *   npm run db:migrate                        # apply + verify
 *   npm run db:migrate -- --file <path>       # apply a specific file
 *   npm run db:migrate -- --dry-run           # print the SQL, touch nothing
 *   npm run db:migrate -- --force             # re-run even if the ledger matches
 *   npm run db:migrate:verify                 # verification queries only
 *
 * TRANSPORT PRIORITY (the first configured one wins):
 *   1. supabase CLI — `SUPABASE_DB_URL` set (or a linked project):
 *        supabase db push --db-url "$SUPABASE_DB_URL"   |   supabase db push --linked
 *      `supabase` must be resolvable; set LUDO_SUPABASE_BIN to point at the
 *      binary explicitly when it is not on PATH. NOTE: it is NOT installed in
 *      this workspace — `~/.supabase/cli-latest` is a fingerprint file, not a
 *      binary.
 *   2. psql — `SUPABASE_DB_URL` set (PGPASSWORD or a URL-embedded password).
 *   3. Management API — `SUPABASE_ACCESS_TOKEN` set; the project ref comes from
 *      NEXT_PUBLIC_SUPABASE_URL, so no CLI and no connection string is needed.
 *   4. Nothing configured — prints the file path plus the Dashboard SQL Editor
 *      steps and exits 3. It never reports success it did not achieve.
 *
 * The service-role REST key in `.env.local` CANNOT run DDL (PostgREST is not a
 * SQL executor), which is why it is deliberately not a transport. It IS used
 * for the read-only pre-flight checks below.
 *
 * A gitignored `.supabase-applied.json` ledger records what was applied, keyed
 * by content hash, so a re-run is a no-op unless `--force` is passed.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// This file lives in scripts/db/, so the repo root is two levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER = join(ROOT, '.supabase-applied.json');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

// ── Env + paths ────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !m[1].startsWith('#') && !line.trim().startsWith('#')) {
      out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function latestMigration() {
  const dir = join(ROOT, 'supabase', 'migrations');
  const sql = readdirSync(dir)
    .filter((f) => /^\d{6,}\d*_.*\.sql$/.test(f))
    .sort();
  if (sql.length === 0) throw new Error(`no canonical migrations in ${dir}`);
  return join(dir, sql[sql.length - 1]);
}

function projectRef(env) {
  const m = /https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/.exec(env.NEXT_PUBLIC_SUPABASE_URL || '');
  return m ? m[1] : null;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function ledger() {
  if (!existsSync(LEDGER)) return {};
  try {
    return JSON.parse(readFileSync(LEDGER, 'utf8'));
  } catch {
    return {};
  }
}

function canRun(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate a usable `supabase` binary. LUDO_SUPABASE_BIN wins, then a project
 * devDependency, then the standalone release at ~/.local/bin (the documented
 * install location for a machine-wide CLI that is NOT installed via npm), then
 * plain PATH. Returns null when none is usable.
 */
function findSupabaseBin() {
  const home = process.env.HOME || '';
  const candidates = [
    process.env.LUDO_SUPABASE_BIN,
    join(ROOT, 'node_modules', '.bin', 'supabase'),
    home ? join(home, '.local', 'bin', 'supabase') : null,
    'supabase', // PATH
  ].filter(Boolean);

  for (const c of candidates) {
    if (!canRun(c)) continue;
    try {
      // A file that is not the CLI (e.g. the stale ~/.supabase/cli-latest
      // fingerprint) must not masquerade as one.
      execFileSync(c, ['--version'], { stdio: 'pipe', timeout: 15_000 });
      return c;
    } catch {
      // resolvable but broken — try the next candidate
    }
  }
  return null;
}

// ── Pre-flight (read-only, works today via the service-role REST key) ──────

async function preflight(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db
    .from('mission_vouchers')
    .select('id, signature')
    .eq('signature', 'pending')
    .limit(50);
  if (error) {
    console.log(`pre-flight: could not read mission_vouchers (${error.message}) — continuing.`);
    return;
  }
  const pending = (data ?? []).length;
  console.log(`pre-flight: ${pending} pending reservation(s) visible right now.`);
}

// ── Verification queries ───────────────────────────────────────────────────

const CHECKS = [
  {
    key: 'stale pending reservations left after the sweep (must be 0)',
    hard: true,
    query: `select count(*) as still_stuck from public.mission_vouchers
            where signature = 'pending'
              and coalesce(reserved_at, created_at) < now() - interval '24 hours'`,
    pass: (r) => Number(r?.still_stuck) === 0,
  },
  {
    key: 'reclaimed rows archived (audit trail)',
    hard: false,
    query: `select mission_id, count(*) as reclaimed, min(created_at) as oldest, max(reclaimed_at) as swept_at
            from public.mission_vouchers_reclaimed group by mission_id order by mission_id`,
    pass: () => true,
  },
  {
    key: 'in-flight reservations left alone (informational)',
    hard: false,
    query: `select count(*) as in_flight from public.mission_vouchers
            where signature = 'pending'
              and coalesce(reserved_at, created_at) >= now() - interval '24 hours'`,
    pass: () => true,
  },
  {
    key: 'signed vouchers preserved (informational — must never drop)',
    hard: false,
    query: `select count(*) as signed from public.mission_vouchers
            where signature is not null and signature <> 'pending'`,
    pass: () => true,
  },
];

function report(key, ok, row) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${key}${row === undefined ? '' : `  ->  ${JSON.stringify(row)}`}`);
  return ok;
}

async function verify(env) {
  const dbUrl = env.SUPABASE_DB_URL || env.DB_URL;
  const pat = env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef(env);
  const psql = canRun('psql');

  // psql speaks SQL directly, so it is the preferred verification transport;
  // the Management API is the no-CLI fallback.
  if (dbUrl && psql) {
    let allOk = true;
    for (const c of CHECKS) {
      try {
        const out = execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t', '-c', c.query], {
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
        }).trim();
        const rows = out ? out.split('\n').map((line) => line.split('\t')) : [];
        const headers = (c.query.match(/select\s+(.*?)\s+from/is)?.[1] ?? '')
          .split(',')
          .map((h) => h.trim().split(/\s+as\s+/i).pop());
        const first = {};
        (rows[0] ?? []).forEach((v, i) => {
          first[headers[i] ?? i] = v;
        });
        allOk = report(c.key, c.pass(first), first) && allOk;
      } catch (e) {
        console.log(`ERROR ${c.key}: ${e.message.split('\n')[0]}`);
        allOk = false;
      }
    }
    return allOk;
  }

  if (pat && ref) {
    let allOk = true;
    for (const c of CHECKS) {
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: c.query }),
        });
        const rows = res.ok ? await res.json() : [];
        allOk = report(c.key, c.pass(rows?.[0]), rows?.[0]) && allOk;
      } catch (e) {
        console.log(`ERROR ${c.key}: ${e.message}`);
        allOk = false;
      }
    }
    return allOk;
  }

  console.log('\nNo SQL transport configured — run these by hand in the Dashboard SQL Editor:');
  for (const c of CHECKS) console.log(`\n-- ${c.key}\n${c.query};`);
  return null; // "unverified", not "failed"
}

// ── Transports ─────────────────────────────────────────────────────────────

async function applyViaCli(dbUrl, linked, bin) {
  const exe = bin || 'supabase';
  // --yes is a global flag: without it `db push` stops on an interactive prompt,
  // which makes the task unusable from CI or any non-TTY shell.
  const args = linked
    ? ['db', 'push', '--linked', '--yes']
    : ['db', 'push', '--db-url', dbUrl, '--yes'];
  console.log(`transport: supabase CLI (${exe}) -> ${args.join(' ')}`);
  execFileSync(exe, args, { cwd: ROOT, stdio: 'inherit', maxBuffer: 32 * 1024 * 1024 });
}

/**
 * A percent-encoded password has exactly one '@' in the authority (the
 * userinfo/host separator). More than one means the password still holds a
 * literal '@' — some clients split on the first '@' and then try to connect to
 * `so0vo@host`, which fails in a way that looks like a bad password.
 */
function warnOnUnencodedPassword(dbUrl) {
  if (!dbUrl) return;
  const authority = dbUrl.replace(/^[a-zA-Z0-9+.-]+:\/\//, '').split('/')[0];
  const at = authority.match(/@/g) || [];
  if (at.length > 1) {
    const userinfo = authority.slice(0, authority.lastIndexOf('@'));
    const fixed = dbUrl.replace(userinfo, userinfo.replace(/@/g, '%40'));
    console.warn(
      'WARNING: the database URL has a literal @ in the password. Percent-encode it as %40, e.g.:\n' +
        `  export SUPABASE_DB_URL='${fixed}'`,
    );
  }
}

async function applyViaPsql(dbUrl, file) {
  console.log('transport: psql (ON_ERROR_STOP, single transaction)');
  execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], {
    cwd: ROOT,
    stdio: 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function applyViaManagementApi(pat, ref, sql) {
  console.log(`transport: Supabase Management API (project ${ref})`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body.slice(0, 400)}`);
  console.log('accepted.');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const target = opt('--file') || process.env.LUDO_MIGRATION_FILE || latestMigration();
  const rel = target.startsWith(ROOT) ? target.slice(ROOT.length + 1) : target;
  const sql = readFileSync(target, 'utf8');
  const hash = sha256(sql);
  const env = { ...loadEnvLocal(), ...process.env };

  console.log(`migration: ${rel}`);
  console.log(`sha256:    ${hash.slice(0, 16)}…`);

  if (flag('--verify-only')) {
    const ok = await verify(env);
    process.exit(ok === false ? 1 : 0);
  }

  await preflight(env);

  const done = ledger()[rel];
  if (done?.hash === hash && !flag('--force')) {
    console.log('already applied (ledger match) — nothing to do. Use --force to re-run.');
    const ok = await verify(env);
    process.exit(ok === false ? 1 : 0);
  }

  if (flag('--dry-run')) {
    console.log('\n--- dry run: SQL that would be sent ---\n');
    console.log(sql);
    process.exit(0);
  }

  const dbUrl = env.SUPABASE_DB_URL || env.DB_URL;
  const pat = env.SUPABASE_ACCESS_TOKEN;
  const cliBin = findSupabaseBin();
  const cli = cliBin !== null;
  const ref = projectRef(env);
  let transport = null;

  if (cli) console.log(`supabase CLI: ${cliBin}${cliBin === 'supabase' ? ' (PATH)' : ''}`);
  if (dbUrl) warnOnUnencodedPassword(dbUrl);

  if (dbUrl && cli) {
    await applyViaCli(dbUrl, false, cliBin);
    transport = 'supabase-cli';
  } else if (dbUrl && canRun('psql')) {
    await applyViaPsql(dbUrl, target);
    transport = 'psql';
  } else if (pat && ref) {
    await applyViaManagementApi(pat, ref, sql);
    transport = 'management-api';
  } else {
    console.error(`
No apply transport is configured, so NOTHING was sent to the database.
(The Supabase CLI itself is${cli ? '' : ' NOT'} available${cli ? '' : ' — install it with \`npm install --save-dev supabase\` or the standalone release from github.com/supabase/cli/releases'}, but a database target is still needed.)

Pick one:
  A) Supabase CLI — point it at a connection string:
       export SUPABASE_DB_URL='postgresql://postgres.<ref>:<pw>@<host>:5432/postgres'
       npm run db:migrate
     …or link the project once, then it uses --db push --linked:
       supabase link --project-ref ${ref ?? '<ref>'}
  B) Management API (no CLI, no connection string — just a PAT):
       export SUPABASE_ACCESS_TOKEN=<your personal access token>
       npm run db:migrate
  C) Dashboard SQL Editor (works today, no token):
       1. https://supabase.com/dashboard/project/${ref ?? '<ref>'}/sql/new
       2. Paste this file: ${rel}
       3. Run it — it is wrapped in begin/commit, so it applies atomically.

Note: the service-role REST key in .env.local cannot execute DDL (PostgREST is
not a SQL executor), which is why it is not offered as an option.
`);
    process.exit(3);
  }

  const all = ledger();
  all[rel] = { hash, transport, appliedAt: new Date().toISOString() };
  writeFileSync(LEDGER, JSON.stringify(all, null, 2) + '\n');
  console.log(`applied via ${transport}. ledger updated: .supabase-applied.json`);

  console.log('\nverification:');
  const ok = await verify(env);
  process.exit(ok === false ? 1 : 0);
}

main().catch((e) => {
  console.error(`migration task failed: ${e.message}`);
  process.exit(1);
});
