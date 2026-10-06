/**
 * Dice trust boundary (Phase 2 / SEC-02).
 *
 * The invariant: **a client may ask for a roll, never name the face.** A seated
 * guest used to be able to choose their own dice, because the roll intent
 * carried an optional `value` and the host passed it straight into the engine.
 * `REQUEST_MOVE` had the same hole via `diceValue`, which the original audit
 * did not list — the mover declared the face it moved with.
 *
 * These tests pin the parsers (which is where a forged intent is actually
 * stopped) and then assert on the source of the networked path, because the
 * handler is a React effect and cannot be invoked directly. Source assertions
 * are weaker than executing the handler; that gap is stated in the exit gate
 * rather than papered over.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isGameIntent } from '../lib/gameProtocol';
import { gameIntentSchema } from '../lib/protocol/schemas';
import type { GameIntentPayloads } from '../lib/types';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Strip comments so an explanatory mention of a field is not read as a use. */
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

const forgedRoll = (value: unknown) => ({
    type: 'REQUEST_ROLL',
    payload: { value },
    sender: '0xATTACKER',
    intentId: 'forged-1',
});

const forgedMove = (diceValue: unknown) => ({
    type: 'REQUEST_MOVE',
    payload: { color: 'green', tokenIndex: 0, diceValue },
    sender: '0xATTACKER',
    intentId: 'forged-2',
});

// ── The parser is the gate ──────────────────────────────────────────────────

test('isGameIntent rejects a REQUEST_ROLL that names a face', () => {
    for (const face of [1, 2, 3, 4, 5, 6]) {
        assert.equal(isGameIntent(forgedRoll(face)), false, `face ${face} must be rejected`);
    }
});

test('isGameIntent rejects out-of-range and non-numeric faces too', () => {
    // These were already rejected, but a regression to "ignore unknown keys"
    // would quietly re-open the hole for the in-range values above, so assert
    // the whole neighbourhood rather than only the six legal faces.
    for (const bad of [0, 7, -1, 6.5, NaN, Infinity, '6', null, true, {}]) {
        assert.equal(isGameIntent(forgedRoll(bad)), false, `${String(bad)} must be rejected`);
    }
});

test('isGameIntent accepts a face-less REQUEST_ROLL', () => {
    assert.equal(isGameIntent({ type: 'REQUEST_ROLL', payload: {}, intentId: 'ok-1' }), true);
    // `value: undefined` is still a present key and must fail closed.
    assert.equal(isGameIntent(forgedRoll(undefined)), false);
});

test('isGameIntent rejects a REQUEST_MOVE that declares a face', () => {
    for (const face of [1, 3, 6, '6', 0, 7, undefined]) {
        assert.equal(isGameIntent(forgedMove(face)), false, `${String(face)} must be rejected`);
    }
    assert.equal(
        isGameIntent({ type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: 2 }, intentId: 'ok-2' }),
        true,
    );
});

test('the wire schema drops forged faces as well', () => {
    // zod strips unknown keys by default, which would make the forged payload
    // *pass*. .strict() is what actually turns it away.
    assert.equal(gameIntentSchema.safeParse(forgedRoll(6)).success, false);
    assert.equal(gameIntentSchema.safeParse(forgedMove(6)).success, false);
    assert.equal(gameIntentSchema.safeParse({ type: 'REQUEST_ROLL', payload: {}, intentId: 'a' }).success, true);
    assert.equal(
        gameIntentSchema.safeParse({ type: 'REQUEST_MOVE', payload: { color: 'blue', tokenIndex: 1 }, intentId: 'b' })
            .success,
        true,
    );
});

// ── The types make a face unrepresentable ──────────────────────────────────

test('the intent types no longer have a field for a face', () => {
    // Compile-time, via @ts-expect-error: if a face ever becomes representable
    // again the *typecheck* fails, not just a runtime assertion.
    // @ts-expect-error - `value` is not a field of REQUEST_ROLL
    const forgedRoll: GameIntentPayloads['REQUEST_ROLL'] = { value: 6 };
    // @ts-expect-error - `diceValue` is not a field of REQUEST_MOVE
    const forgedMove: GameIntentPayloads['REQUEST_MOVE'] = { color: 'green', tokenIndex: 0, diceValue: 6 };

    const legalRoll: GameIntentPayloads['REQUEST_ROLL'] = {};
    const legalMove: GameIntentPayloads['REQUEST_MOVE'] = { color: 'green', tokenIndex: 0 };
    assert.deepEqual(legalRoll, {});
    assert.deepEqual(legalMove, { color: 'green', tokenIndex: 0 });
    assert.ok(forgedRoll && forgedMove);
});

// ── The networked path never reads a face from the wire ────────────────────

