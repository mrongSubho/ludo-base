import type { ColorCorner, GameState, KickReason, PlayerColor, PowerItem, PowerType } from './types';
import { BASE_INDEX, BOARD_FINISH_INDEX, HOME_LANE_START_INDEX } from './constants';
import { getBoardCoordinate, SAFE_POSITIONS } from './boardLayout';
import { seatedColorsFor, stripPowerTypesForWire } from './engine/core';

export type MatchEvent =
    | {
          type: 'ROLL';
          color: PlayerColor;
          roll: number;
          activeDice: number | null;
          outcome: 'moving' | 'no_moves' | 'forfeit_three_sixes';
          boostSplit?: boolean;
          source?: 'human' | 'bot' | 'timeout';
      }
    | {
          type: 'MOVE';
          color: PlayerColor;
          targetColor: PlayerColor;
          tokenIndex: number;
          steps: number;
          fromPos: number;
          toPos: number;
          deploy?: boolean;
      }
    | {
          type: 'CAPTURE';
          attacker: PlayerColor;
          victims: { color: PlayerColor; tokenIndex: number; fromPos: number }[];
          via?: 'move' | 'nuke' | 'trap';
      }
    | {
          type: 'FINISH';
          color: PlayerColor;
          tokenIndex: number;
          finishedTotal: number;
          via?: 'move' | 'teleport';
      }
    | {
          type: 'SAFE_STAR';
          color: PlayerColor;
          tokenIndex: number;
          pos: number;
      }
    | {
          type: 'POWER_PICKUP';
          color: PlayerColor;
          pos: number;
          powerType?: PowerType;
      }
    | {
          type: 'POWER_TRIGGER';
          color: PlayerColor;
          powerType: PowerType;
          tokenIndex?: number;
      }
    | {
          type: 'TURN_TIMEOUT';
          color: PlayerColor;
          strikeCount: number;
          kicked: boolean;
          afkTriggers?: number;
          kickReason?: KickReason;
      };

export type StatePatch = Omit<Partial<GameState>, 'positions' | 'playerPowers' | 'powerTileSeed' | 'forfeitedWallets' | 'kickedSeats'> & {
    positions?: Partial<Record<PlayerColor, number[]>>;
    playerPowers?: Partial<Record<PlayerColor, PowerItem[]>>;
    _unset?: string[];
};

const ALL_COLORS: readonly PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

function jsonEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }
    return JSON.stringify(a) === JSON.stringify(b);
}

export function buildRollEvents(params: {
    color: PlayerColor;
    rollValue: number;
    outcome: 'forfeit_three_sixes' | 'no_moves' | 'moving';
    activeDice: number | null;
    boostSplitActive?: boolean;
    source?: 'human' | 'bot' | 'timeout';
}): MatchEvent[] {
    return [
        {
            type: 'ROLL',
            color: params.color,
            roll: params.rollValue,
            activeDice: params.activeDice,
            outcome: params.outcome,
            ...(params.boostSplitActive ? { boostSplit: true } : {}),
            ...(params.source && params.source !== 'human' ? { source: params.source } : {}),
        },
    ];
}

