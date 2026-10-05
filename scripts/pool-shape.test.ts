/**
 * ECO-08 — declared pool shape and numeric game mode.
 *
 * Two defects this covers:
 *
 *  1. `chips/lobby-ticket` hardcoded `gameMode: 0`, so every edge-signed ticket
 *     claimed "classic" regardless of the stored mode, and the `game_mode` column
 *     it selected was never read.
 *
 *  2. `MatchPool` inferred 2v2-vs-4P from seat colours plus winner count. The
 *     lobby seats 4P as green,red,yellow,blue (`LOBBY_COLORS['4P']` in
 *     lib/gameLogic.ts), i.e. colour numbers 1,2,3,4, while the contract's
 *     `_isTeamPair` reads colours {1,4} as teammates. So a 4P game whose top two
 *     finished green and blue was paid the 2v2 50/50 split instead of the 75/25
 *     podium — with no revert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GAME_MODE_CODE, MATCH_SHAPE, shapeCodeFromText } from '@/lib/constants';
import { POOL_SHAPE } from '@/lib/poolAuthority';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// ── the enum must agree across the contract, the server, and the DB ──────────

test('MATCH_SHAPE codes match the MatchPool.PoolShape enum', () => {
    const sol = read('contracts/src/MatchPool.sol');
    const body = sol.slice(sol.indexOf('enum PoolShape'), sol.indexOf('struct LobbyTicket'));
    const order = [...body.matchAll(/^\s{8}(\w+),?$/gm)].map((m) => m[1]);
    assert.deepEqual(order, ['OneVsOne', 'TwoVsTwo', 'FourPlayer']);
    const keys = Object.keys(MATCH_SHAPE) as (keyof typeof MATCH_SHAPE)[];
    order.forEach((name, i) => {
        assert.equal(MATCH_SHAPE[keys[i]!], i, `${name} must be ${i}`);
        assert.equal(POOL_SHAPE[name as keyof typeof POOL_SHAPE], i, `POOL_SHAPE.${name}`);
    });
});

test('game mode codes stay inside the contract bound of 2', () => {
    for (const [name, code] of Object.entries(GAME_MODE_CODE)) {
        assert.ok(code >= 0 && code <= 2, `${name} code ${code} must fit uint8 <= 2`);
    }
    // Absent keys must stay absent so callers fail closed.
    assert.equal(GAME_MODE_CODE['nonsense'], undefined);
    assert.equal(GAME_MODE_CODE[''], undefined);
});

// ── shapeCodeFromText fails closed ───────────────────────────────────────────

test('shapeCodeFromText maps the three known shapes and rejects everything else', () => {
    assert.equal(shapeCodeFromText('1v1'), 0);
    assert.equal(shapeCodeFromText('2v2'), 1);
    assert.equal(shapeCodeFromText('4P'), 2);
    for (const bad of [null, undefined, '', '4p', 'five', 'toString', '__proto__']) {
        assert.equal(shapeCodeFromText(bad as string | null), null, `${String(bad)} must not map`);
    }
});

// ── the shape must be inside the signed ticket ───────────────────────────────

test('the lobby ticket signs the shape, so it cannot be swapped after issuance', () => {
    // Both sides must name `shape` in the same position of the pre-image, or the
    // digests diverge and every ticket fails verification on-chain.
    const sol = read('contracts/src/MatchPool.sol');
    const ts = read('lib/chipsSettle.ts');
    const preimage = /LobbyTicket\(([^)]*)\)/;
    const solFields = sol.match(preimage)![1]!.split(',').map((f) => f.trim());
    const tsFields = ts.match(preimage)![1]!.split(',').map((f) => f.trim());
    assert.deepEqual(tsFields, solFields, 'server and contract LobbyTicket pre-images must match');
    assert.ok(solFields.includes('uint8 shape'), 'shape must be signed');
    // And it must sit between gameMode and maxSeats on both sides.
    const i = solFields.indexOf('uint8 shape');
    assert.equal(solFields[i - 1], 'uint8 gameMode');
    assert.equal(solFields[i + 1], 'uint8 maxSeats');

    // The struct hash must actually encode it, not just the type string.
    const hashBody = ts.slice(ts.indexOf('lobbyTicketStructHash'), ts.indexOf('export function payoutPlanHash'));
    assert.match(hashBody, /t\.shape/, 'struct hash must include t.shape');
    assert.match(hashBody, /uint8, uint8, uint8, uint64/, 'abi.encode must carry the extra uint8');

    // The contract must rebuild the same struct from PoolConfig when verifying.
    const bind = sol.slice(sol.indexOf('function bindPoolSeats'), sol.indexOf('function joinPool'));
    assert.match(bind, /shape: a\.shape/, 'bindPoolSeats must feed PoolConfig.shape into the ticket');
});

// ── static guards against the exact regressions ─────────────────────────────

test('lobby-ticket no longer hardcodes gameMode 0', () => {
    const route = read('app/api/chips/lobby-ticket/route.ts');
    assert.doesNotMatch(route, /gameMode:\s*0\s*,/, 'must not hardcode gameMode');
    assert.match(route, /gameMode:\s*gameModeCode/, 'must use the stored numeric mode');
    assert.match(route, /shape:\s*shapeCode/, 'must sign the stored shape');
    // The whole point of the fix: no silent fallback when the row lacks a value.
    assert.match(route, /SHAPE_UNKNOWN/, 'must fail closed when shape is absent');
    assert.match(route, /GAME_MODE_UNKNOWN/, 'must fail closed when game mode is absent');
});

test('MatchPool branches settlement on the declared shape, not on colours', () => {
    const sol = read('contracts/src/MatchPool.sol');
    const apply = sol.slice(sol.indexOf('function _applySettle'), sol.indexOf('function _claim'));
    // The branch must be the stored shape...
    assert.match(apply, /if \(p\.shape == uint8\(PoolShape\.TwoVsTwo\)\)/);
    // ...and the colour helper must only be a corroborating check inside it,
    // never the thing that selects the branch.
    assert.doesNotMatch(apply, /if \(_isTeamPair\(/, 'must not branch on inferred team-ness');
    assert.match(apply, /if \(!_isTeamPair\([\s\S]{0,80}\) revert NotTeammates\(\)/);
});

test('poolAuthority derives the split from the chain-read shape', () => {
    const src = read('lib/poolAuthority.ts');
    assert.match(src, /const teamShape = shape === POOL_SHAPE\.TwoVsTwo;/);
    assert.doesNotMatch(src, /split === "auto" \? "team"/, 'auto must not hardcode team');
});

// ── the persistence migration exists and is safe ─────────────────────────────

test('migration 009 records shape + numeric mode with fail-closed backfill', () => {
    const sql = read('supabase/migrations/202609300009_matches_pool_shape.sql');
    assert.match(sql, /add column if not exists match_shape text/);
    assert.match(sql, /add column if not exists game_mode_code smallint/);
    // The CHECK is written across two lines by forge/sqlfmt-style formatting.
    const flat = sql.replace(/\s+/g, ' ');
    assert.match(flat, /match_shape in \('1v1', ?'2v2', ?'4P'\)/);
    // 4-seat rows are ambiguous (both 2v2 and 4P use four seats), so the backfill
    // must leave them NULL instead of guessing a payout split.
    assert.match(sql, /else null/);
    assert.doesNotMatch(
        sql,
        /array_length\(participants, 1\)\s*=\s*4[\s\S]{0,80}match_shape = '2v2'/,
        'must not guess 2v2 from a 4-seat roster',
    );
});

test('match/start persists the shape and validates the value', () => {
    const src = read('app/api/match/start/route.ts');
    assert.match(src, /match_shape: matchShape \?\? null/);
    assert.match(src, /game_mode_code: gameModeCode/);
    assert.match(src, /matchShape must be 1v1, 2v2 or 4P/);
});
