/**
 * Q6 — migration RLS regression checker (static).
 * Scans supabase/migrations for money-column grants to `anon` / `authenticated`
 * and missing `enable row level security`. CI-friendly (no live Postgres required);
 * full SQL semantics still need a scratch DB apply in a follow-up job.
 *
 * Run: npm run check:rls
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');

const MONEY_COLUMNS = [
    'coins',
    'amount',
    'wager',
    'prize',
    'balance',
    'entry_fee',
    'stake',
    'payout',
];

const DANGEROUS_ROLES = /\b(anon|public)\b/i;

let failures = 0;
let files = 0;

function fail(msg) {
    console.error('✗', msg);
    failures += 1;
}

try {
    const entries = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    files = entries.length;
    for (const f of entries) {
        const sql = readFileSync(join(dir, f), 'utf8');
        // Write grants to anon on tables with money-like columns
        for (const col of MONEY_COLUMNS) {
            const grantRe = new RegExp(`grant\\s+(insert|update|delete|all)\\b[^;]*\\b${col}\\b[^;]*\\bto\\s+[^;]*`, 'gi');
            for (const m of sql.match(grantRe) || []) {
                if (DANGEROUS_ROLES.test(m)) {
                    fail(`${f}: dangerous write grant involving money column '${col}': ${m.slice(0, 120)}`);
                }
            }
        }
        // UPDATE/INSERT grants to anon
        if (/\bgrant\s+(update|insert)\b[^;]*\bto\s+[^;]*\banon\b/i.test(sql)) {
            fail(`${f}: grant insert/update to anon`);
        }
        // Tables created should enable RLS (heuristic: CREATE TABLE without later ENABLE)
        const creates = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)].map((m) => m[1]);
        for (const table of creates) {
            const bare = table.replace(/"/g, '');
            if (!new RegExp(`alter\\s+table\\s+${bare.replace('.', '\\.')}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql)
                && !/enable\s+row\s+level\s+security/i.test(sql)) {
                fail(`${f}: CREATE TABLE ${bare} has no 'enable row level security' in file`);
            }
        }
    }
} catch (err) {
    fail(`cannot read migrations: ${err}`);
}

if (failures === 0) {
    console.log(`✓ RLS static gate clean (${files} migrations)`);
    process.exit(0);
}
console.error(`RLS static gate failed: ${failures} finding(s) in ${files} file(s)`);
process.exit(1);
