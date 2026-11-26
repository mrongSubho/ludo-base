import { BASE_INDEX, BOARD_FINISH_INDEX, HOME_LANE_START_INDEX } from '@/lib/constants';
import { getBoardCoordinate, type ColorCorner, type Corner, type Point } from '@/lib/boardLayout';
import { seatedColorsFor } from '@/lib/engine/core';
import { getIntermediatePathCoords, getTeammateColor } from '@/lib/gameLogic';
import type { GameState, PlayerColor } from '@/lib/types';

export const CORNER_GRID_ANCHOR: Record<Corner, Point> = {
    TL: { r: 2, c: 2 },
    TR: { r: 2, c: 14 },
    BL: { r: 14, c: 2 },
    BR: { r: 14, c: 14 },
};

export type PowerVfxEvent =
    | {
          id: number;
          kind: 'nuke';
          attacker: PlayerColor;
          originCell: Point;
          impactCell: Point;
          corridorCells: Point[];
          victimCells: { pt: Point; color: PlayerColor }[];
          deflectedCells?: Point[];
      }
    | {
          id: number;
          kind: 'shield';
          color: PlayerColor;
          cells: Point[];
      }
    | {
          id: number;
          kind: 'boost_arm';
          color: PlayerColor;
          cells: Point[];
      }
    | {
          id: number;
          kind: 'boost_trail';
          color: PlayerColor;
          cells: Point[];
      }
    | {
          id: number;
          kind: 'teleport';
          color: PlayerColor;
          fromCell: Point;
          toCell: Point;
          toFinish: boolean;
      };

/**
 * Compute all unique grid cells covering the Nuke's ±3 blast corridor
 * (center tile + up to 3 tiles behind & 3 ahead on the 52-cell track = 7 blocks / 6 surrounding blocks).
 */
