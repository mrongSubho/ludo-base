/**
 * Pure engine surface for Edge + app.
 * App: import from '@/lib/engine' (re-exports).
 * Edge: copy this file to supabase/functions/_shared/engine.ts (scripts/sync-edge-engine.mjs).
 */

export type PlayerColor = 'green' | 'red' | 'yellow' | 'blue';
export type Corner = 'BL' | 'BR' | 'TR' | 'TL';
export type ColorCorner = Record<PlayerColor, Corner>;
export type Point = { r: number; c: number };

export const BOARD_FINISH_INDEX = 57;
export const HOME_LANE_START_INDEX = 52;
export const BASE_INDEX = -1;
export const DICE_ROLL_SIX = 6;
export const MAX_CONSECUTIVE_SIXES = 3;
export const DEFAULT_TURN_TIMER_SECS = 15;

export const TEAM_PAIRINGS = {
    green: 'yellow',
    yellow: 'green',
    red: 'blue',
    blue: 'red',
} as const;

export const TEAM_ID = {
    green: 1,
    yellow: 1,
    red: 2,
    blue: 2,
} as const;

export const SHARED_PATH: Point[] = [
    { r: 6, c: 7 }, { r: 5, c: 7 }, { r: 4, c: 7 }, { r: 3, c: 7 }, { r: 2, c: 7 }, { r: 1, c: 7 },
    { r: 1, c: 8 }, { r: 1, c: 9 },
    { r: 2, c: 9 }, { r: 3, c: 9 }, { r: 4, c: 9 }, { r: 5, c: 9 }, { r: 6, c: 9 },
    { r: 7, c: 10 }, { r: 7, c: 11 }, { r: 7, c: 12 }, { r: 7, c: 13 }, { r: 7, c: 14 }, { r: 7, c: 15 },
    { r: 8, c: 15 }, { r: 9, c: 15 },
    { r: 9, c: 14 }, { r: 9, c: 13 }, { r: 9, c: 12 }, { r: 9, c: 11 }, { r: 9, c: 10 },
    { r: 10, c: 9 }, { r: 11, c: 9 }, { r: 12, c: 9 }, { r: 13, c: 9 }, { r: 14, c: 9 }, { r: 15, c: 9 },
    { r: 15, c: 8 }, { r: 15, c: 7 },
    { r: 14, c: 7 }, { r: 13, c: 7 }, { r: 12, c: 7 }, { r: 11, c: 7 }, { r: 10, c: 7 },
    { r: 9, c: 6 }, { r: 9, c: 5 }, { r: 9, c: 4 }, { r: 9, c: 3 }, { r: 9, c: 2 }, { r: 9, c: 1 },
    { r: 8, c: 1 }, { r: 7, c: 1 },
    { r: 7, c: 2 }, { r: 7, c: 3 }, { r: 7, c: 4 }, { r: 7, c: 5 }, { r: 7, c: 6 },
];

export const CORNER_SLOTS: Record<Corner, {
    startIdx: number;
    homeCells: Point[];
    finishCell: Point;
    startCell: Point;
}> = {
    BL: {
        startIdx: 34,
        homeCells: [{ r: 14, c: 8 }, { r: 13, c: 8 }, { r: 12, c: 8 }, { r: 11, c: 8 }, { r: 10, c: 8 }],
        finishCell: { r: 9, c: 8 },
        startCell: { r: 14, c: 7 },
    },
    TR: {
        startIdx: 8,
        homeCells: [{ r: 2, c: 8 }, { r: 3, c: 8 }, { r: 4, c: 8 }, { r: 5, c: 8 }, { r: 6, c: 8 }],
        finishCell: { r: 7, c: 8 },
        startCell: { r: 2, c: 9 },
    },
    BR: {
        startIdx: 21,
        homeCells: [{ r: 8, c: 14 }, { r: 8, c: 13 }, { r: 8, c: 12 }, { r: 8, c: 11 }, { r: 8, c: 10 }],
        finishCell: { r: 8, c: 9 },
        startCell: { r: 9, c: 14 },
    },
    TL: {
        startIdx: 47,
        homeCells: [{ r: 8, c: 2 }, { r: 8, c: 3 }, { r: 8, c: 4 }, { r: 8, c: 5 }, { r: 8, c: 6 }],
        finishCell: { r: 8, c: 7 },
        startCell: { r: 7, c: 2 },
    },
};

