/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
import { GameState, PlayerColor, LobbySlot, LobbyState, MatchCaptureStats } from './types';
import { Point, PathCell, ColorCorner, SAFE_POSITIONS as GLOBAL_SAFE_POINTS, CORNER_SLOTS, getBoardCoordinate } from './boardLayout';
import {
    BOARD_FINISH_INDEX,
    TOTAL_PATH_CELLS,
    DEFAULT_TURN_TIMER_SECS,
    DICE_ROLL_SIX,
    BASE_INDEX,
    MAX_CONSECUTIVE_SIXES,
    POWER_RARITY,
    NUKE_RADIUS,
    TEAM_PAIRINGS,
    TEAM_ID
} from './constants';
import type { PowerType } from './types';

/** Zeroed combat counters for every color. */
export function emptyMatchStats(): MatchCaptureStats {
    const row = () => ({ kicks: 0, gotKicked: 0 });
    return { green: row(), red: row(), yellow: row(), blue: row() };
}

/** Immutable increment of kick / got-kicked after a capture list. */
export function applyCaptureEvents(
    stats: MatchCaptureStats | undefined,
    kicker: PlayerColor,
    victims: { capturedColor: PlayerColor }[]
): MatchCaptureStats {
    const base = stats ?? emptyMatchStats();
    const next: MatchCaptureStats = {
        green: { ...base.green },
        red: { ...base.red },
        yellow: { ...base.yellow },
        blue: { ...base.blue },
    };
    const byVictim: Partial<Record<PlayerColor, number>> = {};
    for (const v of victims) {
        byVictim[v.capturedColor] = (byVictim[v.capturedColor] || 0) + 1;
    }
    (Object.keys(byVictim) as PlayerColor[]).forEach((color) => {
        const n = byVictim[color] || 0;
        next[kicker].kicks += n;
        next[color].gotKicked += n;
    });
    return next;
}

export const INITIAL_GAME_STATE: GameState = {
    positions: {
        green: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
        red: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
        yellow: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX],
        blue: [BASE_INDEX, BASE_INDEX, BASE_INDEX, BASE_INDEX]
    },
    currentPlayer: 'green',
    diceValue: null,
    isRolling: false,
    gamePhase: 'rolling',
    status: 'waiting',
    winner: null,
    winners: [],
    captureMessage: null,
    timeLeft: DEFAULT_TURN_TIMER_SECS,
    strikes: { green: 0, red: 0, yellow: 0, blue: 0 },
    powerTiles: [],
    playerPowers: { green: [], red: [], yellow: [], blue: [] },
    powerSpentThisTurn: false,
    activeBoost: null,
    nukeFlash: [],
    boostTrail: null,
    activeTraps: [],
    activeShields: [],
    consecutiveSixes: 0,
    afkStats: {
        green: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        yellow: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
    },
    matchStats: emptyMatchStats(),
    idleWarning: null,
    participantPeers: {},
    isStarted: false,
    isBotMatch: false,
    botDifficulty: 'pro',
    lastUpdate: Date.now(),
    playerCount: '4P',
};

// ─── Power economy helpers ─────────────────────────────────────────────
// Weighted rarity roll for hidden tile types.
/** Select a power type from the configured rarity weights. */
export function rollPowerType(rand: number = Math.random()): PowerType {
    let acc = 0;
    for (const p of POWER_RARITY) {
        acc += p.w;
        if (rand < acc) return p.type;
    }
    return 'boost';
}

// Track indices (0–51) of the star squares for a given color/corner.
// ENG-20: single-sourced in lib/engine/core.ts (the Edge authority is a
// verbatim copy of that module and cannot import, so the authority owns the
// implementation and this module re-exports it). check:drift gates value
// parity against boardLayout geometry.
export { getStarIndices, nearestStarAhead } from './engine/core';
// ENG-11: deterministic respawn helpers share the authority implementation.
export { lcg32, rollPowerTypeLcg, spawnReplacementTile } from './engine/core';

/** Resolve the 2v2 teammate from the shared team-pairing table. */
export function getTeammateColor(color: PlayerColor, playerCount: string): PlayerColor | null {
    if (playerCount !== '2v2') return null;
    return TEAM_PAIRINGS[color];
}

