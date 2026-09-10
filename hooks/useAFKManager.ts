import { useEffect } from 'react';
import { PlayerColor, GameState, GameStateSetter } from '@/lib/types';
import { Player } from './useGameEngine';
import { getLegalTokenIndices } from '@/lib/gameLogic';
import { ColorCorner } from '@/lib/boardLayout';

interface UseAFKManagerProps {
    localGameState: GameState;
    setLocalGameState: GameStateSetter;
    initialPlayers: Player[];
    handleRoll: (value?: number) => Promise<void>;
    moveToken: (color: PlayerColor, tokenIndex: number, steps: number) => void;
    getNextPlayer: (current: PlayerColor) => PlayerColor;
    broadcastAction?: (type: string, payload?: unknown, stateOverride?: GameState) => void;
    isHost?: boolean;
    colorCorner?: ColorCorner;
}

export function useAFKManager({
    localGameState,
    setLocalGameState,
    initialPlayers,
    handleRoll,
    moveToken,
    getNextPlayer,
    broadcastAction,
    isHost,
    colorCorner
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
            setLocalGameState((prev) => {
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

        // ONLY the Host (or Computer Host) triggers forced AFK actions for ANY player.
        // This prevents Guests from spamming intents while 'timeLeft' is 0.
        if (isHost && !isCurrentlyBot && localGameState.afkStats[color].isAutoPlaying && localGameState.timeLeft <= 0) {
            if (localGameState.gamePhase === 'rolling') {
                const forcedRoll = Math.floor(Math.random() * 6) + 1;
                // Reset timeLeft immediately before async call to prevent loop
                setLocalGameState((s) => ({ ...s, timeLeft: 15 }));
                handleRoll(forcedRoll);
            } else if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                const diceValue = localGameState.diceValue;
                const options = colorCorner
                    ? getLegalTokenIndices(localGameState.positions, color, diceValue, colorCorner)
                    : localGameState.positions[color].reduce<number[]>((acc, pos, idx) => {
                        if (pos === -1 && diceValue === 6) acc.push(idx);
                        else if (pos !== -1 && pos + diceValue <= 57) acc.push(idx);
                        return acc;
                    }, []);

                if (options.length === 0) {
                    setLocalGameState((s) => {
                        const nextPlayer = getNextPlayer(s.currentPlayer);
                        const switchState: GameState = {
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
                    // Reset timeLeft immediately to prevent loop
                    setLocalGameState((s) => ({ ...s, timeLeft: 15 }));
                    moveToken(color, randomIdx, diceValue);
                }
            }
        }
    }, [localGameState.timeLeft, localGameState.currentPlayer, localGameState.gamePhase, localGameState.winner, localGameState.diceValue, localGameState.afkStats, localGameState.idleWarning, handleRoll, moveToken, initialPlayers, getNextPlayer, setLocalGameState, isHost, broadcastAction, colorCorner]);
}
