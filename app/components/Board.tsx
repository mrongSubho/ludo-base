import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import Dice from './Dice';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { PlayerColor } from '@/hooks/MultiplayerContext';
import {
    Corner, ColorCorner, CORNER_SLOTS, Point,
    shuffleColorCorner, buildPlayerPaths,
    buildPathCellsDynamic, getGridCellInfo
} from '@/lib/boardLayout';
import { Player, PowerType, useGameEngine } from '@/hooks/useGameEngine';

// ─── Full-Screen 15×15 Ludo Board ────────────────────────────────────────────
// Layout:  Yellow (top-left) — Green (top-right)
//          Blue (bottom-left) — Red (bottom-right)

const PLAYER_TEMPLATES = [
    { name: 'Alex', level: 12, avatar: '🎮', isAi: false },
    { name: 'Gemini', level: 8, avatar: '🤖', isAi: true },
    { name: 'Deep', level: 15, avatar: '💾', isAi: true },
    { name: 'Core', level: 10, avatar: '⚙️', isAi: true },
];

const COLOR_SEATS: { color: Player['color']; position: Player['position'] }[] = [
    { color: 'green', position: 'top-right' },
    { color: 'red', position: 'bottom-right' },
    { color: 'yellow', position: 'top-left' },
    { color: 'blue', position: 'bottom-left' },
];

function shufflePlayers(playerCount: '1v1' | '4P' | '2v2' = '4P', isBotMatch: boolean = false): Player[] {
    const usePair1 = Math.random() > 0.5;
    const activeIndices = playerCount === '1v1' ? (usePair1 ? [0, 3] : [1, 2]) : [0, 1, 2, 3];

    const humanTemplate = PLAYER_TEMPLATES.find(p => !p.isAi)!;
    const botTemplates = PLAYER_TEMPLATES.filter(p => p.isAi);

    if (isBotMatch) {
        let assignedHuman = false;
        let botIndex = 0;

        return COLOR_SEATS.map((seat, i) => {
            if (!activeIndices.includes(i)) return null;

            let template;
            if (!assignedHuman) {
                template = humanTemplate;
                assignedHuman = true;
            } else {
                template = botTemplates[botIndex % botTemplates.length];
                botIndex++;
            }

            return { ...template, ...seat, isAi: template.isAi };
        }).filter(Boolean) as Player[];

    } else {
        const templates = [...PLAYER_TEMPLATES].sort(() => Math.random() - 0.5);
        return COLOR_SEATS.map((seat, i) => {
            if (!activeIndices.includes(i)) return null;
            return { ...templates[i], ...seat };
        }).filter(Boolean) as Player[];
    }
}

const getTeam = (color: Player['color']) => {
    return (color === 'green' || color === 'blue') ? 1 : 2;
};

// ─── Icons ───────────────────────────────────────────────────────────────────

