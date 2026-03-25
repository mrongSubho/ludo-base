import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';
import confetti from 'canvas-confetti';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { PlayerColor, PowerType } from '@/lib/types';
import { getTeammateColor, getNextPlayer as getNextPlayerCore } from '@/lib/gameLogic';
import { Point, PathCell, ColorCorner, assignCornersFFA, assignCorners2v2, buildPlayerPaths, shufflePlayers } from '@/lib/boardLayout';
import { recordMatchResult } from '@/lib/matchRecorder';
import { useAudio } from '../app/hooks/useAudio';

// Specialized Hooks
import { useGameActions } from './useGameActions';
import { useGameTimer } from './useGameTimer';
import { useAFKManager } from './useAFKManager';
import { useAIBrain } from './useAIBrain';

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
        matchId: undefined as string | undefined,
        lastUpdate: Date.now()
    });

    const getNextPlayer = useCallback((current: PlayerColor): PlayerColor => {
        const activeForTurns = activeColorsArr.filter(color => {
            const hasTokens = localGameState.positions[color].some(p => p !== 57);
            if (playerCount === '2v2') {
                const teammate = getTeammateColor(color, playerCount);
                const teammateHasTokens = teammate ? localGameState.positions[teammate].some(p => p !== 57) : false;
                return hasTokens || teammateHasTokens;
            }
            return hasTokens;
        });

        return getNextPlayerCore(current, playerCount, activeForTurns, colorCorner);
    }, [activeColorsArr, playerCount, colorCorner, localGameState.positions]);

    const recordWin = useCallback(async (winnerColor: Player['color']) => {
        const player = initialPlayers.find(p => p.color === winnerColor);
        if (!player) return;

        const myPlayer = initialPlayers.find(p => p.walletAddress?.toLowerCase() === address?.toLowerCase());
        const isMeKicked = myPlayer ? localGameState.afkStats[myPlayer.color].isKicked : false;
        
        if (isMeKicked) return;

        const data = localStorage.getItem('ludo-leaderboard');
        const stats = data ? JSON.parse(data) : {};

        if (!stats[player.name]) {
            stats[player.name] = { name: player.name, color: player.color, wins: 0, lastWin: 0 };
        }

        stats[player.name].wins += 1;
        stats[player.name].lastWin = Date.now();
        stats[player.name].color = player.color;

        localStorage.setItem('ludo-leaderboard', JSON.stringify(stats));

        if (address && player.walletAddress === address && !hasRecordedWin.current) {
            hasRecordedWin.current = true;
            const participants = initialPlayers
                .map(p => p.walletAddress)
                .filter(Boolean) as string[];

            await recordMatchResult(address, roomId || 'local', gameMode, participants, localGameState.matchId);
        }
    }, [initialPlayers, address, roomId, gameMode, localGameState.afkStats, localGameState.matchId]);

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

    const {
        moveToken,
        handleRoll,
        handleUsePower,
        handleTokenClick
    } = useGameActions({
        localGameState,
        setLocalGameState,
        initialPlayers,
        address,
        isHost,
        isLobbyConnected,
        broadcastAction: broadcastAction as any,
        sendIntent: sendIntent as any,
        playerPaths,
        playerCount,
        colorCorner,
        activeColorsArr,
        audio: { playMove, playCapture, playWin },
        triggerWinConfetti,
        recordWin,
        autoMoveTimeoutRef
    });

    useGameTimer({ localGameState, setLocalGameState });

    useAFKManager({
        localGameState,
        setLocalGameState,
        initialPlayers,
        handleRoll,
        moveToken,
        getNextPlayer
    });

    useAIBrain({
        localGameState,
        initialPlayers,
        isHost,
        handleRoll,
        moveToken,
        handleUsePower,
        playerPaths,
        playerCount
    });

    const cancelAfk = useCallback((color: PlayerColor) => {
        setLocalGameState((prev: any) => ({
            ...prev,
            afkStats: {
                ...prev.afkStats,
                [color]: {
                    ...prev.afkStats[color],
                    isAutoPlaying: false,
                    consecutiveTurns: 0
                }
            },
            idleWarning: prev.idleWarning?.player === color ? null : prev.idleWarning
        }));
    }, []);

    const resetGame = useCallback(() => {
        const newCC = playerCount === '2v2' ? assignCorners2v2() : assignCornersFFA(playerCount as '1v1' | '4P');
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
            matchId: undefined,
            lastUpdate: Date.now()
        });
    }, [playerCount, gameMode, pathCells, isBotMatch, setBoardConfig]);

    useEffect(() => {
        if (localGameState.winner) return;
        const currentPlayerInfo = initialPlayers.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.afkStats[localGameState.currentPlayer].isKicked;
        if (!isCurrentlyBot && localGameState.gamePhase === 'rolling' && !localGameState.afkStats[localGameState.currentPlayer].isAutoPlaying) {
            playTurn();
        }
    }, [localGameState.currentPlayer, localGameState.winner, localGameState.afkStats, playTurn, localGameState.gamePhase, initialPlayers]);

    useEffect(() => {
        if (isHost && isLobbyConnected && localGameState.lastUpdate > 0) {
            updateGameState(localGameState);
        }
    }, [isHost, isLobbyConnected, localGameState, updateGameState]);

    useEffect(() => {
        if (!isHost && isLobbyConnected && networkGameState && networkGameState.lastUpdate > localGameState.lastUpdate) {
            setLocalGameState(prev => ({
                ...prev,
                ...networkGameState,
                isStarted: prev.isStarted || networkGameState.isStarted
            }));
            if (networkGameState.lastAction?.type === 'MOVE_TOKEN') playMove();
        }
    }, [isHost, isLobbyConnected, networkGameState, localGameState.lastUpdate, playMove]);

    return {
        gameState: localGameState,
        handleRoll,
        handleTokenClick,
        handleUsePower,
        cancelAfk,
        resetGame,
        getNextPlayer
    };
}
