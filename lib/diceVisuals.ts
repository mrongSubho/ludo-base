import type { Corner, GameState, PlayerColor } from './types';

export type DiceThemeId = '3077' | 'retro' | 'daybreak';

export type DiceFaceNumber = 1 | 2 | 3 | 4 | 5 | 6;

export const DOT_POSITIONS: Record<DiceFaceNumber, readonly [number, number][]> = {
    1: [[50, 50]],
    2: [[26, 26], [74, 74]],
    3: [[22, 22], [50, 50], [78, 78]],
    4: [[26, 26], [26, 74], [74, 26], [74, 74]],
    5: [[22, 22], [22, 78], [50, 50], [78, 22], [78, 78]],
    6: [[26, 21], [26, 50], [26, 79], [74, 21], [74, 50], [74, 79]],
};

export interface TurnRollEntry {
    id: number;
    value: DiceFaceNumber;
    boosted: boolean;
}

export interface TurnRollHistoryState {
    player: PlayerColor;
    rolls: TurnRollEntry[];
    nextId: number;
}

export interface BreakoutTrajectory {
    dirX: 1 | -1;
    dirY: 1 | -1;
    flightDuration: number;
    spinRpmDeg: number;
    cantDeg: { rx: number; ry: number };
    flightKeyframes: {
        x: number[];
        y: number[];
        scale: number[];
        rotateZ: number[];
        times: number[];
    };
    settleSpring: { stiffness: number; damping: number };
    settleArc: {
        x: number[];
        y: number[];
        scale: number[];
        rotateZ: number[];
        duration: number;
        times: number[];
    };
    shadowOffset: { x: number; y: number };
}

export function resolveDiceThemeId(theme: string | undefined): DiceThemeId {
    if (theme === '3077') return '3077';
    if (theme === 'light' || theme === 'daybreak') return 'daybreak';
    return 'retro';
}

/**
 * Computes a board-inward 3D breakout trajectory from any seat corner (`TL`, `TR`, `BL`, `BR`)
 * so the rolling die leaps diagonally OVER the adjacent board corner (never clipping header/footer),
 * then returns cleanly flush into the Anchored Dice Bay with theme-distinct physics.
 */
export function computeBreakoutTrajectory(corner: Corner, themeId: DiceThemeId): BreakoutTrajectory {
    const dirX: 1 | -1 = corner === 'TL' || corner === 'BL' ? 1 : -1;
    const dirY: 1 | -1 = corner === 'TL' || corner === 'TR' ? 1 : -1;

    if (themeId === '3077') {
        // Magnetic Rail-Eject: crisp recoil pull-back, sharp linear punch inward, fast electromagnetic slam-lock.
        return {
            dirX,
            dirY,
            flightDuration: 0.42,
            spinRpmDeg: 720,
            cantDeg: { rx: -24 * dirY, ry: 22 * dirX },
            flightKeyframes: {
                x: [0, -dirX * 3, dirX * 22, dirX * 19],
                y: [0, -dirY * 2, dirY * 24, dirY * 20],
                scale: [1, 0.86, 1.66, 1.56],
                rotateZ: [0, -14 * dirX, 18 * dirX, -8 * dirX],
                times: [0, 0.14, 0.62, 1],
            },
            settleSpring: { stiffness: 560, damping: 28 },
            settleArc: {
                x: [dirX * 8, 0, 0],
                y: [dirY * 8, dirY * 1.5, 0],
                scale: [1.34, 0.88, 1.04, 1],
                rotateZ: [0, 0, 0, 0],
                duration: 0.2,
                times: [0, 0.36, 0.72, 1],
            },
            shadowOffset: { x: dirX * 22, y: dirY * 32 },
        };
    }

    if (themeId === 'daybreak') {
        // Tactile Tabletop Bone-Throw: natural arc inward with subtle double-tap ceramic clack & micro-wobble settle.
        return {
            dirX,
            dirY,
            flightDuration: 0.44,
            spinRpmDeg: 600,
            cantDeg: { rx: -26 * dirY, ry: 20 * dirX },
            flightKeyframes: {
                x: [0, dirX * 8, dirX * 21, dirX * 17],
                y: [0, dirY * 4, dirY * 24, dirY * 19],
                scale: [1, 0.92, 1.6, 1.48],
                rotateZ: [0, -10 * dirX, 15 * dirX, 6 * dirX],
                times: [0, 0.18, 0.65, 1],
            },
            settleSpring: { stiffness: 440, damping: 21 },
            settleArc: {
                x: [dirX * 6, 0, 0, 0, 0],
                y: [dirY * 6, dirY * 2, -dirY * 1.5, 0, 0],
                scale: [1.26, 0.91, 1.06, 0.98, 1],
                rotateZ: [5 * dirX, -3 * dirX, 1.5 * dirX, 0, 0],
                duration: 0.28,
                times: [0, 0.3, 0.56, 0.8, 1],
            },
            shadowOffset: { x: dirX * 21, y: dirY * 32 },
        };
    }

    // Retro: Zero-G Arcade Orbital Toss with lively parabolic float and cushion rebound.
    return {
        dirX,
        dirY,
        flightDuration: 0.44,
        spinRpmDeg: 640,
        cantDeg: { rx: -22 * dirY, ry: 26 * dirX },
        flightKeyframes: {
            x: [0, dirX * 9, dirX * 21, dirX * 16],
            y: [0, dirY * 6, dirY * 26, dirY * 19],
            scale: [1, 0.9, 1.64, 1.52],
            rotateZ: [0, 16 * dirX, -20 * dirX, 10 * dirX],
            times: [0, 0.2, 0.66, 1],
        },
        settleSpring: { stiffness: 380, damping: 18 },
        settleArc: {
            x: [dirX * 7, 0, 0, 0, 0],
            y: [dirY * 7, -dirY * 2, dirY * 1, 0, 0],
            scale: [1.3, 0.86, 1.09, 0.98, 1],
            rotateZ: [4 * dirX, -2 * dirX, 0, 0, 0],
            duration: 0.26,
            times: [0, 0.3, 0.6, 0.82, 1],
        },
        shadowOffset: { x: dirX * 20, y: dirY * 34 },
    };
}

