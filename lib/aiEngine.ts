import { Point, PlayerColor, SAFE_POSITIONS } from './gameLogic';

/**
 * AI Heuristics Engine
 * Evaluates the best possible move for a bot player based on a priority scoring system.
 * 
 * @param state The current GameState containing positions
 * @param playerId The color of the AI making the move
 * @param roll The current dice roll
 * @param playerPaths The mathematically generated paths for all players
 * @returns The index of the optimal token to move, or null if no valid moves exist
 */
export function getBestMove(
    positions: Record<PlayerColor, number[]>,
    playerId: PlayerColor,
    roll: number,
    playerPaths: Record<string, Point[]>
): number | null {
    const options: number[] = [];

    positions[playerId].forEach((pos, idx) => {
        // Check if move is valid
        if (pos === -1) {
            if (roll === 6) options.push(idx);
        } else if (pos + roll <= 57) {
            options.push(idx);
        }
    });

    if (options.length === 0) return null; // No valid moves

    let bestTokenIdx = options[0];
    let maxScore = -Infinity;

    options.forEach(idx => {
        const currentPos = positions[playerId][idx];
        const nextPos = currentPos === -1 ? 0 : currentPos + roll;
        let score = 0;

        // Reach Finish Zone (+150) - The ultimate objective
        if (nextPos === 57) {
            score += 150;
        }

        // Enter Home Lane (+25) - Safe from captures
        if (nextPos >= 52 && currentPos < 52) {
            score += 25;
        }

        // Move out of Home (+40) - Getting a new piece on the board
        if (currentPos === -1) {
            score += 40;
        }

        // Capturing / Safe Zones Logic
        if (nextPos < 52) {
            const targetPoint = playerPaths[playerId][nextPos];
            const isSafeSquare = SAFE_POSITIONS.includes(nextPos);

            if (isSafeSquare) {
                // Move to Safe Zone (+50)
                score += 50;
            } else {
                // Check for Captures (+100)
                (['green', 'red', 'blue', 'yellow'] as const).forEach(otherColor => {
                    if (otherColor !== playerId) {
                        positions[otherColor].forEach(otherPos => {
                            if (otherPos >= 0 && otherPos < 52) {
                                const otherPoint = playerPaths[otherColor][otherPos];
                                if (otherPoint.r === targetPoint.r && otherPoint.c === targetPoint.c) {
                                    score += 100;
                                }
                            }
                        });
                    }
                });
            }
        }

        // Distance to finish (Higher is better, small incremental points)
        score += nextPos;

        if (score > maxScore) {
            maxScore = score;
            bestTokenIdx = idx;
        }
    });

    return bestTokenIdx;
}