export function getNextPlayer(
    current: PlayerColor,
    playerCount: string,
    activeColors?: PlayerColor[],
    colorCorner?: Record<PlayerColor, string>
): PlayerColor {
    // Physical corner order: Bottom-Left -> Bottom-Right -> Top-Right -> Top-Left (Anti-Clockwise)
    const cornerOrder = ['BL', 'BR', 'TR', 'TL'];

    if (colorCorner && activeColors && activeColors.length > 0) {
        // 1. Get current physical corner
        const currentCorner = colorCorner[current];

        // 2. Identify all occupied corners by "active" participants
        // In 2v2, a participant is active if either they or their teammate have tokens left
        const occupiedCorners = activeColors.map(c => colorCorner[c]);

        // 3. Filter order to only include active corners
        const activeOrder = cornerOrder.filter(corner => occupiedCorners.includes(corner));

        if (activeOrder.length > 0) {
            // 4. Find next in sequence
            const currentIdx = activeOrder.indexOf(currentCorner);
            // If current corner isn't in activeOrder (e.g. just finished in FFA), 
            // find its position in cornerOrder and find next active one
            if (currentIdx === -1) {
                const checkIdx = cornerOrder.indexOf(currentCorner);
                for (let i = 1; i <= 4; i++) {
                    const nextC = cornerOrder[(checkIdx + i) % 4];
                    if (occupiedCorners.includes(nextC)) {
                        const nextColor = Object.entries(colorCorner).find(([_, corner]) => corner === nextC)?.[0] as PlayerColor;
                        if (nextColor) return nextColor;
                    }
                }
            } else {
                const nextCorner = activeOrder[(currentIdx + 1) % activeOrder.length];
                // 5. Find color for that corner
                const nextColor = Object.entries(colorCorner).find(([_, corner]) => corner === nextCorner)?.[0] as PlayerColor;
                if (nextColor) return nextColor;
            }
        }
    }

    // Keep legacy color order as a safe fallback for local callers without seating.
    const order: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];
    const idx = order.indexOf(current);
    return order[(idx + 1) % 4];
}

/** Resolve a color to a team number, treating non-2v2 modes as free-for-all. */
export function getTeam(color: PlayerColor, playerCount: string = '4P'): number {
    if (playerCount === '2v2') {
        return TEAM_ID[color];
    }
    // In 4P FFA or 1v1, everyone is on their own team
    const map: Record<PlayerColor, number> = { green: 1, red: 2, yellow: 3, blue: 4 };
    return map[color];
}

/**
 * Calculate a destination without mutating state. A six exits base, and the
 * gate calculation maps an overshoot past shared index 50 into home 52–57.
 */
export function calculateNextPosition(
    currentPos: number,
    steps: number,
    color: PlayerColor,
    cc: ColorCorner
): number {
    if (currentPos === BASE_INDEX) {
        if (steps === DICE_ROLL_SIX) {
            // Enter the board at the player's global start index
            const corner = cc[color];
            if (!corner) return BASE_INDEX;
            return CORNER_SLOTS[corner].startIdx;
        }
        return BASE_INDEX;
    }

    if (currentPos >= 52) {
        // Already in private home stretch
        const nextPos = currentPos + steps;
        if (nextPos > 57) return currentPos; // Overshot invalid
        return nextPos;
    }

    // Currently on the global shared path (0-51); distance is relative to the
    // player's start so every color crosses its own gate consistently.
    // `nextDistance > 50` intentionally maps 50 -> 52, ..., 55 -> 57.
    const corner = cc[color];
    if (!corner) return currentPos;
    const startIdx = CORNER_SLOTS[corner].startIdx;
    const _endGlobalIdx = (startIdx + 50) % 52;
    
    // Special logic for crossing the gate. The gate is the endGlobalIdx.
    // If we are "behind" or at the gate from the perspective of completion.
    // Since it's a circular track, we determine if we cross `endGlobalIdx` in this exact roll.
    // A token crosses the gate if its current distance from start + steps > 50.
    
    // Calculate distance traveled on the shared path so far
    let distanceTraveled = currentPos - startIdx;
    if (distanceTraveled < 0) distanceTraveled += 52;
    
    const nextDistance = distanceTraveled + steps;

    if (nextDistance > 50) {
        // Crossing the gate into the home stretch
        const overshoot = nextDistance - 50; // Steps taken inside the home stretch (1-based)
        // overshoot=1 -> index 52, overshoot=2 -> index 53, ..., overshoot=6 -> index 57.
        const nextPos = 51 + overshoot;
        if (nextPos > 57) return currentPos; // Overshot finish
        return nextPos;
    }

    // Normal movement on the shared path
    return (currentPos + steps) % 52;
}

