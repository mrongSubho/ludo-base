'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PlayerColor } from '@/lib/types';
import {
    PROJECTILE_TTL_MS,
    type ProjectileEvent,
    type ProjectileId,
} from '@/lib/emotes';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type CornerKey = 'TL' | 'TR' | 'BL' | 'BR';

const CORNER_ANCHOR: Record<CornerKey, { xPct: number; yPct: number; x: string; y: string }> = {
    TL: { xPct: 20, yPct: 10, x: '20%', y: '10%' },
    TR: { xPct: 80, yPct: 10, x: '80%', y: '10%' },
    BL: { xPct: 20, yPct: 90, x: '20%', y: '90%' },
    BR: { xPct: 80, yPct: 90, x: '80%', y: '90%' },
};

function cornerForColor(
    uiSlots: Record<string, PlayerColor | null>,
    color: string,
): CornerKey | null {
    for (const key of ['TL', 'TR', 'BL', 'BR'] as const) {
        if (uiSlots[key] === color) return key;
    }
    return null;
}

function ProjectileArt({ id }: { id: ProjectileId }) {
    switch (id) {
        case 'emp-bomb':
            return (
                <svg viewBox="0 0 40 40" width={36} height={36} className="drop-shadow-[0_0_10px_rgba(0,229,255,0.85)]" aria-hidden="true">
                    <circle cx="20" cy="20" r="12" fill="#0B1220" stroke="#00E5FF" strokeWidth="2.5" />
                    <path d="M22 10 L15 21 H21 L18 30 L26 19 H20 Z" fill="#00E5FF" />
                </svg>
            );
        case 'holo-ghost':
            return (
                <svg viewBox="0 0 40 40" width={36} height={36} className="drop-shadow-[0_0_10px_rgba(165,243,252,0.8)]" aria-hidden="true">
                    <path
                        d="M11 31 V19 A9 9 0 0 1 29 19 V31 L24 27 L20 31 L16 27 Z"
                        fill="#082F49"
                        stroke="#A5F3FC"
                        strokeWidth="2.2"
                        strokeLinejoin="round"
                    />
                    <circle cx="16.5" cy="18" r="2" fill="#00E5FF" />
                    <circle cx="23.5" cy="18" r="2" fill="#00E5FF" />
                </svg>
            );
        case 'cryo-balloon':
            return (
                <svg viewBox="0 0 40 40" width={36} height={36} className="drop-shadow-[0_0_10px_rgba(56,189,248,0.85)]" aria-hidden="true">
                    <ellipse cx="20" cy="18" rx="11" ry="12" fill="#0C4A6E" stroke="#38BDF8" strokeWidth="2.5" />
                    <path d="M20 9 V27 M13 18 H27 M15 13 L25 23 M25 13 L15 23" stroke="#E0F2FE" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M18 30 L20 34 L22 30 Z" fill="#38BDF8" />
                </svg>
            );
        case 'plasma-pie':
            return (
                <svg viewBox="0 0 40 40" width={36} height={36} className="drop-shadow-[0_0_10px_rgba(250,204,21,0.85)]" aria-hidden="true">
                    <circle cx="20" cy="22" r="12" fill="#713F12" stroke="#FACC15" strokeWidth="2.5" />
                    <path d="M10 21 Q20 11 30 21 Q24 26 20 24 Q15 26 10 21 Z" fill="#FEF08A" />
                    <circle cx="20" cy="13" r="3" fill="#EF4444" />
                </svg>
            );
    }
}

interface BoardProjectileLayerProps {
    projectiles: ProjectileEvent[];
    uiSlots: Record<string, PlayerColor | null>;
    counterRotationDeg?: number;
}

export function BoardProjectileLayer({
    projectiles,
    uiSlots,
    counterRotationDeg = 0,
}: BoardProjectileLayerProps) {
    const reduced = useReducedMotion();
    const containerRef = useRef<HTMLDivElement>(null);
    const [boxSize, setBoxSize] = useState({ w: 600, h: 600 });

    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const measure = () => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                setBoxSize({ w: rect.width, h: rect.height });
            }
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const now = Date.now();
    const active = projectiles.filter((p) => now - p.t < PROJECTILE_TTL_MS + 250);

    return (
        <div
            ref={containerRef}
            className="pointer-events-none absolute inset-0 z-[26] overflow-visible"
            style={{
                transform: counterRotationDeg ? `rotate(${counterRotationDeg}deg)` : undefined,
            }}
            aria-hidden="true"
        >
            <AnimatePresence>
                {active.map((ev) => {
                    const fromCorner = cornerForColor(uiSlots, ev.fromColor);
                    const toCorner = cornerForColor(uiSlots, ev.toColor);
                    if (!toCorner) return null;
                    const toAnchor = CORNER_ANCHOR[toCorner];
                    const fromAnchor = fromCorner
                        ? CORNER_ANCHOR[fromCorner]
                        : { xPct: 50, yPct: 50, x: '50%', y: '50%' };

                    if (reduced) {
                        return (
                            <motion.div
                                key={ev.id}
                                data-testid={`projectile-${ev.projectileId}`}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.12 }}
                                className="absolute -translate-x-1/2 -translate-y-1/2"
                                style={{ left: toAnchor.x, top: toAnchor.y }}
                            >
                                <div className="p-1.5 rounded-full bg-black/70 border border-accent/60">
                                    <ProjectileArt id={ev.projectileId} />
                                </div>
                            </motion.div>
                        );
                    }

                    const dx = ((fromAnchor.xPct - toAnchor.xPct) / 100) * boxSize.w;
                    const dy = ((fromAnchor.yPct - toAnchor.yPct) / 100) * boxSize.h;

                    return (
                        <motion.div
                            key={ev.id}
                            data-testid={`projectile-${ev.projectileId}`}
                            initial={{
                                x: dx,
                                y: dy,
                                scale: 0.75,
                                opacity: 0.95,
                                rotate: 0,
                            }}
                            animate={{
                                x: 0,
                                y: 0,
                                scale: [0.8, 1.35, 1.15, 0.95],
                                opacity: [1, 1, 1, 0],
                                rotate: 360,
                            }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
                            className="absolute -translate-x-1/2 -translate-y-1/2"
                            style={{ left: toAnchor.x, top: toAnchor.y }}
                        >
                            <ProjectileArt id={ev.projectileId} />
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
