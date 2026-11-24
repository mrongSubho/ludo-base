import type { ColorCorner, Corner, PlayerColor } from './types';
import { BASE_INDEX, BOARD_FINISH_INDEX, DICE_ROLL_SIX, HOME_LANE_START_INDEX } from './constants';
import { CORNER_SLOTS, getBoardCoordinate, type Point } from './boardLayout';
import { getIntermediatePathCoords } from './gameLogic';
import type { DiceThemeId } from './diceVisuals';

export interface HopCadence {
    cellDur: number;
    anticipationSec: number;
    upSec: number;
    downSec: number;
    recoverSec: number;
    jumpScale: number;
    totalWalkMs: number;
}

export type TokenTransition =
    | { kind: 'none' }
    | { kind: 'deploy'; steps: number; targetPt: Point; yardPt: Point }
    | { kind: 'capture' }
    | { kind: 'teleport'; targetPt: Point }
    | { kind: 'hop'; steps: number; waypoints: Point[]; isFinishEntry: boolean }
    | { kind: 'snap'; targetPt: Point | null };

const YARD_BLOCK_CENTER: Record<Corner, Point> = {
    TL: { r: 3.5, c: 3.5 },
    TR: { r: 3.5, c: 12.5 },
    BL: { r: 12.5, c: 3.5 },
    BR: { r: 12.5, c: 12.5 },
};

const YARD_SLOT_OFFSETS: readonly Point[] = [
    { r: -0.8, c: -0.8 },
    { r: -0.8, c: 0.8 },
    { r: 0.8, c: -0.8 },
    { r: 0.8, c: 0.8 },
];

/**
 * Exact fractional 15x15 grid coordinate of a token's 2x2 slot inside its corner Home Pad.
 */
export function computeYardSlotCoord(corner: Corner, tokenIndex: number): Point {
    const center = YARD_BLOCK_CENTER[corner] ?? YARD_BLOCK_CENTER.BL;
    const clampedIdx = Math.max(0, Math.min(3, Math.trunc(tokenIndex)));
    const offset = YARD_SLOT_OFFSETS[clampedIdx] ?? YARD_SLOT_OFFSETS[0];
    return {
        r: center.r + offset.r,
        c: center.c + offset.c,
    };
}

/**
 * Modular reverse path coordinates for captured tokens sprinting home to their yard slot,
 * handling `51 -> 0` wrap-arounds seamlessly when `fromPos < startIdx`.
 */
export function computeReverseTrackCoords(
    fromPos: number,
    color: PlayerColor,
    tokenIndex: number,
    cc: ColorCorner,
): Point[] {
    const corner = cc[color];
    if (!corner || fromPos < 0 || fromPos >= BOARD_FINISH_INDEX) return [];

    const startIdx = CORNER_SLOTS[corner].startIdx;
    const indices: number[] = [];

    if (fromPos >= HOME_LANE_START_INDEX) {
        for (let idx = fromPos; idx >= HOME_LANE_START_INDEX; idx -= 1) {
            indices.push(idx);
        }
        const gate = (startIdx + 50) % HOME_LANE_START_INDEX;
        const distFromStart = (gate - startIdx + HOME_LANE_START_INDEX) % HOME_LANE_START_INDEX;
        for (let step = 0; step <= distFromStart; step += 1) {
            indices.push((gate - step + HOME_LANE_START_INDEX) % HOME_LANE_START_INDEX);
        }
    } else {
        const distFromStart = (fromPos - startIdx + HOME_LANE_START_INDEX) % HOME_LANE_START_INDEX;
        for (let step = 0; step <= distFromStart; step += 1) {
            indices.push((fromPos - step + HOME_LANE_START_INDEX) % HOME_LANE_START_INDEX);
        }
    }

    const cells: Point[] = [];
    for (const idx of indices) {
        const pt = getBoardCoordinate(idx, color, cc);
        if (pt) cells.push(pt);
    }

    if (cells.length === 0) return [];
    cells.push(computeYardSlotCoord(corner, tokenIndex));
    return cells;
}

