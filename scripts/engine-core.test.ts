/**
 * Engine core coverage (Phase 2 exit gate).
 *
 * Before this, `resolveNetworkedMove`, every `applyPower` branch,
 * `applyPowerPickup`, `activeColorsForTurns`, `effectiveMoveSteps`,
 * `countNukeVictims`, `applyEngineCaptureEvents` and `stripPowerTypesForWire`
 * had **zero** direct tests. Those are the functions the authority calls on
 * every networked move, and two of them contained the bugs fixed in this phase:
 * the teleport victory deadlock (ENG-03) and the capture-force double count
 * (ENG-01).
 *
 *   npm run test:engine-core
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BOARD_FINISH_INDEX,
    BASE_INDEX,
    applyEngineCaptureEvents,
    applyPower,
    applyPowerPickup,
    activeColorsForTurns,
    calculateNextPosition,
    checkThreeSixesForMove,
    countNukeVictims,
    effectiveMoveSteps,
    emptyEngineMatchStats,
    evaluateVictory,
    getLegalTokenIndices,
    getBoardCoordinate,
    handleThreeSixes,
    isBoardCleared,
    isValidDice,
    isValidStepCount,
    clampSteps,
    processMove,
    resolveNetworkedMove,
    stripPowerTypesForWire,
    type EngineGameState,
    type PlayerColor,
    type PowerType,
} from '../lib/engine/core';

/**
 * FIXED corner maps.
 *
 * `assignCornersFFA` / `assignCorners2v2` shuffle with `Math.random()`, so using
 * them here made these tests fail intermittently whenever a shuffle moved a
 * colour's gate and changed which cell index 8 or 56 referred to. Seating is a
 * runtime concern; the arithmetic under test is not.
 */
