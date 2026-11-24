import { BASE_INDEX, BOARD_FINISH_INDEX } from '@/lib/constants';
import { getTeammateColor } from '@/lib/gameLogic';
import { seatedColorsFor } from '@/lib/engine/core';
import type { GameState, PlayerColor, PowerType } from '@/lib/types';
import type { ColorCorner } from '@/lib/boardLayout';

export type FeedTone =
    | 'neutral'
    | 'yours'
    | 'capture'
    | 'nuke'
    | 'shield'
    | 'boost'
    | 'teleport'
    | 'finish'
    | 'bust';

export interface PrimaryTurnLine {
    text: string;
    tone: 'yours' | 'opponent' | 'spectator' | 'target' | 'winner';
    color?: PlayerColor;
}

export interface CombatFeedLine {
    id: number;
    text: string;
    tone: FeedTone;
}

/** Deduplicate colors while preserving order and join cleanly (`GREEN`, `GREEN & BLUE`, `GREEN, BLUE & YELLOW`). */
export function formatColorList(colors: PlayerColor[]): string {
    const unique: PlayerColor[] = [];
    for (const c of colors) {
        if (!unique.includes(c)) unique.push(c);
    }
    const labels = unique.map((c) => c.toUpperCase());
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

/** Line 1: persistent turn & action directive shown cleanly above the board. */
export function formatPrimaryTurnLine(input: {
    currentPlayer: PlayerColor;
    gamePhase: string;
    diceValue: number | null;
    myColor?: PlayerColor;
    spectatorMode: boolean;
    targeting: PowerType | null;
    activeBoost: PlayerColor | null | undefined;
    boostPendingDice?: number | null;
    winner: string | null;
    myTokensInHome: number;
    effectiveMyDice: number | null;
}): PrimaryTurnLine {
    if (input.winner) {
        return {
            text: `MATCH OVER · ${String(input.winner).toUpperCase()} WINS`,
            tone: 'winner',
        };
    }

    if (input.spectatorMode) {
        return {
            text: `WATCHING ${input.currentPlayer.toUpperCase()}`,
            tone: 'spectator',
            color: input.currentPlayer,
        };
    }

    const isMine = Boolean(input.myColor && input.currentPlayer === input.myColor);
    if (isMine) {
        if (input.targeting) {
            return {
                text: `${input.targeting.toUpperCase()} ARMED · TAP TARGET TOKEN`,
                tone: 'target',
                color: input.myColor,
            };
        }
        if (input.gamePhase === 'moving') {
            if (input.boostPendingDice != null) {
                return {
                    text: input.myTokensInHome > 0
                        ? `BOOST 1/2 · DEPLOY OR MOVE [6] → NEXT [${input.boostPendingDice}]`
                        : `BOOST 1/2 · MOVE [6] → NEXT [${input.boostPendingDice}]`,
                    tone: 'yours',
                    color: input.myColor,
                };
            }
            if (input.effectiveMyDice === 6 && input.myTokensInHome > 0) {
                return {
                    text: 'YOUR TURN · DEPLOY [6] OR MOVE',
                    tone: 'yours',
                    color: input.myColor,
                };
            }
            return {
                text: 'YOUR TURN · SELECT A TOKEN',
                tone: 'yours',
                color: input.myColor,
            };
        }
        if (input.activeBoost && input.activeBoost === input.myColor) {
            return {
                text: 'YOUR TURN · +6 BOOST READY · ROLL',
                tone: 'yours',
                color: input.myColor,
            };
        }
        return {
            text: 'YOUR TURN · ROLL DICE',
            tone: 'yours',
            color: input.myColor,
        };
    }

    if (input.gamePhase === 'moving') {
        return {
            text: `${input.currentPlayer.toUpperCase()} IS MOVING`,
            tone: 'opponent',
            color: input.currentPlayer,
        };
    }

    return {
        text: `WAITING FOR ${input.currentPlayer.toUpperCase()}`,
        tone: 'opponent',
        color: input.currentPlayer,
    };
}

function powerToneFor(type: PowerType): FeedTone {
    if (type === 'nuke') return 'nuke';
    if (type === 'shield') return 'shield';
    if (type === 'boost') return 'boost';
    return 'teleport';
}

/**
 * Line 2: derive rich, actor-aware combat & power commentary from a state transition.
 * Strictly upholds PW-1: opponent/spectator mystery pickups never disclose power type.
 */
export function deriveMatchFeedEvent(
    prev: GameState | null,
    next: GameState,
    ctx: {
        myColor?: PlayerColor;
        playerCount: '1v1' | '4P' | '2v2';
        colorCorner: ColorCorner;
        spectatorMode?: boolean;
    },
): Omit<CombatFeedLine, 'id'> | null {
    if (!prev) return null;

    const seats = seatedColorsFor(ctx.playerCount);
    const actor = prev.currentPlayer;
    const actorUpper = actor.toUpperCase();

    // Collect board-to-base knockdowns & finish arrivals on this transition
    const knockedTokens: { color: PlayerColor; count: number }[] = [];
    let forwardMover: PlayerColor | null = null;
    let newlyFinishedColor: PlayerColor | null = null;
    let newlyFinishedTotal = 0;

    for (const c of seats) {
        const pArr = prev.positions?.[c] ?? [];
        const nArr = next.positions?.[c] ?? [];
        let kicksForColor = 0;
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const p = Number(pArr[i]);
            const n = Number(nArr[i]);
            if (p === n) continue;
            if (p >= 0 && p < BOARD_FINISH_INDEX && n === BASE_INDEX) {
                kicksForColor += 1;
            } else if (n > p || (p === BASE_INDEX && n >= 0)) {
                forwardMover = c;
            }
            if (p < BOARD_FINISH_INDEX && n === BOARD_FINISH_INDEX) {
                newlyFinishedColor = c;
                newlyFinishedTotal = nArr.filter((v) => Number(v) === BOARD_FINISH_INDEX).length;
            }
        }
        if (kicksForColor > 0) {
            knockedTokens.push({ color: c, count: kicksForColor });
        }
    }

    const totalKnocked = knockedTokens.reduce((sum, k) => sum + k.count, 0);
    const victimColors = knockedTokens.map((k) => k.color);

    // 1. Nuke detonation
    const nukeTriggered =
        (next.nukeFlash?.length ?? 0) > 0 &&
        ((prev.nukeFlash?.length ?? 0) === 0 || next.captureMessage !== prev.captureMessage);
    if (nukeTriggered && (!next.captureMessage || /NUKE!/i.test(next.captureMessage))) {
        if (victimColors.length >= 2) {
            return {
                text: `${formatColorList(victimColors)} NUKED BY ${actorUpper}`,
                tone: 'nuke',
            };
        }
        if (victimColors.length === 1) {
            const vUpper = victimColors[0].toUpperCase();
            return totalKnocked > 1
                ? { text: `${vUpper} ×${totalKnocked} VAPORIZED BY ${actorUpper}'S NUKE`, tone: 'nuke' }
                : { text: `${vUpper} NUKED BY ${actorUpper}`, tone: 'nuke' };
        }
        return { text: `${actorUpper} DETONATED A NUKE`, tone: 'nuke' };
    }

    // 2. Proximity trap detonation
    const trapDetonated = (next.activeTraps?.length ?? 0) < (prev.activeTraps?.length ?? 0);
    if (trapDetonated && victimColors.length > 0) {
        return {
            text: `${formatColorList(victimColors)} HIT A PROXIMITY MINE`,
            tone: 'nuke',
        };
    }

    // 3. Captures (single kick, double kick, 2v2 squad kick)
    if (victimColors.length > 0) {
        const kicker = forwardMover ?? actor;
        const kickerUpper = kicker.toUpperCase();
        const mate = getTeammateColor(kicker, ctx.playerCount);
        const kickerTag =
            ctx.playerCount === '2v2' && mate && (next.positions?.[kicker] ?? []).every((p) => Number(p) === BOARD_FINISH_INDEX)
                ? `${kickerUpper} + ${mate.toUpperCase()} SQUAD`
                : kickerUpper;

        if (victimColors.length === 1) {
            const vUpper = victimColors[0].toUpperCase();
            if (totalKnocked > 1) {
                return { text: `${vUpper} ×${totalKnocked} CRUSHED BY ${kickerTag}`, tone: 'capture' };
            }
            return { text: `${vUpper} KICKED BY ${kickerTag} · BONUS ROLL`, tone: 'capture' };
        }
        return {
            text: `${formatColorList(victimColors)} CRUSHED BY ${kickerTag}`,
            tone: 'capture',
        };
    }

    // 4. Triple-6 bust
    const bustByMsg = Boolean(
        next.captureMessage &&
            next.captureMessage !== prev.captureMessage &&
            /three\s*(6|six)/i.test(next.captureMessage),
    );
    const bustByStreak =
        prev.consecutiveSixes >= 2 &&
        next.consecutiveSixes === 0 &&
        next.currentPlayer !== prev.currentPlayer &&
        prev.gamePhase === 'rolling';
    if (bustByMsg || bustByStreak) {
        return {
            text: `${actorUpper} BUSTED · THREE 6S FORFEIT`,
            tone: 'bust',
        };
    }

    // 5. Teleport blink
    if (
        next.captureMessage &&
        next.captureMessage !== prev.captureMessage &&
        /TELEPORT!/i.test(next.captureMessage)
    ) {
        if (/straight home/i.test(next.captureMessage)) {
            return { text: `${actorUpper} WARPED STRAIGHT HOME`, tone: 'teleport' };
        }
        return { text: `${actorUpper} BLINKED TO SAFE STAR`, tone: 'teleport' };
    }

    // 6. Shield deployed
    if ((next.activeShields?.length ?? 0) > (prev.activeShields?.length ?? 0)) {
        const prevSet = new Set((prev.activeShields ?? []).map((s) => `${s.color}:${s.tokenIdx}`));
        const added = (next.activeShields ?? []).find((s) => !prevSet.has(`${s.color}:${s.tokenIdx}`));
        const shieldColor = (added?.color ?? actor).toUpperCase();
        return { text: `${shieldColor} RAISED AEGIS SHIELD`, tone: 'shield' };
    }

    // 7. Boost ignited
    if (next.activeBoost && next.activeBoost !== prev.activeBoost) {
        return {
            text: `${next.activeBoost.toUpperCase()} IGNITED +6 OVERDRIVE`,
            tone: 'boost',
        };
    }

    // 8. Token finished Home (57)
    if (newlyFinishedColor) {
        const finUpper = newlyFinishedColor.toUpperCase();
        if (newlyFinishedTotal === 4 && ctx.playerCount === '2v2') {
            const mate = getTeammateColor(newlyFinishedColor, '2v2');
            if (mate && (next.positions?.[mate] ?? []).some((p) => Number(p) < BOARD_FINISH_INDEX)) {
                return {
                    text: `${finUpper} ALL HOME · ASSISTING ${mate.toUpperCase()}`,
                    tone: 'finish',
                };
            }
        }
        if (newlyFinishedTotal === 4) {
            return { text: `${finUpper} LOCKED ALL 4 TOKENS HOME`, tone: 'finish' };
        }
        return { text: `${finUpper} LOCKED TOKEN ${newlyFinishedTotal}/4 HOME`, tone: 'finish' };
    }

    // 9. Boosted surge trail completed
    if (next.boostTrail && next.boostTrail !== prev.boostTrail) {
        return {
            text: `${next.boostTrail.toUpperCase()} SURGED +6 TILES`,
            tone: 'boost',
        };
    }

    // 10. Mystery power orb pickup (PW-1 strictly privacy-preserving for opponents/spectators!)
    for (const c of seats) {
        const pLen = prev.playerPowers?.[c]?.length ?? 0;
        const nHand = next.playerPowers?.[c] ?? [];
        if (nHand.length > pLen) {
            if (!ctx.spectatorMode && ctx.myColor && c === ctx.myColor) {
                const picked = nHand[nHand.length - 1]?.type;
                if (picked) {
                    return {
                        text: `YOU COLLECTED ${picked.toUpperCase()}`,
                        tone: powerToneFor(picked),
                    };
                }
            }
            return {
                text: `${c.toUpperCase()} CLAIMED A POWER ORB`,
                tone: 'neutral',
            };
        }
    }

    // 11. AFK auto-pilot strike / kick
    for (const c of seats) {
        if (next.afkStats?.[c]?.isKicked && !prev.afkStats?.[c]?.isKicked) {
            return {
                text: `${c.toUpperCase()} TIMED OUT · AUTO-PILOT ENGAGED`,
                tone: 'bust',
            };
        }
    }

    // 12. Fallback system message change (kept/info)
    if (next.captureMessage && next.captureMessage !== prev.captureMessage) {
        const cleaned = next.captureMessage.replace(/[.!]+$/, '').trim().toUpperCase();
        if (cleaned) {
            return {
                text: cleaned,
                tone: 'neutral',
            };
        }
    }

    return null;
}
