/**
 * Edge error opacity and bet settlement authority (Phase 3 / SEC-31, SEC-29).
 *
 * The SEC-31 property is the interesting one: a PostgREST error carries the table,
 * the column, the constraint, and a hint that literally reads
 *
 *   "Grant the required privileges to the current role with:
 *    GRANT SELECT ON public.<table> TO anon;"
 *
 * So an anonymous caller could enumerate the schema by reading error strings,
 * and errors are the easiest thing to trigger. This suite pins that no Edge
 * function returns a raw database or exception string.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    opaquePowerError,
    edgeErrorBody,
    edgeErrorStatus,
    CORS_HEADERS,
} from '../supabase/functions/_shared/errors';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

const EDGE = ['roll-dice', 'move-auth', 'resolve-bet'];

// ── SEC-31: nothing raw escapes ─────────────────────────────────────────────

test('no Edge function returns a raw database or exception string', () => {
    for (const fn of EDGE) {
        const src = code(`supabase/functions/${fn}/index.ts`);
        // Every one of these is "hand the client's error message to the client".
        for (const leak of [
            /error:\s*[a-zA-Z_$][\w$]*\.message/,
            /error:\s*\([a-zA-Z_$][\w$]* as Error\)\.message/,
            /JSON\.stringify\(\{\s*error:\s*[a-zA-Z_$][\w$]*\.message/,
            /JSON\.stringify\(\{\s*error:\s*err\.message/,
        ]) {
            assert.doesNotMatch(src, leak, `${fn}: leaks a raw message via ${leak}`);
        }
    }
});

test('no Edge function returns a PostgREST hint or code', () => {
    // `hint` is the field that suggests the GRANT. Logging it is fine; returning
    // it is not, and neither is returning `code`, which names the constraint.
    for (const fn of EDGE) {
        const src = code(`supabase/functions/${fn}/index.ts`);
        assert.doesNotMatch(src, /json\(\{[^}]*\bhint\b/, `${fn}: returns a hint`);
        assert.doesNotMatch(
            src,
            /JSON\.stringify\(\{[^}]*error:\s*[\w$]+\.hint/,
            `${fn}: returns a PostgREST hint`,
        );
    }
});

test('applyPower engine strings become fixed codes', () => {
    // "Power not held" tells a caller what another player is carrying.
    assert.equal(opaquePowerError('Not your turn'), 'NOT_YOUR_TURN');
    assert.equal(opaquePowerError('Match finished'), 'NOT_YOUR_TURN');
    assert.equal(opaquePowerError('Wrong phase'), 'WRONG_PHASE');
    assert.equal(opaquePowerError('Power already spent this turn'), 'ALREADY_SPENT');
    assert.equal(opaquePowerError('Power not held'), 'NOT_HELD');
    assert.equal(opaquePowerError('Bad token index'), 'BAD_TARGET');
    // An unknown string must still produce a code, never pass through.
    assert.equal(opaquePowerError('some new engine string'), 'BAD_TARGET');
});

test('move-auth uses the mapping and keeps only the safe flags', () => {
    const src = code('supabase/functions/move-auth/index.ts');
    assert.match(src, /opaquePowerError\(result\.error\)/);
    // The engine string may be logged, never returned.
    assert.doesNotMatch(src, /error:\s*result\.error/);
    assert.match(src, /error: 'Power could not be used'/);
    // armed/kept drive the UI and reveal nothing about another player.
    assert.match(src, /armed: result\.armed/);
    assert.match(src, /kept: result\.kept/);
});

test('every generic message is uninformative', () => {
    for (const c of ['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INTERNAL'] as const) {
        const body = edgeErrorBody(c);
        assert.equal(body.code, c);
        assert.ok(body.error.length > 0);
        // None may name a table, a column, a grant or a wallet.
        for (const leak of ['table', 'column', 'grant', 'select', 'insert', 'update', 'constraint', '0x']) {
            assert.ok(
                !body.error.toLowerCase().includes(leak),
                `${c} message leaks "${leak}": ${body.error}`,
            );
        }
        assert.ok(edgeErrorStatus(c) >= 400 && edgeErrorStatus(c) < 600);
    }
});

// ── SEC-29: settlement authority ────────────────────────────────────────────

test('SEC-29: the window must be closed before anything settles', () => {
    const src = code('supabase/functions/resolve-bet/index.ts');
    assert.match(src, /live\.bet_window_status === 'open'/, 'an open window must be refused');
    assert.match(src, /live\.bet_window_status === 'settled'/, 'an already-settled window must be refused');
    // Both refusals must happen BEFORE the RPC that moves money.
    const openGate = src.indexOf("bet_window_status === 'open'");
    const rpc = src.indexOf("chips_escrow_settle_bets");
    assert.ok(openGate > 0 && rpc > openGate, 'the gate must precede the settlement RPC');
});

test('SEC-29: the market settled is the one the authority recorded', () => {
    const src = code('supabase/functions/resolve-bet/index.ts');
    assert.match(src, /live\.current_bet_type/);
    assert.match(src, /if \(!recordedType\)/, 'a null recorded type must fail closed');
    assert.match(src, /recordedType !== String\(betType\)/, 'the signed type must match the recorded one');
    // The RPC is called with the recorded type, never the caller's.
    assert.match(src, /p_bet_type: settledBetType/);
    assert.doesNotMatch(src, /p_bet_type:\s*betType\b/);
});

test('SEC-29: a finished match with no recorded winner must not settle', () => {
    // The old guard was `if (winner != null && result !== winner)`, so a match
    // that finished with NO winner skipped the comparison and ANY result settled
    // the market.
    const src = code('supabase/functions/resolve-bet/index.ts');
    assert.match(src, /if \(winner == null\)/, 'a missing winner must be refused');
    assert.match(src, /String\(result\)\.toLowerCase\(\) !== String\(winner\)\.toLowerCase\(\)/);
    assert.doesNotMatch(src, /if \(winner != null &&/, 'the nullable guard is what let it through');
});

// ── The authority check that already existed must still be there ───────────

test('the signed-message and host checks are untouched', () => {
    const src = code('supabase/functions/resolve-bet/index.ts');
    assert.match(src, /message !== expected/, 'the signed payload is still rebuilt and compared');
    assert.match(src, /live\.host_address\.toLowerCase\(\) !== recovered/, 'the host is still checked');
    assert.match(src, /isFresh\(issuedAt\)/, 'the proof is still time-boxed');
});

test('CORS headers are shared, so the error path cannot drift from the ok path', () => {
    assert.equal(CORS_HEADERS['Access-Control-Allow-Methods'], 'POST, OPTIONS');
    assert.ok(CORS_HEADERS['Access-Control-Allow-Origin']);
});