test('the host REQUEST_ROLL handler cannot pass a face to the engine', () => {
    const src = code('hooks/useGameEngine.ts');
    // The handler must call handleRoll() bare. `payload?.value` / `payload.value`
    // anywhere in the intent handler is the original bug.
    assert.doesNotMatch(src, /payload\??\.value/, 'host must not read payload.value');
    assert.match(
        src,
        /if \(type === 'REQUEST_ROLL'\) \{[\s\S]*?handleRoll\(\);/,
        'REQUEST_ROLL must call handleRoll() with no argument',
    );
});

test('the host REQUEST_MOVE handler uses the host dice, not the guest dice', () => {
    const src = code('hooks/useGameEngine.ts');
    assert.doesNotMatch(src, /payload\??\.diceValue/, 'host must not read payload.diceValue');
    assert.match(
        src,
        /if \(type === 'REQUEST_MOVE'\) \{[\s\S]*?const diceValue = localGameState\.diceValue;/,
        'REQUEST_MOVE must take the face from the host state',
    );
});

test('no client ever puts a face on a roll or move intent', () => {
    const src = code('hooks/useGameActions.ts');

    // Every REQUEST_ROLL send must carry exactly an empty payload. Matching
    // "anything that looks like a payload" was wrong: it flagged the correct
    // `{}` too, because `{}` is itself a non-space run before a `}`.
    const rollSends = [...src.matchAll(/sendIntent\(\s*'REQUEST_ROLL'\s*,\s*([\s\S]*?)\);/g)];
    assert.ok(rollSends.length > 0, 'expected at least one REQUEST_ROLL send');
    for (const m of rollSends) {
        assert.equal(m[1].trim(), '{}', `REQUEST_ROLL payload must be empty, got: ${m[1].trim()}`);
    }

    // REQUEST_MOVE may carry a colour and a token index, never a face.
    const moveSends = [...src.matchAll(/sendIntent\(\s*'REQUEST_MOVE'\s*,\s*([\s\S]*?)\);/g)];
    assert.ok(moveSends.length > 0, 'expected at least one REQUEST_MOVE send');
    for (const m of moveSends) {
        assert.doesNotMatch(m[1], /diceValue|value/, `REQUEST_MOVE payload must carry no face: ${m[1].trim()}`);
    }
});

test('handleRoll takes no face parameter at all', () => {
    // Removing the parameter is the real fix; the parsers are defence in depth.
    // If `value` comes back, every caller can name a face again.
    const src = code('hooks/useGameActions.ts');
    const sig = /const handleRoll = useCallback\(async \(([^)]*)\) => \{/.exec(src);
    assert.ok(sig, 'handleRoll signature not found');
    assert.doesNotMatch(sig[1], /value/, `handleRoll must not accept a value (got: ${sig[1].trim()})`);
});

test('the dice UI cannot hand a face to the engine', () => {
    const dice = code('app/components/Dice.tsx');
    assert.match(dice, /onRoll: \(\) => void;/, 'LudoDice.onRoll must take no value');
    // The old call was `onRoll(0)` — harmless only because 0 is falsy, which is
    // exactly the kind of accident that lets `onRoll(6)` land later.
    assert.match(dice, /onRoll\(\);/, 'onRoll must be called with no argument');
    assert.doesNotMatch(dice, /onRoll\(\s*\d/, 'onRoll must not be called with a number');

    const row = code('app/components/PlayerInfoRow.tsx');
    assert.match(row, /onRoll=\{handleRoll\}/);
    assert.doesNotMatch(row, /onRoll=\{\(val\)/, 'the row must not forward a face');
});

// ── No offline/client fallback for a networked seat ────────────────────────

test('a networked seat has no client-side dice fallback', () => {
    // SEC-02: an Edge RNG failure must abort the roll, not fall through to
    // Math.random() — a local fallback is a face the client chose.
    const src = code('hooks/useGameActions.ts');
    const start = src.indexOf('const handleRoll = useCallback');
    assert.ok(start > 0);
    const body = src.slice(start, start + 4200);
    assert.match(
        body,
        /Edge RNG failed — aborting networked roll \(no client fallback\)/,
        'the networked abort path must still exist',
    );
    const offlineRng = body.indexOf('Math.floor(Math.random() * 6) + 1');
    assert.ok(offlineRng > 0, 'offline RNG should still exist for non-networked seats');
    // The offline RNG must sit in the else branch, i.e. after the networked
    // attempt, and never run when `isLobbyConnected`.
    const networkedBranch = body.indexOf('if (networkedSeat) {');
    assert.ok(networkedBranch > 0 && offlineRng > networkedBranch);
    assert.match(body.slice(networkedBranch, offlineRng), /} catch \(err\) \{[\s\S]*?return;/);
});
