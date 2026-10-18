/**
 * Phase 4 exit gate — `npm run test:protocol`.
 *
 * Table-driven hostile payloads, rejected on BOTH transports. Both ingress
 * paths (`processGameAction` for Supabase GAME_INTENT, `handleGuestData` for
 * PeerJS GAME_ACTION) run the same `isGameIntent` parser since NET-09, so one
 * table covers both — plus pins that neither path has grown its own parser.
 * Run: npm run test:protocol
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isGameIntent } from '../lib/gameProtocol';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');

const good = (type: string, payload: unknown, intentId = 'i-1') => ({ type, payload, intentId });

test('both transports run the same parser (no forked validation)', () => {
    const ctx = code('hooks/TeamUpContext.tsx');
    // Supabase ingress.
    assert.match(ctx, /if \(!isGameIntent\(action\)\)/);
    // PeerJS ingress — the NET-09 fix. A second parser here (or none) is the
    // exact regression this file exists to catch.
    assert.match(ctx, /if \(!isGameIntent\(data\.action\)\)/);
    // Both derive identity the same way.
    const ids = ctx.match(/\.intentId \|\| /g) || [];
    assert.ok(ids.length >= 2, 'both transports must fall back identically on identity');
});

const hostile: Array<[string, unknown]> = [
    // Faces smuggled in every numeric disguise.
    ['roll face 6', { type: 'REQUEST_ROLL', payload: { value: 6 }, intentId: 'h-1' }],
    ['roll face 0', { type: 'REQUEST_ROLL', payload: { value: 0 }, intentId: 'h-2' }],
    ['roll face string', { type: 'REQUEST_ROLL', payload: { value: '6' }, intentId: 'h-3' }],
    ['roll face undefined-key', { type: 'REQUEST_ROLL', payload: { value: undefined }, intentId: 'h-4' }],
    ['move face', { type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: 0, diceValue: 6 }, intentId: 'h-5' }],
    ['move face 1', { type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: 0, diceValue: 1 }, intentId: 'h-6' }],
    // Token index out of the engine's 0..3.
    ['token -1', { type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: -1 }, intentId: 'h-7' }],
    ['token 4', { type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: 4 }, intentId: 'h-8' }],
    ['token 1.5', { type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: 1.5 }, intentId: 'h-9' }],
    ['token "0"', { type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: '0' }, intentId: 'h-10' }],
    // Colors outside the engine's four.
    ['color purple', { type: 'REQUEST_MOVE', payload: { color: 'purple', tokenIndex: 0 }, intentId: 'h-11' }],
    ['color empty', { type: 'REQUEST_MOVE', payload: { color: '', tokenIndex: 0 }, intentId: 'h-12' }],
    ['color null', { type: 'REQUEST_MOVE', payload: { color: null, tokenIndex: 0 }, intentId: 'h-13' }],
    // Envelope violations.
    ['unknown type', { type: 'ROLL_NOW', payload: {}, intentId: 'h-14' }],
    ['missing intentId', { type: 'REQUEST_ROLL', payload: {} }],
    ['empty intentId', { type: 'REQUEST_ROLL', payload: {}, intentId: '' }],
    ['null payload', { type: 'REQUEST_ROLL', payload: null, intentId: 'h-15' }],
    ['string payload', { type: 'REQUEST_ROLL', payload: 'roll', intentId: 'h-16' }],
    ['non-object', 'REQUEST_ROLL'],
    ['null', null],
    ['array', [{ type: 'REQUEST_ROLL' }]],
    // Retired verbs in P6 are rejected
    ['retired trust command', { type: 'CMD_REQUEST_TRUST', payload: { color: 'green', isBotTrusted: true, isKicked: false }, intentId: 'h-17' }],
    ['retired commit intent', { type: 'DICE_COMMIT', payload: { hash: 'abc' }, intentId: 'h-18' }],
    ['retired reveal intent', { type: 'DICE_REVEAL', payload: { nonce: '123' }, intentId: 'h-19' }],
];

test('hostile payloads are rejected, whatever the transport', () => {
    for (const [name, payload] of hostile) {
        assert.equal(isGameIntent(payload), false, `${name} must be rejected`);
    }
});

test('legal payloads still pass on every active verb', () => {
    assert.equal(isGameIntent(good('REQUEST_ROLL', {})), true);
    assert.equal(isGameIntent(good('REQUEST_MOVE', { color: 'blue', tokenIndex: 3 })), true);
});

test('legacy intents (DICE_COMMIT, DICE_REVEAL, CMD_REQUEST_TRUST) are retired in P6', () => {
    assert.equal(
        isGameIntent({ type: 'DICE_COMMIT', payload: { hash: 'abc' }, intentId: 'x1' } as unknown as Parameters<typeof isGameIntent>[0]),
        false,
    );
    assert.equal(
        isGameIntent({ type: 'DICE_REVEAL', payload: { nonce: 'n' }, intentId: 'x2' } as unknown as Parameters<typeof isGameIntent>[0]),
        false,
    );
    assert.equal(
        isGameIntent({
            type: 'CMD_REQUEST_TRUST',
            payload: { color: 'red', isBotTrusted: false, isKicked: true },
            intentId: 'x3',
        } as unknown as Parameters<typeof isGameIntent>[0]),
        false,
    );
});