export const SAFE_POSITIONS: Point[] = [
    { r: 7, c: 2 }, { r: 2, c: 9 }, { r: 9, c: 14 }, { r: 14, c: 7 },
    { r: 3, c: 7 }, { r: 7, c: 13 }, { r: 13, c: 9 }, { r: 9, c: 3 },
];

export type PowerType = 'shield' | 'boost' | 'nuke' | 'teleport';
export type PowerItem = { type: PowerType; expiresAt: number };

/** Minimal board state Edge validates against. */
export interface EngineGameState {
    positions: Record<PlayerColor, number[]>;
    currentPlayer: PlayerColor;
    diceValue: number | null;
    gamePhase: 'rolling' | 'moving' | 'landing';
    status: 'waiting' | 'playing' | 'finished';
    winner: string | null;
    winners: string[];
    consecutiveSixes: number;
    playerCount: '1v1' | '4P' | '2v2';
    activeShields: { color: PlayerColor; tokenIdx: number }[];
    activeTraps: { r: number; c: number; owner: PlayerColor }[];
    activeBoost: PlayerColor | null;
    powerSpentThisTurn: boolean;
    lastUpdate: number;
    matchId?: string;
    /** Authority-only power types — never broadcast. */
    powerTiles?: { r: number; c: number; type?: PowerType }[];
    playerPowers?: Partial<Record<PlayerColor, PowerItem[]>>;
    [key: string]: unknown;
}

export function getBoardCoordinate(pos: number, color: PlayerColor, cc: ColorCorner): Point | null {
    if (pos < 0) return null;
    if (pos < 52) return SHARED_PATH[pos];
    const corner = cc[color];
    if (!corner) return null;
    const slot = CORNER_SLOTS[corner];
    if (pos === 57) return slot.finishCell;
    if (pos >= 52 && pos <= 56) return slot.homeCells[pos - 52];
    return null;
}

export function getTeammateColor(color: PlayerColor, playerCount: string): PlayerColor | null {
    if (playerCount !== '2v2') return null;
    return TEAM_PAIRINGS[color];
}

export function getTeam(color: PlayerColor, playerCount: string = '4P'): number {
    if (playerCount === '2v2') return TEAM_ID[color];
    const map: Record<PlayerColor, number> = { green: 1, red: 2, yellow: 3, blue: 4 };
    return map[color];
}

export function calculateNextPosition(
    currentPos: number,
    steps: number,
    color: PlayerColor,
    cc: ColorCorner
): number {
    if (currentPos === BASE_INDEX) {
        if (steps === DICE_ROLL_SIX) {
            const corner = cc[color];
            if (!corner) return BASE_INDEX;
            return CORNER_SLOTS[corner].startIdx;
        }
        return BASE_INDEX;
    }
    if (currentPos >= 52) {
        const nextPos = currentPos + steps;
        if (nextPos > 57) return currentPos;
        return nextPos;
    }
    const corner = cc[color];
    if (!corner) return currentPos;
    const startIdx = CORNER_SLOTS[corner].startIdx;
    let distanceTraveled = currentPos - startIdx;
    if (distanceTraveled < 0) distanceTraveled += 52;
    const nextDistance = distanceTraveled + steps;
    if (nextDistance > 50) {
        const overshoot = nextDistance - 50;
        const nextPos = 51 + overshoot;
        if (nextPos > 57) return currentPos;
        return nextPos;
    }
    return (currentPos + steps) % 52;
}

export function getLegalTokenIndices(
    positions: Record<PlayerColor, number[]>,
    color: PlayerColor,
    roll: number,
    cc: ColorCorner
): number[] {
    const legal: number[] = [];
    positions[color].forEach((pos, idx) => {
        if (pos === BOARD_FINISH_INDEX) return;
        const next = calculateNextPosition(pos, roll, color, cc);
        if (next !== pos) legal.push(idx);
    });
    return legal;
}

