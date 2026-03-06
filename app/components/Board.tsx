import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Dice from './Dice';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { PlayerColor } from '@/hooks/MultiplayerContext';
import {
    Corner, ColorCorner, CORNER_SLOTS, Point,
    shuffleColorCorner, buildPlayerPaths,
    buildPathCellsDynamic
} from '@/lib/boardLayout';
import { Player, PowerType, useGameEngine } from '@/hooks/useGameEngine';

// ─── Full-Screen 15×15 Ludo Board ────────────────────────────────────────────
// Diagonal-opposite pairs:  Green ↔ Blue  |  Red ↔ Yellow
// Layout:  Green (top-left)  —  Red (top-right)
//          Yellow (bottom-left) — Blue (bottom-right)


const PLAYER_TEMPLATES = [
    { name: 'Alex', level: 12, avatar: '🎮', isAi: false },
    { name: 'Gemini', level: 8, avatar: '🤖', isAi: true },
    { name: 'Deep', level: 15, avatar: '💾', isAi: true },
    { name: 'Core', level: 10, avatar: '⚙️', isAi: true },
];

// Fixed: color → corner position (diagonal pairs: green↔blue, red↔yellow)
const COLOR_SEATS: { color: Player['color']; position: Player['position'] }[] = [
    { color: 'green', position: 'bottom-left' },
    { color: 'red', position: 'bottom-right' },
    { color: 'yellow', position: 'top-left' },
    { color: 'blue', position: 'top-right' },
];

function shufflePlayers(playerCount: '1v1' | '4P' | '2v2' = '4P', isBotMatch: boolean = false): Player[] {
    // In a 2-player game, we only want 2 diagonal colors. 
    // Which 2? Either 'green'/'blue' or 'red'/'yellow'
    const usePair1 = Math.random() > 0.5; // True: Green(0) & Blue(3), False: Red(1) & Yellow(2)
    const activeIndices = playerCount === '1v1' ? (usePair1 ? [0, 3] : [1, 2]) : [0, 1, 2, 3];

    // Separate human from bots
    const humanTemplate = PLAYER_TEMPLATES.find(p => !p.isAi)!;
    const botTemplates = PLAYER_TEMPLATES.filter(p => p.isAi);

    if (isBotMatch) {
        // Enforce exact AI layout
        // For 4P and 2v2: We have 4 slots. 1 Human + 3 Bots.
        // For 1v1 (count '2'): We have 2 slots. 1 Human + 1 Bot.

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
        // Normal multiplayer shuffle
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
    const teamLetter = playerCount === '2v2' ? (getTeam(color) === 1 ? 'A' : 'B') : null;
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
                <div className="home-player-label">
                    {player.name.slice(0, 12)}
                </div>
            )}
        </div>
    );
}

// ─── Token Component ──────────────────────────────────────────────────────────

