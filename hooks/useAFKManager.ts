import { useEffect, useRef, useState } from 'react';
import { PlayerColor, PowerType, GameState, GameStateSetter } from '@/lib/types';
import { Player } from './useGameEngine';
import { clearShieldsOnTurnChange } from '@/lib/engine/core';
import { ColorCorner } from '@/lib/boardLayout';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
import type { MatchAuthorityMode } from '@/lib/netcode/authorityGate';
import {
    isSeatInTier1Afk,
    isSeatPermanentlyLocked,
    normalizeSeatAfkStats,
    pickTier1RandomMove,
    pickTier1RandomPower,
    sampleHumanizedBotDelayMs,
} from '@/lib/afkPolicy';
import type { RollOutcome, MoveTokenOutcome } from './useGameActions';

interface UseAFKManagerProps {
    localGameState: GameState;
    setLocalGameState: GameStateSetter;
    initialPlayers: Player[];
    handleRoll: (isRemote?: boolean) => Promise<RollOutcome>;
    moveToken: (color: PlayerColor, tokenIndex: number, steps: number) => Promise<MoveTokenOutcome>;
    handleUsePower: (color: PlayerColor, type?: PowerType, tokenIdx?: number) => Promise<boolean> | void;
    getNextPlayer: (current: PlayerColor) => PlayerColor;
    colorCorner?: ColorCorner;
    playerCount: '1v1' | '4P' | '2v2';
    matchConnectionStatus?: MatchConnectionStatus;
    matchAuthorityMode?: MatchAuthorityMode;
    /** NET-07: called with the permanently kicked seat so abandon telemetry stays accurate. */
    onAbandon?: (args: { seat: string; matchEnded: boolean }) => void;
}

/**
 * Offline / local-AI Dual-Tier AFK manager.
 *
 * - Online matches (`matchAuthorityMode === 'room'` or connected) are strictly server-authoritative in MatchRoomCore.
 * - Watches Tier-1 reclaim deadlines (`afkDeadlineAt`) every 1s and promotes expired seats to Tier-2 (`kicked_smart_bot`).
 * - Executes Tier-1 Random / No-Brain Bot turns with humanized pacing (2-4s roll, 3-5s move).
 */
