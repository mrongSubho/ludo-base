import React, { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, animate, useTransform } from 'framer-motion';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { PlayerColor } from '@/lib/types';
import { useAccount } from 'wagmi';
import {
    assignCorners2v2, assignCornersFFA,
    buildPlayerPaths, buildPathCellsDynamic,
    shufflePlayers, ColorCorner, CORNER_SLOTS
} from '@/lib/boardLayout';
import { useGameEngine, Player } from '@/hooks/useGameEngine';
import { useTeamUp } from '@/hooks/useTeamUp';

// Modular Components
import { HomeBlock } from './BoardHome';
import { BoardTokens } from './BoardTokens';
import { BoardGrid } from './BoardGrid';
import { 
    StatusNotification, 
    IdleWarningOverlay, 
    CelebrationOverlay, 
    NameOverlay 
} from './BoardOverlays';
import { PlayerRow, getDisplayNameHelper } from './PlayerInfoRow';

// Modular Hooks
import { useBoardLayout } from '@/hooks/useBoardLayout';

export default function Board({
    showLeaderboard = false,
    onToggleLeaderboard,
    playerCount = '4P',
    gameMode = 'classic',
    isBotMatch = false,
    onOpenProfile,
    initialPlayers,
    initialColorCorner,
    spectatorMode = false,
    externalGameState,
}: {
    showLeaderboard?: boolean;
    onToggleLeaderboard?: (show: boolean) => void;
    playerCount?: '1v1' | '4P' | '2v2';
    gameMode?: 'classic' | 'power' | 'snakes';
    isBotMatch?: boolean;
    onOpenProfile?: (address: string) => void;
    initialPlayers?: Player[];
    initialColorCorner?: ColorCorner;
    spectatorMode?: boolean;
    externalGameState?: import('@/lib/types').GameState;
}) {
    const { address } = useAccount();
    const { participants } = useTeamUp();

    const [boardConfig, setBoardConfig] = useState(() => {
        if (initialPlayers && initialColorCorner) {
            return {
                players: initialPlayers,
                colorCorner: initialColorCorner,
                playerPaths: buildPlayerPaths(initialColorCorner)
            };
        }
        const cc = playerCount === '2v2' ? assignCorners2v2() : assignCornersFFA(playerCount as '1v1' | '4P');
        const generatedPlayers = shufflePlayers(playerCount, isBotMatch, cc) as Player[];
        return {
            players: generatedPlayers,
            colorCorner: cc,
            playerPaths: buildPlayerPaths(cc)
        };
    });

    useEffect(() => {
        if (initialPlayers && initialColorCorner) {
            setBoardConfig({
                players: initialPlayers,
                colorCorner: initialColorCorner,
                playerPaths: buildPlayerPaths(initialColorCorner)
            });
        }
    }, [initialPlayers, initialColorCorner]);

    const { players, colorCorner, playerPaths } = boardConfig;
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
    const [isShaking, setIsShaking] = useState(false);

    const pathCells = React.useMemo(() => buildPathCellsDynamic(colorCorner), [colorCorner]);

    const engine = useGameEngine({
        initialPlayers: players,
        playerCount,
        gameMode,
        isBotMatch,
        playerPaths,
        colorCorner,
        pathCells,
        setBoardConfig
    });

    const localGameState = (spectatorMode && externalGameState) ? externalGameState : engine.gameState;
    const { handleRoll, handleTokenClick, handleUsePower, resetGame, cancelAfk } = engine;

    const { boardRotationDeg, counterRotationDeg, uiSlots } = useBoardLayout({
        players,
        colorCorner,
        address,
        participants,
        setBoardConfig
    });

    // Capture Shake
    useEffect(() => {
        if (localGameState.captureMessage?.includes('Captured') || localGameState.captureMessage?.includes('BOMB')) {
            setIsShaking(true);
            const timer = setTimeout(() => setIsShaking(false), 500);
            return () => clearTimeout(timer);
        }
    }, [localGameState.captureMessage]);

    // Timer Animation Logic
    const smoothProgress = useMotionValue(localGameState.timeLeft / 15);
    const prevPlayerRef = useRef(localGameState.currentPlayer);

    useEffect(() => {
        if (prevPlayerRef.current !== localGameState.currentPlayer) {
            smoothProgress.set(1);
            prevPlayerRef.current = localGameState.currentPlayer;
        }
        animate(smoothProgress, localGameState.timeLeft / 15, { duration: 1, ease: "linear" });
    }, [localGameState.timeLeft, localGameState.currentPlayer, smoothProgress]);

    const activeColor = {
        green: 'var(--ludo-green)', 
        red: 'var(--ludo-red)', 
        blue: 'var(--ludo-blue)', 
        yellow: 'var(--ludo-yellow)'
    }[localGameState.currentPlayer] || 'var(--ludo-muted)';

    const myPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);

    return (
        <div data-theme="default" className="board-outer board-match-theme-wrapper w-full h-[100dvh]">
            <PlayerRow
                corners={['TL', 'TR']}
                uiSlots={uiSlots}
                players={players}
                localGameState={localGameState}
                handleRoll={handleRoll}
                handleUsePower={handleUsePower}
                spectatorMode={spectatorMode}
                myPlayerColor={myPlayer?.color}
            />

            <motion.div 
                className="board-area" 
                animate={isShaking ? { x: [-2, 2, -2, 2, 0] } : {}}
                transition={{ duration: 0.4 }}
                style={{ position: 'relative', width: '100%', cursor: 'pointer' }}
                onClick={() => {
                    if (myPlayer?.color && localGameState.afkStats?.[myPlayer.color]?.isAutoPlaying) {
                        cancelAfk(myPlayer.color);
                    }
                }}
            >
                <div
                    className="board-wrapper"
                    style={{
                        position: 'relative',
                        transform: boardRotationDeg !== 0 ? `rotate(${boardRotationDeg}deg)` : undefined,
                        transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                >
                    <BoardGrid
                        pathCells={pathCells}
                        colorCorner={colorCorner}
                        localGameState={localGameState}
                        activeColor={activeColor}
                        sweepProgress={smoothProgress}
                        pointRotation={useBoardLayoutRotation(smoothProgress)}
                        counterRotationDeg={counterRotationDeg}
                    >
                        {(['green', 'red', 'yellow', 'blue'] as const).map((color) => {
                            const tokensInHome = localGameState.positions[color].map((pos: number, idx: number) => pos === -1 ? idx : -1).filter((idx: number) => idx !== -1);
                            return (
                                <HomeBlock
                                    key={color}
                                    color={color}
                                    corner={colorCorner[color]}
                                    gridRow={CORNER_SLOTS[colorCorner[color]].gridRow}
                                    gridCol={CORNER_SLOTS[colorCorner[color]].gridCol}
                                    tokensInHome={tokensInHome}
                                    onTokenClick={(idx) => handleTokenClick(color, idx)}
                                    isDraggable={localGameState.currentPlayer === color && localGameState.gamePhase === 'moving' && localGameState.diceValue === 6}
                                />
                            );
                        })}
                        <BoardTokens
                            players={players}
                            localGameState={localGameState}
                            playerPaths={playerPaths}
                            address={address}
                            playerCount={playerCount}
                            handleTokenClick={handleTokenClick}
                        />
                    </BoardGrid>
                    
                    <StatusNotification message={localGameState.captureMessage} />
                </div>

                <NameOverlay uiSlots={uiSlots} players={players} getDisplayName={getDisplayNameHelper} />
                <IdleWarningOverlay idleWarning={localGameState.idleWarning} myPlayer={myPlayer} onCancelAfk={cancelAfk} />
            </motion.div>

            <CelebrationOverlay winner={localGameState.winner} onReset={resetGame} />

            <PlayerRow
                corners={['BL', 'BR']}
                uiSlots={uiSlots}
                players={players}
                localGameState={localGameState}
                handleRoll={handleRoll}
                handleUsePower={handleUsePower}
                spectatorMode={spectatorMode}
                myPlayerColor={myPlayer?.color}
            />

            <Leaderboard isOpen={showLeaderboard} onClose={() => onToggleLeaderboard?.(false)} onOpenProfile={onOpenProfile || (() => { })} />
            {selectedPlayer && (
                <PlayerProfileSheet
                    player={selectedPlayer}
                    wins={localGameState.positions[selectedPlayer.color].filter((p: number) => p === 57).length}
                    onClose={() => setSelectedPlayer(null)}
                />
            )}
        </div>
    );
}

// Helper for the timer translation
function useBoardLayoutRotation(smoothProgress: any) {
    return useTransform(smoothProgress, [0, 1], [270, -90]);
}
