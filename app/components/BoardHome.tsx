import React, { useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Token } from './BoardTokens';
import { Corner, ColorCorner, CORNER_SLOTS } from '@/lib/boardLayout';

export const StarMarker = ({ color }: { color?: string }) => (
    <svg className="star-svg" viewBox="0 0 24 24" fill="currentColor" style={{ color }}>
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
    </svg>
);

export const ColoredStarMarker = ({ zoneColor }: { zoneColor: string }) => (
    <svg className="star-svg" viewBox="0 0 24 24" fill="currentColor" style={{ color: zoneColor }}>
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
    </svg>
);

export const ArrowMarker = ({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) => {
    const rotation = { right: 0, down: 90, left: 180, up: 270 }[dir];
    return (
        <svg
            className="home-arrow-svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ transform: `rotate(${rotation}deg)` }}
        >
            <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
        </svg>
    );
};

const RING_HEX: Record<string, string> = {
    green: '#00ff88',
    red: '#ff3344',
    yellow: '#ffcc00',
    blue: '#00ccff',
};

const ZONE_HEX: Record<string, string> = {
    green: '#00ff88',
    red: '#ff3344',
    yellow: '#ffcc00',
    blue: '#00ccff',
};

/**
 * Which color owns a GLOBAL shared-path cell index `g` (0..51).
 * The 52-cell perimeter is split into four 13-cell segments that start at
 * each corner's startIdx (8, 21, 34, 47 — exactly 13 apart). A cell belongs
 * to the color whose [startIdx, startIdx+13) range (mod 52) contains it.
 * This is board-geometry based, so it's viewer-independent and rotation-proof.
 */
function getOwnerColorForGlobal(g: number, cc: ColorCorner): string | null {
    const colors = Object.keys(cc) as string[];
    for (const color of colors) {
        const corner = cc[color as keyof ColorCorner] as Corner | undefined;
        if (!corner) continue;
        const sc = CORNER_SLOTS[corner].startIdx;
        const d = (g - sc + 52) % 52;
        if (d < 13) return color;
    }
    return null;
}

/**
 * Convert a raw game-state position (global SHARED_PATH index 0–51 or
 * home-lane 52–57) into the token's LOCAL step count (0–57) by subtracting
 * that color's startIdx.  This is what we display to the user.
 */
function globalToLocal(pos: number, tokenColor: string, colorCorner: ColorCorner | undefined): number {
    if (pos >= 52) return pos;                         // home lane / finish — already local
    if (!colorCorner) return pos;
    const corner = colorCorner[tokenColor as keyof ColorCorner] as Corner | undefined;
    if (!corner) return pos;
    const startIdx = CORNER_SLOTS[corner].startIdx;
    return (pos - startIdx + 52) % 52;                // 0–51 → 0–51 local
}

/**
 * Zone color for a token whose raw position is `pos` (global SHARED_PATH
 * index 0–51, or 52–57 for home lane).  Because `pos` is already a global
 * index we pass it straight to getOwnerColorForGlobal — no startIdx offset.
 */
function getZoneHex(pos: number, tokenColor: string, colorCorner: ColorCorner | undefined): string {
    if (!colorCorner) return RING_HEX[tokenColor] || '#ffffff';
    if (pos >= 52) return RING_HEX[tokenColor] || '#ffffff';   // home lane → own color
    const owner = getOwnerColorForGlobal(pos, colorCorner);
    return (owner && ZONE_HEX[owner]) || RING_HEX[tokenColor] || '#ffffff';
}

const HomeProgressRing = ({ pos, color, counterRotationDeg = 0, colorCorner, tokenColor, viewerColor }: { pos: number; color: string; counterRotationDeg?: number; colorCorner?: ColorCorner; tokenColor?: string; viewerColor?: string }) => {
    const hex = RING_HEX[color] || '#ffffff';
    const zoneHex = tokenColor && colorCorner ? getZoneHex(pos, tokenColor, colorCorner) : hex;
    const r = 20;
    const C = 2 * Math.PI * r;
    const localPos = tokenColor && colorCorner ? globalToLocal(pos, tokenColor, colorCorner) : pos;
    const pct = Math.min(Math.max(localPos, 0), 57) / 57;
    const filled = pct * C;
    const isDone = pos === 57;

    const displayIndex = localPos;

    return (
        <div className="relative w-[68%] h-[68%] flex items-center justify-center" style={{ pointerEvents: 'none' }}>
            <svg width="100%" height="100%" viewBox="0 0 48 48" className="absolute inset-0">
                <circle cx="24" cy="24" r={r} fill="none" stroke={hex} strokeOpacity="0.14" strokeWidth="4" />
                <circle
                    cx="24"
                    cy="24"
                    r={r}
                    fill="none"
                    stroke={hex}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray={`${filled} ${C - filled}`}
                    transform="rotate(-90 24 24)"
                    style={{ filter: `drop-shadow(0 0 4px ${hex}aa)`, transition: 'stroke-dasharray 0.6s ease' }}
                />
            </svg>
            {/* Text wrapper counter-rotated so it stays upright for user */}
            <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ transform: `rotate(${counterRotationDeg}deg)` }}
            >
                <motion.span
                    key={isDone ? 'done' : `${displayIndex}-${zoneHex}`}
                    initial={isDone ? { scale: 0 } : undefined}
                    animate={isDone ? { scale: [0, 1.4, 1] } : { scale: 1 }}
                    transition={isDone ? { duration: 0.5, times: [0, 0.6, 1], ease: 'easeOut' } : undefined}
                    className="tabular-nums font-extrabold leading-none"
                    style={{
                        color: zoneHex,
                        fontSize: isDone ? '14px' : '9px',
                        textShadow: `0 0 6px ${zoneHex}`,
                        display: 'inline-block',
                    }}
                >
                    {isDone ? '✓' : `${displayIndex}`}
                </motion.span>
            </div>
        </div>
    );
};

