'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import Dice from './Dice';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { useAudio } from '../hooks/useAudio';
import { useMultiplayerContext, PlayerColor } from '@/hooks/MultiplayerContext';
import { processMove } from '@/lib/gameLogic';
import { useAccount } from 'wagmi';
import { recordMatchResult } from '@/lib/matchRecorder';

// ─── Full-Screen 15×15 Ludo Board ────────────────────────────────────────────
// Diagonal-opposite pairs:  Green ↔ Blue  |  Red ↔ Yellow
// Layout:  Green (top-left)  —  Red (top-right)
//          Yellow (bottom-left) — Blue (bottom-right)

interface PathCell {
    row: number;
    col: number;
    cls: string;
}

// ─── Player Data ─────────────────────────────────────────────────────────────

interface Player {
    name: string;
    level: number;
    avatar: string;          // emoji or initials
    color: 'green' | 'red' | 'yellow' | 'blue';
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    isAi?: boolean;
    walletAddress?: string;
}

export type PowerType = 'shield' | 'boost' | 'bomb' | 'warp';

// Player identities — shuffled onto color seats each game
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

function shufflePlayers(playerCount: '2' | '4' | '2v2' = '4', isBotMatch: boolean = false): Player[] {
    const templates = [...PLAYER_TEMPLATES].sort(() => Math.random() - 0.5);

    // In a 2-player game, we only want 2 diagonal colors. 
    // Which 2? Either 'green'/'blue' or 'red'/'yellow'
    const usePair1 = Math.random() > 0.5; // True: Green(0) & Blue(3), False: Red(1) & Yellow(2)
    const activeIndices = playerCount === '2' ? (usePair1 ? [0, 3] : [1, 2]) : [0, 1, 2, 3];

    return COLOR_SEATS.map((seat, i) => {
        if (!activeIndices.includes(i)) return null;
        let p = { ...templates[i], ...seat };

        // If it's a bot match, ensure only one player is human (Alex)
        if (isBotMatch) {
            if (p.name !== 'Alex') p.isAi = true;
            else p.isAi = false;
        }

        return p;
    }).filter(Boolean) as Player[];
}

const getTeam = (color: Player['color']) => {
    return (color === 'green' || color === 'blue') ? 1 : 2;
};

// ─── Path Constants ──────────────────────────────────────────────────────────

type Point = { r: number; c: number };

// Shared perimeter path (52 cells)
const SHARED_PATH: Point[] = [
    // Top-Middle column 7 (bottom to top)
    { r: 6, c: 7 }, { r: 5, c: 7 }, { r: 4, c: 7 }, { r: 3, c: 7 }, { r: 2, c: 7 }, { r: 1, c: 7 },
    { r: 1, c: 8 }, { r: 1, c: 9 }, // Top edge
    { r: 2, c: 9 }, { r: 3, c: 9 }, { r: 4, c: 9 }, { r: 5, c: 9 }, { r: 6, c: 9 }, // Top-Middle column 9 (top to bottom)
    { r: 7, c: 10 }, { r: 7, c: 11 }, { r: 7, c: 12 }, { r: 7, c: 13 }, { r: 7, c: 14 }, { r: 7, c: 15 }, // Right-Middle row 7 (left to right)
    { r: 8, c: 15 }, { r: 9, c: 15 }, // Right edge
    { r: 9, c: 14 }, { r: 9, c: 13 }, { r: 9, c: 12 }, { r: 9, c: 11 }, { r: 9, c: 10 }, // Right-Middle row 9 (right to left)
    { r: 10, c: 9 }, { r: 11, c: 9 }, { r: 12, c: 9 }, { r: 13, c: 9 }, { r: 14, c: 9 }, { r: 15, c: 9 }, // Bottom-Middle column 9 (top to bottom)
    { r: 15, c: 8 }, { r: 15, c: 7 }, // Bottom edge
    { r: 14, c: 7 }, { r: 13, c: 7 }, { r: 12, c: 7 }, { r: 11, c: 7 }, { r: 10, c: 7 }, // Bottom-Middle column 7 (bottom to top)
    { r: 9, c: 6 }, { r: 9, c: 5 }, { r: 9, c: 4 }, { r: 9, c: 3 }, { r: 9, c: 2 }, { r: 9, c: 1 }, // Left-Middle row 9 (right to left)
    { r: 8, c: 1 }, { r: 7, c: 1 }, // Left edge
    { r: 7, c: 2 }, { r: 7, c: 3 }, { r: 7, c: 4 }, { r: 7, c: 5 }, { r: 7, c: 6 }, // Left-Middle row 7 (left to right)
];

