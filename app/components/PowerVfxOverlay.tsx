'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { prefersReducedMotion } from '@/lib/motion';
import type { Point } from '@/lib/boardLayout';
import type { PlayerColor } from '@/lib/types';
import type { PowerVfxEvent } from '@/lib/powerVfx';

const TELEPORT_ACCENT: Record<PlayerColor, string> = {
    green: '#10b981',
    red: '#ef4444',
    yellow: '#f59e0b',
    blue: '#3b82f6',
};

const TELEPORT_SPARKS = [
    { dx: -16, dy: -16, rot: -135 },
    { dx: 16, dy: -14, rot: 120 },
    { dx: -18, dy: 8, rot: -75 },
    { dx: 18, dy: 10, rot: 145 },
    { dx: -4, dy: -20, rot: 45 },
    { dx: 4, dy: 19, rot: -165 },
];

function cellCenterSvg(pt: Point): { x: number; y: number } {
    return {
        x: (pt.c - 0.5) * 10,
        y: (pt.r - 0.5) * 10,
    };
}

const NUKE_SHARDS = [
    { dx: -16, dy: -16, rot: -120 },
    { dx: 18, dy: -14, rot: 95 },
    { dx: -20, dy: 8, rot: -75 },
    { dx: 16, dy: 16, rot: 145 },
    { dx: 0, dy: -22, rot: 45 },
    { dx: -4, dy: 22, rot: 180 },
];

/**
 * Full-board 15x15 compositor-only VFX layer rendered inside `.board-grid`.
 * Synchronizes Nuke siren warhead descent -> +0.88s full-board crimson tint +
 * 6-block crimson blood-bath corridor, Shield aegis bursts, Boost plasma trails,
 * and Teleport quantum warp beams.
 */
export function PowerVfxOverlay({ events }: { events: PowerVfxEvent[] }) {
    if (!events || events.length === 0) return null;
    const reduced = prefersReducedMotion();

    return (
        <div className="power-vfx-layer" aria-hidden="true">
            {events.map((ev) => {
                if (ev.kind === 'nuke') {
                    return <NukeVfxSequence key={ev.id} event={ev} reduced={reduced} />;
                }
                if (ev.kind === 'shield') {
                    return <ShieldVfxSequence key={ev.id} event={ev} reduced={reduced} />;
                }
                if (ev.kind === 'boost_arm') {
                    return <BoostArmVfxSequence key={ev.id} event={ev} reduced={reduced} />;
                }
                if (ev.kind === 'boost_trail') {
                    return <BoostTrailVfxSequence key={ev.id} event={ev} reduced={reduced} />;
                }
                return <TeleportVfxSequence key={ev.id} event={ev} reduced={reduced} />;
            })}
        </div>
    );
}

