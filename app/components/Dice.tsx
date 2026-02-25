'use client';

import { useState } from 'react';

interface DiceProps {
    onRoll: (value: number) => void;
    isRolling?: boolean;
    disabled?: boolean;
}

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

    return (
        <div className="dice-container">
            <button
                className={`dice-face ${isRolling ? 'rolling' : ''}`}
                onClick={roll}
                disabled={disabled || isRolling}
            >
                {/* Dots representation for 1-6 */}
                {!isRolling && value && (
                    <div className={`dice-dots dots-${value}`}>
                        {[...Array(value)].map((_, i) => (
                            <span key={i} className="dice-dot" />
                        ))}
                    </div>
                )}
                {isRolling && <div className="dice-rolling-placeholder">?</div>}
                {!isRolling && !value && <div className="dice-rolling-placeholder">🎲</div>}
            </button>

            <style jsx>{`
                .dice-container {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    perspective: 1000px;
                }

                .dice-face {
                    width: 60px;
                    height: 60px;
                    background: rgba(255, 255, 255, 0.4);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    border: 1px solid rgba(255, 255, 255, 0.5);
                    border-radius: 12px;
                    box-shadow: 
                        0 4px 15px rgba(0,0,0,0.05),
                        inset 0 0 0 1px rgba(255,255,255,0.4);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                    outline: none;
                }

                .dice-face:hover:not(:disabled) {
                    transform: translateY(-2px) scale(1.05);
                    background: rgba(255, 255, 255, 0.5);
                }

                .dice-face:active:not(:disabled) {
                    transform: translateY(0) scale(0.95);
                }

                .dice-face:disabled {
                    cursor: not-allowed;
                    opacity: 0.7;
                }

                .rolling {
                    animation: wiggle 0.15s infinite alternate, spin 0.8s ease-in-out;
                }

                @keyframes wiggle {
                    from { transform: rotate(-5deg); }
                    to { transform: rotate(5deg); }
                }

                @keyframes spin {
                    0% { transform: rotate(0deg) scale(1); }
                    50% { transform: rotate(180deg) scale(1.2); }
                    100% { transform: rotate(360deg) scale(1); }
                }

                .dice-dots {
                    display: grid;
                    width: 80%;
                    height: 80%;
                    gap: 4px;
                }

                .dice-dot {
                    width: 8px;
                    height: 8px;
                    background: #1E293B;
                    border-radius: 50%;
                    justify-self: center;
                    align-self: center;
                }

                .dots-1 { grid-template-areas: ". . ." ". a ." ". . ."; }
                .dots-1 .dice-dot { grid-area: a; }

                .dots-2 { grid-template-areas: "a . ." ". . ." ". . b"; }
                .dots-2 .dice-dot:nth-child(1) { grid-area: a; }
                .dots-2 .dice-dot:nth-child(2) { grid-area: b; }

                .dots-3 { grid-template-areas: "a . ." ". b ." ". . c"; }
                .dots-3 .dice-dot:nth-child(1) { grid-area: a; }
                .dots-3 .dice-dot:nth-child(2) { grid-area: b; }
                .dots-3 .dice-dot:nth-child(3) { grid-area: c; }

                .dots-4 { grid-template-areas: "a . b" ". . ." "c . d"; }
                .dots-4 .dice-dot:nth-child(1) { grid-area: a; }
                .dots-4 .dice-dot:nth-child(2) { grid-area: b; }
                .dots-4 .dice-dot:nth-child(3) { grid-area: c; }
                .dots-4 .dice-dot:nth-child(4) { grid-area: d; }

                .dots-5 { grid-template-areas: "a . b" ". c ." "d . e"; }
                .dots-5 .dice-dot:nth-child(1) { grid-area: a; }
                .dots-5 .dice-dot:nth-child(2) { grid-area: b; }
                .dots-5 .dice-dot:nth-child(3) { grid-area: c; }
                .dots-5 .dice-dot:nth-child(4) { grid-area: d; }
                .dots-5 .dice-dot:nth-child(5) { grid-area: e; }

                .dots-6 { grid-template-areas: "a . b" "c . d" "e . f"; }
                .dots-6 .dice-dot:nth-child(1) { grid-area: a; }
                .dots-6 .dice-dot:nth-child(2) { grid-area: b; }
                .dots-6 .dice-dot:nth-child(3) { grid-area: c; }
                .dots-6 .dice-dot:nth-child(4) { grid-area: d; }
                .dots-6 .dice-dot:nth-child(5) { grid-area: e; }
                .dots-6 .dice-dot:nth-child(6) { grid-area: f; }

                .dice-rolling-placeholder {
                    font-size: 24px;
                    color: #1E293B;
                }
            `}</style>
        </div>
    );
}
