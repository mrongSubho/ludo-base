/**
 * Schema contract gate.
 *
 * Static (no database required, runs in CI):
 *   A1  every `create or replace function` preserves arg names, arity and return
 *       type against the previous definition in chain order
 *       -> catches the DB-01 footgun: CREATE OR REPLACE cannot rename input
 *          parameters, it raises and (in a non-transactional file) silently
 *          truncates the rest of the migration.
 *   A2  every `.rpc('name', { named args })` call site resolves to a
 *       migration-defined signature that declares all of those arg names
 *       -> catches DB-01 from the call side, which is how it shipped.
 *   A3  `match_rolls.status` column_default is a value the Edge boundary
 *       accepts as unspent (`OPEN_ROLL_STATUSES`)
 *       -> catches the DB-02 vocabulary split.
 *   A4  every DDL migration is transaction-wrapped unless explicitly allowlisted
 *       -> prevents a repeat of DB-01/DB-03 partial application.
 *
 * With LUDO_SCHEMA_DB_URL set, additionally applies the chain to a scratch
 * database and asserts catalog invariants (see assertAgainstDatabase).
 *
 * Run: npm run check:schema
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migDir = join(root, 'supabase', 'migrations');

let failures = 0;
const fail = (m) => { console.error('✗', m); failures += 1; };
const warn = (m) => { console.warn('!', m); };

/* ------------------------------------------------------------------ utils */

function splitTopLevel(body) {
    const out = [];
    let depth = 0, cur = '', inStr = null;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (inStr) {
            cur += c;
            if (c === inStr && body[i - 1] !== '\\') inStr = null;
            continue;
        }
        if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
}

/** Index just past the paren opened at `start`. */
function matchParen(sql, start) {
    let depth = 0;
    for (let i = start; i < sql.length; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

function topLevelKeys(objBody) {
    const keys = [];
    let depth = 0, inStr = null;
    for (let i = 0; i < objBody.length; i++) {
        const c = objBody[i];
        if (inStr) { if (c === inStr && objBody[i - 1] !== '\\') inStr = null; continue; }
        if (c === '"' || c === "'") { inStr = c; continue; }
        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') depth--;
        else if (c === ':' && depth === 0) {
            const before = objBody.slice(0, i);
            const m = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
            if (m) keys.push(m[1]);
        }
    }
    return [...new Set(keys)];
}

function* walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) yield* walk(p);
        else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) yield p;
    }
}

const rel = (p) => p.slice(root.length + 1);

/* ------------------------------------------------- parse SQL function defs */

