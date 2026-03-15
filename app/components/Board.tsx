import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import Dice from './Dice';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { PlayerColor, PowerType } from '@/lib/types';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import {
    Corner, ColorCorner, CORNER_SLOTS, Point,
    shuffleColorCorner, assignCorners2v2, assignCornersFFA,
    buildPlayerPaths, buildPathCellsDynamic, getGridCellInfo,
    shufflePlayers
} from '@/lib/boardLayout';
import { useGameEngine, Player } from '@/hooks/useGameEngine';
import { getTeammateColor } from '@/lib/gameLogic';
import { useMultiplayer } from '@/hooks/useMultiplayer';

// ─── Full-Screen 15×15 Ludo Board ────────────────────────────────────────────
// Layout:  Yellow (top-left) — Green (top-right)
//          Blue (bottom-left) — Red (bottom-right)



// ─── Icons ───────────────────────────────────────────────────────────────────

const StarMarker = ({ color }: { color?: string }) => (
    <svg className="star-svg" viewBox="0 0 24 24" fill="currentColor" style={{ color }}>
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
    </svg>
);

const ArrowMarker = ({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) => {
    const rotation = { right: 0, down: 90, left: 180, up: 270 }[dir];
    return (
        <svg
            className="home-arrow-svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ transform: `rotate(${rotation}deg)` }}
        >
            <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
        </svg>
    );
};

function HomeBlock({
    color,
    corner,
    gridRow,
    gridCol,
    tokensInHome,
    onTokenClick,
    isDraggable,
}: {
    color: 'green' | 'red' | 'yellow' | 'blue';
    corner: Corner;
    gridRow: string;
    gridCol: string;
    tokensInHome: number[];
    onTokenClick: (tokenIndex: number) => void;
    isDraggable?: boolean;
}) {
    return (
        <div
            className={`board-home ${color}`}
            data-corner={corner}
            style={{ gridRow, gridColumn: gridCol }}
        >
            <div className="home-pad">
                {[0, 1, 2, 3].map((idx) => (
                    <div key={idx} className="token-dot-wrapper">
                        {tokensInHome.includes(idx) && (
                            <Token
                                color={color}
                                onClick={() => onTokenClick(idx)}
                                isDraggable={isDraggable}
                            />
                        )}
                        {!tokensInHome.includes(idx) && <span className="token-dot-placeholder" />}
                    </div>
                ))}
            </div>
        </div>
    );
}

function Token({
    color,
    onClick,
    isDraggable,
    count = 1,
    isBlockade = false
}: {
    color: string;
    onClick?: () => void;
    isDraggable?: boolean;
    count?: number;
    isBlockade?: boolean;
}) {
    return (
        <motion.div
            layout
            initial={false}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`ludo-token ${color}-token ${isDraggable ? 'draggable' : ''} ${isBlockade ? 'token-blockade' : ''}`}
            onClick={onClick}
            whileHover={isDraggable ? { scale: 1.15, y: -4 } : { scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
        >
            {count > 1 && (
                <div className="token-count-badge">
                    {count}
                </div>
            )}
            {isBlockade && (
                <div className="blockade-glow" />
            )}
        </motion.div>
    );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const getDisplayName = (player: Player) => {
    if (player.isAi) return player.name;
    if (player.name && !player.name.startsWith('0x')) return player.name;
    if (player.walletAddress) {
        return `Guest ${player.walletAddress.slice(-6).toUpperCase()}`;
    }
    return player.name || 'Guest';
};

function PlayerCard({
    player,
    isActive,
    power,
    onPowerClick,
    teamLabel,
}: {
    player: Player;
    isActive: boolean;
    power: PowerType | null;
    onPowerClick?: () => void;
    teamLabel?: 'A' | 'B' | null;
}) {
    const powerEmojis: Record<PowerType, string> = { shield: '🛡️', boost: '⚡', bomb: '💣', warp: '🧲' };

    return (
        <div className={`player-card player-card-corner ${player.position}`}>
            <div className="avatar-circle-wrapper">
                <div
                    className={`avatar-circle ${player.color} ${isActive ? 'active-glow' : ''}`}
                    title={getDisplayName(player)}
                >
                    {player.avatar && (player.avatar.startsWith('http') || player.avatar.startsWith('/')) ? (
                        <img
                            src={player.avatar}
                            alt={player.name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <span className="avatar-emoji">{player.avatar || '👤'}</span>
                    )}
                </div>
                <div className="avatar-level-badge">{player.level}</div>
            </div>
        </div>
    );
}

export default function Board({
    showLeaderboard = false,
    onToggleLeaderboard,
    playerCount = '4P',
    gameMode = 'classic',
    isBotMatch = false,
    onOpenProfile,
    initialPlayers,
    initialColorCorner
}: {
    showLeaderboard?: boolean;
    onToggleLeaderboard?: (show: boolean) => void;
    playerCount?: '1v1' | '4P' | '2v2';
    gameMode?: 'classic' | 'power' | 'snakes';
    isBotMatch?: boolean;
    onOpenProfile?: (address: string) => void;
    initialPlayers?: Player[];
    initialColorCorner?: ColorCorner;
}) {
    const { address } = useAccount();
    const { participants } = useMultiplayer();
    // ─── Unified Board Initialization ──────────────────────────────────────────
    const [boardConfig, setBoardConfig] = useState(() => {
        if (initialPlayers && initialColorCorner) {
            return {
                players: initialPlayers,
                colorCorner: initialColorCorner,
                playerPaths: buildPlayerPaths(initialColorCorner)
            };
        }
        // 1. Generate core layout mapping first
        const cc = playerCount === '2v2' ? assignCorners2v2() : assignCornersFFA(playerCount as '1v1' | '4P');

        // 2. Generate players based EXACTLY on that mapping
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

    // ─── Real Profile Syncing ──────────────────────────────────────────────────
    useEffect(() => {
        const syncMyProfile = async () => {
            if (!address) return;

            try {
                const { data, error } = await supabase
                    .from('players')
                    .select('username, avatar_url, total_wins')
                    .eq('wallet_address', address.toLowerCase())
                    .single();

                if (data && !error) {
                    setBoardConfig(prev => ({
                        ...prev,
                        players: prev.players.map(p => {
                            // Replace the first non-AI player (usually the local user)
                            if (!p.isAi && (p.name === 'Alex' || p.walletAddress === address.toLowerCase())) {
                                return {
                                    ...p,
                                    name: data.username || p.name,
                                    avatar: data.avatar_url || p.avatar,
                                    walletAddress: address.toLowerCase(),
                                    level: Math.max(p.level, Math.floor(data.total_wins / 5) + 1)
                                };
                            }
                            return p;
                        })
                    }));
                }
            } catch (err) {
                console.error("Board: Profile sync failed", err);
            }
        };

        syncMyProfile();
    }, [address]);

    // ─── Multiplayer Profile Sync ──────────────────────────────────────────────
    useEffect(() => {
        if (!participants || Object.keys(participants).length === 0) return;

        setBoardConfig(prev => ({
            ...prev,
            players: prev.players.map(p => {
                const pData = participants[p.walletAddress?.toLowerCase() || ''];
                if (pData) {
                    return {
                        ...p,
                        name: pData.username || p.name,
                        avatar: pData.avatar_url || p.avatar
                    };
                }
                return p;
            })
        }));
    }, [participants]);

    const { players, colorCorner, playerPaths } = boardConfig;
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

    // ─── Visual Quadrant Algorithm ──────────────────────────────────────────────
    // Calculates board rotation AND UI slot mapping from server data using
    // modular arithmetic. No reliance on hardcoded player.position fields.
    //
    // Corner indices in clockwise order: TL=0, TR=1, BR=2, BL=3
    const CORNER_ORDER: Corner[] = ['TL', 'TR', 'BR', 'BL'];

    const { boardRotationDeg, counterRotationDeg, uiSlots } = useMemo(() => {
        // 1. Identify local player color
        const myAddrLower = address?.toLowerCase();
        const localPlayer = players.find(p => myAddrLower && p.walletAddress?.toLowerCase() === myAddrLower)
            || players.find(p => !p.isAi)
            || players[0];
            
        const localColor = localPlayer?.color as PlayerColor;

        // 2. Where did the server place the local player?
        // Fallback to 'BL' if not found, but it should always be found if players are sync'd
        const localServerCorner = (colorCorner && localColor) ? colorCorner[localColor] : 'BL';
        const localServerIndex = CORNER_ORDER.indexOf(localServerCorner as Corner);

        // 3. We want the local player at BL (index 3).
        //    Offset = (target - server + 4) % 4
        const TARGET_INDEX = 3; // BL
        const rotationOffset = (TARGET_INDEX - localServerIndex + 4) % 4;

        // 4. Board rotation in degrees (each offset step = 90° CW)
        const boardRotDeg = rotationOffset * 90;
        const counterRotDeg = boardRotDeg !== 0 ? -boardRotDeg : 0;

        // 5. Map ALL colors to their visual screen corners
        const slots: Record<Corner, PlayerColor | null> = { TL: null, TR: null, BL: null, BR: null };
        (Object.entries(colorCorner) as [PlayerColor, Corner][]).forEach(([color, serverCorner]) => {
            const serverIndex = CORNER_ORDER.indexOf(serverCorner);
            // Apply the same offset: visualIndex = (serverIndex + offset) % 4
            const visualIndex = (serverIndex + rotationOffset) % 4;
            const visualCorner = CORNER_ORDER[visualIndex];
            slots[visualCorner] = color;
        });

        return { boardRotationDeg: boardRotDeg, counterRotationDeg: counterRotDeg, uiSlots: slots };
    }, [colorCorner, players]);

    const pathCells = useMemo(() => buildPathCellsDynamic(colorCorner), [colorCorner]);

    const {
        localGameState,
        handleRoll,
        handleTokenClick,
        handleUsePower,
        resetGame,
        getNextPlayer,
        cancelAfk
    } = useGameEngine({
        initialPlayers: players,
        playerCount,
        gameMode,
        isBotMatch,
        playerPaths,
        colorCorner,
        pathCells,
        setBoardConfig
    });

    const [boardTheme] = useState('default');

    // --- Smooth Junction Animation Logic ---
    const smoothProgress = useMotionValue(localGameState.timeLeft / 15);
    const prevPlayerRef = useRef(localGameState.currentPlayer);

    useEffect(() => {
        if (prevPlayerRef.current !== localGameState.currentPlayer) {
            // New turn - jump to full progress instantly
            smoothProgress.set(1);
            prevPlayerRef.current = localGameState.currentPlayer;
        }

        // Animate the smoothProgress value to match the discrete timeLeft
        animate(smoothProgress, localGameState.timeLeft / 15, {
            duration: 1,
            ease: "linear"
        });
    }, [localGameState.timeLeft, localGameState.currentPlayer, smoothProgress]);

    // Derived transform for the background sweep (Inverse of progress)
    // We want the wedge to grow clockwise from 12:00 (0deg)
    const sweepProgress = useTransform(smoothProgress, [0, 1], [100, 0]);
    // Derived rotation for the Progress Point (starts at -90deg for 12:00)
    const pointRotation = useTransform(smoothProgress, [0, 1], [270, -90]);

    // Derived color map for absolute synchronization
    const activeColor = {
        green: '#4CAF50',
        red: '#F44336',
        blue: '#2196F3',
        yellow: '#FFEB3B'
    }[localGameState.currentPlayer] || '#cbd5e1';

    const renderTokensOnPath = () => {
        const coordGroups: Record<string, Record<PlayerColor, number[]>> = {};
        const pointMap: Record<string, Point> = {};

        (['green', 'red', 'blue', 'yellow'] as const).forEach((color) => {
            if (!players.some(p => p.color === color)) return;
            localGameState.positions[color].forEach((pos, idx) => {
                if (pos >= 0 && pos < 57) {
                    const point = playerPaths[color][pos];
                    if (!point) return;
                    const coordKey = `${point.r}-${point.c}`;
                    if (!coordGroups[coordKey]) {
                        coordGroups[coordKey] = { green: [], red: [], yellow: [], blue: [] };
                        pointMap[coordKey] = point;
                    }
                    coordGroups[coordKey][color].push(idx);
                }
            });
        });

        return Object.entries(coordGroups).map(([coordKey, colorSets]) => {
            const point = pointMap[coordKey];
            const activeColors = (Object.entries(colorSets) as [PlayerColor, number[]][])
                .filter(([, tokens]) => tokens.length > 0);

            return (
                <div
                    key={coordKey}
                    className="token-group-on-grid"
                    style={{
                        gridRow: point.r,
                        gridColumn: point.c,
                        display: 'flex',
                        alignItems: 'center',
                        justifyItems: 'center',
                        width: '100%',
                        height: '100%',
                        position: 'relative'
                    }}
                >
                    {activeColors.map(([color, tokens], colorIdx) => {
                        const myPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);
                        const myColor = myPlayer?.color;
                        const isItsMyTurn = localGameState.currentPlayer === myColor;

                        const teammate = getTeammateColor(myColor as PlayerColor, playerCount);
                        const isTeammateColor = teammate === color;
                        const posMap = localGameState.positions as Record<PlayerColor, number[]>;
                        const isSelfFinished = myColor ? posMap[myColor].every((p: number) => p === 57) : false;

                        const canHelpTeammate = isTeammateColor && isSelfFinished && playerCount === '2v2';
                        const isDraggable = isItsMyTurn && localGameState.gamePhase === 'moving' &&
                            (color === myColor || canHelpTeammate);
                        const count = tokens.length;
                        const isBlockade = count >= 2;

                        const isColorTurn = localGameState.currentPlayer === color;
                        const offsetStyle = activeColors.length > 1 ? {
                            transform: `scale(0.85) translate(${colorIdx * 10 - (activeColors.length - 1) * 5}px, ${colorIdx * 5 - (activeColors.length - 1) * 2.5}px)`,
                            zIndex: isColorTurn ? 30 : 10 + colorIdx,
                            position: 'absolute' as const
                        } : {
                            zIndex: isColorTurn ? 15 : 10
                        };

                        return (
                            <motion.div
                                key={`${coordKey}-${color}`}
                                layout
                                initial={false}
                                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                style={{ ...offsetStyle, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                                <Token
                                    color={color}
                                    count={count}
                                    isBlockade={isBlockade}
                                    isDraggable={isDraggable}
                                    onClick={() => {
                                        if (isDraggable) {
                                            handleTokenClick(color, tokens[0]);
                                        }
                                    }}
                                />
                            </motion.div>
                        );
                    })}
                </div>
            );
        });
    };

    return (
        <div data-theme="default" className="board-outer board-match-theme-wrapper w-full h-[100dvh]">
            {/* ── Top Player Row  ── */}
            <div className="player-row player-row-top">
                {(['TL', 'TR'] as const).map((corner) => {
                    const color = uiSlots[corner];
                    const p = players.find(player => player.color === color);
                    if (!p) {
                        return <div key={`empty-${corner}`} className="player-placeholder" style={{ width: 140 }}></div>;
                    }
                    const myPlayer = players.find(pl => address && pl.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(pl => !pl.isAi);
                    const isMyColor = p.color === myPlayer?.color;
                    const isMyTurn = localGameState.currentPlayer === p.color;
                    const isCurrentlyBot = p.isAi;
                    const canRoll = isMyTurn && isMyColor && !isCurrentlyBot && localGameState.gamePhase === 'rolling';
                    // TL: Dice on Right (flex-row), TR: Dice on Left (flex-row-reverse)
                    const flexDir = corner === 'TL' ? 'flex-row' : 'flex-row-reverse';

                    return (
                        <div key={p.color} className={`player-wrapper ${isMyTurn ? 'active-turn' : ''} flex ${flexDir} items-center gap-3`}>
                            <PlayerCard
                                player={p}
                                isActive={isMyTurn}
                                power={localGameState.playerPowers[p.color]}
                                onPowerClick={() => handleUsePower(p.color)}
                            />
                            {isMyTurn && (
                                <Dice
                                    onRoll={(val) => handleRoll(val)}
                                    disabled={!canRoll}
                                    currentValue={localGameState.diceValue}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Board Area: relative container for rotating board + static overlay ── */}
            <div 
                className="board-area" 
                style={{ position: 'relative', width: '100%', cursor: 'pointer' }}
                onClick={() => {
                    const myPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);
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
                    <div className="board-grid">
                        {/* ── Corner Homes ── */}
                        {(['green', 'red', 'yellow', 'blue'] as const).map((color) => {
                            const isActive = players.some(p => p.color === color);
                            const slot = CORNER_SLOTS[colorCorner[color as PlayerColor]];
                            const gridInfo = { row: slot.gridRow, col: slot.gridCol };

                            const tokensInHome = localGameState.positions[color as PlayerColor]
                                .map((pos: number, idx: number) => pos === -1 ? idx : -1)
                                .filter((idx: number) => idx !== -1);

                            const isMyTurn = localGameState.currentPlayer === color;
                            const teammate = getTeammateColor(localGameState.currentPlayer as PlayerColor, playerCount);
                            const selfFinished = localGameState.positions[localGameState.currentPlayer as PlayerColor].every((p: number) => p === 57);
                            const isTeammateTurnShortcut = teammate === color && selfFinished;

                            const isDraggable = (isMyTurn || isTeammateTurnShortcut) && localGameState.gamePhase === 'moving' && localGameState.diceValue === 6;

                            return (
                                <div key={color} style={{ opacity: isActive ? 1 : 0.2, display: 'contents' }}>
                                    <HomeBlock
                                        color={color}
                                        corner={colorCorner[color as PlayerColor]}
                                        gridRow={gridInfo.row}
                                        gridCol={gridInfo.col}
                                        tokensInHome={tokensInHome}
                                        onTokenClick={isActive ? (idx) => handleTokenClick(color, idx) : () => { }}
                                        isDraggable={isDraggable}
                                    />
                                </div>
                            );
                        })}

                        {/* ── Path Squares (Now inside board-grid) ── */}
                        {pathCells.map(({ row, col, cls }: { row: number, col: number, cls: string }) => {
                            const cellInfo = getGridCellInfo(row, col, colorCorner);
                            const isPower = localGameState.powerTiles.some((pt: { r: number, c: number }) => pt.r === row && pt.c === col);
                            const trap = localGameState.activeTraps.find((t: { r: number, c: number }) => t.r === row && t.c === col);

                            return (
                                <div
                                    key={`${row}-${col}`}
                                    className={`${cls} ${isPower ? 'power-cell' : ''}`}
                                    style={{ gridRow: row, gridColumn: col }}
                                >
                                    {cellInfo.type === 'safe' && <StarMarker />}
                                    {isPower && !trap && <span className="power-icon" style={{ fontSize: 16 }}>⚡</span>}
                                    {trap && <span className="trap-icon" style={{ fontSize: 16 }}>💣</span>}
                                    {/* Directional arrow at home lane entries — dynamic per colorCorner */}
                                    {(Object.entries(colorCorner) as [PlayerColor, Corner][]).map(([, corner]) => {
                                        const slot = CORNER_SLOTS[corner];
                                        if (slot.arrowCell.r === row && slot.arrowCell.c === col) {
                                            return <ArrowMarker key={`arrow-${row}-${col}`} dir={slot.arrowDir} />;
                                        }
                                        return null;
                                    })}
                                </div>
                            );
                        })}

                        {/* ── Tokens ── */}
                        {renderTokensOnPath()}
                    </div>

                    {/* ── Center Finish Zone (Sibling to grid to avoid clipping) ── */}
                    <div
                        className={`finish-center ${localGameState.invalidMove ? 'shake-feedback' : ''}`}
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: `translate(-50%, -50%) rotate(${counterRotationDeg}deg)`,
                            width: '20%', // 3 cells / 15 cells = 20%
                            height: '20%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '16px',
                            overflow: 'visible',
                            background: 'transparent',
                            boxShadow: 'none',
                            zIndex: 10,
                            // Define the active player color once as a CSS variable
                            ['--active-player-color' as any]: {
                                green: '#4CAF50',
                                red: '#F44336',
                                blue: '#2196F3',
                                yellow: '#FFEB3B'
                            }[localGameState.currentPlayer] || '#cbd5e1'
                        }}
                        key={localGameState.currentPlayer}
                    >
                        {/* 1. Junction Corner Reflections (Reveal cosmic background) */}
                        <div className="finish-center-corner-glimpse" style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '16px',
                            opacity: 0.8,
                            overflow: 'hidden',
                            zIndex: 0
                        }}>
                            <div className="cosmic-orb cosmic-orb-1 opacity-60 scale-50" />
                            <div className="cosmic-orb cosmic-orb-2 opacity-40 scale-50" />
                        </div>

                        {/* 2. Glass Functional Core (GameLobby Style - Near Opaque) */}
                        <div className="finish-center-functional-core glass-panel" style={{
                            position: 'absolute',
                            inset: '1%',
                            borderRadius: '50%',
                            background: 'rgba(26, 28, 41, 0.95)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            zIndex: 1,
                            overflow: 'hidden',
                            boxShadow: '0 0 50px rgba(0,0,0,0.8)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            {/* Ambient Heart Pulse (Neutral/Subtle) */}
                            <motion.div
                                animate={{ scale: [1, 1.05, 1], opacity: [0.05, 0.1, 0.05] }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                style={{
                                    position: 'absolute',
                                    inset: '15%',
                                    borderRadius: '50%',
                                    background: `radial-gradient(circle, white 0%, transparent 70%)`,
                                    zIndex: 0
                                }}
                            />

                            {/* Center Star Badge (Animated & Dynamic Color) */}
                            <motion.div
                                animate={{
                                    scale: [1, 1.15, 1],
                                    rotate: [0, 8, 0, -8, 0]
                                }}
                                transition={{
                                    duration: 3,
                                    repeat: Infinity,
                                    ease: "easeInOut"
                                }}
                                style={{
                                    position: 'absolute',
                                    inset: '25%',
                                    zIndex: 10,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                <div className="glass-core" style={{
                                    width: '100%',
                                    height: '100%',
                                    borderRadius: '50%',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    backdropFilter: 'blur(8px)',
                                    border: '1px solid rgba(255, 255, 255, 0.15)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: activeColor,
                                    boxShadow: `0 0 30px -5px ${activeColor}66`
                                }}>
                                    <StarMarker color={activeColor} />
                                </div>
                            </motion.div>
                        </div>

                        {/* 3. Timer Ring & Progress Point */}
                        <div className="junction-timer-container" style={{
                            position: 'absolute',
                            inset: '6%',
                            width: '88%',
                            height: '88%',
                            pointerEvents: 'none',
                            zIndex: 2,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '50%'
                        }}>
                            <div className="junction-timer-track-css" />
                            <motion.div
                                className="junction-timer-color-ring"
                                style={{
                                    background: useTransform(sweepProgress, (v) =>
                                        `conic-gradient(#000000 0% ${v}%, ${activeColor} ${v + 0.2}% 100%)`
                                    ),
                                    zIndex: 2,
                                    position: 'absolute',
                                    inset: 0
                                }}
                            />
                            <motion.div
                                className="junction-timer-point"
                                style={{ rotate: pointRotation, position: 'absolute', inset: 0, zIndex: 10 }}
                            >
                                <div style={{
                                    position: 'absolute',
                                    right: '0px',
                                    top: '50%',
                                    marginTop: '-0.5px',
                                    width: '1px',
                                    height: '1px',
                                    borderRadius: '50%',
                                    backgroundColor: activeColor,
                                    boxShadow: `0 0 8px 3px ${activeColor}`,
                                }} />
                            </motion.div>
                        </div>
                    </div>

                    {/* --- Status Notification --- */}
                    <AnimatePresence>
                        {localGameState.captureMessage && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="capture-toast"
                            >
                                {localGameState.captureMessage}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* ── Static Name Overlay (non-rotating, sits on top of board) ── */}
                <div
                    className="board-name-overlay"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        zIndex: 15,
                    }}
                >
                    {/* Top-Left name — anchored to top edge */}
                    {uiSlots.TL && (() => {
                        const p = players.find(pl => pl.color === uiSlots.TL);
                        return p ? (
                            <div className={`home-player-label label-top-inside ${uiSlots.TL}`}
                                style={{ position: 'absolute', top: 0, left: '20%', width: '34%', transform: 'translateX(-50%)' }}>
                                {getDisplayName(p)}
                            </div>
                        ) : null;
                    })()}
                    {/* Top-Right name — anchored to top edge */}
                    {uiSlots.TR && (() => {
                        const p = players.find(pl => pl.color === uiSlots.TR);
                        return p ? (
                            <div className={`home-player-label label-top-inside ${uiSlots.TR}`}
                                style={{ position: 'absolute', top: 0, left: '80%', width: '34%', transform: 'translateX(-50%)' }}>
                                {getDisplayName(p)}
                            </div>
                        ) : null;
                    })()}
                    {/* Bottom-Left name — anchored to bottom edge */}
                    {uiSlots.BL && (() => {
                        const p = players.find(pl => pl.color === uiSlots.BL);
                        return p ? (
                            <div className={`home-player-label label-bottom-inside ${uiSlots.BL}`}
                                style={{ position: 'absolute', bottom: 0, left: '20%', width: '34%', transform: 'translateX(-50%)' }}>
                                {getDisplayName(p)}
                            </div>
                        ) : null;
                    })()}
                    {/* Bottom-Right name — anchored to bottom edge */}
                    {uiSlots.BR && (() => {
                        const p = players.find(pl => pl.color === uiSlots.BR);
                        return p ? (
                            <div className={`home-player-label label-bottom-inside ${uiSlots.BR}`}
                                style={{ position: 'absolute', bottom: 0, left: '80%', width: '34%', transform: 'translateX(-50%)' }}>
                                {getDisplayName(p)}
                            </div>
                        ) : null;
                    })()}
                </div>

                {/* --- Idle Warning Overlay --- */}
                <AnimatePresence>
                    {localGameState.idleWarning && (() => {
                        const myPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);
                        if (localGameState.idleWarning.player === myPlayer?.color) {
                            return (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        zIndex: 50,
                                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '16px',
                                        color: '#fff',
                                        backdropFilter: 'blur(4px)'
                                    }}
                                >
                                    <motion.div 
                                        initial={{ scale: 0.8, y: 20 }}
                                        animate={{ scale: 1, y: 0 }}
                                        style={{ textAlign: 'center', padding: '32px', background: '#1e293b', borderRadius: '16px', border: '2px solid #ef4444' }}
                                    >
                                        <h2 style={{ fontSize: '24px', margin: '0 0 12px 0', color: '#ef4444', fontWeight: 'bold' }}>Are you still there?</h2>
                                        <p style={{ fontSize: '18px', margin: '0 0 24px 0', opacity: 0.9 }}>
                                            Auto-kicking in <span style={{ fontWeight: 'bold', fontSize: '24px' }}>{localGameState.idleWarning.timeLeft}s</span>
                                        </p>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (myPlayer?.color) cancelAfk(myPlayer.color);
                                            }}
                                            style={{
                                                padding: '12px 32px',
                                                background: '#3b82f6',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '8px',
                                                fontSize: '18px',
                                                fontWeight: 'bold',
                                                cursor: 'pointer',
                                                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)'
                                            }}
                                        >
                                            I'm Back!
                                        </button>
                                    </motion.div>
                                </motion.div>
                            );
                        }
                        return null;
                    })()}
                </AnimatePresence>

            </div>{/* end board-area */}

            {/* --- Celebration Overlay --- */}
            <AnimatePresence>
                {localGameState.winner && (
                    <div className="winner-overlay">
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="winner-card"
                        >
                            <span className="celebration-emoji">🏆</span>
                            <h2 style={{ textTransform: 'capitalize' }}>{localGameState.winner} Wins!</h2>
                            <p>Masterful play!</p>
                            <button className="play-again-btn" onClick={resetGame}>Rematch</button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── Bottom Player Row ── */}
            <div className="player-row player-row-bottom">
                {(['BL', 'BR'] as const).map((corner) => {
                    const color = uiSlots[corner];
                    const p = players.find(player => player.color === color);
                    if (!p) {
                        return <div key={`empty-${corner}`} className="player-placeholder" style={{ width: 140 }}></div>;
                    }
                    const isMyTurn = localGameState.currentPlayer === p.color;
                    const canRoll = isMyTurn && localGameState.gamePhase === 'rolling';
                    // BL: Dice on Right (flex-row), BR: Dice on Left (flex-row-reverse)
                    const flexDir = corner === 'BL' ? 'flex-row' : 'flex-row-reverse';

                    return (
                        <div key={p.color} className={`player-wrapper ${isMyTurn ? 'active-turn' : ''} flex ${flexDir} items-center gap-3`}>
                            <PlayerCard
                                player={p}
                                isActive={isMyTurn}
                                power={localGameState.playerPowers[p.color]}
                                onPowerClick={() => handleUsePower(p.color)}
                            />
                            {isMyTurn && (
                                <Dice
                                    onRoll={(val) => handleRoll(val)}
                                    disabled={!canRoll}
                                    currentValue={localGameState.diceValue}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            <Leaderboard
                isOpen={showLeaderboard}
                onClose={() => onToggleLeaderboard?.(false)}
                onOpenProfile={onOpenProfile || (() => { })}
            />

            {/* ── Player Profile Sheet ── */}
            {
                selectedPlayer && (
                    <PlayerProfileSheet
                        player={selectedPlayer}
                        wins={localGameState.positions[selectedPlayer.color].filter((p: number) => p === 57).length}
                        onClose={() => setSelectedPlayer(null)}
                    />
                )
            }
        </div >
    );
}
