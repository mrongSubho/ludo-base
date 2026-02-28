'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import Dice from './Dice';
import { useAudio } from '../hooks/useAudio';

type PowerType = 'shield' | 'boost' | 'bomb' | 'warp';

interface Player {
    name: string;
    level: number;
    avatar: string;
    color: 'green' | 'red' | 'yellow' | 'blue';
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    isAi?: boolean;
}

const PLAYER_TEMPLATES = [
    { name: 'Alex', level: 12, avatar: '🎮', isAi: false },
    { name: 'Gemini', level: 8, avatar: '🤖', isAi: true },
    { name: 'Deep', level: 15, avatar: '💾', isAi: true },
    { name: 'Core', level: 10, avatar: '⚙️', isAi: true },
];

const COLOR_SEATS: { color: Player['color']; position: Player['position'] }[] = [
    { color: 'green', position: 'bottom-left' },
    { color: 'red', position: 'bottom-right' },
    { color: 'yellow', position: 'top-left' },
    { color: 'blue', position: 'top-right' },
];

function shufflePlayers(playerCount: '2' | '4' | '2v2' = '4'): Player[] {
    const templates = [...PLAYER_TEMPLATES].sort(() => Math.random() - 0.5);
    const usePair1 = Math.random() > 0.5;
    const activeIndices = playerCount === '2' ? (usePair1 ? [0, 3] : [1, 2]) : [0, 1, 2, 3];

    return COLOR_SEATS.map((seat, i) => {
        if (!activeIndices.includes(i)) return null;
        return { ...templates[i], ...seat };
    }).filter(Boolean) as Player[];
}

const getNextPlayer = (current: Player['color'], players: Player[]) => {
    const order = ['green', 'red', 'blue', 'yellow'] as Player['color'][];
    const currentIndex = order.indexOf(current);
    for (let i = 1; i <= 4; i++) {
        const nextCol = order[(currentIndex + i) % 4];
        if (players.some(p => p.color === nextCol)) return nextCol;
    }
    return current;
};

// ─── Token SubComponent (matches Board.tsx) ───
function Token({ color, isDraggable }: { color: string; isDraggable?: boolean }) {
    return (
        <motion.div
            layout
            initial={false}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`ludo-token ${color}-token ${isDraggable ? 'draggable' : ''}`}
            whileHover={isDraggable ? { scale: 1.15, y: -4 } : { scale: 1.1 }}
        />
    );
}

// ─── Player Card SubComponent (matches Board.tsx) ───
function PlayerCard({
    player,
    isActive,
    timeLeft,
    strikes,
    power,
    onAvatarClick,
}: {
    player: Player;
    isActive: boolean;
    timeLeft: number;
    strikes: number;
    power: PowerType | null;
    onAvatarClick: () => void;
}) {
    const progress = isActive && !player.isAi ? (timeLeft / 15) * 100 : 100;
    const isWarning = isActive && !player.isAi && timeLeft <= 5;
    const powerEmojis = { shield: '🛡️', boost: '⚡', bomb: '💣', warp: '🧲' };

    return (
        <div className="relative flex items-center justify-center">

            <div className={`player-card player-card-corner ${player.position} ${isActive ? 'card-is-active' : ''}`}>
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
                    <div
                        className={`avatar-circle ${player.color}`}
                        onClick={onAvatarClick}
                        style={{ cursor: 'pointer' }}
                        title={`View ${player.name}'s profile`}
                    >
                        <span className="avatar-emoji">{player.avatar}</span>
                    </div>
                    <div className="avatar-level-badge">{player.level}</div>
                </div>
            </div>
        </div>
    );
}

// ─── Grid Math & Traps ───
const LADDERS = [
    { start: 4, end: 14 }, { start: 9, end: 31 }, { start: 20, end: 38 },
    { start: 28, end: 84 }, { start: 40, end: 59 }, { start: 51, end: 67 },
    { start: 63, end: 81 }, { start: 71, end: 91 }
];
const SNAKES = [
    { start: 17, end: 7 }, { start: 54, end: 34 }, { start: 62, end: 19 },
    { start: 64, end: 60 }, { start: 87, end: 24 }, { start: 93, end: 73 },
    { start: 95, end: 75 }, { start: 99, end: 78 }
];

