'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import Dice from './Dice';
import Leaderboard from './Leaderboard';
import { useAudio } from '../hooks/useAudio';
import { useMultiplayer } from '../hooks/useMultiplayer';

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
}

const PLAYERS: Player[] = [
    { name: 'Alex', level: 12, avatar: '🟢', color: 'green', position: 'bottom-left', isAi: false },
    { name: 'Gemini (AI)', level: 8, avatar: '🤖', color: 'red', position: 'top-right', isAi: true },
    { name: 'Deep (AI)', level: 15, avatar: '💾', color: 'yellow', position: 'top-left', isAi: true },
    { name: 'Core (AI)', level: 10, avatar: '⚙️', color: 'blue', position: 'bottom-right', isAi: true },
];

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

const PLAYER_PATHS: Record<string, Point[]> = {
    green: [
        ...rotatePath(SHARED_PATH, 34), // Starts at {14,7} index 34 -> Bottom-Left
        { r: 14, c: 8 }, { r: 13, c: 8 }, { r: 12, c: 8 }, { r: 11, c: 8 }, { r: 10, c: 8 }, // Home Lane
        { r: 9, c: 8 } // Finish
    ],
    red: [
        ...rotatePath(SHARED_PATH, 8), // Starts at {2,9} index 8 -> Top-Right
        { r: 2, c: 8 }, { r: 3, c: 8 }, { r: 4, c: 8 }, { r: 5, c: 8 }, { r: 6, c: 8 }, // Home Lane
        { r: 7, c: 8 } // Finish
    ],
    blue: [
        ...rotatePath(SHARED_PATH, 21), // Starts at {9,14} index 21 -> Bottom-Right
        { r: 8, c: 14 }, { r: 8, c: 13 }, { r: 8, c: 12 }, { r: 8, c: 11 }, { r: 8, c: 10 }, // Home Lane
        { r: 8, c: 9 } // Finish
    ],
    yellow: [
        ...rotatePath(SHARED_PATH, 47), // Starts at {7,2} index 47 -> Top-Left
        { r: 8, c: 2 }, { r: 8, c: 3 }, { r: 8, c: 4 }, { r: 8, c: 5 }, { r: 8, c: 6 }, // Home Lane
        { r: 8, c: 7 } // Finish
    ],
};

const SAFE_POSITIONS: Point[] = [
    { r: 7, c: 2 }, { r: 2, c: 9 }, { r: 9, c: 14 }, { r: 14, c: 7 }, // Star squares / Starts
];

// ─── Icons ───────────────────────────────────────────────────────────────────

const StarMarker = () => (
    <svg className="star-svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
    </svg>
);

// ─── Path builder ────────────────────────────────────────────────────────────
// Diagonal arrangement:  Green (TL) — Red (TR) — Yellow (BL) — Blue (BR)
// Finish lanes match the home in each corner.

function buildPathCells(): PathCell[] {
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

                // Finish lanes leading toward center
                if (c === 8 && r >= 2 && r <= 6) cls += ' lane-green';       // top → center
                else if (r === 8 && c >= 10 && c <= 14) cls += ' lane-red';   // right → center  (was blue)
                else if (c === 8 && r >= 10 && r <= 14) cls += ' lane-blue';  // bottom → center (was red)
                else if (r === 8 && c >= 2 && c <= 6) cls += ' lane-yellow';  // left → center

                // Star / safe squares
                if (
                    (r === 7 && c === 2) || (r === 2 && c === 9) ||
                    (r === 9 && c === 14) || (r === 14 && c === 7)
                ) {
                    cls += ' star-cell';
                }

                cells.push({ row: r, col: c, cls });
            }
        }
    }

    return cells;
}

const PATH_CELLS = buildPathCells();

// ─── Home Block ──────────────────────────────────────────────────────────────

