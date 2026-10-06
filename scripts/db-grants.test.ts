/**
 * DB-09 — the grant allowlist (Phase 3).
 *
 * `anon` and `authenticated` held FULL table privileges on 36 public tables, so
 * RLS was the only thing denying access. That is one accidental policy away from
 * a breach: the grant is already there, waiting.
 *
 * The interesting risk is not the revocation — it is the allowlist. Grant too
 * little and the app breaks in production; grant too much and nothing changed.
 * So the allowlist is derived from the CODE and asserted against it: any new
 * client-side `.from(...)` on a table outside the list fails here rather than in
 * production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const readRoot = (p: string) => readFileSync(join(root, p), 'utf8');

const MIGRATION = 'supabase/migrations/202609300013_db09_grant_hardening.sql';

/** Tables the migration deliberately grants. Keep in step with the SQL. */
const ALLOWLIST = ['players', 'live_chat', 'live_matches', 'matches', 'tournaments'];

/**
 * Client-side queries that are knowingly NOT granted, with the reason.
 *
 * An allowlist test that quietly ignores exceptions is worse than no test, so
 * each one is named here and re-checked below. If the reason stops being true,
 * the test fails.
 */
const NOT_GRANTED: Record<string, string> = {
    matchmaking_queue:
        'holds validation_token; the baseline already revoked SELECT. ActivityFeed and ' +
        'LiveMatchmakingFeed query it client-side and have therefore read nothing since ' +
        'the baseline landed — a pre-existing bug, fixed by moving those reads server-side.',
    pokes:
        'subscribed via postgres_changes but has no RLS policy, so default-deny already ' +
        'stops it; it is also absent from the supabase_realtime publication. The ' +
        'subscription has never fired. Making it work is DB-27, not a grant change.',
    player_missions:
        'subscribed via postgres_changes but has no RLS policy, so default-deny already ' +
        'stops it. Making it work needs a per-player policy — DB-27.',
    game_invites:
        'subscribed via postgres_changes but has no RLS policy, and the row carries ' +
        'validation_token. Removed from the supabase_realtime publication by DB-27 ' +
        'rather than given a policy: nothing subscribes to it, and the invite secret ' +
        'is delivered by the join route response instead.',
};

/**
 * Directories that can reach PostgREST with the anon/authenticated key.
 *
 * `app/api/**` and `lib/serverAuth.ts` are excluded on purpose: server routes use
 * the service role, which bypasses RLS and needs no grant. Getting this boundary
 * wrong is how a server-only table ends up in the allowlist.
 */
const CLIENT_DIRS = ['app', 'hooks', 'lib'];

function clientFiles(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const rel = `${d}/${e.name}`;
            if (e.isDirectory()) walk(rel);
            else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
        }
    };
    for (const d of CLIENT_DIRS) {
        try {
            walk(d);
        } catch {
            /* directory may not exist */
        }
    }
    return out
        .filter((f) => !f.startsWith('app/api/'))
        .filter((f) => f !== 'lib/serverAuth.ts');
}

