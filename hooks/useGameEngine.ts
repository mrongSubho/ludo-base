import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import confetti from 'canvas-confetti';
import { useMultiplayerContext, PlayerColor } from '@/hooks/MultiplayerContext';
import { processMove } from '@/lib/gameLogic';
import { getBestMove } from '@/lib/aiEngine';
import { Point, PathCell, ColorCorner, assignCornersFFA, assignCorners2v2, buildPlayerPaths, shufflePlayers } from '@/lib/boardLayout';
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

export type PowerType = 'shield' | 'boost' | 'bomb' | 'warp';

interface UseGameEngineProps {
    initialPlayers: Player[];
    playerCount: '1v1' | '4P' | '2v2';
    gameMode: 'classic' | 'power' | 'snakes';
    isBotMatch: boolean;
    playerPaths: Record<string, Point[]>;
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
    pathCells,
    setBoardConfig
}: UseGameEngineProps) {
    const { playMove, playCapture, playWin, playTurn } = useAudio();
    const { address } = useAccount();
    const hasRecordedWin = useRef<boolean>(false);

    const {
        gameState: networkGameState,
        isHost,
        sendIntent,
        broadcastAction,
        roomId,
        isLobbyConnected
    } = useMultiplayerContext();

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
        multiplayer: {
            targetId: '',
            isConnected: false,
            isHost: false,
            status: 'idle' as 'idle' | 'host' | 'guest'
        }
    });

    // Sync local state with context state for Guests
    useEffect(() => {
        if (!isHost && isLobbyConnected && networkGameState) {
            setLocalGameState(prev => ({
                ...prev,
                ...networkGameState,
                winner: networkGameState.winner as any,
                winners: networkGameState.winners as any,
                captureMessage: networkGameState.captureMessage || prev.captureMessage,
                positions: networkGameState.positions || prev.positions
            }));
        }
    }, [isHost, isLobbyConnected, networkGameState]);

    const checkWin = useCallback((positions: typeof localGameState.positions, color: Player['color']) => {
        return positions[color].every((pos) => pos === 57);
    }, []);

    const getNextPlayer = useCallback((current: Player['color']): Player['color'] => {
        const order: Player['color'][] = ['green', 'red', 'blue', 'yellow'];
        const activeColors = initialPlayers.map(p => p.color);
        const activeOrder = order.filter(c => activeColors.includes(c));
        const idx = activeOrder.indexOf(current);
        return activeOrder[(idx + 1) % activeOrder.length];
    }, [initialPlayers]);

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
            multiplayer: { targetId: '', isConnected: false, isHost: false, status: 'idle' }
        });
    }, [playerCount, gameMode, pathCells, isBotMatch, setBoardConfig]);

    const recordWin = useCallback(async (winnerColor: Player['color']) => {
        const player = initialPlayers.find(p => p.color === winnerColor);
        if (!player) return;

        const data = localStorage.getItem('ludo-leaderboard');
        const stats = data ? JSON.parse(data) : {};

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
    }, [initialPlayers, address, roomId, gameMode]);

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
        setLocalGameState((prev) => {
            if (prev.winner) return prev;

            const { newState, captured } = processMove(
                prev as any,
                color as any,
                tokenIndex,
                steps,
                playerPaths,
                playerCount
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
            };
        });
    }, [isHost, broadcastAction, playerPaths, playerCount, playMove, playCapture, playWin, triggerWinConfetti, recordWin]);


    const handleUsePower = useCallback((color: Player['color']) => {
        setLocalGameState(prev => {
            if (prev.currentPlayer !== color || prev.gamePhase !== 'rolling') return prev;
            const power = prev.playerPowers[color as PlayerColor];
            if (!power) return prev;
            return {
                ...prev,
                playerPowers: { ...prev.playerPowers, [color]: null }
            };
        });
    }, []);

    const handleRoll = useCallback((value?: number, isRemote = false) => {
        if (localGameState.gamePhase !== 'rolling' || localGameState.isThinking || localGameState.winner) return;

        if (!isHost && !isRemote) {
            sendIntent('REQUEST_ROLL');
            return;
        }

        const roll = value || Math.floor(Math.random() * 6) + 1;
        if (isHost && !isRemote) {
            broadcastAction('ROLL_DICE', { value: roll });
        }

        setLocalGameState((prev) => {
            const color = prev.currentPlayer;
            const isThreeSixes = roll === 6 && prev.consecutiveSixes === 2;

            if (isThreeSixes) {
                const nextPlayer = getNextPlayer(color);
                const nextState = {
                    ...prev,
                    diceValue: roll,
                    consecutiveSixes: 0,
                    gamePhase: 'rolling' as const,
                    currentPlayer: nextPlayer,
                    captureMessage: "Three 6s! Turn passed.",
                    timeLeft: 15
                };
                if (isHost) {
                    broadcastAction('ROLL_DICE', { value: roll });
                    broadcastAction('TURN_SWITCH', { nextPlayer });
                }
                return nextState;
            }

            let hasValidMove = false;
            prev.positions[color].forEach((pos) => {
                const nextPos = pos === -1 ? (roll === 6 ? 0 : -1) : pos + roll;
                if (nextPos <= 57 && nextPos !== -1) hasValidMove = true;
            });

            if (!hasValidMove && !isRemote) {
                const nextPlayer = getNextPlayer(color);
                setTimeout(() => {
                    if (isHost) {
                        broadcastAction('TURN_SWITCH', { nextPlayer });
                    }
                    setLocalGameState(s => ({
                        ...s,
                        gamePhase: 'rolling',
                        currentPlayer: nextPlayer,
                        diceValue: null,
                        consecutiveSixes: 0,
                        timeLeft: 15
                    }));
                }, 1000);
            }

            return {
                ...prev,
                diceValue: roll,
                consecutiveSixes: roll === 6 ? prev.consecutiveSixes + 1 : 0,
                gamePhase: hasValidMove ? 'moving' : 'rolling',
                timeLeft: 15,
            };
        });
    }, [getNextPlayer, isHost, broadcastAction, sendIntent, localGameState.gamePhase, localGameState.isThinking, localGameState.winner]);

    const handleTokenClick = (color: Player['color'], tokenIndex: number) => {
        if (localGameState.currentPlayer !== color || localGameState.gamePhase !== 'moving' || localGameState.diceValue === null) return;

        if (!isHost && isLobbyConnected) {
            sendIntent('REQUEST_MOVE', { color, tokenIndex, diceValue: localGameState.diceValue });
            return;
        }

        moveToken(color, tokenIndex, localGameState.diceValue);
    };

    // --- TURN NOTIFICATION BEEP ---
    useEffect(() => {
        if (localGameState.winner) return;

        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.strikes[localGameState.currentPlayer] >= 3;

        if (!isCurrentlyBot && localGameState.gamePhase === 'rolling') {
            playTurn();
        }
    }, [localGameState.currentPlayer, localGameState.winner, localGameState.strikes, playTurn, localGameState.gamePhase, initialPlayers]);

    // --- HUMAN TURN TIMER & AFK AUTO-PLAY LOGIC ---
    useEffect(() => {
        if (localGameState.winner) return;

        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.strikes[localGameState.currentPlayer] >= 3;

        if (!isCurrentlyBot) {
            if (localGameState.timeLeft <= 0) {
                setLocalGameState(prev => ({
                    ...prev,
                    strikes: { ...prev.strikes, [prev.currentPlayer]: prev.strikes[prev.currentPlayer] + 1 },
                }));

                if (localGameState.gamePhase === 'rolling') {
                    const forcedRoll = Math.floor(Math.random() * 6) + 1;
                    handleRoll(forcedRoll);
                } else if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                    const bestMoveIdx = getBestMove(localGameState.positions, localGameState.currentPlayer, localGameState.diceValue, playerPaths, playerCount);
                    if (bestMoveIdx === null) {
                        setLocalGameState(s => ({
                            ...s,
                            gamePhase: 'rolling',
                            currentPlayer: getNextPlayer(s.currentPlayer),
                            timeLeft: 15
                        }));
                    } else {
                        moveToken(localGameState.currentPlayer, bestMoveIdx, localGameState.diceValue);
                    }
                }
                return;
            }

            const interval = setInterval(() => {
                setLocalGameState(prev => ({ ...prev, timeLeft: prev.timeLeft - 1 }));
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [
        localGameState.timeLeft,
        localGameState.currentPlayer,
        localGameState.gamePhase,
        localGameState.winner,
        localGameState.diceValue,
        localGameState.strikes,
        handleRoll,
        moveToken,
        initialPlayers,
        playerPaths,
        getNextPlayer
    ]);

    // --- AI ORCHESTRATION ---
    useEffect(() => {
        if (localGameState.winner) return;

        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.strikes[localGameState.currentPlayer] >= 3;

        if (isCurrentlyBot) {
            if (localGameState.gamePhase === 'rolling') {
                const timer = setTimeout(() => {
                    setLocalGameState(s => ({ ...s, isThinking: true }));
                    const newValue = Math.floor(Math.random() * 6) + 1;
                    handleRoll(newValue);
                }, 4000);
                return () => clearTimeout(timer);
            }

            if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                const timer = setTimeout(() => {
                    const color = localGameState.currentPlayer;
                    const diceValue = localGameState.diceValue!;
                    const bestModeIdx = getBestMove(localGameState.positions, color, diceValue, playerPaths, playerCount);

                    if (bestModeIdx === null) {
                        setLocalGameState(s => ({
                            ...s,
                            isThinking: false,
                            gamePhase: 'rolling',
                            currentPlayer: getNextPlayer(s.currentPlayer),
                            timeLeft: 15
                        }));
                    } else {
                        setLocalGameState(s => ({ ...s, isThinking: false }));
                        moveToken(color, bestModeIdx, diceValue);
                    }
                }, 1000);
                return () => clearTimeout(timer);
            }
        }
    }, [
        localGameState.currentPlayer,
        localGameState.gamePhase,
        localGameState.winner,
        localGameState.diceValue,
        moveToken,
        handleRoll,
        localGameState.strikes,
        initialPlayers,
        playerPaths,
        getNextPlayer
    ]);

    return {
        localGameState,
        handleRoll,
        handleTokenClick,
        handleUsePower,
        resetGame,
        checkWin
    };
}