function isDiceFaceNumber(value: unknown): value is DiceFaceNumber {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

/**
 * Accumulates every resolved die result rolled during the active player's turn
 * (e.g. `[6, 6, 4]` across chained bonus rolls) and resets cleanly when the turn passes.
 */
export function updateTurnRollHistory(
    current: TurnRollHistoryState,
    prevState: GameState | null,
    nextState: GameState,
): TurnRollHistoryState {
    if (!prevState || nextState.currentPlayer !== current.player) {
        if (
            !nextState.isRolling &&
            isDiceFaceNumber(nextState.diceValue) &&
            prevState &&
            nextState.currentPlayer !== prevState.currentPlayer
        ) {
            // Instant remote turn+roll settlement edge case
            const nextId = current.nextId + 1;
            return {
                player: nextState.currentPlayer,
                rolls: [
                    {
                        id: nextId,
                        value: nextState.diceValue,
                        boosted: nextState.activeBoost === nextState.currentPlayer,
                    },
                ],
                nextId,
            };
        }
        return { player: nextState.currentPlayer, rolls: [], nextId: current.nextId };
    }

    if (prevState.status !== 'waiting' && nextState.status === 'waiting' && current.rolls.length > 0) {
        return { player: nextState.currentPlayer, rolls: [], nextId: current.nextId };
    }

    const landedFreshFace =
        nextState.currentPlayer === prevState.currentPlayer &&
        !nextState.isRolling &&
        isDiceFaceNumber(nextState.diceValue) &&
        (prevState.diceValue !== nextState.diceValue || prevState.isRolling);

    if (!landedFreshFace || !isDiceFaceNumber(nextState.diceValue)) {
        return current;
    }

    const nextId = current.nextId + 1;
    const boosted = Boolean(
        prevState.activeBoost === nextState.currentPlayer ||
        nextState.activeBoost === nextState.currentPlayer,
    );
    const nextRolls = [
        ...current.rolls,
        { id: nextId, value: nextState.diceValue, boosted },
    ].slice(-5);

    return {
        player: nextState.currentPlayer,
        rolls: nextRolls,
        nextId,
    };
}

/**
 * Ensures mid-turn joiners/reconnected seats still see `consecutiveSixes` pips
 * even before their local client observed the earlier roll transitions.
 */
export function resolveDisplayedTurnRolls(
    rolls: TurnRollEntry[],
    consecutiveSixes: number,
): TurnRollEntry[] {
    if (rolls.length > 0) return rolls;
    const sixCount = Math.min(2, Math.max(0, Number(consecutiveSixes || 0)));
    if (sixCount <= 0) return [];
    return Array.from({ length: sixCount }).map((_, idx) => ({
        id: -(idx + 1),
        value: 6,
        boosted: false,
    }));
}
