"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useAnimation } from 'framer-motion';
import type { Corner } from '@/lib/types';
import {
    DOT_POSITIONS,
    computeBreakoutTrajectory,
    resolveDiceThemeId,
    type DiceFaceNumber,
    type DiceThemeId,
} from '@/lib/diceVisuals';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useAudio } from '../hooks/useAudio';
import { usePreferences } from '@/hooks/usePreferences';
import { prefersReducedMotion } from '@/lib/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface LudoDiceProps {
    onRoll: (value: number) => void;
    currentValue?: number | null;
    isRolling?: boolean;
    disabled?: boolean;
    activeColor?: string; // e.g. 'green', 'red'
    corner?: Corner;
    boostActive?: boolean;
    bustKey?: number;
    onAirborneChange?: (airborne: boolean) => void;
}

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

const COLOR_MAP_RETRO: Record<string, string> = {
    green: '#34D399',
    red: '#FB7185',
    blue: '#5CE1FF',
    yellow: '#FBBF24',
};

const COLOR_MAP_DAYBREAK: Record<string, string> = {
    green: '#16A34A',
    red: '#DC2626',
    blue: '#2563EB',
    yellow: '#D97706',
};

// Dice skins (equipped from the Marketplace): face + pip colors + inner cube core.
const DICE_SKINS: Record<string, { face: string; pip: string; edge: string; core: string }> = {
    classic: { face: '#ffffff', pip: '#0F172A', edge: 'rgba(0,0,0,0.1)', core: '#CBD5E1' },
    midnight: { face: '#0b1220', pip: '#22d3ee', edge: 'rgba(34,211,238,0.35)', core: '#070B14' },
    gold: { face: '#451a03', pip: '#fcd34a', edge: 'rgba(252,211,77,0.35)', core: '#2E1102' },
};

const DICE_3077_SKIN = {
    face: 'linear-gradient(145deg, #182132 0%, #0A0E16 62%, #05070B 100%)',
    pip: 'var(--accent, #00E5FF)',
    edge: 'rgba(var(--accent-rgb, 0, 229, 255), 0.56)',
    core: '#090D16',
};

const DICE_RETRO_SKIN = {
    face: 'linear-gradient(155deg, #132038 0%, #0A1120 62%, #050912 100%)',
    pip: 'var(--accent, #5CE1FF)',
    edge: 'rgba(var(--accent-rgb, 92, 225, 255), 0.56)',
    core: '#08101E',
};

const DICE_DAYBREAK_SKIN = {
    face: 'linear-gradient(145deg, #FFFFFF 0%, #F7F3EA 62%, #E5DECE 100%)',
    pip: '#18181B',
    edge: 'rgba(28, 25, 23, 0.2)',
    core: '#DDD4C3',
};

const FACE_MAP: readonly { num: DiceFaceNumber; rx: number; ry: number; shadeTint: string }[] = [
    { num: 1, rx: 0, ry: 0, shadeTint: 'transparent' },                        // Front
    { num: 2, rx: 0, ry: -90, shadeTint: 'rgba(0, 0, 0, 0.06)' },              // Right
    { num: 6, rx: 0, ry: 180, shadeTint: 'transparent' },                      // Back
    { num: 5, rx: 0, ry: 90, shadeTint: 'rgba(0, 0, 0, 0.06)' },               // Left
    { num: 3, rx: -90, ry: 0, shadeTint: 'rgba(255, 255, 255, 0.07)' },        // Top
    { num: 4, rx: 90, ry: 0, shadeTint: 'rgba(0, 0, 0, 0.12)' },               // Bottom
];