/**
 * Returns the sequence of (r, c) coordinates for a token moving from fromPos to toPos.
 * Used for "hopping" animations in the UI.
 */
export function getIntermediatePathCoords(
    fromPos: number,
    toPos: number,
    color: PlayerColor,
    cc: ColorCorner
): Point[] {
    if (fromPos === BASE_INDEX || toPos === BASE_INDEX || fromPos === toPos) return [];

    const coords: Point[] = [];
    let current = fromPos;
    
    // We move 1 step at a time until we reach toPos
    // Safety break at 6 steps (max ludo move)
    for (let i = 0; i < 6; i++) {
        current = calculateNextPosition(current, 1, color, cc);
        const pt = getBoardCoordinate(current, color, cc);
        if (pt) coords.push(pt);
        if (current === toPos) break;
    }
    
    return coords;
}

export function getTeamForceAtPoint(
    team: number,
    pointPos: number, // Using global index for shared, or local for private
    state: GameState,
    playerCount: string = '4P'
): number {
    let force = 0;
    for (const [colorStr, positions] of Object.entries(state.positions)) {
        const c = colorStr as PlayerColor;
        if (getTeam(c, playerCount) !== team) continue;
        
        positions.forEach(pos => {
            if (pos === pointPos) {
                force++;
            }
        });
    }
    return force;
}

export function checkMultiCapture(
    color: PlayerColor,
    nextPos: number, // Global index (0-51) or Local (52-57)
    state: GameState,
    cc: ColorCorner,
    playerCount: string = '4P'
): { capturedColor: PlayerColor; capturedIdx: number }[] {
    if (nextPos < 0 || nextPos >= 52) return []; // Cannot capture in home lane or finish

    const targetPoint = getBoardCoordinate(nextPos, color, cc);
    if (!targetPoint) return [];
    
    const isSafeSquare = GLOBAL_SAFE_POINTS.some(p => p.r === targetPoint.r && p.c === targetPoint.c);
    if (isSafeSquare) return [];

    const actingTeam = getTeam(color, playerCount);
    // Force AFTER move. 
    // State passed is BEFORE the move. We add 1 to acting team's force.
    const actingForce = getTeamForceAtPoint(actingTeam, nextPos, state, playerCount) + 1;
    const captured: { capturedColor: PlayerColor; capturedIdx: number }[] = [];

    for (const [otherColor, positions] of Object.entries(state.positions)) {
        const otherColorTyped = otherColor as PlayerColor;
        const otherTeam = getTeam(otherColorTyped, playerCount);
        if (otherTeam === actingTeam) continue;

        const otherForce = getTeamForceAtPoint(otherTeam, nextPos, state, playerCount);

        // TRUCE Logic: Capture only if actingForce >= otherForce
        if (otherForce > 0 && actingForce >= otherForce) {
            // Check which tokens of this other color are at that point
            positions.forEach((pos, i) => {
                if (pos === nextPos) {
                    // Check for Shield
                    const hasShield = state.activeShields.some(s => s.color === otherColor && s.tokenIdx === i);
                    if (!hasShield) {
                        captured.push({ capturedColor: otherColorTyped, capturedIdx: i });
                    }
                }
            });
        }
    }

    return captured;
}

export interface MoveResult {
    newState: GameState;
    captured: boolean;
    bonusRoll: boolean;
}

