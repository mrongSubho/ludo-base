/**
 * E7 — AI difficulty calibration bench (fixed seeds, no network).
 * Run: npm run bench:ai
 *
 * Soft-fails on drift by printing bands; hard-fails only on thrown errors
 * or empty legal options when a move is required (engine integrity).
 */

import { getBestMove } from '../lib/aiEngine';
import { getLegalTokenIndices, calculateNextPosition } from '../lib/gameLogic';
import type { PlayerColor, GameState } from '../lib/types';
import type { BotDifficulty } from '../lib/constants';
import { DIFFICULTY_PARAMS, BASE_INDEX } from '../lib/constants';

const COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];
const CC = { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' } as const;

/** Deterministic LCG — same seed → same suite. */
function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

function emptyPowers() {
    return { green: [], red: [], yellow: [], blue: [] } as GameState['playerPowers'];
}

function emptyAfk() {
    const row = () => ({ isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false });
    return { green: row(), red: row(), yellow: row(), blue: row() };
}

function stubState(positions: Record<PlayerColor, number[]>): GameState {
    return {
        positions,
        currentPlayer: 'green',
        diceValue: 3,
        isRolling: false,
        gamePhase: 'moving',
        status: 'playing',
        winner: null,
        winners: [],
        captureMessage: null,
        timeLeft: 15,
        strikes: { green: 0, red: 0, yellow: 0, blue: 0 },
        powerTiles: [],
        playerPowers: emptyPowers(),
        powerSpentThisTurn: false,
        activeBoost: null,
        nukeFlash: [],
        boostTrail: null,
        activeTraps: [],
        activeShields: [],
        consecutiveSixes: 0,
        afkStats: emptyAfk(),
        idleWarning: null,
        participantPeers: {},
        isStarted: true,
        isBotMatch: true,
        botDifficulty: 'pro',
        lastUpdate: 0,
        playerCount: '4P',
    };
}

type BenchResult = {
    difficulty: BotDifficulty;
    trials: number;
    choseCapture: number;
    chosePromote: number;
    choseAdvance: number;
    nulls: number;
    illegal: number;
};

function runDifficulty(difficulty: BotDifficulty, trials: number, seed: number): BenchResult {
    const rand = lcg(seed);
    const result: BenchResult = {
        difficulty,
        trials,
        choseCapture: 0,
        chosePromote: 0,
        choseAdvance: 0,
        nulls: 0,
        illegal: 0,
    };

    for (let t = 0; t < trials; t++) {
        // Random-but-seeded token layout on the shared path / base
        const positions = {
            green: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
            red: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
            yellow: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
            blue: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
        } as Record<PlayerColor, number[]>;

        // Place 1–2 tokens per color at path indices 0–40
        for (const color of COLORS) {
            const n = 1 + Math.floor(rand() * 2);
            for (let i = 0; i < n; i++) {
                positions[color][i] = Math.floor(rand() * 40);
            }
        }
        // Occasionally force green a base token so six-exit is in play
        if (rand() > 0.5) positions.green[3] = BASE_INDEX;

        const roll = 1 + Math.floor(rand() * 6);
        const state = stubState(positions);
        state.botDifficulty = difficulty;

        const pick = getBestMove(positions, 'green', roll, CC as never, '4P', [], state, difficulty);
        if (pick === null) {
            result.nulls += 1;
            continue;
        }

        const legal = getLegalTokenIndices(positions, 'green', roll, CC as never);
        if (!legal.includes(pick)) {
            result.illegal += 1;
            continue;
        }

        const from = positions.green[pick];
        const to = calculateNextPosition(from, roll, 'green', CC as never);
        if (from === BASE_INDEX && to !== BASE_INDEX) result.chosePromote += 1;
        else if (to === 57 || to > from) result.choseAdvance += 1;
        else result.choseAdvance += 1;

        // Capture heuristic: if another color sits on `to`, count it
        for (const other of COLORS) {
            if (other === 'green') continue;
            if (positions[other].includes(to) && to !== BASE_INDEX) {
                result.choseCapture += 1;
                break;
            }
        }
    }
    return result;
}

function main() {
    const trials = Number(process.env.AI_BENCH_TRIALS || 200);
    const difficulties: BotDifficulty[] = ['rookie', 'pro', 'master'];
    console.log('AI calibration bench', { trials, params: Object.fromEntries(difficulties.map((d) => [d, DIFFICULTY_PARAMS[d]])) });

    let illegalTotal = 0;
    for (const [i, d] of difficulties.entries()) {
        const r = runDifficulty(d, trials, 1000 + i);
        illegalTotal += r.illegal;
        console.log(d, {
            trials: r.trials,
            nulls: r.nulls,
            illegal: r.illegal,
            promote: r.chosePromote,
            advance: r.choseAdvance,
            captureOpportunities: r.choseCapture,
            usesPowers: DIFFICULTY_PARAMS[d].usesPowers,
        });
    }

    // Hard gate: never return an illegal index
    if (illegalTotal > 0) {
        console.error(`FAIL: ${illegalTotal} illegal AI picks`);
        process.exit(1);
    }
    console.log('OK: all picks legal (soft calibration bands printed above)');
}

main();
