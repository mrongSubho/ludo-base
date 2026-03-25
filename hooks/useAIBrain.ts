import { useEffect } from 'react';
import { PlayerColor, PowerType } from '@/lib/types';
import { Player } from './useGameEngine';
import { getBestMove } from '@/lib/aiEngine';
import { getTeammateColor } from '@/lib/gameLogic';
import { Point, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from '@/lib/boardLayout';

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
                const randomDelay = Math.floor(Math.random() * (6000 - 3000 + 1)) + 3000;

                const timer = setTimeout(() => {
                    const power = localGameState.playerPowers[color as PlayerColor];
                    if (power) {
                        let shouldUse = false;
                        if (power === 'bomb') {
                            let targetFound = false;
                            localGameState.positions[color].forEach((myPos: number) => {
                                if (myPos < 0 || myPos >= 52) return;
                                (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
                                    if (oppColor === color) return;
                                    if (playerCount === '2v2' && oppColor === getTeammateColor(color, playerCount)) return;
                                    localGameState.positions[oppColor].forEach((oppPos: number) => {
                                        if (oppPos < 0 || oppPos >= 52) return;
                                        const myPt = playerPaths[color][myPos];
                                        const oppPt = playerPaths[oppColor][oppPos];
                                        for (let s = 1; s <= 6; s++) {
                                            const checkPos = myPos + s;
                                            if (checkPos >= 52) break;
                                            const checkPt = playerPaths[color][checkPos];
                                            if (checkPt.r === oppPt.r && checkPt.c === oppPt.c) targetFound = true;
                                        }
                                    });
                                });
                            });
                            if (targetFound) shouldUse = true;
                        } else if (power === 'shield') {
                            let vulnerable = false;
                            localGameState.positions[color].forEach((myPos: number) => {
                                if (myPos < 0 || myPos >= 52) return;
                                if (GLOBAL_SAFE_POINTS.some((p: Point) => p.r === playerPaths[color][myPos].r && p.c === playerPaths[color][myPos].c)) return;
                                
                                (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
                                    if (oppColor === color) return;
                                    if (playerCount === '2v2' && oppColor === getTeammateColor(color, playerCount)) return;
                                    localGameState.positions[oppColor].forEach((oppPos: number) => {
                                        if (oppPos < 0 || oppPos >= 52) return;
                                        for (let s = 1; s <= 6; s++) {
                                            const checkPos = oppPos + s;
                                            if (checkPos >= 52) break;
                                            const checkPt = playerPaths[oppColor][checkPos];
                                            const myPt = playerPaths[color][myPos];
                                            if (checkPt.r === myPt.r && checkPt.c === myPt.c) vulnerable = true;
                                        }
                                    });
                                });
                            });
                            if (vulnerable) shouldUse = true;
                        } else if (power === 'boost' || power === 'warp') {
                            shouldUse = true;
                        }

                        if (shouldUse) {
                            handleUsePower(color);
                            return; // Wait for next tick to roll
                        }
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
                        localGameState.powerTiles
                    );
                    if (bestMove !== null) {
                        moveToken(color, bestMove, localGameState.diceValue as number);
                    }
                }, 1500);
                return () => clearTimeout(timer);
            }
        }
    }, [localGameState.winner, localGameState.currentPlayer, localGameState.gamePhase, localGameState.diceValue, localGameState.teamup.isConnected, isHost, initialPlayers, localGameState.afkStats, localGameState.playerPowers, localGameState.positions, handleUsePower, handleRoll, moveToken, playerCount, playerPaths]);
}