export function computeNukeBlastCorridor(
    centerPos: number,
    attacker: PlayerColor,
    cc: ColorCorner,
): Point[] {
    if (centerPos < 0 || centerPos >= HOME_LANE_START_INDEX) return [];
    const seen = new Set<string>();
    const out: Point[] = [];
    for (let delta = -3; delta <= 3; delta++) {
        const idx = (centerPos + delta + HOME_LANE_START_INDEX) % HOME_LANE_START_INDEX;
        const pt = getBoardCoordinate(idx, attacker, cc);
        if (!pt) continue;
        const key = `${pt.r},${pt.c}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(pt);
        }
    }
    return out;
}

/** Deduplicate an array of grid points preserving order. */
function dedupPoints(points: Point[]): Point[] {
    const seen = new Set<string>();
    const out: Point[] = [];
    for (const pt of points) {
        const k = `${pt.r},${pt.c}`;
        if (!seen.has(k)) {
            seen.add(k);
            out.push(pt);
        }
    }
    return out;
}

/**
 * Extract board-space VFX events from a GameState transition.
 * Pure & deterministic so visual bursts match state transitions identically.
 */
export function derivePowerVfxEvents(
    prev: GameState | null,
    next: GameState,
    cc: ColorCorner,
    playerCount: '1v1' | '4P' | '2v2',
): Array<
    | Omit<Extract<PowerVfxEvent, { kind: 'nuke' }>, 'id'>
    | Omit<Extract<PowerVfxEvent, { kind: 'shield' }>, 'id'>
    | Omit<Extract<PowerVfxEvent, { kind: 'boost_arm' }>, 'id'>
    | Omit<Extract<PowerVfxEvent, { kind: 'boost_trail' }>, 'id'>
    | Omit<Extract<PowerVfxEvent, { kind: 'teleport' }>, 'id'>
> {
    if (!prev) return [];
    const events: Array<
        | Omit<Extract<PowerVfxEvent, { kind: 'nuke' }>, 'id'>
        | Omit<Extract<PowerVfxEvent, { kind: 'shield' }>, 'id'>
        | Omit<Extract<PowerVfxEvent, { kind: 'boost_arm' }>, 'id'>
        | Omit<Extract<PowerVfxEvent, { kind: 'boost_trail' }>, 'id'>
        | Omit<Extract<PowerVfxEvent, { kind: 'teleport' }>, 'id'>
    > = [];

    const seats = seatedColorsFor(playerCount);
    const actor = prev.currentPlayer;

    // 1. Nuke warhead fall + 6-block crimson blood-bath corridor + vaporized bursts
    const prevFlashLen = prev.nukeFlash?.length ?? 0;
    const nextFlash = next.nukeFlash ?? [];
    if (nextFlash.length > 0 && (prevFlashLen === 0 || next.captureMessage !== prev.captureMessage)) {
        const impactCell = nextFlash[0];
        const actorPosArr = (next.positions?.[actor] ?? []).map((p) => Number(p));
        let centerPos = -1;
        for (const p of actorPosArr) {
            if (p >= 0 && p < HOME_LANE_START_INDEX) {
                const pt = getBoardCoordinate(p, actor, cc);
                if (pt && pt.r === impactCell.r && pt.c === impactCell.c) {
                    centerPos = p;
                    break;
                }
            }
        }

        const corridorCells =
            centerPos >= 0
                ? computeNukeBlastCorridor(centerPos, actor, cc)
                : dedupPoints(nextFlash);

        const victimCells: { pt: Point; color: PlayerColor }[] = [];
        for (const c of seats) {
            const pArr = prev.positions?.[c] ?? [];
            const nArr = next.positions?.[c] ?? [];
            for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
                const p = Number(pArr[i]);
                const n = Number(nArr[i]);
                if (p >= 0 && p < BOARD_FINISH_INDEX && n === BASE_INDEX) {
                    const pt = getBoardCoordinate(p, c, cc);
                    if (pt) victimCells.push({ pt, color: c });
                }
            }
        }

        const resolvedCorridor = corridorCells.length > 0 ? corridorCells : [impactCell];
        const corridorKeySet = new Set(resolvedCorridor.map((p) => `${p.r},${p.c}`));
        const deflectedRaw: Point[] = [];
        for (const s of next.activeShields ?? []) {
            if (s.color === actor) continue;
            if (playerCount === '2v2' && s.color === getTeammateColor(actor, playerCount)) continue;
            const sPos = Number(next.positions?.[s.color]?.[s.tokenIdx] ?? BASE_INDEX);
            if (sPos < 0 || sPos >= HOME_LANE_START_INDEX) continue;
            const sPt = getBoardCoordinate(sPos, s.color, cc);
            if (sPt && corridorKeySet.has(`${sPt.r},${sPt.c}`)) {
                deflectedRaw.push(sPt);
            }
        }
        const deflectedCells = dedupPoints(deflectedRaw);

        const attackerCorner = cc[actor] ?? 'BL';
        events.push({
            kind: 'nuke',
            attacker: actor,
            originCell: CORNER_GRID_ANCHOR[attackerCorner],
            impactCell,
            corridorCells: resolvedCorridor,
            victimCells,
            ...(deflectedCells.length > 0 ? { deflectedCells } : {}),
        });
    }

    // 2. Shield deployed
    if ((next.activeShields?.length ?? 0) > (prev.activeShields?.length ?? 0)) {
        const prevKeys = new Set((prev.activeShields ?? []).map((s) => `${s.color}:${s.tokenIdx}`));
        const newlyAdded = (next.activeShields ?? []).filter(
            (s) => !prevKeys.has(`${s.color}:${s.tokenIdx}`),
        );
        const shieldColor = newlyAdded[0]?.color ?? actor;
        const cells: Point[] = [];
        for (const s of newlyAdded) {
            const pos = Number(next.positions?.[s.color]?.[s.tokenIdx] ?? BASE_INDEX);
            if (pos >= 0 && pos < HOME_LANE_START_INDEX) {
                const pt = getBoardCoordinate(pos, s.color, cc);
                if (pt) cells.push(pt);
            }
        }
        if (cells.length > 0) {
            events.push({ kind: 'shield', color: shieldColor, cells: dedupPoints(cells) });
        }
    }

    // 3. Boost ignited on track tokens
    if (next.activeBoost && next.activeBoost !== prev.activeBoost) {
        const boostColor = next.activeBoost;
        const cells: Point[] = [];
        for (const pos of next.positions?.[boostColor] ?? []) {
            const nPos = Number(pos);
            if (nPos >= 0 && nPos < BOARD_FINISH_INDEX) {
                const pt = getBoardCoordinate(nPos, boostColor, cc);
                if (pt) cells.push(pt);
            }
        }
        if (cells.length > 0) {
            events.push({ kind: 'boost_arm', color: boostColor, cells: dedupPoints(cells) });
        }
    }

    // 4. Boosted move plasma trail across traversed cells
    if (next.boostTrail && next.boostTrail !== prev.boostTrail) {
        const bColor = next.boostTrail;
        const pArr = prev.positions?.[bColor] ?? [];
        const nArr = next.positions?.[bColor] ?? [];
        const trailCells: Point[] = [];
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const oldPos = Number(pArr[i]);
            const newPos = Number(nArr[i]);
            const wrapDist =
                oldPos >= 0 && oldPos < HOME_LANE_START_INDEX && newPos >= 0 && newPos < HOME_LANE_START_INDEX
                    ? (newPos - oldPos + HOME_LANE_START_INDEX) % HOME_LANE_START_INDEX
                    : 0;
            const movedForward =
                oldPos !== newPos &&
                oldPos >= 0 &&
                newPos >= 0 &&
                newPos <= BOARD_FINISH_INDEX &&
                (newPos > oldPos || (wrapDist > 0 && wrapDist <= 12));
            if (movedForward) {
                const startPt = getBoardCoordinate(oldPos, bColor, cc);
                if (startPt) trailCells.push(startPt);
                const path = getIntermediatePathCoords(oldPos, newPos, bColor, cc);
                trailCells.push(...path);
                break;
            }
        }
        if (trailCells.length > 0) {
            events.push({
                kind: 'boost_trail',
                color: bColor,
                cells: dedupPoints(trailCells),
            });
        }
    }

    // 5. Teleport warp beam + implosion/materialization
    if (
        next.captureMessage &&
        next.captureMessage !== prev.captureMessage &&
        /TELEPORT!/i.test(next.captureMessage)
    ) {
        const pArr = prev.positions?.[actor] ?? [];
        const nArr = next.positions?.[actor] ?? [];
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const oldPos = Number(pArr[i]);
            const newPos = Number(nArr[i]);
            if (oldPos !== newPos && oldPos >= 0) {
                const fromCell = getBoardCoordinate(oldPos, actor, cc);
                const toFinish = newPos === BOARD_FINISH_INDEX;
                const toCell = toFinish ? { r: 8, c: 8 } : getBoardCoordinate(newPos, actor, cc);
                if (fromCell && toCell) {
                    events.push({
                        kind: 'teleport',
                        color: actor,
                        fromCell,
                        toCell,
                        toFinish,
                    });
                }
                break;
            }
        }
    }

    return events;
}