// Helper to shift the shared path for each player's start point
const rotatePath = (points: Point[], startIndex: number): Point[] => {
    return [...points.slice(startIndex), ...points.slice(0, startIndex)];
};

// ─── Corner Slot Definitions (fixed by board geometry) ──────────────────────
// Each physical corner has a fixed start index, home lane, grid area, and lane key.

type Corner = 'BL' | 'TR' | 'BR' | 'TL';
// Redundant type removed, using import from MultiplayerContext
type ColorCorner = Record<PlayerColor, Corner>;

const CORNER_SLOTS: Record<Corner, {
    startIdx: number;
    homeCells: Point[];
    finishCell: Point;
    gridRow: string;
    gridCol: string;
    arrowDir: 'up' | 'down' | 'left' | 'right';
    arrowCell: Point;
}> = {
    BL: {
        startIdx: 34,
        homeCells: [{ r: 14, c: 8 }, { r: 13, c: 8 }, { r: 12, c: 8 }, { r: 11, c: 8 }, { r: 10, c: 8 }],
        finishCell: { r: 9, c: 8 },
        gridRow: '10 / 16', gridCol: '1 / 7',
        arrowDir: 'up', arrowCell: { r: 14, c: 8 },
    },
    TR: {
        startIdx: 8,
        homeCells: [{ r: 2, c: 8 }, { r: 3, c: 8 }, { r: 4, c: 8 }, { r: 5, c: 8 }, { r: 6, c: 8 }],
        finishCell: { r: 7, c: 8 },
        gridRow: '1 / 7', gridCol: '10 / 16',
        arrowDir: 'down', arrowCell: { r: 2, c: 8 },
    },
    BR: {
        startIdx: 21,
        homeCells: [{ r: 8, c: 14 }, { r: 8, c: 13 }, { r: 8, c: 12 }, { r: 8, c: 11 }, { r: 8, c: 10 }],
        finishCell: { r: 8, c: 9 },
        gridRow: '10 / 16', gridCol: '10 / 16',
        arrowDir: 'left', arrowCell: { r: 8, c: 14 },
    },
    TL: {
        startIdx: 47,
        homeCells: [{ r: 8, c: 2 }, { r: 8, c: 3 }, { r: 8, c: 4 }, { r: 8, c: 5 }, { r: 8, c: 6 }],
        finishCell: { r: 8, c: 7 },
        gridRow: '1 / 7', gridCol: '1 / 7',
        arrowDir: 'right', arrowCell: { r: 8, c: 2 },
    },
};

// The 4 valid arrangements: green↔blue always share one diagonal, red↔yellow the other.
const VALID_COLOR_ARRANGEMENTS: ColorCorner[] = [
    { green: 'BL', blue: 'TR', red: 'BR', yellow: 'TL' }, // A (default)
    { green: 'TR', blue: 'BL', red: 'BR', yellow: 'TL' }, // B (swap green/blue)
    { green: 'BL', blue: 'TR', red: 'TL', yellow: 'BR' }, // C (swap red/yellow)
    { green: 'TR', blue: 'BL', red: 'TL', yellow: 'BR' }, // D (swap both)
];

function shuffleColorCorner(): ColorCorner {
    return VALID_COLOR_ARRANGEMENTS[Math.floor(Math.random() * 4)];
}

function buildPlayerPaths(cc: ColorCorner): Record<string, Point[]> {
    const paths: Record<string, Point[]> = {};
    (['green', 'red', 'yellow', 'blue'] as PlayerColor[]).forEach(color => {
        const slot = CORNER_SLOTS[cc[color]];
        paths[color] = [
            ...rotatePath(SHARED_PATH, slot.startIdx),
            ...slot.homeCells,
            slot.finishCell,
        ];
    });
    return paths;
}

