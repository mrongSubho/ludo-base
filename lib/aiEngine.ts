/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import type { PlayerColor, PowerType, GameState } from './types';
import { checkMultiCapture, getTeamForceAtPoint, getTeam, getTeammateColor, calculateNextPosition, getLegalTokenIndices } from './gameLogic';
import { countNukeVictims as countNukeVictimsCore, nearestStarAhead, resolveControllableColor, type EngineGameState } from './engine/core';
import { Point, ColorCorner, getBoardCoordinate, CORNER_SLOTS, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from './boardLayout';
import {
    BOARD_FINISH_INDEX,
    HOME_LANE_START_INDEX,
    BASE_INDEX,
    TOTAL_PATH_CELLS,
    AI_SCORES,
    DICE_MAX,
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
    playerCount: string,
    state?: GameState,
    tokenIdx?: number
): boolean {
    if (pos < 0 || pos >= HOME_LANE_START_INDEX) return false;
    if (state && tokenIdx !== undefined && (state.activeShields || []).some(s => s.color === color && s.tokenIdx === tokenIdx)) {
        return false;
    }
    const myPoint = getBoardCoordinate(pos, color, colorCorner);
    if (!myPoint) return false;
    // Safe squares are immune to capture
    if (GLOBAL_SAFE_POINTS.some((p: Point) => p.r === myPoint.r && p.c === myPoint.c)) return false;

    const evalState = state
        ? ({ ...state, positions } as GameState)
        : ({ positions, activeShields: [], activeTraps: [] } as unknown as GameState);
    const myTeam = getTeam(color, playerCount);
    const myForce = Math.max(1, getTeamForceAtPoint(myTeam, pos, evalState, playerCount));

    const oppColors: PlayerColor[] = (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).filter(
        c => c !== color && (playerCount !== '2v2' || c !== getTeammateColor(color, playerCount))
    );

    for (const oppColor of oppColors) {
        const oppTeam = getTeam(oppColor, playerCount);
        const oppTokens = positions[oppColor] || [];
        for (let oppIdx = 0; oppIdx < oppTokens.length; oppIdx++) {
            const oppPos = oppTokens[oppIdx];
            if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) continue;
            for (let roll = 1; roll <= DICE_MAX; roll++) {
                const nextOppPos = calculateNextPosition(oppPos, roll, oppColor, colorCorner);
                if (nextOppPos === oppPos || nextOppPos >= HOME_LANE_START_INDEX) continue;
                const oppPt = getBoardCoordinate(nextOppPos, oppColor, colorCorner);
                if (oppPt && oppPt.r === myPoint.r && oppPt.c === myPoint.c) {
                    const oppLandingForce = 1 + getTeamForceAtPoint(oppTeam, nextOppPos, evalState, playerCount);
                    if (oppLandingForce >= myForce) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

/**
 * Ludo World Heuristic 4: collideChessBefore (Pursuit Positioning)
 * Checks if moving to `targetPos` places us 1..6 cells behind a capturable opponent token on an unsafe tile.
 */
export function isPursuitPosition(
    targetPos: number,
    color: PlayerColor,
    positions: Record<PlayerColor, number[]>,
    colorCorner: ColorCorner,
    playerCount: string,
    state?: GameState
): boolean {
    if (targetPos < 0 || targetPos >= HOME_LANE_START_INDEX) return false;
    const evalState = state
        ? ({ ...state, positions } as GameState)
        : ({ positions, activeShields: [], activeTraps: [] } as unknown as GameState);
    const myTeam = getTeam(color, playerCount);
    const oppColors: PlayerColor[] = (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).filter(
        c => c !== color && (playerCount !== '2v2' || c !== getTeammateColor(color, playerCount))
    );

    for (let futureRoll = 1; futureRoll <= DICE_MAX; futureRoll++) {
        const futurePos = calculateNextPosition(targetPos, futureRoll, color, colorCorner);
        if (futurePos === targetPos || futurePos >= HOME_LANE_START_INDEX) continue;
        const futurePt = getBoardCoordinate(futurePos, color, colorCorner);
        if (!futurePt) continue;
        if (GLOBAL_SAFE_POINTS.some((p: Point) => p.r === futurePt.r && p.c === futurePt.c)) continue;

        const myLandingForce = 1 + getTeamForceAtPoint(myTeam, futurePos, evalState, playerCount);

        for (const oppColor of oppColors) {
            const oppTeam = getTeam(oppColor, playerCount);
            const oppForce = getTeamForceAtPoint(oppTeam, futurePos, evalState, playerCount);
            const oppTokens = positions[oppColor] || [];
            for (let oppIdx = 0; oppIdx < oppTokens.length; oppIdx++) {
                const oppPos = oppTokens[oppIdx];
                if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) continue;
                const oppPt = getBoardCoordinate(oppPos, oppColor, colorCorner);
                if (oppPt && oppPt.r === futurePt.r && oppPt.c === futurePt.c) {
                    if (state) {
                        const oppShielded = (state.activeShields || []).some(
                            s => s.color === oppColor && s.tokenIdx === oppIdx
                        );
                        if (oppShielded) continue;
                        if (oppForce > myLandingForce) continue;
                    }
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

    let captureCount = 0;

    if (nextPos < HOME_LANE_START_INDEX && targetPoint) {
        const teamId = getTeam(actingColor, playerCount);

        // Enemy trap hazard avoidance
        const hasEnemyTrap = (state?.activeTraps || []).some(
            t => t.r === targetPoint.r && t.c === targetPoint.c &&
                t.owner !== actingColor &&
                (playerCount !== '2v2' || getTeam(t.owner, playerCount) !== teamId)
        );
        if (hasEnemyTrap) {
            score += AI_SCORES.AVOID_TRAP;
        }

        // ENG-08: force comparison through engine math on the RESOLVED board
        // (post-move positions), not a pre-move local reimplementation. The
        // capture verdict itself comes from checkMultiCapture below, which
        // takes the pre-move state and accounts for the mover internally.
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
            captureCount = captures.length;
            score += captureCount * AI_SCORES.CAPTURE_TOKEN * DIFFICULTY_PARAMS[difficulty].capture;
        }
    }

    // Penalize splitting a 2-token protective stack on an unsafe tile (unless capturing or reaching safety/finish)
    if (state && currentPos >= 0 && currentPos < HOME_LANE_START_INDEX) {
        const curPoint = getBoardCoordinate(currentPos, actingColor, colorCorner);
        const curSafe = curPoint ? GLOBAL_SAFE_POINTS.some(p => p.r === curPoint.r && p.c === curPoint.c) : false;
        if (!curSafe && captureCount === 0 && nextPos !== BOARD_FINISH_INDEX && !(nextPos >= HOME_LANE_START_INDEX)) {
            const teamId = getTeam(actingColor, playerCount);
            const preForce = getTeamForceAtPoint(teamId, currentPos, state, playerCount);
            if (preForce === 2) {
                score += AI_SCORES.BREAK_PROTECTIVE_STACK;
            }
        }
    }

    // Stage 2: collideChessBack (Threat Avoidance: +600)
    // If currently threatened on the track and next move evades to safety or out of reach
    if (currentPos >= 0 && currentPos < HOME_LANE_START_INDEX) {
        const currentlyThreatened = isThreatenedAtPosition(currentPos, actingColor, positions, colorCorner, playerCount, state, tokenIdx);
        if (currentlyThreatened) {
            const nextThreatened = nextPos < HOME_LANE_START_INDEX && !isSafeSquare
                ? isThreatenedAtPosition(nextPos, actingColor, moved, colorCorner, playerCount, movedState, tokenIdx)
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
    if (nextPos < HOME_LANE_START_INDEX && isPursuitPosition(nextPos, actingColor, moved, colorCorner, playerCount, movedState)) {
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
    // Stuck in yard with all remaining tokens at BASE_INDEX: Boost grants a split 6 deploy.
    if (mine.some(p => p === BASE_INDEX) && mine.every(p => p === BASE_INDEX || p === BOARD_FINISH_INDEX)) {
        return true;
    }
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

function bestTeleportTarget(
    state: GameState,
    color: PlayerColor,
    colorCorner: ColorCorner,
    playerCount: string,
): { tokenIdx: number } | null {
    const tokens = state.positions[color] || [];
    let bestIdx: number | null = null;
    let bestScore = -Infinity;

    for (let idx = 0; idx < tokens.length; idx++) {
        const from = tokens[idx];
        if (from === BASE_INDEX || from >= BOARD_FINISH_INDEX || from < 0) continue;

        let dest = -1;
        if (from >= HOME_LANE_START_INDEX && from <= 56) {
            dest = BOARD_FINISH_INDEX;
        } else {
            const dist = travelDistance(from, color, colorCorner);
            dest = dist >= 48 ? BOARD_FINISH_INDEX : nearestStarAhead(from, color, colorCorner);
        }
        if (dest < 0) continue;

        let score = 0;
        if (dest === BOARD_FINISH_INDEX) {
            score += 2000 + travelDistance(from, color, colorCorner);
        } else {
            const jumpDist = (dest - from + TOTAL_PATH_CELLS) % TOTAL_PATH_CELLS;
            score += jumpDist * 10 + travelDistance(from, color, colorCorner);
            if (isThreatenedAtPosition(from, color, state.positions, colorCorner, playerCount, state, idx)) {
                score += 500;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
        }
    }

    return bestIdx !== null ? { tokenIdx: bestIdx } : null;
}

export function getBestPowerUsage(
    state: GameState,
    color: PlayerColor,
    colorCorner: ColorCorner,
    playerCount: string,
    difficulty: BotDifficulty = 'pro'
): { type: PowerType; tokenIdx?: number } | null {
    if (state.powerSpentThisTurn) return null;
    // Rookie sits on powers, never spending them.
    if (!DIFFICULTY_PARAMS[difficulty].usesPowers) return null;
    const targetColor = resolveControllableColor(state.positions, color, playerCount);
    const held = (t: PowerType) => (state.playerPowers[color] || []).some(p => p.type === t);
    if (!held('nuke') && !held('shield') && !held('boost') && !held('teleport')) return null;

    // Nuke targets the caster's own on-board tokens (applyPower enforces state.positions[color]).
    if (held('nuke')) {
        const best = bestNukeTarget(state, color, colorCorner, playerCount);
        if (best) return { type: 'nuke', tokenIdx: best.tokenIdx };
    }
    if (held('shield') && checkShieldNeed(state, color, colorCorner, playerCount)) {
        return { type: 'shield' };
    }
    // ENG-18: Boost only on strategic condition (or all remaining tokens stuck in yard).
    if (held('boost') && shouldSpendBoost(state, targetColor, colorCorner, playerCount)) {
        return { type: 'boost' };
    }
    if (held('teleport')) {
        const best = bestTeleportTarget(state, color, colorCorner, playerCount);
        if (best) return { type: 'teleport', tokenIdx: best.tokenIdx };
    }

    return null;
}

// Victims within circular ±NUKE_RADIUS of an own token (safe stars, shields, and ≥2-token stacks/teammates protected).
export function countNukeVictims(
    state: GameState, color: PlayerColor, tokenIdx: number,
    colorCorner: ColorCorner, playerCount: string
): { victims: { color: PlayerColor, idx: number }[], cells: { r: number, c: number }[] } {
    return countNukeVictimsCore(state as unknown as EngineGameState, color, tokenIdx, colorCorner, playerCount);
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
    const shieldedSet = new Set(
        (state.activeShields || []).filter(s => s.color === color).map(s => s.tokenIdx)
    );
    const myTeam = getTeam(color, playerCount);
    const myTokens = state.positions[color] || [];
    for (let idx = 0; idx < myTokens.length; idx++) {
        const myPos = myTokens[idx];
        if (myPos < 0 || myPos >= HOME_LANE_START_INDEX) continue;
        if (shieldedSet.has(idx)) continue;
        const myPoint = getBoardCoordinate(myPos, color, colorCorner);
        if (!myPoint) continue;
        if (GLOBAL_SAFE_POINTS.some((p: Point) => p.r === myPoint.r && p.c === myPoint.c)) continue;

        const myForce = Math.max(1, getTeamForceAtPoint(myTeam, myPos, state, playerCount));

        for (const oppColor of ['green', 'red', 'blue', 'yellow'] as PlayerColor[]) {
            if (oppColor === color) continue;
            if (playerCount === '2v2' && oppColor === getTeammateColor(color, playerCount)) continue;
            const oppTeam = getTeam(oppColor, playerCount);
            for (const oppPos of state.positions[oppColor] || []) {
                if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) continue;
                for (let s = 1; s <= DICE_MAX; s++) {
                    const checkPos = calculateNextPosition(oppPos, s, oppColor, colorCorner);
                    if (checkPos === oppPos || checkPos >= HOME_LANE_START_INDEX) continue;
                    const checkPt = getBoardCoordinate(checkPos, oppColor, colorCorner);
                    if (checkPt && checkPt.r === myPoint.r && checkPt.c === myPoint.c) {
                        const oppLandingForce = 1 + getTeamForceAtPoint(oppTeam, checkPos, state, playerCount);
                        if (oppLandingForce >= myForce) return true;
                    }
                }
            }
        }
    }
    return false;
}
