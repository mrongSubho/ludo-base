import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';
import confetti from 'canvas-confetti';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { PlayerColor, PowerType } from '@/lib/types';
import { handleThreeSixes, processMove, getNextPlayer as getNextPlayerCore, getTeammateColor } from '@/lib/gameLogic';
import { getBestMove } from '@/lib/aiEngine';
import { Point, PathCell, ColorCorner, assignCornersFFA, assignCorners2v2, buildPlayerPaths, shufflePlayers, SAFE_POSITIONS as GLOBAL_SAFE_POINTS } from '@/lib/boardLayout';
import { recordMatchResult } from '@/lib/matchRecorder';
import { useAudio } from '../app/hooks/useAudio';

export interface Player {
    name: string;
    level: number;
    avatar: string;
    color: 'green' | 'red' | 'yellow' | 'blue';
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    isAi?: boolean;
    walletAddress?: string;
}

interface UseGameEngineProps {
    initialPlayers: Player[];
    playerCount: '1v1' | '4P' | '2v2';
    gameMode: 'classic' | 'power' | 'snakes';
    isBotMatch: boolean;
    playerPaths: Record<string, Point[]>;
    colorCorner: ColorCorner;
    pathCells: PathCell[];
    setBoardConfig: React.Dispatch<React.SetStateAction<{
        players: Player[];
        colorCorner: ColorCorner;
        playerPaths: Record<string, Point[]>;
    }>>;
}

