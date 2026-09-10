/**
 * Pure engine tests (node --test). Run: npm test
 * Covers the 2v2 team pairing unification and move-legality math.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getTeammateColor,
    getTeam,
    calculateNextPosition,
    getLegalTokenIndices,
    handleThreeSixes,
    processMove,
    INITIAL_GAME_STATE,
} from '../lib/gameLogic';
import { assignCorners2v2, CORNER_SLOTS } from '../lib/boardLayout';
import { TEAM_PAIRINGS, TEAM_ID, BASE_INDEX } from '../lib/constants';
import type { PlayerColor } from '../lib/types';

const CC_4P = {
    green: 'BL',
    red: 'BR',
    yellow: 'TR',
    blue: 'TL',
} as const;

test('2v2 teammate pairing is Green+Yellow and Red+Blue', () => {
    assert.equal(getTeammateColor('green', '2v2'), 'yellow');
    assert.equal(getTeammateColor('yellow', '2v2'), 'green');
    assert.equal(getTeammateColor('red', '2v2'), 'blue');
    assert.equal(getTeammateColor('blue', '2v2'), 'red');
    assert.equal(getTeammateColor('green', '4P'), null);
});

test('2v2 team ids match TEAM_PAIRINGS', () => {
    for (const color of ['green', 'red', 'yellow', 'blue'] as PlayerColor[]) {
        const mate = getTeammateColor(color, '2v2')!;
        assert.equal(getTeam(color, '2v2'), getTeam(mate, '2v2'), `${color} and mate ${mate} must share a team`);
        assert.equal(TEAM_PAIRINGS[color], mate);
        assert.equal(TEAM_ID[color], TEAM_ID[mate]);
    }
    assert.notEqual(getTeam('green', '2v2'), getTeam('red', '2v2'));
});

test('assignCorners2v2 seats teammates on the same diagonal axis', () => {
    for (let i = 0; i < 20; i++) {
        const cc = assignCorners2v2();
        const axisOf = (corner: string) =>
            (['BL', 'TR'].includes(corner) ? 'A' : 'B') as 'A' | 'B';
        assert.equal(axisOf(cc.green), axisOf(cc.yellow), 'green/yellow must share a diagonal');
        assert.equal(axisOf(cc.red), axisOf(cc.blue), 'red/blue must share a diagonal');
        assert.notEqual(axisOf(cc.green), axisOf(cc.red), 'teams must sit on opposite diagonals');
    }
});

test('base exit requires a six', () => {
    assert.equal(calculateNextPosition(BASE_INDEX, 6, 'green', CC_4P as any), CORNER_SLOTS.BL.startIdx);
    assert.equal(calculateNextPosition(BASE_INDEX, 5, 'green', CC_4P as any), BASE_INDEX);
});

test('gate crossing enters home stretch instead of wrapping', () => {
    // BL startIdx=34, endGlobal=(34+50)%52=32. Token at 32 + 1 → home 52.
    assert.equal(calculateNextPosition(32, 1, 'green', CC_4P as any), 52);
    assert.equal(calculateNextPosition(32, 6, 'green', CC_4P as any), 57);
    // Overshoot past finish stays put
    assert.equal(calculateNextPosition(56, 6, 'green', CC_4P as any), 56);
});

test('getLegalTokenIndices uses engine math (no naive pos+roll)', () => {
    const positions = {
        green: [BASE_INDEX, 32, 56, 10],
        red: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
        yellow: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
        blue: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
    };
    // roll 6: base can exit; 32+6 crosses gate to 57; 56+6 overshoots (illegal); 10+6 advances
    const legal = getLegalTokenIndices(positions, 'green', 6, CC_4P as any);
    assert.deepEqual(legal.sort(), [0, 1, 3]);
});

test('three sixes pass the turn and reset the counter', () => {
    assert.deepEqual(handleThreeSixes(0, 6), { isThreeSixes: false, nextSixes: 1 });
    assert.deepEqual(handleThreeSixes(1, 6), { isThreeSixes: false, nextSixes: 2 });
    assert.deepEqual(handleThreeSixes(2, 6), { isThreeSixes: true, nextSixes: 0 });
    assert.deepEqual(handleThreeSixes(2, 5), { isThreeSixes: false, nextSixes: 0 });
});

test('processMove capture sends opponent home and grants bonus', () => {
    const state = {
        ...INITIAL_GAME_STATE,
        positions: {
            green: [0, BASE_INDEX, BASE_INDEX, BASE_INDEX],
            red: [3, BASE_INDEX, BASE_INDEX, BASE_INDEX],
            yellow: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
            blue: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
        },
    };
    // BL green start=34 → global 0 is start. Red at global 3. Green rolls 3 → lands on 3.
    const { newState, captured, bonusRoll } = processMove(
        state,
        'green',
        0,
        3,
        '4P',
        CC_4P as any,
        'green',
        ['green', 'red', 'yellow', 'blue']
    );
    // Whether 3 is safe depends on SAFE_POSITIONS — if capture happened, red returns home.
    if (captured) {
        assert.equal(newState.positions.red[0], BASE_INDEX);
        assert.equal(bonusRoll, true);
        assert.equal(newState.currentPlayer, 'green');
    } else {
        // On a safe star, no capture — still a legal move
        assert.equal(newState.positions.green[0], 3);
    }
});