export function getNextPlayer(
    current: PlayerColor,
    playerCount: string,
    activeColors?: PlayerColor[],
    colorCorner?: ColorCorner
): PlayerColor {
    const cornerOrder: Corner[] = ['BL', 'BR', 'TR', 'TL'];
    if (colorCorner && activeColors && activeColors.length > 0) {
        const currentCorner = colorCorner[current];
        const occupiedCorners = activeColors.map(c => colorCorner[c]);
        const activeOrder = cornerOrder.filter(corner => occupiedCorners.includes(corner));
        if (activeOrder.length > 0) {
            const currentIdx = activeOrder.indexOf(currentCorner);
            if (currentIdx === -1) {
                let checkIdx = cornerOrder.indexOf(currentCorner);
                for (let i = 1; i <= 4; i++) {
                    const nextC = cornerOrder[(checkIdx + i) % 4];
                    if (occupiedCorners.includes(nextC)) {
                        const nextColor = (Object.entries(colorCorner) as [PlayerColor, Corner][])
                            .find(([, corner]) => corner === nextC)?.[0];
                        if (nextColor) return nextColor;
                    }
                }
            } else {
                const nextCorner = activeOrder[(currentIdx + 1) % activeOrder.length];
                const nextColor = (Object.entries(colorCorner) as [PlayerColor, Corner][])
                    .find(([, corner]) => corner === nextCorner)?.[0];
                if (nextColor) return nextColor;
            }
        }
    }
    const order: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];
    const idx = order.indexOf(current);
    return order[(idx + 1) % 4];
}

export function getTeamForceAtPoint(
    team: number,
    pointPos: number,
    state: EngineGameState,
    playerCount: string = '4P'
): number {
    let force = 0;
    for (const [colorStr, positions] of Object.entries(state.positions)) {
        const c = colorStr as PlayerColor;
        if (getTeam(c, playerCount) !== team) continue;
        positions.forEach(pos => { if (pos === pointPos) force++; });
    }
    return force;
}

export function checkMultiCapture(
    color: PlayerColor,
    nextPos: number,
    state: EngineGameState,
    cc: ColorCorner,
    playerCount: string = '4P'
): { capturedColor: PlayerColor; capturedIdx: number }[] {
    if (nextPos < 0 || nextPos >= 52) return [];
    const targetPoint = getBoardCoordinate(nextPos, color, cc);
    if (!targetPoint) return [];
    if (SAFE_POSITIONS.some(p => p.r === targetPoint.r && p.c === targetPoint.c)) return [];
    const actingTeam = getTeam(color, playerCount);
    const actingForce = getTeamForceAtPoint(actingTeam, nextPos, state, playerCount) + 1;
    const captured: { capturedColor: PlayerColor; capturedIdx: number }[] = [];
    for (const [otherColor, positions] of Object.entries(state.positions)) {
        const otherColorTyped = otherColor as PlayerColor;
        const otherTeam = getTeam(otherColorTyped, playerCount);
        if (otherTeam === actingTeam) continue;
        const otherForce = getTeamForceAtPoint(otherTeam, nextPos, state, playerCount);
        if (otherForce > 0 && actingForce >= otherForce) {
            positions.forEach((pos, i) => {
                if (pos === nextPos) {
                    const hasShield = (state.activeShields || []).some(s => s.color === otherColor && s.tokenIdx === i);
                    if (!hasShield) captured.push({ capturedColor: otherColorTyped, capturedIdx: i });
                }
            });
        }
    }
    return captured;
}

export interface MoveResult {
    newState: EngineGameState;
    captured: boolean;
    bonusRoll: boolean;
    /** False when processMove refused (illegal / overshoot / no delta). */
    applied: boolean;
}

