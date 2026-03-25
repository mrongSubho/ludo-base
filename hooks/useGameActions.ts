import { useCallback } from 'react';
import { PlayerColor, PowerType } from '@/lib/types';
import { processMove, getTeammateColor, handleThreeSixes, getNextPlayer as getNextPlayerCore } from '@/lib/gameLogic';
import { Player } from './useGameEngine';
import { Point, ColorCorner, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from '@/lib/boardLayout';

interface UseGameActionsProps {
    localGameState: any;
    setLocalGameState: React.Dispatch<React.SetStateAction<any>>;
    initialPlayers: Player[];
    address: string | undefined;
    isHost: boolean;
    isLobbyConnected: boolean;
    broadcastAction: (type: string, payload?: any) => void;
    sendIntent: (type: string, payload?: any) => void;
    startBettingWindow: (betType: any) => Promise<string>;
    playerPaths: Record<string, Point[]>;
    playerCount: '1v1' | '4P' | '2v2';
    colorCorner: ColorCorner;
    activeColorsArr: PlayerColor[];
    audio: {
        playMove: () => void;
        playCapture: () => void;
        playWin: () => void;
    };
    triggerWinConfetti: () => void;
    recordWin: (color: PlayerColor) => Promise<void>;
    autoMoveTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
}


export function useGameActions({
    localGameState,
    setLocalGameState,
    initialPlayers,
    address,
    isHost,
    isLobbyConnected,
    broadcastAction,
    sendIntent,
    playerPaths,
    playerCount,
    colorCorner,
    activeColorsArr,
    audio,
    triggerWinConfetti,
    recordWin,
    autoMoveTimeoutRef,
    startBettingWindow
}: UseGameActionsProps) {


    const getNextPlayer = useCallback((current: PlayerColor, currentPositions: any): PlayerColor => {
        const activeForTurns = activeColorsArr.filter(color => {
            const hasTokens = currentPositions[color].some((p: number) => p !== 57);
            if (playerCount === '2v2') {
                const teammate = getTeammateColor(color, playerCount);
                const teammateHasTokens = teammate ? currentPositions[teammate].some((p: number) => p !== 57) : false;
                return hasTokens || teammateHasTokens;
            }
            return hasTokens;
        });

        return getNextPlayerCore(
            current,
            playerCount,
            activeForTurns,
            colorCorner
        );
    }, [activeColorsArr, playerCount, colorCorner]);

    const moveToken = useCallback((color: PlayerColor, tokenIndex: number, steps: number, isRemote = false) => {
        if (autoMoveTimeoutRef.current) {
            clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = null;
        }

        setLocalGameState((prev: any) => {
            if (prev.winner) return prev;

            const { newState, captured } = processMove(
                prev,
                color,
                tokenIndex,
                steps,
                playerPaths,
                playerCount,
                prev.currentPlayer,
                activeColorsArr,
                colorCorner
            );

            if (newState.positions[color][tokenIndex] !== prev.positions[color][tokenIndex]) audio.playMove();
            if (captured) audio.playCapture();
            if (newState.winner && !prev.winner) {
                audio.playWin();
                triggerWinConfetti();
                recordWin(color);
            }

            if (isHost && !isRemote) {
                broadcastAction('MOVE_TOKEN', {
                    payload: { color, tokenIndex, steps, targetPosition: newState.positions[color][tokenIndex] }
                });
                if (newState.currentPlayer !== prev.currentPlayer) {
                    broadcastAction('TURN_SWITCH', { nextPlayer: newState.currentPlayer });
                }
            }

            return {
                ...prev,
                ...newState,
                captureMessage: captured ? `Captured! Bonus roll for ${color}!` : null,
                strikes: { ...prev.strikes, [color]: 0 },
                consecutiveSixes: (newState.currentPlayer !== color) ? 0 : prev.consecutiveSixes,
                lastUpdate: Date.now()
            };
        });
    }, [isHost, broadcastAction, playerPaths, playerCount, audio, triggerWinConfetti, recordWin, setLocalGameState, activeColorsArr, colorCorner, autoMoveTimeoutRef]);

    const handleRoll = useCallback(async (value?: number, isRemote = false) => {
        if (localGameState.winner) return;

        const myPlayer = initialPlayers.find(p => 
            (address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || 
            (!address && !p.isAi)
        );
        const isMyTurn = localGameState.currentPlayer === myPlayer?.color;
        const isCurrentlyBot = initialPlayers.find(p => p.color === localGameState.currentPlayer)?.isAi 
            || localGameState.afkStats[localGameState.currentPlayer]?.isKicked;
        const isLocalGame = !localGameState.teamup.isConnected;

        if (!isRemote && !isMyTurn && !isCurrentlyBot) return;
        if (!isRemote && isCurrentlyBot && !isHost && !isLocalGame) return;

        // 🎰 Host: Open betting window before rolling
        if (isHost && isLobbyConnected && !isRemote) {
            await startBettingWindow('dice_roll');
        }

        const rollValue = value || Math.floor(Math.random() * 6) + 1;

        if (isHost && isLobbyConnected && !isRemote) {
            broadcastAction('ROLL_DICE', { value: rollValue });
        }


        setLocalGameState((prev: any) => {
            if (prev.gamePhase !== 'rolling' || prev.winner) return prev;

            const color = prev.currentPlayer;
            const teammate = getTeammateColor(color, playerCount);
            const isSelfFinished = prev.positions[color].every((p: number) => p === 57);
            const targetColor = (playerCount === '2v2' && isSelfFinished && teammate) ? teammate : color;

            const { isThreeSixes, nextSixes } = handleThreeSixes(prev.consecutiveSixes, rollValue);

            if (isThreeSixes) {
                const nextPlayer = getNextPlayer(color, prev.positions);
                const nextState = {
                    ...prev,
                    diceValue: rollValue,
                    consecutiveSixes: 0,
                    gamePhase: 'rolling' as const,
                    currentPlayer: nextPlayer,
                    captureMessage: "Three 6s! Turn passed.",
                    timeLeft: 15
                };
                if (isHost && isLobbyConnected) {
                    broadcastAction('TURN_SWITCH', { nextPlayer });
                }
                return nextState;
            }

            let validMovesCount = 0;
            let lastValidTokenIndex = -1;
            
            prev.positions[targetColor].forEach((pos: number, idx: number) => {
                const nextPos = pos === -1 ? (rollValue === 6 ? 0 : -1) : pos + rollValue;
                if (nextPos <= 57 && nextPos !== -1) {
                    validMovesCount++;
                    lastValidTokenIndex = idx;
                }
            });

            if (validMovesCount === 0 && !isRemote) {
                const nextPlayer = getNextPlayer(color, prev.positions);
                setTimeout(() => {
                    if (isHost && isLobbyConnected) {
                        broadcastAction('TURN_SWITCH', { nextPlayer });
                    }
                    setLocalGameState((s: any) => ({
                        ...s,
                        gamePhase: 'rolling',
                        currentPlayer: getNextPlayer(s.currentPlayer, s.positions),
                        diceValue: null,
                        consecutiveSixes: 0,
                        timeLeft: 15
                    }));
                }, 1000);
            }

            const allValidAreFromHome = validMovesCount > 0 && prev.positions[targetColor].every((pos: number) => {
                const nextPos = pos === -1 ? (rollValue === 6 ? 0 : -1) : pos + rollValue;
                if (nextPos <= 57 && nextPos !== -1) {
                    return pos === -1;
                }
                return true;
            });

            if ((validMovesCount === 1 || allValidAreFromHome) && !isRemote) {
                const currentPlayerInfo = initialPlayers.find(p => p.color === color);
                const isBot = currentPlayerInfo?.isAi;
                if (!isBot) {
                    if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
                    autoMoveTimeoutRef.current = setTimeout(() => {
                        if (!isHost && isLobbyConnected) {
                            sendIntent('REQUEST_MOVE', { color: targetColor, tokenIndex: lastValidTokenIndex, diceValue: rollValue });
                        } else {
                            moveToken(targetColor, lastValidTokenIndex, rollValue);
                        }
                    }, 1500);
                }
            }

            return {
                ...prev,
                diceValue: rollValue,
                consecutiveSixes: rollValue === 6 ? prev.consecutiveSixes + 1 : 0,
                gamePhase: validMovesCount > 0 ? 'moving' : 'rolling',
                timeLeft: 15,
                lastUpdate: Date.now()
            };
        });
    }, [localGameState.winner, localGameState.currentPlayer, localGameState.afkStats, localGameState.teamup.isConnected, initialPlayers, address, isHost, isLobbyConnected, broadcastAction, setLocalGameState, playerCount, getNextPlayer, autoMoveTimeoutRef, sendIntent, moveToken]);

    const handleUsePower = useCallback((color: PlayerColor) => {
        setLocalGameState((prev: any) => {
            if (prev.currentPlayer !== color || prev.gamePhase !== 'rolling') return prev;
            const power = prev.playerPowers[color as PlayerColor];
            if (!power) return prev;

            let nextState = { ...prev };
            const myColor = color as PlayerColor;

            if (power === 'shield') {
                const tokensOnBoard = prev.positions[myColor]
                    .map((pos: number, idx: number) => (pos >= 0 && pos < 52) ? idx : -1)
                    .filter((idx: number) => idx !== -1);
                
                const newShields = [...prev.activeShields];
                tokensOnBoard.forEach((idx: number) => {
                    if (!newShields.some(s => s.color === myColor && s.tokenIdx === idx)) {
                        newShields.push({ color: myColor, tokenIdx: idx });
                    }
                });
                nextState.activeShields = newShields;
            } 
            else if (power === 'bomb') {
                let target: { color: PlayerColor, idx: number } | null = null;
                let minDistance = 7;

                prev.positions[myColor].forEach((myPos: number) => {
                    if (myPos < 0 || myPos >= 52) return;
                    const myPt = playerPaths[myColor][myPos];

                    (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
                        if (oppColor === myColor) return;
                        if (playerCount === '2v2' && oppColor === getTeammateColor(myColor, playerCount)) return;

                        prev.positions[oppColor].forEach((oppPos: number, oppIdx: number) => {
                            if (oppPos < 0 || oppPos >= 52) return;
                            const oppPt = playerPaths[oppColor][oppPos];
                            for (let s = 1; s <= 6; s++) {
                                const checkPos = myPos + s;
                                if (checkPos >= 52) break;
                                const checkPt = playerPaths[myColor][checkPos];
                                if (checkPt.r === oppPt.r && checkPt.c === oppPt.c) {
                                    if (s < minDistance) {
                                        minDistance = s;
                                        target = { color: oppColor, idx: oppIdx };
                                    }
                                }
                            }
                        });
                    });
                });

                if (target) {
                    const t = target as { color: PlayerColor, idx: number };
                    const newPositions = { ...prev.positions };
                    newPositions[t.color] = [...newPositions[t.color]];
                    newPositions[t.color][t.idx] = -1;
                    nextState.positions = newPositions;
                    nextState.captureMessage = `BOMB! ${t.color} token removed!`;
                    audio.playCapture();
                }
            }
            else if (power === 'boost') {
                nextState.activeBoost = myColor;
                nextState.captureMessage = "BOOST! Next move +6 steps.";
            }
            else if (power === 'warp') {
                const firstTokenIdx = prev.positions[myColor].findIndex((p: number) => p >= 0 && p < 42);
                if (firstTokenIdx !== -1) {
                    const newPos = { ...prev.positions };
                    newPos[myColor] = [...newPos[myColor]];
                    const targetPos = Math.min(newPos[myColor][firstTokenIdx] + 10, 51);
                    newPos[myColor][firstTokenIdx] = targetPos;
                    nextState.positions = newPos;
                    nextState.captureMessage = "WARP! Forward 10 squares.";
                    audio.playMove();
                }
            }

            return {
                ...nextState,
                playerPowers: { ...prev.playerPowers, [myColor]: null },
                lastUpdate: Date.now()
            };
        });
    }, [playerPaths, playerCount, audio, setLocalGameState]);

    const handleTokenClick = useCallback((color: PlayerColor, tokenIndex: number) => {
        if (localGameState.gamePhase !== 'moving' || localGameState.diceValue === null) return;

        const actingPlayerColor = localGameState.currentPlayer;
        const myPlayer = initialPlayers.find(p => 
            (address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || 
            (!address && !p.isAi)
        );
        const myColor = myPlayer?.color;
        const isMyTurn = actingPlayerColor === myColor;
        const isCurrentlyBot = initialPlayers.find(p => p.color === actingPlayerColor)?.isAi;

        const teammateColor = getTeammateColor(myColor as PlayerColor, playerCount);
        const allMyTokensFinished = myColor ? localGameState.positions[myColor].every((pos: number) => pos === 57) : false;
        const isTeammateAssist = playerCount === '2v2' && color === teammateColor && allMyTokensFinished && isMyTurn;

        if (!isMyTurn) return;
        if (isCurrentlyBot) return;
        if (color !== myColor && !isTeammateAssist) return;

        if (!isHost && isLobbyConnected) {
            sendIntent('REQUEST_MOVE', { color, tokenIndex, diceValue: localGameState.diceValue });
            return;
        }

        moveToken(color, tokenIndex, localGameState.diceValue);
    }, [localGameState.gamePhase, localGameState.diceValue, localGameState.currentPlayer, localGameState.positions, playerCount, isHost, isLobbyConnected, sendIntent, moveToken, address, initialPlayers]);

    return {
        moveToken,
        handleRoll,
        handleUsePower,
        handleTokenClick
    };
}
