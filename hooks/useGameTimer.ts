import { useEffect, useRef } from 'react';
import { GameState, GameStateSetter } from '@/lib/types';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
import { shouldRunMatchTimer } from '@/lib/matchTimer';
import { DEFAULT_TURN_TIMER_SECS } from '@/lib/constants';
import {
    AFK_MAX_TRIGGERS,
    getAfkReclaimWindowMs,
    isSeatPermanentlyLocked,
    normalizeSeatAfkStats,
} from '@/lib/afkPolicy';

/**
 * NET-13: an absolute deadline, not a decrementing counter.
 *
 * A backgrounded tab throttles `setInterval` to roughly once a minute, so a
 * decrement-per-tick countdown decays at ~0.017/s and AFK enforcement never
 * fires on the schedule it promises. The displayed value is derived from the
 * deadline on every tick, so a throttled tab shows the truth the moment it
 * wakes, and a resumed tab corrects immediately on visibilitychange.
 *
 * The deadline is keyed by (currentPlayer, gamePhase, diceValue, turnPhaseKind) — i.e. per
 * turn — and re-armed only when that key changes, never on unrelated renders.
 */
interface UseGameTimerProps {
    localGameState: GameState;
    setLocalGameState: GameStateSetter;
    matchConnectionStatus?: MatchConnectionStatus;
    isNetworked?: boolean;
    hasAuthoritativeSnapshot?: boolean;
    getServerNow?: () => number;
    isOfflineSeatAi?: boolean;
}

export function useGameTimer({
    localGameState,
    setLocalGameState,
    matchConnectionStatus = 'offline',
    isNetworked = false,
    hasAuthoritativeSnapshot = false,
    getServerNow,
    isOfflineSeatAi = false,
}: UseGameTimerProps) {
    const deadlineRef = useRef<{ key: string; at: number } | null>(null);
    const getServerNowRef = useRef<() => number>(getServerNow ?? Date.now);
    getServerNowRef.current = getServerNow ?? Date.now;

    useEffect(() => {
        if (localGameState.winner || localGameState.abortReason || !shouldRunMatchTimer({
            isNetworked,
            connectionStatus: matchConnectionStatus,
            hasAuthoritativeSnapshot,
        })) {
            deadlineRef.current = null;
            return;
        }

        const nowFn = () => getServerNowRef.current();
        const hasValidServerDeadline =
            typeof localGameState.deadlineAt === 'number' && localGameState.deadlineAt > 0;

        // Never invent a local fallback deadline in networked matches: wait for the room's deadlineAt.
        if (isNetworked && !hasValidServerDeadline) {
            deadlineRef.current = null;
            return;
        }

        const turnKey = `${localGameState.currentPlayer}|${localGameState.gamePhase}|${localGameState.diceValue ?? ''}|${localGameState.turnPhaseKind ?? ''}`;
        const authoritativeAt = hasValidServerDeadline
            ? (localGameState.deadlineAt as number)
            : nowFn() + (localGameState.turnDurationMs ?? DEFAULT_TURN_TIMER_SECS * 1000);

        if (!deadlineRef.current || deadlineRef.current.key !== turnKey) {
            deadlineRef.current = {
                key: turnKey,
                at: authoritativeAt,
            };
        } else if (hasValidServerDeadline && deadlineRef.current.at !== localGameState.deadlineAt) {
            deadlineRef.current.at = localGameState.deadlineAt as number;
        }

        const tickClock = () => {
            const nowMs = nowFn();
            setLocalGameState((prev) => {
                const isInteractive = !prev.isRolling && !prev.winner && !prev.abortReason;
                if (!isInteractive) return prev;
                const at = deadlineRef.current?.at;
                if (at === undefined) return prev;
                const left = Math.max(0, Math.ceil((at - nowMs) / 1000));

                // Offline human turn timer expiration -> enter Tier-1 AFK (or immediate 5/5 kick)
                if (!isNetworked && !isOfflineSeatAi && left <= 0) {
                    const color = prev.currentPlayer;
                    const seatMeta = prev.initialBoardConfig?.players?.find((p) => p.color === color);
                    const curAfk = normalizeSeatAfkStats(prev.afkStats?.[color]);
                    if (!seatMeta?.isAi && curAfk.mode === 'human' && !isSeatPermanentlyLocked(curAfk)) {
                        const nextTriggers = (curAfk.afkTriggers ?? 0) + 1;
                        if (nextTriggers >= AFK_MAX_TRIGGERS) {
                            return {
                                ...prev,
                                timeLeft: 0,
                                idleWarning: null,
                                afkStats: {
                                    ...prev.afkStats,
                                    [color]: {
                                        ...curAfk,
                                        mode: 'kicked_smart_bot',
                                        isAutoPlaying: false,
                                        isKicked: true,
                                        afkTriggers: nextTriggers,
                                        totalTriggers: nextTriggers,
                                        afkSinceAt: null,
                                        afkDeadlineAt: null,
                                        afkWindowMs: null,
                                        kickReason: 'afk_limit_5',
                                        kickedAt: nowMs,
                                    },
                                },
                                lastUpdate: nowMs,
                            };
                        }

                        const startedAt = prev.matchStartedAt ?? prev.lastUpdate ?? nowMs;
                        const windowMs = getAfkReclaimWindowMs(nowMs - startedAt);
                        return {
                            ...prev,
                            timeLeft: 0,
                            idleWarning: null,
                            afkStats: {
                                ...prev.afkStats,
                                [color]: {
                                    ...curAfk,
                                    mode: 'afk_random_bot',
                                    isAutoPlaying: true,
                                    isKicked: false,
                                    consecutiveTurns: 0,
                                    afkTriggers: nextTriggers,
                                    totalTriggers: nextTriggers,
                                    afkSinceAt: nowMs,
                                    afkWindowMs: windowMs,
                                    afkDeadlineAt: nowMs + windowMs,
                                },
                            },
                            lastUpdate: nowMs,
                        };
                    }
                }

                if (left === prev.timeLeft) return prev;
                return { ...prev, timeLeft: left };
            });
        };

        tickClock();
        const interval = setInterval(tickClock, 250);

        const resync = () => {
            if (deadlineRef.current?.at === undefined) return;
            tickClock();
        };
        document.addEventListener('visibilitychange', resync);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', resync);
        };
    }, [localGameState.winner, localGameState.abortReason, localGameState.currentPlayer, localGameState.gamePhase, localGameState.diceValue, localGameState.turnPhaseKind, localGameState.turnDurationMs, localGameState.deadlineAt, setLocalGameState, matchConnectionStatus, isNetworked, hasAuthoritativeSnapshot, isOfflineSeatAi]);
}