// Inverse map: corner → color (for lane/arrow rendering)
function cornerToColor(cc: ColorCorner): Record<Corner, PlayerColor> {
    const inv = {} as Record<Corner, PlayerColor>;
    (Object.entries(cc) as [PlayerColor, Corner][]).forEach(([color, corner]) => {
        inv[corner] = color;
    });
    return inv;
}

function buildPathCellsDynamic(cc: ColorCorner): PathCell[] {
    const inv = cornerToColor(cc);
    const cells: PathCell[] = [];

    for (let r = 1; r <= 15; r++) {
        for (let c = 1; c <= 15; c++) {
            const inVert = c >= 7 && c <= 9;
            const inHoriz = r >= 7 && r <= 9;
            const isHome =
                (r <= 6 && c <= 6) ||
                (r <= 6 && c >= 10) ||
                (r >= 10 && c <= 6) ||
                (r >= 10 && c >= 10);
            const isCenter = inVert && inHoriz;

            if ((inVert || inHoriz) && !isHome && !isCenter) {
                let cls = 'board-cell';

                // Lane coloring — driven by which color occupies each corner
                if (c === 8 && r >= 2 && r <= 6) cls += ` lane-${inv['TR']}`; // TR home lane
                else if (r === 8 && c >= 10 && c <= 14) cls += ` lane-${inv['BR']}`; // BR home lane
                else if (c === 8 && r >= 10 && r <= 14) cls += ` lane-${inv['BL']}`; // BL home lane
                else if (r === 8 && c >= 2 && c <= 6) cls += ` lane-${inv['TL']}`; // TL home lane

                if (SAFE_POSITIONS.some(p => p.r === r && p.c === c)) {
                    cls += ' star-cell';
                }

                cells.push({ row: r, col: c, cls });
            }
        }
    }
    return cells;
}