const getGridPos = (n: number) => {
    if (n < 1) return { r: 10, c: 1 };
    if (n > 100) return { r: 1, c: 1 };
    const row0 = Math.floor((n - 1) / 10); // 0 to 9
    const isEvenRow = row0 % 2 === 0;
    const c0 = (n - 1) % 10; // 0 to 9
    return {
        r: 10 - row0,
        c: isEvenRow ? c0 + 1 : 10 - c0,
    };
};

export default function SnakesBoard({ playerCount = '4' }: { playerCount?: '2' | '4' | '2v2' }) {
    const { playMove, playCapture, playWin, playTurn, playStrike } = useAudio();
    const [players, setPlayers] = useState<Player[]>(() => shufflePlayers(playerCount));

    const [gameState, setGameState] = useState({
        positions: { green: 0, red: 0, yellow: 0, blue: 0 } as Record<Player['color'], number>,
        currentPlayer: players[0].color,
        diceValue: null as number | null,
        gamePhase: 'rolling' as 'rolling' | 'moving',
        winner: null as Player['color'] | null,
        message: null as string | null,
        isThinking: false,
        timeLeft: 15,
        strikes: { green: 0, red: 0, yellow: 0, blue: 0 } as Record<Player['color'], number>
    });

    const [displayPositions, setDisplayPositions] = useState({ green: 0, red: 0, yellow: 0, blue: 0 } as Record<Player['color'], number>);

    const checkWin = useCallback((positions: Record<Player['color'], number>, color: Player['color']) => {
        return positions[color] === 100;
    }, []);

    const triggerWinConfetti = useCallback(() => {
        const duration = 5 * 1000;
        const animationEnd = Date.now() + duration;
        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;
        const interval: any = setInterval(function () {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) return clearInterval(interval);
            const particleCount = 50 * (timeLeft / duration);
            confetti({ particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
    }, []);

    const showMessage = (msg: string) => {
        setGameState(s => ({ ...s, message: msg }));
        setTimeout(() => setGameState(s => ({ ...s, message: null })), 2500);
    };

    const handleRoll = useCallback((val: number) => {
        if (gameState.gamePhase !== 'rolling' || gameState.winner) return;

        const activePlayer = gameState.currentPlayer;

        setGameState(prev => ({
            ...prev,
            diceValue: val,
            gamePhase: 'moving',
            timeLeft: 15 // lock timer
        }));

        setTimeout(() => {
            const currentPos = gameState.positions[activePlayer];

            // Build absolute path array for step-by-step animation
            const path: number[] = [];
            let tempPos = currentPos;
            let bounced = false;

            for (let i = 0; i < val; i++) {
                if (tempPos < 100 && !bounced) {
                    tempPos++;
                    if (tempPos === 100 && i < val - 1) {
                        bounced = true;
                    }
                } else if (bounced) {
                    tempPos--;
                }
                path.push(tempPos);
            }

            if (bounced) {
                showMessage(`Too high! Bounced back to ${tempPos}`);
            }

            let stepIndex = 0;

            const animateStep = () => {
                if (stepIndex < path.length) {
                    const nextStepPos = path[stepIndex];
                    setDisplayPositions(prev => ({ ...prev, [activePlayer]: nextStepPos }));
                    playMove();
                    stepIndex++;
                    setTimeout(animateStep, 350); // Speed of each tile step
                } else {
                    // Path finished, check for Snakes or Ladders
                    const targetPos = tempPos;
                    let finalPos = targetPos;
                    const ladder = LADDERS.find(l => l.start === targetPos);
                    const snake = SNAKES.find(s => s.start === targetPos);
                    let hasSlide = false;

                    if (!bounced) {
                        if (ladder) {
                            finalPos = ladder.end;
                            hasSlide = true;
                            setTimeout(() => {
                                showMessage("You found a Ladder! ✨");
                                playWin(); // Positive sound
                                setDisplayPositions(prev => ({ ...prev, [activePlayer]: finalPos }));
                            }, 400); // Small pause before sliding up
                        } else if (snake) {
                            finalPos = snake.end;
                            hasSlide = true;
                            setTimeout(() => {
                                showMessage("Oh no! Snake bite! 🐍");
                                playCapture(); // Aggressive sound
                                setDisplayPositions(prev => ({ ...prev, [activePlayer]: finalPos }));
                            }, 400); // Small pause before sliding down
                        }
                    }

                    // Lock the UI until the sliding transition finishes, otherwise unlock instantly
                    const slideDelay = hasSlide ? 1200 : 300;

                    setTimeout(() => {
                        setGameState(prev => {
                            const finalPositions = { ...prev.positions, [activePlayer]: finalPos };
                            const hasWon = checkWin(finalPositions, activePlayer);

                            if (hasWon) {
                                playWin();
                                triggerWinConfetti();
                                return { ...prev, positions: finalPositions, winner: activePlayer, gamePhase: 'rolling' };
                            }

                            // Extra turn on 6, else next player
                            const nextPlayer = val === 6 ? activePlayer : getNextPlayer(activePlayer, players);
                            if (val !== 6) playTurn();

                            return {
                                ...prev,
                                positions: finalPositions,
                                gamePhase: 'rolling',
                                currentPlayer: nextPlayer,
                                diceValue: null,
                                timeLeft: 15
                            };
                        });
                    }, slideDelay);
                }
            };

            // Start the tile-by-tile journey
            animateStep();

        }, 800); // 800ms wait to show the dice roll number before moving
    }, [gameState, players, playMove, playCapture, playTurn, playWin, triggerWinConfetti, checkWin]);

    const handleSkipTurn = useCallback((missedPlayerColor: Player['color']) => {
        playStrike();
        setGameState(prev => {
            const nextP = getNextPlayer(missedPlayerColor, players);
            const newStrikes = { ...prev.strikes, [missedPlayerColor]: prev.strikes[missedPlayerColor] + 1 };
            return {
                ...prev,
                currentPlayer: nextP,
                timeLeft: 15,
                strikes: newStrikes
            };
        });
        playTurn();
    }, [players, playTurn, playStrike]);


    // --- TIMER LOOP ---
    useEffect(() => {
        if (gameState.winner || gameState.gamePhase !== 'rolling') return;

        const currentPlayerInfo = players.find(p => p.color === gameState.currentPlayer);
        if (!currentPlayerInfo) return;

        // Autoplay if strikes are high, or if it's AI
        const hasHighStrikes = gameState.strikes[gameState.currentPlayer] >= 3;

        if (currentPlayerInfo.isAi || hasHighStrikes) {
            const timer = setTimeout(() => {
                setGameState(s => ({ ...s, isThinking: true }));
                const newValue = Math.floor(Math.random() * 6) + 1;
                setGameState(s => ({ ...s, isThinking: false }));
                handleRoll(newValue);
            }, 1200);
            return () => clearTimeout(timer);
        }

        // Human turn timer
        const timerId = setInterval(() => {
            setGameState(prev => {
                if (prev.timeLeft <= 1) {
                    setTimeout(() => handleSkipTurn(prev.currentPlayer), 0);
                    return prev;
                }
                return { ...prev, timeLeft: prev.timeLeft - 1 };
            });
        }, 1000);

        return () => clearInterval(timerId);
    }, [gameState.currentPlayer, gameState.gamePhase, gameState.winner, gameState.strikes, players, handleRoll, handleSkipTurn]);

    return (
        <div className="snakes-board-wrapper w-full h-full flex flex-col items-center justify-between py-4 px-2">

            {/* Top row cards */}
            <div className="player-row relative w-full flex justify-between z-50 px-10 sm:px-16 md:px-24">
                {/* Empty Area for inner board layout padding */}
                <div></div>


                {(['top-left', 'top-right'] as const).map(pos => {
                    const p = players.find(player => player.position === pos);
                    return p ? (
                        <div key={p.color} className="flex flex-row items-center gap-6 sm:gap-8 z-50">
                            {/* Left Dice (For Right Players, placing it strictly inside) */}
                            {gameState.currentPlayer === p.color && pos.includes('right') && (
                                <div className="z-50 scale-75 origin-right">
                                    <Dice
                                        onRoll={handleRoll}
                                        disabled={gameState.gamePhase !== 'rolling' || !!gameState.winner || (p.isAi && !gameState.winner) || false}
                                    />
                                </div>
                            )}

                            <div className="flex flex-col items-center gap-1">
                                <PlayerCard
                                    player={p}
                                    isActive={gameState.currentPlayer === p.color}
                                    timeLeft={gameState.timeLeft}
                                    strikes={gameState.strikes[p.color]}
                                    power={null}
                                    onAvatarClick={() => { }}
                                />
                                {/* AI / Auto-play Badges */}
                                {gameState.currentPlayer === p.color && gameState.isThinking && p.isAi && (
                                    <div className="ai-thinking-tag">Thinking...</div>
                                )}
                                {gameState.currentPlayer === p.color && !p.isAi && gameState.strikes[p.color] >= 3 && (
                                    <div className="ai-thinking-tag afk-tag">Auto-Play</div>
                                )}
                            </div>

                            {/* Right Dice (For Left Players, placing it strictly inside) */}
                            {gameState.currentPlayer === p.color && pos.includes('left') && (
                                <div className="z-50 scale-75 origin-left">
                                    <Dice
                                        onRoll={handleRoll}
                                        disabled={gameState.gamePhase !== 'rolling' || !!gameState.winner || (p.isAi && !gameState.winner) || false}
                                    />
                                </div>
                            )}
                        </div>
                    ) : <div key={pos} className="w-[120px]" />;
                })}
            </div>

            {/* Main Board Grid container constrained to exactly 3:4 aspect without overflow */}
            <div className="relative w-full aspect-[3/4] max-h-[65vh] max-w-[calc(65vh*0.75)] mx-auto my-auto shrink">

                {/* --- VERTICAL NAMES ANCHORED TO THE BOARD GRID WRAPPER --- */}
                {/* Top-Left: Left edge, top half */}
                {players.find(p => p.position === 'top-left') && (
                    <div className="absolute top-[10%] sm:top-[15%] left-1 sm:-left-3 md:-left-6 flex items-center justify-center pointer-events-none z-[100]">
                        <span
                            className="block text-[11px] sm:text-[13px] font-bold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-200 drop-shadow-md"
                            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                            {players.find(p => p.position === 'top-left')?.name}
                        </span>
                    </div>
                )}

                {/* Bottom-Left: Left edge, bottom half */}
                {players.find(p => p.position === 'bottom-left') && (
                    <div className="absolute bottom-[10%] sm:bottom-[15%] left-1 sm:-left-3 md:-left-6 flex items-center justify-center pointer-events-none z-[100]">
                        <span
                            className="block text-[11px] sm:text-[13px] font-bold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-200 drop-shadow-md"
                            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                            {players.find(p => p.position === 'bottom-left')?.name}
                        </span>
                    </div>
                )}

                {/* Top-Right: Right edge, top half */}
                {players.find(p => p.position === 'top-right') && (
                    <div className="absolute top-[10%] sm:top-[15%] right-1 sm:-right-3 md:-right-6 flex items-center justify-center pointer-events-none z-[100]">
                        <span
                            className="block text-[11px] sm:text-[13px] font-bold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-200 drop-shadow-md"
                            style={{ writingMode: 'vertical-rl' }}
                        >
                            {players.find(p => p.position === 'top-right')?.name}
                        </span>
                    </div>
                )}

                {/* Bottom-Right: Right edge, bottom half */}
                {players.find(p => p.position === 'bottom-right') && (
                    <div className="absolute bottom-[10%] sm:bottom-[15%] right-1 sm:-right-3 md:-right-6 flex items-center justify-center pointer-events-none z-[100]">
                        <span
                            className="block text-[11px] sm:text-[13px] font-bold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-200 drop-shadow-md"
                            style={{ writingMode: 'vertical-rl' }}
                        >
                            {players.find(p => p.position === 'bottom-right')?.name}
                        </span>
                    </div>
                )}

                <div className="snakes-grid-container absolute inset-0 bg-[#ececec] overflow-hidden shadow-base rounded-lg">

                    {/* SVG Overlay for Snakes and Ladders lines */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ zIndex: 10 }}>
                        {LADDERS.map((l, i) => {
                            const p1 = getGridPos(l.start);
                            const p2 = getGridPos(l.end);
                            return <line key={`ladder-${i}`} x1={(p1.c - 0.5) * 10} y1={(p1.r - 0.5) * 10} x2={(p2.c - 0.5) * 10} y2={(p2.r - 0.5) * 10} stroke="rgba(34, 197, 94, 0.6)" strokeWidth="3" strokeDasharray="2,1" strokeLinecap="round" />;
                        })}
                        {SNAKES.map((s, i) => {
                            const p1 = getGridPos(s.start);
                            const p2 = getGridPos(s.end);
                            // Curved path for snakes visually
                            const mx = (p1.c + p2.c) / 2 * 10 + (Math.random() * 10 - 5);
                            const my = (p1.r + p2.r) / 2 * 10 + (Math.random() * 10 - 5);
                            return <path key={`snake-${i}`} d={`M ${(p1.c - 0.5) * 10} ${(p1.r - 0.5) * 10} Q ${mx} ${my} ${(p2.c - 0.5) * 10} ${(p2.r - 0.5) * 10}`} fill="none" stroke="rgba(239, 68, 68, 0.7)" strokeWidth="2.5" strokeLinecap="round" />;
                        })}
                    </svg>

                    <div className="grid grid-cols-10 grid-rows-10 w-full h-full" style={{ zIndex: 5 }}>
                        {Array.from({ length: 100 }).map((_, i) => {
                            const cellNum = 100 - i;
                            const r = Math.floor(i / 10) + 1; // 1 to 10 from top
                            const isEven = r % 2 === 0;
                            const physicalNum = isEven ? (r - 1) * 10 + (i % 10) + 1 : (r - 1) * 10 + (10 - (i % 10));
                            const actualCellNum = 101 - physicalNum;

                            return (
                                <div key={i} className="flex items-center justify-center border border-black/10 text-xs font-bold text-black/30 relative">
                                    {actualCellNum}
                                </div>
                            );
                        })}
                    </div>

                    {/* Tokens overlay */}
                    <div className="absolute inset-0 grid grid-cols-10 grid-rows-10 w-full h-full pointer-events-none" style={{ zIndex: 20 }}>
                        {players.map((p, idx) => {
                            const pos = displayPositions[p.color];
                            if (pos === 0) return null; // Off board
                            const gridP = getGridPos(pos);
                            return (
                                <motion.div
                                    key={p.color}
                                    layout
                                    initial={false}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    className="col-span-1 row-span-1 w-full h-full flex items-center justify-center relative pointer-events-auto"
                                    style={{
                                        gridRow: gridP.r,
                                        gridColumn: gridP.c,
                                    }}
                                >
                                    {/* Offset multiple tokens lightly */}
                                    <div className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center" style={{ transform: `translate(${(idx % 2 === 0 ? 1 : -1) * (idx * 3)}px, ${(idx < 2 ? 1 : -1) * (idx * 3)}px)` }}>
                                        <Token color={p.color} />
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Toast Message Overlay */}
                    <AnimatePresence>
                        {gameState.message && (
                            <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/80 text-white font-bold py-3 px-6 rounded-full shadow-2xl z-50 text-center backdrop-blur-md"
                            >
                                {gameState.message}
                            </motion.div>
                        )}
                    </AnimatePresence>

                </div>
            </div>

            {/* Bottom Row cards and Dice */}
            <div className="player-row relative w-full flex justify-between z-50 items-center px-10 sm:px-16 md:px-24">
                {/* Empty Area for inner board layout padding */}
                <div></div>


                <div className="relative">
                    {(() => {
                        const p = players.find(player => player.position === 'bottom-left');
                        if (!p) return <div className="w-[120px]" />;
                        return (
                            <div key={p.color} className="flex flex-row items-center gap-6 sm:gap-8 z-50">
                                <div className="flex flex-col-reverse items-center gap-1">
                                    <PlayerCard
                                        player={p}
                                        isActive={gameState.currentPlayer === p.color}
                                        timeLeft={gameState.timeLeft}
                                        strikes={gameState.strikes[p.color]}
                                        power={null}
                                        onAvatarClick={() => { }}
                                    />
                                    {gameState.currentPlayer === p.color && gameState.isThinking && p.isAi && (
                                        <div className="ai-thinking-tag">Thinking...</div>
                                    )}
                                    {gameState.currentPlayer === p.color && !p.isAi && gameState.strikes[p.color] >= 3 && (
                                        <div className="ai-thinking-tag afk-tag">Auto-Play</div>
                                    )}
                                </div>

                                {/* Right Dice (For Left Player) */}
                                {gameState.currentPlayer === p.color && (
                                    <div className="z-50 scale-75 origin-left">
                                        <Dice
                                            onRoll={handleRoll}
                                            disabled={gameState.gamePhase !== 'rolling' || !!gameState.winner || (p.isAi && !gameState.winner) || false}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>

                {/* Central Dice removed to match classic board peripheral layout */}

                <div className="relative">
                    {(() => {
                        const p = players.find(player => player.position === 'bottom-right');
                        if (!p) return <div className="w-[120px]" />;
                        return (
                            <div key={p.color} className="flex flex-row items-center gap-6 sm:gap-8 z-50">
                                {/* Left Dice (For Right Player) */}
                                {gameState.currentPlayer === p.color && (
                                    <div className="z-50 scale-75 origin-right">
                                        <Dice
                                            onRoll={handleRoll}
                                            disabled={gameState.gamePhase !== 'rolling' || !!gameState.winner || (p.isAi && !gameState.winner) || false}
                                        />
                                    </div>
                                )}

                                <div className="flex flex-col-reverse items-center gap-1">
                                    <PlayerCard
                                        player={p}
                                        isActive={gameState.currentPlayer === p.color}
                                        timeLeft={gameState.timeLeft}
                                        strikes={gameState.strikes[p.color]}
                                        power={null}
                                        onAvatarClick={() => { }}
                                    />
                                    {gameState.currentPlayer === p.color && gameState.isThinking && p.isAi && (
                                        <div className="ai-thinking-tag">Thinking...</div>
                                    )}
                                    {gameState.currentPlayer === p.color && !p.isAi && gameState.strikes[p.color] >= 3 && (
                                        <div className="ai-thinking-tag afk-tag">Auto-Play</div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>

            {/* Winner Overlay */}
            <AnimatePresence>
                {
                    gameState.winner && (
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="absolute inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm"
                        >
                            <div className="bg-[#1a1c29] border border-white/10 p-8 rounded-2xl shadow-2xl text-center">
                                <h2 className="text-4xl font-extrabold text-white mb-2 uppercase">{gameState.winner} Escapes!</h2>
                                <p className="text-white/60 mb-6 font-medium">Conquered the snakes and climbed to exactly 100!</p>
                                <button onClick={() => window.location.reload()} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-full transition-all">
                                    Play Again
                                </button>
                            </div>
                        </motion.div>
                    )
                }
            </AnimatePresence >
        </div >
    );
}
