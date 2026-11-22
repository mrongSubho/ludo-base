'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    DeploymentModeId,
    MODE_RAIL_STOPS,
    RAIL_HOUSING_MAX_DEG,
    RAIL_HOUSING_MIN_DEG,
    RAIL_MAX_ANGLE_DEG,
    RAIL_MIN_ANGLE_DEG,
    RAIL_RADIUS,
    RAIL_VIEWBOX_H,
    RAIL_VIEWBOX_W,
    angleToRailMode,
    describeRailArc,
    describeRailBand,
    modeToRailAngle,
    pointerToRailAngle,
    railArcPoint,
    stepRailMode,
} from '@/lib/modeRail';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

interface DeploymentModeRailProps {
    activeMode: DeploymentModeId;
    disabled?: boolean;
    sfxEnabled: boolean;
    hapticsEnabled: boolean;
    onSelectMode: (mode: DeploymentModeId) => void;
}

const TICK_ANGLES: readonly number[] = [
    -22, -17.5, -13, -8.75, -4.5, 0, 4.5, 8.75, 13, 17.5, 22,
];

const DETENT_FREQS: Record<DeploymentModeId, number> = {
    quick: 520,
    team: 640,
    offline: 760,
};

let railAudioCtx: AudioContext | null = null;

function playShuttleDetentClack(mode: DeploymentModeId, sfxEnabled: boolean): void {
    if (!sfxEnabled || typeof window === 'undefined') return;
    try {
        const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        if (!railAudioCtx) railAudioCtx = new Ctor();
        const ctx = railAudioCtx;
        if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => undefined);
        }

        const now = ctx.currentTime;
        const baseFreq = DETENT_FREQS[mode];

        // High mechanical latch snap
        const snapOsc = ctx.createOscillator();
        const snapGain = ctx.createGain();
        snapOsc.type = 'triangle';
        snapOsc.frequency.setValueAtTime(baseFreq * 1.6, now);
        snapOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.72, now + 0.016);
        snapGain.gain.setValueAtTime(0.06, now);
        snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.019);
        snapOsc.connect(snapGain);
        snapGain.connect(ctx.destination);
        snapOsc.start(now);
        snapOsc.stop(now + 0.02);

        // Low damped alloy detent thump
        const bodyOsc = ctx.createOscillator();
        const bodyGain = ctx.createGain();
        bodyOsc.type = 'sine';
        bodyOsc.frequency.setValueAtTime(165, now + 0.004);
        bodyOsc.frequency.exponentialRampToValueAtTime(78, now + 0.032);
        bodyGain.gain.setValueAtTime(0.055, now + 0.004);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.034);
        bodyOsc.connect(bodyGain);
        bodyGain.connect(ctx.destination);
        bodyOsc.start(now + 0.004);
        bodyOsc.stop(now + 0.036);
    } catch {
        /* ignore WebAudio autoplay restrictions */
    }
}

function triggerShuttleHaptic(enabled: boolean): void {
    if (!enabled) return;
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(6);
        }
    } catch {
        /* vibration unsupported */
    }
}

/**
 * Curved Magnetic Shuttle Rail for Deployment Mode Selection (QUICK · TEAM · OFFLINE).
 * Hugs the bottom orbital curve of the Action Dice pedestal with a machined
 * titanium track and a draggable knurled alloy thumb-shuttle.
 */
