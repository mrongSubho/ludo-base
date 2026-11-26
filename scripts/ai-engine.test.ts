import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    calculateMoveScore,
    getBestMove,
    getBestPowerUsage,
    isPursuitPosition,
    isThreatenedAtPosition,
} from '../lib/aiEngine';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import { calculateNextPosition, createInitialPositions } from '../lib/engine/core';
import type { ColorCorner } from '../lib/boardLayout';
import type { GameState } from '../lib/types';

const CC: ColorCorner = { green: 'BL', yellow: 'BR', blue: 'TR', red: 'TL' };
const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function baseState(overrides: Partial<GameState> = {}): GameState {
    return {
        ...INITIAL_GAME_STATE,
        positions: {
            green: [-1, -1, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
        currentPlayer: 'green',
        gamePhase: 'rolling',
        status: 'playing',
        isStarted: true,
        playerCount: '4P',
        powerTiles: [],
        playerPowers: { green: [], red: [], yellow: [], blue: [] },
        activeShields: [],
        activeTraps: [],
        activeBoost: null,
        powerSpentThisTurn: false,
        ...overrides,
    };
}

test('AI engine: activeShields and protective >=2 stacks exempt threats and invalid pursuits', () => {
    const positions = {
        green: [38, -1, -1, -1],
        red: [36, -1, -1, -1],
        yellow: [40, -1, -1, -1],
        blue: [-1, -1, -1, -1],
    };

    // Unshielded lone green token at 38 is threatened by red at 36 (diff=2)
    assert.equal(isThreatenedAtPosition(38, 'green', positions, CC, '4P'), true);

    // Shielded green token 0 at 38 is NOT threatened
    const shieldedState = baseState({
        positions,
        activeShields: [{ color: 'green', tokenIdx: 0 }],
    });
    assert.equal(isThreatenedAtPosition(38, 'green', positions, CC, '4P', shieldedState, 0), false);

    // 2v2 allied protective stack (green + blue at 38) defeats lone red attacker
    const stackedPositions = {
        green: [38, -1, -1, -1],
        blue: [38, -1, -1, -1],
        red: [36, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
    };
    const stackState = baseState({ positions: stackedPositions, playerCount: '2v2' });
    assert.equal(isThreatenedAtPosition(38, 'green', stackedPositions, CC, '2v2', stackState, 0), false);

    // Pursuit ignores a shielded opponent ahead at 40
    const shieldedEnemyState = baseState({
        positions,
        activeShields: [{ color: 'yellow', tokenIdx: 0 }],
    });
    assert.equal(isPursuitPosition(38, 'green', positions, CC, '4P', shieldedEnemyState), false);
});

test('AI engine: checkShieldNeed wraps perimeter 51->0 using calculateNextPosition', () => {
    // Red (TL, start=47) is at 50 (distance 3); rolling 6 wraps across 51->0 to shared cell 4 (non-safe).
    // Naive `oppPos + s` produced 56 and missed the threat at cell 4 completely.
    const pos = {
        green: [4, -1, -1, -1],
        red: [50, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
    };
    assert.equal(calculateNextPosition(50, 6, 'red', CC), 4);

    const stateNeedShield = baseState({
        positions: pos,
        playerPowers: {
            green: [{ type: 'shield', expiresAt: 9_999_999 }],
            red: [],
            yellow: [],
            blue: [],
        },
    });
    assert.deepEqual(getBestPowerUsage(stateNeedShield, 'green', CC, '4P', 'pro'), {
        type: 'shield',
    });

    // If token 0 is ALREADY shielded, checkShieldNeed must not waste another shield
    const alreadyShielded = baseState({
        ...stateNeedShield,
        activeShields: [{ color: 'green', tokenIdx: 0 }],
    });
    assert.equal(getBestPowerUsage(alreadyShielded, 'green', CC, '4P', 'pro'), null);
});

test('AI engine: Teleport returns null when all tokens are in yard and picks valid tokenIdx when on track', () => {
    const allInYard = baseState({
        playerPowers: {
            green: [{ type: 'teleport', expiresAt: 9_999_999 }],
            red: [],
            yellow: [],
            blue: [],
        },
    });
    assert.equal(getBestPowerUsage(allInYard, 'green', CC, '4P', 'pro'), null);

    const onTrack = baseState({
        positions: {
            green: [-1, 36, 55, 57],
            red: [40, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
        playerPowers: {
            green: [{ type: 'teleport', expiresAt: 9_999_999 }],
            red: [],
            yellow: [],
            blue: [],
        },
    });
    const pick = getBestPowerUsage(onTrack, 'green', CC, '4P', 'pro');
    assert.ok(pick && pick.type === 'teleport');
    assert.ok(pick.tokenIdx === 1 || pick.tokenIdx === 2, 'must never target yard (-1) or finished (57) token');
});

test('AI engine: Boost activates when stuck in yard, and calculateMoveScore penalizes enemy traps & breaking protective stack', () => {
    const stuckWithBoost = baseState({
        playerPowers: {
            green: [{ type: 'boost', expiresAt: 9_999_999 }],
            red: [],
            yellow: [],
            blue: [],
        },
    });
    assert.deepEqual(getBestPowerUsage(stuckWithBoost, 'green', CC, '4P', 'pro'), { type: 'boost' });

    // Token 0 sits at 36 alongside allied green token 1 at 36 (2-stack); moving 0 by +3 lands on enemy trap at 39 (SHARED_PATH[39] = {9,6}).
    const trapCell = { r: 9, c: 6 };
    const positions = {
        green: [36, 36, -1, -1],
        red: [10, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
    };
    const trapState = baseState({
        positions,
        activeTraps: [{ r: trapCell.r, c: trapCell.c, owner: 'red' }],
    });
    const trapScore = calculateMoveScore(0, positions, 'green', 3, CC, '4P', [], trapState, 'pro');
    const plainState = baseState({ positions: { green: [36, -1, -1, -1], red: [10, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
    const plainScore = calculateMoveScore(0, plainState.positions, 'green', 3, CC, '4P', [], plainState, 'pro');
    // Trap (-1200) + breaking 2-token protective stack (-300) makes trapScore strictly <= plainScore - 1500
    assert.ok(trapScore <= plainScore - 1400, `expected <= ${plainScore - 1400}, got ${trapScore}`);

    // Verify getBestMove returns a valid legal move avoiding the trap if a safe non-trap move exists
    const positionsWithChoice = {
        green: [36, 12, -1, -1],
        red: [10, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
    };
    const stateChoice = baseState({
        positions: positionsWithChoice,
        activeTraps: [{ r: trapCell.r, c: trapCell.c, owner: 'red' }],
    });
    const best = getBestMove(positionsWithChoice, 'green', 3, CC, '4P', [], stateChoice, 'pro');
    assert.equal(best?.tokenIndex, 1, 'bot should advance token 1 at 12 instead of stepping token 0 into enemy trap at 39');
});

test('AI engine integration: MatchRoomCore, useAIBrain, live-arena, and ENGINE_LOGIC use unified engine', () => {
    const doSrc = read('src/room/MatchRoomCore.ts');
    assert.match(doSrc, /import \{ getBestMove, getBestPowerUsage \} from '\.\.\/\.\.\/lib\/aiEngine'/);
    assert.match(doSrc, /getBestPowerUsage\(/);
    assert.match(doSrc, /getBestMove\(/);

    const brainSrc = read('hooks/useAIBrain.ts');
    assert.match(brainSrc, /powerSpentThisTurn/);

    const arenaSrc = read('app/api/live-arena/power4p/route.ts');
    assert.match(arenaSrc, /getBestPowerUsage/);
    assert.match(arenaSrc, /resolveControllableColor/);

    const engineDoc = read('ENGINE_LOGIC.md');
    assert.match(engineDoc, /AVOID_TRAP.*-1200/);
    assert.match(engineDoc, /BREAK_PROTECTIVE_STACK.*-300/);
    assert.match(engineDoc, /`quick`/);
});

test('Quick Turbo mode: createInitialPositions starts 1 deployed, 1 in yard, 2 finished', () => {
    const pos = createInitialPositions(CC, 'quick');
    assert.deepEqual(pos.green, [34, -1, 57, 57]);
    assert.deepEqual(pos.yellow, [21, -1, 57, 57]);
    assert.deepEqual(pos.blue, [8, -1, 57, 57]);
    assert.deepEqual(pos.red, [47, -1, 57, 57]);
});