// Keep SAFE_POSITIONS BEFORE buildPathCellsDynamic so it's in scope when called
const SAFE_POSITIONS: Point[] = [
    { r: 7, c: 2 }, { r: 2, c: 9 }, { r: 9, c: 14 }, { r: 14, c: 7 },
    { r: 3, c: 7 }, { r: 7, c: 13 }, { r: 13, c: 9 }, { r: 9, c: 3 },
];

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
    playerCount?: '2' | '4' | '2v2';
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
    playerCount = '4',
    gameMode = 'classic',
    isBotMatch = false
}: {
    showLeaderboard?: boolean;
    onToggleLeaderboard?: (show: boolean) => void;
    playerCount?: '2' | '4' | '2v2';
    gameMode?: 'classic' | 'power' | 'snakes';
    isBotMatch?: boolean;
}) {
    const { playMove, playCapture, playWin, playTurn } = useAudio();
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
    const setColorCorner = (cc: ColorCorner) =>
        setColorLayout({ colorCorner: cc, playerPaths: buildPlayerPaths(cc) });
    const setPlayerPaths = (_paths: Record<string, Point[]>) => { }; // merged into setColorCorner
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

    const { address } = useAccount();
    const hasRecordedWin = useRef<boolean>(false);

    // Dynamic path cells re-computed whenever the color arrangement changes
    const pathCells = useMemo(() => buildPathCellsDynamic(colorCorner), [colorCorner]);

    // Update local player's wallet address when connected
    useEffect(() => {
        if (address) {
            setPlayers(prev => prev.map(p => {
                if (p.name === 'Alex' && !p.isAi) {
                    return { ...p, walletAddress: address };
                }
                return p;
            }));
        }
    }, [address]);
    const [localGameState, setLocalGameState] = useState({
        positions: {
            green: [-1, -1, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
        currentPlayer: players[0].color as PlayerColor,
        diceValue: null as number | null,
        gamePhase: 'rolling' as 'rolling' | 'moving',
        winner: null as string | null,
        captureMessage: null as string | null,
        winners: [] as string[],
        invalidMove: false,
        isThinking: false,
        timeLeft: 15,
        strikes: {
            green: 0,
            red: 0,
            yellow: 0,
            blue: 0,
        } as Record<PlayerColor, number>,
        powerTiles: (gameMode === 'power' ? [] : []) as { r: number, c: number }[], // will be filled in useEffect
        playerPowers: { green: null, red: null, yellow: null, blue: null } as Record<PlayerColor, PowerType | null>,
        activeTraps: [] as { r: number, c: number, owner: PlayerColor }[],
        activeShields: [] as { color: PlayerColor, tokenIdx: number }[],
        activeBoost: null as PlayerColor | null,
        multiplayer: {
            targetId: '',
            isConnected: false,
            isHost: false,
            status: 'idle' as 'idle' | 'host' | 'guest'
        }
    });

    const {
        gameState,
        isHost,
        sendIntent,
        broadcastAction,
        roomId,
        isLobbyConnected
    } = useMultiplayerContext();

    // The Board now reacts to gameState from context
    // We'll map context state to local rendering needs if necessary
    // Phase 1: Minimal shift to prove Authority

    // Sync local state with context state for Guests
    useEffect(() => {
        if (!isHost && isLobbyConnected && gameState) {
            setLocalGameState(prev => ({
                ...prev,
                ...gameState,
                winner: gameState.winner as any,
                winners: gameState.winners as any,
                positions: gameState.positions || prev.positions
            }));
        }
    }, [isHost, isLobbyConnected, gameState]);

    const checkWin = useCallback((positions: typeof localGameState.positions, color: Player['color']) => {
        return positions[color].every((pos) => pos === 57);
    }, []);

    const getNextPlayer = useCallback((current: Player['color']): Player['color'] => {
        const order: Player['color'][] = ['green', 'red', 'blue', 'yellow'];
        const activeColors = players.map(p => p.color);
        const activeOrder = order.filter(c => activeColors.includes(c));
        const idx = activeOrder.indexOf(current);
        return activeOrder[(idx + 1) % activeOrder.length];
    }, [players]);

    const resetGame = useCallback(() => {
        const newCC = shuffleColorCorner();
        const newPlayers = shufflePlayers(playerCount, isBotMatch);
        setPlayers(newPlayers);
        setColorLayout({ colorCorner: newCC, playerPaths: buildPlayerPaths(newCC) });
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
            multiplayer: {
                targetId: '',
                isConnected: false,
                isHost: false,
                status: 'idle'
            }
        });
    }, [playerCount, gameMode, pathCells]);

    const recordWin = useCallback(async (winnerColor: Player['color']) => {
        const player = players.find(p => p.color === winnerColor);
        if (!player) return;

        // 1. Local Leaderboard (Legacy)
        const data = localStorage.getItem('ludo-leaderboard');
        const stats = data ? JSON.parse(data) : {};

        if (!stats[player.name]) {
            stats[player.name] = {
                name: player.name,
                color: player.color,
                wins: 0,
                lastWin: 0
            };
        }

        stats[player.name].wins += 1;
        stats[player.name].lastWin = Date.now();
        stats[player.name].color = player.color;

        localStorage.setItem('ludo-leaderboard', JSON.stringify(stats));

        // 2. Supabase Match Recording (New)
        if (address && player.walletAddress === address && !hasRecordedWin.current) {
            hasRecordedWin.current = true;
            const participants = players
                .map(p => p.walletAddress)
                .filter(Boolean) as string[];

            await recordMatchResult(
                address,
                roomId || 'local',
                gameMode,
                participants
            );
        }
    }, [players, address, roomId, gameMode]);

    const triggerWinConfetti = useCallback(() => {
        const duration = 5 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = {
            startVelocity: 30,
            spread: 360,
            ticks: 60,
            zIndex: 0,
            colors: ['#A8E6CF', '#FFD3B6', '#D4F1F4', '#FFEFBA']
        };

        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

        const interval: any = setInterval(function () {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) return clearInterval(interval);

            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
    }, []);

    const moveToken = useCallback((color: Player['color'], tokenIndex: number, steps: number, isRemote = false, targetPosition?: number) => {
        setLocalGameState((prev) => {
            if (prev.winner) return prev;

            const { newState, captured, bonusRoll } = processMove(
                prev as any,
                color as any,
                tokenIndex,
                steps,
                playerPaths,
                playerCount
            );

            // Handle side effects
            if (newState.positions[color][tokenIndex] !== prev.positions[color][tokenIndex]) {
                playMove();
            }
            if (captured) playCapture();
            if (newState.winner && !prev.winner) {
                playWin();
                triggerWinConfetti();
                recordWin(color);
            }

            // Broadcast move if Host
            if (isHost && !isRemote) {
                broadcastAction('MOVE_TOKEN', {
                    payload: {
                        color,
                        tokenIndex,
                        steps,
                        targetPosition: newState.positions[color][tokenIndex]
                    }
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

        // If Guest, send Intent to Host
        if (!isHost && !isRemote) {
            sendIntent('REQUEST_ROLL');
            return;
        }

        // If Host or Local
        const roll = value || Math.floor(Math.random() * 6) + 1;
        if (isHost && !isRemote) {
            broadcastAction('ROLL_DICE', { value: roll });
        }
        setLocalGameState((prev) => {
            const color = prev.currentPlayer;
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
                        timeLeft: 15
                    }));
                }, 1000);
            }

            return {
                ...prev,
                diceValue: roll,
                gamePhase: hasValidMove ? 'moving' : 'rolling',
                timeLeft: 15,
            };
        });
    }, [getNextPlayer, isHost, broadcastAction, sendIntent]);

    const handleTokenClick = (color: Player['color'], tokenIndex: number) => {
        if (localGameState.currentPlayer !== color || localGameState.gamePhase !== 'moving' || localGameState.diceValue === null) return;

        if (!isHost && isLobbyConnected) {
            sendIntent('REQUEST_MOVE', { color, tokenIndex, diceValue: localGameState.diceValue });
            return;
        }

        moveToken(color, tokenIndex, localGameState.diceValue);
    };

    // --- AI HEURISTIC FUNCTION ---
    // Calculate the best possible move based on priority scoring
    const getBestMove = useCallback((playerId: Player['color'], roll: number) => {
        const options: number[] = [];

        localGameState.positions[playerId].forEach((pos, idx) => {
            // Check if move is valid
            if (pos === -1) {
                if (roll === 6) options.push(idx);
            } else if (pos + roll <= 57) {
                options.push(idx);
            }
        });

        if (options.length === 0) return null; // No valid moves

        let bestTokenIdx = options[0];
        let maxScore = -Infinity;

        options.forEach(idx => {
            const currentPos = localGameState.positions[playerId][idx];
            const nextPos = currentPos === -1 ? 0 : currentPos + roll;
            let score = 0;

            // Reach Finish Zone (+150) - The ultimate objective
            if (nextPos === 57) {
                score += 150;
            }

            // Enter Home Lane (+25) - Safe from captures
            if (nextPos >= 52 && currentPos < 52) {
                score += 25;
            }

            // Move out of Home (+40) - Getting a new piece on the board
            if (currentPos === -1) {
                score += 40;
            }

            // Capturing / Safe Zones Logic
            if (nextPos < 52) {
                const targetPoint = playerPaths[playerId][nextPos];
                const isSafeSquare = SAFE_POSITIONS.some((p: Point) => p.r === targetPoint.r && p.c === targetPoint.c);

                if (isSafeSquare) {
                    // Move to Safe Zone (+50)
                    score += 50;
                } else {
                    // Check for Captures (+100)
                    (['green', 'red', 'blue', 'yellow'] as const).forEach(otherColor => {
                        if (otherColor !== playerId) {
                            localGameState.positions[otherColor].forEach(otherPos => {
                                if (otherPos >= 0 && otherPos < 52) {
                                    const otherPoint = playerPaths[otherColor][otherPos];
                                    if (otherPoint.r === targetPoint.r && otherPoint.c === targetPoint.c) {
                                        score += 100;
                                    }
                                }
                            });
                        }
                    });
                }
            }

            // Distance to finish (Higher is better, small incremental points)
            score += nextPos;

            if (score > maxScore) {
                maxScore = score;
                bestTokenIdx = idx;
            }
        });

        return bestTokenIdx;
    }, [localGameState.positions]);

    // --- TURN NOTIFICATION BEEP ---
    useEffect(() => {
        if (localGameState.winner) return;

        // Only beep if the new active player is human and hasn't struck out into auto-play
        const currentPlayerInfo = players.find(p => p.color === localGameState.currentPlayer);
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.strikes[localGameState.currentPlayer] >= 3;

        if (!isCurrentlyBot && localGameState.gamePhase === 'rolling') {
            playTurn();
        }
    }, [localGameState.currentPlayer, localGameState.winner, localGameState.strikes, playTurn, localGameState.gamePhase]);

    // --- 7.5 HUMAN TURN TIMER & AFK AUTO-PLAY LOGIC ---
    useEffect(() => {
        if (localGameState.winner) return;

        const currentPlayerInfo = players.find(p => p.color === localGameState.currentPlayer);

        // Timer only applies to non-AI humans (unless they strike out 3 times)
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.strikes[localGameState.currentPlayer] >= 3;

        if (!isCurrentlyBot) {
            if (localGameState.timeLeft <= 0) {
                // TImer runs out, auto-play for them and add a strike
                setLocalGameState(prev => {
                    const newStrikes = prev.strikes[prev.currentPlayer] + 1;
                    return {
                        ...prev,
                        strikes: { ...prev.strikes, [prev.currentPlayer]: newStrikes },
                    };
                });

                // Trigger forced action
                if (localGameState.gamePhase === 'rolling') {
                    const forcedRoll = Math.floor(Math.random() * 6) + 1;
                    handleRoll(forcedRoll);
                } else if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                    const bestMoveIdx = getBestMove(localGameState.currentPlayer, localGameState.diceValue);
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

            // Normal Tick Logic
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
        getBestMove
    ]);

    // --- AI ORCHESTRATION ---
    useEffect(() => {
        if (localGameState.winner) return;

        const currentPlayerInfo = players.find(p => p.color === localGameState.currentPlayer);

        // AI logic handles both native AI and humans who struck out
        const isCurrentlyBot = currentPlayerInfo?.isAi || localGameState.strikes[localGameState.currentPlayer] >= 3;

        if (isCurrentlyBot) {

            // Phase 1: Rolling
            if (localGameState.gamePhase === 'rolling') {
                const timer = setTimeout(() => {
                    setLocalGameState(s => ({ ...s, isThinking: true }));

                    // Simulate AI Roll
                    const newValue = Math.floor(Math.random() * 6) + 1;
                    handleRoll(newValue);
                }, 4000); // 4s thinking delay
                return () => clearTimeout(timer);
            }

            // Phase 2: Moving
            if (localGameState.gamePhase === 'moving' && localGameState.diceValue !== null) {
                const timer = setTimeout(() => {
                    const color = localGameState.currentPlayer;
                    const diceValue = localGameState.diceValue!;

                    const bestModeIdx = getBestMove(color, diceValue);

                    if (bestModeIdx === null) {
                        // Pass turn if no moves
                        setLocalGameState(s => ({
                            ...s,
                            isThinking: false,
                            gamePhase: 'rolling',
                            currentPlayer: getNextPlayer(s.currentPlayer),
                            timeLeft: 15 // Ensure timer resets
                        }));
                    } else {
                        // Execute move
                        setLocalGameState(s => ({ ...s, isThinking: false }));
                        moveToken(color, bestModeIdx, diceValue);
                    }
                }, 1000); // 1s wait after rolling
                return () => clearTimeout(timer);
            }
        }
    }, [localGameState.currentPlayer, localGameState.gamePhase, localGameState.winner, localGameState.diceValue, moveToken, handleRoll, getBestMove, localGameState.strikes]);

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
            localGameState.positions[color].forEach((pos, idx) => {
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
                                onAvatarClick={() => setSelectedPlayer(p)}
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
                            .map((pos, idx) => pos === -1 ? idx : -1)
                            .filter(idx => idx !== -1);

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
                        const isPower = localGameState.powerTiles.some(pt => pt.r === row && pt.c === col);
                        const trap = localGameState.activeTraps.find(t => t.r === row && t.c === col);

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
                                onAvatarClick={() => setSelectedPlayer(p)}
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
            />

            {/* ── Player Profile Sheet ── */}
            {selectedPlayer && (
                <PlayerProfileSheet
                    player={selectedPlayer}
                    wins={localGameState.positions[selectedPlayer.color].filter(p => p === 57).length}
                    onClose={() => setSelectedPlayer(null)}
                />
            )}
        </div>
    );
};
