/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import { PlayerColor, PowerType, GameState } from '@/lib/types';
import { checkMultiCapture, getTeamForceAtPoint, getTeam, getTeammateColor, calculateNextPosition, getLegalTokenIndices } from './gameLogic';
import { Point, ColorCorner, getBoardCoordinate, CORNER_SLOTS, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from './boardLayout';
import {
    BOARD_FINISH_INDEX,
    HOME_LANE_START_INDEX,
    BASE_INDEX,
    TOTAL_PATH_CELLS,
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
 * Difficulty tiers live in constants.ts (see ENGINE_LOGIC.md section 5.2).
 */

/**
 * ENG-09: distance travelled toward home, in cells. Shared-track positions
 * are color-relative (0 at the color's own start, 50 at its gate); home
 * stretch continues 51..56. Scoring the raw track index rewarded a fresh
 * token of a late-start color over a token six cells from home.
 */
function travelDistance(pos: number, color: PlayerColor, cc: ColorCorner): number {
    if (pos === BASE_INDEX) return -1;
    if (pos >= HOME_LANE_START_INDEX) return pos - 1;
    const corner = cc[color];
    const startIdx = corner ? CORNER_SLOTS[corner].startIdx : 0;
    return (((pos - startIdx) % TOTAL_PATH_CELLS) + TOTAL_PATH_CELLS) % TOTAL_PATH_CELLS;
}
/**
 * ENG-10: returns the acting color WITH the token index. In 2v2 the mover
 * may be the teammate (assist), so an index alone is ambiguous — the caller
 * must pass `best.color` to `moveToken`, not the color whose turn it is.
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
): { color: PlayerColor; tokenIndex: number } | null {
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

    return { color: actingColorTyped, tokenIndex: bestTokenIdx };
}

/**
 * Ludo World Heuristic 2: collideChessBack (Threat Avoidance)
 * Checks if a token at `pos` is currently within 1..6 roll distance of an opponent token on an unsafe tile.
 */
export function isThreatenedAtPosition(
    pos: number,
    color: PlayerColor,
    positions: Record<PlayerColor, number[]>,
    colorCorner: ColorCorner,
    playerCount: string
): boolean {
    if (pos < 0 || pos >= HOME_LANE_START_INDEX) return false;
    const myPoint = getBoardCoordinate(pos, color, colorCorner);
    if (!myPoint) return false;
    // Safe squares are immune to capture
    if (GLOBAL_SAFE_POINTS.some((p: Point) => p.r === myPoint.r && p.c === myPoint.c)) return false;

    const oppColors: PlayerColor[] = (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).filter(
        c => c !== color && (playerCount !== '2v2' || c !== getTeammateColor(color, playerCount))
    );

    for (const oppColor of oppColors) {
        const oppTokens = positions[oppColor] || [];
        for (let oppIdx = 0; oppIdx < oppTokens.length; oppIdx++) {
            const oppPos = oppTokens[oppIdx];
            if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) continue;
            for (let roll = 1; roll <= DICE_MAX; roll++) {
                const nextOppPos = calculateNextPosition(oppPos, roll, oppColor, colorCorner);
                if (nextOppPos === oppPos || nextOppPos >= HOME_LANE_START_INDEX) continue;
                const oppPt = getBoardCoordinate(nextOppPos, oppColor, colorCorner);
                if (oppPt && oppPt.r === myPoint.r && oppPt.c === myPoint.c) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Ludo World Heuristic 4: collideChessBefore (Pursuit Positioning)
 * Checks if moving to `targetPos` places us 1..6 cells behind an opponent token on an unsafe tile.
 */
export function isPursuitPosition(
    targetPos: number,
    color: PlayerColor,
    positions: Record<PlayerColor, number[]>,
    colorCorner: ColorCorner,
    playerCount: string
): boolean {
    if (targetPos < 0 || targetPos >= HOME_LANE_START_INDEX) return false;
    const oppColors: PlayerColor[] = (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).filter(
        c => c !== color && (playerCount !== '2v2' || c !== getTeammateColor(color, playerCount))
    );

    for (let futureRoll = 1; futureRoll <= DICE_MAX; futureRoll++) {
        const futurePos = calculateNextPosition(targetPos, futureRoll, color, colorCorner);
        if (futurePos === targetPos || futurePos >= HOME_LANE_START_INDEX) continue;
        const futurePt = getBoardCoordinate(futurePos, color, colorCorner);
        if (!futurePt) continue;
        if (GLOBAL_SAFE_POINTS.some((p: Point) => p.r === futurePt.r && p.c === futurePt.c)) continue;

        for (const oppColor of oppColors) {
            for (const oppPos of positions[oppColor] || []) {
                if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) continue;
                const oppPt = getBoardCoordinate(oppPos, oppColor, colorCorner);
                if (oppPt && oppPt.r === futurePt.r && oppPt.c === futurePt.c) {
                    return true;
                }
            }
        }
    }
    return false;
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

    // Reach Finish Zone (+1500) - The ultimate objective
    if (nextPos === BOARD_FINISH_INDEX) {
        score += AI_SCORES.REACH_FINISH;
    }

    // Enter Home Lane (Promotion to Queen: +150, Enter safe lane: +25)
    if (nextPos >= HOME_LANE_START_INDEX && currentPos < HOME_LANE_START_INDEX) {
        score += AI_SCORES.ENTER_HOME_LANE + AI_SCORES.PROMOTION;
    }

    // Move out of Home (+80) - Getting a new piece on the board
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

    // Capturing / Safe Zones Logic (Ludo World 5-Stage Cascade)
    const isSafeSquare = targetPoint ? GLOBAL_SAFE_POINTS.some(p => p.r === targetPoint.r && p.c === targetPoint.c) : false;

    if (nextPos < HOME_LANE_START_INDEX && targetPoint) {
        // ENG-08: force comparison through engine math on the RESOLVED board
        // (post-move positions), not a pre-move local reimplementation. The
        // capture verdict itself comes from checkMultiCapture below, which
        // takes the pre-move state and accounts for the mover internally.
        const moved = {
            ...positions,
            [actingColor]: positions[actingColor].map((p, i) => i === tokenIdx ? nextPos : p),
        };
        const movedState = {
            ...(state || {}),
            positions: moved,
            activeShields: state?.activeShields || [],
            activeTraps: state?.activeTraps || [],
        } as GameState;
        const teamId = getTeam(actingColor, playerCount);
        const actingForce = getTeamForceAtPoint(teamId, nextPos, movedState, playerCount);

        // Check if any opponent has tokens here and compare forces
        let maxOppForce = 0;
        (['green', 'red', 'blue', 'yellow'] as const).forEach(color => {
            const otherTeam = getTeam(color, playerCount);
            if (otherTeam !== teamId) {
                const force = getTeamForceAtPoint(otherTeam, nextPos, movedState, playerCount);
                if (force > maxOppForce) maxOppForce = force;
            }
        });

        if (actingForce > 1 && actingForce > maxOppForce) {
            score += AI_SCORES.REINFORCE_ALLY;
        } else if (maxOppForce > 0 && actingForce < maxOppForce) {
            score += 30; // Truce state - relatively safe
        }

        // Stage 1: eatChess (Capture Priority: +1000 per token × difficulty weight)
        const dummyState = state || { positions, activeShields: [], activeTraps: [] } as any;
        const captures = checkMultiCapture(actingColor, nextPos, dummyState, colorCorner, playerCount);
        if (captures.length > 0) {
            score += captures.length * AI_SCORES.CAPTURE_TOKEN * DIFFICULTY_PARAMS[difficulty].capture;
        }
    }

    // Stage 2: collideChessBack (Threat Avoidance: +600)
    // If currently threatened on the track and next move evades to safety or out of reach
    if (currentPos >= 0 && currentPos < HOME_LANE_START_INDEX) {
        const currentlyThreatened = isThreatenedAtPosition(currentPos, actingColor, positions, colorCorner, playerCount);
        if (currentlyThreatened) {
            const nextThreatened = nextPos < HOME_LANE_START_INDEX && !isSafeSquare
                ? isThreatenedAtPosition(nextPos, actingColor, positions, colorCorner, playerCount)
                : false;
            if (!nextThreatened) {
                score += AI_SCORES.THREAT_AVOIDANCE * DIFFICULTY_PARAMS[difficulty].capture;
            }
        }
    }

    // Stage 3: missGrid (Safe-Star Seeking: +400)
    if (isSafeSquare || (nextPos >= HOME_LANE_START_INDEX && currentPos < HOME_LANE_START_INDEX)) {
        score += AI_SCORES.ENTER_SAFE_ZONE;
    }

    // Stage 4: collideChessBefore (Pursuit Positioning: +250)
    if (nextPos < HOME_LANE_START_INDEX && isPursuitPosition(nextPos, actingColor, positions, colorCorner, playerCount)) {
        score += AI_SCORES.PURSUIT_POSITION;
    }

    // Stage 5: getBestMoveIndex (Endgame Push)
    // Advance token furthest along path (highest travel distance)
    score += travelDistance(nextPos, actingColor, colorCorner) * AI_SCORES.PROGRESSION_MULTIPLIER;

    // Rookie noise: misjudges positions by up to ±40%.
    const noise = DIFFICULTY_PARAMS[difficulty].noise;
    if (noise > 0 && score !== 0) {
        score *= 1 + (Math.random() * 2 - 1) * noise;
    }

    return score;
}

/**
 * ENG-18: Boost spend condition (ENGINE_LOGIC.md §5.4 — "accelerate finishing
 * or clear dangerous zones"). Spending is gated, never automatic:
 * - a token within 12 cells of home (boost's +6 meaningfully finishes), or
 * - a token on a non-safe shared square with an opponent ≤6 behind it.
 */
function shouldSpendBoost(
    state: GameState,
    color: PlayerColor,
    cc: ColorCorner,
    playerCount: string,
): boolean {
    const mine = state.positions[color] || [];
    for (const pos of mine) {
        if (pos < 0 || pos >= HOME_LANE_START_INDEX) continue;
        if (56 - travelDistance(pos, color, cc) <= 12) return true;
        const pt = getBoardCoordinate(pos, color, cc);
        if (!pt) continue;
        if (GLOBAL_SAFE_POINTS.some(p => p.r === pt.r && p.c === pt.c)) continue;
        for (const opp of ['green', 'red', 'yellow', 'blue'] as PlayerColor[]) {
            if (opp === color) continue;
            if (playerCount === '2v2' && opp === getTeammateColor(color, playerCount)) continue;
            for (const oppPos of state.positions[opp] || []) {
                if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) continue;
                const behind = (((pos - oppPos) % TOTAL_PATH_CELLS) + TOTAL_PATH_CELLS) % TOTAL_PATH_CELLS;
                if (behind >= 1 && behind <= DICE_MAX) return true;
            }
        }
    }
    return false;
}

export function getBestPowerUsage(    state: GameState,
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
    // ENG-18: Boost only on the condition above — never unconditionally.
    if (held('boost') && shouldSpendBoost(state, color, colorCorner, playerCount)) {
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
