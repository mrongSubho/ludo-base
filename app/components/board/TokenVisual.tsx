"use client";
import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { PlayerColor } from '@/lib/types';
import { Point, ColorCorner } from '@/lib/boardLayout';
import { prefersReducedMotion } from '@/lib/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { computeReverseTrackCoords } from '@/lib/tokenMovement';
import type { AnimationBarrier } from '@/lib/animationBarrier';
import { ChessRank, ChessPiece, RANK_ORDER, shade } from '../ChessTokens';

function alphaHex(hex: string, a: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const colorMapSafe = (color: string): string => {
    const map: Record<string, string> = { green: '#10b981', red: '#ef4444', yellow: '#eab308', blue: '#3b82f6' };
    return map[color] || '#10b981';
};

/* ── Promotion FX: expanding glow ring + flash + radial sparkles ── */
const PromoFX = ({ color }: { color: string }) => {
    const reduced = useReducedMotion();
    if (reduced) return null;
    const light = shade(colorMapSafe(color), 55);
    return (
        <>
            <motion.div
                className="absolute inset-0 pointer-events-none rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 60%)' }}
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
            />
            <motion.div
                className="absolute inset-[-30%] pointer-events-none rounded-full"
                style={{ border: `2.5px solid ${light}`, boxShadow: `0 0 14px ${light}, inset 0 0 10px ${alphaHex(light, 0.5)}` }}
                initial={{ scale: 0.35, opacity: 0.95 }}
                animate={{ scale: 2.15, opacity: 0 }}
                transition={{ duration: 0.65, ease: 'easeOut' }}
            />
            {Array.from({ length: 8 }).map((_, i) => {
                const ang = ((i * 45) + 15) * (Math.PI / 180);
                const dist = i % 2 === 0 ? 44 : 32;
                return (
                    <motion.span
                        key={i}
                        className="absolute left-1/2 top-1/2 pointer-events-none"
                        style={{
                            width: 7, height: 7,
                            background: '#ffffff',
                            boxShadow: `0 0 7px ${light}`,
                            clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                        }}
                        initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 0.4, rotate: 0 }}
                        animate={{
                            x: `calc(-50% + ${Math.cos(ang) * dist}px)`,
                            y: `calc(-50% + ${Math.sin(ang) * dist}px)`,
                            opacity: 0, scale: 1.05, rotate: 170,
                        }}
                        transition={{ duration: 0.62, ease: 'easeOut', delay: i * 0.02 }}
                    />
                );
            })}
        </>
    );
};

interface TokenProps {
    color: string;
    onClick?: () => void;
    isDraggable?: boolean;
    isValidMove?: boolean;
    count?: number;
    isBlockade?: boolean;
    counterRotationDeg?: number;
    rank?: ChessRank;
    pos?: number;
    skipRotation?: boolean;
    shielded?: boolean;
    targetable?: boolean;
    boosted?: boolean;
    boostArmed?: boolean;
}