/**
 * Distance-adaptive per-hop parabolic timing budget with theme-specific spring arc feel.
 * Stays within PERF_BUDGET.hopDurationMs (1300ms) for standard & boosted walks.
 */
export function computeHopCadence(
    steps: number,
    boosted: boolean,
    themeId: DiceThemeId = 'retro',
): HopCadence {
    const safeSteps = Math.max(1, Math.trunc(steps));
    const cellDur =
        boosted || safeSteps > 6
            ? 0.104
            : safeSteps >= 4
              ? 0.162
              : 0.184;

    const anticipationSec = 0.028;
    const upSec = Number((cellDur * 0.44).toFixed(4));
    const downSec = Number((cellDur * 0.40).toFixed(4));
    const recoverSec = Number(Math.max(0.014, cellDur - upSec - downSec).toFixed(4));

    const jumpScale =
        themeId === '3077'
            ? 0.56
            : themeId === 'retro'
              ? 0.62
              : 0.58;

    const totalWalkMs = Math.round((anticipationSec + safeSteps * cellDur) * 1000);

    return {
        cellDur,
        anticipationSec,
        upSec,
        downSec,
        recoverSec,
        jumpScale,
        totalWalkMs,
    };
}

/**
 * Turn-switch landing buffer scaled to the token's travel distance so 1-step moves
 * settle rapidly and long +6 Boost / 6-step walks complete before the next turn begins.
 */
export function computeMoveSettleBufferMs(
    steps: number,
    boosted: boolean,
    themeId: DiceThemeId = 'retro',
): number {
    const cadence = computeHopCadence(steps, boosted, themeId);
    return Math.min(1420, Math.max(400, cadence.totalWalkMs + 190));
}

/**
 * Screen-space horizontal lean angle (degrees) for each single-cell leap,
 * accounting for board rotation so the piece always tilts forward visually.
 */
export function computeScreenSpaceLeanDeg(
    fromPt: Point,
    toPt: Point,
    counterRotationDeg: number,
): number {
    const dc = toPt.c - fromPt.c;
    const dr = toPt.r - fromPt.r;
    const boardRotRad = (-counterRotationDeg * Math.PI) / 180;
    const screenDx = dc * Math.cos(boardRotRad) - dr * Math.sin(boardRotRad);

    if (screenDx > 0.2) return 8.5;
    if (screenDx < -0.2) return -8.5;
    return 0;
}

/**
 * Single source of truth classifying a token's positional transition without
 * comparing raw indices (`newPos > oldPos` fails whenever wrapping past `51 -> 0`).
 */
export function classifyTokenTransition(params: {
    oldPos: number;
    newPos: number;
    color: PlayerColor;
    colorCorner: ColorCorner;
    tokenIndex?: number;
    isTeleport?: boolean;
}): TokenTransition {
    const { oldPos, newPos, color, colorCorner, tokenIndex = 0, isTeleport = false } = params;
    if (oldPos === newPos) return { kind: 'none' };

    if (newPos === BASE_INDEX) {
        return { kind: 'capture' };
    }

    if (oldPos === BASE_INDEX && newPos >= 0) {
        const targetPt = getBoardCoordinate(newPos, color, colorCorner);
        const corner = colorCorner[color];
        if (!targetPt || !corner) {
            return { kind: 'snap', targetPt };
        }
        return {
            kind: 'deploy',
            steps: DICE_ROLL_SIX,
            targetPt,
            yardPt: computeYardSlotCoord(corner, tokenIndex),
        };
    }

    const targetPt = newPos >= 0 ? getBoardCoordinate(newPos, color, colorCorner) : null;

    if (isTeleport && newPos >= 0 && targetPt) {
        return { kind: 'teleport', targetPt };
    }

    if (oldPos >= 0 && newPos >= 0) {
        const waypoints = getIntermediatePathCoords(oldPos, newPos, color, colorCorner);
        if (waypoints.length >= 1 && waypoints.length <= 12) {
            return {
                kind: 'hop',
                steps: waypoints.length,
                waypoints,
                isFinishEntry: newPos === BOARD_FINISH_INDEX,
            };
        }
    }

    return { kind: 'snap', targetPt };
}
