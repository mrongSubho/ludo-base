'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface DiceProps {
    onRoll: (value: number) => void;
    isRolling?: boolean;
    disabled?: boolean;
}

const DOT_POSITIONS = {
    1: [[50, 50]],
    2: [[25, 25], [75, 75]],
    3: [[20, 20], [50, 50], [80, 80]],
    4: [[25, 25], [25, 75], [75, 25], [75, 75]],
    5: [[20, 20], [20, 80], [50, 50], [80, 20], [80, 80]],
    6: [[25, 20], [25, 50], [25, 80], [75, 20], [75, 50], [75, 80]]
};

export default function Dice({ onRoll, isRolling: externalIsRolling, disabled }: DiceProps) {
    const [localIsRolling, setLocalIsRolling] = useState(false);
    const [value, setValue] = useState<number | null>(null);

    const isRolling = externalIsRolling || localIsRolling;

    const roll = () => {
        if (isRolling || disabled) return;

        setLocalIsRolling(true);

        // Simulate rolling duration
        setTimeout(() => {
            const newValue = Math.floor(Math.random() * 6) + 1;
            setValue(newValue);
            setLocalIsRolling(false);
            onRoll(newValue);
        }, 800);
    };

    const renderDots = (num: number) => {
        const positions = DOT_POSITIONS[num as keyof typeof DOT_POSITIONS] || [];
        return positions.map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="8" fill="#1E293B" className="dice-dot-svg" />
        ));
    };

    return (
        <div className="dice-container">
            <button
                className={`dice-btn ${isRolling ? 'rolling' : ''}`}
                onClick={roll}
                disabled={disabled || isRolling}
                title={disabled ? (isRolling ? "Rolling..." : "Wait for your turn") : "Roll Dice"}
                style={{ width: 48, height: 48 }}
            >
                <motion.svg
                    viewBox="0 0 100 100"
                    className="dice-svg"
                    animate={isRolling ? { rotate: [0, 90, 180, 270, 360], scale: [1, 1.1, 1] } : {}}
                    transition={{ repeat: isRolling ? Infinity : 0, duration: 0.4, ease: "linear" }}
                >
                    {/* Main Dice Body */}
                    <rect
                        x="5" y="5" width="90" height="90" rx="20" ry="20"
                        fill="url(#diceGrad)"
                        stroke="rgba(255,255,255,0.8)"
                        strokeWidth="3"
                        className="dice-rect"
                    />

                    {/* Inner highlight for 3D effect */}
                    <rect
                        x="8" y="8" width="84" height="84" rx="16" ry="16"
                        fill="transparent"
                        stroke="rgba(255,255,255,0.5)"
                        strokeWidth="2"
                    />

                    {/* Gradients */}
                    <defs>
                        <linearGradient id="diceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#ffffff" />
                            <stop offset="100%" stopColor="#e2e8f0" />
                        </linearGradient>
                    </defs>

                    {/* Dots / Face */}
                    <AnimatePresence mode="wait">
                        {!isRolling && value && (
                            <motion.g
                                key={`face-${value}`}
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                                transition={{ duration: 0.2 }}
                            >
                                {renderDots(value)}
                            </motion.g>
                        )}
                        {(!value || isRolling) && (
                            <motion.g
                                key="face-empty"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                style={{ opacity: isRolling ? 0.3 : 1 }}
                            >
                                {/* Show 6 dots as the default resting face instead of '?' */}
                                {renderDots(6)}
                            </motion.g>
                        )}
                    </AnimatePresence>
                </motion.svg>
            </button>

            <style jsx>{`
                .dice-container {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    perspective: 1000px;
                }

                .dice-btn {
                    padding: 0;
                    margin: 0;
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    outline: none;
                    transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                }

                .dice-svg {
                    width: 48px;
                    height: 48px;
                    filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1));
                }

                .dice-rect {
                    transition: fill 0.3s;
                }

                .dice-dot-svg {
                    filter: drop-shadow(0 1px 1px rgba(255,255,255,0.8));
                }

                .dice-btn:hover:not(:disabled) {
                    transform: translateY(-4px) scale(1.05);
                }

                .dice-btn:hover:not(:disabled) .dice-svg {
                    filter: drop-shadow(0 8px 12px rgba(0,0,0,0.15));
                }

                .dice-btn:active:not(:disabled) {
                    transform: translateY(2px) scale(0.95);
                }

                .dice-btn:disabled {
                    cursor: not-allowed;
                    opacity: 0.8;
                }

                .rolling {
                    animation: diceShake 0.4s infinite alternate ease-in-out;
                }

                @keyframes diceShake {
                    0% { transform: translate(1px, 1px) rotate(0deg); }
                    10% { transform: translate(-1px, -2px) rotate(-1deg); }
                    20% { transform: translate(-3px, 0px) rotate(1deg); }
                    30% { transform: translate(3px, 2px) rotate(0deg); }
                    40% { transform: translate(1px, -1px) rotate(1deg); }
                    50% { transform: translate(-1px, 2px) rotate(-1deg); }
                    60% { transform: translate(-3px, 1px) rotate(0deg); }
                    70% { transform: translate(3px, 1px) rotate(-1deg); }
                    80% { transform: translate(-1px, -1px) rotate(1deg); }
                    90% { transform: translate(1px, 2px) rotate(0deg); }
                    100% { transform: translate(1px, -2px) rotate(-1deg); }
                }
            `}</style>
        </div>
    );
}