function Token({
    color,
    onClick,
    isDraggable
}: {
    color: string;
    onClick?: () => void;
    isDraggable?: boolean;
}) {
    return (
        <motion.div
            layout
            initial={false}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`ludo-token ${color}-token ${isDraggable ? 'draggable' : ''}`}
            onClick={onClick}
            whileHover={isDraggable ? { scale: 1.15, y: -4 } : { scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
        />
    );
}

// ─── Player Card ─────────────────────────────────────────────────────────────

function PlayerCard({
    player,
    isActive,
    timeLeft,
    strikes,
    power,
    onPowerClick,
    onAvatarClick,
    teamLabel,
}: {
    player: Player;
    isActive: boolean;
    timeLeft: number;
    strikes: number;
    power: PowerType | null;
    onPowerClick?: () => void;
    onAvatarClick: () => void;
    teamLabel?: 'A' | 'B' | null;
}) {
    const powerEmojis: Record<PowerType, string> = { shield: '🛡️', boost: '⚡', bomb: '💣', warp: '🧲' };
    const progress = isActive && !player.isAi ? (timeLeft / 15) * 100 : 100;
    const isWarning = isActive && !player.isAi && timeLeft <= 5;

    return (
        <div className={`player-card player-card-corner ${player.position} ${isActive ? 'card-is-active' : ''}`}>
            {/* Circular Avatar */}
            <div className={`avatar-circle-wrapper ${isWarning ? 'timer-warning' : ''}`}>
                {!player.isAi && (
                    <svg className="timer-ring" viewBox="0 0 52 52">
                        <circle className="timer-ring-bg" cx="26" cy="26" r="23" />
                        <circle
                            className="timer-ring-progress"
                            cx="26" cy="26" r="23"
                            style={{
                                strokeDasharray: 144.5,
                                strokeDashoffset: 144.5 - (144.5 * progress) / 100
                            }}
                        />
                    </svg>
                )}
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
                    onClick={onAvatarClick}
                    style={{ cursor: 'pointer' }}
                    title={`View ${player.name}'s profile`}
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

// ─── Main Board ──────────────────────────────────────────────────────────────

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
    // Single state for the color-corner mapping and derived paths (always in sync)
    const [colorLayout, setColorLayout] = useState<{
        colorCorner: ColorCorner;
        playerPaths: Record<string, Point[]>;
    }>(() => {
        const cc = shuffleColorCorner();
        return { colorCorner: cc, playerPaths: buildPlayerPaths(cc) };
    });
    const { colorCorner, playerPaths } = colorLayout;
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

    // Dynamic path cells re-computed whenever the color arrangement changes
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



    const [boardTheme, setBoardTheme] = useState('default');
    useEffect(() => {
        const savedTheme = localStorage.getItem('ludo-theme');
        if (savedTheme) {
            setBoardTheme(savedTheme);
        }
    }, []);

    const renderTokensOnPath = () => {
        const tokens: React.ReactNode[] = [];

        (['green', 'red', 'blue', 'yellow'] as const).forEach((color) => {
            if (!players.some(p => p.color === color)) return;
            localGameState.positions[color].forEach((pos: number, idx: number) => {
                if (pos >= 0 && pos < 58) { // Up to 57
                    const point = playerPaths[color][pos];
                    if (!point) return;

                    tokens.push(
                        <motion.div
                            key={`${color}-${idx}`}
                            layout
                            className="token-on-grid"
                            style={{
                                gridRow: point.r,
                                gridColumn: point.c,
                                zIndex: localGameState.currentPlayer === color ? 15 : 10
                            }}
                            initial={false}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        >
                            <Token
                                color={color}
                                onClick={() => handleTokenClick(color, idx)}
                                isDraggable={localGameState.currentPlayer === color && localGameState.gamePhase === 'moving'}
                            />
                        </motion.div>
                    );
                }
            });
        });

        return tokens;
    };

    return (
        <div data-theme={boardTheme} className="board-outer board-match-theme-wrapper w-full h-[100dvh]">
            {/* ── Top Player Row (Opponent: Yellow & Blue) ── */}
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
                                timeLeft={localGameState.timeLeft}
                                strikes={localGameState.strikes[p.color as keyof typeof localGameState.strikes] || 0}
                                power={localGameState.playerPowers[p.color]}
                                onPowerClick={() => handleUsePower(p.color)}
                                onAvatarClick={() => {
                                    if (!p.isAi && onOpenProfile && p.walletAddress) {
                                        onOpenProfile(p.walletAddress);
                                    } else {
                                        setSelectedPlayer(p);
                                    }
                                }}
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
                        style={{ gridRow: '7 / 10', gridColumn: '7 / 10' }}
                    >
                        {(['green', 'red', 'blue', 'yellow'] as const).map((color) => {
                            const isActive = players.some(p => p.color === color);
                            const finishedCount = localGameState.positions[color].filter(p => p === 57).length;
                            const triClass = {
                                green: 'tri-bottom',
                                red: 'tri-right',
                                blue: 'tri-top',
                                yellow: 'tri-left'
                            }[color];

                            return (
                                <div key={color} className={`tri ${triClass}`} style={{ opacity: isActive ? 1 : 0.1 }}>
                                    {finishedCount > 0 && isActive && (
                                        <div className="finish-counter">
                                            {finishedCount}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* ── Path Squares ── */}
                    {pathCells.map(({ row, col, cls }: { row: number, col: number, cls: string }) => {
                        const isPower = localGameState.powerTiles.some((pt: { r: number, c: number }) => pt.r === row && pt.c === col);
                        const trap = localGameState.activeTraps.find((t: { r: number, c: number }) => t.r === row && t.c === col);

                        return (
                            <div
                                key={`${row}-${col}`}
                                className={`${cls} ${isPower ? 'power-cell' : ''}`}
                                style={{ gridRow: row, gridColumn: col }}
                            >
                                {cls.includes('star-cell') && <StarMarker />}
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
                            <h2 style={{ textTransform: 'capitalize' }}>{localGameState.winner} Fits the Crown!</h2>
                            <p>A minimalist masterclass!</p>
                            <div className="match-summary">
                                <div className="summary-stat">
                                    <span>Tokens Home</span>
                                    <strong>4 / 4</strong>
                                </div>
                            </div>
                            <button
                                className="play-again-btn"
                                onClick={resetGame}
                            >
                                Rematch
                            </button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── Bottom Player Row (You & Opponent: Green & Red) ── */}
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
                                timeLeft={localGameState.timeLeft}
                                strikes={localGameState.strikes[p.color as keyof typeof localGameState.strikes] || 0}
                                power={localGameState.playerPowers[p.color]}
                                onPowerClick={() => handleUsePower(p.color)}
                                onAvatarClick={() => {
                                    if (!p.isAi && onOpenProfile && p.walletAddress) {
                                        onOpenProfile(p.walletAddress);
                                    } else {
                                        setSelectedPlayer(p);
                                    }
                                }}
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
};
