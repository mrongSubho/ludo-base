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
                style={{ width: 42, height: 42 }}
            >
                <motion.svg
                    viewBox="0 0 100 100"
                    className="dice-svg"
                    animate={isRolling ? { rotate: [0, 90, 180, 270, 360], scale: [1, 1.15, 0.95, 1.1, 1] } : {}}
                    transition={{ repeat: isRolling ? Infinity : 0, duration: 0.5, ease: "easeInOut" }}
                >
                    <defs>
                        <linearGradient id="diceBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#FEFEFE" />
                            <stop offset="40%" stopColor="#F8F6F0" />
                            <stop offset="100%" stopColor="#E8E4DA" />
                        </linearGradient>
                        <radialGradient id="diceShine" cx="35%" cy="30%" r="60%">
                            <stop offset="0%" stopColor="rgba(255,255,255,0.6)" />
                            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                        </radialGradient>
                        <filter id="diceShadow" x="-10%" y="-10%" width="120%" height="130%">
                            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.15)" />
                        </filter>
                    </defs>

                    {/* Outer shadow body */}
                    <rect
                        x="5" y="5" width="90" height="90" rx="18" ry="18"
                        fill="url(#diceBodyGrad)"
                        stroke="#D4D0C8"
                        strokeWidth="1.5"
                        filter="url(#diceShadow)"
                    />

                    {/* Inner 3D shine overlay */}
                    <rect
                        x="5" y="5" width="90" height="90" rx="18" ry="18"
                        fill="url(#diceShine)"
                    />

                    {/* Subtle inner border */}
                    <rect
                        x="9" y="9" width="82" height="82" rx="14" ry="14"
                        fill="none"
                        stroke="rgba(255,255,255,0.6)"
                        strokeWidth="1"
                    />

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
                                animate={{ opacity: 0.4 }}
                                exit={{ opacity: 0 }}
                            >
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
                    border-radius: 12px;
                }

                .dice-svg {
                    width: 42px;
                    height: 42px;
                    filter: drop-shadow(0 3px 6px rgba(0,0,0,0.12)) drop-shadow(0 1px 2px rgba(0,0,0,0.08));
                }

                .dice-dot-svg {
                    filter: drop-shadow(0 1px 0px rgba(0,0,0,0.15));
                }

                .dice-btn:hover:not(:disabled) {
                    transform: translateY(-3px) scale(1.08);
                }

                .dice-btn:hover:not(:disabled) .dice-svg {
                    filter: drop-shadow(0 6px 12px rgba(0,0,0,0.18)) drop-shadow(0 2px 4px rgba(0,0,0,0.1));
                }

                .dice-btn:active:not(:disabled) {
                    transform: translateY(1px) scale(0.96);
                }

                .dice-btn:disabled {
                    cursor: not-allowed;
                    opacity: 0.6;
                }

                .rolling {
                    animation: diceShake 0.15s infinite alternate ease-in-out;
                }

                @keyframes diceShake {
                    0% { transform: translate(0.5px, 0.5px) rotate(0deg); }
                    25% { transform: translate(-1px, -1px) rotate(-2deg); }
                    50% { transform: translate(1px, 0px) rotate(1deg); }
                    75% { transform: translate(-0.5px, 1px) rotate(-1deg); }
                    100% { transform: translate(1px, -1px) rotate(2deg); }
                }
            `}</style>
        </div>
    );
}
