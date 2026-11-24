'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PlayerColor, PowerType } from '@/lib/types';
import { prefersReducedMotion } from '@/lib/motion';
import {
    POWER_META,
    formatPowerCountdown,
    getPowerExpiryRingState,
    getPowerLockReason,
    resolvePowerOrbTapAction,
} from '@/lib/powerDockLogic';

export interface GroupedPowerSlot {
    type: PowerType;
    count: number;
    soonest: number;
}

export interface PowerInventoryDockProps {
    items: GroupedPowerSlot[];
    canSpend: boolean;
    isMyTurn: boolean;
    gamePhase: string;
    powerSpentThisTurn: boolean;
    activeBoost: PlayerColor | null | undefined;
    activeShields: { color: PlayerColor; tokenIdx: number }[] | undefined;
    ownColor: PlayerColor;
    targeting: { type: PowerType } | null;
    chatOpen: boolean;
    matchFinished: boolean;
    onSpendPower: (type: PowerType) => void;
}

const RING_RADIUS = 21.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const CARET_CLAMP_PX = 108;

/**
 * Bottom-docked power inventory strip with:
 * - Bespoke multi-layer SVG power emblems + live SVG expiry rings
 * - 1-tap instant-cast during eligible turn windows (no modal delay)
 * - 1-tap minimalist inspection popover (with Example diagram + caret pointer) when not eligible
 */
