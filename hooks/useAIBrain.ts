import { useEffect, useRef, useState } from 'react';
import { PlayerColor, PowerType, GameState, GameStateSetter } from '@/lib/types';
import { Player } from './useGameEngine';
import { getBestMoveAsync, getBestPowerUsageAsync } from '@/lib/ai/client';
import { clearShieldsOnTurnChange } from '@/lib/engine/core';
import { ColorCorner } from '@/lib/boardLayout';
import {
    BOT_ROLL_DELAY_MIN,
    BOT_ROLL_DELAY_MAX,
    BOT_MOVE_DELAY,
    DIFFICULTY_PARAMS,
    BotDifficulty
} from '@/lib/constants';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
import { shouldPauseLocalOrchestration } from '@/lib/netcode/resync';
import { isSeatPermanentlyLocked, sampleHumanizedBotDelayMs } from '@/lib/afkPolicy';
import type { RollOutcome, MoveTokenOutcome } from './useGameActions';

interface UseAIBrainProps {
    localGameState: GameState;
    setLocalGameState?: GameStateSetter;
    initialPlayers: Player[];
    handleRoll: (isRemote?: boolean) => Promise<RollOutcome>;
    moveToken: (color: PlayerColor, tokenIndex: number, steps: number) => Promise<MoveTokenOutcome> | void;
    handleUsePower: (color: PlayerColor, type?: PowerType, tokenIdx?: number) => Promise<boolean> | void;
    getNextPlayer?: (current: PlayerColor) => PlayerColor;
    colorCorner: ColorCorner;
    playerCount: '1v1' | '4P' | '2v2';
    isLobbyConnected: boolean;
    matchConnectionStatus?: MatchConnectionStatus;
}