const StarMarker = () => (
    <svg className="star-svg" viewBox="0 0 24 24" fill="currentColor">
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
    player,
    onTokenClick,
    playerCount,
}: {
    color: 'green' | 'red' | 'yellow' | 'blue';
    corner: Corner;
    gridRow: string;
    gridCol: string;
    tokensInHome: number[];
    player?: Player;
    onTokenClick: (tokenIndex: number) => void;
    playerCount?: '1v1' | '4P' | '2v2';
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
                                isDraggable={false}
                            />
                        )}
                        {!tokensInHome.includes(idx) && <span className="token-dot-placeholder" />}
                    </div>
                ))}
            </div>
            {player && (
                <div
                    className={`home-player-label ${(corner === 'TL' || corner === 'TR') ? 'label-top-inside' : 'label-bottom-inside'
                        }`}
                >
                    {player.name}
                </div>
            )}
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
                {power && (
                    <div
                        className={`power-inventory-bubble ${isActive && onPowerClick ? 'power-ready' : ''}`}
                        onClick={isActive && onPowerClick ? onPowerClick : undefined}
                    >
                        {powerEmojis[power]}
                    </div>
                )}
                <div
                    className={`avatar-circle ${player.color}`}
                    title={player.name}
                >
                    <span className="avatar-emoji">{player.avatar}</span>
                </div>
                <div className="avatar-level-badge">{player.level}</div>
                {teamLabel && (
                    <div className={`team-badge team-${teamLabel.toLowerCase()}`}>
                        {teamLabel}
                    </div>
                )}
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
    onOpenProfile
}: {
    showLeaderboard?: boolean;
    onToggleLeaderboard?: (show: boolean) => void;
    playerCount?: '1v1' | '4P' | '2v2';
    gameMode?: 'classic' | 'power' | 'snakes';
    isBotMatch?: boolean;
    onOpenProfile?: (address: string) => void;
}) {
    const [players, setPlayers] = useState<Player[]>(() => shufflePlayers(playerCount, isBotMatch));
    const [colorLayout, setColorLayout] = useState<{
        colorCorner: ColorCorner;
        playerPaths: Record<string, Point[]>;
    }>(() => {
        const cc = shuffleColorCorner();
        return { colorCorner: cc, playerPaths: buildPlayerPaths(cc) };
    });
    const { colorCorner, playerPaths } = colorLayout;
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

    const pathCells = useMemo(() => buildPathCellsDynamic(colorCorner), [colorCorner]);

    const {
        localGameState,
        handleRoll,
        handleTokenClick,
        handleUsePower,
        resetGame
    } = useGameEngine({
        initialPlayers: players,
        playerCount,
        gameMode,
        isBotMatch,
        playerPaths,
        pathCells,
        setPlayers,
        setColorLayout
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
                        const isMyTurn = localGameState.currentPlayer === color;
                        const isDraggable = isMyTurn && localGameState.gamePhase === 'moving';
                        const count = tokens.length;
                        const isBlockade = count >= 2;

                        const offsetStyle = activeColors.length > 1 ? {
                            transform: `scale(0.85) translate(${colorIdx * 10 - (activeColors.length - 1) * 5}px, ${colorIdx * 5 - (activeColors.length - 1) * 2.5}px)`,
                            zIndex: isMyTurn ? 30 : 10 + colorIdx,
                            position: 'absolute' as const
                        } : {
                            zIndex: isMyTurn ? 15 : 10
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
                {(['top-left', 'top-right'] as const).map((pos) => {
                    const p = players.find(player => player.position === pos);
                    if (!p) {
                        return <div key={`empty-${pos}`} className="player-placeholder" style={{ width: 140 }}></div>;
                    }
                    return (
                        <div key={p.color} className={`player-wrapper ${localGameState.currentPlayer === p.color ? 'active-turn' : ''} wrapper-${p.position} flex flex-col items-center gap-1`}>
                            <PlayerCard
                                player={p}
                                isActive={localGameState.currentPlayer === p.color}
                                power={localGameState.playerPowers[p.color]}
                                onPowerClick={() => handleUsePower(p.color)}
                                teamLabel={playerCount === '2v2' ? (getTeam(p.color) === 1 ? 'A' : 'B') : null}
                            />
                            {localGameState.currentPlayer === p.color && localGameState.isThinking && p.isAi && (
                                <div className="ai-thinking-tag">Thinking...</div>
                            )}
                            {localGameState.currentPlayer === p.color && !p.isAi && (localGameState.strikes[p.color as keyof typeof localGameState.strikes] || 0) >= 3 && (
                                <div className="ai-thinking-tag afk-tag">Auto-Play</div>
                            )}
                            {localGameState.currentPlayer === p.color && (
                                <div className="player-dice-wrapper">
                                    <Dice
                                        onRoll={handleRoll}
                                        disabled={localGameState.gamePhase !== 'rolling' || !!localGameState.winner || (p.isAi && !localGameState.winner)}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="board-wrapper">
                <div className="board-grid">
                    {/* ── Corner Homes ── */}
                    {(['green', 'red', 'yellow', 'blue'] as const).map((color) => {
                        const isActive = players.some(p => p.color === color);
                        const slot = CORNER_SLOTS[colorCorner[color as PlayerColor]];
                        const gridInfo = { row: slot.gridRow, col: slot.gridCol };

                        const tokensInHome = localGameState.positions[color]
                            .map((pos: number, idx: number) => pos === -1 ? idx : -1)
                            .filter((idx: number) => idx !== -1);

                        return (
                            <div key={color} style={{ opacity: isActive ? 1 : 0.2, display: 'contents' }}>
                                <HomeBlock
                                    color={color}
                                    corner={colorCorner[color as PlayerColor]}
                                    gridRow={gridInfo.row}
                                    gridCol={gridInfo.col}
                                    tokensInHome={tokensInHome}
                                    player={players.find(p => p.color === color)}
                                    onTokenClick={isActive ? (idx) => handleTokenClick(color, idx) : () => { }}
                                    playerCount={playerCount}
                                />
                            </div>
                        );
                    })}

                    {/* ── Center Finish Zone ── */}
                    <div
                        className={`finish-center ${localGameState.invalidMove ? 'shake-feedback' : ''}`}
                        style={{
                            gridRow: '7 / 10',
                            gridColumn: '7 / 10',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            borderRadius: '50%',
                            overflow: 'hidden',
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
                        {/* 1. Cosmic Background Overlay (Sync with Lobby) */}
                        <div className="finish-center-cosmic cosmic-core-bg" style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '50%',
                            opacity: 0.5
                        }}>
                            {/* Dynamic Orbs for depth */}
                            <div className="cosmic-orb cosmic-orb-1 opacity-40 scale-50" />
                            <div className="cosmic-orb cosmic-orb-2 opacity-30 scale-50" />
                        </div>

                        {/* 2. Junction Background Fill (Erases clockwise from top) */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '50%',
                            overflow: 'hidden',
                            pointerEvents: 'none',
                            zIndex: 1
                        }}>
                            <motion.div style={{
                                position: 'absolute',
                                inset: 0,
                                background: useTransform(sweepProgress, (v) =>
                                    `conic-gradient(rgba(0,0,0,0) 0% ${v}%, ${activeColor} ${v + 0.5}% 100%)`
                                ),
                                maskImage: 'radial-gradient(circle, transparent 42%, black 43%)',
                                WebkitMaskImage: 'radial-gradient(circle, transparent 42%, black 43%)'
                            }} />
                            {/* Subtle darkening for depth */}
                            <div style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'black',
                                opacity: 0.1,
                                maskImage: 'radial-gradient(circle, transparent 42%, black 43%)',
                                WebkitMaskImage: 'radial-gradient(circle, transparent 42%, black 43%)'
                            }}
                            />
                        </div>

                        {/* 3. Timer Ring & Progress Point (84% diameter) */}
                        <div className="junction-timer-container" style={{
                            position: 'absolute',
                            inset: '8%',
                            width: '84%',
                            height: '84%',
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
                                        `conic-gradient(rgba(0,0,0,0) 0% ${v}%, ${activeColor} ${v + 0.5}% 100%)`
                                    ),
                                    zIndex: 2,
                                    position: 'absolute',
                                    inset: 0
                                }}
                            />
                            {/* Glowing Progress Point */}
                            <motion.div
                                className="junction-timer-point"
                                style={{
                                    rotate: pointRotation,
                                    position: 'absolute',
                                    inset: 0,
                                    zIndex: 10
                                }}
                            >
                                <div style={{
                                    position: 'absolute',
                                    right: '-4px',
                                    top: '50%',
                                    marginTop: '-4px',
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: activeColor,
                                    boxShadow: `0 0 15px ${activeColor}`,
                                }} />
                            </motion.div>
                        </div>

                        {/* 4. Central Glass Badge with Rotating Star */}
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
                            style={{
                                width: '45%',
                                height: '45%',
                                borderRadius: '50%',
                                background: 'rgba(255, 255, 255, 0.15)',
                                backdropFilter: 'blur(16px)',
                                border: '1px solid rgba(255, 255, 255, 0.25)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                                zIndex: 10,
                                position: 'relative'
                            }}
                        >
                            <motion.svg
                                viewBox="0 0 24 24"
                                className="star-rotate-anim"
                                animate={{
                                    fill: 'var(--active-player-color)',
                                    rotate: 360
                                }}
                                transition={{
                                    fill: { duration: 0.5 },
                                    rotate: { duration: 8, repeat: Infinity, ease: "linear" }
                                }}
                                style={{
                                    width: '75%',
                                    height: '75%',
                                    filter: 'drop-shadow(0 0 8px var(--active-player-color))',
                                    position: 'absolute',
                                    zIndex: 2
                                }}
                            >
                                <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
                            </motion.svg>
                        </motion.div>

                        {/* 5. Ambient Pulse Ring */}
                        <motion.div
                            animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.4, 0.2] }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            style={{
                                position: 'absolute',
                                width: '70%',
                                height: '70%',
                                borderRadius: '50%',
                                border: '1px dashed rgba(255,255,255,0.1)',
                                zIndex: 1
                            }}
                        />
                    </div>

                    {/* ── Path Squares ── */}
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
                {(['bottom-left', 'bottom-right'] as const).map((pos) => {
                    const p = players.find(player => player.position === pos);
                    if (!p) {
                        return <div key={`empty-${pos}`} className="player-placeholder" style={{ width: 140 }}></div>;
                    }
                    return (
                        <div key={p.color} className={`player-wrapper ${localGameState.currentPlayer === p.color ? 'active-turn' : ''} wrapper-${p.position} flex flex-col-reverse items-center gap-1`}>
                            <PlayerCard
                                player={p}
                                isActive={localGameState.currentPlayer === p.color}
                                power={localGameState.playerPowers[p.color]}
                                onPowerClick={() => handleUsePower(p.color)}
                                teamLabel={playerCount === '2v2' ? (getTeam(p.color) === 1 ? 'A' : 'B') : null}
                            />
                            {localGameState.currentPlayer === p.color && localGameState.isThinking && p.isAi && (
                                <div className="ai-thinking-tag">Thinking...</div>
                            )}
                            {/* Auto-play Mode Tag */}
                            {localGameState.currentPlayer === p.color && !p.isAi && (localGameState.strikes[p.color as keyof typeof localGameState.strikes] || 0) >= 3 && (
                                <div className="ai-thinking-tag afk-tag">Auto-Play</div>
                            )}
                            {localGameState.currentPlayer === p.color && (
                                <div className="player-dice-wrapper">
                                    <Dice
                                        onRoll={handleRoll}
                                        disabled={localGameState.gamePhase !== 'rolling' || !!localGameState.winner || (p.isAi && !localGameState.winner)}
                                    />
                                </div>
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