/**
 * ENG-14: shared post-move epilogue for the trap branch (parity with
 * core.ts `finishTrappedMove`). The trap early-return skipped shield cleanup
 * and left a stale `diceValue` behind; it now runs the same epilogue as the
 * normal branch. Boost/sixes are owned downstream (authority) or by the
 * caller (offline), and a trap to BASE can never complete a win.
 */
function finishTrappedMove(
    state: GameState,
    newPositions: Record<PlayerColor, number[]>,
    newTraps: GameState['activeTraps'],
    actingColor: PlayerColor,
    playerCount: string,
    activeColors: PlayerColor[] | undefined,
    cc: ColorCorner,
): GameState {
    return {
        ...state,
        positions: newPositions,
        activeTraps: newTraps,
        activeShields: (state.activeShields || []).filter(s => s.color !== actingColor),
        lastUpdate: Date.now(),
        currentPlayer: getNextPlayer(actingColor, playerCount, activeColors, cc),
        gamePhase: 'rolling',
        diceValue: null,
    };
}

export function resolveTrap(state: GameState, targetPoint: Point, tokenColor: PlayerColor, tokenIndex: number, playerCount: string = '4P'): { trapIdx: number, newPositions: Record<PlayerColor, number[]> } | null {
    // ENG-12: 2v2 teammate truce — a teammate's trap never fires on you,
    // matching capture (checkMultiCapture) and nuke (countNukeVictims).
    const trapIdx = state.activeTraps.findIndex(t => t.r === targetPoint.r && t.c === targetPoint.c && t.owner !== tokenColor && (playerCount !== '2v2' || getTeam(t.owner, playerCount) !== getTeam(tokenColor, playerCount)));
    if (trapIdx === -1) return null;

    const newPositions = { ...state.positions };
    newPositions[tokenColor] = [...newPositions[tokenColor]];
    newPositions[tokenColor][tokenIndex] = BASE_INDEX;
    return { trapIdx, newPositions };
}

export function resolveCapturesInPositions(
    state: GameState,
    tokenColor: PlayerColor,
    nextPos: number,
    cc: ColorCorner,
    playerCount: string,
    currentPositions: Record<PlayerColor, number[]>
): {
    captured: boolean;
    newPositions: Record<PlayerColor, number[]>;
    captureList: { capturedColor: PlayerColor; capturedIdx: number }[];
} {
    const captures = checkMultiCapture(tokenColor, nextPos, state, cc, playerCount);
    if (captures.length === 0) return { captured: false, newPositions: currentPositions, captureList: [] };

    const newPositions = { ...currentPositions };
    captures.forEach(c => {
        newPositions[c.capturedColor] = [...newPositions[c.capturedColor]];
        newPositions[c.capturedColor][c.capturedIdx] = BASE_INDEX;
    });
    return { captured: true, newPositions, captureList: captures };
}

/**
 * Legal token indices for a color given a dice roll.
 * Uses calculateNextPosition so gate-crossing / base-exit / overshoot match the engine.
 */
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