export function PowerInventoryDock({
    items,
    canSpend,
    isMyTurn,
    gamePhase,
    powerSpentThisTurn,
    activeBoost,
    activeShields,
    ownColor,
    targeting,
    chatOpen,
    matchFinished,
    onSpendPower,
}: PowerInventoryDockProps) {
    const [inspected, setInspected] = useState<PowerType | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [caretX, setCaretX] = useState(0);

    const stripRef = useRef<HTMLDivElement | null>(null);
    const btnRefs = useRef<Partial<Record<PowerType, HTMLButtonElement | null>>>({});

    const hasTimedItems = items.some((i) => i.count > 0 && i.soonest > 0);
    useEffect(() => {
        if (!hasTimedItems) return;
        setNow(Date.now());
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [hasTimedItems]);

    // Auto-dismiss inspection popover when chat opens, match ends, or a target power arms.
    useEffect(() => {
        if (chatOpen || matchFinished || targeting !== null) {
            setInspected(null);
        }
    }, [chatOpen, matchFinished, targeting]);

    // Close on Escape key while inspecting.
    useEffect(() => {
        if (!inspected) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setInspected(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [inspected]);

    // Measure inspected orb X-offset relative to strip center so the downward caret tracks cleanly.
    useLayoutEffect(() => {
        if (!inspected) return;
        const updateCaret = () => {
            const strip = stripRef.current;
            const btn = btnRefs.current[inspected];
            if (!strip || !btn || strip.offsetWidth <= 0) return;
            const raw = btn.offsetLeft + btn.offsetWidth / 2 - strip.offsetWidth / 2;
            const clamped = Math.max(-CARET_CLAMP_PX, Math.min(CARET_CLAMP_PX, Math.round(raw)));
            setCaretX(clamped);
        };
        updateCaret();
        window.addEventListener('resize', updateCaret);
        return () => window.removeEventListener('resize', updateCaret);
    }, [inspected, items.length]);

    const handleOrbClick = (slot: GroupedPowerSlot) => {
        const outcome = resolvePowerOrbTapAction({
            type: slot.type,
            count: slot.count,
            canSpend,
            inspected,
        });
        if (outcome === 'cast') {
            setInspected(null);
            onSpendPower(slot.type);
            return;
        }
        if (outcome === 'close') {
            setInspected(null);
            return;
        }
        setInspected(slot.type);
    };

    const inspectedSlot = inspected ? items.find((i) => i.type === inspected) ?? null : null;
    const inspectedMeta = inspected ? POWER_META[inspected] : null;
    const inspectedRing =
        inspected && inspectedSlot
            ? getPowerExpiryRingState(inspected, inspectedSlot.soonest, now)
            : null;
    const inspectedLockReason =
        inspectedSlot
            ? getPowerLockReason({
                  count: inspectedSlot.count,
                  isMyTurn,
                  gamePhase,
                  powerSpentThisTurn,
              })
            : null;
    const reduced = prefersReducedMotion();

    return (
        <div className="power-inv-strip" ref={stripRef}>
            {inspected && (
                <div
                    className="power-popover-backdrop"
                    onClick={() => setInspected(null)}
                    aria-hidden="true"
                />
            )}

            <AnimatePresence mode="wait">
                {inspected && inspectedSlot && inspectedMeta && inspectedRing && (
                    <motion.div
                        key="power-inspect-popover"
                        role="dialog"
                        aria-label={`${inspectedMeta.title} power details`}
                        className={`power-popover power-popover-${inspected}`}
                        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
                        transition={reduced ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <div className="power-popover-head">
                            <span
                                className={`power-popover-stock ${
                                    inspectedSlot.count > 0 && inspectedRing.remainingMs > 0
                                        ? `is-timed urgency-${inspectedRing.urgency}`
                                        : 'is-empty'
                                }`}
                            >
                                <span>×{inspectedSlot.count}</span>
                                {inspectedSlot.count > 0 && inspectedRing.remainingMs > 0 && (
                                    <span className="power-popover-timer">
                                        {formatPowerCountdown(inspectedRing.remainingMs)}
                                    </span>
                                )}
                            </span>
                            <h3 className="power-popover-title">{inspectedMeta.title}</h3>
                            <button
                                type="button"
                                className="power-popover-close"
                                onClick={() => setInspected(null)}
                                aria-label="Close power details"
                            >
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="power-close-svg">
                                    <path d="M4 4l8 8M12 4l-8 8" />
                                </svg>
                            </button>
                        </div>

                        <p className="power-popover-desc">{inspectedMeta.summary}</p>

                        <div className="power-example-stage">
                            <span className="power-example-ribbon">EXAMPLE</span>
                            <PowerExampleDiagram type={inspected} />
                        </div>

                        <div className="power-popover-foot">
                            <span className="power-popover-chip">
                                <PowerEmblem type={inspected} size="card" />
                                <span className="power-popover-chip-count">×{inspectedSlot.count}</span>
                            </span>
                            {canSpend && inspectedSlot.count > 0 ? (
                                <button
                                    type="button"
                                    className="power-popover-cta"
                                    onClick={() => {
                                        const toSpend = inspected;
                                        setInspected(null);
                                        onSpendPower(toSpend);
                                    }}
                                >
                                    {inspectedMeta.ctaLabel}
                                </button>
                            ) : (
                                <div className="power-popover-status">
                                    {inspectedLockReason ?? inspectedMeta.shortTag}
                                </div>
                            )}
                        </div>

                        <span
                            className="power-popover-caret"
                            style={{ '--caret-x': `${caretX}px` } as React.CSSProperties}
                            aria-hidden="true"
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {items.map((slot) => {
                const has = slot.count > 0;
                const meta = POWER_META[slot.type];
                const isEligible = canSpend && has;
                const isArmed = targeting?.type === slot.type;
                const isBoostActive = slot.type === 'boost' && activeBoost === ownColor;
                const isShieldActive =
                    slot.type === 'shield' &&
                    Boolean((activeShields || []).some((s) => s.color === ownColor));
                const isActive = isBoostActive || isShieldActive;
                const isInspected = inspected === slot.type;
                const ring = has
                    ? getPowerExpiryRingState(slot.type, slot.soonest, now)
                    : { progress: 0, remainingMs: 0, urgency: 'none' as const };

                const tooltipLabel = isArmed
                    ? `${meta.title} · Tap target`
                    : isEligible
                      ? `${meta.title} · Use now`
                      : has && ring.remainingMs > 0
                        ? `${meta.title} · ${formatPowerCountdown(ring.remainingMs)}`
                        : `${meta.title} · Inspect`;

                const ariaAction = isArmed
                    ? 'Cancel targeting'
                    : isEligible
                      ? `Use ${meta.title}`
                      : `Inspect ${meta.title}`;

                return (
                    <button
                        key={slot.type}
                        ref={(el) => {
                            btnRefs.current[slot.type] = el;
                        }}
                        type="button"
                        onClick={() => handleOrbClick(slot)}
                        aria-expanded={isInspected}
                        aria-label={`${ariaAction}, ${slot.count} held`}
                        className={[
                            'power-orb',
                            `power-orb-${slot.type}`,
                            isEligible ? 'is-ready' : '',
                            has ? '' : 'is-empty',
                            isArmed ? 'is-armed power-orb-armed' : '',
                            isActive ? 'is-active' : '',
                            isInspected ? 'is-inspected' : '',
                        ]
                            .filter(Boolean)
                            .join(' ')}
                    >
                        {has && slot.soonest > 0 && (
                            <svg
                                className={`power-orb-ring ring-${ring.urgency}`}
                                viewBox="0 0 48 48"
                                aria-hidden="true"
                            >
                                <circle
                                    className="power-orb-ring-track"
                                    cx="24"
                                    cy="24"
                                    r={RING_RADIUS}
                                />
                                <circle
                                    className="power-orb-ring-arc"
                                    cx="24"
                                    cy="24"
                                    r={RING_RADIUS}
                                    strokeDasharray={RING_CIRCUMFERENCE}
                                    strokeDashoffset={RING_CIRCUMFERENCE * (1 - ring.progress)}
                                />
                            </svg>
                        )}

                        <span className="power-orb-core" aria-hidden="true">
                            <PowerEmblem type={slot.type} size="dock" />
                        </span>

                        <span className={`power-orb-count ${has ? '' : 'zero'}`}>
                            {slot.count}
                        </span>

                        {!inspected && (
                            <span className="power-orb-tooltip" aria-hidden="true">
                                {tooltipLabel}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

/** High-craft multi-layer vector emblems for Ludo 3077's four power types (zero emoji). */
export function PowerEmblem({
    type,
    size = 'dock',
}: {
    type: PowerType;
    size?: 'dock' | 'card';
}) {
    const cls = size === 'card' ? 'power-emblem power-emblem-card' : 'power-emblem power-emblem-dock';

    if (type === 'boost') {
        return (
            <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
                <path
                    d="M13.5 2L5 13h6l-1.5 9L19 10.5h-6L13.5 2z"
                    fill="#f59e0b"
                    stroke="#fef3c7"
                    strokeWidth="1.25"
                    strokeLinejoin="round"
                />
                <path d="M12.5 5.5L8.2 11.5h4l-.8 5.2 4.3-5.2h-3.8l.6-6z" fill="#fde68a" opacity="0.7" />
            </svg>
        );
    }

    if (type === 'shield') {
        return (
            <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
                <path
                    d="M12 2.5l7.5 2.8v5.9c0 4.9-3.2 9.1-7.5 10.5-4.3-1.4-7.5-5.6-7.5-10.5V5.3L12 2.5z"
                    fill="#0891b2"
                    stroke="#a5f3fc"
                    strokeWidth="1.35"
                    strokeLinejoin="round"
                />
                <path
                    d="M12 5.4l4.8 1.8v4c0 3.2-2 6.1-4.8 7.2-2.8-1.1-4.8-4-4.8-7.2v-4L12 5.4z"
                    fill="#22d3ee"
                    opacity="0.48"
                />
                <path d="M12 7.8L15 11l-3 4.2L9 11l3-3.2z" fill="#ecfeff" opacity="0.92" />
            </svg>
        );
    }

    if (type === 'teleport') {
        return (
            <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
                <path
                    d="M5 17c1.6-6.2 6.8-10.2 13-10.6"
                    stroke="#6ee7b7"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeDasharray="2.5 2.5"
                />
                <path
                    d="M14.5 3.6L19.2 6.4L15.4 10"
                    stroke="#a7f3d0"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M12 8.2l1.3 3.2 3.2 1.3-3.2 1.3-1.3 3.2-1.3-3.2-3.2-1.3 3.2-1.3L12 8.2z"
                    fill="#10b981"
                    stroke="#d1fae5"
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                />
                <circle cx="5.5" cy="17.5" r="2.1" fill="#34d399" stroke="#ecfdf5" strokeWidth="1" />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
            <circle cx="12" cy="12" r="8.2" stroke="#fca5a5" strokeWidth="1.5" strokeDasharray="3.2 2.2" />
            <circle cx="12" cy="12" r="4.8" fill="#dc2626" stroke="#fecaca" strokeWidth="1.2" />
            <circle cx="12" cy="12" r="2" fill="#fee2e2" />
            <path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

/** Crisp minimalist Before -> After visual diagram inside the `EXAMPLE` stage card. */
function PowerExampleDiagram({ type }: { type: PowerType }) {
    if (type === 'boost') {
        return (
            <svg viewBox="0 0 256 86" fill="none" className="power-example-svg" aria-hidden="true">
                {/* Die 4 */}
                <rect x="26" y="21" width="38" height="38" rx="9" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.6" />
                <circle cx="37" cy="32" r="2.8" fill="var(--power-stage-ink)" />
                <circle cx="53" cy="32" r="2.8" fill="var(--power-stage-ink)" />
                <circle cx="37" cy="48" r="2.8" fill="var(--power-stage-ink)" />
                <circle cx="53" cy="48" r="2.8" fill="var(--power-stage-ink)" />

                {/* Plus */}
                <path d="M73 40h8M77 36v8" stroke="var(--power-stage-muted)" strokeWidth="2.2" strokeLinecap="round" />

                {/* +6 Boost badge */}
                <rect x="89" y="24" width="36" height="32" rx="9" fill="rgba(245, 158, 11, 0.16)" stroke="#f59e0b" strokeWidth="1.6" />
                <path d="M104 31l-4.5 7h3.6l-.8 5.2 4.8-7.2h-3.6L104 31z" fill="#f59e0b" />
                <text x="115" y="44" textAnchor="middle" fill="#f59e0b" fontSize="11" fontWeight="800">6</text>

                {/* Arrow */}
                <path d="M133 40h18M146 35l5 5-5 5" stroke="var(--power-stage-arrow)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

                {/* Surge 3-cell track + 10 result pill */}
                <rect x="160" y="29" width="22" height="22" rx="4" fill="rgba(245, 158, 11, 0.12)" stroke="var(--power-stage-stroke)" strokeWidth="1.4" />
                <rect x="184" y="29" width="22" height="22" rx="4" fill="rgba(245, 158, 11, 0.22)" stroke="var(--power-stage-stroke)" strokeWidth="1.4" />
                <rect x="208" y="29" width="26" height="22" rx="6" fill="#f59e0b" />
                <circle cx="171" cy="40" r="4" fill="#fbbf24" opacity="0.55" />
                <path d="M178 40h24" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 2" />
                <text x="221" y="44" textAnchor="middle" fill="#18181b" fontSize="11" fontWeight="900">10</text>
            </svg>
        );
    }

    if (type === 'shield') {
        return (
            <svg viewBox="0 0 256 86" fill="none" className="power-example-svg" aria-hidden="true">
                {/* Left: 3 tiles, enemy hops toward shielded orb */}
                <rect x="22" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                <rect x="52" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                <rect x="82" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                {/* Enemy pawn */}
                <circle cx="36" cy="48" r="6.5" fill="#ef4444" stroke="#fee2e2" strokeWidth="1.2" />
                {/* Shielded ally orb */}
                <circle cx="96" cy="48" r="10.5" fill="rgba(6, 182, 212, 0.16)" stroke="#06b6d4" strokeWidth="1.7" />
                <circle cx="96" cy="48" r="5.5" fill="#10b981" stroke="#d1fae5" strokeWidth="1" />
                {/* Hop arc */}
                <path d="M40 31c12-12 36-12 49-1" stroke="var(--power-stage-muted)" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M85 26l4 4-5.5.8" stroke="var(--power-stage-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

                {/* Middle arrow */}
                <path d="M120 46h16M131 41l5 5-5 5" stroke="var(--power-stage-arrow)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

                {/* Right: 3 tiles, both share cell safely */}
                <rect x="146" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                <rect x="176" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                <rect x="206" y="34" width="32" height="28" rx="6" fill="rgba(6, 182, 212, 0.12)" stroke="#06b6d4" strokeWidth="1.5" />
                {/* Protected ally + harmless enemy co-existing */}
                <circle cx="217" cy="48" r="9.5" fill="rgba(6, 182, 212, 0.2)" stroke="#06b6d4" strokeWidth="1.6" />
                <circle cx="217" cy="48" r="5" fill="#10b981" stroke="#d1fae5" strokeWidth="1" />
                <circle cx="228" cy="51" r="4.8" fill="#ef4444" stroke="#fee2e2" strokeWidth="1" />
            </svg>
        );
    }

    if (type === 'teleport') {
        return (
            <svg viewBox="0 0 256 86" fill="none" className="power-example-svg" aria-hidden="true">
                {/* Left: orb blinks along arc to star cell */}
                <rect x="22" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                <rect x="52" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                <rect x="82" y="34" width="28" height="28" rx="5" fill="rgba(16, 185, 129, 0.12)" stroke="#10b981" strokeWidth="1.5" />
                <circle cx="36" cy="48" r="6" fill="#10b981" stroke="#d1fae5" strokeWidth="1.2" />
                {/* Star on tile 3 */}
                <path d="M96 41.5l1.6 3.5 3.8.5-2.8 2.7.7 3.8-3.3-1.8-3.3 1.8.7-3.8-2.8-2.7 3.8-.5L96 41.5z" fill="#10b981" opacity="0.85" />
                {/* Warp arc */}
                <path d="M39 31c14-14 40-14 54-1" stroke="#10b981" strokeWidth="2" strokeDasharray="3 2.5" strokeLinecap="round" />
                <path d="M89 26l4 4-5.5.8" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                {/* Middle arrow */}
                <path d="M120 46h16M131 41l5 5-5 5" stroke="var(--power-stage-arrow)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

                {/* Right: safely landed on Star */}
                <rect x="146" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                <rect x="176" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
                <rect x="206" y="34" width="30" height="28" rx="6" fill="rgba(16, 185, 129, 0.2)" stroke="#10b981" strokeWidth="1.6" />
                <circle cx="221" cy="48" r="9.5" stroke="#34d399" strokeWidth="1.4" strokeDasharray="2.5 2" />
                <circle cx="221" cy="48" r="6" fill="#10b981" stroke="#ecfdf5" strokeWidth="1.2" />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 256 86" fill="none" className="power-example-svg" aria-hidden="true">
            {/* Left: orb triggers +/-3 blast ring against adjacent enemy */}
            <rect x="22" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="#ef4444" strokeWidth="1.5" />
            <rect x="52" y="34" width="28" height="28" rx="5" fill="rgba(239, 68, 68, 0.1)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
            <rect x="82" y="34" width="28" height="28" rx="5" fill="rgba(239, 68, 68, 0.16)" stroke="#ef4444" strokeWidth="1.5" />
            {/* Player orb + shockwave arcs */}
            <circle cx="36" cy="48" r="6" fill="#06b6d4" stroke="#ecfeff" strokeWidth="1.2" />
            <path d="M47 41c4 4 4 10 0 14M55 38c5 6 5 14 0 20" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
            {/* Enemy orb in range */}
            <circle cx="96" cy="48" r="6" fill="#ef4444" stroke="#fee2e2" strokeWidth="1.2" />

            {/* Middle arrow */}
            <path d="M120 46h16M131 41l5 5-5 5" stroke="var(--power-stage-arrow)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

            {/* Right: blast flash & enemy sent to base */}
            <rect x="146" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="#ef4444" strokeWidth="1.5" />
            <rect x="176" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
            <rect x="206" y="34" width="28" height="28" rx="5" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1.5" />
            <circle cx="160" cy="48" r="6" fill="#06b6d4" stroke="#ecfeff" strokeWidth="1.2" />
            {/* Vaporized mark */}
            <circle cx="220" cy="48" r="8.5" stroke="#ef4444" strokeWidth="1.4" strokeDasharray="2 2" opacity="0.65" />
            <path d="M216.5 44.5l7 7M223.5 44.5l-7 7" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
}
