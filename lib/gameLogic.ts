// Pure deterministic Ludo game logic
import { GameState } from '../hooks/MultiplayerContext';

export interface Point {
    r: number;
    c: number;
}

export type PlayerColor = 'green' | 'red' | 'yellow' | 'blue';

export const SAFE_POSITIONS = [0, 8, 13, 21, 26, 34, 39, 47];

export function getNextPlayer(current: PlayerColor, playerCount: string): PlayerColor {
    const order: PlayerColor[] = ['green', 'red', 'yellow', 'blue'];
    const idx = order.indexOf(current);
    if (playerCount === '2') {
        return current === 'green' ? 'red' : 'green';
    }
    return order[(idx + 1) % 4];
}

export function getTeam(color: PlayerColor): number {
    if (color === 'green' || color === 'yellow') return 1;
    return 2;
}

export function calculateNextPosition(currentPos: number, steps: number): number {
    if (currentPos === -1) {
        return steps === 6 ? 0 : -1;
    }
    const nextPos = currentPos + steps;
    if (nextPos > 57) return currentPos;
    return nextPos;
}

export function checkCapture(
    color: PlayerColor,
    nextPos: number,
    state: GameState,
    playerPaths: Record<string, Point[]>
): { capturedColor: PlayerColor; capturedIdx: number } | null {
    if (nextPos < 0 || nextPos >= 52) return null;

    const targetPoint = playerPaths[color][nextPos];
    const isSafeSquare = SAFE_POSITIONS.includes(nextPos);
    if (isSafeSquare) return null;

    for (const [otherColor, positions] of Object.entries(state.positions)) {
        if (otherColor === color) continue;

        // In 2v2, don't capture teammate
        if (getTeam(color) === getTeam(otherColor as PlayerColor)) continue;

        for (let i = 0; i < positions.length; i++) {
            const otherPos = positions[i];
            if (otherPos >= 0 && otherPos < 52) {
                const otherPoint = playerPaths[otherColor][otherPos];
                if (otherPoint.r === targetPoint.r && otherPoint.c === targetPoint.c) {
                    // Check for Shield
                    const hasShield = state.activeShields.some(s => s.color === otherColor && s.tokenIdx === i);
                    if (hasShield) return null;

                    return { capturedColor: otherColor as PlayerColor, capturedIdx: i };
                }
            }
        }
    }

    return null;
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
    playerCount: string
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
    const capture = checkCapture(color, nextPos, state, playerPaths);
    if (capture) {
        newPositions[capture.capturedColor] = [...newPositions[capture.capturedColor]];
        newPositions[capture.capturedColor][capture.capturedIdx] = -1;
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
    const nextPlayer = bonusRoll ? color : getNextPlayer(color, playerCount);

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