export function processMove(
    state: GameState,
    tokenColor: PlayerColor,
    tokenIndex: number,
    steps: number,
    playerCount: string,
    cc: ColorCorner,
    actingPlayer?: PlayerColor, 
    activeColors?: PlayerColor[]
): MoveResult {
    const actingColor = actingPlayer || tokenColor;
    if (state.winner) return { newState: state, captured: false, bonusRoll: false };

    const initialPos = state.positions[tokenColor][tokenIndex];
    const nextPos = calculateNextPosition(initialPos, steps, tokenColor, cc);

    if (nextPos === initialPos && steps !== 0) {
        return { newState: state, captured: false, bonusRoll: false };
    }

    const targetPoint = getBoardCoordinate(nextPos, tokenColor, cc);
    if (!targetPoint) return { newState: state, captured: false, bonusRoll: false };
    
    // 1. Resolve Traps
    const trapResult = resolveTrap(state, targetPoint, tokenColor, tokenIndex, playerCount);
    if (trapResult) {
        const newTraps = [...state.activeTraps];
        newTraps.splice(trapResult.trapIdx, 1);
        return {
            newState: finishTrappedMove(state, trapResult.newPositions, newTraps, actingColor, playerCount, activeColors, cc),
            captured: false,
            bonusRoll: false
        };
    }

    // 2. Resolve Captures
    const { captured, newPositions, captureList } = resolveCapturesInPositions(state, tokenColor, nextPos, cc, playerCount, {
        ...state.positions,
        [tokenColor]: [...state.positions[tokenColor]].map((p, i) => i === tokenIndex ? nextPos : p)
    });
    const matchStats = captured
        ? applyCaptureEvents(state.matchStats, actingColor, captureList)
        : (state.matchStats ?? emptyMatchStats());

    // 3. Check Win Status — team membership from TEAM_PAIRINGS/TEAM_ID only
    const allFinished = (c: PlayerColor) => newPositions[c].every(p => p === BOARD_FINISH_INDEX);
    const teamWon = (t: number) => {
        const members = (['green', 'red', 'yellow', 'blue'] as PlayerColor[])
            .filter(c => TEAM_ID[c] === t);
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
    } else {
        if (allFinished(tokenColor)) {
            winner = tokenColor;
            status = 'finished';
        }
    }

    const bonusRoll = captured || steps === DICE_ROLL_SIX;
    const nextPlayer = (bonusRoll && status !== 'finished') ? actingColor : getNextPlayer(actingColor, playerCount, activeColors, cc);

    // ENG-06: record EVERY newly-finished color (parity with core.ts).
    // In 2v2 the teammate may already be all-home when the team wins.
    const newlyFinished = (['green', 'red', 'yellow', 'blue'] as PlayerColor[])
        .filter(c => allFinished(c) && !state.winners.includes(c));

    return {
        newState: {
            ...state,
            positions: newPositions,
            currentPlayer: nextPlayer,
            diceValue: null,
            gamePhase: 'rolling',
            winner,
            status,
            winners: newlyFinished.length ? [...state.winners, ...newlyFinished] : state.winners,
            matchStats,
            lastUpdate: Date.now()
        },
        captured,
        bonusRoll
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

// --- Lobby Management Helpers ---

// ENG-02: single source of truth. The 2v2 order is derived from TEAM_PAIRINGS
// ([host, teammate, ...opponents]) so the lobby can never contradict the
// seating/capture/win rule table in lib/constants.ts.
const LOBBY_2V2_HOST: PlayerColor = 'green';
const LOBBY_2V2_TEAMMATE: PlayerColor = TEAM_PAIRINGS[LOBBY_2V2_HOST];
const LOBBY_2V2_OPPONENTS = (['green', 'red', 'yellow', 'blue'] as PlayerColor[])
    .filter(c => c !== LOBBY_2V2_HOST && c !== LOBBY_2V2_TEAMMATE);

const LOBBY_COLORS: Record<string, PlayerColor[]> = {
    '1v1': ['green', 'yellow'], // Changed from ['green', 'red'] to ensure diagonal opposition
    '2v2': [LOBBY_2V2_HOST, LOBBY_2V2_TEAMMATE, ...LOBBY_2V2_OPPONENTS],
    '4P': ['green', 'red', 'yellow', 'blue'],
};

const LOBBY_ROLES: Record<string, Array<'host' | 'teammate' | 'opponent'>> = {
    '1v1': ['host', 'opponent'],
    '2v2': ['host', 'teammate', 'opponent', 'opponent'],
    '4P': ['host', 'opponent', 'opponent', 'opponent'],
};

/**
 * Generate the correct slot array for the given match type.
 * Slot 0 is always the Host.
 */
export function createLobbySlots(matchType: '1v1' | '2v2' | '4P'): LobbySlot[] {
    const colors = LOBBY_COLORS[matchType];
    const roles = LOBBY_ROLES[matchType];
    return colors.map((color, i) => ({
        slotIndex: i,
        role: roles[i],
        color,
        status: i === 0 ? 'joined' : 'empty' as const,
    }));
}

/** Count of filled (joined) slots */
export function getJoinedCount(slots: LobbySlot[]): number {
    return slots.filter(s => s.status === 'joined').length;
}

/** Indices of empty slots */
export function getEmptySlots(slots: LobbySlot[]): number[] {
    return slots.filter(s => s.status === 'empty').map(s => s.slotIndex);
}

/** All slots must be 'joined' to start */
export function canStartMatch(lobbyState: LobbyState): boolean {
    return lobbyState.slots.every(s => s.status === 'joined');
}

/**
 * Can trigger hybrid quick match?
 * - 2v2: teammate must have joined (at least 2 players)
 * - 4P: at least 2 players total
 * - 1v1: never (only 2 slots, so either full or not)
 */
export function canQuickMatch(lobbyState: LobbyState): boolean {
    const joined = getJoinedCount(lobbyState.slots);
    if (lobbyState.matchType === '2v2') {
        // Teammate slot (index 1) must be filled
        return lobbyState.slots[1].status === 'joined' && joined < lobbyState.slots.length;
    }
    if (lobbyState.matchType === '4P') {
        return joined >= 2 && joined < lobbyState.slots.length;
    }
    return false; // 1v1 doesn't support hybrid
}

/**
 * Generate a 6-character uppercase alphanumeric room code.
 */
export function generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * STRICTLY SYNCHRONOUS slot assignment. Returns null if room is full.
 * This prevents the hybrid matchmaking race condition — callers must
 * check the return value before accepting a PeerJS connection.
 *
 * Assignment rules:
 * - 2v2: First joiner → teammate slot (index 1), then opponent slots
 * - 4P: Sequential fill of non-host slots
 * - 1v1: Single opponent slot
 */
export function assignJoinerToSlot(
    slots: LobbySlot[],
    matchType: '1v1' | '2v2' | '4P',
    playerId: string,
    playerName: string,
    playerAvatar: string,
    peerId: string
): LobbySlot[] | null {
    // Check if player is already in the lobby
    if (slots.some(s => s.playerId === playerId)) return null;

    let targetIndex = -1;

    if (matchType === '2v2') {
        // Priority: teammate slot first, then opponent slots
        if (slots[1].status === 'empty') {
            targetIndex = 1;
        } else {
            targetIndex = slots.findIndex((s, i) => i > 1 && s.status === 'empty');
        }
    } else {
        // 1v1 or 4P: first available empty slot
        targetIndex = slots.findIndex((s, i) => i > 0 && s.status === 'empty');
    }

    if (targetIndex === -1) return null; // Room is full

    const newSlots = slots.map(s => ({ ...s }));
    newSlots[targetIndex] = {
        ...newSlots[targetIndex],
        status: 'joined',
        playerId,
        playerName,
        playerAvatar,
        peerId,
    };
    return newSlots;
}

/** Remove a player from their slot (kick or leave). Resets slot to empty. */
export function removePlayerFromSlot(slots: LobbySlot[], playerId: string): LobbySlot[] {
    return slots.map(s => {
        if (s.playerId === playerId) {
            return {
                ...s,
                status: 'empty' as const,
                playerId: undefined,
                playerName: undefined,
                playerAvatar: undefined,
                peerId: undefined,
            };
        }
        return { ...s };
    });
}

/** Swap two players' slot positions. Host privilege only. */
export function swapSlots(slots: LobbySlot[], indexA: number, indexB: number): LobbySlot[] {
    if (indexA < 0 || indexB < 0 || indexA >= slots.length || indexB >= slots.length) return slots;
    const newSlots = slots.map(s => ({ ...s }));

    // Swap player data, keep role/color/slotIndex intact
    const aPlayer = { playerId: newSlots[indexA].playerId, playerName: newSlots[indexA].playerName, playerAvatar: newSlots[indexA].playerAvatar, peerId: newSlots[indexA].peerId, status: newSlots[indexA].status };
    const bPlayer = { playerId: newSlots[indexB].playerId, playerName: newSlots[indexB].playerName, playerAvatar: newSlots[indexB].playerAvatar, peerId: newSlots[indexB].peerId, status: newSlots[indexB].status };

    newSlots[indexA] = { ...newSlots[indexA], ...bPlayer };
    newSlots[indexB] = { ...newSlots[indexB], ...aPlayer };

    return newSlots;
}