export function useGameEngine({
    initialPlayers,
    playerCount,
    gameMode,
    isBotMatch,
    playerPaths,
    colorCorner,
    pathCells,
    setBoardConfig
}: UseGameEngineProps) {
    const { playMove, playCapture, playWin, playTurn } = useAudio();
    const { address } = useAccount();
    const hasRecordedWin = useRef<boolean>(false);
    
    // HUMAN AUTO-MOVE REF
    const autoMoveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const activeColorsArr = useMemo(() => initialPlayers.map(p => p.color as PlayerColor), [initialPlayers]);

    const {
        gameState: networkGameState,
        isHost,
        sendIntent,
        broadcastAction,
        roomId,
        isLobbyConnected,
        updateGameState,
        lastIntent,
        clearIntent
    } = useTeamUpContext();

    const [localGameState, setLocalGameState] = useState({
        positions: {
            green: [-1, -1, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
        currentPlayer: initialPlayers[0]?.color as PlayerColor || 'green',
        diceValue: null as number | null,
        gamePhase: 'rolling' as 'rolling' | 'moving',
        winner: null as string | null,
        captureMessage: null as string | null,
        winners: [] as string[],
        invalidMove: false,
        isThinking: false,
        timeLeft: 15,
        strikes: { green: 0, red: 0, yellow: 0, blue: 0 } as Record<PlayerColor, number>,
        powerTiles: (gameMode === 'power' ? pathCells
            .filter(c => c.cls === 'board-cell')
            .sort(() => Math.random() - 0.5)
            .slice(0, 4)
            .map(c => ({ r: c.row, c: c.col })) : []) as { r: number, c: number }[],
        playerPowers: { green: null, red: null, yellow: null, blue: null } as Record<PlayerColor, PowerType | null>,
        activeTraps: [] as { r: number, c: number, owner: PlayerColor }[],
        activeShields: [] as { color: PlayerColor, tokenIdx: number }[],
        activeBoost: null as PlayerColor | null,
        consecutiveSixes: 0,
        afkStats: {
            green: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            yellow: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        } as Record<PlayerColor, { isAutoPlaying: boolean; consecutiveTurns: number; totalTriggers: number; isKicked: boolean }>,
        idleWarning: null as { player: PlayerColor; timeLeft: number } | null,
        teamup: {
            targetId: '',
            isConnected: false,
            isHost: false,
            status: 'idle' as 'idle' | 'host' | 'guest'
        },
        isStarted: false,
        lastUpdate: Date.now()
    });

    const [processedActionUpdate, setProcessedActionUpdate] = useState<number>(0);

    const checkWin = useCallback((positions: typeof localGameState.positions, color: Player['color']) => {
        return positions[color].every((pos) => pos === 57);
    }, []);

    const getNextPlayer = useCallback((current: PlayerColor): PlayerColor => {
        // Calculate which colors stay in the turn rotation
        const activeForTurns = activeColorsArr.filter(color => {
            const hasTokens = localGameState.positions[color].some(p => p !== 57);
            if (playerCount === '2v2') {
                const teammate = getTeammateColor(color, playerCount);
                const teammateHasTokens = teammate ? localGameState.positions[teammate].some(p => p !== 57) : false;
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
    }, [activeColorsArr, playerCount, colorCorner, localGameState.positions]);

    const resetGame = useCallback(() => {
        const newCC = playerCount === '2v2'
            ? assignCorners2v2()
            : assignCornersFFA(playerCount as '1v1' | '4P');
        const newPlayers = shufflePlayers(playerCount, isBotMatch, newCC) as Player[];

        setBoardConfig({
            players: newPlayers,
            colorCorner: newCC,
            playerPaths: buildPlayerPaths(newCC)
        });
        setLocalGameState({
            positions: {
                green: [-1, -1, -1, -1],
                red: [-1, -1, -1, -1],
                yellow: [-1, -1, -1, -1],
                blue: [-1, -1, -1, -1],
            },
            currentPlayer: newPlayers[0].color,
            diceValue: null,
            gamePhase: 'rolling',
            winner: null,
            captureMessage: null,
            winners: [],
            invalidMove: false,
            isThinking: false,
            timeLeft: 15,
            strikes: { green: 0, red: 0, yellow: 0, blue: 0 },
            powerTiles: (gameMode === 'power' ? pathCells
                .filter(c => c.cls === 'board-cell')
                .sort(() => Math.random() - 0.5)
                .slice(0, 4)
                .map(c => ({ r: c.row, c: c.col })) : []) as { r: number, c: number }[],
            playerPowers: { green: null, red: null, yellow: null, blue: null },
            activeTraps: [],
            activeShields: [],
            activeBoost: null,
            consecutiveSixes: 0,
            afkStats: {
                green: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
                red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
                yellow: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
                blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            },
            idleWarning: null,
            teamup: { targetId: '', isConnected: false, isHost: false, status: 'idle' },
            isStarted: true,
            lastUpdate: Date.now()
        });
    }, [playerCount, gameMode, pathCells, isBotMatch, setBoardConfig]);

    const recordWin = useCallback(async (winnerColor: Player['color']) => {
        const player = initialPlayers.find(p => p.color === winnerColor);
        if (!player) return;

        // --- Reward Integrity ---
        const myPlayer = initialPlayers.find(p => p.walletAddress?.toLowerCase() === address?.toLowerCase());
        const isMeKicked = myPlayer ? localGameState.afkStats[myPlayer.color].isKicked : false;
        
        // If the local user was kicked, they forfeit all stats and rewards 
        // regardless of whether their AI replacement or teammate won.
        if (isMeKicked) {
            console.log("Kicked player forfeited rewards.");
            return;
        }

        const data = localStorage.getItem('ludo-leaderboard');
        const stats = data ? JSON.parse(data) : {};

        // In 2v2, if a kicked teammate's AI replacement finishes, the active human teammate still gets rewards.
        // We ensure we attribute the win based on the active player.
        
        // Update stats for the winner
        if (!stats[player.name]) {
            stats[player.name] = { name: player.name, color: player.color, wins: 0, lastWin: 0 };
        }

        stats[player.name].wins += 1;
        stats[player.name].lastWin = Date.now();
        stats[player.name].color = player.color;

        localStorage.setItem('ludo-leaderboard', JSON.stringify(stats));

        // Supabase Match Recording
        if (address && player.walletAddress === address && !hasRecordedWin.current) {
            hasRecordedWin.current = true;
            const participants = initialPlayers
                .map(p => p.walletAddress)
                .filter(Boolean) as string[];

            await recordMatchResult(address, roomId || 'local', gameMode, participants);
        }
    }, [initialPlayers, address, roomId, gameMode, localGameState.afkStats]);

    const triggerWinConfetti = useCallback(() => {
        const duration = 5 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0, colors: ['#A8E6CF', '#FFD3B6', '#D4F1F4', '#FFEFBA'] };

        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

        const interval: any = setInterval(function () {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) return clearInterval(interval);

            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
    }, []);

    const moveToken = useCallback((color: Player['color'], tokenIndex: number, steps: number, isRemote = false) => {
        // Cancel the human auto-move timeout if they manually moved
        if (autoMoveTimeoutRef.current) {
            clearTimeout(autoMoveTimeoutRef.current);
            autoMoveTimeoutRef.current = null;
        }

        setLocalGameState((prev) => {
            if (prev.winner) return prev;

            const { newState, captured } = processMove(
                prev as any,
                color as any,
                tokenIndex,
                steps,
                playerPaths,
                playerCount,
                prev.currentPlayer as PlayerColor,
                activeColorsArr,
                colorCorner
            );

            if (newState.positions[color][tokenIndex] !== prev.positions[color][tokenIndex]) playMove();
            if (captured) playCapture();
            if (newState.winner && !prev.winner) {
                playWin();
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
    }, [isHost, broadcastAction, playerPaths, playerCount, playMove, playCapture, playWin, triggerWinConfetti, recordWin]);


    const handleUsePower = useCallback((color: Player['color']) => {
        setLocalGameState(prev => {
            if (prev.currentPlayer !== color || prev.gamePhase !== 'rolling') return prev;
            const power = prev.playerPowers[color as PlayerColor];
            if (!power) return prev;

            let nextState = { ...prev };
            const myColor = color as PlayerColor;

            if (power === 'shield') {
                // Apply shield to all tokens of this player currently on board
                const tokensOnBoard = prev.positions[myColor]
                    .map((pos, idx) => (pos >= 0 && pos < 52) ? idx : -1)
                    .filter(idx => idx !== -1);
                
                const newShields = [...prev.activeShields];
                tokensOnBoard.forEach(idx => {
                    if (!newShields.some(s => s.color === myColor && s.tokenIdx === idx)) {
                        newShields.push({ color: myColor, tokenIdx: idx });
                    }
                });
                nextState.activeShields = newShields;
            } 
            else if (power === 'bomb') {
                // Remove one nearest opponent token within 6 steps of ANY of our tokens
                let target: { color: PlayerColor, idx: number } | null = null;
                let minDistance = 7;

                prev.positions[myColor].forEach(myPos => {
                    if (myPos < 0 || myPos >= 52) return;
                    const myPt = playerPaths[myColor][myPos];

                    (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
                        if (oppColor === myColor) return;
                        if (playerCount === '2v2' && oppColor === getTeammateColor(myColor, playerCount)) return;

                        prev.positions[oppColor].forEach((oppPos, oppIdx) => {
                            if (oppPos < 0 || oppPos >= 52) return;
                            const oppPt = playerPaths[oppColor][oppPos];
                            
                            // Check if they are on a shared path vs just nearby on grid
                            // Simple heuristic: find opponent within steps 1-6 on our path
                            // This is move-based capture simulation
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
                    playCapture();
                }
            }
            else if (power === 'boost') {
                // Next roll is +6
                nextState.activeBoost = myColor;
                nextState.captureMessage = "BOOST! Next move +6 steps.";
            }
            else if (power === 'warp') {
                // Teleport first token forward 10 squares
                const firstTokenIdx = prev.positions[myColor].findIndex(p => p >= 0 && p < 42); // Warp only in outer path
                if (firstTokenIdx !== -1) {
                    const newPos = { ...prev.positions };
                    newPos[myColor] = [...newPos[myColor]];
                    const targetPos = Math.min(newPos[myColor][firstTokenIdx] + 10, 51);
                    newPos[myColor][firstTokenIdx] = targetPos;
                    nextState.positions = newPos;
                    nextState.captureMessage = "WARP! Forward 10 squares.";
                    playMove();
                }
            }

            return {
                ...nextState,
                playerPowers: { ...prev.playerPowers, [myColor]: null },
                lastUpdate: Date.now()
            };
        });
    }, [playerPaths, playerCount, playCapture, playMove]);
    const handleRoll = useCallback((value?: number, isRemote = false) => {
        if (localGameState.winner) return;

        const rollValue = value || Math.floor(Math.random() * 6) + 1;

        // --- Interaction Guard: Only owner can roll ---
        const myPlayer = initialPlayers.find(p => 
            (address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || 
            (!address && !p.isAi)
        );
        const isMyTurn = localGameState.currentPlayer === myPlayer?.color;
        const isCurrentlyBot = initialPlayers.find(p => p.color === localGameState.currentPlayer)?.isAi 
            || localGameState.afkStats[localGameState.currentPlayer]?.isKicked;
        const isLocalGame = !localGameState.teamup.isConnected;

        // If not remote, not host-orchestrated AI (or local AI), and not my turn -> Block
        if (!isRemote && !isMyTurn && !isCurrentlyBot) return;
        
        // If it's an AI trying to roll, ensure only the Host (or local player) processes it
        if (!isRemote && isCurrentlyBot && !isHost && !isLocalGame) return;

        if (isHost && isLobbyConnected && !isRemote) {
            broadcastAction('ROLL_DICE', { value: rollValue });
        }

        setLocalGameState((prev) => {
            if (prev.gamePhase !== 'rolling' || prev.winner) {
                return prev;
            }

            const color = prev.currentPlayer;
            const teammate = getTeammateColor(color, playerCount);
            const isSelfFinished = prev.positions[color].every(p => p === 57);
            const targetColor = (playerCount === '2v2' && isSelfFinished && teammate) ? teammate : color;

            const isThreeSixes = rollValue === 6 && prev.consecutiveSixes === 2;

            if (isThreeSixes) {
                const nextPlayer = getNextPlayer(color);
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
            
            prev.positions[targetColor].forEach((pos, idx) => {
                const nextPos = pos === -1 ? (rollValue === 6 ? 0 : -1) : pos + rollValue;
                if (nextPos <= 57 && nextPos !== -1) {
                    validMovesCount++;
                    lastValidTokenIndex = idx;
                }
            });

            if (validMovesCount === 0 && !isRemote) {
                const nextPlayer = getNextPlayer(color);
                setTimeout(() => {
                    if (isHost && isLobbyConnected) {
                        broadcastAction('TURN_SWITCH', { nextPlayer });
                    }
                    setLocalGameState(s => ({
                        ...s,
                        gamePhase: 'rolling',
                        currentPlayer: getNextPlayer(s.currentPlayer),
                        diceValue: null,
                        consecutiveSixes: 0,
                        timeLeft: 15
                    }));
                }, 1000);
            }

            // HUMAN AUTO-MOVE LOGIC (1.5s)
            // Conditions for Auto-Move for humans:
            // 1. Exactly one valid move exists.
            // 2. OR Multiple valid moves exist, but ALL of them are "bringing out from home" (pos === -1),
            //    which means they all lead to the same result (position 0).
            const allValidAreFromHome = validMovesCount > 0 && prev.positions[targetColor].every((pos, idx) => {
                const nextPos = pos === -1 ? (rollValue === 6 ? 0 : -1) : pos + rollValue;
                // If it's a valid move, it MUST be from home
                if (nextPos <= 57 && nextPos !== -1) {
                    return pos === -1;
                }
                return true; // Not a valid move, so doesn't break the rule
            });

            if ((validMovesCount === 1 || allValidAreFromHome) && !isRemote) {
                const currentPlayerInfo = initialPlayers.find(p => p.color === color);
                const isBot = currentPlayerInfo?.isAi;
                // We only do this for humans. Bots already have their own orchestrator.
                if (!isBot) {
                    if (autoMoveTimeoutRef.current) clearTimeout(autoMoveTimeoutRef.current);
                    
                    autoMoveTimeoutRef.current = setTimeout(() => {
                        // Use the first valid token index we found (or the single one)
                        // lastValidTokenIndex was set in the loop above
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
    }, [getNextPlayer, isHost, isLobbyConnected, broadcastAction, initialPlayers, address, localGameState.currentPlayer, localGameState.winner, playerCount, sendIntent, moveToken]);

    const handleTokenClick = useCallback((color: Player['color'], tokenIndex: number) => {
        if (localGameState.gamePhase !== 'moving' || localGameState.diceValue === null) return;

        // --- Identification ---
        const actingPlayerColor = localGameState.currentPlayer;
        const myPlayer = initialPlayers.find(p => 
            (address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || 
            (!address && !p.isAi)
        );
        const myColor = myPlayer?.color;
        const isMyTurn = actingPlayerColor === myColor;
        const isCurrentlyBot = initialPlayers.find(p => p.color === actingPlayerColor)?.isAi;

        // --- 2v2 Teammate Logic ---
        const teammateColor = getTeammateColor(myColor as PlayerColor, playerCount);
        const allMyTokensFinished = myColor ? localGameState.positions[myColor].every(pos => pos === 57) : false;
        const isTeammateAssist = playerCount === '2v2' && color === teammateColor && allMyTokensFinished && isMyTurn;

        // --- Guard ---
        // 1. If it's my turn, I can only move MY tokens OR Teammate tokens (if finished)
        // 2. If it's NOT my turn, I can't move anything (including teammate's turn)
        // 3. If I have been kicked (turned to bot), block interaction
        if (!isMyTurn) return;
        if (isCurrentlyBot) return;
        if (color !== myColor && !isTeammateAssist) return;

        // Host/Guest Intent logic
        if (!isHost && isLobbyConnected) {
            sendIntent('REQUEST_MOVE', { color, tokenIndex, diceValue: localGameState.diceValue });
            return;
        }

        moveToken(color, tokenIndex, localGameState.diceValue);
    }, [localGameState, playerCount, isHost, isLobbyConnected, sendIntent, moveToken, address, initialPlayers]);

    // --- TURN NOTIFICATION BEEP ---
    useEffect(() => {
        if (localGameState.winner) return;

        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.afkStats[localGameState.currentPlayer].isKicked;

        if (!isCurrentlyBot && localGameState.gamePhase === 'rolling' && !localGameState.afkStats[localGameState.currentPlayer].isAutoPlaying) {
            playTurn();
        }
    }, [localGameState.currentPlayer, localGameState.winner, localGameState.afkStats, playTurn, localGameState.gamePhase, initialPlayers]);

    // --- TURN TIMER & AFK AUTO-PLAY LOGIC ---
    useEffect(() => {
        if (localGameState.winner) return;

        const interval = setInterval(() => {
            setLocalGameState(prev => {
                // If the Idle Warning prompt is active, tick its countdown instead
                if (prev.idleWarning) {
                    if (prev.idleWarning.timeLeft <= 0) {
                        // 10s ultimatum expired -> Kick the player
                        const kickedPlayer = prev.idleWarning.player;
                        return {
                            ...prev,
                            idleWarning: null,
                            afkStats: {
                                ...prev.afkStats,
                                [kickedPlayer]: { ...prev.afkStats[kickedPlayer], isKicked: true, isAutoPlaying: false }
                            },
                        };
                    }
                    return {
                        ...prev,
                        idleWarning: { ...prev.idleWarning, timeLeft: prev.idleWarning.timeLeft - 1 }
                    };
                }

                // Normal Turn Timer
                if (prev.timeLeft <= 0) return prev;
                return { ...prev, timeLeft: prev.timeLeft - 1 };
            });
        }, 1000);

        // AFK Logic (Humans only) -> kicks in when timeLeft hits 0
        setLocalGameState(prev => {
            if (prev.winner || prev.idleWarning) return prev; // Do nothing if paused by warning or won

            const color = prev.currentPlayer;
            const currentPlayerInfo = initialPlayers.find(p => p.color === color);
            const isOriginalBot = currentPlayerInfo?.isAi;
            const isKicked = prev.afkStats[color].isKicked;
            const isCurrentlyBot = isOriginalBot || isKicked; // Striking logic only applies to active humans

            if (!isCurrentlyBot && prev.timeLeft <= 0) {
                const stats = prev.afkStats[color];
                let nextStats = { ...stats };
                let nextWarning: { player: PlayerColor; timeLeft: number } | null = prev.idleWarning;

                if (!stats.isAutoPlaying) {
                    // 1st missed turn in sequence
                    nextStats.isAutoPlaying = true;
                    nextStats.consecutiveTurns = 1;
                    nextStats.totalTriggers += 1;
                } else {
                    // Consecutive missed turn
                    nextStats.consecutiveTurns += 1;
                }

                // Global Strike Limit Check
                if (nextStats.totalTriggers >= 3) {
                    nextStats.isKicked = true;
                    nextStats.isAutoPlaying = false;
                } 
                // Consecutive Limit Check
                else if (nextStats.consecutiveTurns >= 4) {
                    // Pause the turn and trigger the warning
                    nextWarning = { player: color as PlayerColor, timeLeft: 10 };
                }

                if (nextWarning) {
                    // Match Paused for 10s prompt
                    return {
                        ...prev,
                        afkStats: { ...prev.afkStats, [color]: nextStats },
                        idleWarning: nextWarning
                    };
                }

                if (nextStats.isKicked) {
                    // They converted to bot implicitly on next tick
                    return {
                        ...prev,
                        afkStats: { ...prev.afkStats, [color]: nextStats },
                    };
                }

                // Execute Auto-Play for the AFK Human (Random Moves, Anti-Exploit)
                if (prev.gamePhase === 'rolling') {
                    const forcedRoll = Math.floor(Math.random() * 6) + 1;
                    // We must call handleRoll carefully to avoid render cycle issues down the line,
                    // so we do this in setTimeout inside the useEffect body, not inside setLocalGameState.
                    // Wait, setLocalGameState updater shouldn't have side effects. Let's fix this below.
                }

                return {
                    ...prev,
                    afkStats: { ...prev.afkStats, [color]: nextStats }
                };
            }
            return prev;
        });

        return () => clearInterval(interval);
    }, [localGameState.winner, initialPlayers]);

    // Handle the Side-Effects of AFK Timeouts
    useEffect(() => {
        if (localGameState.winner || localGameState.idleWarning) return;

        const color = localGameState.currentPlayer;
        const currentPlayerInfo = initialPlayers.find(p => p.color === color);
        const isOriginalBot = currentPlayerInfo?.isAi;
        const isKicked = localGameState.afkStats[color].isKicked;
        const isCurrentlyBot = isOriginalBot || isKicked;
        
        // If it's a human technically in auto-play mode (but not kicked) and time ran out
        if (!isCurrentlyBot && localGameState.afkStats[color].isAutoPlaying && localGameState.timeLeft <= 0) {
            
            if (localGameState.gamePhase === 'rolling') {
                const forcedRoll = Math.floor(Math.random() * 6) + 1;
                handleRoll(forcedRoll);
            } else if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                // ANTI-EXPLOIT: Random Move Logic instead of best move
                const diceValue = localGameState.diceValue;
                const options: number[] = [];
                localGameState.positions[color].forEach((pos, idx) => {
                    if (pos === -1 && diceValue === 6) options.push(idx);
                    else if (pos !== -1 && pos + diceValue <= 57) options.push(idx);
                });

                if (options.length === 0) {
                    setLocalGameState(s => ({
                        ...s,
                        gamePhase: 'rolling',
                        currentPlayer: getNextPlayer(s.currentPlayer),
                        timeLeft: 15
                    }));
                } else {
                    // Random array element
                    const randomIdx = options[Math.floor(Math.random() * options.length)];
                    moveToken(color, randomIdx, diceValue);
                }
            }
        }
    }, [
        localGameState.timeLeft,
        localGameState.currentPlayer,
        localGameState.gamePhase,
        localGameState.winner,
        localGameState.diceValue,
        localGameState.afkStats,
        localGameState.idleWarning,
        handleRoll,
        moveToken,
        initialPlayers,
        playerPaths,
        getNextPlayer,
        playerCount
    ]);

    // --- AI ORCHESTRATION ---
    useEffect(() => {
        if (localGameState.winner) return;

        // In networked matches, only the Host orchestrates the AI.
        // In local matches, the local client orchestrates.
        if (localGameState.teamup.isConnected && !localGameState.teamup.isHost) {
            return;
        }

        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.afkStats[localGameState.currentPlayer].isKicked;

        if (isCurrentlyBot) {
            if (localGameState.gamePhase === 'rolling') {
                // Generate a random delay between 3000ms (3s) and 6000ms (6s)
                const randomDelay = Math.floor(Math.random() * (6000 - 3000 + 1)) + 3000;

                const timer = setTimeout(() => {
                    const color = localGameState.currentPlayer;
                    const power = localGameState.playerPowers[color as PlayerColor];

                    if (power) {
                        let shouldUse = false;
                        if (power === 'bomb') {
                            // Similar logic to handleUsePower
                            let targetFound = false;
                            localGameState.positions[color].forEach(myPos => {
                                if (myPos < 0 || myPos >= 52) return;
                                (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
                                    if (oppColor === color) return;
                                    if (playerCount === '2v2' && oppColor === getTeammateColor(color as PlayerColor, playerCount)) return;
                                    localGameState.positions[oppColor].forEach(oppPos => {
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
                        } 
                        else if (power === 'shield') {
                            // Shield if an opponent is behind us
                            let vulnerable = false;
                            localGameState.positions[color].forEach(myPos => {
                                if (myPos < 0 || myPos >= 52) return;
                                if (GLOBAL_SAFE_POINTS.some((p: Point) => p.r === playerPaths[color][myPos].r && p.c === playerPaths[color][myPos].c)) return;
                                
                                (['green', 'red', 'blue', 'yellow'] as PlayerColor[]).forEach(oppColor => {
                                    if (oppColor === color) return;
                                    if (playerCount === '2v2' && oppColor === getTeammateColor(color as PlayerColor, playerCount)) return;
                                    localGameState.positions[oppColor].forEach(oppPos => {
                                        if (oppPos < 0 || oppPos >= 52) return;
                                        // Opponent is 1-6 steps behind us on our path
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
                        }
                        else if (power === 'boost' || power === 'warp') {
                            // Use boost/warp if it helps entering home or late game
                            const advancedToken = localGameState.positions[color].some(p => p > 35 && p < 51);
                            if (advancedToken) shouldUse = true;
                        }

                        if (shouldUse) {
                            handleUsePower(color);
                        }
                    }

                    setLocalGameState(s => ({ ...s, isThinking: true }));
                    const newValue = Math.floor(Math.random() * 6) + 1;
                    handleRoll(newValue);
                }, randomDelay);

                return () => clearTimeout(timer);
            }

            if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                // Generate a random delay between 1500ms (1.5s) and 3000ms (3s)
                const moveDelay = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;

                const timer = setTimeout(() => {
                    const color = localGameState.currentPlayer;
                    const teammate = getTeammateColor(color, playerCount);
                    const isSelfFinished = localGameState.positions[color].every(p => p === 57);
                    const targetColor = (playerCount === '2v2' && isSelfFinished && teammate) ? teammate : color;

                    const diceValue = localGameState.diceValue!;
                    const bestMoveIdx = getBestMove(localGameState.positions, targetColor as any, diceValue, playerPaths, playerCount, localGameState.powerTiles);

                    if (bestMoveIdx === null) {
                        setLocalGameState(s => ({
                            ...s,
                            isThinking: false,
                            gamePhase: 'rolling',
                            currentPlayer: getNextPlayer(s.currentPlayer),
                            timeLeft: 15
                        }));
                    } else {
                        setLocalGameState(s => ({ ...s, isThinking: false }));
                        moveToken(targetColor, bestMoveIdx, diceValue);
                    }
                }, moveDelay);

                return () => clearTimeout(timer);
            }
        }
    }, [
        localGameState.currentPlayer,
        localGameState.gamePhase,
        localGameState.winner,
        localGameState.diceValue,
        localGameState.afkStats,
        moveToken,
        handleRoll,
        initialPlayers,
        playerPaths,
        getNextPlayer,
        playerCount
    ]);

    // --- INTERRUPT AFK AUTO-PLAY ---
    const cancelAfk = useCallback((color: PlayerColor) => {
        setLocalGameState(prev => {
            const stats = prev.afkStats[color];
            // Only allow cancellation if they haven't been fully kicked yet
            if (stats.isAutoPlaying && !stats.isKicked) {
                return {
                    ...prev,
                    afkStats: {
                        ...prev.afkStats,
                        [color]: { ...stats, isAutoPlaying: false, consecutiveTurns: 0 }
                    },
                    idleWarning: prev.idleWarning?.player === color ? null : prev.idleWarning
                };
            }
            return prev;
        });
    }, []);

    // --- HOST: Sync local state to Context ---
    const lastSyncedUpdate = useRef(0);
    useEffect(() => {
        if (isHost && isLobbyConnected && localGameState.lastUpdate > lastSyncedUpdate.current) {
            lastSyncedUpdate.current = localGameState.lastUpdate;
            updateGameState(localGameState);
        }
    }, [isHost, isLobbyConnected, localGameState, updateGameState]);

    // --- HOST: Handle incoming Intents from Guests ---
    useEffect(() => {
        if (isHost && isLobbyConnected && lastIntent) {
            console.log('🎮 Host processing intent:', lastIntent.type, lastIntent.payload);
            const { type, payload } = lastIntent;

            if (type === 'REQUEST_ROLL') {
                handleRoll(undefined, false); // Host rolls
            } else if (type === 'REQUEST_MOVE') {
                const { color, tokenIndex, diceValue } = payload;
                if (localGameState.diceValue === diceValue && localGameState.currentPlayer === color) {
                    moveToken(color, tokenIndex, diceValue, false);
                }
            }
            clearIntent();
        }
    }, [isHost, isLobbyConnected, lastIntent, localGameState, handleRoll, moveToken, clearIntent]);

    // --- GUEST: Sync local state from networkGameState ---
    useEffect(() => {
        if (!isHost && isLobbyConnected && networkGameState) {
            const { lastUpdate } = networkGameState;

            if (lastUpdate > processedActionUpdate) {
                setProcessedActionUpdate(lastUpdate);

                setLocalGameState(prev => ({
                    ...prev,
                    ...networkGameState,
                    positions: networkGameState.positions || prev.positions,
                    currentPlayer: networkGameState.currentPlayer || prev.currentPlayer,
                    diceValue: networkGameState.diceValue,
                    gamePhase: networkGameState.gamePhase || prev.gamePhase,
                    winner: networkGameState.winner as any,
                    winners: networkGameState.winners as any,
                    isStarted: networkGameState.isStarted ?? prev.isStarted,
                    // Expanded Sync Fields
                    timeLeft: networkGameState.timeLeft ?? prev.timeLeft,
                    strikes: networkGameState.strikes || prev.strikes,
                    afkStats: networkGameState.afkStats || prev.afkStats,
                    playerPowers: networkGameState.playerPowers || prev.playerPowers,
                    activeTraps: networkGameState.activeTraps || prev.activeTraps,
                    activeShields: networkGameState.activeShields || prev.activeShields,
                    consecutiveSixes: networkGameState.consecutiveSixes ?? prev.consecutiveSixes,
                    powerTiles: networkGameState.powerTiles || prev.powerTiles,
                }));

                // Sound effects for Guest
                if (networkGameState.lastAction?.type === 'MOVE_TOKEN') {
                    playMove();
                } else if (networkGameState.lastAction?.type === 'ROLL_DICE') {
                    // Could add roll sound here
                }
            }
        }
    }, [isHost, isLobbyConnected, networkGameState, processedActionUpdate, playMove]);

    return {
        localGameState,
        handleRoll,
        handleTokenClick,
        handleUsePower,
        resetGame,
        checkWin,
        getNextPlayer,
        cancelAfk
    };
}