export function Token({
    color,
    onClick,
    isDraggable,
    isValidMove = false,
    count: _count = 1,
    isBlockade = false,
    counterRotationDeg = 0,
    rank = 'Pawn',
    pos = -1,
    skipRotation = false,
    shielded = false,
    targetable = false,
    boosted = false,
    boostArmed = false,
}: TokenProps) {
    const prevRef = useRef<{ rank: ChessRank; pos: number } | null>(null);
    const [showPromoFX, setShowPromoFX] = React.useState(false);
    const reduced = useReducedMotion();

    React.useEffect(() => {
        const prev = prevRef.current;
        prevRef.current = { rank, pos };
        if (!prev || prefersReducedMotion()) return;
        if (RANK_ORDER[rank] > RANK_ORDER[prev.rank as ChessRank]) {
            setShowPromoFX(true);
            const t = setTimeout(() => setShowPromoFX(false), 750);
            return () => clearTimeout(t);
        }
    }, [rank, pos]);

    const showValid = !!isValidMove && !!isDraggable;
    const shouldDim = !!isDraggable && !isValidMove;
    const factionHex = colorMapSafe(color);

    return (
        <motion.div
            initial={false}
            style={{
                rotate: skipRotation ? 0 : counterRotationDeg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
            className={`token-stage relative w-full h-full ${showValid ? 'is-valid-stage' : ''}`}
            onClick={onClick}
            whileHover={showValid ? {
                scale: 1.24,
                y: -6,
                filter: 'brightness(1.1) drop-shadow(0px 8px 15px rgba(0,0,0,0.4))',
                transition: { duration: 0.15, ease: 'easeOut' },
            } : { scale: 1.06 }}
            whileTap={showValid ? { scale: 0.9, y: 0 } : undefined}
        >
            {/* Unclipped orbital beacons live outside `.ludo-token` so orb mode never hides SVGs or clips rings */}
            {showValid && (
                <>
                    <span
                        className="token-valid-halo"
                        style={{ color: factionHex }}
                        aria-hidden="true"
                    />
                    <span
                        className="token-valid-ring"
                        style={{ color: factionHex, borderColor: factionHex }}
                        aria-hidden="true"
                    />
                </>
            )}

            {shielded && (
                <>
                    <span className="token-shield-field" aria-hidden="true">
                        <span className="token-shield-dome" />
                        <svg viewBox="0 0 36 36" fill="none" className="token-shield-ring">
                            <circle
                                cx="18"
                                cy="18"
                                r="16"
                                stroke="#22d3ee"
                                strokeWidth="1.9"
                                strokeDasharray="5.2 2.4"
                            />
                            <path
                                d="M8.5 9.5A12.5 12.5 0 0 1 21 5.8"
                                stroke="#ecfeff"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                opacity="0.92"
                            />
                        </svg>
                        <svg viewBox="0 0 36 36" fill="none" className="token-shield-hex">
                            <polygon
                                points="18,3.2 30.8,10.6 30.8,25.4 18,32.8 5.2,25.4 5.2,10.6"
                                stroke="#a5f3fc"
                                strokeWidth="1.25"
                                opacity="0.88"
                            />
                        </svg>
                    </span>
                    <span className="token-shield-badge" aria-hidden="true">
                        <svg viewBox="0 0 16 16" fill="none" className="token-shield-badge-svg">
                            <path
                                d="M8 1.5L13.5 3.6V7.7C13.5 11.1 11.2 13.8 8 14.8C4.8 13.8 2.5 11.1 2.5 7.7V3.6L8 1.5Z"
                                fill="#06b6d4"
                                stroke="#ecfeff"
                                strokeWidth="1.25"
                                strokeLinejoin="round"
                            />
                            <path
                                d="M8 4.4L10.4 7.2L8 10.6L5.6 7.2L8 4.4Z"
                                fill="#ecfeff"
                                opacity="0.95"
                            />
                        </svg>
                    </span>
                </>
            )}

            {(boostArmed || boosted) && !shielded && (
                <span className="token-boost-aura" aria-hidden="true">
                    <svg viewBox="0 0 36 36" fill="none" className="token-boost-arc">
                        <circle
                            cx="18"
                            cy="18"
                            r="15"
                            stroke="#f59e0b"
                            strokeWidth="1.8"
                            strokeDasharray="7 5"
                        />
                    </svg>
                </span>
            )}

            {/* Pulse wrapper: strictly gates on `showValid` so dimmed tokens never pulse */}
            <div className={`${showValid ? 'ludo-token-pulse ' : ''}w-full h-full flex items-center justify-center`}>
                <div
                    className={`ludo-token ${color}-token ${showValid ? 'token-valid' : ''} ${isBlockade ? 'token-blockade' : ''} ${shouldDim ? 'token-dimmed' : ''} ${shielded ? 'token-shielded' : ''} ${targetable ? 'token-targetable' : ''} ${boosted ? 'token-boosted' : ''}`}
                >
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={rank}
                            initial={{ y: 26, scale: 0.4, opacity: 0, filter: 'brightness(280%)' }}
                            animate={{ y: 0, scale: [1.18, 0.96, 1], opacity: 1, filter: 'brightness(100%)' }}
                            exit={{
                                y: 30,
                                scale: 0.3,
                                rotate: -20,
                                opacity: 0,
                                filter: 'blur(5px) brightness(65%)',
                                transition: { duration: 0.32, ease: 'backIn' },
                            }}
                            transition={{
                                y: { type: 'spring', stiffness: 520, damping: 24 },
                                scale: { duration: 0.42, times: [0, 0.6, 1], ease: 'easeOut' },
                                opacity: { duration: 0.16 },
                                filter: { duration: 0.5, ease: 'easeOut' },
                            }}
                            className="w-full h-full flex items-center justify-center p-0.5 relative"
                        >
                            <ChessPiece color={color} rank={rank} size="board" />
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>

            {showPromoFX && <PromoFX color={color} />}
            {showValid && (
                <div className="token-valid-arrow" style={{ color: factionHex }}>
                    <motion.div
                        animate={reduced ? { y: 0 } : { y: [0, -6, 0] }}
                        transition={reduced ? { duration: 0.01 } : { duration: 0.85, repeat: Infinity, ease: 'easeInOut' }}
                    >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M7 12.5 L3 8.5 L4.2 7.3 L6.2 9.3 L6.2 1.5 L7.8 1.5 L7.8 9.3 L9.8 7.3 L11 8.5 Z" fill="currentColor" />
                        </svg>
                    </motion.div>
                </div>
            )}
            {isBlockade && <div className="blockade-glow" />}
        </motion.div>
    );
}

/* ── Capture shatter: impact flash + expanding ring + flying shards ── */
const ShatterFX = ({ pt, color }: { pt: Point; color: PlayerColor }) => {
    const reduced = useReducedMotion();
    if (reduced) return null;
    const base = colorMapSafe(color);
    const light = shade(base, 48);
    const shards = [
        { x: -26, y: -18, r: -145, s: 9 },
        { x: 24, y: -14, r: 125, s: 11 },
        { x: -16, y: 26, r: 195, s: 8 },
        { x: 20, y: 24, r: -95, s: 9 },
        { x: 0, y: -28, r: 160, s: 10 },
        { x: 4, y: 30, r: -165, s: 8 },
    ];
    return (
        <div className="absolute inset-0 pointer-events-none z-[72]" style={{ gridRow: pt.r, gridColumn: pt.c }}>
            <motion.div
                className="absolute left-1/2 top-1/2 rounded-full w-[18px] h-[18px] -ml-[9px] -mt-[9px]"
                style={{
                    background: `radial-gradient(circle, #ffffff 10%, ${light} 65%, transparent 100%)`,
                    boxShadow: `0 0 14px ${light}`,
                }}
                initial={{ scale: 0.35, opacity: 1 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
            />
            {shards.map((sh, i) => (
                <motion.span
                    key={i}
                    className="absolute left-1/2 top-1/2"
                    style={{
                        width: sh.s,
                        height: sh.s,
                        background: `linear-gradient(135deg, ${light}, ${base})`,
                        clipPath: 'polygon(50% 0, 100% 70%, 20% 100%)',
                        boxShadow: `0 0 6px ${alphaHex(base, 0.8)}`,
                    }}
                    initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 1, rotate: 0 }}
                    animate={{ x: `calc(-50% + ${sh.x}px)`, y: `calc(-50% + ${sh.y}px)`, opacity: 0, scale: 0.45, rotate: sh.r }}
                    transition={{ duration: 0.52, ease: 'easeOut', delay: i * 0.025 }}
                />
            ))}
            <motion.div
                className="absolute left-1/2 top-1/2 rounded-full w-[28px] h-[28px] -ml-[14px] -mt-[14px]"
                style={{ border: `2.5px solid ${light}` }}
                initial={{ scale: 0.35, opacity: 0.95 }}
                animate={{ scale: 2.1, opacity: 0 }}
                transition={{ duration: 0.42, ease: 'easeOut' }}
            />
        </div>
    );
};

/* ── Finish starburst: centered 3x3 Finish Junction celebration (dual rings, sparkles & crest) ── */
const FinishFX = ({
    pt: _pt,
    color,
    counterRotationDeg = 0,
}: {
    pt?: Point;
    color: PlayerColor;
    counterRotationDeg?: number;
}) => {
    const reduced = useReducedMotion();
    if (reduced) return null;
    const base = colorMapSafe(color);
    const light = shade(base, 52);
    const confettiColors = [light, '#fbbf24', '#38bdf8', '#ffffff'];
    const sparkles = [
        { x: -34, y: -30, s: 7, c: confettiColors[0], r: 140, delay: 0 },
        { x: 32, y: -28, s: 6, c: confettiColors[1], r: -120, delay: 0.03 },
        { x: -24, y: 28, s: 7, c: confettiColors[2], r: 180, delay: 0.05 },
        { x: 30, y: 24, s: 6, c: confettiColors[3], r: -160, delay: 0.02 },
        { x: 0, y: -42, s: 7, c: confettiColors[1], r: 90, delay: 0.04 },
        { x: -40, y: 0, s: 6, c: confettiColors[0], r: -95, delay: 0.06 },
        { x: 40, y: 2, s: 7, c: confettiColors[2], r: 125, delay: 0.03 },
        { x: 4, y: 38, s: 6, c: confettiColors[1], r: -140, delay: 0.07 },
        { x: -18, y: -38, s: 5, c: confettiColors[3], r: 200, delay: 0.05 },
        { x: 22, y: -36, s: 5, c: confettiColors[0], r: -210, delay: 0.08 },
    ];

    return (
        <div
            className="absolute inset-0 pointer-events-none z-[75] flex items-center justify-center"
            style={{
                gridRow: '7 / 10',
                gridColumn: '7 / 10',
                transform: `rotate(${counterRotationDeg}deg)`,
            }}
        >
            {/* Primary & secondary shockwave rings */}
            <motion.div
                className="absolute rounded-full w-[38px] h-[38px]"
                style={{
                    border: `3px solid ${light}`,
                    boxShadow: `0 0 18px ${base}, inset 0 0 12px ${alphaHex(light, 0.55)}`,
                }}
                initial={{ scale: 0.35, opacity: 1 }}
                animate={{ scale: 2.8, opacity: 0 }}
                transition={{ duration: 0.65, ease: 'easeOut' }}
            />
            <motion.div
                className="absolute rounded-full w-[30px] h-[30px]"
                style={{
                    border: '2px solid #fbbf24',
                    boxShadow: '0 0 14px rgba(251,191,36,0.7)',
                }}
                initial={{ scale: 0.25, opacity: 0.95 }}
                animate={{ scale: 2.3, opacity: 0 }}
                transition={{ duration: 0.52, ease: 'easeOut', delay: 0.07 }}
            />

            {/* Radial confetti shards */}
            {sparkles.map((sp, i) => (
                <motion.span
                    key={i}
                    className="absolute left-1/2 top-1/2"
                    style={{
                        width: sp.s,
                        height: sp.s,
                        background: sp.c,
                        clipPath: i % 2 === 0 ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : 'circle(50%)',
                        boxShadow: `0 0 8px ${sp.c}`,
                    }}
                    initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 0.5, rotate: 0 }}
                    animate={{
                        x: `calc(-50% + ${sp.x}px)`,
                        y: `calc(-50% + ${sp.y}px)`,
                        opacity: 0,
                        scale: 1.05,
                        rotate: sp.r,
                    }}
                    transition={{ duration: 0.66, ease: 'easeOut', delay: sp.delay }}
                />
            ))}

            {/* Celebratory crest pop */}
            <motion.div
                className="finish-fx-crest"
                style={{ borderColor: light, color: '#ffffff' }}
                initial={{ scale: 0.3, opacity: 0, y: 8 }}
                animate={{ scale: [0.3, 1.18, 1], opacity: [0, 1, 1, 0], y: [8, -4, -14, -22] }}
                transition={{ duration: 0.78, times: [0, 0.24, 0.68, 1], ease: 'easeOut' }}
            >
                HOME!
            </motion.div>
        </div>
    );
};