export function buildMoveEvents(params: {
    prevState: GameState;
    nextState: GameState;
    color: PlayerColor;
    targetColor: PlayerColor;
    tokenIndex: number;
    steps: number;
    fromPos: number;
    toPos: number;
    captured?: boolean;
    finishedToken?: boolean;
    cc: ColorCorner;
}): MatchEvent[] {
    const events: MatchEvent[] = [
        {
            type: 'MOVE',
            color: params.color,
            targetColor: params.targetColor,
            tokenIndex: params.tokenIndex,
            steps: params.steps,
            fromPos: params.fromPos,
            toPos: params.toPos,
            ...(params.fromPos === BASE_INDEX && params.toPos >= 0 ? { deploy: true } : {}),
        },
    ];

    const seats = seatedColorsFor(params.nextState.playerCount);
    const victims: { color: PlayerColor; tokenIndex: number; fromPos: number }[] = [];
    for (const c of seats) {
        const pArr = params.prevState.positions?.[c] ?? [];
        const nArr = params.nextState.positions?.[c] ?? [];
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const p = Number(pArr[i]);
            const n = Number(nArr[i]);
            if (p >= 0 && p < BOARD_FINISH_INDEX && n === BASE_INDEX) {
                victims.push({ color: c, tokenIndex: i, fromPos: p });
            }
        }
    }
    if (victims.length > 0 || params.captured) {
        events.push({
            type: 'CAPTURE',
            attacker: params.color,
            victims,
            via: 'move',
        });
    }

    if (params.finishedToken || params.toPos === BOARD_FINISH_INDEX) {
        const finishedTotal = (params.nextState.positions?.[params.targetColor] ?? []).filter(
            (v) => Number(v) === BOARD_FINISH_INDEX,
        ).length;
        events.push({
            type: 'FINISH',
            color: params.targetColor,
            tokenIndex: params.tokenIndex,
            finishedTotal,
            via: 'move',
        });
    } else if (params.fromPos >= 0 && params.toPos >= 0 && params.toPos < HOME_LANE_START_INDEX) {
        const pt = getBoardCoordinate(params.toPos, params.targetColor, params.cc);
        if (pt && SAFE_POSITIONS.some((s) => s.r === pt.r && s.c === pt.c)) {
            events.push({
                type: 'SAFE_STAR',
                color: params.targetColor,
                tokenIndex: params.tokenIndex,
                pos: params.toPos,
            });
        }
    }

    const prevHand = params.prevState.playerPowers?.[params.targetColor] ?? [];
    const nextHand = params.nextState.playerPowers?.[params.targetColor] ?? [];
    const prevTiles = params.prevState.powerTiles ?? [];
    const nextTiles = params.nextState.powerTiles ?? [];
    if (nextHand.length > prevHand.length || (prevTiles.length > 0 && !jsonEqual(prevTiles, nextTiles))) {
        const added = nextHand[nextHand.length - 1];
        if (added) {
            events.push({
                type: 'POWER_PICKUP',
                color: params.targetColor,
                pos: params.toPos,
                ...(added.type ? { powerType: added.type } : {}),
            });
        }
    }

    return events;
}

export function buildPowerTriggerEvents(params: {
    prevState: GameState;
    nextState: GameState;
    color: PlayerColor;
    powerType: PowerType;
    tokenIndex?: number;
}): MatchEvent[] {
    const events: MatchEvent[] = [
        {
            type: 'POWER_TRIGGER',
            color: params.color,
            powerType: params.powerType,
            ...(params.tokenIndex !== undefined ? { tokenIndex: params.tokenIndex } : {}),
        },
    ];

    const seats = seatedColorsFor(params.nextState.playerCount);
    if (params.powerType === 'nuke') {
        const victims: { color: PlayerColor; tokenIndex: number; fromPos: number }[] = [];
        for (const c of seats) {
            const pArr = params.prevState.positions?.[c] ?? [];
            const nArr = params.nextState.positions?.[c] ?? [];
            for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
                const p = Number(pArr[i]);
                const n = Number(nArr[i]);
                if (p >= 0 && p < BOARD_FINISH_INDEX && n === BASE_INDEX) {
                    victims.push({ color: c, tokenIndex: i, fromPos: p });
                }
            }
        }
        if (victims.length > 0) {
            events.push({
                type: 'CAPTURE',
                attacker: params.color,
                victims,
                via: 'nuke',
            });
        }
    }

    if (params.powerType === 'teleport' && params.tokenIndex !== undefined) {
        const toPos = Number(params.nextState.positions?.[params.color]?.[params.tokenIndex] ?? BASE_INDEX);
        if (toPos === BOARD_FINISH_INDEX) {
            const finishedTotal = (params.nextState.positions?.[params.color] ?? []).filter(
                (v) => Number(v) === BOARD_FINISH_INDEX,
            ).length;
            events.push({
                type: 'FINISH',
                color: params.color,
                tokenIndex: params.tokenIndex,
                finishedTotal,
                via: 'teleport',
            });
        }
    }

    return events;
}

/**
 * Compute a compact delta patch containing only changed keys between `prev` and `next`.
 * Never includes `powerTileSeed`.
 */
