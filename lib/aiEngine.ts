import { PlayerColor, PowerType, GameState } from '@/lib/types';
import { checkMultiCapture, getTeamForceAtPoint, getTeam, getTeammateColor } from './gameLogic';
import { Point, ColorCorner, getBoardCoordinate, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from './boardLayout';
import { 
    BOARD_FINISH_INDEX, 
    HOME_LANE_START_INDEX, 
    BASE_INDEX, 
    AI_SCORES,
    DICE_MAX
} from './constants';

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
    colorCorner: ColorCorner,
    playerCount: string = '4P',
    powerTiles: { r: number, c: number }[] = [],
    state?: GameState
): number | null {
    const teammate = getTeammateColor(playerId, playerCount as any);
    const selfFinished = positions[playerId].every(p => p === BOARD_FINISH_INDEX);
    const actingColor = (playerCount === '2v2' && selfFinished && teammate) ? teammate : playerId;
    const actingColorTyped = actingColor as PlayerColor;

    const options: number[] = [];

    positions[actingColorTyped].forEach((pos: number, idx: number) => {
        // Check if move is valid
        if (pos === BASE_INDEX) {
            if (roll === DICE_MAX) options.push(idx);
        } else if (pos + roll <= BOARD_FINISH_INDEX) {
            options.push(idx);
        }
    });

    if (options.length === 0) return null; // No valid moves

    let bestTokenIdx = options[0];
    let maxScore = -Infinity;

    options.forEach(idx => {
        const score = calculateMoveScore(
            idx,
            positions,
            actingColorTyped,
            roll,
            colorCorner,
            playerCount,
            powerTiles,
            state
        );

        if (score > maxScore) {
            maxScore = score;
            bestTokenIdx = idx;
        }
    });

    return bestTokenIdx;
}

export function calculateMoveScore(
    tokenIdx: number,
    positions: Record<PlayerColor, number[]>,
    actingColor: PlayerColor,
    roll: number,
    colorCorner: ColorCorner,
    playerCount: string,
    powerTiles: { r: number, c: number }[],
    state?: GameState
): number {
    const currentPos = positions[actingColor][tokenIdx];
    const nextPos = currentPos === BASE_INDEX ? 0 : currentPos + roll;
    let score = 0;

    // Reach Finish Zone (+150) - The ultimate objective
    if (nextPos === BOARD_FINISH_INDEX) {
        score += AI_SCORES.REACH_FINISH;
    }

    // Enter Home Lane (+25) - Safe from captures
    if (nextPos >= HOME_LANE_START_INDEX && currentPos < HOME_LANE_START_INDEX) {
        score += AI_SCORES.ENTER_HOME_LANE;
    }

    // Move out of Home (+40) - Getting a new piece on the board
    if (currentPos === BASE_INDEX) {
        score += AI_SCORES.EXIT_BASE;
    }

    // Power Tile Hunting (+120)
    const targetPoint = getBoardCoordinate(nextPos, actingColor, colorCorner);
    if (nextPos < HOME_LANE_START_INDEX && targetPoint) {
        const isOnPowerTile = powerTiles.some(pt => pt.r === targetPoint.r && pt.c === targetPoint.c);
        if (isOnPowerTile) {
            score += AI_SCORES.POWER_TILE_HUNT;
        }
    }

    // Capturing / Safe Zones Logic
    if (nextPos < HOME_LANE_START_INDEX && targetPoint) {
        const isSafeSquare = GLOBAL_SAFE_POINTS.some(p => p.r === targetPoint.r && p.c === targetPoint.c);
        const teamId = getTeam(actingColor, playerCount);
        const actingForce = getTeamForceAtPoint(teamId, nextPos, { positions } as any, playerCount) + 1;

        // Check if any opponent has tokens here and compare forces
        let maxOppForce = 0;
        (['green', 'red', 'blue', 'yellow'] as const).forEach(color => {
            const otherTeam = getTeam(color, playerCount);
            if (otherTeam !== teamId) {
                const force = getTeamForceAtPoint(otherTeam, nextPos, { positions } as any, playerCount);
                if (force > maxOppForce) maxOppForce = force;
            }
        });

        if (isSafeSquare) {
            score += AI_SCORES.ENTER_SAFE_ZONE;
        } else if (actingForce > 1 && actingForce > maxOppForce) {
            score += AI_SCORES.REINFORCE_ALLY;
        } else if (maxOppForce > 0 && actingForce < maxOppForce) {
            score += 30; // Truce state - relatively safe
        }

        // Check for Captures (+100 per token)
        const dummyState = state || { positions, activeShields: [], activeTraps: [] } as any;
        const captures = checkMultiCapture(actingColor, nextPos, dummyState, colorCorner, playerCount);
        score += captures.length * AI_SCORES.CAPTURE_TOKEN;
    }

    // Distance to finish (Higher is better, small incremental points)
    score += nextPos * AI_SCORES.PROGRESSION_MULTIPLIER;

    return score;
}

