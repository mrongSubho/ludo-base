import {
    BASE_INDEX,
    BOARD_FINISH_INDEX,
    HOME_LANE_START_INDEX,
    TEAM_ID,
} from '@/lib/constants';
import {
    ColorCorner,
    CORNER_SLOTS,
    getBoardCoordinate,
    SAFE_POSITIONS,
    type Point,
} from '@/lib/boardLayout';
import { seatedColorsFor } from '@/lib/engine/core';
import { getIntermediatePathCoords, getTeammateColor } from '@/lib/gameLogic';
import { computeHopCadence, DEPLOY_ANIMATION_MS } from '@/lib/tokenMovement';
import type { DiceThemeId } from '@/lib/diceVisuals';
import type { GameState, PlayerColor, PowerType } from '@/lib/types';
import type { MusicScene, SoundId, SoundPlayOptions } from './types';

export interface QueuedSoundEvent {
    id: SoundId;
    opts?: SoundPlayOptions;
    /** Optional millisecond offset so impact/landing SFX fire at physical touchdown rather than t = 0. */
    delayMs?: number;
}

export interface BoardAudioContext {
    myColor?: PlayerColor;
    playerCount: '1v1' | '4P' | '2v2';
    colorCorner: ColorCorner;
    spectatorMode?: boolean;
    botColors?: ReadonlySet<PlayerColor>;
    themeId?: DiceThemeId;
    reducedMotion?: boolean;
}

export interface TransitionLandingDelays {
    maxMoverWalkMs: number;
    captureDelayMs: number;
    finishDelayMs: number;
    safeStarDelayMs: number;
    homeLaneDelayMs: number;
    stackDelayMs: number;
}

/**
 * Compute per-outcome landing timestamps matching BoardTokens/TokenPiece GSAP
 * kinematics so audio & screen shake align with physical touchdown.
 */
export function computeTransitionLandingDelays(
    prev: GameState,
    next: GameState,
    colorCorner: ColorCorner,
    themeId: DiceThemeId = '3077',
    reducedMotion = false,
): TransitionLandingDelays {
    if (reducedMotion) {
        return {
            maxMoverWalkMs: 0,
            captureDelayMs: 0,
            finishDelayMs: 0,
            safeStarDelayMs: 0,
            homeLaneDelayMs: 0,
            stackDelayMs: 0,
        };
    }

    const msg = next.captureMessage || '';
    const isTeleport = msg !== prev.captureMessage && /TELEPORT!/i.test(msg);
    const isNuke =
        (next.nukeFlash?.length ?? 0) > 0 &&
        ((prev.nukeFlash?.length ?? 0) === 0 || msg !== prev.captureMessage);
    const isBoosted = Boolean(next.boostTrail || next.activeBoost || next.boostPendingDice != null);

    const moverLandings: { pt: Point | null; walkMs: number }[] = [];
    let maxMoverWalkMs = 0;
    let finishDelayMs = 0;
    let safeStarDelayMs = 0;
    let homeLaneDelayMs = 0;
    let stackDelayMs = 0;

    for (const color of ['green', 'red', 'yellow', 'blue'] as const) {
        const pArr = prev.positions?.[color] ?? [];
        const nArr = next.positions?.[color] ?? [];
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const p = Number(pArr[i]);
            const n = Number(nArr[i]);
            if (p === n || n === BASE_INDEX || n < 0) continue;

            let walkMs = 0;
            if (p === BASE_INDEX && n >= 0 && n < BOARD_FINISH_INDEX) {
                walkMs = DEPLOY_ANIMATION_MS;
            } else if (p >= 0 && p < BOARD_FINISH_INDEX && n <= BOARD_FINISH_INDEX) {
                const waypoints = isTeleport ? [] : getIntermediatePathCoords(p, n, color, colorCorner);
                const cadence = computeHopCadence(Math.max(1, waypoints.length), isBoosted, themeId);
                walkMs = isTeleport ? 560 : cadence.totalWalkMs;
            }

            const destPt = getBoardCoordinate(n, color, colorCorner);
            moverLandings.push({ pt: destPt, walkMs });
            maxMoverWalkMs = Math.max(maxMoverWalkMs, walkMs);

            if (n === BOARD_FINISH_INDEX) {
                finishDelayMs = Math.max(finishDelayMs, walkMs);
            } else if (p >= 0 && p < HOME_LANE_START_INDEX && n >= HOME_LANE_START_INDEX) {
                homeLaneDelayMs = Math.max(homeLaneDelayMs, walkMs);
            } else if (p >= 0 && n >= 0 && n < HOME_LANE_START_INDEX) {
                if (destPt && SAFE_POSITIONS.some((s) => s.r === destPt.r && s.c === destPt.c)) {
                    safeStarDelayMs = Math.max(safeStarDelayMs, walkMs);
                }
                stackDelayMs = Math.max(stackDelayMs, walkMs);
            }
        }
    }

    let captureDelayMs = 0;
    for (const color of ['green', 'red', 'yellow', 'blue'] as const) {
        const pArr = prev.positions?.[color] ?? [];
        const nArr = next.positions?.[color] ?? [];
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const p = Number(pArr[i]);
            const n = Number(nArr[i]);
            if (p >= 0 && p < BOARD_FINISH_INDEX && n === BASE_INDEX) {
                const victimPt = getBoardCoordinate(p, color, colorCorner);
                const matchingMover = victimPt
                    ? moverLandings.find((m) => m.pt && m.pt.r === victimPt.r && m.pt.c === victimPt.c)
                    : undefined;
                if (matchingMover) {
                    captureDelayMs = Math.max(captureDelayMs, Math.max(0, matchingMover.walkMs - 30));
                } else if (isNuke) {
                    captureDelayMs = Math.max(captureDelayMs, 880);
                }
            }
        }
    }

    return {
        maxMoverWalkMs,
        captureDelayMs,
        finishDelayMs,
        safeStarDelayMs,
        homeLaneDelayMs,
        stackDelayMs,
    };
}