function NukeVfxSequence({
    event,
    reduced,
}: {
    event: Extract<PowerVfxEvent, { kind: 'nuke' }>;
    reduced: boolean;
}) {
    const start = cellCenterSvg(event.originCell);
    const end = cellCenterSvg(event.impactCell);
    const angleDeg = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
    const dx = start.x - end.x;
    const dy = start.y - end.y;
    const blastDelay = reduced ? 0 : 0.88;

    return (
        <>
            {/* Brief (~0.35s) full-board crimson tint pulse at the exact moment of impact */}
            <motion.div
                className="power-nuke-board-tint"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.44, 0] }}
                transition={{
                    duration: reduced ? 0.25 : 0.36,
                    delay: blastDelay,
                    times: [0, 0.22, 1],
                    ease: 'easeOut',
                }}
            />

            {/* 6-block crimson blood-bath blast corridor (+/-3 tiles around impact) */}
            <div className="power-vfx-grid">
                {event.corridorCells.map((pt, idx) => {
                    const dist =
                        Math.abs(pt.r - event.impactCell.r) + Math.abs(pt.c - event.impactCell.c);
                    const cellDelay = blastDelay + Math.min(0.18, dist * 0.028);
                    return (
                        <motion.div
                            key={`${pt.r}-${pt.c}-${idx}`}
                            className="power-nuke-blood-cell"
                            style={{ gridRow: pt.r, gridColumn: pt.c }}
                            initial={{ opacity: 0, scale: 0.55 }}
                            animate={
                                reduced
                                    ? { opacity: [0, 0.85, 0], scale: 1 }
                                    : {
                                          opacity: [0, 0.96, 0.84, 0],
                                          scale: [0.55, 1.08, 1.0, 0.94],
                                      }
                            }
                            transition={{
                                duration: reduced ? 0.7 : 1.45,
                                delay: cellDelay,
                                times: reduced ? [0, 0.25, 1] : [0, 0.14, 0.58, 1],
                                ease: 'easeOut',
                            }}
                        />
                    );
                })}

                {/* Target lock reticle pulsing on ground zero during the siren descent */}
                {!reduced && (
                    <motion.div
                        className="power-nuke-reticle"
                        style={{ gridRow: event.impactCell.r, gridColumn: event.impactCell.c }}
                        initial={{ opacity: 0, scale: 1.5 }}
                        animate={{
                            opacity: [0, 1, 0.5, 1, 0],
                            scale: [1.5, 1.0, 1.18, 0.92, 1.8],
                        }}
                        transition={{ duration: 0.95, ease: 'easeInOut' }}
                    />
                )}

                {/* Expanding ground-zero white-hot + crimson impact shockwaves */}
                <motion.div
                    className="power-nuke-shockwave"
                    style={{ gridRow: event.impactCell.r, gridColumn: event.impactCell.c }}
                    initial={{ opacity: 0, scale: 0.35 }}
                    animate={
                        reduced
                            ? { opacity: [0, 0.8, 0], scale: 1.5 }
                            : { opacity: [0, 1, 0], scale: [0.35, 3.8] }
                    }
                    transition={{
                        duration: reduced ? 0.3 : 0.72,
                        delay: blastDelay,
                        ease: 'easeOut',
                    }}
                />

                {/* Victim vaporization bursts */}
                {event.victimCells.map((v, i) => (
                    <div
                        key={`victim-${v.pt.r}-${v.pt.c}-${i}`}
                        className="power-vfx-cell-host"
                        style={{ gridRow: v.pt.r, gridColumn: v.pt.c }}
                    >
                        <motion.span
                            className="power-nuke-victim-ring"
                            initial={{ opacity: 0, scale: 0.4 }}
                            animate={{ opacity: [0, 0.95, 0], scale: [0.4, 2.2] }}
                            transition={{
                                duration: reduced ? 0.3 : 0.65,
                                delay: blastDelay + 0.04,
                                ease: 'easeOut',
                            }}
                        />
                        {!reduced &&
                            NUKE_SHARDS.map((s, si) => (
                                <motion.span
                                    key={si}
                                    className="power-nuke-victim-shard"
                                    initial={{ opacity: 0, x: 0, y: 0, scale: 1, rotate: 0 }}
                                    animate={{
                                        opacity: [0, 1, 0],
                                        x: s.dx,
                                        y: s.dy,
                                        scale: 0.35,
                                        rotate: s.rot,
                                    }}
                                    transition={{
                                        duration: 0.6,
                                        delay: blastDelay + 0.03 + si * 0.015,
                                        ease: 'easeOut',
                                    }}
                                />
                            ))}
                    </div>
                ))}

                {/* Shield deflect ripples on shielded enemies inside blast corridor */}
                {(event.deflectedCells ?? []).map((pt, i) => (
                    <div
                        key={`deflect-${pt.r}-${pt.c}-${i}`}
                        className="power-vfx-cell-host"
                        style={{ gridRow: pt.r, gridColumn: pt.c }}
                    >
                        <motion.span
                            className="power-shield-deflect"
                            initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }}
                            animate={{
                                opacity: [0, 1, 0],
                                scale: reduced ? 1 : [0.6, 1.85],
                            }}
                            transition={{
                                duration: reduced ? 0.32 : 0.62,
                                delay: blastDelay,
                                ease: 'easeOut',
                            }}
                        />
                    </div>
                ))}
            </div>

            {/* Falling warhead descending along corner -> target vector during siren */}
            {!reduced && (
                <svg viewBox="0 0 150 150" className="power-vfx-svg" fill="none">
                    <motion.line
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        stroke="#ef4444"
                        strokeWidth="0.9"
                        strokeDasharray="2.5 2"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 0.55, 0.85, 0] }}
                        transition={{ duration: 0.92, ease: 'easeIn' }}
                    />
                    <g transform={`translate(${end.x}, ${end.y})`}>
                        <motion.g
                            initial={{ x: dx, y: dy, scale: 1.45, opacity: 0 }}
                            animate={{ x: 0, y: 0, scale: 0.72, opacity: [0, 1, 1, 0] }}
                            transition={{
                                duration: 0.9,
                                times: [0, 0.12, 0.96, 1],
                                ease: 'easeIn',
                            }}
                        >
                            <g transform={`rotate(${angleDeg})`}>
                                {/* Plume */}
                                <polygon points="-11,-1.6 -5,-0.5 -5,0.5 -11,1.6" fill="#f59e0b" opacity="0.88" />
                                {/* Warhead body */}
                                <polygon
                                    points="-5,-2.3 3.8,0 -5,2.3 -3.2,0"
                                    fill="#ef4444"
                                    stroke="#fecaca"
                                    strokeWidth="0.55"
                                    strokeLinejoin="round"
                                />
                                <circle cx="0.2" cy="0" r="1.1" fill="#ffffff" />
                            </g>
                        </motion.g>
                    </g>
                </svg>
            )}
        </>
    );
}

