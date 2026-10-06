/**
 * Turn-authority rules (Phase 3 / SEC-15, SEC-18, SEC-19, SEC-30).
 *
 * These live in `supabase/functions/_shared/turnAuthority.ts` as pure functions
 * so they are executed here rather than asserted by reading Edge source — Deno
 * is not installed in CI, so anything left inline in the handler can only be
 * checked by a human reading it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    casWon,
    checkPassLegality,
    checkSeatAuthority,
    passStatePatch,
} from '../supabase/functions/_shared/turnAuthority';

const HOST = '0xhost'.toLowerCase();
const ADA = '0xada'.toLowerCase();
const CY = '0xcy'.toLowerCase();

const seats = {
    green: { kind: 'human', wallet: ADA },
    red: { kind: 'bot', wallet: null },
    blue: { kind: 'human', wallet: CY },
};

// ── SEC-19: seat authority ──────────────────────────────────────────────────

test('a player may act on their own human seat', () => {
    assert.deepEqual(
        checkSeatAuthority({ source: 'player', seats, color: 'green', actor: ADA, hostAddress: HOST }),
        { ok: true },
    );
});

test('a player may not act on another player seat', () => {
    const v = checkSeatAuthority({ source: 'player', seats, color: 'green', actor: CY, hostAddress: HOST });
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.error, 'Not your seat');
});

test('the host may assist a bot seat', () => {
    assert.deepEqual(
        checkSeatAuthority({ source: 'host-assist', seats, color: 'red', actor: HOST, hostAddress: HOST }),
        { ok: true },
    );
});

test('the host may NOT assist a human seat (SEC-19)', () => {
    // This is the gap: `move` refused it, `pass` did not. The host could end a
    // human's turn with a pass that human never chose.
    const v = checkSeatAuthority({ source: 'host-assist', seats, color: 'green', actor: HOST, hostAddress: HOST });
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.error, 'host-assist only for bot/AFK seats');
    assert.equal(v.ok === false && v.status, 403);
});

test('a non-host may not use the assist path at all', () => {
    const v = checkSeatAuthority({ source: 'host-assist', seats, color: 'red', actor: ADA, hostAddress: HOST });
    assert.equal(v.ok === false && v.error, 'Only host may assist');
});

test('a player may not act on a bot seat', () => {
    const v = checkSeatAuthority({ source: 'player', seats, color: 'red', actor: ADA, hostAddress: HOST });
    assert.equal(v.ok === false && v.error, 'Seat is not a human player');
});

test('an unseated colour is refused', () => {
    const v = checkSeatAuthority({ source: 'player', seats, color: 'yellow', actor: ADA, hostAddress: HOST });
    assert.equal(v.ok === false && v.status, 403);
});

test('seat comparison is case-insensitive', () => {
    assert.equal(
        checkSeatAuthority({ source: 'player', seats, color: 'green', actor: ADA.toUpperCase(), hostAddress: HOST }).ok,
        true,
    );
});

// ── SEC-18: pass legality is derived, never declared ────────────────────────

test('a pass is legal when no token can move', () => {
    assert.deepEqual(checkPassLegality({ legal: [], dice: 4, consecutiveSixes: 0 }), { ok: true });
});

test('a pass is refused when a legal move exists', () => {
    const v = checkPassLegality({ legal: [0, 2], dice: 4, consecutiveSixes: 0 });
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.status, 400);
    assert.equal(v.ok === false && v.error, 'Legal moves exist');
});

test('the third consecutive six is a legal pass even with legal moves', () => {
    assert.deepEqual(checkPassLegality({ legal: [0], dice: 6, consecutiveSixes: 2 }), { ok: true });
    // ...but the first and second six are not an excuse to pass.
    assert.equal(checkPassLegality({ legal: [0], dice: 6, consecutiveSixes: 0 }).ok, false);
    assert.equal(checkPassLegality({ legal: [0], dice: 6, consecutiveSixes: 1 }).ok, false);
});

test('pass legality refuses an impossible face', () => {
    for (const bad of [0, 7, 2.5, NaN]) {
        const v = checkPassLegality({ legal: [], dice: bad, consecutiveSixes: 0 });
        assert.equal(v.ok, false, `dice=${bad} must be refused`);
        assert.equal(v.ok === false && v.error, 'Invalid dice face');
    }
});

test('a bogus six counter cannot buy a pass', () => {
    // NaN must not read as "third six".
    assert.equal(checkPassLegality({ legal: [0], dice: 6, consecutiveSixes: NaN }).ok, false);
    assert.equal(checkPassLegality({ legal: [0], dice: 6, consecutiveSixes: -5 }).ok, false);
});

// ── SEC-15: a CAS that matched nothing is not a write ──────────────────────

test('casWon requires exactly one row back', () => {
    assert.deepEqual(casWon({ error: null, data: [{ seq: 4 }] }), { ok: true });
});

test('SEC-15: zero rows means the race was lost, not that the write succeeded', () => {
    // A `.update().eq('seq', seq)` matching nothing is a 200 with an empty body.
    // Treating that as success returned 200 {success:true} for a state that was
    // never persisted.
    const v = casWon({ error: null, data: [] });
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.code, 'STALE_SEQ');
    assert.equal(v.ok === false && v.status, 409);
    assert.equal(casWon({ error: null, data: null }).ok, false);
    assert.equal(casWon({ error: null, data: undefined }).ok, false);
});

test('casWon distinguishes a real error from an empty result', () => {
    const v = casWon({ error: new Error('connection reset'), data: null });
    assert.equal(v.ok === false && v.status, 500);
    // More than one row is also a failure: it means the guard was not unique.
    assert.equal(casWon({ error: null, data: [{ seq: 4 }, { seq: 5 }] }).ok, false);
});

// ── SEC-30: passing resets the per-turn power budget ────────────────────────

test('SEC-30: a pass clears powerSpentThisTurn', () => {
    const p = passStatePatch({ currentPlayer: 'red', dice: 4, consecutiveSixes: 0, now: 12345 });
    assert.equal(p.powerSpentThisTurn, false);
    assert.equal(p.currentPlayer, 'red');
    assert.equal(p.diceValue, null);
    assert.equal(p.gamePhase, 'rolling');
    assert.equal(p.lastUpdate, 12345);
});

test('the six counter wraps on the third six rather than running away', () => {
    assert.equal(passStatePatch({ currentPlayer: 'r', dice: 6, consecutiveSixes: 0, now: 0 }).consecutiveSixes, 1);
    assert.equal(passStatePatch({ currentPlayer: 'r', dice: 6, consecutiveSixes: 1, now: 0 }).consecutiveSixes, 2);
    assert.equal(passStatePatch({ currentPlayer: 'r', dice: 6, consecutiveSixes: 2, now: 0 }).consecutiveSixes, 0);
    assert.equal(passStatePatch({ currentPlayer: 'r', dice: 4, consecutiveSixes: 2, now: 0 }).consecutiveSixes, 0);
});

// ── Wiring: the Edge handler must actually call these rules ─────────────────
//
// Deno is not in CI, so the handlers cannot be executed here. These are source
// assertions — weaker than the behavioural tests above, and labelled as such.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

const handler = code('supabase/functions/move-auth/index.ts');

test('SEC-15: all three CAS updates select the column back', () => {
    assert.match(handler, /casWon,[\s\S]*?from '\.\.\/_shared\/turnAuthority\.ts'/, 'move-auth must import casWon');
    // Three compare-and-swap sites: move, pass, power.
    assert.equal((handler.match(/casWon\(\{/g) || []).length, 3, 'move, pass and power must each check the CAS');
    assert.equal(
        (handler.match(/\.eq\('seq', seq\)[^;]*?\.select\('seq'\)/g) || []).length,
        3,
        'every CAS must select seq back so an empty match is visible',
    );
    // No CAS may still be followed by the old truthiness-only error check.
    // The pre-fix shape: a CAS with no select, followed by an error-only check.
    assert.doesNotMatch(handler, /\.eq\('seq', seq\);[^.]*?\n\s*if \(saveErr\) return json\(\{ error: saveErr\.message \}/);
});

test('SEC-15: a failed match_moves insert is surfaced', () => {
    assert.match(handler, /const \{ error: moveInsErr \} = await supabase\.from\('match_moves'\)\.insert/);
    assert.match(handler, /if \(moveInsErr\)/, 'the audit insert error must be checked');
    assert.match(handler, /AUDIT_WRITE_FAILED/);
});

test('SEC-18: the forced escape hatch is gone from the handler and the client', () => {
    assert.doesNotMatch(handler, /reason !== 'forced'/, 'the caller must not decide pass legality');
    assert.doesNotMatch(handler, /reason:\s*'forced'/);
    // And it is gone from the destructured body too, not merely ignored.
    const passBranch = handler.slice(handler.indexOf("action === 'pass'"));
    assert.doesNotMatch(passBranch.slice(0, 600), /\breason\b/, 'reason must not be read in the pass branch');
    assert.match(handler, /checkPassLegality\(/);

    for (const f of ['hooks/useMoveAuth.ts', 'hooks/useGameActions.ts']) {
        assert.doesNotMatch(code(f), /reason:\s*params\.reason|reason\?:\s*string/, `${f} must not send a pass reason`);
    }
});

test('SEC-19: the pass branch applies the same seat rule as move', () => {
    assert.match(handler, /checkSeatAuthority\(/);
    // Both branches must go through it, so the two cannot diverge again.
    // move, pass AND power: the power branch had no human-seat refusal at all.
    assert.equal(
        (handler.match(/checkSeatAuthority\(\{/g) || []).length,
        3,
        'move, pass and power must all call it',
    );
    assert.equal(
        (handler.match(/seatOwnsColor\(/g) || []).length,
        0,
        'the old inline rule must be gone, not merely unused',
    );
});

test('SEC-30: the pass branch applies the shared state patch', () => {
    assert.match(handler, /passStatePatch\(\{/);
    const passBranch = handler.slice(handler.indexOf("action === 'pass'"));
    assert.doesNotMatch(passBranch.slice(0, 3000), /next\.powerSpentThisTurn/, 'must come from passStatePatch, not ad hoc');
});

test('every Edge source file still parses', () => {
    // A deploy failed on exactly this: a `//` comment line lost its second slash,
    // so the next line of prose was parsed as code. Deno is not in CI, and
    // `tsc -p tsconfig.json` excludes supabase/functions, so nothing caught it
    // until the bundle step failed. Parse each file with the TypeScript parser
    // directly — module-resolution errors are expected and ignored; a syntax
    // diagnostic is a real failure.
    const ts = require('typescript') as typeof import('typescript');
    const files = [
        'supabase/functions/move-auth/index.ts',
        'supabase/functions/roll-dice/index.ts',
        'supabase/functions/_shared/engine.ts',
        'supabase/functions/_shared/networkBoundary.ts',
        'supabase/functions/_shared/rollReceipt.ts',
        'supabase/functions/_shared/matchSession.ts',
        'supabase/functions/_shared/turnAuthority.ts',
        'supabase/functions/_shared/walletVerify.ts',
    ];
    const bad: string[] = [];
    for (const f of files) {
        const src = read(f);
        const sf = ts.createSourceFile(f, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
        // parseDiagnostics is not on the public type; walk the known slot.
        const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics || [];
        for (const d of diags) {
            const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
            bad.push(`${f}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
        }
    }
    assert.deepEqual(bad, [], 'Edge sources must parse:\n' + bad.join('\n'));
});

test('a prose fragment can never be parsed as a statement', () => {
    // The deploy broke on exactly this: a `//` comment lost its second slash on
    // a wrapped line, so the following prose ("host could spend any player's
    // power on their turn.") was handed to the parser as code. Detecting that by
    // regex on comment shape produces false positives — an ordinary comment line
    // above an ordinary statement looks the same. Detect it structurally instead:
    // a bare-identifier statement containing a space is prose, and no legitimate
    // statement in these files does that.
    const ts = require('typescript') as typeof import('typescript');
    const files = [
        'supabase/functions/move-auth/index.ts',
        'supabase/functions/roll-dice/index.ts',
        'supabase/functions/_shared/turnAuthority.ts',
        'supabase/functions/_shared/rollReceipt.ts',
        'supabase/functions/_shared/engine.ts',
    ];
    const offenders: string[] = [];
    const visit = (node: ts.Node, f: string) => {
        if (ts.isExpressionStatement(node) && ts.isIdentifier(node.expression)) {
            const text = node.getText();
            if (/\s/.test(text)) {
                const { line } = (node as unknown as { getSourceFile(): ts.SourceFile })
                    .getSourceFile()
                    .getLineAndCharacterOfPosition(node.getStart());
                offenders.push(`${f}:${line + 1} parses prose as code: ${JSON.stringify(text)}`);
            }
        }
        ts.forEachChild(node, (c) => visit(c, f));
    };
    for (const f of files) {
        const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
        sf.forEachChild((n) => visit(n, f));
    }
    assert.deepEqual(offenders, [], 'prose leaked into the AST:\n' + offenders.join('\n'));
});
