import { useCallback, useRef } from 'react';
import { PlayerColor, PowerType } from '@/lib/types';
import { processMove, getTeammateColor, handleThreeSixes, getNextPlayer as getNextPlayerCore } from '@/lib/gameLogic';
import { Player } from './useGameEngine';
import { Point, ColorCorner, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from '@/lib/boardLayout';
import { 
    BOARD_FINISH_INDEX, 
    BASE_INDEX, 
    DICE_MAX, 
    DICE_ROLL_SIX, 
    HOME_LANE_START_INDEX 
} from '@/lib/constants';

interface UseGameActionsProps {
    localGameState: any;
    setLocalGameState: React.Dispatch<React.SetStateAction<any>>;
    initialPlayers: Player[];
    address: string | undefined;
    isHost: boolean;
    isLobbyConnected: boolean;
    broadcastAction: (type: string, payload?: any, fullState?: any) => void;
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


    const bettingWindowIdRef = useRef<string | null>(null);
    const rollingRef = useRef<boolean>(false);

    const getNextPlayer = useCallback((current: PlayerColor, currentPositions: any): PlayerColor => {
        const activeForTurns = activeColorsArr.filter(color => {
            const hasTokens = currentPositions[color].some((p: number) => p !== BOARD_FINISH_INDEX);
            if (playerCount === '2v2') {
                const teammate = getTeammateColor(color, playerCount);
                const teammateHasTokens = teammate ? currentPositions[teammate].some((p: number) => p !== BOARD_FINISH_INDEX) : false;
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
        if (isLobbyConnected && !isHost && !isRemote) {
            console.log('🏃 [Guest] Sending REQUEST_MOVE intent');
            sendIntent('REQUEST_MOVE', { color, tokenIndex, diceValue: steps });
            return;
        }

        if (autoMoveTimeoutRef.current) {
            clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = null;
        }

        setLocalGameState((prev: any) => {
            if (prev.gamePhase !== 'moving' && !isRemote) return prev;
            
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

            const isBonusTurn = (steps === DICE_ROLL_SIX || captured || newState.winner);
            const finalState = {
                ...prev,
                ...newState,
                diceValue: isBonusTurn ? null : newState.diceValue, // Clear it for next roll
                captureMessage: captured ? `Captured! Bonus roll for ${color}!` : null,
                strikes: { ...prev.strikes, [color]: 0 },
                consecutiveSixes: (newState.currentPlayer !== color) ? 0 : prev.consecutiveSixes,
                gamePhase: 'rolling', // Next turn (or bonus turn) always starts with a roll
                timeLeft: (newState.currentPlayer !== prev.currentPlayer) ? 15 : prev.timeLeft,
                lastUpdate: Date.now()
            };

            if (isHost && isLobbyConnected && !isRemote) {
                // 🔊 Broadcast action WITH full state injection
                broadcastAction('MOVE_TOKEN', { 
                    payload: { color, tokenIndex, steps, targetPosition: newState.positions[color][tokenIndex] }
                }, finalState);

                if (newState.currentPlayer !== prev.currentPlayer || isBonusTurn) {
                    if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
                    setTimeout(() => {
                        setLocalGameState((latest: any) => {
                            const nextPlayer = isBonusTurn ? color : newState.currentPlayer;
                            const switchState = { 
                                ...newState, 
                                currentPlayer: nextPlayer, 
                                diceValue: null, 
                                gamePhase: 'rolling',
                                lastUpdate: Date.now()
                            };
                            broadcastAction('TURN_SWITCH', { nextPlayer }, switchState);
                            return switchState;
                        });
                    }, 800);
                }
            }

            if (newState.positions[color][tokenIndex] !== prev.positions[color][tokenIndex]) audio.playMove();
            if (captured) audio.playCapture();
            if (newState.winner && !prev.winner) {
                audio.playWin();
                triggerWinConfetti();
                recordWin(color);
            }

            return finalState;
        });
    }, [isHost, isLobbyConnected, sendIntent, broadcastAction, audio, playerCount, playerPaths, activeColorsArr, colorCorner, setLocalGameState, autoMoveTimeoutRef, triggerWinConfetti, recordWin]);

    const handleRoll = useCallback(async (value?: number, isRemote = false) => {
        if (localGameState.winner || localGameState.isRolling || localGameState.diceValue !== null || rollingRef.current) return;
        
        rollingRef.current = true;

        const isCurrentlyBot = initialPlayers.find(p => p.color === localGameState.currentPlayer)?.isAi;
        
        // 🚨 CRITICAL FIX: Bots are host-only in lobby, but in local match, we are the host.
        if (!isRemote && (isLobbyConnected && !isHost) && isCurrentlyBot) {
            rollingRef.current = false;
            return;
        }

        // 🎲 Guest: Send intent to Host
        if (isLobbyConnected && !isHost && !isRemote) {
            console.log('🎲 [Guest] Sending REQUEST_ROLL intent');
            sendIntent('REQUEST_ROLL', { value });
            rollingRef.current = false;
            return;
        }

        // 🎰 Host: Open betting window (Only for human players)
        if (isHost && isLobbyConnected && !isRemote && !isCurrentlyBot) {
            await startBettingWindow('dice_roll');
        }

        // 1. Start Tumble Phase (1200ms)
        if (isHost && isLobbyConnected && !isRemote) {
            broadcastAction('ROLL_DICE', { isRolling: true, diceValue: null });
        }
        setLocalGameState((prev: any) => ({ ...prev, isRolling: true, diceValue: null }));
        
        // Wait for the tumble animation to finish (synced with Dice components)
        await new Promise(r => setTimeout(r, 1200));

        // 2. Generate and Set Result
        const rollValue = value || Math.floor(Math.random() * 6) + 1;
        
        // 🚨 Broadcast result to Guests
        if (isHost && isLobbyConnected && !isRemote) {
            broadcastAction('ROLL_DICE', { isRolling: false, diceValue: rollValue });
        }

        setLocalGameState((prev: any) => ({ 
            ...prev, 
            isRolling: false, 
            diceValue: rollValue,
            lastUpdate: Date.now()
        }));
        
        // Brief pause for visual impact of the landing face
        await new Promise(r => setTimeout(r, 200));

        // 3. Landing & Decision Phase
        setLocalGameState((prev: any) => {
            if (prev.gamePhase !== 'rolling' || prev.winner) {
                rollingRef.current = false;
                return prev;
            }

            const color = prev.currentPlayer;
            const teammate = (playerCount === '2v2') ? getTeammateColor(color, playerCount) : null;
            const isSelfFinished = prev.positions[color].every((p: number) => p === BOARD_FINISH_INDEX);
            const targetColor = (playerCount === '2v2' && isSelfFinished && teammate) ? teammate : color;

            const { isThreeSixes } = handleThreeSixes(prev.consecutiveSixes, rollValue);

            if (isThreeSixes) {
                setTimeout(() => {
                    setLocalGameState((latest: any) => {
                        const nextPlayer = getNextPlayer(latest.currentPlayer, latest.positions);
                        const switchState = { 
                            ...latest, 
                            currentPlayer: nextPlayer, 
                            diceValue: null, 
                            gamePhase: 'rolling', 
                            consecutiveSixes: 0,
                            timeLeft: 15,
                            lastUpdate: Date.now()
                        };
                        if (isHost && isLobbyConnected) broadcastAction('TURN_SWITCH', { nextPlayer }, switchState);
                        rollingRef.current = false;
                        return switchState;
                    });
                }, 1000);
                return { ...prev, gamePhase: 'rolling', consecutiveSixes: 0 };
            }

            let validMovesCount = 0;
            let lastValidTokenIndex = -1;
            
            prev.positions[targetColor].forEach((pos: number, idx: number) => {
                const nextPos = pos === BASE_INDEX ? (rollValue === DICE_ROLL_SIX ? 0 : BASE_INDEX) : pos + rollValue;
                if (nextPos <= BOARD_FINISH_INDEX && nextPos !== BASE_INDEX) {
                    validMovesCount++;
                    lastValidTokenIndex = idx;
                }
            });

            if (validMovesCount === 0) {
                console.log(`🎲 [Engine] No valid moves for ${color}. Switching turn.`);
                setTimeout(() => {
                    setLocalGameState((latest: any) => {
                        // Use latest state to find next player
                        const nextPlayer = getNextPlayer(latest.currentPlayer, latest.positions);
                        const switchState = { 
                            ...latest, 
                            currentPlayer: nextPlayer, 
                            diceValue: null, 
                            gamePhase: 'rolling', 
                            consecutiveSixes: 0,
                            timeLeft: 15,
                            lastUpdate: Date.now()
                        };
                        console.log(`🎲 [Engine] Auto-switching to ${nextPlayer}`);
                        if (isHost && isLobbyConnected) broadcastAction('TURN_SWITCH', { nextPlayer }, switchState);
                        rollingRef.current = false;
                        return switchState;
                    });
                }, 1500); // 1.5s delay so user can see the dice
                return { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'moving' };
            }

            // --- Zero-Click Auto-Move Flow ---
            const allAtHome = prev.positions[targetColor].every((p: number) => p === -1);
            const tokensOnBoard = prev.positions[targetColor].filter((p: number) => p >= 0 && p < 57).length;
            const isForcedStart = allAtHome && rollValue === 6;
            const isSingleMove = validMovesCount === 1;
            const isEndGame = tokensOnBoard === 1 && validMovesCount === 1;

            if ((isSingleMove || isForcedStart || isEndGame) && !isRemote && !isCurrentlyBot) {
                console.log(`🎲 [Engine] Auto-move triggered (forced=${isForcedStart}, single=${isSingleMove}, endGame=${isEndGame})`);
                if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
                autoMoveTimeoutRef.current = setTimeout(() => {
                    moveToken(targetColor, lastValidTokenIndex, rollValue);
                    rollingRef.current = false;
                    autoMoveTimeoutRef.current = null;
                }, 1500); // 1.5s delay for manual override
                return { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'moving' };
            }

            // Normal Flow: Just change phase and wait for user/bot interaction
            rollingRef.current = false;
            const finalState = { 
                ...prev, 
                gamePhase: 'moving' as const, 
                consecutiveSixes: (rollValue === 6) ? prev.consecutiveSixes + 1 : 0 
            };
            
            if (isHost && isLobbyConnected && !isRemote) {
                broadcastAction('ENGINE_STATE', {}, finalState);
            }

            return finalState;
        });
    }, [isHost, isLobbyConnected, sendIntent, broadcastAction, setLocalGameState, initialPlayers, localGameState.winner, localGameState.isRolling, localGameState.diceValue, localGameState.currentPlayer, localGameState.afkStats, startBettingWindow, playerCount, getNextPlayer, moveToken]);

    const handleUsePower = useCallback((color: PlayerColor) => {
        setLocalGameState((prev: any) => {
            if (prev.currentPlayer !== color || prev.gamePhase !== 'rolling') return prev;
            const power = prev.playerPowers[color as PlayerColor];
            if (!power) return prev;

            let nextState = { ...prev };
            const myColor = color as PlayerColor;

            if (power === 'shield') {
                const tokensOnBoard = prev.positions[myColor]
                    .map((pos: number, idx: number) => (pos >= 0 && pos < HOME_LANE_START_INDEX) ? idx : -1)
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
                    if (myPos < 0 || myPos >= HOME_LANE_START_INDEX) return;
                    const myPt = playerPaths[myColor][myPos];

                    (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
                        if (oppColor === myColor) return;
                        if (playerCount === '2v2' && oppColor === getTeammateColor(myColor, playerCount)) return;

                        prev.positions[oppColor].forEach((oppPos: number, oppIdx: number) => {
                            if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) return;
                            const oppPt = playerPaths[oppColor][oppPos];
                            for (let s = 1; s <= DICE_MAX; s++) {
                                const checkPos = myPos + s;
                                if (checkPos >= HOME_LANE_START_INDEX) break;
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
                    newPositions[t.color][t.idx] = BASE_INDEX;
                    nextState.positions = newPositions;
                    nextState.captureMessage = `BOMB! ${t.color} token removed!`;
                    audio.playCapture();
                }
            }
            else if (power === 'boost') {
                nextState.activeBoost = myColor;
                nextState.captureMessage = `BOOST! Next move +${DICE_MAX} steps.`;
            }
            else if (power === 'warp') {
                const firstTokenIdx = prev.positions[myColor].findIndex((p: number) => p >= 0 && p < HOME_LANE_START_INDEX - 10);
                if (firstTokenIdx !== -1) {
                    const newPos = { ...prev.positions };
                    newPos[myColor] = [...newPos[myColor]];
                    const targetPos = Math.min(newPos[myColor][firstTokenIdx] + 10, HOME_LANE_START_INDEX - 1);
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
        const allMyTokensFinished = myColor ? localGameState.positions[myColor].every((pos: number) => pos === BOARD_FINISH_INDEX) : false;
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