export function useAIBrain({
    localGameState,
    setLocalGameState,
    initialPlayers,
    handleRoll,
    moveToken,
    handleUsePower,
    getNextPlayer,
    colorCorner,
    playerCount,
    isLobbyConnected,
    matchConnectionStatus = 'offline'
}: UseAIBrainProps) {
    const lastActionRef = useRef<string>('');
    const [retryTick, setRetryTick] = useState(0);
    
    // 🔧 FIX 1: Store function refs so the effect doesn't depend on function identity.
    // This prevents the effect cleanup from killing pending timers when
    // handleRoll/moveToken/handleUsePower get recreated by useCallback.
    const handleRollRef = useRef(handleRoll);
    const moveTokenRef = useRef(moveToken);
    const handleUsePowerRef = useRef(handleUsePower);
    const getNextPlayerRef = useRef(getNextPlayer);
    const setLocalGameStateRef = useRef(setLocalGameState);
    const rollTimerRef = useRef<NodeJS.Timeout | null>(null);
    const moveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const retryTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Keep function refs fresh on every render
    useEffect(() => { handleRollRef.current = handleRoll; }, [handleRoll]);
    useEffect(() => { moveTokenRef.current = moveToken; }, [moveToken]);
    useEffect(() => { handleUsePowerRef.current = handleUsePower; }, [handleUsePower]);
    useEffect(() => { getNextPlayerRef.current = getNextPlayer; }, [getNextPlayer]);
    useEffect(() => { setLocalGameStateRef.current = setLocalGameState; }, [setLocalGameState]);

    const scheduleRetry = () => {
        lastActionRef.current = '';
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            setRetryTick((n) => n + 1);
        }, 250);
    };

    useEffect(() => {
        if (localGameState.winner || shouldPauseLocalOrchestration(matchConnectionStatus)) return;

        // In networked matches, server room DO orchestrates AI.
        if (isLobbyConnected || matchConnectionStatus === 'connected') return;

        const color = localGameState.currentPlayer;
        const phase = localGameState.gamePhase;
        const diceValue = localGameState.diceValue;
        const isRolling = localGameState.isRolling;
        
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const afkStats = localGameState.afkStats?.[color];
        const isKickedReplacement = !currentPlayerInfo?.isAi && isSeatPermanentlyLocked(afkStats);
        const isBot = Boolean(currentPlayerInfo?.isAi || isKickedReplacement);

        if (!isBot) {
            lastActionRef.current = '';
            return;
        }

        // Action Key: prevent double-scheduling the same turn state
        const actionKey = `${color}-${phase}-${diceValue}-${isRolling}-${localGameState.boostPendingDice ?? 'none'}-${localGameState.powerSpentThisTurn ? '1' : '0'}`;
        if (lastActionRef.current === actionKey) return;

        // 🔧 FIX 1: When the actionKey changes, clear any stale timers from the
        // PREVIOUS state. This is the only place we clear timers — NOT in
        // effect cleanup, which would kill timers on spurious re-renders.
        if (rollTimerRef.current) {
            clearTimeout(rollTimerRef.current);
            rollTimerRef.current = null;
        }
        if (moveTimerRef.current) {
            clearTimeout(moveTimerRef.current);
            moveTimerRef.current = null;
        }

        console.log('🤖 [AIBrain] Evaluation turn:', actionKey);

        const difficulty: BotDifficulty = (localGameState.botDifficulty as BotDifficulty) || 'pro';
        const clock = DIFFICULTY_PARAMS[difficulty];

        if (phase === 'rolling' && !isRolling && diceValue === null) {
            const minDelay = clock.rollDelay[0] ?? BOT_ROLL_DELAY_MIN;
            const maxDelay = clock.rollDelay[1] ?? BOT_ROLL_DELAY_MAX;
            const randomDelay = isKickedReplacement
                ? sampleHumanizedBotDelayMs('roll')
                : Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            lastActionRef.current = actionKey;

            // 🔧 FIX 1: Use ref for timer AND call function via ref.
            // Timer survives effect re-runs. Function ref is always fresh.
            rollTimerRef.current = setTimeout(() => {
                rollTimerRef.current = null;
                void (async () => {
                    const powerPick = await getBestPowerUsageAsync({
                        state: localGameState,
                        playerId: color,
                        colorCorner,
                        playerCount,
                        difficulty,
                    });
                    if (powerPick) {
                        const applied = await handleUsePowerRef.current(color, powerPick.type, powerPick.tokenIdx);
                        if (applied) return;
                    }
                    const rollRes = await handleRollRef.current();
                    if (rollRes === 'failed') {
                        scheduleRetry();
                    }
                })();
            }, randomDelay);
        } 
        
        if (phase === 'moving' && diceValue !== null && !isRolling) {
            lastActionRef.current = actionKey;
            
            // 🔧 FIX 1: Same ref-based pattern for move timer.
            moveTimerRef.current = setTimeout(() => {
                moveTimerRef.current = null;
                void (async () => {
                    const bestMove = await getBestMoveAsync({
                        positions: localGameState.positions,
                        playerId: color,
                        roll: diceValue,
                        colorCorner,
                        playerCount,
                        powerTiles: localGameState.powerTiles as { r: number; c: number }[],
                        state: localGameState,
                        difficulty,
                    });

                    if (bestMove !== null) {
                        // ENG-10: move the teammate's token with the teammate's
                        // color — the index is into bestMove.color's array.
                        const moveRes = await moveTokenRef.current(bestMove.color, bestMove.tokenIndex, diceValue);
                        if (moveRes === 'failed') {
                            scheduleRetry();
                        }
                    } else {
                        console.warn('🤖 [AIBrain] No valid moves found for bot. Forcing turn switch.');
                        lastActionRef.current = '';
                        const setter = setLocalGameStateRef.current;
                        const nextFn = getNextPlayerRef.current;
                        if (setter && nextFn) {
                            setter((prev) => {
                                if (prev.winner || prev.currentPlayer !== color || prev.gamePhase !== 'moving') {
                                    return prev;
                                }
                                const nextPlayer = nextFn(prev.currentPlayer);
                                return {
                                    ...prev,
                                    gamePhase: 'rolling',
                                    currentPlayer: nextPlayer,
                                    activeShields: clearShieldsOnTurnChange(prev.activeShields, prev.currentPlayer, nextPlayer),
                                    diceValue: null,
                                    boostPendingDice: null,
                                    boostSubMoveBonus: false,
                                    powerSpentThisTurn: false,
                                    timeLeft: 15,
                                    lastUpdate: Date.now(),
                                };
                            });
                        } else {
                            scheduleRetry();
                        }
                    }
                })();
            }, isKickedReplacement ? sampleHumanizedBotDelayMs('move') : (clock.moveDelay ?? BOT_MOVE_DELAY));
        }

        // 🔧 FIX 1: NO cleanup return. Timers are managed via refs and only
        // cleared when the actionKey meaningfully changes (above).
    }, [
        retryTick,
        localGameState.winner,
        localGameState.currentPlayer,
        localGameState.gamePhase, 
        localGameState.diceValue, 
        localGameState.boostPendingDice,
        localGameState.isRolling,
        isLobbyConnected,
        matchConnectionStatus,
        initialPlayers, 
        localGameState.afkStats, 
        localGameState.playerPowers, 
        localGameState.powerSpentThisTurn,
        localGameState.positions,
        // 🔧 FIX 1: handleRoll, moveToken, handleUsePower REMOVED from deps.
        // They are accessed via refs, so their identity changes don't re-run this effect.
        playerCount, 
        colorCorner
    ]);

    // NET-18: unmount-only cleanup ON TOP of the actionKey clearing above.
    // Ref management keeps timers alive across spurious re-renders (FIX 1), but
    // it never released them when the component went away — a bot turn firing
    // after unmount moved a token into a torn-down board.
    useEffect(() => () => {
        if (rollTimerRef.current) { clearTimeout(rollTimerRef.current); rollTimerRef.current = null; }
        if (moveTimerRef.current) { clearTimeout(moveTimerRef.current); moveTimerRef.current = null; }
        if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    }, []);
}
