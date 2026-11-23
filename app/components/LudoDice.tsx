/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { motion, useAnimation, AnimatePresence } from 'framer-motion';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useAudio } from '../hooks/useAudio';
import { usePreferences } from '@/hooks/usePreferences';
import { prefersReducedMotion } from '@/lib/motion';

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
};

const COLOR_MAP_3077: Record<string, string> = {
    green: '#00FF66',
    red: '#FF0055',
    blue: '#0099FF',
    yellow: '#FFD000',
};

// Dice skins (equipped from the Marketplace): face + pip colors.
const DICE_SKINS: Record<string, { face: string; pip: string; edge: string }> = {
    classic: { face: '#ffffff', pip: '#0F172A', edge: 'rgba(0,0,0,0.1)' },
    midnight: { face: '#0b1220', pip: '#22d3ee', edge: 'rgba(34,211,238,0.35)' },
    gold: { face: '#451a03', pip: '#fcd34a', edge: 'rgba(252,211,77,0.35)' },
};

const DICE_3077_SKIN = {
    face: 'linear-gradient(145deg, #161E2C 0%, #0A0E16 62%, #05070B 100%)',
    pip: 'var(--accent, #00E5FF)',
    edge: 'rgba(var(--accent-rgb, 0, 229, 255), 0.52)',
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
    const { preferences } = usePreferences();
    const is3077 = preferences.theme === '3077';
    const isTacticalClassic = is3077 && preferences.diceStyle === 'classic';
    const diceSkin = isTacticalClassic ? DICE_3077_SKIN : (DICE_SKINS[preferences.diceStyle] || DICE_SKINS.classic);
    const controls = useAnimation();
    const [critKey, setCritKey] = useState(0);
    
    // Track rotation persistently to enable smooth continuous tumbling
    const rotationRef = useRef({ x: 0, y: 0 });
    const wasExternalRolling = useRef(false);
    const pendingCritRef = useRef(false);

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
            pendingCritRef.current = true;
            playDiceRoll();
            triggerHaptic(40);

            // Start a fast tumble (Ludo World benchmark: 300ms roll spin)
            const spinsX = Math.floor(Math.random() * 2) + 2;
            const spinsY = Math.floor(Math.random() * 2) + 2;
            const targetX = rotationRef.current.x + (360 * spinsX);
            const targetY = rotationRef.current.y + (360 * spinsY);

            controls.start({
                rotateX: targetX,
                rotateY: targetY,
                rotateZ: 0,
                transition: { duration: 0.30, ease: "linear" }
            });

            rotationRef.current = { x: targetX, y: targetY };
        } 
        else if (!isRolling && wasExternalRolling.current) {
            // Roll just finished — landing sound is dispatched once currentValue settles below
            triggerHaptic([30, 50, 30]);
        }
        wasExternalRolling.current = isRolling;
    }, [isRolling, controls, playDiceRoll, triggerHaptic]);

    // Handle landing on specific value (snappy spring snap)
    useEffect(() => {
        if (!isRolling && currentValue) {
            const head = getRotationForValue(currentValue);
            
            const targetX = normalize(rotationRef.current.x, head.rx);
            const targetY = normalize(rotationRef.current.y, head.ry);

            controls.start({
                rotateX: targetX,
                rotateY: targetY,
                rotateZ: 0,
                transition: { type: 'spring', stiffness: 320, damping: 24 }
            });
            
            rotationRef.current = { x: targetX, y: targetY };

            if (pendingCritRef.current) {
                pendingCritRef.current = false;
                if (currentValue !== 6) {
                    playDiceLand();
                }
                if (currentValue === 6 && !prefersReducedMotion()) {
                    setCritKey((k) => k + 1);
                }
            }
        }
    }, [currentValue, isRolling, controls, playDiceLand]);

    const performRoll = () => {
        if (isRolling || disabled) return;
        // The actual logic is now in useGameActions, we just trigger the callback
        // which will then set isRolling=true via engine state
        onRoll(0); // Pass 0 or dummy to trigger the engine's random roll
    };

    const accentColor = (is3077 ? COLOR_MAP_3077 : COLOR_MAP)[activeColor] || '#00E5FF';

    return (
        <motion.div
            className="ludo-dice-container relative flex flex-col items-center justify-center p-4"
            initial={{ scale: 0, opacity: 0, y: 46, rotate: -32 }}
            animate={{
                scale: [0, 1.22, 0.94, 1.06, 1],
                opacity: [0, 1, 1, 1, 1],
                y: [46, -12, 4, 0, 0],
                rotate: [-32, 10, -6, 2, 0],
            }}
            transition={{ duration: 0.85, times: [0, 0.45, 0.68, 0.85, 1], ease: 'easeOut' }}
        >
            {/* Critical-Roll 6 dual shockwave burst (one-shot, compositor-only) */}
            {critKey > 0 && (
                <React.Fragment key={critKey}>
                    <motion.span
                        aria-hidden="true"
                        className="absolute w-14 h-14 rounded-full pointer-events-none"
                        style={{ border: `2.5px solid ${accentColor}`, top: '50%', left: '50%', marginTop: -28, marginLeft: -28 }}
                        initial={{ scale: 0.4, opacity: 0.95 }}
                        animate={{ scale: 2.5, opacity: 0 }}
                        transition={{ duration: 0.65, ease: 'easeOut' }}
                    />
                    <motion.span
                        aria-hidden="true"
                        className="absolute w-12 h-12 rounded-full pointer-events-none"
                        style={{ border: '2px solid #F59E0B', top: '50%', left: '50%', marginTop: -24, marginLeft: -24 }}
                        initial={{ scale: 0.35, opacity: 0.9 }}
                        animate={{ scale: 2.05, opacity: 0 }}
                        transition={{ duration: 0.52, ease: 'easeOut', delay: 0.06 }}
                    />
                </React.Fragment>
            )}
            {/* Turn-pass flash ring: one-shot expanding halo on arrival */}
            <motion.span
                className="absolute w-16 h-16 rounded-full pointer-events-none"
                style={{ border: `3px solid ${accentColor}`, top: '50%', left: '50%', marginTop: -32, marginLeft: -32 }}
                initial={{ scale: 0.3, opacity: 1 }}
                animate={{ scale: 2.6, opacity: 0 }}
                transition={{ duration: 0.9, ease: 'easeOut', delay: 0.15 }}
            />
            {/* Ambient Aura — steady soft glow (the ring above carries the rhythm) */}
            <motion.div
                className="absolute w-24 h-24 rounded-full blur-2xl pointer-events-none"
                initial={false}
                animate={{
                    scale: isRolling ? 0.8 : 1.5,
                    opacity: isRolling ? 0.2 : 0.5,
                    backgroundColor: accentColor,
                }}
                transition={{ duration: 0.3 }}
            />
            {/* Expanding color ring while awaiting the roll — one clean wave */}
            {!disabled && !isRolling && (
                <motion.span
                    className="absolute w-14 h-14 rounded-full pointer-events-none"
                    style={{ border: `3px solid ${accentColor}`, top: '50%', left: '50%', marginTop: -28, marginLeft: -28 }}
                    animate={{ scale: [0.5, 1.9], opacity: [0.95, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                />
            )}

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
                                faceColor={diceSkin.face}
                                pipColor={diceSkin.pip}
                                edgeColor={diceSkin.edge}
                                isTacticalFace={isTacticalClassic}
                            />
                        ))}
                    </button>
                </motion.div>
            </div>

            {/* Drop Shadow / 3077 Holographic Emitter Pad */}
            {is3077 ? (
                <motion.div
                    className="w-11 h-1.5 rounded-full pointer-events-none mt-4"
                    style={{
                        backgroundColor: accentColor,
                        boxShadow: `0 0 12px ${accentColor}`,
                    }}
                    animate={{
                        scale: isRolling ? [0.8, 0.55, 0.8] : 1,
                        opacity: isRolling ? 0.28 : 0.55,
                    }}
                    transition={isRolling ? { repeat: Infinity, duration: 0.6 } : {}}
                />
            ) : (
                <motion.div 
                    className="w-10 h-1.5 rounded-[100%] bg-black/60 blur-sm pointer-events-none mt-4"
                    animate={{
                        scale: isRolling ? [1, 0.7, 1] : 1,
                        opacity: isRolling ? 0.3 : 0.6
                    }}
                    transition={isRolling ? { repeat: Infinity, duration: 0.6 } : {}}
                />
            )}

            <style jsx>{`
                .ludo-dice-container {
                    cursor: pointer;
                    user-select: none;
                }
            `}</style>
        </motion.div>
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

function DiceFace({
    num,
    transform,
    faceColor,
    pipColor,
    edgeColor = 'rgba(0,0,0,0.08)',
    isTacticalFace = false,
}: {
    num: number;
    transform: string;
    faceColor: string;
    pipColor: string;
    edgeColor?: string;
    isTacticalFace?: boolean;
}) {
    return (
        <div
            className={`absolute inset-0 w-12 h-12 flex items-center justify-center p-1 border ${
                isTacticalFace
                    ? 'rounded-md shadow-[inset_0_0_8px_color-mix(in_srgb,var(--accent)_18%,transparent),inset_0_1px_1px_rgba(255,255,255,0.16),0_1px_4px_rgba(0,0,0,0.6)]'
                    : 'rounded-lg shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1),inset_0_1px_2px_rgba(255,255,255,1),0_1px_4px_rgba(0,0,0,0.1)]'
            }`}
            style={{
                transform,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                background: faceColor,
                borderColor: isTacticalFace ? edgeColor : 'rgba(0,0,0,0.08)',
            }}
        >
            <svg
                viewBox="0 0 100 100"
                className={`w-full h-full ${isTacticalFace ? 'opacity-95' : 'opacity-90 drop-shadow-sm'}`}
                style={isTacticalFace ? { filter: 'drop-shadow(0 0 3px color-mix(in srgb, var(--accent, #00E5FF) 75%, transparent))' } : undefined}
            >
                {DOT_POSITIONS[num as keyof typeof DOT_POSITIONS].map(([cx, cy], i) => (
                    <circle key={i} cx={cx} cy={cy} r="8.5" fill={pipColor} />
                ))}
            </svg>
        </div>
    );
}
