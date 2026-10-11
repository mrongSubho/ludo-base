/**
 * Host intent decision — executable coverage (Phase 2 exit gate).
 *
 * `hooks/useGameEngine.ts` delegates its guest-intent effect to
 * `hostActionForIntent` (lib/hostIntent.ts). These tests DRIVE that function
 * with forged intents end to end: a face attached to REQUEST_ROLL or
 * REQUEST_MOVE must never reach the engine. This replaces the previous
 * source-only assertions for the React handler with executed behaviour; the
 * delegation itself is still pinned by a source assertion in
 * dice-trust.test.ts so a face cannot be smuggled around the helper.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostActionForIntent } from '../lib/hostIntent';

const forgedRoll = (value: unknown) => ({
    type: 'REQUEST_ROLL',
    payload: { value },
    intentId: 'forged-roll',
}) as never;

const forgedMove = (diceValue: unknown) => ({
    type: 'REQUEST_MOVE',
    payload: { color: 'green', tokenIndex: 0, diceValue },
    intentId: 'forged-move',
}) as never;

test('a forged REQUEST_ROLL face never reaches the engine', () => {
    for (const face of [1, 2, 3, 4, 5, 6, 0, 7, '6', null, undefined, {}]) {
        const action = hostActionForIntent(forgedRoll(face), null);
        // The decision carries no face at all — there is nothing to forward.
        assert.deepEqual(action, { kind: 'roll' });
        assert.ok(!JSON.stringify(action).includes(String(face)));
    }
});

test('a forged REQUEST_MOVE face is replaced by the host face', () => {
    for (const forged of [1, 3, 6, '6', 0, 7, undefined]) {
        const action = hostActionForIntent(forgedMove(forged), 2);
        assert.deepEqual(action, {
            kind: 'move',
            color: 'green',
            tokenIndex: 0,
            diceValue: 2,
        });
    }
});

test('REQUEST_MOVE with no committed host face is ignored, not guessed', () => {
    const action = hostActionForIntent(
        {
            type: 'REQUEST_MOVE',
            payload: { color: 'green', tokenIndex: 1 },
            intentId: 'no-face',
        } as never,
        null,
    );
    assert.deepEqual(action, { kind: 'ignore' });
});

test('malformed intents fail closed', () => {
    assert.deepEqual(
        hostActionForIntent(
            { type: 'REQUEST_MOVE', payload: { color: 'green' }, intentId: 'x' } as never,
            4,
        ),
        { kind: 'ignore' },
    );
    assert.deepEqual(
        hostActionForIntent({ type: 'NOPE', payload: {}, intentId: 'x' } as never, 4),
        { kind: 'ignore' },
    );
});

test('trust intents still route without a face', () => {
    assert.deepEqual(
        hostActionForIntent(
            {
                type: 'CMD_REQUEST_TRUST',
                payload: { color: 'red', isBotTrusted: true, isKicked: true },
                intentId: 't',
            } as never,
            null,
        ),
        { kind: 'trust', color: 'red', isKicked: true },
    );
});
