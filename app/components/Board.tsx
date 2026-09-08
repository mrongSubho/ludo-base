import React, { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, animate, useTransform } from 'framer-motion';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { PlayerColor, PowerType, PowerItem } from '@/lib/types';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
    assignCorners2v2, assignCornersFFA,
    buildPathCellsDynamic,
    shufflePlayers, ColorCorner, CORNER_SLOTS
} from '@/lib/boardLayout';
import { useGameEngine, Player } from '@/hooks/useGameEngine';
import { useTeamUp } from '@/hooks/useTeamUp';

// Modular Components
import { HomeBlock } from './BoardHome';
import { BoardTokens } from './BoardTokens';
import { BoardGrid } from './BoardGrid';
import { 
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
    wager = 0,
    botDifficulty = 'pro',
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
    wager?: number;
    botDifficulty?: import('@/lib/types').BotDifficulty;
}) {
    // Effective identity (wallet or guest id) so guests resolve as human.
    const { address } = useCurrentUser();
    const { participants } = useTeamUp();

    const [boardConfig, setBoardConfig] = useState(() => {
        if (initialPlayers && initialColorCorner) {
            return {
                players: initialPlayers,
                colorCorner: initialColorCorner
            };
        }
        const cc = playerCount === '2v2' ? assignCorners2v2() : assignCornersFFA(playerCount as '1v1' | '4P');
        const generatedPlayers = shufflePlayers(playerCount, isBotMatch, cc) as Player[];
        return {
            players: generatedPlayers,
            colorCorner: cc
        };
    });

    useEffect(() => {
        if (initialPlayers && initialColorCorner) {
            setBoardConfig({
                players: initialPlayers,
                colorCorner: initialColorCorner
            });
        }
    }, [initialPlayers, initialColorCorner]);

    const { players, colorCorner } = boardConfig;
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
    const [isShaking, setIsShaking] = useState(false);

    const pathCells = React.useMemo(() => buildPathCellsDynamic(colorCorner), [colorCorner]);

    const engine = useGameEngine({
        initialPlayers: players,
        playerCount,
        gameMode,
        isBotMatch,
        botDifficulty,
        colorCorner,
        pathCells,
        setBoardConfig,
        wager
    });

    const localGameState = (spectatorMode && externalGameState) ? externalGameState : engine.gameState;
    const { handleRoll, handleTokenClick, handleUsePower, resetGame, cancelAfk, lxpGain } = engine;
    // Powers execute host-side (guests replay broadcast state); only the
    // authority seat gets the inventory to avoid local-only desync spends.
    const canUsePowers = (engine as any).isAuthority !== false;

    // ─── Power inventory + targeting ─────────────────────────────────────
    // Bottom-centered badge bar for the human turn player's live powers.
    // Nuke/teleport arm targeting (gold rings on that color's tokens);
    // shield/boost fire immediately. One power per roll, enforced engine-side.
    const [targeting, setTargeting] = useState<{ type: PowerType } | null>(null);

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

    // ─── Power inventory: own eyes only (+ targeting) ────────────────────
    // You see your inventory, never opponents'. (Teammate view is a future
    // patch.) Spendable on your own rolling turn; one power per roll.
    const turnColor = localGameState.currentPlayer as PlayerColor;
    const ownColor = myPlayer?.color;
    const isMyTurn = !!ownColor && turnColor === ownColor;
    const showInventory = !spectatorMode && !!ownColor && canUsePowers;
    const liveInventory: PowerItem[] = showInventory
        ? ((localGameState.playerPowers?.[ownColor!] || []).filter((p: PowerItem) => p.expiresAt > Date.now()))
        : [];
    const groupedInventory = (['nuke', 'shield', 'boost', 'teleport'] as PowerType[])
        .map(t => {
            const items = liveInventory.filter(p => p.type === t);
            if (items.length === 0) return null;
            return { type: t, count: items.length, soonest: Math.min(...items.map(p => p.expiresAt)) };
        })
        .filter((g): g is { type: PowerType; count: number; soonest: number } => g !== null);
    const canSpend = showInventory && isMyTurn && localGameState.gamePhase === 'rolling' && !localGameState.powerSpentThisTurn;
    useEffect(() => {
        setTargeting(null);
    }, [localGameState.currentPlayer, localGameState.gamePhase]);
    const spendPower = (type: PowerType) => {
        if (!canSpend || !ownColor) return;
        if (type === 'nuke' || type === 'teleport') {
            setTargeting(cur => (cur?.type === type ? null : { type }));
            return;
        }
        setTargeting(null);
        handleUsePower(ownColor, type);
    };
    const spendTargeted = (color: PlayerColor, idx: number) => {
        if (targeting && ownColor && color === ownColor) {
            handleUsePower(ownColor, targeting.type, idx);
        }
        setTargeting(null);
    };

    return (
        <div data-theme="default" className="board-outer board-match-theme-wrapper w-full h-[100dvh]">
            <PlayerRow
                corners={['TL', 'TR']}
                uiSlots={uiSlots}
                players={players}
                localGameState={localGameState}
                handleRoll={handleRoll}
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
                            const isActivePlayer = players.some(p => p.color === color);
                            // Inactive corners have no player — show empty base (placeholder dots only)
                            const tokensInHome = isActivePlayer
                                ? localGameState.positions[color].map((pos: number, idx: number) => Number(pos) === -1 ? idx : -1).filter((idx: number) => idx !== -1)
                                : [];
                            const finishedTokens = isActivePlayer
                                ? localGameState.positions[color].map((pos: number, idx: number) => Number(pos) === 57 ? idx : -1).filter((idx: number) => idx !== -1)
                                : [];
                            const positions = localGameState.positions?.[color] as number[] | undefined;
                            return (
                                <HomeBlock
                                    key={color}
                                    color={color}
                                    corner={colorCorner[color]}
                                    gridRow={CORNER_SLOTS[colorCorner[color]].gridRow}
                                    gridCol={CORNER_SLOTS[colorCorner[color]].gridCol}
                                    tokensInHome={tokensInHome}
                                    finishedTokens={finishedTokens}
                                    positions={positions}
                                    colorCorner={colorCorner}
                                    viewerColor={uiSlots.BL ?? undefined}
                                    onTokenClick={(idx) => handleTokenClick(color, idx)}
                                    isDraggable={isActivePlayer && localGameState.currentPlayer === color && localGameState.gamePhase === 'moving' && Number(localGameState.diceValue) === 6}
                                    counterRotationDeg={counterRotationDeg}
                                    diceValue={localGameState.diceValue}
                                    gamePhase={localGameState.gamePhase}
                                    currentPlayer={localGameState.currentPlayer}
                                />
                            );
                        })}
                <BoardTokens
                    players={players}
                    localGameState={localGameState}
                    colorCorner={colorCorner}
                    address={address}
                    playerCount={playerCount}
                    handleTokenClick={handleTokenClick}
                    counterRotationDeg={counterRotationDeg}
                    targetingColor={targeting ? ownColor ?? null : null}
                    onTargetToken={spendTargeted}
                />
            </BoardGrid>

            {/* ── Power inventory: bottom-centered tiny badges ── */}
            {groupedInventory.length > 0 && (
                <div className="fixed bottom-[88px] left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-md border border-white/10 shadow-xl">
                    {targeting && (
                        <span className="text-[8px] font-black uppercase tracking-[0.2em] text-amber-300 animate-pulse">
                            Tap a token
                        </span>
                    )}
                    {groupedInventory.map(g => {
                        const secsLeft = Math.max(0, Math.round((g.soonest - Date.now()) / 1000));
                        const expiring = secsLeft < 30;
                        const mm = Math.floor(secsLeft / 60);
                        const ss = String(secsLeft % 60).padStart(2, '0');
                        return (
                            <button
                                key={g.type}
                                onClick={() => spendPower(g.type)}
                                disabled={!canSpend}
                                aria-label={`Use ${g.type} power, ${g.count} held, expires in ${mm}:${ss}`}
                                className={`relative w-9 h-9 rounded-full flex items-center justify-center border transition-all active:scale-90 disabled:opacity-60 ${targeting?.type === g.type ? 'border-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.7)]' : 'border-white/15 bg-white/5 hover:bg-white/10'} ${expiring ? 'animate-pulse border-amber-400/70' : ''}`}
                            >
                                <PowerGlyph type={g.type} />
                                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-cyan-500 text-black text-[9px] font-black flex items-center justify-center">
                                    {g.count}
                                </span>
                                <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 text-[7px] font-mono tabular-nums ${expiring ? 'text-amber-300' : 'text-white/40'}`}>
                                    {mm}:{ss}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {lxpGain !== null && (
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.8 }}
                    className="absolute top-16 left-1/2 -translate-x-1/2 z-[50] px-4 py-2 bg-black/80 backdrop-blur-md border border-cyan-500/40 rounded-full shadow-[0_0_20px_rgba(34,211,238,0.3)] flex items-center gap-2"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span className="text-sm font-black text-amber-400">+{lxpGain} XP</span>
                </motion.div>
            )}

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

// Tiny power glyphs (no emoji): shield / boost bolt / nuke rings / teleport swirl.
function PowerGlyph({ type }: { type: PowerType }) {
    if (type === 'shield') {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="#67e8f9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3z" /></svg>
        );
    }
    if (type === 'boost') {
        return (
            <svg viewBox="0 0 24 24" fill="#facc15" className="w-4 h-4"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
        );
    }
    if (type === 'nuke') {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" className="w-4 h-4"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="#f87171" /></svg>
        );
    }
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 12a8 8 0 0 1 14-5l2 2" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-14 5l-2-2" /><path d="M4 20v-5h5" /></svg>
    );
}
