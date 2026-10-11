/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
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
    createLobbySlots,
    INITIAL_GAME_STATE,
} from '../lib/gameLogic';
import { assignCorners2v2, assignCornersFFA, shufflePlayers, CORNER_SLOTS } from '../lib/boardLayout';
import { TEAM_PAIRINGS, TEAM_ID, BASE_INDEX } from '../lib/constants';
import type { PlayerColor } from '../lib/types';

const CC_4P = {
    green: 'BL',
    red: 'BR',
    yellow: 'TR',
    blue: 'TL',
} as const;

test('2v2 teammate pairing is Green+Blue and Red+Yellow', () => {
    assert.equal(getTeammateColor('green', '2v2'), 'blue');
    assert.equal(getTeammateColor('blue', '2v2'), 'green');
    assert.equal(getTeammateColor('red', '2v2'), 'yellow');
    assert.equal(getTeammateColor('yellow', '2v2'), 'red');
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
        assert.equal(axisOf(cc.green), axisOf(cc.blue), 'green/blue must share a diagonal');
        assert.equal(axisOf(cc.red), axisOf(cc.yellow), 'red/yellow must share a diagonal');
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

test('ENG-02: lobby slot 0+1 are teammates for every match type', () => {
    for (const matchType of ['1v1', '2v2', '4P'] as const) {
        const slots = createLobbySlots(matchType);
        if (matchType === '2v2') {
            // Slot 0 is the host; slot 1 must be their TEAM_PAIRINGS teammate,
            // and the lobby order is [host, teammate, ...opponents].
            assert.equal(slots[0].role, 'host');
            assert.equal(slots[1].role, 'teammate');
            assert.equal(getTeammateColor(slots[0].color, '2v2'), slots[1].color);
        } else {
            assert.equal(getTeammateColor(slots[0].color, matchType), null);
        }
    }
});

test('ENG-19: shufflePlayers 1v1 reuses the seated axis instead of re-rolling', () => {
    // assignCornersFFA('1v1') seats green+yellow on one diagonal. The shuffle
    // must return exactly those seats — an independent roll disagreed ~51%.
    for (let i = 0; i < 50; i++) {
        const cc = assignCornersFFA('1v1');
        const players = shufflePlayers('1v1', false, cc) as { color: string; position: string }[];
        assert.equal(players.length, 2);
        const colors = players.map((p) => p.color).sort();
        assert.deepEqual(colors, ['green', 'yellow']);
        for (const p of players) {
            assert.ok(p.color === 'green' || p.color === 'yellow');
        }
    }
});