/** Tables a client-side file reaches through a client supabase instance. */
function clientDirectTables(): Map<string, Set<string>> {
    const hits = new Map<string, Set<string>>();
    for (const f of clientFiles()) {
        const src = readRoot(f);
        // Only files that import a client supabase. `@supabase/supabase-js` alone
        // is not enough — the server files import it too and pass in a
        // service-role client.
        const importsClient =
            /from ['"]@\/lib\/supabase['"]/.test(src) ||
            (/from ['"]@supabase\/supabase-js['"]/.test(src) && /createClient\(/.test(src));
        if (!importsClient) continue;
        // Both direct queries and realtime subscriptions: `postgres_changes` on a
        // table also needs a grant, and a subscription-only table would otherwise
        // look unused.
        const tables = [
            ...[...src.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g)].map((m) => m[1]),
            ...[...src.matchAll(/postgres_changes[\s\S]{0,300}?table:\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]),
        ];
        for (const t of tables) {
            if (!hits.has(t)) hits.set(t, new Set());
            hits.get(t)!.add(f);
        }
    }
    return hits;
}

// ── The migration itself ────────────────────────────────────────────────────

test('the migration is transactional, as the A4 gate requires', () => {
    const sql = readRoot(MIGRATION);
    assert.match(sql, /^begin;/m);
    assert.match(sql, /^commit;/m);
});

test('the SQL grants exactly the allowlist, read-only', () => {
    const sql = readRoot(MIGRATION);
    const grants = [...sql.matchAll(/grant select on public\.([a-z_]+)\s+to anon, authenticated;/g)].map((m) => m[1]);
    assert.deepEqual(grants.sort(), [...ALLOWLIST].sort(), 'the SQL grant list must equal the allowlist');
    // Nothing may grant a mutation.
    for (const priv of ['insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'all']) {
        assert.doesNotMatch(
            sql,
            new RegExp(`grant ${priv} on public\\.[a-z_]+ to anon`, 'i'),
            `no ${priv} grant may reach anon`,
        );
    }
});

test('the SQL revokes everything before it re-grants', () => {
    const sql = readRoot(MIGRATION);
    const revokeLoop = sql.indexOf("for t in select tablename from pg_tables");
    const firstGrant = sql.indexOf('grant select on public.');
    assert.ok(revokeLoop > 0 && firstGrant > revokeLoop, 'the blanket revoke must come first');
    assert.match(sql, /revoke all on public\.%I from anon/);
    assert.match(sql, /revoke all on public\.%I from authenticated/);
    // Sequences too, since REVOKE ALL ON TABLE drops owned sequence privileges.
    assert.match(sql, /pg_sequences/);
});

test('players keeps its narrow column grant, not a table-wide one', () => {
    const sql = readRoot(MIGRATION);
    assert.match(sql, /revoke select on public\.players from anon, authenticated;/);
    const cols = /grant select \(([\s\S]*?)\) on public\.players/.exec(sql);
    assert.ok(cols, 'players must be granted column-by-column');
    const listed = cols[1].split(',').map((s) => s.trim()).filter(Boolean);
    // Server-only columns must not appear.
    for (const secret of ['coins', 'peer_id', 'ecdh_pubkey', 'current_room_code']) {
        assert.ok(!listed.includes(secret), `players grant must not include ${secret}`);
    }
    assert.ok(listed.includes('wallet_address') && listed.includes('username'));
});

test('matchmaking_queue is deliberately left revoked', () => {
    // It holds `validation_token`. Revoking is right; the client code that reads
    // it is a separate pre-existing bug.
    const sql = readRoot(MIGRATION);
    assert.ok(!ALLOWLIST.includes('matchmaking_queue'));
    assert.doesNotMatch(sql, /grant select on public\.matchmaking_queue/);
});

// ── The allowlist matches the code ──────────────────────────────────────────

test('every client-side table query is in the allowlist', () => {
    const hits = clientDirectTables();
    const missing: string[] = [];
    for (const [table, files] of hits) {
        if (ALLOWLIST.includes(table)) continue;
        if (NOT_GRANTED[table]) continue; // documented exception, re-checked below
        missing.push(`${table} (${[...files].join(', ')})`);
    }
    assert.deepEqual(
        missing,
        [],
        'these tables are queried client-side but are NOT granted. Either add them to the\n' +
            'allowlist in 202609300013 or stop querying them from the client:\n  ' +
            missing.join('\n  '),
    );
});

test('the allowlist is not carrying dead entries', () => {
    // A grant for a table nothing reads is a grant with no justification.
    const hits = clientDirectTables();
    const unused = ALLOWLIST.filter((t) => !hits.has(t));
    assert.deepEqual(
        unused,
        [],
        'allowlisted but never queried client-side — remove the grant: ' + unused.join(', '),
    );
});

test('every documented exception is still justified', () => {
    // If a table stops being queried client-side, or the reason stops holding,
    // the exception should be deleted rather than left to rot.
    const sql = readRoot(MIGRATION);
    const hits = clientDirectTables();
    for (const [table, reason] of Object.entries(NOT_GRANTED)) {
        assert.ok(hits.has(table), `${table} is no longer queried client-side — delete the exception`);
        assert.ok(reason.length > 20, `${table} needs a stated reason`);
        assert.doesNotMatch(
            sql,
            new RegExp(`grant select on public\\.${table}\\b`),
            `${table} is granted despite being documented as not-granted`,
        );
    }
    assert.ok(
        Object.keys(NOT_GRANTED).length > 0,
        'the exception list must not be the escape hatch it was written to avoid',
    );
});

test('the three dead realtime subscriptions are recorded, not silently granted', () => {
    // Each has a postgres_changes subscription and no RLS policy, so it delivers
    // nothing. They are listed as exceptions rather than granted "just in case",
    // and DB-27 is what would actually make them work.
    for (const t of ['pokes', 'player_missions', 'game_invites']) {
        assert.ok(NOT_GRANTED[t], `${t} must be a documented exception`);
        assert.ok(!ALLOWLIST.includes(t), `${t} must not be granted`);
        const sql = readRoot(MIGRATION);
        assert.doesNotMatch(sql, new RegExp(`grant select on public\\.${t}\\b`));
    }
});

// ── RLS is still the policy, not the grant ──────────────────────────────────

test('every allowlisted table still has RLS enabled', () => {
    // The baseline enables RLS across a fixed list; each allowlisted table must
    // be in it, or the grant would be the only control.
    const block = /foreach t in array array\[([\s\S]*?)\]\s*\n\s*loop execute format\('alter table public\.%I enable row level security'/.exec(
        readRoot('supabase/migrations/00000000000000_baseline.sql'),
    );
    assert.ok(block, 'could not locate the baseline RLS loop');
    for (const t of ALLOWLIST) {
        assert.ok(block[1].includes(`'${t}'`), `${t} must have RLS enabled in the baseline`);
    }
});

/**
 * DB-10 — `live_matches` is column-scoped, not table-scoped.
 *
 * `live_matches_public_read` is `using (true)`, so a table-wide SELECT grant
 * publishes every column in the row. That included `join_secret_hash`,
 * `arena_key`, `authority_id` and `host_address` to the anon key. A test that
 * only checks "is live_matches granted?" would have passed while all four were
 * readable, so this asserts the column list.
 */
const LIVE_MATCHES_COLUMNS = [
    'match_id',
    'room_code',
    'bet_window_status',
    'spectator_count',
    'current_bet_type',
    'created_at',
];

const LIVE_MATCHES_SECRETS = ['join_secret_hash', 'arena_key', 'authority_id', 'host_address'];

test('DB-10: live_matches is granted column-wise, and no secret column is in it', () => {
    const migration =
        'supabase/migrations/202609300015_live_matches_column_scope.sql';
    const sql = readRoot(migration);

    assert.match(sql, /revoke select on public\.live_matches from anon, authenticated/);
    const granted = sql.slice(
        sql.indexOf('grant select (') + 'grant select ('.length,
        sql.indexOf(') on public.live_matches'),
    );
    const columns = granted
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

    for (const c of LIVE_MATCHES_COLUMNS) {
        assert.ok(columns.includes(c), `${c} must stay readable by spectators`);
    }
    for (const c of LIVE_MATCHES_SECRETS) {
        assert.ok(
            !columns.includes(c),
            `${c} must not be readable by a spectator — live_matches_public_read is using(true)`,
        );
    }
    // Every granted column has to be one the client actually selects. A column
    // that is public but unread is the next audit's problem.
    const client = clientFiles()
        .map((f) => readRoot(f))
        .join('\n');
    for (const c of columns) {
        assert.ok(client.includes(c), `${c} is granted but no client reads it`);
    }
});