function HomeBlock({
    color,
    gridRow,
    gridCol,
    tokensInHome,
    onTokenClick,
}: {
    color: 'green' | 'red' | 'yellow' | 'blue';
    gridRow: string;
    gridCol: string;
    tokensInHome: number[];
    onTokenClick: (tokenIndex: number) => void;
}) {
    return (
        <div
            className={`board-home ${color}`}
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

function PlayerCard({ player }: { player: Player }) {
    return (
        <div className={`player-card ${player.position}`}>
            <div className={`player-avatar ${player.color}`}>
                <span>{player.avatar}</span>
            </div>
            <div className="player-info">
                <span className="player-name">{player.name}</span>
                <span className="player-level">Lv.{player.level}</span>
            </div>
        </div>
    );
}

// ─── Main Board ──────────────────────────────────────────────────────────────

export default function Board({
    showLeaderboard = false,
    onToggleLeaderboard
}: {
    showLeaderboard?: boolean;
    onToggleLeaderboard?: (show: boolean) => void;
}) {
    const { playMove, playCapture, playWin } = useAudio();
    const [gameState, setGameState] = useState({
        positions: {
            green: [-1, -1, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
        currentPlayer: 'green' as Player['color'],
        diceValue: null as number | null,
        gamePhase: 'rolling' as 'rolling' | 'moving',
        winner: null as Player['color'] | null,
        captureMessage: null as string | null,
        winners: [] as Player['color'][],
        invalidMove: false,
        isThinking: false,
        multiplayer: {
            targetId: '',
            isConnected: false,
            isHost: false,
            status: 'idle' as 'idle' | 'host' | 'guest'
        }
    });

    const onPeerStateUpdate = useCallback((newState: any) => {
        setGameState(s => ({ ...s, ...newState }));
    }, []);

    const { peerId, connectToPeer, broadcastState, isHost, status } = useMultiplayer(onPeerStateUpdate);

    // Auto-broadcast state on change IF we are host or connected
    useEffect(() => {
        if (status !== 'idle') {
            broadcastState(gameState);
        }
    }, [gameState, status, broadcastState]);

    const checkWin = useCallback((positions: typeof gameState.positions, color: Player['color']) => {
        return positions[color].every((pos) => pos === 57);
    }, []);

    const resetGame = useCallback(() => {
        setGameState({
            positions: {
                green: [-1, -1, -1, -1],
                red: [-1, -1, -1, -1],
                yellow: [-1, -1, -1, -1],
                blue: [-1, -1, -1, -1],
            },
            currentPlayer: 'green',
            diceValue: null,
            gamePhase: 'rolling',
            winner: null,
            captureMessage: null,
            winners: [],
            invalidMove: false,
            isThinking: false,
            multiplayer: {
                targetId: '',
                isConnected: false,
                isHost: false,
                status: 'idle'
            }
        });
    }, []);

    const recordWin = useCallback((winnerColor: Player['color']) => {
        const player = PLAYERS.find(p => p.color === winnerColor);
        if (!player) return;

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
        stats[player.name].color = player.color; // Update color in case alex plays different color

        localStorage.setItem('ludo-leaderboard', JSON.stringify(stats));
    }, []);

    const triggerWinConfetti = useCallback(() => {
        const duration = 5 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = {
            startVelocity: 30,
            spread: 360,
            ticks: 60,
            zIndex: 0,
            colors: ['#A8E6CF', '#FFD3B6', '#D4F1F4', '#FFEFBA'] // Sage, Rose, Sky, Amber
        };

        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

        const interval: any = setInterval(function () {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
                return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
    }, []);

    const moveToken = useCallback((color: Player['color'], tokenIndex: number, steps: number) => {
        setGameState((prev) => {
            if (prev.winner) return prev;

            const newPositions = { ...prev.positions };
            const currentPos = newPositions[color][tokenIndex];

            let nextPos = currentPos;
            if (currentPos === -1) {
                if (steps === 6) nextPos = 0; // Start
            } else {
                nextPos = currentPos + steps;
                if (nextPos > 57) {
                    // --- OVERSHOOT FEEDBACK ---
                    setGameState(s => ({ ...s, invalidMove: true }));
                    setTimeout(() => setGameState(s => ({ ...s, invalidMove: false })), 500);

                    return {
                        ...prev,
                        gamePhase: 'rolling',
                        currentPlayer: getNextPlayer(prev.currentPlayer),
                    };
                }
            }

            if (nextPos === currentPos) return prev; // No move made

            newPositions[color][tokenIndex] = nextPos;
            playMove();

            // --- CAPTURE LOGIC ---
            let captured = false;
            let capturedColor = '';
            if (nextPos >= 0 && nextPos < 52) { // Only on shared path
                const targetPoint = PLAYER_PATHS[color][nextPos];
                const isSafeSquare = SAFE_POSITIONS.some(p => p.r === targetPoint.r && p.c === targetPoint.c);

                if (!isSafeSquare) {
                    // Check other players for capture
                    (['green', 'red', 'blue', 'yellow'] as const).forEach(otherColor => {
                        if (otherColor !== color) {
                            const playerPositions = newPositions[otherColor];
                            let playerCaptured = false;

                            newPositions[otherColor] = playerPositions.map(otherPos => {
                                if (otherPos >= 0 && otherPos < 52) {
                                    const otherPoint = PLAYER_PATHS[otherColor][otherPos];
                                    if (otherPoint.r === targetPoint.r && otherPoint.c === targetPoint.c) {
                                        captured = true;
                                        playerCaptured = true;
                                        capturedColor = otherColor;
                                        playCapture();
                                        return -1; // Reset to Home
                                    }
                                }
                                return otherPos;
                            }) as [number, number, number, number];
                        }
                    });
                }
            }

            // --- WIN CHECK ---
            const hasWon = checkWin(newPositions, color);
            const newWinners = [...prev.winners];
            if (hasWon && !newWinners.includes(color)) {
                newWinners.push(color);
                playWin();
                if (newWinners.length === 1) {
                    recordWin(color);
                    triggerWinConfetti();
                }
            }

            return {
                ...prev,
                positions: newPositions,
                gamePhase: 'rolling',
                currentPlayer: (steps === 6 || captured) ? prev.currentPlayer : getNextPlayer(prev.currentPlayer),
                winner: hasWon ? color : prev.winner,
                winners: newWinners,
                captureMessage: captured ? `Captured! Bonus roll for ${color}!` : null,
            };
        });
    }, [checkWin, triggerWinConfetti]);

    const getNextPlayer = (current: Player['color']): Player['color'] => {
        const order: Player['color'][] = ['green', 'red', 'blue', 'yellow'];
        const idx = order.indexOf(current);
        return order[(idx + 1) % 4];
    };

    const handleRoll = (value: number) => {
        setGameState((prev) => ({
            ...prev,
            diceValue: value,
            gamePhase: 'moving',
            captureMessage: null,
            invalidMove: false,
        }));
    };

    const handleTokenClick = (color: Player['color'], tokenIndex: number) => {
        if (gameState.currentPlayer !== color || gameState.gamePhase !== 'moving' || gameState.diceValue === null) return;

        moveToken(color, tokenIndex, gameState.diceValue);
    };

    // --- AI ORCHESTRATION ---
    useEffect(() => {
        if (gameState.winner) return;

        const currentPlayerInfo = PLAYERS.find(p => p.color === gameState.currentPlayer);
        if (currentPlayerInfo?.isAi) {
            const delay = Math.floor(Math.random() * 500) + 1000; // 1-1.5s delay

            if (gameState.gamePhase === 'rolling') {
                const timer = setTimeout(() => {
                    setGameState(s => ({ ...s, isThinking: true }));
                    // Trigger roll from component would be better, but we'll simulate logic
                    // We need a way to trigger the Dice component's roll
                    const newValue = Math.floor(Math.random() * 6) + 1;
                    handleRoll(newValue);
                }, delay);
                return () => clearTimeout(timer);
            }

            if (gameState.gamePhase === 'moving' && gameState.diceValue !== null) {
                const timer = setTimeout(() => {
                    // AI Decision Logic
                    const color = gameState.currentPlayer;
                    const diceValue = gameState.diceValue!;
                    const options: number[] = [];

                    gameState.positions[color].forEach((pos, idx) => {
                        // Check if move is valid
                        if (pos === -1) {
                            if (diceValue === 6) options.push(idx);
                        } else if (pos + diceValue <= 57) {
                            options.push(idx);
                        }
                    });

                    if (options.length === 0) {
                        // Pass turn
                        setGameState(s => ({
                            ...s,
                            isThinking: false,
                            gamePhase: 'rolling',
                            currentPlayer: getNextPlayer(s.currentPlayer)
                        }));
                        return;
                    }

                    // Heuristic Scoring
                    let bestTokenIdx = options[0];
                    let maxScore = -Infinity;

                    options.forEach(idx => {
                        const currentPos = gameState.positions[color][idx];
                        const nextPos = currentPos === -1 ? 0 : currentPos + diceValue;
                        let score = 0;

                        // Priority: Reach finish
                        if (nextPos === 57) score += 150;

                        // Priority: Enter finish lane
                        if (nextPos >= 52 && currentPos < 52) score += 25;

                        // Priority: Move out of home
                        if (currentPos === -1) score += 40;

                        // Priority: Capture
                        if (nextPos < 52) {
                            const targetPoint = PLAYER_PATHS[color][nextPos];
                            const isSafe = SAFE_POSITIONS.some(p => p.r === targetPoint.r && p.c === targetPoint.c);

                            if (!isSafe) {
                                (['green', 'red', 'blue', 'yellow'] as const).forEach(otherColor => {
                                    if (otherColor !== color) {
                                        gameState.positions[otherColor].forEach(otherPos => {
                                            if (otherPos >= 0 && otherPos < 52) {
                                                const otherPoint = PLAYER_PATHS[otherColor][otherPos];
                                                if (otherPoint.r === targetPoint.r && otherPoint.c === targetPoint.c) {
                                                    score += 100;
                                                }
                                            }
                                        });
                                    }
                                });
                            } else {
                                score += 50; // Move into safe zone
                            }
                        }

                        // Tendency: Move further ahead
                        score += nextPos;

                        if (score > maxScore) {
                            maxScore = score;
                            bestTokenIdx = idx;
                        }
                    });

                    setGameState(s => ({ ...s, isThinking: false }));
                    moveToken(color, bestTokenIdx, diceValue);
                }, delay);
                return () => clearTimeout(timer);
            }
        }
    }, [gameState.currentPlayer, gameState.gamePhase, gameState.winner, gameState.diceValue, moveToken, handleRoll]);

    const renderTokensOnPath = () => {
        const tokens: React.ReactNode[] = [];

        (['green', 'red', 'blue', 'yellow'] as const).forEach((color) => {
            gameState.positions[color].forEach((pos, idx) => {
                if (pos >= 0 && pos < 58) { // Up to 57
                    const point = PLAYER_PATHS[color][pos];
                    if (!point) return;

                    tokens.push(
                        <motion.div
                            key={`${color}-${idx}`}
                            layout
                            className="token-on-grid"
                            style={{
                                gridRow: point.r,
                                gridColumn: point.c,
                                zIndex: gameState.currentPlayer === color ? 15 : 10
                            }}
                            initial={false}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        >
                            <Token
                                color={color}
                                onClick={() => handleTokenClick(color, idx)}
                                isDraggable={gameState.currentPlayer === color && gameState.gamePhase === 'moving'}
                            />
                        </motion.div>
                    );
                }
            });
        });

        return tokens;
    };

    return (
        <div className="board-outer">
            {/* Player cards at each corner */}
            {PLAYERS.map((p) => (
                <div key={p.color} className={`player-wrapper ${gameState.currentPlayer === p.color ? 'active-turn' : ''}`}>
                    <PlayerCard player={p} />
                    {gameState.currentPlayer === p.color && gameState.isThinking && p.isAi && (
                        <div className="ai-thinking-tag">Thinking...</div>
                    )}
                </div>
            ))}

            <div className="board-wrapper">
                <div className="board-grid">
                    {/* ── Corner Homes ── */}
                    {(['green', 'red', 'yellow', 'blue'] as const).map((color) => {
                        const gridInfo = {
                            yellow: { row: "1 / 7", col: "1 / 7" },
                            red: { row: "1 / 7", col: "10 / 16" },
                            green: { row: "10 / 16", col: "1 / 7" },
                            blue: { row: "10 / 16", col: "10 / 16" },
                        }[color];

                        const tokensInHome = gameState.positions[color]
                            .map((pos, idx) => pos === -1 ? idx : -1)
                            .filter(idx => idx !== -1);

                        return (
                            <HomeBlock
                                key={color}
                                color={color}
                                gridRow={gridInfo.row}
                                gridCol={gridInfo.col}
                                tokensInHome={tokensInHome}
                                onTokenClick={(idx) => handleTokenClick(color, idx)}
                            />
                        );
                    })}

                    {/* ── Center Finish Zone ── */}
                    <div
                        className={`finish-center ${gameState.invalidMove ? 'shake-feedback' : ''}`}
                        style={{ gridRow: '7 / 10', gridColumn: '7 / 10' }}
                    >
                        {(['green', 'red', 'blue', 'yellow'] as const).map((color) => {
                            const finishedCount = gameState.positions[color].filter(p => p === 57).length;
                            const triClass = {
                                green: 'tri-top',
                                red: 'tri-right',
                                blue: 'tri-bottom',
                                yellow: 'tri-left'
                            }[color];

                            return (
                                <div key={color} className={`tri ${triClass}`}>
                                    {finishedCount > 0 && (
                                        <div className="finish-counter">
                                            {finishedCount}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        <div className="dice-overlay">
                            <Dice
                                onRoll={handleRoll}
                                disabled={gameState.gamePhase !== 'rolling' || !!gameState.winner}
                            />
                        </div>
                    </div>

                    {/* ── Path Squares ── */}
                    {PATH_CELLS.map(({ row, col, cls }) => (
                        <div
                            key={`${row}-${col}`}
                            className={cls}
                            style={{ gridRow: row, gridColumn: col }}
                        >
                            {cls.includes('star-cell') && <StarMarker />}
                        </div>
                    ))}

                    {/* ── Tokens ── */}
                    {renderTokensOnPath()}
                </div>

                {/* --- Status Notification --- */}
                <AnimatePresence>
                    {gameState.captureMessage && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="capture-toast"
                        >
                            {gameState.captureMessage}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* --- Celebration Overlay --- */}
            <AnimatePresence>
                {gameState.winner && (
                    <div className="winner-overlay">
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="winner-card"
                        >
                            <span className="celebration-emoji">🏆</span>
                            <h2 style={{ textTransform: 'capitalize' }}>{gameState.winner} Fits the Crown!</h2>
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

            <Leaderboard
                isOpen={showLeaderboard}
                onClose={() => onToggleLeaderboard?.(false)}
            />
        </div>
    );
};