const FN_RE = /create\s+(?:or\s+replace\s+)?function\s+([A-Za-z_][\w$]*)\s*(?:\.\s*([A-Za-z_][\w$]*)\s*)?\(/gi;

function parseFunctions(sql, file) {
    const defs = [];
    for (const m of sql.matchAll(FN_RE)) {
        const open = m.index + m[0].lastIndexOf('(');
        const close = matchParen(sql, open);
        if (close < 0) continue;
        // group1 is the FIRST identifier: for `function public.foo(` that is
        // "public" and group2 is "foo"; for `function foo(` group2 is absent.
        const qualified = m[2] !== undefined;
        const schema = (qualified ? m[1] : 'public').toLowerCase();
        const name = (qualified ? m[2] : m[1]).toLowerCase();
        const argText = sql.slice(open + 1, close);
        const args = splitTopLevel(argText).map((a) => {
            const cleaned = a.replace(/^(inout|in|out|variadic)\s+/i, '').trim();
            const am = cleaned.match(/^"?([A-Za-z_][\w$]*)"?\s+/);
            return { name: am ? am[1].toLowerCase() : null, text: cleaned };
        });
        const after = sql.slice(close + 1, close + 220);
        const rm = after.match(/returns\s+([A-Za-z_][\w$]*(?:\s*\[\s*\])?)/i);
        const returns = rm ? rm[1].toLowerCase().replace(/\s+/g, '') : null;
        defs.push({ file, schema, name, args, argNames: args.map((a) => a.name).filter(Boolean), returns });
    }
    return defs;
}

const sigKey = (d) => `${d.schema}.${d.name}(${d.argNames.length})`;

/* ------------------------------------------------------------ A1: DDL reuse */

function checkCreateOrReplace(defs) {
    const seen = new Map(); // sigKey -> { argNames, returns, file }
    for (const d of defs) {
        const key = sigKey(d);
        const prev = seen.get(key);
        if (!prev) { seen.set(key, d); continue; }
        const renamed = prev.argNames.filter((a) => !d.argNames.includes(a));
        const added = d.argNames.filter((a) => !prev.argNames.includes(a));
        if (renamed.length || added.length) {
            fail(`A1 ${d.file}: CREATE OR REPLACE changes input parameter names for ${key}`);
            fail(`     was (${prev.argNames.join(', ')}) in ${prev.file}`);
            fail(`     now (${d.argNames.join(', ')})`);
            fail('     Postgres raises "cannot change name of input parameter" and, in a');
            fail('     non-transactional file, silently skips every later statement.');
        }
        if (prev.returns && d.returns && prev.returns !== d.returns) {
            fail(`A1 ${d.file}: CREATE OR REPLACE changes return type for ${key}: ${prev.returns} -> ${d.returns}`);
            fail('     Postgres raises "cannot change return type" — rename the function instead.');
        }
        seen.set(key, d);
    }
}

/* ----------------------------------------------- A2: rpc() call-site args */

function collectRpcCallSites() {
    const sites = [];
    for (const dir of ['app', 'lib', 'hooks', 'supabase/functions']) {
        const abs = join(root, dir);
        if (!existsSync(abs)) continue;
        for (const p of walk(abs)) {
            const src = readFileSync(p, 'utf8');
            const re = /\.rpc\(\s*['"`]([\w$.]+)['"`]\s*,\s*\{/g;
            for (const m of src.matchAll(re)) {
                const open = m.index + m[0].lastIndexOf('{');
                const close = matchParen(src, open - 1) >= 0
                    ? (() => { let d = 0; for (let i = open; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return i; } } return -1; })()
                    : -1;
                if (close < 0) continue;
                const line = src.slice(0, m.index).split('\n').length;
                sites.push({ file: rel(p), line, fn: m[1].toLowerCase(), keys: topLevelKeys(src.slice(open + 1, close)) });
            }
        }
    }
    return sites;
}

function checkRpcArgs(defs, sites) {
    const byName = new Map();
    for (const d of defs) {
        if (!byName.has(d.name)) byName.set(d.name, []);
        byName.get(d.name).push(d);
    }
    for (const s of sites) {
        const cands = byName.get(s.fn);
        if (!cands || cands.length === 0) continue; // resolved elsewhere (e.g. generated types)
        if (!s.keys.length) continue;
        const ok = cands.some((d) => s.keys.every((k) => d.argNames.includes(k)));
        if (!ok) {
            const best = cands.reduce((a, b) => (b.argNames.length > a.argNames.length ? b : a));
            const unknown = s.keys.filter((k) => !best.argNames.includes(k));
            fail(`A2 ${s.file}:${s.line}: rpc('${s.fn}') passes arg(s) ${unknown.map((u) => `'${u}'`).join(', ')} not declared by any migration signature`);
            fail(`     declared: (${best.argNames.join(', ')})  [${best.file}]`);
        }
    }
}

/* ------------------------------------- A3: roll status default vs Edge code */

/** Effective column default for (table, column) after applying the chain in order. */
function effectiveDefaults(allSql) {
    const defaults = new Map(); // "table.column" -> default literal
    const strip = (s) => s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

    // CREATE TABLE ... ( col type [default 'x'] , ... )
    for (const m of strip(allSql).matchAll(
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[\w"]+\.)?"?(\w+)"?\s*\(([^;]*?)\n\s*\);/gi)) {
        const table = m[1].toLowerCase();
        for (const part of splitTopLevel(m[2])) {
            const cd = part.match(/^"?(\w+)"?\s+[^,]*?default\s+'([^']*)'/i);
            if (cd) defaults.set(`${table}.${cd[1].toLowerCase()}`, cd[2]);
        }
    }
    // ALTER TABLE t ALTER COLUMN c SET DEFAULT 'x'  (wins over create-table).
    // [^;] is deliberate: a lazy [\s\S]? crosses statement boundaries and will
    // happily pair one statement's ALTER TABLE with a later SET DEFAULT.
    for (const m of strip(allSql).matchAll(
        /alter\s+table\s+(?:if\s+exists\s+)?(?:[\w"]+\.)?"?(\w+)"?[^;]*?alter\s+column\s+"?(\w+)"?\s+set\s+default\s+'([^']*)'/gi)) {
        defaults.set(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`, m[3]);
    }
    return defaults;
}

function checkRollStatusDefault(defaults) {
    const edge = join(root, 'supabase/functions/_shared/networkBoundary.ts');
    if (!existsSync(edge)) { warn('A3 skipped: networkBoundary.ts not found'); return; }
    const src = readFileSync(edge, 'utf8');
    const m = src.match(/OPEN_ROLL_STATUSES\s*(?::[^=]+)?=\s*\[([^\]]*)\]/);
    if (!m) { fail('A3 cannot read OPEN_ROLL_STATUSES from networkBoundary.ts'); return; }
    const allowed = m[1].split(',').map((s) => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);

    const dflt = defaults.get('match_rolls.status');
    if (dflt === undefined) {
        fail('A3 cannot resolve the match_rolls.status default from supabase/migrations');
        return;
    }
    if (!allowed.includes(dflt)) {
        fail(`A3 match_rolls.status default is '${dflt}' but the Edge boundary only treats ${allowed.map((a) => `'${a}'`).join(', ')} as unspent`);
        fail('     isDuplicateAction() would reject every roll as already consumed (409 DUPLICATE_ACTION).');
        fail('     See docs/ops/SYSTEM_REVIEW.md DB-02.');
    }
}

/* ------------------------------------------- A4: DDL files must be atomic */

const NON_TRANSACTIONAL_ALLOWLIST = new Set(['00000000000000_baseline.sql']);

const stripSqlComments = (s) => s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

function checkTransactionWrapping(files) {
    for (const { file, sql } of files) {
        const base = file.split('/').pop();
        if (NON_TRANSACTIONAL_ALLOWLIST.has(base)) continue;
        const body = stripSqlComments(sql);
        const hasDdl = /\b(create\s+(?:or\s+replace\s+)?(table|function|trigger|index|policy)|alter\s+table)\b/i.test(body);
        if (!hasDdl) continue;
        const begins = /^\s*(begin|start\s+transaction)\s*;/i.test(body);
        const commits = /\b(commit|end)\s*(transaction\s*)?;?\s*$/i.test(body.trim());
        const oneStatement = (body.match(/;\s*\S/g) || []).length === 0;
        if (!(begins && commits) && !oneStatement) {
            fail(`A4 ${base}: contains DDL but is not wrapped in a transaction`);
            fail('     A mid-file error will apply earlier statements and silently skip the rest.');
            fail('     Either wrap it (begin; ... commit;) or add it to NON_TRANSACTIONAL_ALLOWLIST with a reason.');
        }
    }
}

/* ------------------------------------------ optional: real database asserts */

async function assertAgainstDatabase(url, files) {
    let Client;
    try { ({ Client } = await import('pg')); }
    catch { warn('DB mode skipped: `pg` is not installed (npm i -D pg to enable)'); return; }

    const c = new Client({ connectionString: url });
    await c.connect();
    try {
        await c.query('drop schema if exists public cascade; create schema public;');
        await c.query('create schema if not exists extensions');
        for (const role of ['anon', 'authenticated', 'service_role']) {
            await c.query(`do $$ begin if not exists (select 1 from pg_roles where rolname='${role}') then execute format('create role %I nologin','${role}'); end if; end $$;`);
        }
        // CREATE PUBLICATION cannot run inside plpgsql, and the baseline's
        // `alter publication supabase_realtime add table` needs it to exist.
        // Supabase projects always have it; a scratch CI Postgres does not.
        try {
            await c.query('create publication supabase_realtime');
        } catch (err) {
            if (err.code !== '42710') throw err; // 42710 = duplicate_object
        }

        for (const { file, sql } of files) {
            try { await c.query(sql); }
            catch (err) {
                fail(`DB ${file}: ${err.message.split('\n')[0]}`);
                return;
            }
        }

        const { rows: def } = await c.query(
            `select table_name, column_name, column_default from information_schema.columns
             where table_name='match_rolls' and column_name='status'`);
        if (!def[0]?.column_default?.includes("'open'")) {
            fail(`DB match_rolls.status default is ${def[0]?.column_default} (expected 'open')`);
        }

        // Security-definer functions must not be callable by anon/authenticated
        // or by PUBLIC. Uses has_function_privilege rather than parsing proacl:
        // an earlier version gated on `!/service_role/.test(acl)`, which is
        // always false in the correct end state (service_role *should* hold
        // EXECUTE), so the assertion could never fire. A security gate that
        // silently passes is worse than no gate.
        //
        // Trigger functions (returns trigger) are excluded: they have no
        // callable entry point, so EXECUTE on them is inert.
        const { rows: sdef } = await c.query(
            `select p.proname,
                    has_function_privilege('anon',         p.oid, 'EXECUTE') as anon_exec,
                    has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.prosecdef
                and p.prokind = 'f'            -- functions only, not procedures
                and p.prorettype <> 'trigger'::regtype`);
        for (const f of sdef) {
            if (f.anon_exec || f.auth_exec) {
                const who = [f.anon_exec ? 'anon' : null, f.auth_exec ? 'authenticated' : null]
                    .filter(Boolean).join('/');
                fail(`DB security definer ${f.proname} is executable by ${who} (directly or via PUBLIC)`);
            }
        }

        const { rows: granted } = await c.query(
            `select table_name from information_schema.role_table_grants
             where grantee='anon' and privilege_type='UPDATE'`);
        if (granted.length) fail(`DB anon has UPDATE on: ${granted.map((g) => g.table_name).join(', ')}`);

        console.log(`✓ DB mode: chain applied, ${sdef.length} security definer fns + grants asserted`);
    } finally { await c.end(); }
}

/* ------------------------------------------------------------------- main */

let files = [];
try {
    files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
        .map((f) => ({ file: join('supabase/migrations', f), sql: readFileSync(join(migDir, f), 'utf8') }));
} catch (err) {
    fail(`cannot read migrations: ${err}`);
    process.exit(1);
}

const defs = files.flatMap((f) => parseFunctions(f.sql, f.file));
const allSql = files.map((f) => f.sql).join('\n');

checkCreateOrReplace(defs);
checkRpcArgs(defs, collectRpcCallSites());
checkRollStatusDefault(effectiveDefaults(allSql));
checkTransactionWrapping(files);

const url = process.env.LUDO_SCHEMA_DB_URL;
if (url) await assertAgainstDatabase(url, files);
else console.log('  (set LUDO_SCHEMA_DB_URL to also apply the chain and assert grants)');

if (failures === 0) {
    console.log(`✓ schema contract gate clean (${files.length} migrations, ${defs.length} function defs)`);
    process.exit(0);
}
console.error(`\nschema contract gate failed: ${failures} finding(s) in ${files.length} file(s)`);
process.exit(1);