interface HomeBlockProps {
    color: 'green' | 'red' | 'yellow' | 'blue';
    corner: Corner;
    gridRow: string;
    gridCol: string;
    tokensInHome: number[];
    finishedTokens?: number[];
    positions?: number[];
    colorCorner?: ColorCorner;
    viewerColor?: string;
    onTokenClick: (tokenIndex: number) => void;
    isDraggable?: boolean;
    counterRotationDeg?: number;
    diceValue?: number | null;
    gamePhase?: string;
    currentPlayer?: string;
}

export function HomeBlock({
    color,
    corner,
    gridRow,
    gridCol,
    tokensInHome,
    finishedTokens = [],
    positions = [],
    colorCorner,
    viewerColor,
    onTokenClick,
    isDraggable,
    counterRotationDeg = 0,
    diceValue = null,
    gamePhase = 'rolling',
    currentPlayer = ''
}: HomeBlockProps) {
    const prevFinishedRef = useRef<number>(finishedTokens.length);
    const padRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (finishedTokens.length > prevFinishedRef.current) {
            const el = padRef.current;
            if (el) {
                const rect = el.getBoundingClientRect();
                const x = (rect.left + rect.width / 2) / window.innerWidth;
                const y = (rect.top + rect.height / 2) / window.innerHeight;
                const colorMap: Record<string, [number, number, number]> = {
                    green: [16, 185, 129],
                    red: [239, 68, 68],
                    yellow: [245, 158, 11],
                    blue: [59, 130, 246],
                };
                const rgb = colorMap[color] || [255, 255, 255];
                confetti({
                    particleCount: 60,
                    spread: 70,
                    origin: { x, y },
                    colors: [`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, '#ffffff'],
                    startVelocity: 30,
                    gravity: 0.8,
                    scalar: 0.9,
                    drift: 0,
                    ticks: 80,
                });
            }
        }
        prevFinishedRef.current = finishedTokens.length;
    }, [finishedTokens, color]);

    return (
        <div
            className={`board-home ${color}`}
            data-corner={corner}
            style={{ gridRow, gridColumn: gridCol }}
        >
            <div className="home-pad" ref={padRef}>
                {[0, 1, 2, 3].map((idx) => {
                    const isFinished = finishedTokens.includes(idx);
                    const isInHome = tokensInHome.includes(idx);
                    const isPlayerTurn = currentPlayer === color && gamePhase === 'moving';
                    const isValidHome = isInHome && isPlayerTurn && diceValue === 6;
                    return (
                        <div key={idx} className={`token-dot-wrapper ${isPlayerTurn && isInHome && !isValidHome ? 'token-home-invalid' : ''}`}>
                            {isInHome && (
                                <Token
                                    color={color}
                                    onClick={() => onTokenClick(idx)}
                                    isDraggable={isDraggable}
                                    isValidMove={isValidHome}
                                    counterRotationDeg={counterRotationDeg}
                                    pos={-1}
                                />
                            )}
                            {isFinished && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <HomeProgressRing pos={57} color={color} counterRotationDeg={counterRotationDeg} colorCorner={colorCorner} tokenColor={color} />
                                </div>
                            )}
                            {!isInHome && !isFinished && (
                                (() => {
                                    const pos = positions[idx];
                                    const onTrack = typeof pos === 'number' && pos >= 0 && pos <= 56;
                                    const isDone = typeof pos === 'number' && pos === 57;
                                    if (onTrack || isDone) {
                                        return <HomeProgressRing pos={pos} color={color} counterRotationDeg={counterRotationDeg} colorCorner={colorCorner} tokenColor={color} viewerColor={viewerColor} />;
                                    }
                                    return <span className="token-dot-placeholder" />;
                                })()
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
