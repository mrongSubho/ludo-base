'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { type DeployModeId, useDeployTheme } from '@/lib/deployTheme';
import type { LobbyGameMode, LobbyMatchType } from './LobbyCommandDeck';

interface OrbitalCanopyDeckProps {
    gameMode: LobbyGameMode;
    onChangeGameMode: (mode: LobbyGameMode) => void;
    matchType: LobbyMatchType;
    onChangeMatchType: (type: LobbyMatchType) => void;
    sfxEnabled: boolean;
    hapticsEnabled: boolean;
    feeDock: React.ReactNode;
}

const RETRO_PALETTES: Record<
    DeployModeId,
    { hex: string; bright: string; tint: string; softGlow: string }
> = {
    quick: {
        hex: '#5CE1FF',
        bright: '#A5F3FC',
        tint: 'rgba(92, 225, 255, 0.24)',
        softGlow: 'rgba(92, 225, 255, 0.42)',
    },
    team: {
        hex: '#FBBF24',
        bright: '#FDE68A',
        tint: 'rgba(251, 191, 36, 0.24)',
        softGlow: 'rgba(251, 191, 36, 0.42)',
    },
    offline: {
        hex: '#34D399',
        bright: '#A7F3D0',
        tint: 'rgba(52, 211, 153, 0.24)',
        softGlow: 'rgba(52, 211, 153, 0.42)',
    },
};

const CANOPY_MODES: readonly { id: LobbyGameMode; label: string; startDeg: number; endDeg: number }[] = [
    { id: 'classic', label: 'CLASSIC', startDeg: -31.5, endDeg: -0.75 },
    { id: 'power', label: 'POWER', startDeg: 0.75, endDeg: 31.5 },
];

const CANOPY_FORMATIONS: readonly { id: LobbyMatchType; label: string; startDeg: number; endDeg: number }[] = [
    { id: '1v1', label: '1v1', startDeg: -26.5, endDeg: -9.3 },
    { id: '2v2', label: '2v2', startDeg: -8.3, endDeg: 8.3 },
    { id: '4P', label: '4P', startDeg: 9.3, endDeg: 26.5 },
];

const CX = 190;
const CY = 280;
const OUTER_R_OUT = 272;
const OUTER_R_IN = 226;
const INNER_R_OUT = 216;
const INNER_R_IN = 176;

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
    const rad = (deg * Math.PI) / 180;
    return {
        x: cx + r * Math.sin(rad),
        y: cy - r * Math.cos(rad),
    };
}

function describeAnnularWedge(
    cx: number,
    cy: number,
    rInner: number,
    rOuter: number,
    startDeg: number,
    endDeg: number,
): string {
    const oStart = polar(cx, cy, rOuter, startDeg);
    const oEnd = polar(cx, cy, rOuter, endDeg);
    const iEnd = polar(cx, cy, rInner, endDeg);
    const iStart = polar(cx, cy, rInner, startDeg);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return [
        `M ${oStart.x.toFixed(2)} ${oStart.y.toFixed(2)}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oEnd.x.toFixed(2)} ${oEnd.y.toFixed(2)}`,
        `L ${iEnd.x.toFixed(2)} ${iEnd.y.toFixed(2)}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iStart.x.toFixed(2)} ${iStart.y.toFixed(2)}`,
        'Z',
    ].join(' ');
}

function describeTopArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
    const p1 = polar(cx, cy, r, startDeg);
    const p2 = polar(cx, cy, r, endDeg);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

let orbitalAudioCtx: AudioContext | null = null;

function playOrbitalClick(freq: number, sfxEnabled: boolean): void {
    if (!sfxEnabled || typeof window === 'undefined') return;
    try {
        const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        if (!orbitalAudioCtx) orbitalAudioCtx = new Ctor();
        const ctx = orbitalAudioCtx;
        if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => undefined);
        }
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.58, now + 0.024);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.03);
    } catch {
        /* ignore WebAudio restriction */
    }
}

function triggerOrbitalHaptic(enabled: boolean): void {
    if (!enabled) return;
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(8);
        }
    } catch {
        /* ignore */
    }
}