export function processMove(
    state: EngineGameState,
    tokenColor: PlayerColor,
    tokenIndex: number,
    steps: number,
    playerCount: string,
    cc: ColorCorner,
    actingPlayer?: PlayerColor,
    activeColors?: PlayerColor[]
): MoveResult {
    const actingColor = actingPlayer || tokenColor;
    if (state.winner) return { newState: state, captured: false, bonusRoll: false, applied: false };

    const initialPos = state.positions[tokenColor][tokenIndex];
    const nextPos = calculateNextPosition(initialPos, steps, tokenColor, cc);

    if (nextPos === initialPos && steps !== 0) {
        return { newState: state, captured: false, bonusRoll: false, applied: false };
    }

    const targetPoint = getBoardCoordinate(nextPos, tokenColor, cc);
    if (!targetPoint) return { newState: state, captured: false, bonusRoll: false, applied: false };

    const trapIdx = (state.activeTraps || []).findIndex(
        t => t.r === targetPoint.r && t.c === targetPoint.c && t.owner !== tokenColor
    );
    if (trapIdx >= 0) {
        const newPositions = { ...state.positions };
        newPositions[tokenColor] = [...newPositions[tokenColor]];
        newPositions[tokenColor][tokenIndex] = BASE_INDEX;
        const newTraps = [...(state.activeTraps || [])];
        newTraps.splice(trapIdx, 1);
        return {
            newState: {
                ...state,
                positions: newPositions,
                activeTraps: newTraps,
                lastUpdate: Date.now(),
                currentPlayer: getNextPlayer(actingColor, playerCount, activeColors, cc),
                gamePhase: 'rolling',
                diceValue: null,
            },
            captured: false,
            bonusRoll: false,
            applied: true,
        };
    }

    const movedPositions = {
        ...state.positions,
        [tokenColor]: [...state.positions[tokenColor]].map((p, i) => (i === tokenIndex ? nextPos : p)),
    };
    const captures = checkMultiCapture(tokenColor, nextPos, { ...state, positions: movedPositions }, cc, playerCount);
    const newPositions = { ...movedPositions };
    captures.forEach(c => {
        newPositions[c.capturedColor] = [...newPositions[c.capturedColor]];
        newPositions[c.capturedColor][c.capturedIdx] = BASE_INDEX;
    });
    const captured = captures.length > 0;

    const allFinished = (c: PlayerColor) => newPositions[c].every(p => p === BOARD_FINISH_INDEX);
    const teamWon = (t: number) => {
        const members = (['green', 'red', 'yellow', 'blue'] as PlayerColor[]).filter(c => TEAM_ID[c] === t);
        return members.length > 0 && members.every(c => allFinished(c));
    };

    let winner = state.winner;
    let status = state.status;
    if (playerCount === '2v2') {
        const teamId = getTeam(tokenColor, playerCount);
        if (teamWon(teamId)) {
            winner = `Team ${teamId}`;
            status = 'finished';
        }
    } else if (allFinished(tokenColor)) {
        winner = tokenColor;
        status = 'finished';
    }

    const bonusRoll = captured || steps === DICE_ROLL_SIX;
    const nextPlayer = bonusRoll && status !== 'finished'
        ? actingColor
        : getNextPlayer(actingColor, playerCount, activeColors, cc);

    return {
        newState: {
            ...state,
            positions: newPositions,
            currentPlayer: nextPlayer,
            diceValue: null,
            gamePhase: 'rolling',
            winner,
            status,
            winners: allFinished(tokenColor) && !state.winners.includes(tokenColor)
                ? [...state.winners, tokenColor]
                : state.winners,
            activeShields: (state.activeShields || []).filter(s => s.color !== actingColor),
            lastUpdate: Date.now(),
        },
        captured,
        bonusRoll,
        applied: true,
    };
}

export function handleThreeSixes(
    currentSixes: number,
    roll: number
): { isThreeSixes: boolean; nextSixes: number } {
    if (roll !== DICE_ROLL_SIX) return { isThreeSixes: false, nextSixes: 0 };
    const nextSixes = currentSixes + 1;
    if (nextSixes === MAX_CONSECUTIVE_SIXES) return { isThreeSixes: true, nextSixes: 0 };
    return { isThreeSixes: false, nextSixes };
}

export function activeColorsForTurns(state: EngineGameState): PlayerColor[] {
    const colors = (['green', 'red', 'yellow', 'blue'] as PlayerColor[]).filter(c =>
        (state.positions[c] || []).some(p => p !== BOARD_FINISH_INDEX)
    );
    if (colors.length === 0) return (['green', 'red', 'yellow', 'blue'] as PlayerColor[]);
    return colors;
}

/** Sanitize state before putting it on the wire / into match_states for guests. */
export function stripPowerTypesForWire<T extends { powerTiles?: { r: number; c: number; type?: unknown }[] }>(state: T): T {
    if (!state?.powerTiles?.length) return state;
    return { ...state, powerTiles: state.powerTiles.map(t => ({ r: t.r, c: t.c })) };
}

// ─── Powers (P3) ────────────────────────────────────────────────────────────

