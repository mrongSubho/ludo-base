import { PlayerColor } from '@/lib/types';
import { checkMultiCapture, getTeamForceAtPoint, getTeam, getTeammateColor } from './gameLogic';
import { Point, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from './boardLayout';

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
    playerPaths: Record<string, Point[]>,
    playerCount: string = '4P',
    powerTiles: { r: number, c: number }[] = []
): number | null {
    const teammate = getTeammateColor(playerId, playerCount as any);
    const selfFinished = positions[playerId].every(p => p === 57);
    const actingColor = (playerCount === '2v2' && selfFinished && teammate) ? teammate : playerId;
    const actingColorTyped = actingColor as PlayerColor;

    const options: number[] = [];

    positions[actingColorTyped].forEach((pos: number, idx: number) => {
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
        const currentPos = positions[actingColorTyped][idx];
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

        // Power Tile Hunting (+120) - User requested aggressive hunting
        const targetPoint = playerPaths[actingColor][nextPos];
        if (nextPos < 52 && targetPoint) {
            const isOnPowerTile = powerTiles.some(pt => pt.r === targetPoint.r && pt.c === targetPoint.c);
            if (isOnPowerTile) {
                score += 120;
            }
        }

        // Capturing / Safe Zones Logic
        if (nextPos < 52 && targetPoint) {
            const isSafeSquare = GLOBAL_SAFE_POINTS.some(p => p.r === targetPoint.r && p.c === targetPoint.c);
            const teamId = getTeam(actingColor, playerCount);
            const actingForce = getTeamForceAtPoint(teamId, targetPoint, { positions } as any, playerPaths, playerCount) + 1;

            // Check if any opponent has tokens here and compare forces
            let maxOppForce = 0;
            (['green', 'red', 'blue', 'yellow'] as const).forEach(color => {
                const otherTeam = getTeam(color, playerCount);
                if (otherTeam !== teamId) {
                    const force = getTeamForceAtPoint(otherTeam, targetPoint, { positions } as any, playerPaths, playerCount);
                    if (force > maxOppForce) maxOppForce = force;
                }
            });

            if (isSafeSquare) {
                score += 50;
            } else if (actingForce > 1 && actingForce > maxOppForce) {
                score += 60; // Better than star square if we are reinforcing?
            } else if (maxOppForce > 0 && actingForce < maxOppForce) {
                score += 30; // Truce state - relatively safe but vulnerable to reinforcement
            }

            // Check for Captures (+100 per token)
            const captures = checkMultiCapture(actingColor, nextPos, { positions, activeShields: [], activeTraps: [] } as any, playerPaths, playerCount);
            score += captures.length * 100;
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