/**
 * Color-relative steps remaining until BOARD_FINISH_INDEX (57).
 * Base (-1) counts as 57 steps away (needs 6 + full lap + 6 home stretch).
 */
export function stepsRemainingToFinish(
    pos: number,
    color: PlayerColor,
    cc: ColorCorner,
): number {
    if (pos >= BOARD_FINISH_INDEX) return 0;
    if (pos < 0) return BOARD_FINISH_INDEX;
    if (pos >= HOME_LANE_START_INDEX) {
        return Math.max(0, BOARD_FINISH_INDEX - pos);
    }
    const corner = cc[color];
    if (!corner) return BOARD_FINISH_INDEX;
    const startIdx = CORNER_SLOTS[corner].startIdx;
    let dist = pos - startIdx;
    if (dist < 0) dist += 52;
    // Shared index 50 from start -> next step enters 52 -> 57 is 6 steps from 50 (+1 = 51...wait:
    // at dist=50, 1 step enters 52, 6 steps reaches 57; so remaining = 56 - dist).
    return Math.max(1, 56 - dist);
}

/**
 * Computes the adaptive music mood and heartbeat urgency (0..1) from the live board.
 *
 * Enters `match_crunch` when any seated player (3/4 home in 1v1/4P) or team
 * (7/8 home in 2v2) has their final remaining token within 14 cells of Finish (57).
 */
export function computeMatchAudioMood(
    state: GameState,
    playerCount: '1v1' | '4P' | '2v2',
    colorCorner?: ColorCorner,
): { scene: MusicScene; urgency: number } {
    if (state.winner || state.status === 'finished') {
        return { scene: 'result', urgency: 0 };
    }

    const cc = colorCorner ?? state.initialBoardConfig?.colorCorner;
    const seats = seatedColorsFor(playerCount);

    let minRemainingForCrunch = Infinity;
    let totalOnBoard = 0;
    let totalFinished = 0;

    if (playerCount === '2v2') {
        const teams: PlayerColor[][] = [
            ['green', 'blue'],
            ['red', 'yellow'],
        ];
        for (const [a, b] of teams) {
            const posA = state.positions?.[a] ?? [];
            const posB = state.positions?.[b] ?? [];
            const all = [
                ...posA.map((p) => ({ c: a, p: Number(p) })),
                ...posB.map((p) => ({ c: b, p: Number(p) })),
            ];
            const finished = all.filter((x) => x.p === BOARD_FINISH_INDEX);
            const active = all.filter((x) => x.p >= 0 && x.p < BOARD_FINISH_INDEX);
            totalOnBoard += active.length;
            totalFinished += finished.length;

            if (finished.length === 7 && active.length === 1 && cc) {
                const rem = stepsRemainingToFinish(active[0].p, active[0].c, cc);
                if (rem <= 14) {
                    minRemainingForCrunch = Math.min(minRemainingForCrunch, rem);
                }
            }
        }
    } else {
        for (const c of seats) {
            const arr = (state.positions?.[c] ?? []).map((p) => Number(p));
            const finished = arr.filter((p) => p === BOARD_FINISH_INDEX);
            const active = arr.filter((p) => p >= 0 && p < BOARD_FINISH_INDEX);
            totalOnBoard += active.length;
            totalFinished += finished.length;

            if (finished.length === 3 && active.length === 1 && cc) {
                const rem = stepsRemainingToFinish(active[0], c, cc);
                if (rem <= 14) {
                    minRemainingForCrunch = Math.min(minRemainingForCrunch, rem);
                }
            }
        }
    }

    if (Number.isFinite(minRemainingForCrunch)) {
        const baseUrgency = Math.max(0.15, Math.min(1, (15 - minRemainingForCrunch) / 14));
        const rollingBoost = state.isRolling ? 0.2 : 0;
        return {
            scene: 'match_crunch',
            urgency: Math.min(1, baseUrgency + rollingBoost),
        };
    }

    const kicks = Object.values(state.matchStats ?? {}).reduce((acc, s) => acc + (s?.kicks ?? 0), 0);
    if (kicks > 0 || totalFinished > 0 || totalOnBoard >= seats.length * 2) {
        return { scene: 'match_heat', urgency: 0 };
    }

    return { scene: 'match_calm', urgency: 0 };
}

