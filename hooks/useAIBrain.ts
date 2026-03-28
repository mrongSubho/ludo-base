import { useEffect, useRef } from 'react';
import { PlayerColor, PowerType } from '@/lib/types';
import { Player } from './useGameEngine';
import { getBestMove, getBestPowerUsage } from '@/lib/aiEngine';
import { Point, ColorCorner } from '@/lib/boardLayout';
import { 
    BOT_ROLL_DELAY_MIN, 
    BOT_ROLL_DELAY_MAX, 
    BOT_MOVE_DELAY 
} from '@/lib/constants';

interface UseAIBrainProps {
    localGameState: any;
    initialPlayers: Player[];
    isHost: boolean;
    handleRoll: (value?: number) => Promise<void>;
    moveToken: (color: PlayerColor, tokenIndex: number, steps: number) => void;
    handleUsePower: (color: PlayerColor) => void;
    colorCorner: ColorCorner;
    playerCount: '1v1' | '4P' | '2v2';
    isLobbyConnected: boolean;
}

export function useAIBrain({
    localGameState,
    initialPlayers,
    isHost,
    handleRoll,
    moveToken,
    handleUsePower,
    colorCorner,
    playerCount,
    isLobbyConnected
}: UseAIBrainProps) {
    const lastActionRef = useRef<string>('');
    
    // 🔧 FIX 1: Store function refs so the effect doesn't depend on function identity.
    // This prevents the effect cleanup from killing pending timers when
    // handleRoll/moveToken/handleUsePower get recreated by useCallback.
    const handleRollRef = useRef(handleRoll);
    const moveTokenRef = useRef(moveToken);
    const handleUsePowerRef = useRef(handleUsePower);
    const rollTimerRef = useRef<NodeJS.Timeout | null>(null);
    const moveTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Keep function refs fresh on every render
    useEffect(() => { handleRollRef.current = handleRoll; }, [handleRoll]);
    useEffect(() => { moveTokenRef.current = moveToken; }, [moveToken]);
    useEffect(() => { handleUsePowerRef.current = handleUsePower; }, [handleUsePower]);

    useEffect(() => {
        if (localGameState.winner) return;

        // In networked matches, only the Host orchestrates the AI.
        if (isLobbyConnected && !isHost) return;

        const color = localGameState.currentPlayer;
        const phase = localGameState.gamePhase;
        const diceValue = localGameState.diceValue;
        const isRolling = localGameState.isRolling;
        
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const afkStats = localGameState.afkStats?.[color];
        const isBot = currentPlayerInfo?.isAi || afkStats?.isKicked;

        if (!isBot) {
            lastActionRef.current = '';
            return;
        }

        // Action Key: prevent double-scheduling the same turn state
        const actionKey = `${color}-${phase}-${diceValue}-${isRolling}`;
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

        if (phase === 'rolling' && !isRolling && diceValue === null) {
            const minDelay = BOT_ROLL_DELAY_MIN;
            const maxDelay = BOT_ROLL_DELAY_MAX;
            const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            lastActionRef.current = actionKey;

            // 🔧 FIX 1: Use ref for timer AND call function via ref.
            // Timer survives effect re-runs. Function ref is always fresh.
            rollTimerRef.current = setTimeout(() => {
                rollTimerRef.current = null;
                const shouldUsePower = getBestPowerUsage(localGameState, color, colorCorner, playerCount);
                if (shouldUsePower) {
                    handleUsePowerRef.current(color);
                } else {
                    handleRollRef.current();
                }
            }, randomDelay);
        } 
        
        if (phase === 'moving' && diceValue !== null && !isRolling) {
            lastActionRef.current = actionKey;
            
            // 🔧 FIX 1: Same ref-based pattern for move timer.
            moveTimerRef.current = setTimeout(() => {
                moveTimerRef.current = null;
                const bestMove = getBestMove(
                    localGameState.positions,
                    color,
                    diceValue,
                    colorCorner,
                    playerCount,
                    localGameState.powerTiles,
                    localGameState
                );
                
                if (bestMove !== null) {
                    moveTokenRef.current(color, bestMove, diceValue);
                } else {
                    console.warn('🤖 [AIBrain] No valid moves found for bot. Forcing turn switch.');
                    // 🔧 SAFETY: If getBestMove returns null, reset lastActionRef
                    // so the next effect run can try again or let the engine handle it.
                    lastActionRef.current = '';
                }
            }, BOT_MOVE_DELAY);
        }

        // 🔧 FIX 1: NO cleanup return. Timers are managed via refs and only
        // cleared when the actionKey meaningfully changes (above).
    }, [
        localGameState.winner, 
        localGameState.currentPlayer, 
        localGameState.gamePhase, 
        localGameState.diceValue, 
        localGameState.isRolling,
        isLobbyConnected, 
        isHost, 
        initialPlayers, 
        localGameState.afkStats, 
        localGameState.playerPowers, 
        localGameState.positions,
        // 🔧 FIX 1: handleRoll, moveToken, handleUsePower REMOVED from deps.
        // They are accessed via refs, so their identity changes don't re-run this effect.
        playerCount, 
        colorCorner
    ]);
}
