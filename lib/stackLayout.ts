import type { PlayerColor } from './types';

export interface StackMember {
    color: PlayerColor;
    index: number;
}

export interface StackOffsetPct {
    xPct: number;
    yPct: number;
}

export interface StackPlacement {
    offset: StackOffsetPct;
    scale: number;
    zIndex: number;
    slotIndex: number;
}

/**
 * Cell-percentage quadrant offsets in screen-space so token clusters scale
 * proportionally from 390px mobile boards to 1440px desktop displays without clipping.
 */
export const SCREEN_STACK_PRESETS: Readonly<Record<1 | 2 | 3 | 4, readonly StackOffsetPct[]>> = {
    1: [{ xPct: 0, yPct: 0 }],
    2: [{ xPct: -26, yPct: -16 }, { xPct: 26, yPct: 16 }],
    3: [{ xPct: -26, yPct: 20 }, { xPct: 26, yPct: 20 }, { xPct: 0, yPct: -24 }],
    4: [
        { xPct: -26, yPct: -24 },
        { xPct: 26, yPct: -24 },
        { xPct: -26, yPct: 24 },
        { xPct: 26, yPct: 24 },
    ],
};

function cleanZero(n: number): number {
    return Object.is(n, -0) || Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(4));
}

/**
 * Convert a screen-space cell offset into board-grid coordinates by rotating by
 * `counterRotationDeg`. Because `.board-wrapper` applies `rotate(-counterRotationDeg)`
 * when seating local perspective at BL, the resulting stack orientation stays upright
 * for the viewer across all board rotations (0 / 90 / 180 / 270).
 */
export function rotateScreenOffsetToBoardSpace(
    offset: StackOffsetPct,
    counterRotationDeg: number,
): StackOffsetPct {
    const normalized = ((counterRotationDeg % 360) + 360) % 360;
    if (normalized === 0) return { xPct: cleanZero(offset.xPct), yPct: cleanZero(offset.yPct) };
    if (normalized === 90) return { xPct: cleanZero(-offset.yPct), yPct: cleanZero(offset.xPct) };
    if (normalized === 180) return { xPct: cleanZero(-offset.xPct), yPct: cleanZero(-offset.yPct) };
    if (normalized === 270) return { xPct: cleanZero(offset.yPct), yPct: cleanZero(-offset.xPct) };

    const rad = (normalized * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
        xPct: cleanZero(offset.xPct * cos - offset.yPct * sin),
        yPct: cleanZero(offset.xPct * sin + offset.yPct * cos),
    };
}

export function sortStackMembers(
    members: readonly StackMember[],
    opts?: {
        controllableColor?: PlayerColor | null;
        arrivalOrder?: ReadonlyMap<string, number>;
    },
): StackMember[] {
    const controllableColor = opts?.controllableColor ?? null;
    const arrivalOrder = opts?.arrivalOrder;

    return [...members].sort((a, b) => {
        const aControllable = controllableColor && a.color === controllableColor ? 1 : 0;
        const bControllable = controllableColor && b.color === controllableColor ? 1 : 0;
        if (aControllable !== bControllable) return aControllable - bControllable;

        const aSeq = arrivalOrder?.get(`${a.color}-${a.index}`) ?? Number.MAX_SAFE_INTEGER;
        const bSeq = arrivalOrder?.get(`${b.color}-${b.index}`) ?? Number.MAX_SAFE_INTEGER;
        if (aSeq !== bSeq) return aSeq - bSeq;

        if (a.color !== b.color) return a.color.localeCompare(b.color);
        return a.index - b.index;
    });
}

export function computeStackPlacement(
    members: readonly StackMember[],
    target: StackMember,
    opts?: {
        controllableColor?: PlayerColor | null;
        arrivalOrder?: ReadonlyMap<string, number>;
        counterRotationDeg?: number;
    },
): StackPlacement {
    if (members.length <= 1) {
        return {
            offset: { xPct: 0, yPct: 0 },
            scale: 1,
            zIndex: 0,
            slotIndex: 0,
        };
    }

    const sorted = sortStackMembers(members, opts);
    const foundIdx = sorted.findIndex((m) => m.color === target.color && m.index === target.index);
    const slotIndex = foundIdx >= 0 ? foundIdx : 0;
    const count = sorted.length;

    const scale =
        count === 2 ? 0.62 : count === 3 ? 0.52 : count === 4 ? 0.46 : 0.42;

    let screenOffset: StackOffsetPct;
    if (count === 2 || count === 3 || count === 4) {
        screenOffset = SCREEN_STACK_PRESETS[count][slotIndex] ?? { xPct: 0, yPct: 0 };
    } else {
        const angleRad = ((slotIndex * 360) / count) * (Math.PI / 180);
        screenOffset = {
            xPct: cleanZero(Math.cos(angleRad) * 26),
            yPct: cleanZero(Math.sin(angleRad) * 26),
        };
    }

    return {
        offset: rotateScreenOffsetToBoardSpace(screenOffset, opts?.counterRotationDeg ?? 0),
        scale,
        zIndex: slotIndex,
        slotIndex,
    };
}
