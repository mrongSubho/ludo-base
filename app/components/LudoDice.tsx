"use client";

import React, { useState, useEffect, useRef } from 'react';
import { motion, useAnimation, AnimatePresence } from 'framer-motion';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useAudio } from '../hooks/useAudio';

interface LudoDiceProps {
    onRoll: (value: number) => void;
    currentValue?: number | null;
    isRolling?: boolean;
    disabled?: boolean;
    activeColor?: string; // e.g. 'green', 'red'
}

const DOT_POSITIONS = {
    1: [[50, 50]],
    2: [[25, 25], [75, 75]],
    3: [[20, 20], [50, 50], [80, 80]],
    4: [[25, 25], [25, 75], [75, 25], [75, 75]],
    5: [[20, 20], [20, 80], [50, 50], [80, 20], [80, 80]],
    6: [[25, 20], [25, 50], [25, 80], [75, 20], [75, 50], [75, 80]]
};

const COLOR_MAP: Record<string, string> = {
    green: '#10b981',
    red: '#ef4444',
    blue: '#3b82f6',
    yellow: '#f59e0b',
    purple: '#a855f7'
};

const FACE_MAP = [
    { num: 1, rx: 0, ry: 0 },       // Front
    { num: 2, rx: 0, ry: -90 },     // Right
    { num: 6, rx: 0, ry: 180 },     // Back
    { num: 5, rx: 0, ry: 90 },      // Left
    { num: 3, rx: -90, ry: 0 },     // Top
    { num: 4, rx: 90, ry: 0 }       // Bottom
];

export default function LudoDice({ 
    onRoll, 
    currentValue, 
    isRolling = false, 
    disabled,
    activeColor = 'blue'
}: LudoDiceProps) {
    const { playDiceRoll, playDiceLand } = useSoundEffects();
    const { triggerHaptic } = useAudio();
    const controls = useAnimation();
    
    // Track rotation persistently to enable smooth continuous tumbling
    const rotationRef = useRef({ x: 0, y: 0 });
    const wasExternalRolling = useRef(false);

    const getRotationForValue = (val: number) => {
        const face = FACE_MAP.find(f => f.num === val) || FACE_MAP[0];
        return { rx: face.rx, ry: face.ry };
    };

    const normalize = (current: number, target: number) => {
        let diff = (target - current) % 360;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        return current + diff;
    };

    // Effect to handle programmatic roll start (Bots/Remote)
    useEffect(() => {
        if (isRolling && !wasExternalRolling.current) {
            // Roll just started
            playDiceRoll();
            triggerHaptic(40);

            // Start a long, fast tumble
            const spinsX = Math.floor(Math.random() * 2) + 2;
            const spinsY = Math.floor(Math.random() * 2) + 2;
            const targetX = rotationRef.current.x + (360 * spinsX);
            const targetY = rotationRef.current.y + (360 * spinsY);

            controls.start({
                rotateX: targetX,
                rotateY: targetY,
                rotateZ: 0,
                transition: { duration: 1.2, ease: "linear" }
            });

            rotationRef.current = { x: targetX, y: targetY };
        } 
        else if (!isRolling && wasExternalRolling.current) {
            // Roll just finished
            playDiceLand();
            triggerHaptic([30, 50, 30]);
        }
        wasExternalRolling.current = isRolling;
    }, [isRolling, controls, playDiceRoll, playDiceLand, triggerHaptic]);

    // Handle landing on specific value
    useEffect(() => {
        if (!isRolling && currentValue) {
            const head = getRotationForValue(currentValue);
            
            const targetX = normalize(rotationRef.current.x, head.rx);
            const targetY = normalize(rotationRef.current.y, head.ry);

            controls.start({
                rotateX: targetX,
                rotateY: targetY,
                rotateZ: 0,
                transition: { type: 'spring', stiffness: 200, damping: 25 }
            });
            
            rotationRef.current = { x: targetX, y: targetY };
        }
    }, [currentValue, isRolling, controls]);

    const performRoll = () => {
        if (isRolling || disabled) return;
        // The actual logic is now in useGameActions, we just trigger the callback
        // which will then set isRolling=true via engine state
        onRoll(0); // Pass 0 or dummy to trigger the engine's random roll
    };

    const accentColor = COLOR_MAP[activeColor] || '#ffffff';

    return (
        <div className="ludo-dice-container relative flex flex-col items-center justify-center p-4">
            {/* Ambient Aura */}
            <motion.div 
                className="absolute w-24 h-24 rounded-full blur-2xl pointer-events-none opacity-40"
                animate={{
                    scale: isRolling ? 0.8 : 1.4,
                    opacity: isRolling ? 0.2 : 0.5,
                    backgroundColor: accentColor
                }}
            />

            {/* 3D Scene Wrapper */}
            <div 
                className="relative w-12 h-12" 
                style={{ perspective: '800px' }}
            >
                {/* The Cube (Motor) */}
                <motion.div
                    className="w-full h-full relative"
                    animate={controls}
                    initial={{ rotateX: 0, rotateY: 0 }}
                    style={{ transformStyle: 'preserve-3d' }}
                >
                    <button
                        onClick={performRoll}
                        disabled={disabled || isRolling}
                        className="w-full h-full relative border-none bg-transparent cursor-pointer"
                        style={{ transformStyle: 'preserve-3d' }}
                    >
                        {FACE_MAP.map((face, i) => (
                            <DiceFace 
                                key={i} 
                                num={face.num} 
                                transform={getFaceTransform(i)} 
                            />
                        ))}
                    </button>
                </motion.div>
            </div>

            {/* Drop Shadow */}
            <motion.div 
                className="w-10 h-1.5 rounded-[100%] bg-black/60 blur-sm pointer-events-none mt-4"
                animate={{
                    scale: isRolling ? [1, 0.7, 1] : 1,
                    opacity: isRolling ? 0.3 : 0.6
                }}
                transition={isRolling ? { repeat: Infinity, duration: 0.6 } : {}}
            />

            <style jsx>{`
                .ludo-dice-container {
                    cursor: pointer;
                    user-select: none;
                }
            `}</style>
        </div>
    );
}

function getFaceTransform(index: number) {
    const tz = '24px'; // Half of cube size (48px / 2 = 24px)
    return [
        `translateZ(${tz})`,                 // Front
        `rotateY(90deg) translateZ(${tz})`,   // Right
        `rotateY(180deg) translateZ(${tz})`,  // Back
        `rotateY(-90deg) translateZ(${tz})`,  // Left
        `rotateX(90deg) translateZ(${tz})`,   // Top
        `rotateX(-90deg) translateZ(${tz})`   // Bottom
    ][index];
}

function DiceFace({ num, transform }: { num: number, transform: string }) {
    return (
        <div
            className="absolute inset-0 w-12 h-12 flex items-center justify-center p-1 rounded-lg bg-white border border-gray-100 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1),inset_0_1px_2px_rgba(255,255,255,1),0_1px_4px_rgba(0,0,0,0.1)]"
            style={{ 
                transform,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden'
            }}
        >
            <svg viewBox="0 0 100 100" className="w-full h-full opacity-90 drop-shadow-sm">
                {DOT_POSITIONS[num as keyof typeof DOT_POSITIONS].map(([cx, cy], i) => (
                    <circle key={i} cx={cx} cy={cy} r="8.5" fill="#0F172A" />
                ))}
            </svg>
        </div>
    );
}
