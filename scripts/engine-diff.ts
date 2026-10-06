/* eslint-disable @typescript-eslint/no-explicit-any -- diff harness compares two differently-typed engines */
/**
 * Engine divergence harness (Phase 2 / ENG-01).
 *
 * Two engines resolve the same rules:
 *   - `lib/engine/core.ts`      — the authority; Edge imports this (synced copy)
 *   - `lib/gameLogic.ts`        — the app's original
 *
 * They have already disagreed about captures, which is the worst possible class
 * of bug in a wagering game: the same board position resolves differently
 * depending on which module the caller reached for.
 *
 * This harness runs seeded matches through both and asserts they agree on
 * `positions` / `captured` / `winner` / `bonusRoll` at every step. Deterministic
 * PRNG, so a failure is reproducible from the printed seed.
 *
 *   npm run test:engine-diff
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    processMove as coreMove,
    getLegalTokenIndices as coreLegal,
    getNextPlayer as coreNextPlayer,
    activeColorsForTurns as coreActive,
} from '../lib/engine/core';
import {
    processMove as glMove,
    getLegalTokenIndices as glLegal,
    getNextPlayer as glNextPlayer,
    INITIAL_GAME_STATE,
} from '../lib/gameLogic';
import type { EngineGameState, PlayerColor } from '../lib/engine/core';
import type { GameState } from '../lib/types';

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

/**
 * Board layout shared by both engines.
 *
 * Fixed rather than shuffled: `assignCornersFFA`/`assignCorners2v2` use
 * `Math.random()`, which would make a fuzz harness irreproducible — a failure
 * could not be replayed from its seed. The divergence this harness hunts is a
 * rule difference, not a seating one.
 */
