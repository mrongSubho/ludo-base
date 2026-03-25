import { useEffect } from 'react';
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
}

export function useAIBrain({
    localGameState,
    initialPlayers,
    isHost,
    handleRoll,
    moveToken,
    handleUsePower,
    playerPaths,
    playerCount
}: UseAIBrainProps) {
    useEffect(() => {
        if (localGameState.winner) return;

        // In networked matches, only the Host orchestrates the AI.
        if (localGameState.teamup.isConnected && !isHost) return;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.afkStats[color].isKicked;

        if (isCurrentlyBot) {
            if (localGameState.gamePhase === 'rolling') {
                const randomDelay = Math.floor(Math.random() * (BOT_ROLL_DELAY_MAX - BOT_ROLL_DELAY_MIN + 1)) + BOT_ROLL_DELAY_MIN;

                const timer = setTimeout(() => {
                    const shouldUsePower = getBestPowerUsage(localGameState, color, playerPaths, playerCount);
                    if (shouldUsePower) {
                        handleUsePower(color);
                        return;
                    }
                    handleRoll();
                }, randomDelay);
                return () => clearTimeout(timer);
            } else if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                const timer = setTimeout(() => {
                    const bestMove = getBestMove(
                        localGameState.positions,
                        color,
                        localGameState.diceValue as number,
                        playerPaths,
                        playerCount,
                        localGameState.powerTiles,
                        localGameState
                    );
                    if (bestMove !== null) {
                        moveToken(color, bestMove, localGameState.diceValue as number);
                    }
                }, BOT_MOVE_DELAY);
                return () => clearTimeout(timer);
            }
        }
    }, [localGameState.winner, localGameState.currentPlayer, localGameState.gamePhase, localGameState.diceValue, localGameState.teamup.isConnected, isHost, initialPlayers, localGameState.afkStats, localGameState.playerPowers, localGameState.positions, handleUsePower, handleRoll, moveToken, playerCount, playerPaths]);
}
