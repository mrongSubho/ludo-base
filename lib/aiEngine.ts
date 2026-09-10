import { PlayerColor, PowerType, GameState } from '@/lib/types';
import { checkMultiCapture, getTeamForceAtPoint, getTeam, getTeammateColor, calculateNextPosition, getLegalTokenIndices } from './gameLogic';
import { Point, ColorCorner, getBoardCoordinate, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from './boardLayout';
import {
    BOARD_FINISH_INDEX,
    HOME_LANE_START_INDEX,
    BASE_INDEX,
    AI_SCORES,
    DICE_MAX,
    NUKE_RADIUS,
    BotDifficulty,
    DIFFICULTY_PARAMS
} from './constants';

/**
 * AI Heuristics Engine
 * Evaluates the best possible move for a bot player based on a priority scoring system.
 *
 * Difficulty tiers live in constants.ts (see ENGINE_LOGIC.md §5.2).
 */
export function getBestMove(
    positions: Record<PlayerColor, number[]>,
    playerId: PlayerColor,
    roll: number,
    colorCorner: ColorCorner,
    playerCount: string = '4P',
    powerTiles: { r: number, c: number }[] = [],
    state?: GameState,
    difficulty: BotDifficulty = 'pro'
): number | null {
    const teammate = getTeammateColor(playerId, playerCount as any);
    const selfFinished = positions[playerId].every(p => p === BOARD_FINISH_INDEX);
    const actingColor = (playerCount === '2v2' && selfFinished && teammate) ? teammate : playerId;
    const actingColorTyped = actingColor as PlayerColor;

    // Engine-accurate legality (gate crossing, base exit, overshoot)
    const options = getLegalTokenIndices(positions, actingColorTyped, roll, colorCorner);

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
            state,
            difficulty
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
    state?: GameState,
    difficulty: BotDifficulty = 'pro'
): number {
    const currentPos = positions[actingColor][tokenIdx];
    const nextPos = calculateNextPosition(currentPos, roll, actingColor, colorCorner);
    let score = 0;

    // Reach Finish Zone (+150) - The ultimate objective
    if (nextPos === BOARD_FINISH_INDEX) {
        score += AI_SCORES.REACH_FINISH;
    }

    // Enter Home Lane (Promotion to Queen: +150, Enter safe lane: +25)
    if (nextPos >= HOME_LANE_START_INDEX && currentPos < HOME_LANE_START_INDEX) {
        score += AI_SCORES.ENTER_HOME_LANE + AI_SCORES.PROMOTION;
    }

    // Move out of Home (+40) - Getting a new piece on the board
    if (currentPos === BASE_INDEX) {
        score += AI_SCORES.EXIT_BASE;
    }

    // Power Tile Hunting (+120 × difficulty weight; rookie ignores)
    const targetPoint = getBoardCoordinate(nextPos, actingColor, colorCorner);
    if (nextPos >= 0 && nextPos < HOME_LANE_START_INDEX && targetPoint) {
        const isOnPowerTile = powerTiles.some(pt => pt.r === targetPoint.r && pt.c === targetPoint.c);
        if (isOnPowerTile) {
            score += AI_SCORES.POWER_TILE_HUNT * DIFFICULTY_PARAMS[difficulty].powerHunt;
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

        // Check for Captures (+100 per token × difficulty weight)
        const dummyState = state || { positions, activeShields: [], activeTraps: [] } as any;
        const captures = checkMultiCapture(actingColor, nextPos, dummyState, colorCorner, playerCount);
        score += captures.length * AI_SCORES.CAPTURE_TOKEN * DIFFICULTY_PARAMS[difficulty].capture;
    }

    // Distance to finish (Higher is better, small incremental points)
    score += nextPos * AI_SCORES.PROGRESSION_MULTIPLIER;

    // Rookie noise: misjudges positions by up to ±40%.
    const noise = DIFFICULTY_PARAMS[difficulty].noise;
    if (noise > 0 && score !== 0) {
        score *= 1 + (Math.random() * 2 - 1) * noise;
    }

    return score;
}

export function getBestPowerUsage(
    state: GameState,
    color: PlayerColor,
    colorCorner: ColorCorner,
    playerCount: string,
    difficulty: BotDifficulty = 'pro'
): { type: PowerType; tokenIdx?: number } | null {
    // Rookie sits on powers, never spending them.
    if (!DIFFICULTY_PARAMS[difficulty].usesPowers) return null;
    const held = (t: PowerType) => (state.playerPowers[color] || []).some(p => p.type === t);
    if (!held('nuke') && !held('shield') && !held('boost') && !held('teleport')) return null;

    // Nuke: densest cluster wins.
    if (held('nuke')) {
        const best = bestNukeTarget(state, color, colorCorner, playerCount);
        if (best) return { type: 'nuke', tokenIdx: best.tokenIdx };
    }
    if (held('shield') && checkShieldNeed(state, color, colorCorner, playerCount)) {
        return { type: 'shield' };
    }
    if (held('boost')) {
        return { type: 'boost' };
    }
    if (held('teleport')) {
        return { type: 'teleport' };
    }

    return null;
}

// Victims within ±NUKE_RADIUS of an own token (unshielded, off safe stars).
export function countNukeVictims(
    state: GameState, color: PlayerColor, tokenIdx: number,
    colorCorner: ColorCorner, playerCount: string
): { victims: { color: PlayerColor, idx: number }[], cells: { r: number, c: number }[] } {
    const victims: { color: PlayerColor, idx: number }[] = [];
    const cellKeys = new Set<string>();
    const cells: { r: number, c: number }[] = [];
    const myPos = state.positions[color][tokenIdx];
    if (myPos < 0 || myPos >= HOME_LANE_START_INDEX) return { victims, cells };
    const pushCell = (r: number, c: number) => {
        const k = `${r},${c}`;
        if (!cellKeys.has(k)) {
            cellKeys.add(k);
            cells.push({ r, c });
        }
    };
    const myPt = getBoardCoordinate(myPos, color, colorCorner);
    if (myPt) pushCell(myPt.r, myPt.c);
    (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
        if (oppColor === color) return;
        if (playerCount === '2v2' && oppColor === getTeammateColor(color, playerCount)) return;
        state.positions[oppColor].forEach((oppPos: number, oppIdx: number) => {
            if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) return;
            if (Math.abs(oppPos - myPos) > NUKE_RADIUS) return;
            const oppPt = getBoardCoordinate(oppPos, oppColor, colorCorner);
            if (!oppPt) return;
            // Shields and safe stars hold against the blast.
            if (state.activeShields.some(s => s.color === oppColor && s.tokenIdx === oppIdx)) return;
            if (GLOBAL_SAFE_POINTS.some(p => p.r === oppPt.r && p.c === oppPt.c)) return;
            victims.push({ color: oppColor, idx: oppIdx });
            pushCell(oppPt.r, oppPt.c);
        });
    });
    return { victims, cells };
}

function bestNukeTarget(
    state: GameState, color: PlayerColor, colorCorner: ColorCorner, playerCount: string
): { tokenIdx: number } | null {
    let best: { tokenIdx: number } | null = null;
    let bestCount = 0;
    state.positions[color].forEach((myPos: number, idx: number) => {
        if (myPos < 0 || myPos >= HOME_LANE_START_INDEX) return;
        const { victims } = countNukeVictims(state, color, idx, colorCorner, playerCount);
        if (victims.length > bestCount) {
            bestCount = victims.length;
            best = { tokenIdx: idx };
        }
    });
    return best;
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
