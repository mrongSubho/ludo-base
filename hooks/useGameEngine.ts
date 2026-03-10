import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import confetti from 'canvas-confetti';
import { useMultiplayerContext } from '@/hooks/MultiplayerContext';
import { PlayerColor, PowerType } from '@/lib/types';
import { handleThreeSixes, processMove, getNextPlayer as getNextPlayerCore, getTeammateColor } from '@/lib/gameLogic';
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
    const activeColorsArr = initialPlayers.map(p => p.color as PlayerColor);

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
            multiplayer: { targetId: '', isConnected: false, isHost: false, status: 'idle' },
            isStarted: true,
            lastUpdate: Date.now()
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
                playerCount,
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
            return {
                ...prev,
                playerPowers: { ...prev.playerPowers, [color]: null }
            };
        });
    }, []);

    const handleRoll = useCallback((value?: number, isRemote = false) => {
        if (localGameState.winner) return;

        if (isLobbyConnected && !isHost && !isRemote) {
            sendIntent('REQUEST_ROLL');
            return;
        }

        const rollValue = value || Math.floor(Math.random() * 6) + 1;

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

            let hasValidMove = false;
            prev.positions[targetColor].forEach((pos) => {
                const nextPos = pos === -1 ? (rollValue === 6 ? 0 : -1) : pos + rollValue;
                if (nextPos <= 57 && nextPos !== -1) hasValidMove = true;
            });

            if (!hasValidMove && !isRemote) {
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

            return {
                ...prev,
                diceValue: rollValue,
                consecutiveSixes: rollValue === 6 ? prev.consecutiveSixes + 1 : 0,
                gamePhase: hasValidMove ? 'moving' : 'rolling',
                timeLeft: 15,
                lastUpdate: Date.now()
            };
        });
    }, [getNextPlayer, isHost, isLobbyConnected, broadcastAction, sendIntent, localGameState.winner, playerCount]);

    const handleTokenClick = useCallback((color: Player['color'], tokenIndex: number) => {
        const actingPlayer = localGameState.currentPlayer;
        const teammate = getTeammateColor(actingPlayer, playerCount);
        const isSelfFinished = localGameState.positions[actingPlayer].every(p => p === 57);

        const isSelf = actingPlayer === color;
        const isTeammate = teammate === color;

        // Validation for 2v2 teammate assistance
        if (!isSelf && (!isTeammate || !isSelfFinished)) return;

        if (localGameState.gamePhase !== 'moving' || localGameState.diceValue === null) return;

        if (!isHost && isLobbyConnected) {
            sendIntent('REQUEST_MOVE', { color, tokenIndex, diceValue: localGameState.diceValue });
            return;
        }

        moveToken(color, tokenIndex, localGameState.diceValue);
    }, [localGameState, playerCount, isHost, isLobbyConnected, sendIntent, moveToken]);

    // --- TURN NOTIFICATION BEEP ---
    useEffect(() => {
        if (localGameState.winner) return;

        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.strikes[localGameState.currentPlayer] >= 3;

        if (!isCurrentlyBot && localGameState.gamePhase === 'rolling') {
            playTurn();
        }
    }, [localGameState.currentPlayer, localGameState.winner, localGameState.strikes, playTurn, localGameState.gamePhase, initialPlayers]);

    // --- TURN TIMER & AFK AUTO-PLAY LOGIC ---
    useEffect(() => {
        if (localGameState.winner) return;

        // Visual Countdown (Unified for Humans & AI)
        const interval = setInterval(() => {
            setLocalGameState(prev => {
                if (prev.timeLeft <= 0) return prev;
                return { ...prev, timeLeft: prev.timeLeft - 1 };
            });
        }, 1000);

        // AFK Logic (Humans only)
        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.strikes[localGameState.currentPlayer] >= 3;

        if (!isCurrentlyBot && localGameState.timeLeft <= 0) {
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
        }

        return () => clearInterval(interval);
    }, [
        localGameState.timeLeft,
        localGameState.currentPlayer,
        localGameState.gamePhase,
        localGameState.winner,
        localGameState.diceValue,
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
                // Generate a random delay between 3000ms (3s) and 6000ms (6s)
                const randomDelay = Math.floor(Math.random() * (6000 - 3000 + 1)) + 3000;

                const timer = setTimeout(() => {
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
                    const bestMoveIdx = getBestMove(localGameState.positions, targetColor as any, diceValue, playerPaths, playerCount);

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
        moveToken,
        handleRoll,
        localGameState.strikes,
        initialPlayers,
        playerPaths,
        getNextPlayer,
        playerCount
    ]);

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
                    // Ensure functions/refs aren't overwritten if they were in state (though usually not)
                    positions: networkGameState.positions || prev.positions,
                    currentPlayer: networkGameState.currentPlayer || prev.currentPlayer,
                    diceValue: networkGameState.diceValue,
                    gamePhase: networkGameState.gamePhase || prev.gamePhase,
                    winner: networkGameState.winner as any,
                    winners: networkGameState.winners as any,
                    isStarted: networkGameState.isStarted ?? prev.isStarted,
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
        getNextPlayer
    };
}
