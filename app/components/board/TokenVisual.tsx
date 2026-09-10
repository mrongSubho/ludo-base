"use client";
import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { PlayerColor } from '@/lib/types';
import { Point, getBoardCoordinate, ColorCorner, CORNER_SLOTS } from '@/lib/boardLayout';
import { ChessRank, ChessPiece, COLOR_PIECE, RANK_ORDER, shade } from '../ChessTokens';

function alphaHex(hex: string, a: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ── Promotion FX: expanding glow ring + flash + radial sparkles ── */
const PromoFX = ({ color }: { color: string }) => {
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

const colorMapSafe = (color: string): string => {
    const map: Record<string, string> = { green: '#10b981', red: '#ef4444', yellow: '#eab308', blue: '#3b82f6' };
    return map[color] || '#10b981';
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
}

export function Token({
    color,
    onClick,
    isDraggable,
    isValidMove = false,
    count = 1,
    isBlockade = false,
    counterRotationDeg = 0,
    rank = 'Pawn',
    pos = -1,
    skipRotation = false,
    shielded = false,
    targetable = false,
    boosted = false,
}: TokenProps) {
    const prevRef = useRef<{ rank: ChessRank; pos: number } | null>(null);
    const [showPromoFX, setShowPromoFX] = React.useState(false);

    React.useEffect(() => {
        const prev = prevRef.current;
        prevRef.current = { rank, pos };
        if (!prev) return;
        if (RANK_ORDER[rank] > RANK_ORDER[prev.rank as ChessRank]) {
            setShowPromoFX(true);
            const t = setTimeout(() => setShowPromoFX(false), 750);
            return () => clearTimeout(t);
        }
    }, [rank, pos]);

    const showValid = !!isValidMove && !!isDraggable;
    const isDimmed = !showValid && !!isDraggable && pos !== -1 && pos !== 57;
    // isDraggable is true when it's my turn & phase moving, but token can't actually move -> dim
    const shouldDim = isDraggable && !isValidMove;
    return (
        <motion.div
            initial={false}
            style={{
                rotate: skipRotation ? 0 : counterRotationDeg,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            className={`ludo-token ${color}-token ${isBlockade ? 'token-blockade' : ''} ${shouldDim ? 'token-dimmed' : ''} ${shielded ? 'token-shielded' : ''} ${targetable ? 'token-targetable' : ''} ${boosted ? 'token-boosted' : ''}`}
            onClick={onClick}
            // "Premium" Hover: Higher scale + lift + subtle bloom
            whileHover={isDraggable ? {
                scale: 1.25,
                y: -6,
                filter: 'brightness(1.1) drop-shadow(0px 8px 15px rgba(0,0,0,0.4))',
                transition: { duration: 0.15, ease: "easeOut" }
            } : { scale: 1.1 }}
            whileTap={{ scale: 0.9, y: 0 }}
        >
            {/* Pulse wrapper: draggable pulse lives here so CSS transform
                can never wipe the root's counter-rotation */}
            <div
                className={isDraggable ? 'ludo-token-pulse' : ''}
                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
            <AnimatePresence mode="wait">
                <motion.div
                    key={rank}
                    initial={{ y: 26, scale: 0.4, opacity: 0, filter: 'brightness(280%)' }}
                    animate={{ y: 0, scale: [1.18, 0.96, 1], opacity: 1, filter: 'brightness(100%)' }}
                    exit={{
                        y: 30, scale: 0.3, rotate: -20, opacity: 0,
                        filter: 'blur(5px) brightness(65%)',
                        transition: { duration: 0.32, ease: 'backIn' }
                    }}
                    transition={{
                        y: { type: "spring", stiffness: 520, damping: 24 },
                        scale: { duration: 0.42, times: [0, 0.6, 1], ease: "easeOut" },
                        opacity: { duration: 0.16 },
                        filter: { duration: 0.5, ease: 'easeOut' },
                    }}
                    className="w-full h-full flex items-center justify-center p-0.5 relative"
                >
                    <ChessPiece color={color} rank={rank} size="board" />
                    {showPromoFX && <PromoFX color={color} />}
                    {showValid && (
                        <div className="token-valid-arrow" style={{ color: colorMapSafe(color) }}>
                            <motion.div
                                animate={{ y: [0, -6, 0] }}
                                transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                            >
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <path d="M7 12.5 L3 8.5 L4.2 7.3 L6.2 9.3 L6.2 1.5 L7.8 1.5 L7.8 9.3 L9.8 7.3 L11 8.5 Z" fill="currentColor" />
                                </svg>
                            </motion.div>
                        </div>
                    )}
                </motion.div>
            </AnimatePresence>
            </div>
            {isBlockade && <div className="blockade-glow" />}
        </motion.div>
    );
}

/* ── Capture shatter: shards bursting from the last board cell ── */
const ShatterFX = ({ pt, color }: { pt: Point; color: PlayerColor }) => {
    const base = colorMapSafe(color);
    const light = shade(base, 45);
    const shards = [
        { x: -24, y: 26, r: -140, s: 9 },
        { x: 22, y: 32, r: 120, s: 11 },
        { x: -8, y: 38, r: 200, s: 7 },
        { x: 14, y: 22, r: -90, s: 8 },
        { x: 0, y: 44, r: 160, s: 10 },
    ];
    return (
        <div className="absolute inset-0 pointer-events-none z-[60]" style={{ gridRow: pt.r, gridColumn: pt.c }}>
            {shards.map((sh, i) => (
                <motion.span
                    key={i}
                    className="absolute left-1/2 top-1/2"
                    style={{
                        width: sh.s, height: sh.s,
                        background: `linear-gradient(135deg, ${light}, ${base})`,
                        clipPath: 'polygon(50% 0, 100% 70%, 20% 100%)',
                        boxShadow: `0 0 6px ${alphaHex(base, 0.8)}`,
                    }}
                    initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 1, rotate: 0 }}
                    animate={{ x: `calc(-50% + ${sh.x}px)`, y: `calc(-50% + ${sh.y}px)`, opacity: 0, scale: 0.5, rotate: sh.r }}
                    transition={{ duration: 0.55, ease: 'easeIn', delay: i * 0.03 }}
                />
            ))}
            <motion.div
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{ width: 26, height: 26, marginLeft: -13, marginTop: -13, border: `2px solid ${light}` }}
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
            />
        </div>
    );
};

/* ── Finish starburst: glow ring + sparkles when a token reaches the end ── */
const FinishFX = ({ pt, color }: { pt: Point; color: PlayerColor }) => {
    const base = colorMapSafe(color);
    const light = shade(base, 50);
    const sparkles = [
        { x: -18, y: -20, s: 4, delay: 0 },
        { x: 16, y: -16, s: 3, delay: 0.04 },
        { x: -10, y: 18, s: 3.5, delay: 0.08 },
        { x: 20, y: 10, s: 4, delay: 0.02 },
        { x: 0, y: -22, s: 3, delay: 0.06 },
        { x: -20, y: 0, s: 3.5, delay: 0.1 },
    ];
    return (
        <div className="absolute inset-0 pointer-events-none z-[60]" style={{ gridRow: pt.r, gridColumn: pt.c }}>
            {/* Expanding glow ring */}
            <motion.div
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{
                    width: 24, height: 24, marginLeft: -12, marginTop: -12,
                    border: `2px solid ${light}`,
                    boxShadow: `0 0 12px ${base}, 0 0 24px ${alphaHex(base, 0.4)}`,
                }}
                initial={{ scale: 0.3, opacity: 1 }}
                animate={{ scale: 2.5, opacity: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
            />
            {/* Star sparkle particles */}
            {sparkles.map((sp, i) => (
                <motion.span
                    key={i}
                    className="absolute left-1/2 top-1/2"
                    style={{
                        width: sp.s, height: sp.s,
                        background: light,
                        borderRadius: '50%',
                        boxShadow: `0 0 6px ${light}`,
                    }}
                    initial={{ x: '-50%', y: '-50%', opacity: 1, scale: 1 }}
                    animate={{
                        x: `calc(-50% + ${sp.x}px)`,
                        y: `calc(-50% + ${sp.y}px)`,
                        opacity: 0,
                        scale: 0.2,
                    }}
                    transition={{ duration: 0.55, ease: 'easeOut', delay: sp.delay }}
                />
            ))}
            {/* Central flash */}
            <motion.div
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{
                    width: 14, height: 14, marginLeft: -7, marginTop: -7,
                    background: `radial-gradient(circle, #ffffff, ${light})`,
                    boxShadow: `0 0 16px ${light}`,
                }}
                initial={{ scale: 0.2, opacity: 1 }}
                animate={{ scale: 2, opacity: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
            />
        </div>
    );
};

/* ── Capture run-home: a ghost token sprints backwards along the track ── */
const RunHomeGhost = ({ color, fromPos, cc, counterRotationDeg, onDone }: {
    color: PlayerColor;
    fromPos: number;
    cc: ColorCorner;
    counterRotationDeg: number;
    onDone: () => void;
}) => {
    const travelRef = React.useRef<HTMLDivElement | null>(null);
    const hopRef = React.useRef<HTMLDivElement | null>(null);
    // Stable callback: onDone gets a new identity every parent render, and
    // listing it in deps would restart (loop) the timeline forever.
    const doneRef = React.useRef(onDone);
    doneRef.current = onDone;

    React.useEffect(() => {
        const corner = cc[color];
        const startIdx = corner ? CORNER_SLOTS[corner].startIdx : 0;
        const startPt = getBoardCoordinate(startIdx, color, cc);
        const g = travelRef.current;
        if (!startPt || !g || !hopRef.current) { doneRef.current(); return; }

        // Reverse index walk: capture cell -> ... -> home entry cell
        const idxs: number[] = [];
        if (fromPos >= 52) {
            for (let i = fromPos; i >= 52; i--) idxs.push(i);
            const gate = (startIdx + 50) % 52;
            idxs.push(gate);
            for (let i = gate - 1; i >= startIdx; i--) idxs.push(i);
        } else {
            for (let i = fromPos; i >= startIdx; i--) idxs.push(i);
        }
        const cells = idxs
            .map(i => getBoardCoordinate(i, color, cc))
            .filter((p): p is Point => !!p);
        if (cells.length < 2) { doneRef.current(); return; }

        const xP = cells.map(p => (p.c - startPt.c) * 100);
        const yP = cells.map(p => (p.r - startPt.r) * 100);
        const m = cells.length - 1;
        const step = Math.min(0.09, 2.2 / m); // fast run, bounded total time

        gsap.set(travelRef.current, { xPercent: xP[0], yPercent: yP[0] });
        const tl = gsap.timeline({ onComplete: () => doneRef.current() });
        for (let i = 0; i < m; i++) {
            const t0 = i * step;
            tl.to(travelRef.current, { xPercent: xP[i + 1], yPercent: yP[i + 1], duration: step, ease: 'none' }, t0);
            tl.to(hopRef.current, { y: -12, duration: step * 0.4, ease: 'power2.out' }, t0)
              .to(hopRef.current, { y: 0, duration: step * 0.6, ease: 'power2.in' }, t0 + step * 0.4);
        }
        // dive into the base pad
        tl.to(hopRef.current, { opacity: 0, scale: 0.35, duration: 0.2, ease: 'power2.in' }, '>-=0.02');
        return () => { tl.kill(); };
    }, [color, fromPos, cc]);

    const corner = cc[color];
    const startPt = corner ? getBoardCoordinate(CORNER_SLOTS[corner].startIdx, color, cc) : null;
    if (!startPt) return null;
    return (
        <div
            style={{
                gridRow: startPt.r, gridColumn: startPt.c,
                width: '100%', height: '100%',
                position: 'relative', zIndex: 80, pointerEvents: 'none',
            }}
        >
            <div ref={travelRef} style={{ width: '100%', height: '100%' }}>
                <div
                    style={{
                        width: '100%', height: '100%',
                        transform: `rotate(${counterRotationDeg}deg)`,
                    }}
                >
                    <div
                        ref={hopRef}
                        className={`ludo-token ${color}-token`}
                        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <ChessPiece color={color} size="board" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export { ShatterFX, RunHomeGhost, FinishFX, colorMapSafe, alphaHex };
