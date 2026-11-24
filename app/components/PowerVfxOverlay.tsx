'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { prefersReducedMotion } from '@/lib/motion';
import type { Point } from '@/lib/boardLayout';
import type { PowerVfxEvent } from '@/lib/powerVfx';

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
                <motion.div
                    key={`${pt.r}-${pt.c}-${i}`}
                    className="power-shield-burst"
                    style={{ gridRow: pt.r, gridColumn: pt.c }}
                    initial={{ opacity: 0, scale: reduced ? 1 : 0.45 }}
                    animate={{
                        opacity: [0, 0.95, 0],
                        scale: reduced ? 1 : [0.45, 1.55],
                    }}
                    transition={{ duration: reduced ? 0.35 : 0.78, ease: 'easeOut' }}
                />
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
    const midX = (p1.x + p2.x) / 2;
    const midY = Math.min(p1.y, p2.y) - 18;

    return (
        <>
            <div className="power-vfx-grid">
                <motion.div
                    className="power-tp-vortex"
                    style={{ gridRow: event.fromCell.r, gridColumn: event.fromCell.c }}
                    initial={{ opacity: 0.95, scale: reduced ? 1 : 1.3, rotate: 0 }}
                    animate={{
                        opacity: [0.95, 0],
                        scale: reduced ? 1 : [1.3, 0.25],
                        rotate: reduced ? 0 : 180,
                    }}
                    transition={{ duration: reduced ? 0.35 : 0.52, ease: 'easeIn' }}
                />

                <motion.div
                    className="power-tp-ring"
                    style={{ gridRow: event.toCell.r, gridColumn: event.toCell.c }}
                    initial={{ opacity: 0, scale: reduced ? 1 : 0.35 }}
                    animate={{
                        opacity: [0, 1, 0],
                        scale: reduced ? 1 : [0.35, 2.1],
                    }}
                    transition={{
                        duration: reduced ? 0.35 : 0.72,
                        delay: reduced ? 0 : 0.16,
                        ease: 'easeOut',
                    }}
                />
            </div>

            {!reduced && (
                <svg viewBox="0 0 150 150" className="power-vfx-svg" fill="none">
                    <motion.path
                        d={`M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`}
                        stroke="#10b981"
                        strokeWidth="1.6"
                        strokeDasharray="3 2.5"
                        strokeLinecap="round"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 0.95, 0] }}
                        transition={{ duration: 0.7, ease: 'easeInOut' }}
                    />
                </svg>
            )}
        </>
    );
}
