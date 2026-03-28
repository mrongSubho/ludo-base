import { useCallback, useRef, useEffect } from 'react';
import { PlayerColor, PowerType } from '@/lib/types';
import { processMove, getTeammateColor, handleThreeSixes, getNextPlayer as getNextPlayerCore } from '@/lib/gameLogic';
import { Player } from './useGameEngine';
import { Point, ColorCorner, SAFE_POSITIONS as GLOBAL_SAFE_POINTS, getBoardCoordinate } from '@/lib/boardLayout';
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
    const stateRef = useRef(localGameState);

    useEffect(() => {
        stateRef.current = localGameState;
    }, [localGameState]);

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

        const currentState = stateRef.current;
        if (currentState.gamePhase !== 'moving' && !isRemote) return;

        const { newState, captured } = processMove(
            currentState,
            color,
            tokenIndex,
            steps,
            playerCount,
            colorCorner,
            currentState.currentPlayer,
            activeColorsArr
        );

        let pTurnSwitchPending = false;
        let pNextPlayer: PlayerColor | null = null;
        const isBonusTurn = (steps === DICE_ROLL_SIX || captured || newState.winner);
        
        if (isBonusTurn && !currentState.winner) {
            newState.currentPlayer = color;
        }

        const finalState = {
            ...currentState,
            ...newState,
            diceValue: isBonusTurn ? null : newState.diceValue, 
            captureMessage: captured ? `Captured! Bonus roll for ${color}!` : null,
            strikes: { ...currentState.strikes, [color]: 0 },
            consecutiveSixes: (newState.currentPlayer !== color) ? 0 : currentState.consecutiveSixes,
            gamePhase: 'landing' as const, // Buffer to prevent AI state stomping
            timeLeft: 15, // Reset timer during animation
            lastUpdate: Date.now()
        };

        if (isHost && !isRemote) {
            if (newState.currentPlayer !== currentState.currentPlayer || isBonusTurn) {
                pTurnSwitchPending = true;
                pNextPlayer = isBonusTurn ? color : newState.currentPlayer;
            }
        }

        setLocalGameState(finalState);

        if (isHost && isLobbyConnected && !isRemote) {
            // We broadcast LIVE state immediately to show the target position
            broadcastAction('MOVE_TOKEN', { 
                payload: { color, tokenIndex, steps, targetPosition: newState.positions[color][tokenIndex] }
            }, finalState);
        }

        if (newState.positions[color][tokenIndex] !== currentState.positions[color][tokenIndex]) audio.playMove();
        if (captured) audio.playCapture();
        if (newState.winner && !currentState.winner) {
            audio.playWin();
            triggerWinConfetti();
            recordWin(color);
        }

        // 🚀 Executing side effects OUTSIDE the setLocalGameState!
        if (pTurnSwitchPending) {
            if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = setTimeout(() => {
                setLocalGameState((latest: any) => {
                    const switchState = { 
                        ...latest, 
                        currentPlayer: pNextPlayer, 
                        diceValue: null, 
                        gamePhase: 'rolling', // Now it's officially the next turn
                        lastUpdate: Date.now(),
                        timeLeft: 15 // Reset for next turn
                    };
                    if (isLobbyConnected) broadcastAction('TURN_SWITCH', { nextPlayer: pNextPlayer }, switchState);
                    return switchState;
                });
            }, 800) as any;
        }
    }, [isHost, isLobbyConnected, sendIntent, broadcastAction, audio, playerCount, activeColorsArr, colorCorner, setLocalGameState, autoMoveTimeoutRef, triggerWinConfetti, recordWin]);

    const handleRoll = useCallback(async (value?: number, isRemote = false) => {
        // 🔧 FIX 3: Read from stateRef instead of stale closure for guard check
        const guardState = stateRef.current;
        if (rollingRef.current || guardState.isRolling || guardState.gamePhase !== 'rolling') return;
        
        rollingRef.current = true;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.afkStats?.[color]?.isKicked;
        
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

        // 1. Start Tumble Phase
        if (isHost && isLobbyConnected && !isRemote) {
            broadcastAction('ROLL_DICE', { isRolling: true, diceValue: null });
        }
        setLocalGameState((prev: any) => ({ ...prev, isRolling: true, diceValue: null, timeLeft: 15 }));
        
        let rollValue: number = value || 0;
        const tumblePromise = new Promise(r => setTimeout(r, 1200));

        // 2. Generate and Set Result (Zero-Trust via Edge Function)
        if (!value) {
            if (!isCurrentlyBot && address) {
                try {
                    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/roll-dice`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
                        },
                        body: JSON.stringify({ matchId: localGameState.matchId || 'local', walletAddress: address, actionId: Date.now() })
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        rollValue = data.result;
                    } else {
                        throw new Error('Edge RNG failed');
                    }
                } catch (err) {
                    console.error("Zero-Trust RNG failed, falling back to local RNG", err);
                    rollValue = Math.floor(Math.random() * 6) + 1;
                }
            } else {
                // Bots / AFK Auto-Play
                rollValue = Math.floor(Math.random() * 6) + 1;
            }
        }

        // Wait for the tumble animation to finish
        await tumblePromise;

        
        // 🚨 Broadcast result to Guests
        if (isHost && isLobbyConnected && !isRemote) {
            broadcastAction('ROLL_DICE', { isRolling: false, diceValue: rollValue });
        }

        setLocalGameState((prev: any) => ({ 
            ...prev, 
            isRolling: false, 
            diceValue: rollValue,
            lastUpdate: Date.now(),
            timeLeft: 15 // Reset timer during animation
        }));
        
        // Brief pause for visual impact of the landing face
        await new Promise(r => setTimeout(r, 200));

        // Break the asynchronous updater cycle using stateRef
        const currentState = stateRef.current;
        if (currentState.gamePhase !== 'rolling' || currentState.winner) {
            rollingRef.current = false;
            return;
        }


        const teammate = (playerCount === '2v2') ? getTeammateColor(color, playerCount) : null;
        const isSelfFinished = currentState.positions[color].every((p: number) => p === BOARD_FINISH_INDEX);
        const targetColor = (playerCount === '2v2' && isSelfFinished && teammate) ? teammate : color;

        let pDelayedAction: 'turnSwitch' | 'autoMove' | null = null;
        let pNextPlayer: PlayerColor | null = null;
        let pTargetColor: PlayerColor = targetColor;
        let pLastValidTokenIndex = -1;
        let pFinalStateForBroadcast: any = null;

        const { isThreeSixes } = handleThreeSixes(currentState.consecutiveSixes, rollValue);

        if (isThreeSixes) {
            pNextPlayer = getNextPlayer(color, currentState.positions);
            pDelayedAction = 'turnSwitch';
            // 🔧 FIX 2: Use functional updater to avoid clobbering concurrent state
            setLocalGameState((prev: any) => {
                pFinalStateForBroadcast = { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'rolling', consecutiveSixes: 0 };
                return pFinalStateForBroadcast;
            });
        } else {
            let validMovesCount = 0;
            let lastValidTokenIndex = -1;
            
            currentState.positions[targetColor].forEach((pos: number, idx: number) => {
                const nextPos = pos === BASE_INDEX ? (rollValue === DICE_ROLL_SIX ? 0 : BASE_INDEX) : pos + rollValue;
                if (nextPos <= BOARD_FINISH_INDEX && nextPos !== BASE_INDEX) {
                    validMovesCount++;
                    lastValidTokenIndex = idx;
                }
            });

            if (validMovesCount === 0) {
                console.log(`🎲 [Engine] No valid moves for ${color}. Switching turn.`);
                pNextPlayer = getNextPlayer(color, currentState.positions);
                pDelayedAction = 'turnSwitch';
                // 🔧 FIX 2: Functional updater
                setLocalGameState((prev: any) => {
                    pFinalStateForBroadcast = { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'rolling' };
                    return pFinalStateForBroadcast;
                });
            } else {
                // --- Zero-Click Auto-Move Flow ---
                const allAtHome = currentState.positions[targetColor].every((p: number) => p === -1);
                const tokensOnBoard = currentState.positions[targetColor].filter((p: number) => p >= 0 && p < 57).length;
                const isForcedStart = allAtHome && rollValue === 6;
                const isSingleMove = validMovesCount === 1;
                const isEndGame = tokensOnBoard === 1 && validMovesCount === 1;

                if ((isSingleMove || isForcedStart || isEndGame) && !isRemote && !isCurrentlyBot) {
                    console.log(`🎲 [Engine] Auto-move triggered (forced=${isForcedStart}, single=${isSingleMove}, endGame=${isEndGame})`);
                    pLastValidTokenIndex = lastValidTokenIndex;
                    pDelayedAction = 'autoMove';
                    // 🔧 FIX 2: Functional updater
                    setLocalGameState((prev: any) => {
                        pFinalStateForBroadcast = { ...prev, isRolling: false, diceValue: rollValue, gamePhase: 'moving' };
                        return pFinalStateForBroadcast;
                    });
                } else {
                    // Normal Flow: Just change phase and wait for user/bot interaction
                    rollingRef.current = false;
                    // 🔧 FIX 2: Functional updater
                    setLocalGameState((prev: any) => {
                        pFinalStateForBroadcast = { 
                            ...prev, 
                            isRolling: false,
                            diceValue: rollValue,
                            gamePhase: 'moving' as const, 
                            consecutiveSixes: (rollValue === 6) ? prev.consecutiveSixes + 1 : 0,
                            lastUpdate: Date.now(),
                            timeLeft: 15
                        };
                        return pFinalStateForBroadcast;
                    });
                }
            }
        }

        // 🚀 Executing side effects OUTSIDE the setLocalGameState!
        if (isHost && isLobbyConnected && !isRemote && pFinalStateForBroadcast) {
            broadcastAction('ENGINE_STATE', {}, pFinalStateForBroadcast);
        }

        if (pDelayedAction === 'turnSwitch') {
            await new Promise(r => setTimeout(r, 2000)); // Delay for visual clarity
            setLocalGameState((latest: any) => {
                const switchState = { 
                    ...latest, 
                    currentPlayer: pNextPlayer, 
                    diceValue: null, 
                    gamePhase: 'rolling', 
                    consecutiveSixes: 0,
                    timeLeft: 15,
                    lastUpdate: Date.now()
                };
                console.log(`🎲 [Engine] Auto-switching to ${pNextPlayer}`);
                if (isHost && isLobbyConnected) broadcastAction('TURN_SWITCH', { nextPlayer: pNextPlayer }, switchState);
                rollingRef.current = false;
                return switchState;
            });
        } else if (pDelayedAction === 'autoMove') {
            if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = setTimeout(() => {
                moveToken(pTargetColor, pLastValidTokenIndex, rollValue);
                rollingRef.current = false;
                autoMoveTimeoutRef.current = null;
            }, 1500) as any;
        }

    }, [isHost, isLobbyConnected, sendIntent, broadcastAction, setLocalGameState, initialPlayers, localGameState.winner, localGameState.isRolling, localGameState.diceValue, localGameState.currentPlayer, localGameState.afkStats, startBettingWindow, playerCount, getNextPlayer, moveToken, address]);

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
                    const myPt = getBoardCoordinate(myPos, myColor, colorCorner);
                    if (!myPt) return;

                    (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
                        if (oppColor === myColor) return;
                        if (playerCount === '2v2' && oppColor === getTeammateColor(myColor, playerCount)) return;

                        prev.positions[oppColor].forEach((oppPos: number, oppIdx: number) => {
                            if (oppPos < 0 || oppPos >= HOME_LANE_START_INDEX) return;
                            const oppPt = getBoardCoordinate(oppPos, oppColor, colorCorner);
                            if (!oppPt) return;
                            
                            for (let s = 1; s <= DICE_MAX; s++) {
                                const checkPos = myPos + s;
                                if (checkPos >= HOME_LANE_START_INDEX) break;
                                const checkPt = getBoardCoordinate(checkPos, myColor, colorCorner);
                                if (!checkPt) continue;
                                
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
    }, [playerCount, colorCorner, audio, setLocalGameState]);

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
