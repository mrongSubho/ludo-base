import { useEffect, useRef } from 'react';
import { PlayerColor, PowerType } from '@/lib/types';
import { Player } from './useGameEngine';
import { getBestMove, getBestPowerUsage } from '@/lib/aiEngine';
import { Point } from '@/lib/boardLayout';
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
    playerPaths: Record<string, Point[]>;
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
    playerPaths,
    playerCount,
    isLobbyConnected
}: UseAIBrainProps) {
    const lastActionRef = useRef<string>('');

    useEffect(() => {
        if (localGameState.winner) return;

        // In networked matches, only the Host orchestrates the AI.
        if (isLobbyConnected && !isHost) return;

        const color = localGameState.currentPlayer;
        const phase = localGameState.gamePhase;
        const diceValue = localGameState.diceValue;
        const isRolling = localGameState.isRolling;
        
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isBot = currentPlayerInfo?.isAi || localGameState.afkStats[color]?.isKicked;

        if (!isBot) {
            lastActionRef.current = '';
            return;
        }

        // Action Key: prevent double-scheduling the same turn state
        const actionKey = `${color}-${phase}-${diceValue}-${isRolling}`;
        if (lastActionRef.current === actionKey) return;

        console.log('🤖 [AIBrain] Evaluation turn:', actionKey);

        if (phase === 'rolling' && !isRolling && diceValue === null) {
            const randomDelay = Math.floor(Math.random() * (BOT_ROLL_DELAY_MAX - BOT_ROLL_DELAY_MIN + 1)) + BOT_ROLL_DELAY_MIN;
            lastActionRef.current = actionKey;

            const timer = setTimeout(() => {
                const shouldUsePower = getBestPowerUsage(localGameState, color, playerPaths, playerCount);
                if (shouldUsePower) {
                    handleUsePower(color);
                } else {
                    handleRoll();
                }
            }, randomDelay);
            return () => clearTimeout(timer);
        } 
        
        if (phase === 'moving' && diceValue !== null && !isRolling) {
            lastActionRef.current = actionKey;
            
            const timer = setTimeout(() => {
                const bestMove = getBestMove(
                    localGameState.positions,
                    color,
                    diceValue,
                    playerPaths,
                    playerCount,
                    localGameState.powerTiles,
                    localGameState
                );
                
                if (bestMove !== null) {
                    moveToken(color, bestMove, diceValue);
                } else {
                    console.log('🤖 [AIBrain] No valid moves found for bot, waiting for turn switch.');
                }
            }, BOT_MOVE_DELAY);
            return () => clearTimeout(timer);
        }
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
        handleUsePower, 
        handleRoll, 
        moveToken, 
        playerCount, 
        playerPaths
    ]);
}
