// Pure deterministic Ludo game logic
import { GameState } from '../hooks/MultiplayerContext';

import { Point, PathCell, ColorCorner, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from './boardLayout';

export type PlayerColor = 'green' | 'red' | 'yellow' | 'blue';

export function getNextPlayer(
    current: PlayerColor,
    playerCount: string,
    activeColors?: PlayerColor[],
    colorCorner?: Record<PlayerColor, string>
): PlayerColor {
    // Physical corner order: Bottom-Left -> Bottom-Right -> Top-Right -> Top-Left
    const cornerOrder = ['BL', 'BR', 'TR', 'TL'];

    if (colorCorner && activeColors && activeColors.length > 0) {
        // 1. Get current physical corner
        const currentCorner = colorCorner[current];

        // 2. Identify all occupied corners
        const occupiedCorners = activeColors.map(c => colorCorner[c]);

        // 3. Filter order to only include active corners
        const activeOrder = cornerOrder.filter(corner => occupiedCorners.includes(corner));

        // 4. Find next in sequence
        const currentIdx = activeOrder.indexOf(currentCorner);
        const nextCorner = activeOrder[(currentIdx + 1) % activeOrder.length];

        // 5. Find color for that corner
        const nextColor = Object.entries(colorCorner).find(([_, corner]) => corner === nextCorner)?.[0] as PlayerColor;
        if (nextColor) return nextColor;
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
    if (currentPos === -1) {
        return steps === 6 ? 0 : -1;
    }
    const nextPos = currentPos + steps;
    if (nextPos > 57) return currentPos;
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
            if (pos >= 0 && pos < 52) {
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
    if (nextPos < 0 || nextPos >= 52) return [];

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
                if (pos >= 0 && pos < 52) {
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

export function processMove(
    state: GameState,
    color: PlayerColor,
    tokenIndex: number,
    steps: number,
    playerPaths: Record<string, Point[]>,
    playerCount: string,
    activeColors?: PlayerColor[]
): MoveResult {
    if (state.winner) return { newState: state, captured: false, bonusRoll: false };

    const newPositions = { ...state.positions };
    const initialPos = newPositions[color][tokenIndex];
    const nextPos = calculateNextPosition(initialPos, steps);

    if (nextPos === initialPos && steps !== 0) {
        return { newState: state, captured: false, bonusRoll: false };
    }

    newPositions[color] = [...newPositions[color]];
    newPositions[color][tokenIndex] = nextPos;

    // Check for Traps
    const targetPoint = playerPaths[color][nextPos];
    const trapIdx = state.activeTraps.findIndex(t => t.r === targetPoint.r && t.c === targetPoint.c && t.owner !== color);

    let captured = false;
    if (trapIdx !== -1) {
        // Trigger Trap: Token goes back to start
        newPositions[color][tokenIndex] = -1;
        const newTraps = [...state.activeTraps];
        newTraps.splice(trapIdx, 1);
        return {
            newState: { ...state, positions: newPositions, activeTraps: newTraps, lastUpdate: Date.now() },
            captured: false,
            bonusRoll: false
        };
    }

    // Check Captures
    const captures = checkMultiCapture(color, nextPos, state, playerPaths, playerCount);
    if (captures.length > 0) {
        captures.forEach(c => {
            newPositions[c.capturedColor] = [...newPositions[c.capturedColor]];
            newPositions[c.capturedColor][c.capturedIdx] = -1;
        });
        captured = true;
    }

    // Check for Win / Team Win
    const allFinished = (c: PlayerColor) => newPositions[c].every(p => p === 57);
    const teamWon = (t: number) => {
        if (t === 1) return allFinished('green') && allFinished('yellow');
        return allFinished('red') && allFinished('blue');
    };

    let winner = state.winner;
    let status = state.status;

    if (playerCount === '2v2') {
        if (teamWon(getTeam(color))) {
            winner = `Team ${getTeam(color)}`;
            status = 'finished';
        }
    } else {
        if (allFinished(color)) {
            winner = color;
            status = 'finished';
        }
    }

    const bonusRoll = captured || steps === 6;
    const nextPlayer = bonusRoll ? color : getNextPlayer(color, playerCount, activeColors);

    return {
        newState: {
            ...state,
            positions: newPositions,
            currentPlayer: nextPlayer,
            diceValue: null,
            gamePhase: 'rolling',
            winner,
            status,
            winners: allFinished(color) && !state.winners.includes(color) ? [...state.winners, color] : state.winners,
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
    if (roll !== 6) return { isThreeSixes: false, nextSixes: 0 };
    const nextSixes = currentSixes + 1;
    if (nextSixes === 3) return { isThreeSixes: true, nextSixes: 0 };
    return { isThreeSixes: false, nextSixes };
}
