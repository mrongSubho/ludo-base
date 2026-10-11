/**
 * Golden-replay generator + CI sample (≥50 deterministic matches).
 *
 * ENG-01: this corpus runs the AUTHORITY engine (`lib/engine/core.ts`) — the
 * module Edge executes — not the app's legacy `lib/gameLogic.ts`. Each match
 * is a greedy legal-move walk with a seeded LCG (no Math.random anywhere,
 * including seating) through core `processMove` / `getLegalTokenIndices`.
 * Matches terminate: greedy max-progress play from on-track starts (0..9)
 * finishes every mode, including a 2v2 team win — `finished 0 / 50` is gone.
 * We record a JSONL replay and `hashGameState` of the final state.
 *
 * Run:
 *   npm run test:golden          # CI gate (recompute twice, compare)
 *   npm run golden:write         # write fixtures under scripts/fixtures/golden/
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    processMove,
    getLegalTokenIndices,
    handleThreeSixes,
    getNextPlayer,
    calculateNextPosition,
    emptyEngineMatchStats,
} from '../lib/engine/core';
import type { ColorCorner, EngineGameState, PlayerColor } from '../lib/engine/core';
import { CORNER_SLOTS } from '../lib/boardLayout';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import { hashGameState } from '../lib/replay/hash';
import {
    createReplayLog,
    appendReplayEvent,
    finalizeReplay,
    serializeReplay,
} from '../lib/replay/log';
import type { GameState } from '../lib/types';

export const GOLDEN_MATCH_COUNT = 50;
export const MAX_TURNS_PER_MATCH = 3000;

type GoldenMode = '1v1' | '4P' | '2v2';
const MODES: GoldenMode[] = ['4P', '1v1', '2v2'];
const COLORS4: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

/** Deterministic LCG — same seed → same match. */
export function lcg(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

/** Cells travelled toward home (0 at own start, 50 at gate, 51..56 home). */
function travelDistance(pos: number, color: PlayerColor, cc: ColorCorner): number {
    if (pos === -1) return -1;
    if (pos >= 52) return pos - 1;
    const corner = cc[color];
    const startIdx = corner ? CORNER_SLOTS[corner].startIdx : 0;
    return (((pos - startIdx) % 52) + 52) % 52;
}

type Seating = { cc: ColorCorner; active: PlayerColor[] };

/**
 * Deterministic seating per match — the LCG, never Math.random.
 * 1v1 seats green+yellow on one diagonal; 2v2 seats the TEAM_PAIRINGS pairs
 * (Green+Blue vs Red+Yellow) on opposite diagonals.
 */
function cornersFor(mode: GoldenMode, rand: () => number): Seating {
    if (mode === '4P') {
        return {
            cc: { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' },
            active: [...COLORS4],
        };
    }
    if (mode === '1v1') {
        const first: ['BL', 'TR'] | ['BR', 'TL'] = rand() < 0.5 ? ['BL', 'TR'] : ['BR', 'TL'];
        const second: ['BL', 'TR'] | ['BR', 'TL'] = first[0] === 'BL' ? ['BR', 'TL'] : ['BL', 'TR'];
        const [a0, a1] = rand() < 0.5 ? first : [first[1], first[0]];
        const [b0, b1] = rand() < 0.5 ? second : [second[1], second[0]];
        return {
            cc: { green: a0, yellow: a1, red: b0, blue: b1 },
            active: ['green', 'yellow'],
        };
    }
    const gbFirst: ['BL', 'TR'] | ['BR', 'TL'] = rand() < 0.5 ? ['BL', 'TR'] : ['BR', 'TL'];
    const ryAxis: ['BL', 'TR'] | ['BR', 'TL'] = gbFirst[0] === 'BL' ? ['BR', 'TL'] : ['BL', 'TR'];
    const [g, b] = rand() < 0.5 ? gbFirst : [gbFirst[1], gbFirst[0]];
    const [r, y] = rand() < 0.5 ? ryAxis : [ryAxis[1], ryAxis[0]];
    return {
        cc: { green: g, blue: b, red: r, yellow: y },
        active: [...COLORS4],
    };
}

/** Tokens start on track (0..9 spread) so the corpus races instead of camping base. */
function startPositions(): Record<PlayerColor, number[]> {
    const out = {} as Record<PlayerColor, number[]>;
    COLORS4.forEach((color, i) => {
        out[color] = [0, 1, 2, 3].map((j) => (i * 3 + j * 2) % 10);
    });
    return out;
}

function baseState(mode: GoldenMode): EngineGameState {
    return {
        positions: startPositions(),
        currentPlayer: 'green',
        diceValue: null,
        gamePhase: 'rolling',
        status: 'playing',
        winner: null,
        winners: [],
        consecutiveSixes: 0,
        playerCount: mode,
        activeShields: [],
        activeTraps: [],
        activeBoost: null,
        powerSpentThisTurn: false,
        lastUpdate: 0,
        matchId: 'golden',
        powerTiles: [],
        playerPowers: { green: [], red: [], yellow: [], blue: [] },
        matchStats: emptyEngineMatchStats(),
    };
}

/** GameState view of the authority state for the replay log / hash. */
function viewOf(state: EngineGameState, mode: GoldenMode): GameState {
    return {
        ...INITIAL_GAME_STATE,
        ...state,
        playerCount: mode,
        matchId: 'golden',
        isStarted: true,
    } as GameState;
}

export type GoldenMatchResult = {
    index: number;
    seed: number;
    mode: GoldenMode;
    turns: number;
    finalHash: string;
    replayJsonl: string;
    winner: string | null;
};

export function runGoldenMatch(index: number, seed: number, mode: GoldenMode = MODES[index % MODES.length]): GoldenMatchResult {
    const rand = lcg(seed);
    const { cc, active } = cornersFor(mode, rand);
    let state = baseState(mode);

    const log = createReplayLog({ matchId: `golden-${index}`, playerCount: mode });
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
        }, viewOf(state, mode));
        if (t6.isThreeSixes) {
            state = {
                ...state,
                consecutiveSixes: 0,
                currentPlayer: getNextPlayer(color, mode, active, cc),
                diceValue: null,
                gamePhase: 'rolling',
            };
            continue;
        }
        state = { ...state, consecutiveSixes: t6.nextSixes, diceValue: roll, gamePhase: 'moving' };

        const legal = getLegalTokenIndices(state.positions, color, roll, cc);
        if (legal.length === 0) {
            state = {
                ...state,
                currentPlayer: getNextPlayer(color, mode, active, cc),
                diceValue: null,
                gamePhase: 'rolling',
            };
            continue;
        }
        // Greedy max-progress with a seeded tiebreak — deterministic and
        // terminating. Random legal picks loop on captures forever.
        let tokenIndex = legal[0]!;
        let best = -Infinity;
        for (const idx of legal) {
            const dest = calculateNextPosition(state.positions[color]![idx]!, roll, color, cc);
            const d = travelDistance(dest, color, cc) + rand() * 1e-9;
            if (d > best) {
                best = d;
                tokenIndex = idx;
            }
        }
        seq += 1;
        const result = processMove(state, color, tokenIndex, roll, mode, cc, color, active);
        if (!result.applied) {
            // Unreachable for a legal pick (legality uses the same math);
            // pass defensively rather than wedging the corpus.
            state = {
                ...state,
                currentPlayer: getNextPlayer(color, mode, active, cc),
                diceValue: null,
                gamePhase: 'rolling',
            };
            continue;
        }
        appendReplayEvent(log, {
            seq,
            kind: 'action',
            actionId: `m-${index}-${t}`,
            payload: { color, tokenIndex, roll, captured: result.captured, bonus: result.bonusRoll },
        }, viewOf(result.newState, mode));

        state = {
            ...result.newState,
            diceValue: result.bonusRoll ? roll : null,
            gamePhase: result.bonusRoll ? 'moving' : 'rolling',
        };
    }

    const view = viewOf(state, mode);
    finalizeReplay(log, view);
    return {
        index,
        seed,
        mode,
        turns,
        finalHash: hashGameState(view),
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
    finishedByMode: Record<GoldenMode, number>;
} {
    const a = runGoldenCorpus(count);
    const b = runGoldenCorpus(count);
    assertSame(a, b);
    const finishedByMode = { '1v1': 0, '4P': 0, '2v2': 0 } as Record<GoldenMode, number>;
    for (const m of a) {
        if (m.winner) finishedByMode[m.mode] += 1;
    }
    return {
        n: a.length,
        uniqueHashes: new Set(a.map((m) => m.finalHash)).size,
        finished: a.filter((m) => m.winner).length,
        finishedByMode,
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
        mode: m.mode,
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