export const DICE_MAX = 6;
export const NUKE_RADIUS = 3;
export const POWER_EXPIRY_MS: Record<PowerType, number> = {
    nuke: 3 * 60 * 1000,
    shield: 4 * 60 * 1000,
    boost: 5 * 60 * 1000,
    teleport: 5 * 60 * 1000,
};

export function getStarIndices(color: PlayerColor, cc: ColorCorner): number[] {
    const out: number[] = [];
    for (let pos = 0; pos < 52; pos++) {
        const pt = getBoardCoordinate(pos, color, cc);
        if (pt && SAFE_POSITIONS.some(s => s.r === pt.r && s.c === pt.c)) out.push(pos);
    }
    return out;
}

export function nearestStarAhead(pos: number, color: PlayerColor, cc: ColorCorner): number {
    const stars = getStarIndices(color, cc);
    if (stars.length === 0) return -1;
    let best = -1;
    let bestDist = Infinity;
    for (const s of stars) {
        const dist = (s - pos + 52) % 52;
        if (dist > 0 && dist < bestDist) {
            bestDist = dist;
            best = s;
        }
    }
    return best;
}

export function countNukeVictims(
    state: EngineGameState,
    color: PlayerColor,
    tokenIdx: number,
    cc: ColorCorner,
    playerCount: string
): { victims: { color: PlayerColor; idx: number }[]; cells: Point[] } {
    const victims: { color: PlayerColor; idx: number }[] = [];
    const cellKeys = new Set<string>();
    const cells: Point[] = [];
    const myPos = state.positions[color][tokenIdx];
    if (myPos < 0 || myPos >= HOME_LANE_START_INDEX) return { victims, cells };
    const pushCell = (r: number, c: number) => {
        const k = `${r},${c}`;
        if (!cellKeys.has(k)) {
            cellKeys.add(k);
            cells.push({ r, c });
        }
    };
    const myPt = getBoardCoordinate(myPos, color, cc);
    if (myPt) pushCell(myPt.r, myPt.c);
    (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
        if (oppColor === color) return;
        if (playerCount === '2v2' && oppColor === getTeammateColor(color, playerCount)) return;
        state.positions[oppColor].forEach((oppPos, oppIdx) => {
            if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) return;
            if (Math.abs(oppPos - myPos) > NUKE_RADIUS) return;
            const oppPt = getBoardCoordinate(oppPos, oppColor, cc);
            if (!oppPt) return;
            if ((state.activeShields || []).some(s => s.color === oppColor && s.tokenIdx === oppIdx)) return;
            if (SAFE_POSITIONS.some(p => p.r === oppPt.r && p.c === oppPt.c)) return;
            victims.push({ color: oppColor, idx: oppIdx });
            pushCell(oppPt.r, oppPt.c);
        });
    });
    return { victims, cells };
}

/** Steps for this move including active Boost (+6). */
export function effectiveMoveSteps(state: EngineGameState, color: PlayerColor, dice: number): number {
    return state.activeBoost === color ? dice + DICE_MAX : dice;
}

/** Sweep expired powers and return live inventory for a color. */
export function liveInventory(state: EngineGameState, color: PlayerColor, now: number): PowerItem[] {
    return (state.playerPowers?.[color] || []).filter(p => p.expiresAt > now);
}

function consumeOne(inv: PowerItem[], t: PowerType): PowerItem[] {
    const i = inv.findIndex(p => p.type === t);
    if (i < 0) return inv;
    const next = [...inv];
    next.splice(i, 1);
    return next;
}

export type PowerApplyResult =
    | { ok: true; state: EngineGameState; message: string; nukeFlash?: Point[]; boosted?: boolean }
    | { ok: false; error: string; armed?: 'nuke' | 'teleport'; kept?: boolean };

/**
 * Apply a held power (shield/boost/nuke/teleport) for `color`.
 * Must be called on the authority while gamePhase is 'rolling' and powerSpentThisTurn is false.
 * Nuke/teleport without tokenIdx → armed targeting (no state mutation).
 */