const SEATING: Record<'1v1' | '2v2' | '4P', Record<PlayerColor, 'BL' | 'BR' | 'TR' | 'TL'>> = {
    '1v1': { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' },
    '2v2': { green: 'BL', blue: 'BR', red: 'TR', yellow: 'TL' },
    '4P': { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' },
};
function cornersFor(mode: '1v1' | '2v2' | '4P') {
    return SEATING[mode];
}

/**
 * The two engines use different state shapes (`EngineGameState` has `playerCount`
 * and `status`; `GameState` has `strikes`, `afkStats`, and friends). Build both
 * from one set of positions so a divergence can only come from the rules.
 */
function pairState(
    positions: Record<PlayerColor, number[]>,
    currentPlayer: PlayerColor,
    mode: '1v1' | '2v2' | '4P',
    consecutiveSixes: number,
): { core: EngineGameState; gl: GameState } {
    const base: any = INITIAL_GAME_STATE;
    const gl: GameState = {
        ...(base as GameState),
        positions: JSON.parse(JSON.stringify(positions)),
        currentPlayer,
        gamePhase: 'moving',
        status: 'playing',
        consecutiveSixes,
        winner: null,
        winners: [],
        activeShields: [],
        activeTraps: [],
        activeBoost: null,
        powerSpentThisTurn: false,
        matchStats: base.matchStats,
    };
    const core: EngineGameState = {
        positions: JSON.parse(JSON.stringify(positions)),
        currentPlayer,
        diceValue: null,
        gamePhase: 'moving',
        status: 'playing',
        winner: null,
        winners: [],
        consecutiveSixes,
        playerCount: mode,
        activeShields: [],
        activeTraps: [],
        activeBoost: null,
        powerSpentThisTurn: false,
        lastUpdate: 0,
    };
    return { core, gl };
}

interface Divergence {
    seed: number;
    mode: string;
    step: number;
    what: string;
    core: unknown;
    gl: unknown;
}

/**
 * Play one seeded match on both engines in lockstep and report the first
 * divergence. Returns the divergence, or null when they agree throughout.
 */
function playMatch(seed: number, mode: '1v1' | '2v2' | '4P', maxSteps = 400): Divergence | null {
    const rand = rng(seed);
    const cc = cornersFor(mode);
    let positions: Record<PlayerColor, number[]> = {
        green: [-1, -1, -1, -1],
        red: [-1, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
    };
    // Start positions 0..9 keep tokens near their own gate, which is where the
    // gate-crossing and capture arithmetic actually gets exercised. Starting
    // everything in base means most seeded matches never reach a contested cell,
    // and a corpus of matches that never capture proves nothing.
    for (const c of COLORS) {
        const n = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) positions[c][i] = Math.floor(rand() * 10);
    }

    let currentPlayer: PlayerColor = COLORS[Math.floor(rand() * 4)];
    let consecutiveSixes = 0;

    for (let step = 0; step < maxSteps; step++) {
        const dice = 1 + Math.floor(rand() * 6);
        const { core, gl } = pairState(positions, currentPlayer, mode, consecutiveSixes);
        // Identical activeColors to both. `getNextPlayer` filters the corner order
        // by this list, so feeding one engine a filtered list and the other none
        // compares two different questions. Note the app passes `initialPlayers`
        // colours while move-auth passes `activeColorsForTurns` — that
        // inconsistency is ENG-04's subject, not an engine divergence.
        const active = coreActive(core);

        const coreIdx = coreLegal(core.positions, currentPlayer, dice, cc);
        const glIdx = glLegal(gl.positions as any, currentPlayer, dice, cc as any);
        if (JSON.stringify(coreIdx) !== JSON.stringify(glIdx)) {
            return {
                seed, mode, step, what: 'getLegalTokenIndices',
                core: coreIdx, gl: glIdx,
            };
        }
        if (coreIdx.length === 0) {
            // No legal token: the turn passes. Turn rotation is `getNextPlayer`'s
            // job, not `processMove`'s — passing a 0 step count to processMove
            // used to double as a forced pass, which ENG-13 removed (a zero-step
            // move has no destination change, so it is simply illegal now). The
            // Edge boundary has a dedicated `pass` action for this.
            const coreTurn = coreNextPlayer(currentPlayer, mode, active, cc);
            const glTurn = glNextPlayer(currentPlayer, mode, active, cc as any);
            if (coreTurn !== glTurn) {
                return { seed, mode, step, what: 'turn rotation with no legal token', core: coreTurn, gl: glTurn };
            }
            currentPlayer = coreTurn;
            consecutiveSixes = 0;
            continue;
        }

        const tokenIndex = coreIdx[Math.floor(rand() * coreIdx.length)];
        const coreNext = coreMove(core, currentPlayer, tokenIndex, dice, mode, cc, currentPlayer, active);
        const glNext = glMove(gl, currentPlayer, tokenIndex, dice, mode, cc as any, currentPlayer, active);

        for (const key of ['captured', 'bonusRoll'] as const) {
            if (coreNext[key] !== glNext[key]) {
                return { seed, mode, step, what: key, core: coreNext[key], gl: glNext[key] };
            }
        }
        if (coreNext.newState.winner !== glNext.newState.winner) {
            return {
                seed, mode, step, what: 'winner',
                core: coreNext.newState.winner, gl: glNext.newState.winner,
            };
        }
        if (JSON.stringify(coreNext.newState.positions) !== JSON.stringify(glNext.newState.positions)) {
            return {
                seed, mode, step, what: 'positions',
                core: coreNext.newState.positions, gl: glNext.newState.positions,
            };
        }

        if (coreNext.newState.winner) return null; // match ended cleanly

        positions = JSON.parse(JSON.stringify(coreNext.newState.positions));
        currentPlayer = coreNext.newState.currentPlayer as PlayerColor;
        consecutiveSixes = consecutiveSixes >= 2 ? 0 : consecutiveSixes + (dice === 6 ? 1 : 0);
    }
    return null;
}

const MODES = ['4P', '2v2', '1v1'] as const;
const SEEDS_PER_MODE = 400; // 1200 matches total, well past the 10k-move gate

for (const mode of MODES) {
    test(`engines agree across ${SEEDS_PER_MODE} seeded ${mode} matches`, () => {
        let steps = 0;
        for (let seed = 1; seed <= SEEDS_PER_MODE; seed++) {
            const d = playMatch(seed, mode);
            if (d) {
                assert.fail(
                    `engines diverge (${d.what}) — mode=${d.mode} seed=${d.seed} step=${d.step}\n` +
                    `  core: ${JSON.stringify(d.core)}\n  gameLogic: ${JSON.stringify(d.gl)}`,
                );
            }
            steps += 400;
        }
        assert.ok(steps >= 10000, `expected >= 10000 moves per mode, simulated ${steps}`);
    });
}

test('the capture-force divergence is fixed: pre-move state is passed to checkMultiCapture', () => {
    // Regression pin for ENG-01 specifically, independent of the fuzz above.
    // A green token landing on a red token in 2v2: both engines must agree it
    // is captured, and must agree the acting team's force is not double-counted.
    const cc = SEATING['2v2'];
    const positions: Record<PlayerColor, number[]> = {
        green: [0, -1, -1, -1],
        red: [1, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
    };
    const { core, gl } = pairState(positions, 'green', '2v2', 0);
    const coreNext = coreMove(core, 'green', 0, 1, '2v2', cc, 'green', coreActive(core));
    const glNext = glMove(gl, 'green', 0, 1, '2v2', cc as any, 'green');
    assert.equal(coreNext.captured, true, 'green onto red must capture');
    assert.equal(glNext.captured, true, 'gameLogic must agree');
    assert.deepEqual(coreNext.newState.positions.red, [57, -1, -1, -1].map((p, i) => (i === 0 ? -1 : p)));
    assert.deepEqual(
        JSON.parse(JSON.stringify(coreNext.newState.positions)),
        JSON.parse(JSON.stringify(glNext.newState.positions)),
    );
});