/** Option B — Orbital Canopy Lobby Selector for the Retro theme. */
export function OrbitalCanopyDeck({
    gameMode,
    onChangeGameMode,
    matchType,
    onChangeMatchType,
    sfxEnabled,
    hapticsEnabled,
    feeDock,
}: OrbitalCanopyDeckProps) {
    const { mode: deployMode } = useDeployTheme();
    const palette = RETRO_PALETTES[deployMode] ?? RETRO_PALETTES.quick;
    const uid = useId().replace(/:/g, '');
    const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

    useEffect(() => onReducedMotionChange(setReducedMotion), []);

    const selectMode = useCallback(
        (next: LobbyGameMode) => {
            if (next === gameMode) return;
            playOrbitalClick(next === 'power' ? 740 : 580, sfxEnabled);
            triggerOrbitalHaptic(hapticsEnabled);
            onChangeGameMode(next);
        },
        [gameMode, sfxEnabled, hapticsEnabled, onChangeGameMode],
    );

    const selectFormation = useCallback(
        (next: LobbyMatchType) => {
            if (next === matchType) return;
            const freq = next === '1v1' ? 620 : next === '2v2' ? 720 : 820;
            playOrbitalClick(freq, sfxEnabled);
            triggerOrbitalHaptic(hapticsEnabled);
            onChangeMatchType(next);
        },
        [matchType, sfxEnabled, hapticsEnabled, onChangeMatchType],
    );

    const outerHousingPath = describeAnnularWedge(CX, CY, OUTER_R_IN, OUTER_R_OUT, -31.8, 31.8);
    const innerHousingPath = describeAnnularWedge(CX, CY, INNER_R_IN, INNER_R_OUT, -26.8, 26.8);

    const handleModeKeyDown = (idx: number, e: React.KeyboardEvent<SVGGElement>) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIdx = (idx + 1) % CANOPY_MODES.length;
            selectMode(CANOPY_MODES[nextIdx].id);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectMode(CANOPY_MODES[idx].id);
        }
    };

    const handleFormationKeyDown = (idx: number, e: React.KeyboardEvent<SVGGElement>) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            selectFormation(CANOPY_FORMATIONS[(idx + 1) % CANOPY_FORMATIONS.length].id);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            selectFormation(
                CANOPY_FORMATIONS[(idx - 1 + CANOPY_FORMATIONS.length) % CANOPY_FORMATIONS.length].id,
            );
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectFormation(CANOPY_FORMATIONS[idx].id);
        }
    };

    const transitionStyle = reducedMotion
        ? undefined
        : { transition: 'fill 160ms ease-out, stroke 160ms ease-out, opacity 160ms ease-out' };

    return (
        <section
            aria-label="Orbital Canopy Deployment Setup"
            className="w-full max-w-[390px] mx-auto flex flex-col items-center relative"
        >
            <svg
                viewBox="0 0 380 128"
                className="w-full h-auto overflow-visible select-none"
                role="presentation"
            >
                <defs>
                    <linearGradient id={`${uid}-active-fill`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={palette.hex} stopOpacity="0.28" />
                        <stop offset="55%" stopColor="#14223B" stopOpacity="0.92" />
                        <stop offset="100%" stopColor="#09101E" stopOpacity="0.96" />
                    </linearGradient>
                    <linearGradient id={`${uid}-idle-fill`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#101A2E" stopOpacity="0.72" />
                        <stop offset="100%" stopColor="#070C17" stopOpacity="0.90" />
                    </linearGradient>
                    <filter id={`${uid}-glow`} x="-15%" y="-15%" width="130%" height="130%">
                        <feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor={palette.hex} floodOpacity="0.52" />
                    </filter>
                </defs>

                {/* Backing canopy tracks */}
                <path
                    d={outerHousingPath}
                    fill="rgba(5, 9, 18, 0.72)"
                    stroke="rgba(148, 163, 184, 0.16)"
                    strokeWidth="1"
                />
                <path
                    d={innerHousingPath}
                    fill="rgba(4, 7, 14, 0.84)"
                    stroke="rgba(148, 163, 184, 0.14)"
                    strokeWidth="1"
                />

                {/* Outer Arc: CLASSIC vs POWER */}
                <g role="radiogroup" aria-label="Select Game Mode">
                    {CANOPY_MODES.map((m, idx) => {
                        const active = gameMode === m.id;
                        const pathD = describeAnnularWedge(
                            CX,
                            CY,
                            OUTER_R_IN + 1.5,
                            OUTER_R_OUT - 1.5,
                            m.startDeg,
                            m.endDeg,
                        );
                        const rimD = describeTopArc(CX, CY, OUTER_R_OUT - 3.5, m.startDeg + 1, m.endDeg - 1);
                        const midDeg = (m.startDeg + m.endDeg) / 2;
                        const labelPt = polar(CX, CY, (OUTER_R_IN + OUTER_R_OUT) / 2 + 1, midDeg);

                        return (
                            <g
                                key={m.id}
                                role="radio"
                                aria-checked={active}
                                aria-label={m.id === 'classic' ? 'Classic Mode' : 'Power Mode'}
                                tabIndex={active ? 0 : -1}
                                onClick={() => selectMode(m.id)}
                                onKeyDown={(e) => handleModeKeyDown(idx, e)}
                                className="cursor-pointer outline-none focus-visible:outline-none"
                                filter={active && !reducedMotion ? `url(#${uid}-glow)` : undefined}
                            >
                                <path
                                    d={pathD}
                                    fill={active ? `url(#${uid}-active-fill)` : `url(#${uid}-idle-fill)`}
                                    stroke={active ? palette.hex : 'rgba(148, 163, 184, 0.24)'}
                                    strokeWidth={active ? 1.8 : 1}
                                    style={transitionStyle}
                                />
                                {active && (
                                    <path
                                        d={rimD}
                                        fill="none"
                                        stroke={palette.bright}
                                        strokeWidth="1"
                                        strokeOpacity="0.65"
                                        pointerEvents="none"
                                    />
                                )}
                                <g
                                    transform={`translate(${labelPt.x.toFixed(2)}, ${labelPt.y.toFixed(2)}) rotate(${(midDeg * 0.45).toFixed(2)})`}
                                    pointerEvents="none"
                                >
                                    {m.id === 'power' ? (
                                        <g transform="translate(-31, -6)">
                                            <path
                                                d="M5.5 0.8L1.5 6.8H5L4.2 11.2L8.8 5.2H5.2L5.5 0.8Z"
                                                fill={active ? palette.bright : 'rgba(155, 176, 201, 0.55)'}
                                            />
                                            <text
                                                x="37"
                                                y="7.2"
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                                fill={active ? palette.bright : 'rgba(155, 176, 201, 0.62)'}
                                                fontSize="12"
                                                fontWeight="700"
                                                letterSpacing="2.2"
                                                style={{ fontFamily: 'var(--font-mono)' }}
                                            >
                                                POWER
                                            </text>
                                        </g>
                                    ) : (
                                        <text
                                            x="0"
                                            y="1"
                                            textAnchor="middle"
                                            dominantBaseline="middle"
                                            fill={active ? palette.bright : 'rgba(155, 176, 201, 0.62)'}
                                            fontSize="12"
                                            fontWeight="700"
                                            letterSpacing="2.4"
                                            style={{ fontFamily: 'var(--font-mono)' }}
                                        >
                                            {m.label}
                                        </text>
                                    )}
                                </g>
                            </g>
                        );
                    })}
                </g>

                {/* Inner Arc: 1v1 / 2v2 / 4P */}
                <g role="radiogroup" aria-label="Match Type">
                    {CANOPY_FORMATIONS.map((f, idx) => {
                        const active = matchType === f.id;
                        const pathD = describeAnnularWedge(
                            CX,
                            CY,
                            INNER_R_IN + 1.5,
                            INNER_R_OUT - 1.5,
                            f.startDeg,
                            f.endDeg,
                        );
                        const rimD = describeTopArc(CX, CY, INNER_R_OUT - 3.5, f.startDeg + 0.8, f.endDeg - 0.8);
                        const midDeg = (f.startDeg + f.endDeg) / 2;
                        const labelPt = polar(CX, CY, (INNER_R_IN + INNER_R_OUT) / 2 + 1, midDeg);

                        return (
                            <g
                                key={f.id}
                                role="radio"
                                aria-checked={active}
                                aria-label={`${f.label} Formation`}
                                tabIndex={active ? 0 : -1}
                                onClick={() => selectFormation(f.id)}
                                onKeyDown={(e) => handleFormationKeyDown(idx, e)}
                                className="cursor-pointer outline-none focus-visible:outline-none"
                                filter={active && !reducedMotion ? `url(#${uid}-glow)` : undefined}
                            >
                                <path
                                    d={pathD}
                                    fill={active ? `url(#${uid}-active-fill)` : 'transparent'}
                                    stroke={active ? palette.hex : 'rgba(148, 163, 184, 0.12)'}
                                    strokeWidth={active ? 1.8 : 0.8}
                                    style={transitionStyle}
                                />
                                {active && (
                                    <path
                                        d={rimD}
                                        fill="none"
                                        stroke={palette.bright}
                                        strokeWidth="1"
                                        strokeOpacity="0.6"
                                        pointerEvents="none"
                                    />
                                )}
                                <text
                                    x={labelPt.x.toFixed(2)}
                                    y={labelPt.y.toFixed(2)}
                                    transform={`rotate(${(midDeg * 0.45).toFixed(2)} ${labelPt.x.toFixed(2)} ${labelPt.y.toFixed(2)})`}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fill={active ? palette.bright : 'rgba(155, 176, 201, 0.72)'}
                                    fontSize="12"
                                    fontWeight="700"
                                    letterSpacing="1.4"
                                    pointerEvents="none"
                                    style={{ fontFamily: 'var(--font-mono)' }}
                                >
                                    {f.label}
                                </text>
                            </g>
                        );
                    })}
                </g>
            </svg>

            {/* Entry Fee Capsule tucked cleanly into the concave pocket below inner arc */}
            <div className="w-full max-w-[320px] -mt-2 relative z-40">
                {feeDock}
            </div>
        </section>
    );
}
