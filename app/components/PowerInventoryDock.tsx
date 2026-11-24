'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PlayerColor, PowerType } from '@/lib/types';
import { prefersReducedMotion } from '@/lib/motion';
import { HudCornerTicks } from './HudPrimitives';
import { TerminalTypeText } from './TerminalTypeText';
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
                        className={`power-popover power-dossier power-popover-${inspected}`}
                        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
                        transition={reduced ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <span className="power-dossier-beam" aria-hidden="true" />
                        <HudCornerTicks />

                        <div className="power-dossier-head">
                            <div className="power-dossier-emblem-bay" aria-hidden="true">
                                <PowerEmblem type={inspected} size="card" />
                            </div>
                            <div className="power-dossier-heading">
                                <div className="power-dossier-title-row">
                                    <h3 className="power-dossier-title">{inspectedMeta.title}</h3>
                                    <span className="power-dossier-spec">{inspectedMeta.shortTag}</span>
                                </div>
                                <p className="power-dossier-desc">{inspectedMeta.summary}</p>
                            </div>
                            <button
                                type="button"
                                className="power-dossier-close"
                                onClick={() => setInspected(null)}
                                aria-label="Close power details"
                            >
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="power-close-svg">
                                    <path d="M4 4l8 8M12 4l-8 8" />
                                </svg>
                            </button>
                        </div>

                        <div className="power-sim-stage">
                            <PowerTrackSimulator type={inspected} reduced={reduced} />
                            <div className="power-sim-caption">
                                <span className="power-sim-dot" aria-hidden="true" />
                                <TerminalTypeText
                                    key={inspected}
                                    text={inspectedMeta.simCaption}
                                    charMs={14}
                                    showCursor={false}
                                    className="power-sim-type"
                                />
                            </div>
                        </div>

                        <div className="power-dossier-rail">
                            <div className="power-dossier-inventory">
                                <div className="power-dossier-stock-row">
                                    <div className="power-charge-pips" aria-hidden="true">
                                        {[0, 1, 2].map((pipIdx) => (
                                            <span
                                                key={pipIdx}
                                                className={`power-charge-pip ${pipIdx < Math.min(3, inspectedSlot.count) ? 'is-filled' : ''}`}
                                            />
                                        ))}
                                    </div>
                                    {inspectedSlot.count > 0 && inspectedRing.remainingMs > 0 ? (
                                        <span className={`power-dossier-stock-text is-timed urgency-${inspectedRing.urgency}`}>
                                            <span>×{inspectedSlot.count}</span>
                                            <span className="power-dossier-sep" aria-hidden="true">·</span>
                                            <span className="power-dossier-timer">
                                                {formatPowerCountdown(inspectedRing.remainingMs)}
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="power-dossier-stock-text is-empty">
                                            {inspectedSlot.count > 0 ? `×${inspectedSlot.count} HELD` : '0 HELD'}
                                        </span>
                                    )}
                                </div>
                                {inspectedSlot.count > 0 && inspectedRing.remainingMs > 0 && (
                                    <div
                                        className={`power-decay-track urgency-${inspectedRing.urgency}`}
                                        aria-hidden="true"
                                    >
                                        <div
                                            className="power-decay-fill"
                                            style={{ transform: `scaleX(${inspectedRing.progress})` }}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="power-dossier-action">
                                {canSpend && inspectedSlot.count > 0 ? (
                                    <button
                                        type="button"
                                        className="power-dossier-cta"
                                        onClick={() => {
                                            const toSpend = inspected;
                                            setInspected(null);
                                            onSpendPower(toSpend);
                                        }}
                                    >
                                        {inspectedMeta.ctaLabel}
                                    </button>
                                ) : (
                                    <div className="power-dossier-lock">
                                        <span className="power-dossier-lock-dot" aria-hidden="true" />
                                        <span>{inspectedLockReason ?? inspectedMeta.shortTag}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <span
                            className="power-dossier-anchor"
                            style={{ '--caret-x': `${caretX}px` } as React.CSSProperties}
                            aria-hidden="true"
                        >
                            <span className="power-dossier-anchor-stem" />
                            <span className="power-dossier-anchor-pin" />
                        </span>
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

/** Original 5-cell Ludo 3077 live track simulator showing exact mechanics with compositor-only motion. */
function PowerTrackSimulator({ type, reduced }: { type: PowerType; reduced: boolean }) {
    const cellXs = [22, 68, 114, 160, 206];
    const animCls = reduced ? 'is-static' : 'is-animated';

    if (type === 'boost') {
        return (
            <svg viewBox="0 0 264 68" fill="none" className={`power-sim-svg ${animCls}`} aria-hidden="true">
                {cellXs.map((x, idx) => (
                    <g key={x}>
                        <rect
                            x={x}
                            y="22"
                            width="36"
                            height="30"
                            rx="6"
                            fill={idx === 4 ? 'rgba(245, 158, 11, 0.2)' : 'var(--power-stage-tile)'}
                            stroke={idx === 4 ? '#f59e0b' : 'var(--power-stage-stroke)'}
                            strokeWidth="1.4"
                        />
                        <text x={x + 6} y="32" fill="var(--power-stage-muted)" fontSize="7" fontWeight="700">
                            0{idx + 1}
                        </text>
                    </g>
                ))}
                {/* Die 4 + Boost 6 top badges */}
                <rect x="24" y="4" width="32" height="14" rx="4" fill="var(--power-stage-tile)" stroke="var(--power-stage-stroke)" strokeWidth="1" />
                <text x="40" y="13.5" textAnchor="middle" fill="var(--power-stage-ink)" fontSize="8.5" fontWeight="800">
                    ROLL 4
                </text>
                <rect x="64" y="4" width="46" height="14" rx="4" fill="rgba(245, 158, 11, 0.16)" stroke="#f59e0b" strokeWidth="1" />
                <text x="87" y="13.5" textAnchor="middle" fill="#f59e0b" fontSize="8.5" fontWeight="800">
                    +6 BOOST
                </text>
                <path d="M118 11h78" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
                <rect x="204" y="4" width="40" height="14" rx="4" fill="#f59e0b" />
                <text x="224" y="13.5" textAnchor="middle" fill="#18181b" fontSize="8.5" fontWeight="900">
                    10 TILES
                </text>

                {/* Slipstream markers */}
                <path d="M62 39h136" stroke="#f59e0b" strokeWidth="1.8" strokeDasharray="3 4" opacity="0.5" />
                {/* Gliding boosted orb */}
                <g transform="translate(40, 39)">
                    <g className="power-sim-boost-orb">
                        <circle cx="0" cy="0" r="10.5" fill="rgba(245, 158, 11, 0.24)" />
                        <circle cx="0" cy="0" r="6.5" fill="#f59e0b" stroke="#fef3c7" strokeWidth="1.4" />
                    </g>
                </g>
            </svg>
        );
    }

    if (type === 'shield') {
        return (
            <svg viewBox="0 0 264 68" fill="none" className={`power-sim-svg ${animCls}`} aria-hidden="true">
                {cellXs.map((x, idx) => (
                    <g key={x}>
                        <rect
                            x={x}
                            y="22"
                            width="36"
                            height="30"
                            rx="6"
                            fill={idx === 3 ? 'rgba(6, 182, 212, 0.16)' : 'var(--power-stage-tile)'}
                            stroke={idx === 3 ? '#06b6d4' : 'var(--power-stage-stroke)'}
                            strokeWidth="1.4"
                        />
                        <text x={x + 6} y="32" fill="var(--power-stage-muted)" fontSize="7" fontWeight="700">
                            0{idx + 1}
                        </text>
                    </g>
                ))}
                {/* Enemy orb advancing from cell 1 toward cell 4 & bouncing back */}
                <g transform="translate(40, 41)">
                    <g className="power-sim-shield-foe">
                        <circle cx="0" cy="0" r="6" fill="#ef4444" stroke="#fee2e2" strokeWidth="1.3" />
                    </g>
                </g>
                {/* Shielded ally orb on cell 4 */}
                <g transform="translate(178, 39)">
                    <g className="power-sim-shield-ring">
                        <circle cx="0" cy="0" r="12" fill="rgba(6, 182, 212, 0.18)" stroke="#06b6d4" strokeWidth="1.6" />
                    </g>
                    <circle cx="0" cy="0" r="6.2" fill="#10b981" stroke="#d1fae5" strokeWidth="1.2" />
                </g>
                {/* Safe share pill */}
                <rect x="148" y="4" width="60" height="14" rx="4" fill="rgba(6, 182, 212, 0.16)" stroke="#06b6d4" strokeWidth="1" />
                <text x="178" y="13.5" textAnchor="middle" fill="#06b6d4" fontSize="8" fontWeight="800">
                    SAFE SHIELD
                </text>
            </svg>
        );
    }

    if (type === 'teleport') {
        return (
            <svg viewBox="0 0 264 68" fill="none" className={`power-sim-svg ${animCls}`} aria-hidden="true">
                {cellXs.map((x, idx) => (
                    <g key={x}>
                        <rect
                            x={x}
                            y="22"
                            width="36"
                            height="30"
                            rx="6"
                            fill={idx === 4 ? 'rgba(16, 185, 129, 0.18)' : 'var(--power-stage-tile)'}
                            stroke={idx === 4 ? '#10b981' : 'var(--power-stage-stroke)'}
                            strokeWidth="1.4"
                        />
                        <text x={x + 6} y="32" fill="var(--power-stage-muted)" fontSize="7" fontWeight="700">
                            0{idx + 1}
                        </text>
                    </g>
                ))}
                {/* Warp arc over intermediate tiles */}
                <path
                    d="M42 28C78 3 186 3 222 28"
                    stroke="#10b981"
                    strokeWidth="1.8"
                    strokeDasharray="3.5 3"
                    strokeLinecap="round"
                />
                <path d="M217 24l6 4.5-7 .9" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                {/* Star emblem on destination cell 5 */}
                <path
                    d="M224 31l1.5 3.3 3.6.5-2.6 2.5.6 3.6-3.1-1.7-3.1 1.7.6-3.6-2.6-2.5 3.6-.5L224 31z"
                    fill="#10b981"
                    opacity="0.45"
                />
                {/* Origin phase-out orb */}
                <g transform="translate(40, 39)">
                    <g className="power-sim-warp-origin">
                        <circle cx="0" cy="0" r="6.2" fill="#10b981" stroke="#d1fae5" strokeWidth="1.2" />
                    </g>
                </g>
                {/* Destination phase-in orb */}
                <g transform="translate(224, 39)">
                    <g className="power-sim-warp-ring">
                        <circle cx="0" cy="0" r="11" stroke="#34d399" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
                    </g>
                    <g className="power-sim-warp-dest">
                        <circle cx="0" cy="0" r="6.5" fill="#10b981" stroke="#ecfdf5" strokeWidth="1.3" />
                    </g>
                </g>
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 264 68" fill="none" className={`power-sim-svg ${animCls}`} aria-hidden="true">
            {cellXs.map((x, idx) => (
                <g key={x}>
                    <rect
                        x={x}
                        y="22"
                        width="36"
                        height="30"
                        rx="6"
                        fill={
                            idx === 1 || idx === 3 || idx === 4
                                ? 'rgba(239, 68, 68, 0.13)'
                                : 'var(--power-stage-tile)'
                        }
                        stroke={idx >= 1 ? '#ef4444' : '#10b981'}
                        strokeWidth={idx === 1 ? '1.6' : '1.3'}
                    />
                    <text x={x + 6} y="32" fill="var(--power-stage-muted)" fontSize="7" fontWeight="700">
                        0{idx + 1}
                    </text>
                </g>
            ))}
            {/* Safe star tile 1 label (immune to nuke) */}
            <path
                d="M40 31.5l1.4 3 3.2.4-2.3 2.3.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.3 3.2-.4L40 31.5z"
                fill="#10b981"
                opacity="0.85"
            />
            <rect x="22" y="4" width="36" height="14" rx="4" fill="rgba(16, 185, 129, 0.14)" stroke="#10b981" strokeWidth="1" />
            <text x="40" y="13.5" textAnchor="middle" fill="#10b981" fontSize="8" fontWeight="800">
                ★ SAFE
            </text>
            {/* Range bar above cells 2..5 */}
            <rect x="68" y="4" width="174" height="14" rx="4" fill="rgba(239, 68, 68, 0.14)" stroke="#ef4444" strokeWidth="1" />
            <text x="155" y="13.5" textAnchor="middle" fill="#ef4444" fontSize="8" fontWeight="800">
                ±3 BLAST RADIUS
            </text>
            {/* Nuking player orb + expanding shockwave on cell 2 */}
            <g transform="translate(86, 39)">
                <g className="power-sim-nuke-wave">
                    <circle cx="0" cy="0" r="14" stroke="#ef4444" strokeWidth="1.6" />
                </g>
                <circle cx="0" cy="0" r="6.2" fill="#06b6d4" stroke="#ecfeff" strokeWidth="1.3" />
            </g>
            {/* Vaporizing enemy orbs on cells 4 & 5 */}
            <g transform="translate(178, 39)">
                <g className="power-sim-nuke-target">
                    <circle cx="0" cy="0" r="6.2" fill="#ef4444" stroke="#fee2e2" strokeWidth="1.2" />
                    <path d="M-3.2-3.2l6.4 6.4M3.2-3.2l-6.4 6.4" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />
                </g>
            </g>
            <g transform="translate(224, 39)">
                <g className="power-sim-nuke-target">
                    <circle cx="0" cy="0" r="6.2" fill="#ef4444" stroke="#fee2e2" strokeWidth="1.2" />
                    <path d="M-3.2-3.2l6.4 6.4M3.2-3.2l-6.4 6.4" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />
                </g>
            </g>
        </svg>
    );
}
