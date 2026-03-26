import { GameState, PlayerColor, LobbySlot, LobbyState } from './types';
import { Point, PathCell, ColorCorner, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from './boardLayout';
import { 
    BOARD_FINISH_INDEX, 
    TOTAL_PATH_CELLS, 
    DEFAULT_TURN_TIMER_SECS, 
    DICE_ROLL_SIX,
    BASE_INDEX,
    MAX_CONSECUTIVE_SIXES
} from './constants';

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
    playerPowers: { green: null, red: null, yellow: null, blue: null },
    activeTraps: [],
    activeShields: [],
    consecutiveSixes: 0,
    afkStats: {
        green: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        yellow: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
    },
    idleWarning: null,
    participantPeers: {},
    isStarted: false,
    lastUpdate: Date.now(),
    playerCount: '4P',
};

export function getTeammateColor(color: PlayerColor, playerCount: string): PlayerColor | null {
    if (playerCount !== '2v2') return null;
    const teams: Record<PlayerColor, PlayerColor> = {
        green: 'yellow',
        yellow: 'green',
        red: 'blue',
        blue: 'red'
    };
    return teams[color];
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
                let checkIdx = cornerOrder.indexOf(currentCorner);
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

    // Fallback logic if mapping is missing
    const order: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];
    const idx = order.indexOf(current);
    return order[(idx + 1) % 4];
}

export function getTeam(color: PlayerColor, playerCount: string = '4P'): number {
    if (playerCount === '2v2') {
        if (color === 'green' || color === 'yellow') return 1;
        return 2;
    }
    // In 4P FFA or 1v1, everyone is on their own team
    const map: Record<PlayerColor, number> = { green: 1, red: 2, yellow: 3, blue: 4 };
    return map[color];
}

export function calculateNextPosition(currentPos: number, steps: number): number {
    if (currentPos === BASE_INDEX) {
        return steps === DICE_ROLL_SIX ? 0 : BASE_INDEX;
    }
    const nextPos = currentPos + steps;
    if (nextPos > BOARD_FINISH_INDEX) return currentPos;
    return nextPos;
}

export function getTeamForceAtPoint(
    team: number,
    point: Point,
    state: GameState,
    playerPaths: Record<string, Point[]>,
    playerCount: string = '4P'
): number {
    let force = 0;
    for (const [color, positions] of Object.entries(state.positions)) {
        if (getTeam(color as PlayerColor, playerCount) !== team) continue;
        positions.forEach(pos => {
            if (pos >= 0 && pos < TOTAL_PATH_CELLS) {
                const pt = playerPaths[color][pos];
                if (pt.r === point.r && pt.c === point.c) {
                    force++;
                }
            }
        });
    }
    return force;
}