export function emoteSoundIdFor(emoteId: string, assetUrl?: string): SoundId {
    const key = `${emoteId} ${assetUrl ?? ''}`.toLowerCase();
    if (key.includes('glitch')) return 'emote_glitch';
    if (key.includes('overheat')) return 'emote_overheat';
    if (key.includes('laser')) return 'emote_laser';
    if (key.includes('smug')) return 'emote_smug';
    if (key.includes('bounce')) return 'emote_bounce';
    if (key.includes('blue-screen') || key.includes('crash')) return 'emote_crash';
    if (key.includes('diamond')) return 'emote_diamond';
    if (key.includes('wave') || key.includes('sonar')) return 'emote_sonar';
    return 'emote_preset';
}

function didMySideWin(
    winner: string,
    winners: string[],
    myColor: PlayerColor | undefined,
    playerCount: '1v1' | '4P' | '2v2',
): 'victory' | 'runnerup' | 'defeat' {
    if (!myColor) return 'victory'; // Spectator neutral fanfare
    if (playerCount === '2v2' || winner.startsWith('Team ')) {
        const myTeam = TEAM_ID[myColor];
        return winner.includes(String(myTeam)) || winners.includes(myColor) ? 'victory' : 'defeat';
    }
    if (winner === myColor) return 'victory';
    if (winners.includes(myColor)) return 'runnerup';
    return 'defeat';
}

