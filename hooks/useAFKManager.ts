import { useEffect } from 'react';
import { PlayerColor } from '@/lib/types';
import { Player } from './useGameEngine';

interface UseAFKManagerProps {
    localGameState: any;
    setLocalGameState: React.Dispatch<React.SetStateAction<any>>;
    initialPlayers: Player[];
    handleRoll: (value?: number) => Promise<void>;
    moveToken: (color: PlayerColor, tokenIndex: number, steps: number) => void;
    getNextPlayer: (current: PlayerColor) => PlayerColor;
    broadcastAction?: (type: string, payload: any, stateOverride?: any) => void;
    isHost?: boolean;
}

export function useAFKManager({
    localGameState,
    setLocalGameState,
    initialPlayers,
    handleRoll,
    moveToken,
    getNextPlayer,
    broadcastAction,
    isHost
}: UseAFKManagerProps) {
    useEffect(() => {
        if (localGameState.winner || localGameState.idleWarning) return;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isOriginalBot = currentPlayerInfo?.isAi;
        const isKicked = localGameState.afkStats[color].isKicked;
        const isCurrentlyBot = isOriginalBot || isKicked;

        // Striking logic only applies to active humans when timeLeft hits 0
        if (!isCurrentlyBot && localGameState.timeLeft <= 0) {
            setLocalGameState((prev: any) => {
                const stats = prev.afkStats[color];
                let nextStats = { ...stats };
                let nextWarning = null;

                if (!stats.isAutoPlaying) {
                    nextStats.isAutoPlaying = true;
                    nextStats.consecutiveTurns = 1;
                    nextStats.totalTriggers += 1;
                } else {
                    nextStats.consecutiveTurns += 1;
                }

                if (nextStats.totalTriggers >= 3) {
                    nextStats.isKicked = true;
                    nextStats.isAutoPlaying = false;
                } else if (nextStats.consecutiveTurns >= 4) {
                    nextWarning = { player: color as PlayerColor, timeLeft: 10 };
                }

                return {
                    ...prev,
                    afkStats: { ...prev.afkStats, [color]: nextStats },
                    idleWarning: nextWarning || prev.idleWarning
                };
            });
        }
    }, [localGameState.timeLeft, localGameState.currentPlayer, localGameState.winner, localGameState.idleWarning, initialPlayers, setLocalGameState]);

    // Handle the Side-Effects of AFK Timeouts
    useEffect(() => {
        if (localGameState.winner || localGameState.idleWarning) return;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isOriginalBot = currentPlayerInfo?.isAi;
        const isKicked = localGameState.afkStats[color].isKicked;
        const isCurrentlyBot = isOriginalBot || isKicked;
        
        if (!isCurrentlyBot && localGameState.afkStats[color].isAutoPlaying && localGameState.timeLeft <= 0) {
            if (localGameState.gamePhase === 'rolling') {
                const forcedRoll = Math.floor(Math.random() * 6) + 1;
                handleRoll(forcedRoll);
            } else if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                const diceValue = localGameState.diceValue;
                const options: number[] = [];
                localGameState.positions[color].forEach((pos: number, idx: number) => {
                    if (pos === -1 && diceValue === 6) options.push(idx);
                    else if (pos !== -1 && pos + diceValue <= 57) options.push(idx);
                });

                if (options.length === 0) {
                    setLocalGameState((s: any) => {
                        const nextPlayer = getNextPlayer(s.currentPlayer);
                        const switchState = {
                            ...s,
                            gamePhase: 'rolling',
                            currentPlayer: nextPlayer,
                            diceValue: null,
                            timeLeft: 15,
                            lastUpdate: Date.now()
                        };
                        if (isHost && broadcastAction) {
                            broadcastAction('TURN_SWITCH', { nextPlayer }, switchState);
                        }
                        return switchState;
                    });
                } else {
                    const randomIdx = options[Math.floor(Math.random() * options.length)];
                    moveToken(color, randomIdx, diceValue);
                }
            }
        }
    }, [localGameState.timeLeft, localGameState.currentPlayer, localGameState.gamePhase, localGameState.winner, localGameState.diceValue, localGameState.afkStats, localGameState.idleWarning, handleRoll, moveToken, initialPlayers, getNextPlayer, setLocalGameState]);
}