export function applyPower(
    state: EngineGameState,
    color: PlayerColor,
    type: PowerType,
    tokenIdx: number | undefined,
    cc: ColorCorner,
    playerCount: string,
    now: number = Date.now()
): PowerApplyResult {
    if (state.winner) return { ok: false, error: 'Match finished' };
    if (state.currentPlayer !== color) return { ok: false, error: 'Not your turn' };
    if (state.gamePhase !== 'rolling') return { ok: false, error: 'Wrong phase' };
    if (state.powerSpentThisTurn) return { ok: false, error: 'Power already spent this turn' };

    const live = liveInventory(state, color, now);
    if (!live.some(p => p.type === type)) return { ok: false, error: 'Power not held' };

    const inv = [...live];
    let next: EngineGameState = { ...state, playerPowers: { ...state.playerPowers } };
    let message = '';

    if (type === 'shield') {
        const tokensOnBoard = state.positions[color]
            .map((pos, idx) => (pos >= 0 && pos < HOME_LANE_START_INDEX ? idx : -1))
            .filter(idx => idx !== -1);
        const newShields = [...(state.activeShields || [])];
        tokensOnBoard.forEach(idx => {
            if (!newShields.some(s => s.color === color && s.tokenIdx === idx)) {
                newShields.push({ color, tokenIdx: idx });
            }
        });
        next.activeShields = newShields;
        message = 'Shield up! Safe until your next move.';
        next.playerPowers = { ...next.playerPowers, [color]: consumeOne(inv, 'shield') };
        next.powerSpentThisTurn = true;
        next.lastUpdate = now;
        return { ok: true, state: next, message };
    }

    if (type === 'boost') {
        next.activeBoost = color;
        message = `BOOST! Next move +${DICE_MAX} steps.`;
        next.playerPowers = { ...next.playerPowers, [color]: consumeOne(inv, 'boost') };
        next.powerSpentThisTurn = true;
        next.lastUpdate = now;
        return { ok: true, state: next, message, boosted: true };
    }

    if (type === 'nuke') {
        let idx = tokenIdx;
        if (idx === undefined) {
            return { ok: false, error: 'Nuke needs a target token', armed: 'nuke' };
        }
        if (idx < 0 || idx > 3) return { ok: false, error: 'Bad token index' };
        const { victims, cells } = countNukeVictims(state, color, idx, cc, playerCount);
        if (victims.length === 0) {
            return { ok: false, error: 'No targets in blast range — nuke kept.', kept: true };
        }
        const newPositions = { ...state.positions };
        victims.forEach(v => {
            newPositions[v.color] = [...newPositions[v.color]];
            newPositions[v.color][v.idx] = BASE_INDEX;
        });
        next.positions = newPositions;
        (next as { nukeFlash?: Point[] }).nukeFlash = cells;
        message = `NUKE! ${victims.length} token${victims.length === 1 ? '' : 's'} vaporized!`;
        next.playerPowers = { ...next.playerPowers, [color]: consumeOne(inv, 'nuke') };
        next.powerSpentThisTurn = true;
        next.lastUpdate = now;
        return { ok: true, state: next, message, nukeFlash: cells };
    }

    // teleport
    let idx = tokenIdx;
    if (idx === undefined) {
        return { ok: false, error: 'Teleport needs a target token', armed: 'teleport' };
    }
    if (idx < 0 || idx > 3) return { ok: false, error: 'Bad token index' };
    const from = state.positions[color][idx];
    let dest = -1;
    if (from >= 49 && from <= 56) dest = BOARD_FINISH_INDEX;
    else if (from >= 0 && from < HOME_LANE_START_INDEX) dest = nearestStarAhead(from, color, cc);
    if (dest < 0) return { ok: false, error: 'Nowhere to blink — teleport kept.', kept: true };

    const newPos = { ...state.positions };
    newPos[color] = [...newPos[color]];
    newPos[color][idx] = dest;
    next.positions = newPos;
    message = dest === BOARD_FINISH_INDEX ? 'TELEPORT! Straight home!' : 'TELEPORT! Blinked to safety.';
    next.playerPowers = { ...next.playerPowers, [color]: consumeOne(inv, 'teleport') };
    next.powerSpentThisTurn = true;
    next.lastUpdate = now;
    return { ok: true, state: next, message };
}

