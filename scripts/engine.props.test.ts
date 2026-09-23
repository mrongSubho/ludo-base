/**
 * E2 property-based engine invariants (fast-check + node:test).
 * Run: npm run test:props
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
    calculateNextPosition,
    getLegalTokenIndices,
    getTeammateColor,
    getTeam,
    handleThreeSixes,
} from '../lib/gameLogic';
import { TEAM_PAIRINGS, TEAM_ID, BASE_INDEX, BOARD_FINISH_INDEX } from '../lib/constants';
import type { ColorCorner, Corner, PlayerColor } from '../lib/types';
import { hashGameState, stableStringify, gameStateDigest } from '../lib/replay/hash';
import { createMatchFsm, nextPhase } from '../lib/matchFsm';
import {
    parseGameIntent,
    parseGameActionEnvelope,
    parseMatchStateRow,
} from '../lib/protocol';
import type { GameState } from '../lib/types';

const COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];
const CORNERS: Corner[] = ['BL', 'BR', 'TR', 'TL'];

const colorArb = fc.constantFrom(...COLORS);
const diceArb = fc.integer({ min: 1, max: 6 });
const posArb = fc.integer({ min: BASE_INDEX, max: BOARD_FINISH_INDEX });

const ccArb = fc
    .record({
        green: fc.constantFrom(...CORNERS),
        red: fc.constantFrom(...CORNERS),
        yellow: fc.constantFrom(...CORNERS),
        blue: fc.constantFrom(...CORNERS),
    })
    .map((cc) => cc as ColorCorner);

function positionsArb() {
    return fc.record({
        green: fc.array(posArb, { minLength: 4, maxLength: 4 }),
        red: fc.array(posArb, { minLength: 4, maxLength: 4 }),
        yellow: fc.array(posArb, { minLength: 4, maxLength: 4 }),
        blue: fc.array(posArb, { minLength: 4, maxLength: 4 }),
    });
}

test('prop: calculateNextPosition stays on board or base', () => {
    fc.assert(
        fc.property(posArb, diceArb, colorArb, ccArb, (pos, dice, color, cc) => {
            const next = calculateNextPosition(pos, dice, color, cc);
            assert.ok(Number.isInteger(next), `next must be integer, got ${next}`);
            assert.ok(next >= BASE_INDEX && next <= BOARD_FINISH_INDEX, `next=${next} out of range`);
        }),
        { numRuns: 400 }
    );
});

test('prop: legal tokens are a subset of 0..3 and never no-op', () => {
    fc.assert(
        fc.property(positionsArb(), diceArb, colorArb, ccArb, (positions, dice, color, cc) => {
            const legal = getLegalTokenIndices(positions as never, color, dice, cc);
            for (const idx of legal) {
                assert.ok(Number.isInteger(idx) && idx >= 0 && idx <= 3);
                const cur = positions[color][idx];
                const next = calculateNextPosition(cur, dice, color, cc);
                assert.notEqual(next, cur, 'legal move must change position');
            }
        }),
        { numRuns: 300 }
    );
});

test('prop: base exit only on six', () => {
    fc.assert(
        fc.property(diceArb, colorArb, ccArb, (dice, color, cc) => {
            const next = calculateNextPosition(BASE_INDEX, dice, color, cc);
            if (dice === 6) assert.notEqual(next, BASE_INDEX);
            else assert.equal(next, BASE_INDEX);
        }),
        { numRuns: 100 }
    );
});

test('prop: TEAM_PAIRINGS is a fixed-point-free involution and team-stable', () => {
    for (const color of COLORS) {
        const mate = getTeammateColor(color, '2v2');
        assert.ok(mate);
        assert.notEqual(mate, color);
        assert.equal(getTeammateColor(mate!, '2v2'), color);
        assert.equal(TEAM_PAIRINGS[color], mate);
        assert.equal(getTeam(color, '2v2'), getTeam(mate!, '2v2'));
        assert.equal(TEAM_ID[color], TEAM_ID[mate!]);
    }
    assert.notEqual(getTeam('green', '2v2'), getTeam('red', '2v2'));
    assert.notEqual(getTeam('blue', '2v2'), getTeam('yellow', '2v2'));
});

test('prop: overshoot past finish is illegal (exact 57)', () => {
    fc.assert(
        fc.property(
            fc.integer({ min: 53, max: 56 }),
            diceArb,
            colorArb,
            ccArb,
            (pos, dice, color, cc) => {
                const next = calculateNextPosition(pos, dice, color, cc);
                const finish = pos + dice;
                if (finish > BOARD_FINISH_INDEX) {
                    assert.equal(next, pos, 'overshoot must stay put');
                }
            }
        ),
        { numRuns: 150 }
    );
});

test('prop: three sixes handling is deterministic on consecutiveSixes', () => {
    fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), diceArb, (consecutiveSixes, roll) => {
            const result = handleThreeSixes(consecutiveSixes, roll);
            if (roll === 6 && consecutiveSixes + 1 === 3) {
                assert.equal(result.isThreeSixes, true);
                assert.equal(result.nextSixes, 0);
            } else if (roll === 6) {
                assert.equal(result.isThreeSixes, false);
                assert.equal(result.nextSixes, consecutiveSixes + 1);
            } else {
                assert.equal(result.isThreeSixes, false);
                assert.equal(result.nextSixes, 0);
            }
        }),
        { numRuns: 80 }
    );
});

test('prop: hashGameState is stable and digest-stable', () => {
    fc.assert(
        fc.property(colorArb, fc.integer({ min: 0, max: 20 }), (player, x) => {
            const state = {
                positions: { green: [x, 0, 0, 0], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
                currentPlayer: player,
                diceValue: null,
                isRolling: true,
                gamePhase: 'rolling',
                status: 'playing',
                winner: null,
                winners: [],
                captureMessage: 'hi',
                timeLeft: 15 - (x % 15),
                strikes: { green: 0, red: 0, yellow: 0, blue: 0 },
                powerTiles: [],
                playerPowers: { green: [], red: [], yellow: [], blue: [] },
                powerSpentThisTurn: false,
                activeBoost: null,
                nukeFlash: [{ r: x, c: 1 }],
                boostTrail: null,
                activeTraps: [],
                activeShields: [],
                consecutiveSixes: x % 3,
                afkStats: {
                    green: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
                    red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
                    yellow: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
                    blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
                },
                idleWarning: null,
                participantPeers: { a: 'peer-x' },
                isStarted: true,
                isBotMatch: false,
                botDifficulty: 'rookie' as const,
                lastUpdate: Date.now(),
                playerCount: '4P' as const,
            } as GameState;
            const h1 = hashGameState(state);
            const h2 = hashGameState({ ...state, timeLeft: 1, isRolling: false, lastUpdate: 0, captureMessage: null, participantPeers: {} } as GameState);
            assert.equal(h1, h2, 'ephemeral fields must not affect hash');
            assert.equal(stableStringify(gameStateDigest(state)), stableStringify(gameStateDigest(state)));
        }),
        { numRuns: 80 }
    );
});

test('prop: match FSM never leaves known phases; illegal paths rejected', () => {
    const fsm = createMatchFsm('idle');
    const events = [
        { type: 'OPEN_LOBBY' },
        { type: 'GUEST_SEATED' },
        { type: 'ALL_SEATED' },
        { type: 'START' },
        { type: 'START' },
        { type: 'RESYNC_NEEDED' },
        { type: 'RESYNC_APPLIED' },
        { type: 'HOST_ELECT' },
        { type: 'FINISH' },
        { type: 'RESET' },
    ] as const;
    for (const ev of events) {
        fsm.send(ev);
        assert.ok(['idle', 'lobby', 'seating', 'starting', 'live', 'resyncing', 'ended'].includes(fsm.phase));
    }
    assert.equal(fsm.phase, 'idle');
    assert.equal(nextPhase('ended', { type: 'OPEN_LOBBY' }), null);
});

test('prop: protocol parsers accept valid intents and drop garbage', () => {
    assert.equal(parseGameIntent({
        type: 'REQUEST_MOVE',
        payload: { color: 'green', tokenIndex: 1 },
        intentId: 'abc',
    }).ok, true);

    assert.equal(parseGameIntent({ type: 'NOPE', payload: {}, intentId: 'x' }).ok, false);
    assert.equal(parseGameIntent({ type: 'REQUEST_MOVE', payload: { color: 'purple', tokenIndex: 1 }, intentId: 'x' }).ok, false);
    assert.equal(parseGameIntent({ type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: 9 }, intentId: 'x' }).ok, false);

    assert.equal(parseGameActionEnvelope({ type: 'ROLL_DICE', payload: { diceValue: 3 } }).ok, true);
    assert.equal(parseGameActionEnvelope(null).ok, false);
    assert.equal(parseMatchStateRow({ seq: 3, state: { a: 1 } }).ok, true);
    assert.equal(parseMatchStateRow({ seq: -1, state: {} }).ok, false);
});

test('prop: stableStringify is key-order independent', () => {
    fc.assert(
        fc.property(fc.string(), fc.integer(), (a, b) => {
            const s1 = stableStringify({ a, b, nested: { x: 1, y: 2 } });
            const s2 = stableStringify({ nested: { y: 2, x: 1 }, b, a });
            assert.equal(s1, s2);
        }),
        { numRuns: 50 }
    );
});