function ShieldVfxSequence({
    event,
    reduced,
}: {
    event: Extract<PowerVfxEvent, { kind: 'shield' }>;
    reduced: boolean;
}) {
    return (
        <div className="power-vfx-grid">
            {event.cells.map((pt, i) => (
                <div
                    key={`${pt.r}-${pt.c}-${i}`}
                    className="power-vfx-cell-host"
                    style={{ gridRow: pt.r, gridColumn: pt.c }}
                >
                    <motion.div
                        className="power-shield-burst"
                        initial={{ opacity: 0, scale: reduced ? 1 : 0.45 }}
                        animate={{
                            opacity: [0, 0.95, 0],
                            scale: reduced ? 1 : [0.45, 1.75],
                        }}
                        transition={{ duration: reduced ? 0.35 : 0.82, ease: 'easeOut' }}
                    />
                    <motion.div
                        className="power-shield-lock"
                        initial={{ opacity: 0, scale: reduced ? 1 : 1.45, rotate: 0 }}
                        animate={{
                            opacity: [0, 0.92, 0],
                            scale: reduced ? 1 : [1.45, 0.95, 1.15],
                            rotate: reduced ? 0 : [0, -90],
                        }}
                        transition={{ duration: reduced ? 0.35 : 0.72, delay: reduced ? 0 : 0.06, ease: 'easeOut' }}
                    />
                    <motion.div
                        className="power-shield-crest-flash"
                        initial={{ opacity: 0, scale: reduced ? 1 : 0.5 }}
                        animate={{
                            opacity: [0, 1, 0],
                            scale: reduced ? 1 : [0.5, 1.25, 0.95],
                        }}
                        transition={{ duration: reduced ? 0.32 : 0.68, delay: reduced ? 0 : 0.04, ease: 'easeOut' }}
                    >
                        <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                            <path
                                d="M8 1.5L13.5 3.6V7.7C13.5 11.1 11.2 13.8 8 14.8C4.8 13.8 2.5 11.1 2.5 7.7V3.6L8 1.5Z"
                                fill="#22d3ee"
                                stroke="#ecfeff"
                                strokeWidth="1.2"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </motion.div>
                </div>
            ))}
        </div>
    );
}

function BoostArmVfxSequence({
    event,
    reduced,
}: {
    event: Extract<PowerVfxEvent, { kind: 'boost_arm' }>;
    reduced: boolean;
}) {
    return (
        <div className="power-vfx-grid">
            {event.cells.map((pt, i) => (
                <motion.div
                    key={`${pt.r}-${pt.c}-${i}`}
                    className="power-boost-arm-burst"
                    style={{ gridRow: pt.r, gridColumn: pt.c }}
                    initial={{ opacity: 0, scale: reduced ? 1 : 0.5 }}
                    animate={{
                        opacity: [0, 0.95, 0],
                        scale: reduced ? 1 : [0.5, 1.6],
                    }}
                    transition={{ duration: reduced ? 0.35 : 0.72, ease: 'easeOut' }}
                />
            ))}
        </div>
    );
}

