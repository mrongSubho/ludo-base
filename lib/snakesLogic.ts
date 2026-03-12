// Deterministic Snakes & Ladders game logic
import { PlayerColor } from '@/lib/types';

export const LADDERS = [
    { start: 4, end: 14 }, { start: 9, end: 31 }, { start: 20, end: 38 },
    { start: 28, end: 84 }, { start: 40, end: 59 }, { start: 51, end: 67 },
    { start: 63, end: 81 }, { start: 71, end: 91 }
];
export const SNAKES = [
    { start: 17, end: 7 }, { start: 54, end: 34 }, { start: 62, end: 19 },
    { start: 64, end: 60 }, { start: 87, end: 24 }, { start: 93, end: 73 },
    { start: 95, end: 75 }, { start: 99, end: 78 }
];

export function getNextPlayerSnakes(current: PlayerColor, activeColors: PlayerColor[]): PlayerColor {
    const order: PlayerColor[] = ['green', 'red', 'blue', 'yellow'];
    const currentIndex = order.indexOf(current);
    for (let i = 1; i <= 4; i++) {
        const nextCol = order[(currentIndex + i) % 4];
        if (activeColors.includes(nextCol)) return nextCol;
    }
    return current;
}

export interface SnakesMoveResult {
    finalPos: number;
    bounced: boolean;
    slideType: 'snake' | 'ladder' | null;
    bonusTurn: boolean;
}

/**
 * Calculates the final position after a roll, including bounce-back and slides.
 */
export function calculateSnakesMove(currentPos: number, roll: number): SnakesMoveResult {
    let targetPos = currentPos + roll;
    let bounced = false;
    let slideType: 'snake' | 'ladder' | null = null;
    let bonusTurn = roll === 6;

    if (targetPos > 100) {
        targetPos = 100 - (targetPos - 100);
        bounced = true;
    }

    if (!bounced) {
        const ladder = LADDERS.find(l => l.start === targetPos);
        const snake = SNAKES.find(s => s.start === targetPos);
        if (ladder) {
            targetPos = ladder.end;
            slideType = 'ladder';
        } else if (snake) {
            targetPos = snake.end;
            slideType = 'snake';
        }
    }

    return {
        finalPos: targetPos,
        bounced,
        slideType,
        bonusTurn
    };
}