export default function LudoDice({
    onRoll,
    currentValue,
    isRolling = false,
    disabled,
    activeColor = 'blue',
    corner = 'TL',
    boostActive = false,
    bustKey = 0,
    onAirborneChange,
}: LudoDiceProps) {
    const { playDiceRoll, playDiceLand } = useSoundEffects();
    const { triggerHaptic } = useAudio();
    const { preferences } = usePreferences();
    const reduced = useReducedMotion();
    const is3077 = preferences.theme === '3077';
    const isRetro = preferences.theme === 'retro';
    const isDaybreak = preferences.theme === 'light';
    const themeId = resolveDiceThemeId(preferences.theme);
    const isTacticalClassic = is3077 && preferences.diceStyle === 'classic';
    const isOrbitalClassic = isRetro && preferences.diceStyle === 'classic';
    const isPorcelainClassic = isDaybreak && preferences.diceStyle === 'classic';
    const diceSkin = isTacticalClassic
        ? DICE_3077_SKIN
        : isOrbitalClassic
          ? DICE_RETRO_SKIN
          : isPorcelainClassic
            ? DICE_DAYBREAK_SKIN
            : (DICE_SKINS[preferences.diceStyle] || DICE_SKINS.classic);

    const traj = computeBreakoutTrajectory(corner, themeId);

    const controls = useAnimation();
    const arcControls = useAnimation();
    const [critKey, setCritKey] = useState(0);
    const [landKey, setLandKey] = useState(0);
    const [bustFlashKey, setBustFlashKey] = useState(0);
    const [visualRolling, setVisualRolling] = useState(false);

    // Track continuous 3D tumble angles and roll lifecycle across network/offline timing.
    const rotationRef = useRef({ x: 0, y: 0 });
    const isRollingRef = useRef(isRolling);
    isRollingRef.current = isRolling;
    const wasExternalRolling = useRef(false);
    const prevValueRef = useRef<number | null | undefined>(currentValue);
    const pendingCritRef = useRef(false);
    const spinLoopRef = useRef<number | null>(null);
    const catchUpTimerRef = useRef<number | null>(null);

    const stopSpinLoop = useCallback(() => {
        if (spinLoopRef.current !== null) {
            window.clearInterval(spinLoopRef.current);
            spinLoopRef.current = null;
        }
    }, []);

    useEffect(() => {
        onAirborneChange?.(visualRolling);
    }, [visualRolling, onAirborneChange]);

    useEffect(() => {
        return () => {
            stopSpinLoop();
            if (catchUpTimerRef.current !== null) {
                window.clearTimeout(catchUpTimerRef.current);
                catchUpTimerRef.current = null;
            }
        };
    }, [stopSpinLoop]);

    const getRotationForValue = (val: number) => {
        const face = FACE_MAP.find((f) => f.num === val) || FACE_MAP[0];
        return { rx: face.rx, ry: face.ry };
    };

    const normalize = (current: number, target: number) => {
        let diff = (target - current) % 360;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        return current + diff;
    };

    const runSettleAnimation = useCallback(
        (faceNum: number, triggerFeedback: boolean) => {
            stopSpinLoop();
            setVisualRolling(false);
            const head = getRotationForValue(faceNum);
            const targetX = normalize(rotationRef.current.x, head.rx);
            const targetY = normalize(rotationRef.current.y, head.ry);

            controls.start({
                rotateX: targetX,
                rotateY: targetY,
                rotateZ: 0,
                transition: prefersReducedMotion()
                    ? { duration: 0.01 }
                    : { type: 'spring', stiffness: traj.settleSpring.stiffness, damping: traj.settleSpring.damping },
            });

            if (!prefersReducedMotion()) {
                arcControls.start({
                    x: traj.settleArc.x,
                    y: traj.settleArc.y,
                    scale: traj.settleArc.scale,
                    rotateZ: traj.settleArc.rotateZ,
                    transition: {
                        duration: traj.settleArc.duration,
                        times: traj.settleArc.times,
                        ease: 'easeOut',
                    },
                });
            } else {
                arcControls.set({ x: 0, y: 0, scale: 1, rotateZ: 0 });
            }

            rotationRef.current = { x: targetX, y: targetY };

            if (triggerFeedback) {
                if (faceNum !== 6) {
                    playDiceLand();
                }
                if (!prefersReducedMotion()) {
                    setLandKey((k) => k + 1);
                    if (faceNum === 6) {
                        setCritKey((k) => k + 1);
                    }
                }
            }
        },
        [stopSpinLoop, controls, arcControls, traj, playDiceLand],
    );

    // 1. Live Roll Start -> Continuous Non-Stop 3D Breakout Tumble (zero 860ms dead freeze)
    useEffect(() => {
        if (isRolling && !wasExternalRolling.current) {
            if (catchUpTimerRef.current !== null) {
                window.clearTimeout(catchUpTimerRef.current);
                catchUpTimerRef.current = null;
            }
            pendingCritRef.current = true;
            setVisualRolling(true);
            playDiceRoll();
            triggerHaptic(40);

            if (prefersReducedMotion()) {
                controls.start({
                    rotateX: rotationRef.current.x + 180,
                    rotateY: rotationRef.current.y + 180,
                    rotateZ: 0,
                    transition: { duration: 0.01 },
                });
            } else {
                const spinStep = (durationSec: number) => {
                    const stepX = traj.spinRpmDeg * traj.dirY;
                    const stepY = Math.round(traj.spinRpmDeg * 0.78) * traj.dirX;
                    const nextX = rotationRef.current.x + stepX + traj.cantDeg.rx;
                    const nextY = rotationRef.current.y + stepY + traj.cantDeg.ry;
                    rotationRef.current = { x: nextX, y: nextY };
                    controls.start({
                        rotateX: nextX,
                        rotateY: nextY,
                        rotateZ: is3077 ? 16 * traj.dirX : 11 * traj.dirX,
                        transition: {
                            duration: durationSec,
                            ease: is3077 ? [0.22, 0.9, 0.32, 1] : 'linear',
                        },
                    });
                };

                spinStep(traj.flightDuration);
                stopSpinLoop();
                spinLoopRef.current = window.setInterval(() => {
                    if (!isRollingRef.current) {
                        stopSpinLoop();
                        return;
                    }
                    spinStep(0.38);
                }, 380);

                arcControls.start({
                    x: traj.flightKeyframes.x,
                    y: traj.flightKeyframes.y,
                    scale: traj.flightKeyframes.scale,
                    rotateZ: traj.flightKeyframes.rotateZ,
                    transition: {
                        duration: traj.flightDuration,
                        times: traj.flightKeyframes.times,
                        ease: is3077 ? [0.16, 1, 0.3, 1] : 'easeOut',
                    },
                });
            }
        } else if (!isRolling && wasExternalRolling.current) {
            triggerHaptic([30, 50, 30]);
        }
        wasExternalRolling.current = isRolling;
    }, [
        isRolling,
        controls,
        arcControls,
        playDiceRoll,
        triggerHaptic,
        traj,
        is3077,
        stopSpinLoop,
    ]);

    // 2. Landing & Remote Snapshot Catch-Up Roll (prevents silent snap for opponents in MatchRoom)
    useEffect(() => {
        const prevVal = prevValueRef.current;
        prevValueRef.current = currentValue;

        if (isRolling || !currentValue) return;

        // If a remote snapshot jumped straight from null -> N without setting isRolling=true,
        // play a crisp 320ms breakout spin so opponents visibly toss the die too!
        const skippedRollPhase = prevVal == null && !pendingCritRef.current && !prefersReducedMotion();

        if (skippedRollPhase) {
            setVisualRolling(true);
            playDiceRoll();
            const targetX = rotationRef.current.x + 360 * traj.dirY + traj.cantDeg.rx;
            const targetY = rotationRef.current.y + 360 * traj.dirX + traj.cantDeg.ry;
            rotationRef.current = { x: targetX, y: targetY };

            controls.start({
                rotateX: targetX,
                rotateY: targetY,
                rotateZ: 12 * traj.dirX,
                transition: { duration: 0.32, ease: 'easeOut' },
            });
            arcControls.start({
                x: traj.flightKeyframes.x,
                y: traj.flightKeyframes.y,
                scale: traj.flightKeyframes.scale,
                rotateZ: traj.flightKeyframes.rotateZ,
                transition: { duration: 0.32, times: traj.flightKeyframes.times, ease: 'easeOut' },
            });

            if (catchUpTimerRef.current !== null) {
                window.clearTimeout(catchUpTimerRef.current);
            }
            const landedFace = currentValue;
            catchUpTimerRef.current = window.setTimeout(() => {
                catchUpTimerRef.current = null;
                runSettleAnimation(landedFace, true);
            }, 320);
            return;
        }

        const shouldFeedback = pendingCritRef.current;
        pendingCritRef.current = false;
        runSettleAnimation(currentValue, shouldFeedback);
    }, [
        currentValue,
        isRolling,
        controls,
        arcControls,
        traj,
        playDiceRoll,
        runSettleAnimation,
    ]);

    // Triple-6 bust micro-shake & crimson warning halo
    useEffect(() => {
        if (bustKey <= 0 || prefersReducedMotion()) return;
        setBustFlashKey((k) => k + 1);
        arcControls.start({
            x: [0, -6, 6, -4, 4, 0],
            scale: [1, 0.94, 1.05, 1],
            transition: { duration: 0.36, ease: 'easeOut' },
        });
    }, [bustKey, arcControls]);

    const performRoll = () => {
        if (isRolling || visualRolling || disabled) return;
        onRoll(0);
    };

    const accentColor =
        (is3077
            ? COLOR_MAP_3077
            : isRetro
              ? COLOR_MAP_RETRO
              : isDaybreak
                ? COLOR_MAP_DAYBREAK
                : COLOR_MAP)[activeColor] || '#5CE1FF';

    const showReadyEmblem = !visualRolling && (currentValue === null || currentValue === undefined);

    return (
        <motion.div
            className={`ludo-dice-container relative flex items-center justify-center ${visualRolling ? 'is-airborne' : ''}`}
            initial={reduced ? false : { scale: 0.58, opacity: 0 }}
            animate={{
                scale: reduced ? 1 : [0.58, 1.09, 0.96, 1],
                opacity: 1,
            }}
            transition={{
                duration: reduced ? 0.01 : 0.28,
                times: [0, 0.55, 0.8, 1],
                ease: 'easeOut',
            }}
        >
            {/* Touchdown shock-ring on any roll settle */}
            {!reduced && landKey > 0 && (
                <motion.span
                    key={`land-${landKey}`}
                    aria-hidden="true"
                    className={`dice-land-ring theme-fx-${themeId}`}
                    style={{ borderColor: boostActive ? '#f59e0b' : accentColor }}
                    initial={{ scale: 0.65, opacity: 0.9 }}
                    animate={{ scale: is3077 ? 2.15 : 2.05, opacity: 0 }}
                    transition={{ duration: 0.42, ease: 'easeOut' }}
                />
            )}

            {/* Critical-Roll 6 dual shockwave burst + 6 radial sparks */}
            {!reduced && critKey > 0 && (
                <React.Fragment key={critKey}>
                    <motion.span
                        aria-hidden="true"
                        className={`dice-crit-ring theme-fx-${themeId}`}
                        style={{ borderColor: accentColor }}
                        initial={{ scale: 0.4, opacity: 0.95 }}
                        animate={{ scale: 2.55, opacity: 0 }}
                        transition={{ duration: 0.65, ease: 'easeOut' }}
                    />
                    <motion.span
                        aria-hidden="true"
                        className={`dice-crit-ring is-gold theme-fx-${themeId}`}
                        initial={{ scale: 0.35, opacity: 0.9 }}
                        animate={{ scale: 2.1, opacity: 0 }}
                        transition={{ duration: 0.52, ease: 'easeOut', delay: 0.06 }}
                    />
                    {[0, 60, 120, 180, 240, 300].map((deg) => {
                        const rad = (deg * Math.PI) / 180;
                        return (
                            <motion.span
                                key={deg}
                                aria-hidden="true"
                                className={`dice-crit-spark theme-fx-${themeId}`}
                                style={{
                                    backgroundColor:
                                        isDaybreak
                                            ? deg % 120 === 0
                                                ? accentColor
                                                : '#D97706'
                                            : deg % 120 === 0
                                              ? accentColor
                                              : '#f59e0b',
                                }}
                                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                                animate={{
                                    x: Math.cos(rad) * 34,
                                    y: Math.sin(rad) * 34,
                                    opacity: 0,
                                    scale: 0.3,
                                }}
                                transition={{ duration: 0.48, ease: 'easeOut' }}
                            />
                        );
                    })}
                </React.Fragment>
            )}

            {/* Triple-6 bust crimson warning halo */}
            {!reduced && bustFlashKey > 0 && (
                <motion.span
                    key={`bust-${bustFlashKey}`}
                    aria-hidden="true"
                    className="dice-bust-halo"
                    initial={{ scale: 0.6, opacity: 0.95 }}
                    animate={{ scale: 2.25, opacity: 0 }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                />
            )}

            {/* Ambient Aura — steady soft glow */}
            <motion.div
                className="dice-ambient-aura rounded-full pointer-events-none"
                initial={false}
                animate={{
                    scale: visualRolling ? 0.9 : 1.25,
                    opacity: visualRolling ? 0.2 : 0.4,
                    backgroundColor: boostActive ? '#f59e0b' : accentColor,
                }}
                transition={{ duration: 0.25 }}
            />

            {/* Expanding ready pulse ring while waiting on turn roll */}
            {!reduced && !disabled && !visualRolling && !isRolling && currentValue == null && (
                <motion.span
                    className="dice-ready-ring rounded-full pointer-events-none"
                    style={{ borderColor: boostActive ? '#f59e0b' : accentColor }}
                    animate={{ scale: [0.68, 1.55], opacity: [0.85, 0] }}
                    transition={{ duration: 1.55, repeat: Infinity, ease: 'easeOut' }}
                />
            )}

            {/* Airborne Board-Inward Breakout Wrapper + Theme Flight FX + 3D Solid Cube */}
            <motion.div animate={arcControls} className="relative w-11 h-11 z-10">
                {/* Theme-native airborne aura/shadow locked underneath the flying die */}
                {visualRolling && !reduced && (
                    <>
                        {is3077 && (
                            <span
                                className="dice-air-trail-3077"
                                style={{ borderColor: accentColor }}
                                aria-hidden="true"
                            />
                        )}
                        {isRetro && (
                            <span
                                className="dice-air-trail-retro"
                                style={{ borderColor: accentColor }}
                                aria-hidden="true"
                            />
                        )}
                        {isDaybreak && (
                            <span
                                className="dice-air-shadow-daybreak"
                                aria-hidden="true"
                            />
                        )}
                    </>
                )}

                <div className="relative w-11 h-11" style={{ perspective: '760px' }}>
                    {/* The Solid Volumetric 3D Cube */}
                    <motion.div
                        className="w-full h-full relative"
                        animate={controls}
                        initial={{ rotateX: 0, rotateY: 0, rotateZ: 0 }}
                        style={{ transformStyle: 'preserve-3d' }}
                    >
                        <button
                            type="button"
                            onClick={performRoll}
                            disabled={disabled || isRolling || visualRolling}
                            aria-label={disabled ? 'Opponent dice' : 'Roll dice'}
                            className="w-full h-full relative border-none bg-transparent cursor-pointer"
                            style={{ transformStyle: 'preserve-3d' }}
                        >
                            {/* Orthogonal internal plates: make the cube 100% solid from every angle */}
                            <DiceSolidCore coreColor={diceSkin.core} />
                            {FACE_MAP.map((face, i) => (
                                <DiceFace
                                    key={i}
                                    num={face.num}
                                    transform={getFaceTransform(i)}
                                    faceColor={diceSkin.face}
                                    pipColor={diceSkin.pip}
                                    edgeColor={diceSkin.edge}
                                    shadeTint={face.shadeTint}
                                    isTacticalFace={isTacticalClassic || isOrbitalClassic}
                                    isPorcelainFace={isPorcelainClassic}
                                    readyContent={
                                        showReadyEmblem && face.num === 1 ? (
                                            <DiceReadyEmblem
                                                themeId={themeId}
                                                accentColor={accentColor}
                                                canRoll={!disabled}
                                            />
                                        ) : null
                                    }
                                />
                            ))}
                        </button>
                    </motion.div>
                </div>
            </motion.div>

            {/* Centered Absolute Drop Shadow / 3077 Emitter Pad / Retro Orbital Ring */}
            <div className="dice-ground-shadow pointer-events-none" aria-hidden="true">
                {is3077 ? (
                    <motion.div
                        className="w-9 h-1 rounded-full"
                        style={{
                            backgroundColor: accentColor,
                            boxShadow: `0 0 10px ${accentColor}`,
                        }}
                        animate={{
                            x: visualRolling ? traj.shadowOffset.x * 0.35 : 0,
                            y: visualRolling ? traj.shadowOffset.y * 0.3 : 0,
                            scale: visualRolling ? 0.68 : 1,
                            opacity: visualRolling ? 0.28 : 0.62,
                        }}
                        transition={{ duration: 0.24 }}
                    />
                ) : isRetro ? (
                    <motion.div
                        className="flex items-center justify-center"
                        animate={{
                            x: visualRolling ? traj.shadowOffset.x * 0.35 : 0,
                            y: visualRolling ? traj.shadowOffset.y * 0.3 : 0,
                            scale: visualRolling ? 0.72 : 1,
                            opacity: visualRolling ? 0.36 : 0.9,
                        }}
                        transition={{ duration: 0.24 }}
                    >
                        <svg viewBox="0 0 64 14" className="w-10 h-2.5" fill="none">
                            <ellipse
                                cx="32"
                                cy="7"
                                rx="24"
                                ry="4.2"
                                stroke={accentColor}
                                strokeWidth="1.5"
                                strokeDasharray="3 4"
                                strokeLinecap="round"
                                strokeOpacity="0.72"
                            />
                        </svg>
                    </motion.div>
                ) : isDaybreak ? (
                    <motion.div
                        className="dice-ground-shadow-daybreak rounded-full"
                        animate={{
                            x: visualRolling ? traj.shadowOffset.x * 0.4 : 0,
                            y: visualRolling ? traj.shadowOffset.y * 0.35 : 0,
                            scale: visualRolling ? 0.85 : 1,
                            opacity: visualRolling ? 0.28 : 0.52,
                        }}
                        transition={{ duration: 0.24 }}
                    />
                ) : (
                    <motion.div
                        className="w-9 h-1 rounded-full bg-black/60 blur-sm"
                        animate={{
                            scale: visualRolling ? 0.7 : 1,
                            opacity: visualRolling ? 0.3 : 0.6,
                        }}
                        transition={{ duration: 0.24 }}
                    />
                )}
            </div>
        </motion.div>
    );
}

function getFaceTransform(index: number) {
    const tz = '22px'; // Half of cube size (44px / 2 = 22px)
    return [
        `translateZ(${tz})`,                 // Front
        `rotateY(90deg) translateZ(${tz})`,   // Right
        `rotateY(180deg) translateZ(${tz})`,  // Back
        `rotateY(-90deg) translateZ(${tz})`,  // Left
        `rotateX(90deg) translateZ(${tz})`,   // Top
        `rotateX(-90deg) translateZ(${tz})`   // Bottom
    ][index];
}

function DiceSolidCore({ coreColor }: { coreColor: string }) {
    return (
        <>
            <span
                aria-hidden="true"
                className="dice-core-plane"
                style={{ backgroundColor: coreColor, transform: 'translateZ(0px)' }}
            />
            <span
                aria-hidden="true"
                className="dice-core-plane"
                style={{ backgroundColor: coreColor, transform: 'rotateY(90deg)' }}
            />
            <span
                aria-hidden="true"
                className="dice-core-plane"
                style={{ backgroundColor: coreColor, transform: 'rotateX(90deg)' }}
            />
        </>
    );
}

function DiceReadyEmblem({
    themeId,
    accentColor,
    canRoll,
}: {
    themeId: DiceThemeId;
    accentColor: string;
    canRoll: boolean;
}) {
    if (themeId === '3077') {
        return (
            <svg
                viewBox="0 0 40 40"
                className={`dice-ready-emblem ${canRoll ? 'is-live' : ''}`}
                fill="none"
                style={{ color: accentColor }}
                aria-hidden="true"
            >
                <path d="M9 13V9H13M27 9H31V13M31 27V31H27M13 31H9V27" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
                <circle cx="20" cy="20" r="8.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 2.5" opacity="0.72" />
                <polygon points="20,13 27,20 20,27 13,20" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="20" cy="20" r="2.2" fill="currentColor" />
            </svg>
        );
    }

    if (themeId === 'daybreak') {
        return (
            <svg
                viewBox="0 0 40 40"
                className={`dice-ready-emblem ${canRoll ? 'is-live' : ''}`}
                fill="none"
                style={{ color: accentColor }}
                aria-hidden="true"
            >
                <circle cx="20" cy="20" r="11" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.2" />
                <path
                    d="M20 7.5L22.9 15.8L31.5 16L24.7 21.1L27.1 29.4L20 24.4L12.9 29.4L15.3 21.1L8.5 16L17.1 15.8Z"
                    fill="currentColor"
                    fillOpacity="0.88"
                />
                <circle cx="20" cy="20" r="2.8" fill="#FAF7F0" />
            </svg>
        );
    }

    // Retro Synth Starburst
    return (
        <svg
            viewBox="0 0 40 40"
            className={`dice-ready-emblem ${canRoll ? 'is-live' : ''}`}
            fill="none"
            style={{ color: accentColor }}
            aria-hidden="true"
        >
            <circle cx="20" cy="20" r="12" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.2" strokeDasharray="8 4" />
            <path
                d="M20 7.5L22.7 17.3L32.5 20L22.7 22.7L20 32.5L17.3 22.7L7.5 20L17.3 17.3Z"
                fill="currentColor"
            />
            <circle cx="20" cy="20" r="2.4" fill="#09101E" />
        </svg>
    );
}

function DiceFace({
    num,
    transform,
    faceColor,
    pipColor,
    edgeColor = 'rgba(0,0,0,0.08)',
    shadeTint = 'transparent',
    isTacticalFace = false,
    isPorcelainFace = false,
    readyContent = null,
}: {
    num: DiceFaceNumber;
    transform: string;
    faceColor: string;
    pipColor: string;
    edgeColor?: string;
    shadeTint?: string;
    isTacticalFace?: boolean;
    isPorcelainFace?: boolean;
    readyContent?: React.ReactNode;
}) {
    return (
        <div
            className={`dice-cube-face absolute inset-0 w-11 h-11 flex items-center justify-center p-1 border ${
                isTacticalFace
                    ? 'rounded-md shadow-[inset_0_0_8px_color-mix(in_srgb,var(--accent)_18%,transparent),inset_0_1.5px_1px_rgba(255,255,255,0.2),inset_0_-2.5px_0_rgba(0,0,0,0.55)]'
                    : isPorcelainFace
                      ? 'rounded-lg shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.96),inset_0_-3px_0_rgba(28,25,23,0.14),0_2px_5px_rgba(28,25,23,0.12)]'
                      : 'rounded-lg shadow-[inset_0_-2px_4px_rgba(0,0,0,0.12),inset_0_1.5px_2px_rgba(255,255,255,0.9)]'
            }`}
            style={{
                transform,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                background: faceColor,
                borderColor: isTacticalFace || isPorcelainFace ? edgeColor : 'rgba(0,0,0,0.1)',
            }}
        >
            {shadeTint !== 'transparent' && (
                <span
                    aria-hidden="true"
                    className="dice-face-shade"
                    style={{ background: shadeTint }}
                />
            )}
            {readyContent ? (
                readyContent
            ) : (
                <svg
                    viewBox="0 0 100 100"
                    className={`w-full h-full relative z-10 ${isTacticalFace ? 'opacity-95' : 'opacity-90'}`}
                    style={
                        isTacticalFace
                            ? { filter: 'drop-shadow(0 0 3px color-mix(in srgb, var(--accent, #00E5FF) 75%, transparent))' }
                            : undefined
                    }
                >
                    {DOT_POSITIONS[num].map(([cx, cy], i) => (
                        <circle key={i} cx={cx} cy={cy} r="9.2" fill={pipColor} />
                    ))}
                </svg>
            )}
        </div>
    );
}
