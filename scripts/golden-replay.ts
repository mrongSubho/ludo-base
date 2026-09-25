/**
 * Golden-replay generator + CI sample (≥50 deterministic matches).
 *
 * Each match is a short legal-move walk with a seeded LCG (no RNG from
 * Math.random) through `processMove` / `getLegalTokenIndices`. We record a
 * JSONL replay and `hashGameState` of the final state.
 *
 * Run:
 *   npm run test:golden          # CI gate (recompute twice, compare)
 *   npm run golden:write         # write fixtures under scripts/fixtures/golden/
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    INITIAL_GAME_STATE,
    processMove,
    getLegalTokenIndices,
    handleThreeSixes,
    emptyMatchStats,
} from '../lib/gameLogic';
import { hashGameState } from '../lib/replay/hash';
import {
    createReplayLog,
    appendReplayEvent,
    finalizeReplay,
    serializeReplay,
} from '../lib/replay/log';
import type { ColorCorner, GameState, PlayerColor } from '../lib/types';

export const GOLDEN_MATCH_COUNT = 50;
export const MAX_TURNS_PER_MATCH = 40;

const CC: ColorCorner = { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' };
const COLORS: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

/** Deterministic LCG — same seed → same match. */
export function lcg(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

function baseState(playerCount: '1v1' | '4P' = '4P'): GameState {
    return {
        ...INITIAL_GAME_STATE,
        status: 'playing',
        isStarted: true,
        matchId: 'golden',
        playerCount,
        matchStats: emptyMatchStats(),
        lastUpdate: 0,
    };
}

export type GoldenMatchResult = {
    index: number;
    seed: number;
    turns: number;
    finalHash: string;
    replayJsonl: string;
    winner: string | null;
};

export function runGoldenMatch(index: number, seed: number): GoldenMatchResult {
    const rand = lcg(seed);
    let state = baseState('4P');
    // Seed a few tokens on the path so captures/progress happen
    state = {
        ...state,
        positions: {
            green: [0, 5, -1, -1],
            red: [2, 8, -1, -1],
            yellow: [1, 6, -1, -1],
            blue: [3, 9, -1, -1],
        },
    };

    const log = createReplayLog({ matchId: `golden-${index}`, playerCount: '4P' });
    let turns = 0;
    let seq = 0;

    for (let t = 0; t < MAX_TURNS_PER_MATCH && state.status === 'playing'; t++) {
        turns += 1;
        seq += 1;
        const color = state.currentPlayer;
        const roll = 1 + Math.floor(rand() * 6);

        // Three-sixes bookkeeping (side effect on consecutiveSixes only here)
        const t6 = handleThreeSixes(state.consecutiveSixes, roll);
        appendReplayEvent(log, {
            seq,
            kind: 'roll',
            payload: { color, roll, isThreeSixes: t6.isThreeSixes },
        });
        if (t6.isThreeSixes) {
            state = {
                ...state,
                consecutiveSixes: 0,
                currentPlayer: (COLORS[(COLORS.indexOf(color) + 1) % 4]) as PlayerColor,
                diceValue: null,
                gamePhase: 'rolling',
            };
            continue;
        }
        state = { ...state, consecutiveSixes: t6.nextSixes, diceValue: roll, gamePhase: 'moving' };

        const legal = getLegalTokenIndices(state.positions, color, roll, CC);
        if (legal.length === 0) {
            state = {
                ...state,
                currentPlayer: (COLORS[(COLORS.indexOf(color) + 1) % 4]) as PlayerColor,
                diceValue: null,
                gamePhase: 'rolling',
            };
            continue;
        }
        const tokenIndex = legal[Math.floor(rand() * legal.length)]!;
        seq += 1;
        const result = processMove(state, color, tokenIndex, roll, '4P', CC);
        appendReplayEvent(log, {
            seq,
            kind: 'action',
            actionId: `m-${index}-${t}`,
            payload: { color, tokenIndex, roll, captured: result.captured, bonus: result.bonusRoll },
        }, result.newState);

        state = {
            ...result.newState,
            diceValue: result.bonusRoll ? roll : null,
            gamePhase: result.bonusRoll ? 'moving' : 'rolling',
        };

        // Synthetic terminal: if any color has all four home, finish
        for (const c of COLORS) {
            if (state.positions[c].every((p) => p === 57)) {
                state = {
                    ...state,
                    status: 'finished',
                    winner: c,
                    winners: [c],
                };
            }
        }
    }

    finalizeReplay(log, state);
    return {
        index,
        seed,
        turns,
        finalHash: hashGameState(state),
        replayJsonl: serializeReplay(log),
        winner: state.winner,
    };
}

export function runGoldenCorpus(count = GOLDEN_MATCH_COUNT, baseSeed = 0x1ad0ba5e): GoldenMatchResult[] {
    const out: GoldenMatchResult[] = [];
    for (let i = 0; i < count; i++) {
        out.push(runGoldenMatch(i, baseSeed + i * 9973));
    }
    return out;
}

/** Recompute corpus twice — hashes must be byte-identical (CI determinism). */
export function assertDeterministicCorpus(count = GOLDEN_MATCH_COUNT): {
    n: number;
    uniqueHashes: number;
    finished: number;
} {
    const a = runGoldenCorpus(count);
    const b = runGoldenCorpus(count);
    assertSame(a, b);
    return {
        n: a.length,
        uniqueHashes: new Set(a.map((m) => m.finalHash)).size,
        finished: a.filter((m) => m.winner).length,
    };
}

function assertSame(a: GoldenMatchResult[], b: GoldenMatchResult[]): void {
    if (a.length !== b.length) throw new Error('corpus length mismatch');
    for (let i = 0; i < a.length; i++) {
        if (a[i].finalHash !== b[i].finalHash) {
            throw new Error(`golden match ${i} hash mismatch: ${a[i].finalHash} vs ${b[i].finalHash}`);
        }
    }
}

export function writeGoldenFixtures(dir: string, corpus: GoldenMatchResult[]): void {
    mkdirSync(dir, { recursive: true });
    const manifest = corpus.map((m) => ({
        index: m.index,
        seed: m.seed,
        turns: m.turns,
        finalHash: m.finalHash,
        winner: m.winner,
    }));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const m of corpus) {
        writeFileSync(join(dir, `match-${m.index}.jsonl`), m.replayJsonl);
    }
}

/** CLI: write fixtures or print determinism summary. */
const isMain = (() => {
    try {
        return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
    } catch {
        return false;
    }
})();

if (isMain) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const dir = join(root, 'scripts', 'fixtures', 'golden');
    const summary = assertDeterministicCorpus();
    console.log('golden corpus', summary);
    if (process.argv.includes('--write') || process.argv[2] === 'write') {
        writeGoldenFixtures(dir, runGoldenCorpus());
        console.log('wrote', dir);
    }
    // Optional verify mode against existing manifest
    if (process.argv.includes('--verify') && existsSync(join(dir, 'manifest.json'))) {
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Array<{ finalHash: string }>;
        const fresh = runGoldenCorpus();
        for (let i = 0; i < manifest.length; i++) {
            if (manifest[i].finalHash !== fresh[i].finalHash) {
                console.error(`fixture drift at match ${i}`);
                process.exit(1);
            }
        }
        console.log('fixtures match live corpus');
    }
}