export function useAFKManager({
    localGameState,
    setLocalGameState,
    initialPlayers,
    handleRoll,
    moveToken,
    handleUsePower,
    getNextPlayer,
    colorCorner,
    playerCount,
    matchConnectionStatus = 'offline',
    matchAuthorityMode = 'offline',
    onAbandon,
}: UseAFKManagerProps) {
    const isNetworked =
        matchAuthorityMode === 'room' ||
        matchConnectionStatus === 'connected' ||
        matchConnectionStatus === 'reconnecting' ||
        matchConnectionStatus === 'syncing' ||
        matchConnectionStatus === 'ended';

    const stateRef = useRef(localGameState);
    stateRef.current = localGameState;
    const handleRollRef = useRef(handleRoll);
    handleRollRef.current = handleRoll;
    const moveTokenRef = useRef(moveToken);
    moveTokenRef.current = moveToken;
    const handleUsePowerRef = useRef(handleUsePower);
    handleUsePowerRef.current = handleUsePower;
    const getNextPlayerRef = useRef(getNextPlayer);
    getNextPlayerRef.current = getNextPlayer;
    const onAbandonRef = useRef(onAbandon);
    onAbandonRef.current = onAbandon;

    const lastActionRef = useRef<string>('');
    const [retryTick, setRetryTick] = useState(0);
    const rollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scheduleRetry = () => {
        lastActionRef.current = '';
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            setRetryTick((n) => n + 1);
        }, 250);
    };

    // 1. Offline Tier-1 Reclaim Window Expiry Watcher
    useEffect(() => {
        if (isNetworked || localGameState.winner || localGameState.abortReason) return;

        const checkDeadlines = () => {
            const now = Date.now();
            setLocalGameState((prev) => {
                if (prev.winner || prev.abortReason) return prev;
                let changed = false;
                const nextAfk = { ...prev.afkStats };
                const kickedNow: PlayerColor[] = [];

                for (const p of initialPlayers) {
                    if (p.isAi) continue;
                    const stats = normalizeSeatAfkStats(prev.afkStats?.[p.color]);
                    if (
                        isSeatInTier1Afk(stats) &&
                        typeof stats.afkDeadlineAt === 'number' &&
                        now >= stats.afkDeadlineAt
                    ) {
                        changed = true;
                        kickedNow.push(p.color);
                        nextAfk[p.color] = {
                            ...stats,
                            mode: 'kicked_smart_bot',
                            isAutoPlaying: false,
                            isKicked: true,
                            afkSinceAt: null,
                            afkDeadlineAt: null,
                            afkWindowMs: null,
                            kickReason: stats.presence === 'disconnected' ? 'disconnect_timeout' : 'afk_timeout',
                            kickedAt: now,
                        };
                    }
                }

                if (!changed) return prev;
                for (const kc of kickedNow) {
                    onAbandonRef.current?.({
                        seat: kc,
                        matchEnded: prev.winner !== null || prev.status === 'finished',
                    });
                }
                return {
                    ...prev,
                    afkStats: nextAfk,
                    lastUpdate: now,
                };
            });
        };

        checkDeadlines();
        const iv = setInterval(checkDeadlines, 1000);
        return () => clearInterval(iv);
    }, [isNetworked, localGameState.winner, localGameState.abortReason, initialPlayers, setLocalGameState]);

    // 2. Offline Tier-1 Random / No-Brain Bot Runner (Tier-2 is driven by useAIBrain)
    useEffect(() => {
        if (isNetworked || localGameState.winner || localGameState.abortReason || !colorCorner) {
            lastActionRef.current = '';
            return;
        }

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find((p) => p.color === color);
        const afk = normalizeSeatAfkStats(localGameState.afkStats?.[color]);
        const isTier1 = !currentPlayerInfo?.isAi && !isSeatPermanentlyLocked(afk) && isSeatInTier1Afk(afk);

        if (!isTier1) {
            lastActionRef.current = '';
            return;
        }

        const phase = localGameState.gamePhase;
        const diceValue = localGameState.diceValue;
        const isRolling = localGameState.isRolling;
        const actionKey = `t1-${color}-${phase}-${diceValue}-${isRolling}-${localGameState.boostPendingDice ?? 'none'}-${localGameState.powerSpentThisTurn ? '1' : '0'}`;
        if (lastActionRef.current === actionKey) return;

        if (rollTimerRef.current) {
            clearTimeout(rollTimerRef.current);
            rollTimerRef.current = null;
        }
        if (moveTimerRef.current) {
            clearTimeout(moveTimerRef.current);
            moveTimerRef.current = null;
        }

        if (phase === 'rolling' && !isRolling && diceValue === null) {
            lastActionRef.current = actionKey;
            const delayMs = sampleHumanizedBotDelayMs('roll');
            rollTimerRef.current = setTimeout(() => {
                rollTimerRef.current = null;
                const latest = stateRef.current;
                const latestAfk = normalizeSeatAfkStats(latest.afkStats?.[color]);
                if (latest.winner || latest.currentPlayer !== color || !isSeatInTier1Afk(latestAfk)) return;

                void (async () => {
                    const powerPick = pickTier1RandomPower(latest, color, colorCorner, playerCount);
                    if (powerPick) {
                        const applied = await handleUsePowerRef.current(color, powerPick.type, powerPick.tokenIdx);
                        if (applied) return;
                    }
                    const rollRes = await handleRollRef.current();
                    if (rollRes === 'failed') {
                        scheduleRetry();
                    }
                })();
            }, delayMs);
        } else if (phase === 'moving' && diceValue !== null && !isRolling) {
            lastActionRef.current = actionKey;
            const delayMs = sampleHumanizedBotDelayMs('move');
            moveTimerRef.current = setTimeout(() => {
                moveTimerRef.current = null;
                const latest = stateRef.current;
                const latestAfk = normalizeSeatAfkStats(latest.afkStats?.[color]);
                if (
                    latest.winner ||
                    latest.currentPlayer !== color ||
                    latest.gamePhase !== 'moving' ||
                    latest.diceValue === null ||
                    !isSeatInTier1Afk(latestAfk)
                ) {
                    return;
                }

                const pick = pickTier1RandomMove(latest.positions, color, latest.diceValue, colorCorner, playerCount);
                if (pick) {
                    const rolled = latest.diceValue;
                    void (async () => {
                        const moveRes = await moveTokenRef.current(pick.color, pick.tokenIndex, rolled);
                        if (moveRes === 'failed') {
                            scheduleRetry();
                        }
                    })();
                } else {
                    setLocalGameState((s) => {
                        const nextPlayer = getNextPlayerRef.current(s.currentPlayer);
                        return {
                            ...s,
                            gamePhase: 'rolling',
                            currentPlayer: nextPlayer,
                            activeShields: clearShieldsOnTurnChange(s.activeShields, s.currentPlayer, nextPlayer),
                            diceValue: null,
                            timeLeft: 12,
                            lastUpdate: Date.now(),
                        };
                    });
                }
            }, delayMs);
        }
    }, [
        retryTick,
        isNetworked,
        localGameState.winner,
        localGameState.abortReason,
        localGameState.currentPlayer,
        localGameState.gamePhase,
        localGameState.diceValue,
        localGameState.isRolling,
        localGameState.boostPendingDice,
        localGameState.powerSpentThisTurn,
        localGameState.afkStats,
        initialPlayers,
        colorCorner,
        playerCount,
        setLocalGameState,
    ]);

    useEffect(() => () => {
        if (rollTimerRef.current) {
            clearTimeout(rollTimerRef.current);
            rollTimerRef.current = null;
        }
        if (moveTimerRef.current) {
            clearTimeout(moveTimerRef.current);
            moveTimerRef.current = null;
        }
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);
}