function BoostTrailVfxSequence({
    event,
    reduced,
}: {
    event: Extract<PowerVfxEvent, { kind: 'boost_trail' }>;
    reduced: boolean;
}) {
    const count = event.cells.length;
    return (
        <div className="power-vfx-grid">
            {event.cells.map((pt, idx) => (
                <motion.div
                    key={`${pt.r}-${pt.c}-${idx}`}
                    className={`power-boost-cell ${idx === count - 1 ? 'is-endpoint' : ''}`}
                    style={{ gridRow: pt.r, gridColumn: pt.c }}
                    initial={{ opacity: 0, scale: reduced ? 1 : 0.65 }}
                    animate={{
                        opacity: [0, 0.92, 0],
                        scale: reduced ? 1 : idx === count - 1 ? [0.7, 1.35, 1] : [0.65, 1.05, 0.85],
                    }}
                    transition={{
                        duration: reduced ? 0.4 : 0.65,
                        delay: reduced ? 0 : idx * 0.045,
                        ease: 'easeOut',
                    }}
                />
            ))}
        </div>
    );
}

function TeleportVfxSequence({
    event,
    reduced,
}: {
    event: Extract<PowerVfxEvent, { kind: 'teleport' }>;
    reduced: boolean;
}) {
    const p1 = cellCenterSvg(event.fromCell);
    const p2 = cellCenterSvg(event.toCell);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy) || 1;
    const arcLift = Math.min(28, Math.max(12, dist * 0.28));
    const nx = -dy / dist;
    const ny = dx / dist;
    const sign = ny <= 0 ? 1 : -1;
    const midX = Math.max(10, Math.min(140, (p1.x + p2.x) / 2 + nx * arcLift * sign));
    const midY = Math.max(10, Math.min(140, (p1.y + p2.y) / 2 + ny * arcLift * sign));

    const pulseXs: number[] = [];
    const pulseYs: number[] = [];
    for (let i = 0; i <= 6; i += 1) {
        const t = i / 6;
        const u = 1 - t;
        pulseXs.push(u * u * p1.x + 2 * u * t * midX + t * t * p2.x);
        pulseYs.push(u * u * p1.y + 2 * u * t * midY + t * t * p2.y);
    }

    const factionHex = TELEPORT_ACCENT[event.color] ?? '#10b981';
    const beamOuter = event.toFinish ? '#fbbf24' : '#10b981';
    const beamCore = event.toFinish ? '#fef3c7' : '#a7f3d0';
    const beamPath = `M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`;

    return (
        <>
            <div className="power-vfx-grid">
                {/* Beat 1: Departure Hologram Dissolve + Spinning Vortex + Quantum Column */}
                <div
                    className="power-vfx-cell-host"
                    style={{ gridRow: event.fromCell.r, gridColumn: event.fromCell.c }}
                >
                    {!reduced && (
                        <>
                            <motion.div
                                className="power-tp-column is-departure"
                                initial={{ opacity: 0, scaleY: 0.2 }}
                                animate={{ opacity: [0, 0.9, 0], scaleY: [0.2, 1.5, 0.4] }}
                                transition={{ duration: 0.34, ease: 'easeOut' }}
                            />
                            <motion.span
                                className="power-tp-ghost"
                                style={{ '--tp-faction': factionHex } as React.CSSProperties}
                                initial={{ opacity: 0.95, scaleX: 1, scaleY: 1, y: 0 }}
                                animate={{
                                    opacity: [0.95, 0.8, 0],
                                    scaleX: [1, 0.3, 0.08],
                                    scaleY: [1, 1.9, 2.5],
                                    y: [0, -10, -22],
                                }}
                                transition={{ duration: 0.32, ease: 'easeIn' }}
                            />
                        </>
                    )}
                    <motion.div
                        className="power-tp-vortex"
                        initial={{ opacity: 0.95, scale: reduced ? 1 : 1.4, rotate: 0 }}
                        animate={{
                            opacity: [0.95, 0],
                            scale: reduced ? 1 : [1.4, 0.2],
                            rotate: reduced ? 0 : 220,
                        }}
                        transition={{ duration: reduced ? 0.35 : 0.44, ease: 'easeIn' }}
                    />
                </div>

                {/* Beat 3: Arrival Column + Double Rings + Quantum Sparks */}
                <div
                    className="power-vfx-cell-host"
                    style={{ gridRow: event.toCell.r, gridColumn: event.toCell.c }}
                >
                    {!reduced && (
                        <motion.div
                            className={`power-tp-column is-arrival ${event.toFinish ? 'is-finish' : ''}`}
                            initial={{ opacity: 0, scaleY: 1.8 }}
                            animate={{ opacity: [0, 0.95, 0], scaleY: [1.8, 1.0, 0.2] }}
                            transition={{ duration: 0.46, delay: 0.2, ease: 'easeOut' }}
                        />
                    )}
                    <motion.div
                        className={`power-tp-ring ${event.toFinish ? 'is-finish' : ''}`}
                        initial={{ opacity: 0, scale: reduced ? 1 : 0.35 }}
                        animate={{
                            opacity: [0, 1, 0],
                            scale: reduced ? 1 : [0.35, 2.2],
                        }}
                        transition={{
                            duration: reduced ? 0.35 : 0.62,
                            delay: reduced ? 0 : 0.22,
                            ease: 'easeOut',
                        }}
                    />
                    {!reduced && (
                        <>
                            <motion.div
                                className={`power-tp-ring-outer ${event.toFinish ? 'is-finish' : ''}`}
                                initial={{ opacity: 0, scale: 0.45 }}
                                animate={{ opacity: [0, 0.85, 0], scale: [0.45, 2.65] }}
                                transition={{ duration: 0.62, delay: 0.28, ease: 'easeOut' }}
                            />
                            {TELEPORT_SPARKS.map((sp, si) => (
                                <motion.span
                                    key={si}
                                    className={`power-tp-spark ${event.toFinish ? 'is-finish' : ''}`}
                                    initial={{ opacity: 0, x: 0, y: 0, scale: 1, rotate: 0 }}
                                    animate={{
                                        opacity: [0, 1, 0],
                                        x: sp.dx,
                                        y: sp.dy,
                                        scale: 0.3,
                                        rotate: sp.rot,
                                    }}
                                    transition={{
                                        duration: 0.5,
                                        delay: 0.24 + si * 0.015,
                                        ease: 'easeOut',
                                    }}
                                />
                            ))}
                        </>
                    )}
                </div>
            </div>

            {/* Beat 2: Dual-Layer Warp Beam + Traveling Quantum Pulse Orb */}
            <svg viewBox="0 0 150 150" className="power-vfx-svg" fill="none">
                <motion.path
                    d={beamPath}
                    stroke={beamOuter}
                    strokeWidth="4.4"
                    strokeLinecap="round"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.55, 0] }}
                    transition={{ duration: reduced ? 0.36 : 0.52, delay: reduced ? 0 : 0.04, ease: 'easeInOut' }}
                />
                <motion.path
                    d={beamPath}
                    stroke={beamCore}
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    initial={reduced ? { opacity: 0 } : { opacity: 0, pathLength: 0 }}
                    animate={reduced ? { opacity: [0, 0.95, 0] } : { opacity: [0, 1, 0], pathLength: [0, 1] }}
                    transition={{ duration: reduced ? 0.36 : 0.46, delay: reduced ? 0 : 0.04, ease: 'easeInOut' }}
                />
                {!reduced && (
                    <motion.g
                        initial={{ x: pulseXs[0], y: pulseYs[0], scale: 0.6, opacity: 0 }}
                        animate={{
                            x: pulseXs,
                            y: pulseYs,
                            scale: [0.6, 1.35, 1.15, 0.5],
                            opacity: [0, 1, 1, 0],
                        }}
                        transition={{ duration: 0.36, delay: 0.06, ease: 'easeInOut' }}
                    >
                        <circle cx="0" cy="0" r="4.2" fill={beamOuter} opacity="0.6" />
                        <circle cx="0" cy="0" r="2.2" fill="#ffffff" />
                    </motion.g>
                )}
            </svg>
        </>
    );
}