/* ── Capture run-home: ghost token sprints backwards along modular track directly into Yard slot ── */
const RunHomeGhost = ({
    color,
    fromPos,
    tokenIndex = 0,
    cc,
    counterRotationDeg,
    animationBarrier,
    onDone,
}: {
    color: PlayerColor;
    fromPos: number;
    tokenIndex?: number;
    cc: ColorCorner;
    counterRotationDeg: number;
    animationBarrier?: AnimationBarrier;
    onDone: () => void;
}) => {
    const travelRef = React.useRef<HTMLDivElement | null>(null);
    const hopRef = React.useRef<HTMLDivElement | null>(null);
    const doneRef = React.useRef(onDone);
    doneRef.current = onDone;
    const barrierRef = React.useRef(animationBarrier);
    barrierRef.current = animationBarrier;

    const anchorPt = React.useMemo(() => {
        const coords = computeReverseTrackCoords(fromPos, color, tokenIndex, cc);
        return coords[0] ?? null;
    }, [fromPos, color, tokenIndex, cc]);

    React.useEffect(() => {
        const cells = computeReverseTrackCoords(fromPos, color, tokenIndex, cc);
        const startPt = cells[0];
        if (!startPt || cells.length < 2 || !travelRef.current || !hopRef.current) {
            doneRef.current();
            return;
        }

        const xP = cells.map((p) => (p.c - startPt.c) * 100);
        const yP = cells.map((p) => (p.r - startPt.r) * 100);
        const m = cells.length - 1;
        const step = Math.min(0.024, 0.44 / m);

        gsap.set(travelRef.current, { xPercent: xP[0], yPercent: yP[0] });

        if (prefersReducedMotion()) {
            gsap.set(travelRef.current, { xPercent: xP[m], yPercent: yP[m] });
            gsap.set(hopRef.current, { y: 0, opacity: 0, scale: 0.35 });
            doneRef.current();
            return () => {};
        }

        const lockName = `rewind:${color}-${tokenIndex}`;
        barrierRef.current?.acquireLock(lockName, Math.round(m * step * 1000) + 140);
        let finished = false;
        const releaseLock = () => {
            if (finished) return;
            finished = true;
            barrierRef.current?.releaseLock(lockName);
        };

        const tl = gsap.timeline({
            onComplete: () => {
                releaseLock();
                doneRef.current();
            },
        });
        getSoundEngine().play('run_home_sprint');
        for (let i = 0; i < m; i++) {
            const t0 = i * step;
            tl.to(travelRef.current, { xPercent: xP[i + 1], yPercent: yP[i + 1], duration: step, ease: 'none' }, t0);
            tl.to(hopRef.current, { y: i === m - 1 ? -18 : -10, duration: step * 0.42, ease: 'power2.out' }, t0)
                .to(hopRef.current, { y: 0, duration: step * 0.58, ease: 'power2.in' }, t0 + step * 0.42);
        }
        tl.to(hopRef.current, { opacity: 0, scale: 0.35, duration: 0.14, ease: 'power2.in' }, '>-=0.04');
        return () => {
            tl.kill();
            releaseLock();
        };
    }, [color, fromPos, tokenIndex, cc]);

    if (!anchorPt) return null;

    return (
        <div
            style={{
                gridRow: anchorPt.r,
                gridColumn: anchorPt.c,
                width: '100%',
                height: '100%',
                position: 'relative',
                zIndex: 80,
                pointerEvents: 'none',
            }}
        >
            <div ref={travelRef} className="w-full h-full">
                <div
                    className="w-full h-full"
                    style={{
                        transform: `rotate(${counterRotationDeg}deg)`,
                    }}
                >
                    <div
                        ref={hopRef}
                        className={`ludo-token ${color}-token relative w-full h-full flex items-center justify-center`}
                    >
                        <ChessPiece color={color} size="board" />
                        <span
                            className="token-ghost-tag absolute -top-3.5 left-1/2 -translate-x-1/2 px-1 py-0.5 text-ludo-xs font-mono font-bold rounded bg-surface-panel text-accent border border-accent/50 shadow-sm pointer-events-none animate-bounce"
                        >
                            (T_T)
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export { ShatterFX, RunHomeGhost, FinishFX, colorMapSafe, alphaHex };