export function DeploymentModeRail({
    activeMode,
    disabled = false,
    sfxEnabled,
    hapticsEnabled,
    onSelectMode,
}: DeploymentModeRailProps) {
    const uid = useId().replace(/:/g, '');
    const svgRef = useRef<SVGSVGElement | null>(null);

    const [reducedMotion, setReducedMotion] = useState(false);
    const [dragAngle, setDragAngle] = useState<number | null>(null);
    const [displayAngle, setDisplayAngle] = useState<number>(() => modeToRailAngle(activeMode));

    const draggingRef = useRef(false);
    const movedRef = useRef(false);
    const startClientXRef = useRef(0);
    const lastDetentRef = useRef<DeploymentModeId>(activeMode);
    const displayAngleRef = useRef(displayAngle);
    displayAngleRef.current = displayAngle;

    useEffect(() => {
        setReducedMotion(prefersReducedMotion());
        return onReducedMotionChange(setReducedMotion);
    }, []);

    // Smoothly spring-glide the shuttle along the orbital curve when activeMode changes
    // (while not dragging). Honors prefers-reduced-motion by jumping immediately.
    useEffect(() => {
        if (dragAngle !== null) return;
        const target = modeToRailAngle(activeMode);
        lastDetentRef.current = activeMode;
        if (reducedMotion || Math.abs(displayAngleRef.current - target) < 0.05) {
            setDisplayAngle(target);
            return;
        }

        let raf = 0;
        let current = displayAngleRef.current;
        let velocity = 0;
        let lastTime = performance.now();

        const tick = (now: number) => {
            const dt = Math.min(0.032, Math.max(0.004, (now - lastTime) / 1000));
            lastTime = now;
            // Critically-damped magnetic snap spring
            const stiffness = 310;
            const damping = 30;
            const force = (target - current) * stiffness;
            velocity = (velocity + force * dt) * Math.exp(-damping * dt);
            current += velocity * dt;

            if (Math.abs(target - current) < 0.06 && Math.abs(velocity) < 0.25) {
                setDisplayAngle(target);
                return;
            }
            setDisplayAngle(current);
            raf = requestAnimationFrame(tick);
        };

        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [activeMode, dragAngle, reducedMotion]);

    const shuttleAngle = dragAngle ?? displayAngle;
    const previewMode = dragAngle !== null ? angleToRailMode(dragAngle) : activeMode;
    const activeStop =
        MODE_RAIL_STOPS.find((s) => s.id === previewMode) ?? MODE_RAIL_STOPS[0];
    const shuttlePos = railArcPoint(shuttleAngle, RAIL_RADIUS);

    // Precomputed static orbital chassis geometry
    const housingOuterPath = useMemo(
        () => describeRailBand(RAIL_HOUSING_MIN_DEG, RAIL_HOUSING_MAX_DEG, RAIL_RADIUS - 15.5, RAIL_RADIUS + 15.5),
        [],
    );
    const housingInnerLipPath = useMemo(
        () => describeRailArc(RAIL_HOUSING_MIN_DEG + 0.6, RAIL_HOUSING_MAX_DEG - 0.6, RAIL_RADIUS - 15),
        [],
    );
    const housingOuterLipPath = useMemo(
        () => describeRailArc(RAIL_HOUSING_MIN_DEG + 0.6, RAIL_HOUSING_MAX_DEG - 0.6, RAIL_RADIUS + 15),
        [],
    );
    const grooveTrackPath = useMemo(
        () => describeRailArc(RAIL_MIN_ANGLE_DEG - 3.6, RAIL_MAX_ANGLE_DEG + 3.6, RAIL_RADIUS),
        [],
    );
    const grooveInnerHighlightPath = useMemo(
        () => describeRailArc(RAIL_MIN_ANGLE_DEG - 3.2, RAIL_MAX_ANGLE_DEG + 3.2, RAIL_RADIUS + 5.2),
        [],
    );

    // Active lit trace sweeping from center/nearest rail span toward shuttle
    const activeTracePath = useMemo(() => {
        const spanHalf = 6.5;
        const a0 = Math.max(RAIL_MIN_ANGLE_DEG - 2.5, shuttleAngle - spanHalf);
        const a1 = Math.min(RAIL_MAX_ANGLE_DEG + 2.5, shuttleAngle + spanHalf);
        return describeRailArc(a0, a1, RAIL_RADIUS);
    }, [shuttleAngle]);

    const commitMode = useCallback(
        (target: DeploymentModeId) => {
            if (target !== activeMode) {
                playShuttleDetentClack(target, sfxEnabled);
                triggerShuttleHaptic(hapticsEnabled);
                onSelectMode(target);
            }
        },
        [activeMode, hapticsEnabled, onSelectMode, sfxEnabled],
    );

    const resolvePointerAngle = useCallback((clientX: number, clientY: number): number | null => {
        const svg = svgRef.current;
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const svgX = ((clientX - rect.left) / rect.width) * RAIL_VIEWBOX_W;
        const svgY = ((clientY - rect.top) / rect.height) * RAIL_VIEWBOX_H;
        return pointerToRailAngle(svgX, svgY);
    }, []);

    const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
        if (disabled) return;
        e.preventDefault();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* ignore if pointer capture unavailable */
        }
        draggingRef.current = true;
        movedRef.current = false;
        startClientXRef.current = e.clientX;
        lastDetentRef.current = activeMode;

        const ang = resolvePointerAngle(e.clientX, e.clientY);
        if (ang !== null) {
            const nearMode = angleToRailMode(ang);
            // If pointer lands near the current shuttle, begin continuous scrub immediately;
            // if user taps a different detent, let drag start smoothly or snap on release.
            if (Math.abs(ang - modeToRailAngle(activeMode)) < 8) {
                setDragAngle(ang);
            } else {
                // Allow immediate jump on clean click, or scrub if they keep dragging
                setDragAngle(ang);
                if (nearMode !== lastDetentRef.current) {
                    lastDetentRef.current = nearMode;
                    playShuttleDetentClack(nearMode, sfxEnabled);
                    triggerShuttleHaptic(hapticsEnabled);
                }
            }
        }
    };

    const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
        if (!draggingRef.current) return;
        if (Math.abs(e.clientX - startClientXRef.current) > 4) {
            movedRef.current = true;
        }
        const ang = resolvePointerAngle(e.clientX, e.clientY);
        if (ang === null) return;
        setDragAngle(ang);
        const crossedMode = angleToRailMode(ang);
        if (crossedMode !== lastDetentRef.current) {
            lastDetentRef.current = crossedMode;
            playShuttleDetentClack(crossedMode, sfxEnabled);
            triggerShuttleHaptic(hapticsEnabled);
        }
    };

    const finishPointer = (e: React.PointerEvent<SVGSVGElement>) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {
            /* ignore */
        }
        const finalAng = resolvePointerAngle(e.clientX, e.clientY) ?? dragAngle ?? shuttleAngle;
        const targetMode = angleToRailMode(finalAng);
        setDisplayAngle(finalAng);
        setDragAngle(null);
        if (targetMode !== activeMode) {
            // Audio already fired when crossing during scrub; fire if it was a single tap without crossing
            if (lastDetentRef.current !== targetMode) {
                playShuttleDetentClack(targetMode, sfxEnabled);
                triggerShuttleHaptic(hapticsEnabled);
            }
            onSelectMode(targetMode);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            commitMode(stepRailMode(activeMode, 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            commitMode(stepRailMode(activeMode, -1));
        } else if (e.key === 'Home') {
            e.preventDefault();
            commitMode('quick');
        } else if (e.key === 'End') {
            e.preventDefault();
            commitMode('offline');
        }
    };

    const leftCap = railArcPoint(RAIL_HOUSING_MIN_DEG + 1.4, RAIL_RADIUS);
    const rightCap = railArcPoint(RAIL_HOUSING_MAX_DEG - 1.4, RAIL_RADIUS);

    return (
        <div
            className="mode-rail-3077 relative w-full max-w-[316px] flex flex-col items-center select-none mt-0.5"
            role="radiogroup"
            aria-label="Deployment Mode Switcher"
            tabIndex={0}
            onKeyDown={handleKeyDown}
        >
            <svg
                ref={svgRef}
                viewBox={`0 0 ${RAIL_VIEWBOX_W} ${RAIL_VIEWBOX_H}`}
                className="w-full h-auto overflow-visible touch-none cursor-grab active:cursor-grabbing"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointer}
                onPointerCancel={finishPointer}
                aria-hidden="true"
            >
                <defs>
                    {/* Machined titanium chassis gradient */}
                    <linearGradient id={`rail-chassis-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#263244" />
                        <stop offset="38%" stopColor="#121925" />
                        <stop offset="100%" stopColor="#080c13" />
                    </linearGradient>

                    {/* Brushed alloy thumb shuttle body */}
                    <linearGradient id={`rail-shuttle-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#46556c" />
                        <stop offset="28%" stopColor="#222c3c" />
                        <stop offset="76%" stopColor="#121822" />
                        <stop offset="100%" stopColor="#090d14" />
                    </linearGradient>

                    {/* Upward holo projection cone from shuttle to dice pedestal */}
                    <radialGradient id={`rail-beam-${uid}`} cx="50%" cy="85%" r="72%">
                        <stop offset="0%" stopColor={activeStop.hex} stopOpacity="0.34" />
                        <stop offset="48%" stopColor={activeStop.hex} stopOpacity="0.1" />
                        <stop offset="100%" stopColor={activeStop.hex} stopOpacity="0" />
                    </radialGradient>

                    {/* Subtle neon glow filter for shuttle core & active trace */}
                    <filter id={`rail-glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation="2.6" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Upward light cone projecting from the active shuttle toward the dice pedestal */}
                <g
                    transform={`translate(${shuttlePos.x}, ${shuttlePos.y}) rotate(${-shuttleAngle})`}
                    className="pointer-events-none"
                >
                    <path
                        d="M -26 -8 L -46 -42 L 46 -42 L 26 -8 Z"
                        fill={`url(#rail-beam-${uid})`}
                    />
                </g>

                {/* Machined curved titanium housing bezel */}
                <path
                    d={housingOuterPath}
                    fill={`url(#rail-chassis-${uid})`}
                    stroke="rgba(148, 163, 184, 0.24)"
                    strokeWidth="1.15"
                    strokeLinejoin="round"
                />
                {/* Top & bottom bevel edge highlights */}
                <path
                    d={housingInnerLipPath}
                    fill="none"
                    stroke="rgba(226, 232, 240, 0.16)"
                    strokeWidth="0.9"
                    strokeLinecap="round"
                />
                <path
                    d={housingOuterLipPath}
                    fill="none"
                    stroke={activeStop.hex}
                    strokeOpacity="0.34"
                    strokeWidth="1"
                    strokeLinecap="round"
                />

                {/* End-cap micro fasteners */}
                {[leftCap, rightCap].map((pt, idx) => (
                    <g key={idx} className="pointer-events-none">
                        <circle
                            cx={pt.x}
                            cy={pt.y}
                            r="2.4"
                            fill="#090e16"
                            stroke="rgba(148, 163, 184, 0.38)"
                            strokeWidth="0.8"
                        />
                        <circle cx={pt.x} cy={pt.y} r="0.8" fill="rgba(203, 213, 225, 0.5)" />
                    </g>
                ))}

                {/* Precision laser-etched orbital tick scale along upper bezel */}
                {TICK_ANGLES.map((deg) => {
                    const isMajor =
                        Math.abs(deg - RAIL_MIN_ANGLE_DEG) < 0.1 ||
                        Math.abs(deg) < 0.1 ||
                        Math.abs(deg - RAIL_MAX_ANGLE_DEG) < 0.1;
                    const p1 = railArcPoint(deg, RAIL_RADIUS - (isMajor ? 13.8 : 12.2));
                    const p2 = railArcPoint(deg, RAIL_RADIUS - 8.6);
                    const isNearShuttle = Math.abs(deg - shuttleAngle) < 3;
                    return (
                        <line
                            key={deg}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={isNearShuttle ? activeStop.hex : 'rgba(148, 163, 184, 0.45)'}
                            strokeWidth={isMajor ? 1.5 : 0.9}
                            strokeLinecap="round"
                            opacity={isNearShuttle ? 0.95 : isMajor ? 0.7 : 0.4}
                        />
                    );
                })}

                {/* Deep recessed magnetic track groove */}
                <path
                    d={grooveTrackPath}
                    fill="none"
                    stroke="#04070d"
                    strokeWidth="12.5"
                    strokeLinecap="round"
                />
                <path
                    d={grooveInnerHighlightPath}
                    fill="none"
                    stroke="rgba(148, 163, 184, 0.18)"
                    strokeWidth="0.8"
                    strokeLinecap="round"
                />

                {/* Illuminated magnetic power trace beneath the shuttle */}
                <path
                    d={activeTracePath}
                    fill="none"
                    stroke={activeStop.hex}
                    strokeWidth="3"
                    strokeLinecap="round"
                    opacity="0.72"
                    filter={`url(#rail-glow-${uid})`}
                />

                {/* 3 sculpted magnetic detent wells */}
                {MODE_RAIL_STOPS.map((stop) => {
                    const pt = railArcPoint(stop.angleDeg, RAIL_RADIUS);
                    const isSelected = previewMode === stop.id;
                    return (
                        <g key={stop.id}>
                            <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="4.8"
                                fill="#070b12"
                                stroke={isSelected ? stop.hex : 'rgba(148, 163, 184, 0.3)'}
                                strokeWidth="1"
                            />
                            <circle
                                cx={pt.x}
                                cy={pt.y}
                                r={isSelected ? 2.2 : 1.7}
                                fill={stop.hex}
                                opacity={isSelected ? 1 : 0.35}
                            />
                        </g>
                    );
                })}

                {/* Physical Knurled Titanium Thumb-Shuttle riding tangent to the orbital arc */}
                <g
                    className="mode-rail-shuttle-3077"
                    transform={`translate(${shuttlePos.x}, ${shuttlePos.y}) rotate(${-shuttleAngle})`}
                >
                    {/* Shuttle chamfered outer alloy shell */}
                    <path
                        d="M -27 -10.5 L 27 -10.5 L 32 -5.5 L 32 5.5 L 27 10.5 L -27 10.5 L -32 5.5 L -32 -5.5 Z"
                        fill={`url(#rail-shuttle-${uid})`}
                        stroke={activeStop.hex}
                        strokeOpacity={dragAngle !== null ? 0.95 : 0.78}
                        strokeWidth="1.25"
                    />
                    {/* Top specular bevel */}
                    <line
                        x1="-25"
                        y1="-9.2"
                        x2="25"
                        y2="-9.2"
                        stroke="rgba(255, 255, 255, 0.28)"
                        strokeWidth="0.9"
                        strokeLinecap="round"
                    />
                    {/* Machined vertical knurling grip ridges (left & right flanks) */}
                    {[-22, -18, -14, 14, 18, 22].map((kx) => (
                        <g key={kx}>
                            <line
                                x1={kx}
                                y1="-6.2"
                                x2={kx}
                                y2="6.2"
                                stroke="#060910"
                                strokeWidth="1.35"
                                strokeLinecap="round"
                            />
                            <line
                                x1={kx + 0.95}
                                y1="-5.8"
                                x2={kx + 0.95}
                                y2="5.8"
                                stroke="rgba(226, 232, 240, 0.2)"
                                strokeWidth="0.7"
                                strokeLinecap="round"
                            />
                        </g>
                    ))}
                    {/* Center fiber-optic recessed lens */}
                    <rect
                        x="-8.5"
                        y="-6.2"
                        width="17"
                        height="12.4"
                        rx="3"
                        fill="#05080f"
                        stroke="rgba(148, 163, 184, 0.28)"
                        strokeWidth="0.8"
                    />
                    {/* Glowing mode-reactive core slit */}
                    <rect
                        x="-5.2"
                        y="-2.1"
                        width="10.4"
                        height="4.2"
                        rx="2.1"
                        fill={activeStop.hex}
                        filter={`url(#rail-glow-${uid})`}
                    />
                    <line
                        x1="-3.2"
                        y1="0"
                        x2="3.2"
                        y2="0"
                        stroke="#ffffff"
                        strokeWidth="1.15"
                        strokeLinecap="round"
                        opacity="0.92"
                    />
                    {/* Upward precision pointer notch aimed at the dice pedestal */}
                    <polygon
                        points="0,-14.4 -3.2,-10.8 3.2,-10.8"
                        fill={activeStop.hex}
                        filter={`url(#rail-glow-${uid})`}
                    />
                </g>

                {/* Curved telemetry labels underneath each detent */}
                {MODE_RAIL_STOPS.map((stop) => {
                    const labelPt = railArcPoint(stop.angleDeg, RAIL_RADIUS + 26.5);
                    const isSelected = previewMode === stop.id;
                    return (
                        <g
                            key={stop.id}
                            transform={`translate(${labelPt.x}, ${labelPt.y}) rotate(${-(stop.angleDeg * 0.45)})`}
                            className="pointer-events-none"
                        >
                            <text
                                x="0"
                                y="0"
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill={isSelected ? stop.hex : 'var(--ink-muted)'}
                                fontSize="9.5"
                                fontWeight="800"
                                letterSpacing="0.14em"
                                style={{
                                    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
                                    transition: 'fill 180ms ease',
                                }}
                            >
                                {stop.shortLabel}
                            </text>
                        </g>
                    );
                })}
            </svg>

            {/* Accessible radio buttons aligned invisibly for screen readers & keyboard users */}
            <div className="sr-only">
                {MODE_RAIL_STOPS.map((stop) => (
                    <button
                        key={stop.id}
                        type="button"
                        role="radio"
                        aria-checked={activeMode === stop.id}
                        onClick={() => commitMode(stop.id)}
                    >
                        {stop.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default DeploymentModeRail;