/** After a successful move: grant pickup if landed exactly on a typed power tile. */
export function applyPowerPickup(
    state: EngineGameState,
    color: PlayerColor,
    landedPos: number,
    cc: ColorCorner,
    now: number = Date.now()
): EngineGameState {
    if (landedPos < 0 || landedPos >= HOME_LANE_START_INDEX) return state;
    const tiles = state.powerTiles || [];
    if (!tiles.length) return state;
    const landPt = getBoardCoordinate(landedPos, color, cc);
    if (!landPt) return state;
    const tileIdx = tiles.findIndex(t => t.r === landPt.r && t.c === landPt.c);
    if (tileIdx < 0) return state;
    const tile = tiles[tileIdx];
    if (!tile.type) return state;

    const live = liveInventory(state, color, now);
    const full = POWER_EXPIRY_MS[tile.type] ?? POWER_EXPIRY_MS.boost;
    const granted: PowerItem[] = live.map(p =>
        p.type === tile.type ? { ...p, expiresAt: now + full } : p
    );
    granted.push({ type: tile.type, expiresAt: now + full });

    // Respawn replacement tile (typed) elsewhere
    const taken = new Set(tiles.map(t => `${t.r},${t.c}`));
    taken.delete(`${tile.r},${tile.c}`);
    const remaining = tiles.filter((_, i) => i !== tileIdx);
    // Deterministic-ish spawn: walk shared path from a hash of now+color
    const palette: PlayerColor[] = ['green', 'red', 'blue', 'yellow'];
    let spawned: { r: number; c: number; type: PowerType } | null = null;
    for (let tries = 0; tries < 32 && !spawned; tries++) {
        const seed = (now + tries * 17 + color.charCodeAt(0)) >>> 0;
        const rc = palette[seed % 4];
        const rp = seed % 52;
        const pt = getBoardCoordinate(rp, rc, cc);
        if (pt && !taken.has(`${pt.r},${pt.c}`)) {
            // Weighted rarity
            const roll = ((seed >>> 8) % 1000) / 1000;
            let acc = 0;
            let ptype: PowerType = 'boost';
            for (const p of [
                { type: 'boost' as PowerType, w: 0.4 },
                { type: 'shield' as PowerType, w: 0.25 },
                { type: 'teleport' as PowerType, w: 0.2 },
                { type: 'nuke' as PowerType, w: 0.15 },
            ]) {
                acc += p.w;
                if (roll < acc) { ptype = p.type; break; }
            }
            spawned = { r: pt.r, c: pt.c, type: ptype };
        }
    }
    if (spawned) remaining.push(spawned);

    return {
        ...state,
        playerPowers: { ...state.playerPowers, [color]: granted },
        powerTiles: remaining,
        captureMessage: `${String(tile.type).toUpperCase()} discovered!`,
    };
}

/** Wire a full move including boost consumption + pickup (Edge path). */
export function resolveNetworkedMove(params: {
    state: EngineGameState;
    color: PlayerColor;
    tokenIndex: number;
    dice: number;
    cc: ColorCorner;
    playerCount: string;
    activeColors?: PlayerColor[];
    now?: number;
}): { ok: boolean; state?: EngineGameState; captured?: boolean; bonusRoll?: boolean; error?: string; fromPos?: number; toPos?: number } {
    const { state, color, tokenIndex, dice, cc, playerCount, activeColors, now = Date.now() } = params;
    const boosted = state.activeBoost === color;
    const steps = effectiveMoveSteps(state, color, dice);
    const legal = getLegalTokenIndices(state.positions, color, steps, cc);
    if (!legal.includes(tokenIndex)) {
        return { ok: false, error: 'Illegal token for this roll (with boost)' };
    }
    const fromPos = state.positions[color][tokenIndex];
    const result = processMove(state, color, tokenIndex, steps, playerCount, cc, color, activeColors);
    if (!result.applied) return { ok: false, error: 'Move rejected by engine' };

    let next = result.newState;
    if (boosted) {
        next = { ...next, activeBoost: null, boostTrail: color };
        (next as { boostTrail?: PlayerColor | null }).boostTrail = color;
    }
    // Bonus on raw six as well as processMove's captured/six-on-steps
    const bonusRoll = result.bonusRoll || result.captured || dice === DICE_ROLL_SIX || !!next.winner;
    const toPos = next.positions[color][tokenIndex];
    next = applyPowerPickup(next, color, toPos, cc, now);
    next = { ...next, powerSpentThisTurn: false, lastUpdate: now };

    return {
        ok: true,
        state: next,
        captured: result.captured,
        bonusRoll,
        fromPos,
        toPos,
    };
}