export function checkMultiCapture(
    color: PlayerColor,
    nextPos: number,
    state: GameState,
    playerPaths: Record<string, Point[]>,
    playerCount: string = '4P'
): { capturedColor: PlayerColor; capturedIdx: number }[] {
    if (nextPos < 0 || nextPos >= TOTAL_PATH_CELLS) return [];

    const targetPoint = playerPaths[color][nextPos];
    const isSafeSquare = GLOBAL_SAFE_POINTS.some(p => p.r === targetPoint.r && p.c === targetPoint.c);
    if (isSafeSquare) return [];

    const actingTeam = getTeam(color, playerCount);
    // Force AFTER move. 
    // Wait, the state passed to checkMultiCapture is the state BEFORE the move.
    // So we add 1 to the acting team's force.
    const actingForce = getTeamForceAtPoint(actingTeam, targetPoint, state, playerPaths) + 1;
    const captured: { capturedColor: PlayerColor; capturedIdx: number }[] = [];

    for (const [otherColor, positions] of Object.entries(state.positions)) {
        const otherColorTyped = otherColor as PlayerColor;
        const otherTeam = getTeam(otherColorTyped, playerCount);
        if (otherTeam === actingTeam) continue;

        const otherForce = getTeamForceAtPoint(otherTeam, targetPoint, state, playerPaths);

        // TRUCE Logic: Capture only if actingForce >= otherForce
        if (otherForce > 0 && actingForce >= otherForce) {
            // Check which tokens of this other color are at that point
            positions.forEach((pos, i) => {
                if (pos >= 0 && pos < TOTAL_PATH_CELLS) {
                    const pt = playerPaths[otherColor][pos];
                    if (pt.r === targetPoint.r && pt.c === targetPoint.c) {
                        // Check for Shield
                        const hasShield = state.activeShields.some(s => s.color === otherColor && s.tokenIdx === i);
                        if (!hasShield) {
                            captured.push({ capturedColor: otherColorTyped, capturedIdx: i });
                        }
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

export function resolveTrap(state: GameState, targetPoint: Point, tokenColor: PlayerColor, tokenIndex: number): { trapIdx: number, newPositions: Record<PlayerColor, number[]> } | null {
    const trapIdx = state.activeTraps.findIndex(t => t.r === targetPoint.r && t.c === targetPoint.c && t.owner !== tokenColor);
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
    playerPaths: Record<string, Point[]>, 
    playerCount: string,
    currentPositions: Record<PlayerColor, number[]>
): { captured: boolean, newPositions: Record<PlayerColor, number[]> } {
    const captures = checkMultiCapture(tokenColor, nextPos, state, playerPaths, playerCount);
    if (captures.length === 0) return { captured: false, newPositions: currentPositions };

    const newPositions = { ...currentPositions };
    captures.forEach(c => {
        newPositions[c.capturedColor] = [...newPositions[c.capturedColor]];
        newPositions[c.capturedColor][c.capturedIdx] = BASE_INDEX;
    });
    return { captured: true, newPositions };
}

export function checkWinStatus(positions: Record<PlayerColor, number[]>, playerCount: string, currentWinner: string | null): { winner: string | null, status: 'waiting' | 'playing' | 'finished', newlyWonColor: PlayerColor | null } {
    const allFinished = (c: PlayerColor) => positions[c].every(p => p === BOARD_FINISH_INDEX);
    const teamWon = (t: number) => {
        if (t === 1) return allFinished('green') && allFinished('yellow');
        return allFinished('red') && allFinished('blue');
    };

    let winner = currentWinner;
    let status: 'waiting' | 'playing' | 'finished' = winner ? 'finished' : 'playing';
    let newlyWonColor: PlayerColor | null = null;

    // Check if the current player just finished all tokens
    // Note: this function doesn't know WHO just moved, so we check all but typically one just changed.
    // For simpler logic, we could pass tokenColor.
    
    // In Ludo Base, we strictly return the first winner found if not already set.
    return { winner, status, newlyWonColor }; 
}

export function processMove(
    state: GameState,
    tokenColor: PlayerColor,
    tokenIndex: number,
    steps: number,
    playerPaths: Record<string, Point[]>,
    playerCount: string,
    actingPlayer?: PlayerColor, 
    activeColors?: PlayerColor[],
    colorCorner?: ColorCorner
): MoveResult {
    const actingColor = actingPlayer || tokenColor;
    if (state.winner) return { newState: state, captured: false, bonusRoll: false };

    const initialPos = state.positions[tokenColor][tokenIndex];
    const nextPos = calculateNextPosition(initialPos, steps);

    if (nextPos === initialPos && steps !== 0) {
        return { newState: state, captured: false, bonusRoll: false };
    }

    const targetPoint = playerPaths[tokenColor][nextPos];
    
    // 1. Resolve Traps
    const trapResult = resolveTrap(state, targetPoint, tokenColor, tokenIndex);
    if (trapResult) {
        const newTraps = [...state.activeTraps];
        newTraps.splice(trapResult.trapIdx, 1);
        return {
            newState: { 
                ...state, 
                positions: trapResult.newPositions, 
                activeTraps: newTraps, 
                lastUpdate: Date.now(),
                currentPlayer: getNextPlayer(actingColor, playerCount, activeColors, colorCorner),
                gamePhase: 'rolling'
            },
            captured: false,
            bonusRoll: false
        };
    }

    // 2. Resolve Captures
    const { captured, newPositions } = resolveCapturesInPositions(state, tokenColor, nextPos, playerPaths, playerCount, {
        ...state.positions,
        [tokenColor]: [...state.positions[tokenColor]].map((p, i) => i === tokenIndex ? nextPos : p)
    });

    // 3. Check Win Status
    const allFinished = (c: PlayerColor) => newPositions[c].every(p => p === BOARD_FINISH_INDEX);
    const teamWon = (t: number) => {
        if (t === 1) return allFinished('green') && allFinished('yellow');
        return allFinished('red') && allFinished('blue');
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
    const nextPlayer = (bonusRoll && status !== 'finished') ? actingColor : getNextPlayer(actingColor, playerCount, activeColors, colorCorner);

    return {
        newState: {
            ...state,
            positions: newPositions,
            currentPlayer: nextPlayer,
            diceValue: null,
            gamePhase: 'rolling',
            winner,
            status,
            winners: allFinished(tokenColor) && !state.winners.includes(tokenColor) ? [...state.winners, tokenColor] : state.winners,
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

const LOBBY_COLORS: Record<string, PlayerColor[]> = {
    '1v1': ['green', 'yellow'], // Changed from ['green', 'red'] to ensure diagonal opposition
    '2v2': ['green', 'yellow', 'red', 'blue'],
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
