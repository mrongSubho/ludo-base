import type { ColorCorner, GameState, PlayerColor } from './types';
import { SAFE_POSITIONS, getBoardCoordinate } from './boardLayout';
import { BASE_INDEX, BOARD_FINISH_INDEX } from './constants';
import { calculateNextPosition, checkMultiCapture, getTeammateColor } from './gameLogic';

export type MovePreviewKind = 'move' | 'safe' | 'power' | 'capture' | 'finish';

export interface MovePreviewTarget {
    r: number;
    c: number;
    kind: MovePreviewKind;
    color: PlayerColor;
    steps: number;
}

/**
 * Preview a candidate token move using authoritative engine movement & capture rules.
 */
export function computeMovePreview(params: {
    state: GameState;
    color: PlayerColor;
    tokenIndex: number;
    colorCorner: ColorCorner;
    playerCount: '1v1' | '4P' | '2v2';
}): MovePreviewTarget | null {
    const { state, color, tokenIndex, colorCorner, playerCount } = params;
    const rawDice = state.diceValue;
    if (rawDice === null || rawDice === undefined || state.gamePhase !== 'moving') return null;

    const pos = Number(state.positions?.[color]?.[tokenIndex]);
    if (!Number.isFinite(pos) || pos === BOARD_FINISH_INDEX) return null;

    const effectiveSteps =
        Number(rawDice) +
        (state.activeBoost === state.currentPlayer || state.activeBoost === color ? 6 : 0);

    const nextPos = calculateNextPosition(pos, effectiveSteps, color, colorCorner);
    if (nextPos === pos || nextPos === BASE_INDEX) return null;

    if (nextPos === BOARD_FINISH_INDEX) {
        return { r: 8, c: 8, kind: 'finish', color, steps: effectiveSteps };
    }

    const destPt = getBoardCoordinate(nextPos, color, colorCorner);
    if (!destPt) return null;

    const captures = checkMultiCapture(color, nextPos, state, colorCorner, playerCount);
    if (captures.length > 0) {
        return { r: destPt.r, c: destPt.c, kind: 'capture', color, steps: effectiveSteps };
    }

    const hasTrap = (state.activeTraps || []).some((t) => t.r === destPt.r && t.c === destPt.c);
    const hasPowerTile = !hasTrap && (state.powerTiles || []).some((pt) => pt.r === destPt.r && pt.c === destPt.c);
    if (hasPowerTile) {
        return { r: destPt.r, c: destPt.c, kind: 'power', color, steps: effectiveSteps };
    }

    const isSafeCell = nextPos >= 52 || SAFE_POSITIONS.some((p) => p.r === destPt.r && p.c === destPt.c);
    if (isSafeCell) {
        return { r: destPt.r, c: destPt.c, kind: 'safe', color, steps: effectiveSteps };
    }

    return { r: destPt.r, c: destPt.c, kind: 'move', color, steps: effectiveSteps };
}

/**
 * Automatically surface the destination reticle when the active turn player has
 * only one unique landing square (including multiple yard tokens deploying on a 6).
 */
export function computeSingleLegalMovePreview(params: {
    state: GameState;
    myColor: PlayerColor | undefined;
    colorCorner: ColorCorner;
    playerCount: '1v1' | '4P' | '2v2';
}): MovePreviewTarget | null {
    const { state, myColor, colorCorner, playerCount } = params;
    if (!myColor || state.gamePhase !== 'moving' || state.currentPlayer !== myColor) return null;

    const ownFinished = (state.positions?.[myColor] || []).every((p) => Number(p) === BOARD_FINISH_INDEX);
    const teammate = ownFinished && playerCount === '2v2' ? getTeammateColor(myColor, playerCount) : null;
    const controllableColor = teammate ?? myColor;

    const uniqueByCoord = new Map<string, MovePreviewTarget>();
    for (let idx = 0; idx < 4; idx += 1) {
        const preview = computeMovePreview({
            state,
            color: controllableColor,
            tokenIndex: idx,
            colorCorner,
            playerCount,
        });
        if (!preview) continue;
        const key = `${preview.kind}:${preview.r}-${preview.c}`;
        if (!uniqueByCoord.has(key)) {
            uniqueByCoord.set(key, preview);
        }
    }

    if (uniqueByCoord.size !== 1) return null;
    return Array.from(uniqueByCoord.values())[0] ?? null;
}