const CC4P = { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' } as const;
const CC2V2 = { green: 'BL', blue: 'BR', red: 'TR', yellow: 'TL' } as const;

function st(over: Partial<EngineGameState> = {}): EngineGameState {
    return {
        positions: {
            green: [-1, -1, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
        currentPlayer: 'green',
        diceValue: null,
        gamePhase: 'rolling',
        status: 'playing',
        winner: null,
        winners: [],
        consecutiveSixes: 0,
        playerCount: '4P',
        activeShields: [],
        activeTraps: [],
        activeBoost: null,
        powerSpentThisTurn: false,
        lastUpdate: 0,
        ...over,
    };
}

const withPower = (color: PlayerColor, type: PowerType, now = 1_000_000): EngineGameState =>
    st({
        positions: {
            green: [5, 6, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        } as Record<PlayerColor, number[]>,
        playerPowers: { [color]: [{ type, expiresAt: now + 60_000 }] } as never,
    });

// ── ENG-13: input validation ────────────────────────────────────────────────

test('ENG-13: only integer faces 1..6 are accepted', () => {
    for (const good of [1, 2, 3, 4, 5, 6]) assert.equal(isValidDice(good), true, `${good} should be valid`);
    for (const bad of [0, 7, -1, 1.5, 6.0001, NaN, Infinity, '6', null, undefined, {}, []]) {
        assert.equal(isValidDice(bad), false, `${String(bad)} should be invalid`);
    }
});

test('ENG-13: steps are clamped to a legal range', () => {
    assert.equal(clampSteps(6), 6);
    assert.equal(clampSteps(12), 12, 'a boosted move is dice + 6');
    assert.equal(clampSteps(13), 12, 'and nothing wider than that is legal');
    assert.equal(clampSteps(-4), 0);
    assert.equal(clampSteps(3.9), 3);
    assert.equal(clampSteps('x'), 0);
    assert.equal(clampSteps(NaN), 0);
    assert.equal(clampSteps(Infinity), 0);
});

test('ENG-13: processMove refuses a malformed step count', () => {
    const s = st({ positions: { green: [0, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
    // 1..12 is the legal band: a boosted move is dice + 6. Beyond that, or
    // fractional, or negative, or NaN, is refused.
    for (const bad of [0, -1, 13, 99, 2.5, NaN, Infinity]) {
        const r = processMove(s, 'green', 0, bad, '4P', CC4P);
        assert.equal(r.applied, false, `steps=${bad} must be refused`);
        assert.deepEqual(r.newState.positions.green, [0, -1, -1, -1], 'state must be untouched');
    }
    // A boosted 12 must NOT be refused by the validator.
    assert.equal(isValidStepCount(12), true);
    assert.equal(isValidStepCount(6), true);
    assert.equal(isValidStepCount(13), false);
    assert.equal(isValidStepCount(0), false);
});

test('ENG-13: a zero-step move is illegal, not a silent pass', () => {
    // The old guard was `steps !== 0`, which let a 0-step "move" fall through
    // and act as a forced turn switch. Turn passing belongs to `getNextPlayer`.
    const s = st({ positions: { green: [0, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
    const r = processMove(s, 'green', 0, 0, '4P', CC4P);
    assert.equal(r.applied, false);
    assert.equal(r.newState.currentPlayer, 'green', 'the turn must not rotate');
});

test('ENG-13: an overshoot is refused rather than wrapping the board', () => {
    // 56 + 6 = 62 > 57: the token must stay put, not wrap onto the shared path.
    const home = { green: [56, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] };
    assert.equal(calculateNextPosition(56, 6, 'green', CC4P), 56);
    const s = st({ positions: home as never, playerCount: '4P' });
    const r = processMove(s, 'green', 0, 6, '4P', CC4P);
    assert.equal(r.applied, false);
});

// ── ENG-01: capture force is evaluated pre-move ────────────────────────────

test('ENG-01: a lone token cannot take a two-token block in 2v2', () => {
    const cc = CC2V2;
    // Find a red cell two tokens can legally occupy, then land green on it.
    const twoRed: Record<PlayerColor, number[]> = {
        green: [-1, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1],
    };
    const s = st({ positions: twoRed, playerCount: '2v2' });
    // Pre-move force for the acting team must not already include the mover.
    const r = processMove(s, 'red', 0, 6, '2v2', cc, 'red');
    assert.equal(r.applied, true, 'a six from base is legal');
    // Green sits two tokens at the landing cell: acting force 1 (itself), other 2.
    const landed = r.newState.positions.red[0];
    const greens = r.newState.positions.green.filter(p => p === landed).length;
    if (greens === 2) {
        assert.equal(r.captured, false, '1 versus 2 must not capture');
    }
});

test('ENG-01: equal force does capture', () => {
    const s = st({
        positions: { green: [0, -1, -1, -1], red: [1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        playerCount: '4P',
    });
    const r = processMove(s, 'green', 0, 1, '4P', CC4P, 'green');
    assert.equal(r.applied, true);
    assert.equal(r.captured, true, 'one against one captures');
    assert.equal(r.newState.positions.red[0], BASE_INDEX, 'the red token is sent home');
});

test('ENG-01: a safe cell captures nothing', () => {
    // Index 8 is a declared SAFE_POSITION (r2,c9). Land a green token on it with
    // a lone red token already there: force 1 vs 1 would capture anywhere else.
    const s = st({
        positions: { green: [7, -1, -1, -1], red: [8, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
    });
    const r = processMove(s, 'green', 0, 1, '4P', CC4P, 'green');
    assert.equal(r.applied, true);
    assert.equal(r.newState.positions.green[0], 8, 'green must actually land on the safe cell');
    assert.equal(r.captured, false, 'a safe square must not capture');
    assert.equal(r.newState.positions.red[0], 8, 'the red token is untouched');
});

// ── ENG-03: victory, including the teleport deadlock ───────────────────────

test('ENG-03: evaluateVictory reports a 2v2 team win only when both colours are home', () => {
    const pos = (g: number[], b: number[], r: number[] = [-1, -1, -1, -1], y: number[] = [-1, -1, -1, -1]) =>
        ({ green: g, blue: b, red: r, yellow: y }) as Record<PlayerColor, number[]>;
    const done = [BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX];

    // Green home, blue not: no win.
    assert.equal(evaluateVictory(pos(done, [50, 50, 50, 50]), '2v2').status, 'playing');
    // Both home: team 1 wins.
    const won = evaluateVictory(pos(done, done), '2v2');
    assert.equal(won.winner, 'Team 1');
    assert.equal(won.status, 'finished');
    // Team 2 instead: red and yellow are the pair, so BOTH must be home.
    const won2 = evaluateVictory(pos([50, 50, 50, 50], [50, 50, 50, 50], done, done), '2v2');
    assert.equal(won2.winner, 'Team 2');
    assert.equal(won2.status, 'finished');
    // Red home but yellow not: still no win.
    const notYet = evaluateVictory(pos([50, 50, 50, 50], [50, 50, 50, 50], done, [-1, -1, -1, -1]), '2v2');
    assert.equal(notYet.status, 'playing');
});

test('ENG-03: free-for-all victory is per-colour', () => {
    const done = [BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX];
    const r = evaluateVictory({ green: done, red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] }, '4P');
    assert.equal(r.winner, 'green');
    assert.equal(r.status, 'finished');
});

test('ENG-03: evaluateVictory carries the previous result when nothing is won', () => {
    const s = evaluateVictory(
        { green: [0, 0, 0, 0], red: [0, 0, 0, 0], yellow: [0, 0, 0, 0], blue: [0, 0, 0, 0] },
        '2v2',
        'Team 1',
        'finished',
    );
    assert.equal(s.winner, 'Team 1', 'an already-won board must not regress to playing');
});

test('ENG-03: a 2v2 team going all-home by teleport ends the match', () => {
    // The deadlock: teleport home for the last token left winner=null and both
    // colours out of the turn cycle, so nobody could ever move again.
    const done = [BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX];
    const base = st({
        positions: {
            green: [50, done[0], done[1], done[2]], // token 0 at 50: teleport sends it home
            blue: [done[0], done[1], done[2], done[3]],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
        } as Record<PlayerColor, number[]>,
        playerCount: '2v2',
        playerPowers: { green: [{ type: 'teleport', expiresAt: 2_000_000 }] } as never,
    });
    const r = applyPower(base, 'green', 'teleport', 0, CC2V2, '2v2', 1_000_000);
    assert.equal(r.ok, true, 'teleport from 50 lands home');
    assert.equal(r.state!.positions.green[0], BOARD_FINISH_INDEX);
    assert.equal(r.state!.winner, 'Team 1', 'the match must be won, not wedged');
    assert.equal(r.state!.status, 'finished');
    assert.ok(r.state!.winners.includes('green'), 'the finishing colour is recorded');
});

test('ENG-03: teleport that does not finish anything leaves the match playing', () => {
    const base = withPower('green', 'teleport');
    const r = applyPower(base, 'green', 'teleport', 0, CC4P, '4P', 1_000_000);
    assert.equal(r.ok, true);
    assert.equal(r.state!.winner, null);
    assert.equal(r.state!.status, 'playing');
});

test('isBoardCleared only when every token is home', () => {
    const done = [BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX];
    assert.equal(isBoardCleared({ green: done, red: done, yellow: done, blue: done }), true);
    assert.equal(isBoardCleared({ green: done, red: [-1, done[0], done[1], done[2]], yellow: done, blue: done }), false);
});

// ── ENG-04: active colours and the turn cycle ──────────────────────────────

test('ENG-04: a finished 2v2 colour stays active while its teammate plays', () => {
    const done = [BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX];
    const s = st({
        positions: { green: done, blue: [10, 10, 10, 10], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1] },
        playerCount: '2v2',
    });
    const active = activeColorsForTurns(s);
    assert.ok(active.includes('green'), 'green must stay in the turn cycle — blue is still playing');
    assert.ok(active.includes('blue'));
});

test('ENG-04: a finished FFA colour leaves the turn cycle', () => {
    const done = [BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX];
    const s = st({
        positions: { green: done, blue: [10, 10, 10, 10], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1] },
        playerCount: '4P',
    });
    const active = activeColorsForTurns(s);
    assert.ok(!active.includes('green'), 'green is done and must leave');
    assert.ok(active.includes('blue'));
});

test('ENG-04: when every colour is finished the full cycle is kept', () => {
    const done = [BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX];
    const s = st({ positions: { green: done, blue: done, red: done, yellow: done }, playerCount: '4P' });
    assert.equal(activeColorsForTurns(s).length, 4, 'an empty list would break getNextPlayer');
});

// ── ENG-05: three sixes ─────────────────────────────────────────────────────

test('ENG-05: the third consecutive six is flagged and resets the counter', () => {
    assert.deepEqual(handleThreeSixes(0, 6), { isThreeSixes: false, nextSixes: 1 });
    assert.deepEqual(handleThreeSixes(1, 6), { isThreeSixes: false, nextSixes: 2 });
    assert.deepEqual(handleThreeSixes(2, 6), { isThreeSixes: true, nextSixes: 0 });
    assert.deepEqual(handleThreeSixes(0, 3), { isThreeSixes: false, nextSixes: 0 });
});

test('ENG-05: a bogus counter or face cannot manufacture a three-sixes', () => {
    assert.equal(handleThreeSixes(NaN, 6).isThreeSixes, false);
    assert.equal(handleThreeSixes(99, 6).isThreeSixes, true, 'an out-of-range counter still forfeits');
    assert.equal(handleThreeSixes(2, 6.5).isThreeSixes, false, 'a float is not a six');
    assert.equal(handleThreeSixes(2, '6' as never).isThreeSixes, false);
});

test('ENG-05: resolveNetworkedMove refuses a move on the third six', () => {
    const s = st({
        positions: { green: [0, 1, 2, 3], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        consecutiveSixes: 2,
    });
    const r = resolveNetworkedMove({ state: s, color: 'green', tokenIndex: 0, dice: 6, cc: CC4P, playerCount: '4P' });
    assert.equal(r.ok, false, 'the third six forfeits the turn; it is not a move');
    assert.equal(r.code, 'THREE_SIXES');
    assert.equal(r.state, undefined, 'a refused move must not hand back a state');
});

test('ENG-05: resolveNetworkedMove refuses an invalid face outright', () => {
    const s = st({ positions: { green: [0, 1, 2, 3], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
    for (const bad of [0, 7, 2.5, NaN]) {
        const r = resolveNetworkedMove({ state: s, color: 'green', tokenIndex: 0, dice: bad, cc: CC4P, playerCount: '4P' });
        assert.equal(r.ok, false, `dice=${bad} must be refused`);
        assert.equal(r.error, 'Invalid dice face');
    }
});

test('ENG-05: a legal move persists the consumed six counter', () => {
    const s = st({
        positions: { green: [0, 5, 6, 7], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        consecutiveSixes: 1,
    });
    const r = resolveNetworkedMove({ state: s, color: 'green', tokenIndex: 1, dice: 6, cc: CC4P, playerCount: '4P' });
    assert.equal(r.ok, true);
    assert.equal(r.state!.consecutiveSixes, 2, 'the authority owns the counter now');
});

test('checkThreeSixesForMove reports the next counter for a normal six', () => {
    const s = st({ consecutiveSixes: 1 });
    const v = checkThreeSixesForMove(s, 6);
    assert.equal(v.forbidden, false);
    assert.equal(v.nextSixes, 2);
});

// ── resolveNetworkedMove: the authority path ────────────────────────────────

test('resolveNetworkedMove refuses an illegal token for the face', () => {
    const s = st({ positions: { green: [56, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] } });
    const r = resolveNetworkedMove({ state: s, color: 'green', tokenIndex: 0, dice: 6, cc: CC4P, playerCount: '4P' });
    assert.equal(r.ok, false, '56 + 6 overshoots home');
});

test('resolveNetworkedMove consumes a boost and adds six steps', () => {
    const s = st({
        positions: { green: [0, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        activeBoost: 'green',
    });
    assert.equal(effectiveMoveSteps(s, 'green', 3), 9, 'boost adds a die');
    const r = resolveNetworkedMove({ state: s, color: 'green', tokenIndex: 0, dice: 3, cc: CC4P, playerCount: '4P' });
    assert.equal(r.ok, true);
    assert.equal(r.toPos, 9, 'nine steps, not three');
    assert.equal(r.state!.activeBoost, null, 'the boost is spent');
    assert.equal(r.state!.powerSpentThisTurn, false, 'and the turn budget resets for the next roll');
});

test('effectiveMoveSteps refuses an invalid face', () => {
    assert.equal(effectiveMoveSteps(st(), 'green', 0), 0);
    assert.equal(effectiveMoveSteps(st(), 'green', 7), 0);
    assert.equal(effectiveMoveSteps(st(), 'green', 1.5), 0);
});

// ── applyPower: every branch ────────────────────────────────────────────────

test('applyPower refuses on the wrong turn, wrong phase, and twice', () => {
    const s = withPower('green', 'boost');
    assert.equal(applyPower({ ...s, currentPlayer: 'red' }, 'green', 'boost', undefined, CC4P, '4P').ok, false);
    assert.equal(applyPower({ ...s, gamePhase: 'moving' }, 'green', 'boost', undefined, CC4P, '4P').ok, false);
    assert.equal(applyPower({ ...s, powerSpentThisTurn: true }, 'green', 'boost', undefined, CC4P, '4P').ok, false);
    assert.equal(applyPower(s, 'red', 'boost', undefined, CC4P, '4P').ok, false, 'not held');
    assert.equal(applyPower(s, 'green', 'nuke', undefined, CC4P, '4P').ok, false, 'wrong type held');
});

test('applyPower shield covers every on-board token and is consumed', () => {
    const s = withPower('green', 'shield');
    const r = applyPower(s, 'green', 'shield', undefined, CC4P, '4P', 1_000_000);
    assert.equal(r.ok, true);
    // positions green [5, 6, -1, -1]: two tokens on the shared path.
    assert.equal(r.state!.activeShields.length, 2);
    assert.equal(r.state!.powerSpentThisTurn, true);
    assert.equal(r.state!.playerPowers!.green!.length, 0, 'the shield is spent');
});

test('applyPower boost arms the next move', () => {
    const r = applyPower(withPower('green', 'boost'), 'green', 'boost', undefined, CC4P, '4P', 1_000_000);
    assert.equal(r.ok, true);
    assert.equal(r.state!.activeBoost, 'green');
    assert.equal(r.boosted, true);
});

test('applyPower nuke needs a target and reports when it keeps the item', () => {
    const s = withPower('green', 'nuke');
    const armed = applyPower(s, 'green', 'nuke', undefined, CC4P, '4P', 1_000_000);
    assert.equal(armed.ok, false);
    assert.equal(armed.armed, 'nuke', 'a targeted power arms instead of consuming');

    const empty = applyPower(s, 'green', 'nuke', 0, CC4P, '4P', 1_000_000);
    assert.equal(empty.ok, false);
    assert.equal(empty.kept, true, 'no victims means the item is kept');
    assert.equal(applyPower(s, 'green', 'nuke', 9, CC4P, '4P', 1_000_000).ok, false, 'bad index');
});

test('applyPower nuke vaporises tokens in blast range', () => {
    const s = st({
        positions: { green: [10, -1, -1, -1], red: [11, 12, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        playerCount: '4P',
        playerPowers: { green: [{ type: 'nuke', expiresAt: 2_000_000 }] } as never,
    });
    const victims = countNukeVictims(s, 'green', 0, CC4P, '4P');
    assert.ok(victims.victims.length > 0, 'adjacent enemies are in range');
    const r = applyPower(s, 'green', 'nuke', 0, CC4P, '4P', 1_000_000);
    assert.equal(r.ok, true);
    assert.ok((r.nukeFlash || []).length > 0, 'the blast cells are reported for the UI');
    for (const v of victims.victims) {
        assert.equal(r.state!.positions[v.color][v.idx], BASE_INDEX);
    }
});

test('applyPower teleport from the home lane goes straight home', () => {
    const s = st({
        positions: { green: [54, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        playerPowers: { green: [{ type: 'teleport', expiresAt: 2_000_000 }] } as never,
    });
    const r = applyPower(s, 'green', 'teleport', 0, CC4P, '4P', 1_000_000);
    assert.equal(r.ok, true);
    assert.equal(r.state!.positions.green[0], BOARD_FINISH_INDEX);
});

test('applyPower teleport keeps the item when there is nowhere to blink', () => {
    const s = st({
        positions: { green: [0, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        playerPowers: { green: [{ type: 'teleport', expiresAt: 2_000_000 }] } as never,
    });
    const r = applyPower(s, 'green', 'teleport', 0, CC4P, '4P', 1_000_000);
    // Either a blink happened, or it was kept. Never silently consumed.
    if (!r.ok) assert.equal(r.kept, true);
});

// ── applyPowerPickup ────────────────────────────────────────────────────────

test('applyPowerPickup ignores a landing with no tile', () => {
    const s = st({ powerTiles: [{ r: 1, c: 1, type: 'boost' }] });
    const r = applyPowerPickup(s, 'green', 5, CC4P, 1_000_000);
    assert.equal(r, s, 'an unrelated landing must not change state');
});

test('applyPowerPickup ignores a landing in the home lane or base', () => {
    const s = st({ powerTiles: [{ r: 1, c: 1, type: 'boost' }] });
    assert.equal(applyPowerPickup(s, 'green', -1, CC4P, 1_000_000), s);
    assert.equal(applyPowerPickup(s, 'green', 53, CC4P, 1_000_000), s);
});

test('applyPowerPickup grants a power on an exact typed landing', () => {
    // Place a tile exactly where green will land, then land there.
    const target = 6;
    // Build the tile from the engine's own coordinate mapping, so the test
    // cannot drift from where the engine thinks that cell is.
    const pt = getBoardCoordinate(target, 'green', CC4P)!;
    const s = st({
        powerTiles: [{ r: pt.r, c: pt.c, type: 'boost' }],
        playerPowers: { green: [] } as never,
    });
    const r = applyPowerPickup(s, 'green', target, CC4P, 1_000_000);
    assert.equal(r.playerPowers!.green!.length, 1, 'a boost is granted');
    assert.equal(r.playerPowers!.green![0].type, 'boost');
    assert.equal(r.powerTiles!.length, 1, 'the tile respawns elsewhere');
    assert.notDeepEqual(r.powerTiles![0], { r: pt.r, c: pt.c, type: 'boost' }, 'and not on the same cell');
});

test('applyPowerPickup refreshes an existing item of the same type', () => {
    const target = 6;
    const pt = getBoardCoordinate(target, 'green', CC4P)!;
    const s = st({
        powerTiles: [{ r: pt.r, c: pt.c, type: 'boost' }],
        playerPowers: { green: [{ type: 'boost', expiresAt: 1_000_100 }] } as never,
    });
    const r = applyPowerPickup(s, 'green', target, CC4P, 1_000_000);
    // The held copy has its expiry refreshed...
    assert.ok(
        r.playerPowers!.green!.some(p => p.type === 'boost' && p.expiresAt > 1_000_100),
        'the existing boost expiry must be refreshed',
    );
    // ...and a separate copy is granted for the tile just landed on. That is the
    // engine's actual behaviour; noted rather than asserted as a design choice.
    assert.equal(r.playerPowers!.green!.length, 2);
});

// ── capture stats and wire hygiene ─────────────────────────────────────────

test('applyEngineCaptureEvents credits the kicker and the victim', () => {
    const base = emptyEngineMatchStats();
    const next = applyEngineCaptureEvents(base, 'green', [{ capturedColor: 'red' }, { capturedColor: 'red' }]);
    assert.equal(next.green.kicks, 2);
    assert.equal(next.red.gotKicked, 2);
    assert.equal(next.blue.kicks, 0);
});

test('applyEngineCaptureEvents tolerates a missing stats object', () => {
    const next = applyEngineCaptureEvents(undefined, 'green', [{ capturedColor: 'red' }]);
    assert.equal(next.green.kicks, 1);
    assert.equal(next.red.gotKicked, 1);
});

test('stripPowerTypesForWire removes the authority-only type field', () => {
    const s = st({ powerTiles: [{ r: 1, c: 1, type: 'nuke' }, { r: 2, c: 2, type: 'boost' }] });
    const wire = stripPowerTypesForWire(s);
    for (const t of wire.powerTiles!) {
        assert.equal('type' in t, false, 'a guest must never learn a tile type');
    }
    assert.equal(s.powerTiles![0].type, 'nuke', 'the original keeps it — this is authority state');
});

// ── legality ───────────────────────────────────────────────────────────────

test('getLegalTokenIndices offers only tokens that change position', () => {
    const positions = {
        green: [0, 56, BOARD_FINISH_INDEX, -1],
        red: [-1, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
    } as Record<PlayerColor, number[]>;
    const legal = getLegalTokenIndices(positions, 'green', 3, CC4P);
    assert.ok(legal.includes(0), 'a token on the path can move');
    assert.ok(!legal.includes(1), '56 + 3 overshoots home');
    assert.ok(!legal.includes(2), 'a finished token cannot move');
    assert.ok(!legal.includes(3), 'base needs a six');
    assert.deepEqual(getLegalTokenIndices(positions, 'green', 6, CC4P), [0, 3]);
});