export function getBestPowerUsage(
    state: GameState,
    color: PlayerColor,
    colorCorner: ColorCorner,
    playerCount: string
): boolean {
    const power = state.playerPowers[color];
    if (!power) return false;

    if (power === 'bomb') {
        return checkBombTarget(state, color, colorCorner, playerCount);
    } else if (power === 'shield') {
        return checkShieldNeed(state, color, colorCorner, playerCount);
    } else if (power === 'boost' || power === 'warp') {
        return true; // Always use boost/warp if available (simple AI strategy)
    }

    return false;
}

function checkBombTarget(state: GameState, color: PlayerColor, colorCorner: ColorCorner, playerCount: string): boolean {
    let targetFound = false;
    state.positions[color].forEach((myPos: number) => {
        if (myPos < 0 || myPos >= HOME_LANE_START_INDEX) return;
        (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
            if (oppColor === color) return;
            if (playerCount === '2v2' && oppColor === getTeammateColor(color, playerCount)) return;
            state.positions[oppColor].forEach((oppPos: number) => {
                if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) return;
                const myPt = getBoardCoordinate(myPos, color, colorCorner);
                const oppPt = getBoardCoordinate(oppPos, oppColor, colorCorner);
                if (!myPt || !oppPt) return;
                for (let s = 1; s <= DICE_MAX; s++) {
                    const checkPos = myPos + s;
                    if (checkPos >= HOME_LANE_START_INDEX) break;
                    const checkPt = getBoardCoordinate(checkPos, color, colorCorner);
                    if (checkPt && checkPt.r === oppPt.r && checkPt.c === oppPt.c) targetFound = true;
                }
            });
        });
    });
    return targetFound;
}

function checkShieldNeed(state: GameState, color: PlayerColor, colorCorner: ColorCorner, playerCount: string): boolean {
    let vulnerable = false;
    state.positions[color].forEach((myPos: number) => {
        if (myPos < 0 || myPos >= HOME_LANE_START_INDEX) return;
        const myPoint = getBoardCoordinate(myPos, color, colorCorner);
        if (!myPoint) return;
        if (GLOBAL_SAFE_POINTS.some((p: Point) => p.r === myPoint.r && p.c === myPoint.c)) return;
        
        (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
            if (oppColor === color) return;
            if (playerCount === '2v2' && oppColor === getTeammateColor(color, playerCount)) return;
            state.positions[oppColor].forEach((oppPos: number) => {
                if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) return;
                for (let s = 1; s <= DICE_MAX; s++) {
                    const checkPos = oppPos + s;
                    if (checkPos >= HOME_LANE_START_INDEX) break;
                    const checkPt = getBoardCoordinate(checkPos, oppColor, colorCorner);
                    if (checkPt && checkPt.r === myPoint.r && checkPt.c === myPoint.c) vulnerable = true;
                }
            });
        });
    });
    return vulnerable;
}