export function diffGameStateForAudio(
    prev: GameState | null,
    next: GameState,
    ctx: BoardAudioContext,
): QueuedSoundEvent[] {
    if (!prev) return [];
    const events: QueuedSoundEvent[] = [];
    const seats = seatedColorsFor(ctx.playerCount);
    const myColor = ctx.myColor;
    const myTeammate = myColor ? getTeammateColor(myColor, ctx.playerCount) : null;
    const delays = computeTransitionLandingDelays(
        prev,
        next,
        ctx.colorCorner,
        ctx.themeId ?? '3077',
        Boolean(ctx.reducedMotion),
    );
    const withDelay = (delayMs: number): { delayMs?: number } =>
        delayMs > 0 ? { delayMs } : {};

    // 1. Dice six & three-sixes bust
    const sixSettled =
        next.diceValue === 6 &&
        ((prev.isRolling && !next.isRolling) || prev.diceValue !== 6);
    if (sixSettled) {
        events.push({
            id: 'dice_six',
            opts: { streak: Math.max(1, next.consecutiveSixes || 1) },
        });
    }

    const bustByMsg =
        Boolean(next.captureMessage && next.captureMessage !== prev.captureMessage && /three\s*(6|six)/i.test(next.captureMessage));
    const bustByStreak =
        prev.consecutiveSixes >= 2 &&
        next.consecutiveSixes === 0 &&
        next.currentPlayer !== prev.currentPlayer &&
        prev.gamePhase === 'rolling';
    if (bustByMsg || bustByStreak) {
        events.push({ id: 'dice_three_sixes_bust' });
    }

    // 2. Token movements: capture (kick vs got kicked), finish home, home lane, safe star, stack reinforce
    let capturedOpponent = false;
    let iGotKicked = false;
    let teammateGotKicked = false;
    let finishedCountForMover = 0;
    let enteredHomeLane = false;
    let landedSafeStar = false;
    let stackedWithAlly = false;

    for (const color of seats) {
        const pArr = prev.positions?.[color] ?? [];
        const nArr = next.positions?.[color] ?? [];
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const p = Number(pArr[i]);
            const n = Number(nArr[i]);
            if (p === n) continue;

            // Sent back to base (captured / nuked / trapped)
            if (p >= 0 && p < BOARD_FINISH_INDEX && n === BASE_INDEX) {
                if (myColor && color === myColor) {
                    iGotKicked = true;
                } else if (myTeammate && color === myTeammate) {
                    teammateGotKicked = true;
                } else {
                    capturedOpponent = true;
                }
                continue;
            }

            // Reached finish (57)
            if (p < BOARD_FINISH_INDEX && n === BOARD_FINISH_INDEX) {
                finishedCountForMover = Math.max(
                    finishedCountForMover,
                    nArr.filter((v) => Number(v) === BOARD_FINISH_INDEX).length,
                );
                continue;
            }

            // Crossed into private home lane (52..56)
            if (p >= 0 && p < HOME_LANE_START_INDEX && n >= HOME_LANE_START_INDEX && n < BOARD_FINISH_INDEX) {
                enteredHomeLane = true;
            }

            // Safe star landing (guard p >= 0 so deploy onto start star does not double-fire)
            // and ally stack reinforcement on shared track (0..51)
            if (n >= 0 && n < HOME_LANE_START_INDEX) {
                if (p >= 0) {
                    const pt = getBoardCoordinate(n, color, ctx.colorCorner);
                    if (pt && SAFE_POSITIONS.some((s) => s.r === pt.r && s.c === pt.c)) {
                        landedSafeStar = true;
                    }
                }
                // Check ally stacking on same cell
                const allyColors = [color];
                const mate = getTeammateColor(color, ctx.playerCount);
                if (mate) allyColors.push(mate);
                let alliesOnSquare = 0;
                for (const ac of allyColors) {
                    const aArr = next.positions?.[ac] ?? [];
                    for (let j = 0; j < aArr.length; j++) {
                        if (ac === color && j === i) continue;
                        if (Number(aArr[j]) === n) alliesOnSquare++;
                    }
                }
                if (alliesOnSquare > 0) stackedWithAlly = true;
            }
        }
    }

    if (iGotKicked) events.push({ id: 'capture_got_kicked', ...withDelay(delays.captureDelayMs) });
    else if (teammateGotKicked) events.push({ id: 'capture_teammate_kicked', ...withDelay(delays.captureDelayMs) });
    else if (capturedOpponent) events.push({ id: 'capture_kick', ...withDelay(delays.captureDelayMs) });

    if (finishedCountForMover > 0) {
        events.push({ id: 'token_finish_home', opts: { finishCount: finishedCountForMover }, ...withDelay(delays.finishDelayMs) });
    } else if (enteredHomeLane) {
        events.push({ id: 'token_home_lane', ...withDelay(delays.homeLaneDelayMs) });
    } else if (landedSafeStar) {
        events.push({ id: 'token_safe_star', ...withDelay(delays.safeStarDelayMs) });
    } else if (stackedWithAlly) {
        events.push({ id: 'token_stack_force', ...withDelay(delays.stackDelayMs) });
    }

    // 2v2 Teammate Assist unlock: myColor just finished its 4th token and partner still has unfinished tokens
    if (ctx.playerCount === '2v2' && myColor && myTeammate) {
        const wasDone = (prev.positions?.[myColor] ?? []).every((p) => Number(p) === BOARD_FINISH_INDEX);
        const nowDone = (next.positions?.[myColor] ?? []).every((p) => Number(p) === BOARD_FINISH_INDEX);
        const mateHasLeft = (next.positions?.[myTeammate] ?? []).some((p) => Number(p) < BOARD_FINISH_INDEX);
        if (!wasDone && nowDone && mateHasLeft) {
            events.push({ id: 'turn_teammate_assist' });
        }
    }

    // 3. Power v3 events (pickup, activation, expiry)
    let pickedPower: PowerType | undefined;
    let lostPowerUnspent = false;
    for (const c of seats) {
        const pHand = prev.playerPowers?.[c] ?? [];
        const nHand = next.playerPowers?.[c] ?? [];
        if (nHand.length > pHand.length) {
            const added = nHand[nHand.length - 1];
            pickedPower = added?.type ?? pickedPower ?? 'boost';
        } else if (nHand.length < pHand.length && !next.powerSpentThisTurn && myColor === c) {
            lostPowerUnspent = true;
        }
    }
    if (pickedPower) {
        events.push({ id: 'power_pickup', opts: { rarity: pickedPower }, ...withDelay(delays.maxMoverWalkMs) });
    } else if (lostPowerUnspent) {
        events.push({ id: 'power_expired' });
    }

    const nukeTriggered = (next.nukeFlash?.length ?? 0) > 0 && (prev.nukeFlash?.length ?? 0) === 0;
    const shieldTriggered = (next.activeShields?.length ?? 0) > (prev.activeShields?.length ?? 0);
    const boostTriggered = Boolean(next.activeBoost && next.activeBoost !== prev.activeBoost);
    const teleportTriggered = Boolean(
        next.captureMessage &&
            next.captureMessage !== prev.captureMessage &&
            /TELEPORT!/i.test(next.captureMessage),
    );
    if (nukeTriggered) events.push({ id: 'power_nuke' });
    if (shieldTriggered) events.push({ id: 'power_shield' });
    if (boostTriggered) events.push({ id: 'power_boost' });
    if (teleportTriggered) events.push({ id: 'power_teleport' });

    // 4. Turn change & no-valid-move fast pass
    if (!next.winner && prev.currentPlayer !== next.currentPlayer && next.gamePhase === 'rolling') {
        if (prev.gamePhase === 'moving' && prev.diceValue !== null && !capturedOpponent && !iGotKicked) {
            // Turned over directly from moving without moving a token -> no-moves fast pass
            const prevMoved = seats.some((c) =>
                (prev.positions?.[c] ?? []).some((v, idx) => Number(v) !== Number(next.positions?.[c]?.[idx])),
            );
            if (!prevMoved) {
                events.push({ id: 'dice_toss_pass' });
            }
        }
        const nextIsBot = ctx.botColors?.has(next.currentPlayer) || next.afkStats?.[next.currentPlayer]?.isKicked;
        if (myColor && next.currentPlayer === myColor && !ctx.spectatorMode && !nextIsBot) {
            events.push({ id: 'turn_mine' });
        } else {
            events.push({ id: 'turn_other' });
        }
    }

    // 5. Timer urgent ticks (5s -> 1s on my interactive turn)
    if (
        !next.winner &&
        !next.isRolling &&
        !next.idleWarning &&
        !ctx.spectatorMode &&
        myColor &&
        next.currentPlayer === myColor &&
        next.timeLeft < prev.timeLeft &&
        next.timeLeft >= 1 &&
        next.timeLeft <= 5
    ) {
        events.push({ id: 'timer_urgent', opts: { urgentLevel: next.timeLeft } });
    }

    // 6. Dual-Tier AFK transitions (viewer seat ONLY — opponents are stealth-masked)
    if (!ctx.spectatorMode && myColor) {
        const prevAfk = prev.afkStats?.[myColor];
        const nextAfk = next.afkStats?.[myColor];
        const wasLocked = Boolean(prevAfk?.isKicked || prevAfk?.mode === 'kicked_smart_bot' || prevAfk?.mode === 'left_forfeited');
        const isLocked = Boolean(nextAfk?.isKicked || nextAfk?.mode === 'kicked_smart_bot' || nextAfk?.mode === 'left_forfeited');
        const wasTier1 = Boolean(!wasLocked && (prevAfk?.isAutoPlaying || prevAfk?.mode === 'afk_random_bot'));
        const isTier1 = Boolean(!isLocked && (nextAfk?.isAutoPlaying || nextAfk?.mode === 'afk_random_bot'));

        if (isLocked && !wasLocked) {
            events.push({ id: 'afk_kicked' });
        } else if (isTier1 && !wasTier1) {
            events.push({ id: 'afk_strike' });
        }
    }

    // 7. Match Winner
    if (next.winner && !prev.winner) {
        const outcome = didMySideWin(next.winner, next.winners ?? [], ctx.spectatorMode ? undefined : myColor, ctx.playerCount);
        if (outcome === 'victory') events.push({ id: 'match_victory', ...withDelay(delays.maxMoverWalkMs) });
        else if (outcome === 'runnerup') events.push({ id: 'match_runnerup', ...withDelay(delays.maxMoverWalkMs) });
        else events.push({ id: 'match_defeat', ...withDelay(delays.maxMoverWalkMs) });
    }

    return events;
}
