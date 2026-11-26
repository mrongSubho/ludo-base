import { useEffect, useRef } from 'react';
import { GameState, GameStateSetter } from '@/lib/types';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
import { shouldRunMatchTimer } from '@/lib/matchTimer';
import { DEFAULT_TURN_TIMER_SECS } from '@/lib/constants';

/**
 * NET-13: an absolute deadline, not a decrementing counter.
 *
 * A backgrounded tab throttles `setInterval` to roughly once a minute, so a
 * decrement-per-tick countdown decays at ~0.017/s and AFK enforcement never
 * fires on the schedule it promises. The displayed value is derived from the
 * deadline on every tick, so a throttled tab shows the truth the moment it
 * wakes, and a resumed tab corrects immediately on visibilitychange.
 *
 * The deadline is keyed by (currentPlayer, gamePhase, diceValue) — i.e. per
 * turn — and re-armed only when that key changes, never on unrelated renders.
 */
interface UseGameTimerProps {
    localGameState: GameState;
    setLocalGameState: GameStateSetter;
    matchConnectionStatus?: MatchConnectionStatus;
    isNetworked?: boolean;
    hasAuthoritativeSnapshot?: boolean;
    getServerNow?: () => number;
}

export function useGameTimer({
    localGameState,
    setLocalGameState,
    matchConnectionStatus = 'offline',
    isNetworked = false,
    hasAuthoritativeSnapshot = false,
    getServerNow,
}: UseGameTimerProps) {
    // The deadline ref MUST live at hook scope, not inside the effect below.
    // Outside render React installs ContextOnlyDispatcher, where every hook —
    // useRef included — throws #321 "Invalid hook call". Calling it inside the
    // effect (as 881902d did) therefore threw the moment the effect body ran,
    // which for an offline match is on mount: the whole match start died with
    // React error #321 at the route boundary. Hoisted, the ref persists per
    // component instance, so the per-turn re-arm below still keys correctly.
    const deadlineRef = useRef<{ key: string; at: number } | null>(null);
    const lastIdleTickRef = useRef<number>(0);
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
                // If the Idle Warning prompt is active, throttle decrement to 1/s
                if (prev.idleWarning) {
                    if (nowMs - lastIdleTickRef.current < 1000) {
                        return prev;
                    }
                    lastIdleTickRef.current = nowMs;
                    if (prev.idleWarning.timeLeft <= 0) {
                        // 10s ultimatum expired -> Kick the player
                        const kickedPlayer = prev.idleWarning.player;
                        return {
                            ...prev,
                            idleWarning: null,
                            afkStats: {
                                ...prev.afkStats,
                                [kickedPlayer]: { ...prev.afkStats[kickedPlayer], isKicked: true, isAutoPlaying: false }
                            },
                        };
                    }
                    return {
                        ...prev,
                        idleWarning: { ...prev.idleWarning, timeLeft: Math.max(0, prev.idleWarning.timeLeft - 1) }
                    };
                }

                // Normal Turn Timer — derived from the server-aligned deadline, so throttling
                // or clock skew cannot drift the countdown.
                const isInteractive = !prev.isRolling && !prev.winner && !prev.abortReason;
                if (!isInteractive) return prev;
                const at = deadlineRef.current?.at;
                if (at === undefined) return prev;
                const left = Math.max(0, Math.ceil((at - nowMs) / 1000));
                if (left === prev.timeLeft) return prev;
                return { ...prev, timeLeft: left };
            });
        };

        // Immediate tick so UI snaps at phase start before the 250ms cadence.
        tickClock();
        const interval = setInterval(tickClock, 250);

        // A tab hidden for a minute must not keep a stale number on screen.
        const resync = () => {
            if (deadlineRef.current?.at === undefined) return;
            tickClock();
        };
        document.addEventListener('visibilitychange', resync);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', resync);
        };
    }, [localGameState.winner, localGameState.abortReason, localGameState.currentPlayer, localGameState.gamePhase, localGameState.diceValue, localGameState.turnPhaseKind, localGameState.turnDurationMs, localGameState.deadlineAt, setLocalGameState, matchConnectionStatus, isNetworked, hasAuthoritativeSnapshot]);
}
