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
}

export function useGameTimer({
    localGameState,
    setLocalGameState,
    matchConnectionStatus = 'offline',
    isNetworked = false,
    hasAuthoritativeSnapshot = false
}: UseGameTimerProps) {
    useEffect(() => {
        if (localGameState.winner || !shouldRunMatchTimer({
            isNetworked,
            connectionStatus: matchConnectionStatus,
            hasAuthoritativeSnapshot,
        })) return;

        const deadlineRef = useRef<{ key: string; at: number } | null>(null);
        const turnKey = `${localGameState.currentPlayer}|${localGameState.gamePhase}|${localGameState.diceValue}`;
        if (!deadlineRef.current || deadlineRef.current.key !== turnKey) {
            deadlineRef.current = {
                key: turnKey,
                at: Date.now() + DEFAULT_TURN_TIMER_SECS * 1000,
            };
        }

        const interval = setInterval(() => {
            setLocalGameState((prev) => {
                // If the Idle Warning prompt is active, tick its countdown instead
                if (prev.idleWarning) {
                    if (prev.timeLeft <= 0) {
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
                        idleWarning: { ...prev.idleWarning, timeLeft: Math.max(0, prev.timeLeft - 1) }
                    };
                }

                // Normal Turn Timer — derived from the deadline, so throttling
                // cannot slow the clock down.
                const isInteractive = !prev.isRolling && !prev.winner;
                if (!isInteractive) return prev;
                const at = deadlineRef.current?.at;
                if (at === undefined) return prev;
                const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
                if (left === prev.timeLeft) return prev;
                return { ...prev, timeLeft: left };
            });
        }, 1000);

        // A tab hidden for a minute must not keep a stale number on screen.
        const resync = () => {
            const at = deadlineRef.current?.at;
            if (at === undefined) return;
            setLocalGameState((prev) => {
                if (prev.idleWarning || prev.isRolling || prev.winner) return prev;
                const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
                return left === prev.timeLeft ? prev : { ...prev, timeLeft: left };
            });
        };
        document.addEventListener('visibilitychange', resync);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', resync);
        };
    }, [localGameState.winner, localGameState.currentPlayer, localGameState.gamePhase, localGameState.diceValue, setLocalGameState, matchConnectionStatus, isNetworked, hasAuthoritativeSnapshot]);
}