export function computeStatePatch(prev: GameState, next: GameState): StatePatch {
    const patch: Record<string, unknown> = {};
    const unset: string[] = [];

    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) {
        if (key === 'powerTileSeed' || key === 'forfeitedWallets' || key === 'kickedSeats') continue;

        if (key === 'positions') {
            const posPatch: Partial<Record<PlayerColor, number[]>> = {};
            let posChanged = false;
            for (const c of ALL_COLORS) {
                const pArr = prev.positions?.[c];
                const nArr = next.positions?.[c];
                if (!jsonEqual(pArr, nArr) && nArr !== undefined) {
                    posPatch[c] = [...nArr];
                    posChanged = true;
                }
            }
            if (posChanged) patch.positions = posPatch;
            continue;
        }

        if (key === 'playerPowers') {
            const powerPatch: Partial<Record<PlayerColor, PowerItem[]>> = {};
            let powerChanged = false;
            for (const c of ALL_COLORS) {
                const pArr = prev.playerPowers?.[c];
                const nArr = next.playerPowers?.[c];
                if (!jsonEqual(pArr, nArr) && nArr !== undefined) {
                    powerPatch[c] = nArr.map((item) => ({ ...item }));
                    powerChanged = true;
                }
            }
            if (powerChanged) patch.playerPowers = powerPatch;
            continue;
        }

        const prevVal = (prev as unknown as Record<string, unknown>)[key];
        const nextVal = (next as unknown as Record<string, unknown>)[key];
        if (jsonEqual(prevVal, nextVal)) continue;

        if (nextVal === undefined) {
            unset.push(key);
        } else {
            patch[key] = nextVal;
        }
    }

    if (unset.length > 0) {
        patch._unset = unset;
    }

    return patch as StatePatch;
}

/**
 * PW-1 / PW-2 & Stealth AFK wire sanitization for hybrid delta frames:
 * - Never exposes `powerTileSeed`, `forfeitedWallets`, `kickedSeats`, or `powerTiles[].type`
 * - Masks opponent/spectator `playerPowers[].type` and `afkStats`
 * - Masks `turnPhaseKind` (`ai_roll`/`ai_move`) for non-acting viewers
 * - Strips `powerType` from `POWER_PICKUP`, opponent `TURN_TIMEOUT`, and `ROLL.source`
 */
export function sanitizeDeltaForWire(
    patch: StatePatch,
    events: readonly MatchEvent[],
    viewerColor?: string,
    actingColorHint?: string,
): { patch: StatePatch; events: MatchEvent[] } {
    const cleanPatch = stripPowerTypesForWire(
        patch as unknown as Parameters<typeof stripPowerTypesForWire>[0],
        viewerColor,
        actingColorHint,
    ) as unknown as StatePatch;

    const cleanEvents: MatchEvent[] = [];
    for (const ev of events) {
        if (ev.type === 'POWER_PICKUP') {
            if (viewerColor && ev.color === viewerColor) {
                cleanEvents.push({ ...ev });
            } else {
                cleanEvents.push({
                    type: 'POWER_PICKUP',
                    color: ev.color,
                    pos: ev.pos,
                });
            }
            continue;
        }
        if (ev.type === 'TURN_TIMEOUT') {
            // Stealth: opponents & spectators never learn another seat timed out.
            if (viewerColor && ev.color === viewerColor) {
                cleanEvents.push({ ...ev });
            }
            continue;
        }
        if (ev.type === 'ROLL') {
            if (!viewerColor || ev.color !== viewerColor) {
                const { source: _omitted, ...rest } = ev;
                void _omitted;
                cleanEvents.push(rest as MatchEvent);
                continue;
            }
        }
        cleanEvents.push({ ...ev });
    }

    return { patch: cleanPatch, events: cleanEvents };
}

/**
 * Apply a `StatePatch` onto the client's last reconstructed `GameState`.
 */
export function applyStatePatch(base: GameState, patch: StatePatch): GameState {
    const { positions: patchPos, playerPowers: patchPowers, _unset, ...scalarPatch } = patch;
    const next: Record<string, unknown> = {
        ...(base as unknown as Record<string, unknown>),
        ...scalarPatch,
    };

    if (Array.isArray(_unset)) {
        for (const k of _unset) {
            delete next[k];
        }
    }

    if (patchPos) {
        const mergedPos = { ...base.positions };
        for (const c of ALL_COLORS) {
            if (patchPos[c] !== undefined) {
                mergedPos[c] = [...(patchPos[c] as number[])];
            }
        }
        next.positions = mergedPos;
    }

    if (patchPowers) {
        const mergedPowers = { ...base.playerPowers };
        for (const c of ALL_COLORS) {
            if (patchPowers[c] !== undefined) {
                mergedPowers[c] = (patchPowers[c] as PowerItem[]).map((item) => ({ ...item }));
            }
        }
        next.playerPowers = mergedPowers;
    }

    return next as unknown as GameState;
}
