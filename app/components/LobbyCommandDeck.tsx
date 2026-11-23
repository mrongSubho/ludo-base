'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TEAM_PAIRINGS } from '@/lib/constants';
import { seatedColorsFor } from '@/lib/engine/core';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { useDeployTheme } from '@/lib/deployTheme';
import { ClassicGridIcon, OverdriveBoltIcon } from './icons';
import { TerminalTypeText } from './TerminalTypeText';

export type LobbyGameMode = 'classic' | 'power';
export type LobbyMatchType = '1v1' | '2v2' | '4P';

interface LobbyCommandDeckProps {
    gameMode: LobbyGameMode;
    onChangeGameMode: (mode: LobbyGameMode) => void;
    matchType: LobbyMatchType;
    onChangeMatchType: (type: LobbyMatchType) => void;
    sfxEnabled: boolean;
    hapticsEnabled: boolean;
    /** Lower docked Entry Fee bar (plus in-place expanding RetroSynthFeeFader drawer). */
    feeDock: React.ReactNode;
    /** Color palette variant — Retro uses Ice Cyan / Solar Amber / Phosphor Emerald. */
    themeVariant?: '3077' | 'retro';
}

const RETRO_DECK_PALETTES: Record<
    'quick' | 'team' | 'offline',
    { hex: string; rgb: string; bright: string }
> = {
    quick: { hex: '#5CE1FF', rgb: '92, 225, 255', bright: '#A5F3FC' },
    team: { hex: '#FBBF24', rgb: '251, 191, 36', bright: '#FDE68A' },
    offline: { hex: '#34D399', rgb: '52, 211, 153', bright: '#A7F3D0' },
};

const MODE_ORDER: readonly LobbyGameMode[] = ['power', 'classic'] as const;
const FORMATION_ORDER: readonly LobbyMatchType[] = ['1v1', '2v2', '4P'] as const;

const FORMATION_META: Record<LobbyMatchType, string> = {
    '1v1': '2P DUEL',
    '2v2': '2v2 SQUAD',
    '4P': '4P FFA',
};

const TEAM_HEX: Record<'green' | 'red' | 'blue' | 'yellow', string> = {
    green: '#00FF66',
    red: '#FF0055',
    blue: '#0099FF',
    yellow: '#FFD000',
};

const TEAM_HEX_RETRO: Record<'green' | 'red' | 'blue' | 'yellow', string> = {
    green: '#34D399',
    red: '#FB7185',
    blue: '#5CE1FF',
    yellow: '#FBBF24',
};

let deckAudioCtx: AudioContext | null = null;

function playDeckClick(freq: number, bodyFreq: number, sfxEnabled: boolean): void {
    if (!sfxEnabled || typeof window === 'undefined') return;
    try {
        const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        if (!deckAudioCtx) deckAudioCtx = new Ctor();
        const ctx = deckAudioCtx;
        if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => undefined);
        }

        const now = ctx.currentTime;
        const snapOsc = ctx.createOscillator();
        const snapGain = ctx.createGain();
        snapOsc.type = 'triangle';
        snapOsc.frequency.setValueAtTime(freq, now);
        snapOsc.frequency.exponentialRampToValueAtTime(freq * 0.62, now + 0.015);
        snapGain.gain.setValueAtTime(0.055, now);
        snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
        snapOsc.connect(snapGain);
        snapGain.connect(ctx.destination);
        snapOsc.start(now);
        snapOsc.stop(now + 0.02);

        const bodyOsc = ctx.createOscillator();
        const bodyGain = ctx.createGain();
        bodyOsc.type = 'sine';
        bodyOsc.frequency.setValueAtTime(bodyFreq, now + 0.003);
        bodyOsc.frequency.exponentialRampToValueAtTime(bodyFreq * 0.5, now + 0.028);
        bodyGain.gain.setValueAtTime(0.048, now + 0.003);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        bodyOsc.connect(bodyGain);
        bodyGain.connect(ctx.destination);
        bodyOsc.start(now + 0.003);
        bodyOsc.stop(now + 0.032);
    } catch {
        /* ignore WebAudio autoplay restrictions */
    }
}

function triggerDeckHaptic(ms: number, enabled: boolean): void {
    if (!enabled) return;
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(ms);
        }
    } catch {
        /* vibration unsupported */
    }
}

/** Mini holographic tactical board schematic faithfully reflecting seatedColorsFor & TEAM_PAIRINGS. */
function FormationRadarGlyph({
    type,
    accentHex,
    active,
    teamHex = TEAM_HEX,
}: {
    type: LobbyMatchType;
    accentHex: string;
    active: boolean;
    teamHex?: Record<'green' | 'red' | 'blue' | 'yellow', string>;
}) {
    const seated = seatedColorsFor(type);
    const dim = 'rgba(100, 116, 139, 0.35)';
    const tl = type === '2v2' ? teamHex.red : seated.includes('blue') ? teamHex.blue : dim;
    const tr = type === '2v2' ? teamHex[TEAM_PAIRINGS.green] : seated.includes('yellow') ? teamHex.yellow : dim;
    const bl = seated.includes('green') ? teamHex.green : dim;
    const br = type === '2v2' ? teamHex[TEAM_PAIRINGS.red] : seated.includes('red') ? teamHex.red : dim;

    return (
        <svg viewBox="0 0 22 22" className="w-5 h-5 shrink-0" aria-hidden="true">
            <rect
                x="2"
                y="2"
                width="18"
                height="18"
                rx="3.5"
                fill="rgba(4, 7, 13, 0.68)"
                stroke={active ? `${accentHex}75` : 'rgba(148, 163, 184, 0.24)'}
                strokeWidth="1"
            />
            {type === '1v1' && (
                <line
                    x1="6.5"
                    y1="15.5"
                    x2="15.5"
                    y2="6.5"
                    stroke={active ? accentHex : 'rgba(148, 163, 184, 0.45)'}
                    strokeWidth="1.25"
                    strokeDasharray="2 1.5"
                />
            )}
            {type === '2v2' && (
                <>
                    <line
                        x1="6.5"
                        y1="15.5"
                        x2="15.5"
                        y2="6.5"
                        stroke={teamHex[TEAM_PAIRINGS.green]}
                        strokeOpacity={active ? 0.88 : 0.48}
                        strokeWidth="1.15"
                    />
                    <line
                        x1="6.5"
                        y1="6.5"
                        x2="15.5"
                        y2="15.5"
                        stroke={teamHex.red}
                        strokeOpacity={active ? 0.88 : 0.48}
                        strokeWidth="1.15"
                    />
                </>
            )}
            {type === '4P' && (
                <path
                    d="M11 6.5 V15.5 M6.5 11 H15.5"
                    stroke={active ? `${accentHex}66` : 'rgba(148, 163, 184, 0.25)'}
                    strokeWidth="0.9"
                />
            )}
            <circle cx="6.5" cy="6.5" r={tl === dim ? 1.5 : 2.2} fill={tl} />
            <circle cx="15.5" cy="6.5" r={tr === dim ? 1.5 : 2.2} fill={tr} />
            <circle cx="6.5" cy="15.5" r={bl === dim ? 1.5 : 2.2} fill={bl} />
            <circle cx="15.5" cy="15.5" r={br === dim ? 1.5 : 2.2} fill={br} />
        </svg>
    );
}

/**
 * Option C: Retro Compact Dual-Bay Console housing:
 * 1. Left Bay (`// MODE`) — vertical dual slide-breaker (`POWER` top first, `CLASSIC` bottom)
 * 2. Right Bay (`// FORMATION`) — 3 vertical keycaps (`1v1`, `2v2`, `4P`) with corner radar glyphs
 * 3. Bottom Dock — RetroSynthFeeFader entry fee capsule & drawer
 */
export function LobbyCommandDeck({
    gameMode,
    onChangeGameMode,
    matchType,
    onChangeMatchType,
    sfxEnabled,
    hapticsEnabled,
    feeDock,
    themeVariant = 'retro',
}: LobbyCommandDeckProps) {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [reducedMotion, setReducedMotion] = useState(false);
    const [dragRatio, setDragRatio] = useState<number | null>(null);
    const draggingRef = useRef(false);
    const dragModeRef = useRef<LobbyGameMode>(gameMode);

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => setReducedMotion(prefersReducedMotion()));
        const unsubscribe = onReducedMotionChange(setReducedMotion);
        return () => {
            window.cancelAnimationFrame(raf);
            unsubscribe();
        };
    }, []);

    const { mode: deployMode, theme: deployTheme } = useDeployTheme();

    // 0 = POWER (top), 1 = CLASSIC (bottom)
    const activeRatio = dragRatio !== null ? dragRatio : gameMode === 'power' ? 0 : 1;
    const previewMode: LobbyGameMode = activeRatio < 0.5 ? 'power' : 'classic';
    const activePalette =
        themeVariant === 'retro'
            ? (RETRO_DECK_PALETTES[deployMode] ?? RETRO_DECK_PALETTES.quick)
            : deployTheme;
    const activeTeamHex = themeVariant === 'retro' ? TEAM_HEX_RETRO : TEAM_HEX;
    const accentHex = activePalette.hex;

    const commitGameMode = useCallback(
        (next: LobbyGameMode) => {
            if (next === gameMode) return;
            playDeckClick(next === 'power' ? 760 : 540, next === 'power' ? 175 : 140, sfxEnabled);
            triggerDeckHaptic(6, hapticsEnabled);
            onChangeGameMode(next);
        },
        [gameMode, hapticsEnabled, onChangeGameMode, sfxEnabled],
    );

    const commitMatchType = useCallback(
        (next: LobbyMatchType) => {
            if (next === matchType) return;
            const freqMap: Record<LobbyMatchType, number> = { '1v1': 560, '2v2': 640, '4P': 720 };
            playDeckClick(freqMap[next], 150, sfxEnabled);
            triggerDeckHaptic(4, hapticsEnabled);
            onChangeMatchType(next);
        },
        [hapticsEnabled, matchType, onChangeMatchType, sfxEnabled],
    );

    const pointerToRatio = useCallback((clientY: number): number | null => {
        const el = trackRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.height <= 0) return null;
        const raw = (clientY - rect.top) / rect.height;
        // Center of top slot (POWER) = 0.25, center of bottom slot (CLASSIC) = 0.75
        const mapped = (raw - 0.25) / 0.5;
        return Math.max(0, Math.min(1, mapped));
    }, []);

    const handleBreakerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* ignore if pointer capture unavailable */
        }
        draggingRef.current = true;
        dragModeRef.current = gameMode;

        const r = pointerToRatio(e.clientY);
        if (r !== null) {
            setDragRatio(r);
            const target: LobbyGameMode = r < 0.5 ? 'power' : 'classic';
            if (target !== dragModeRef.current) {
                dragModeRef.current = target;
                playDeckClick(target === 'power' ? 760 : 540, target === 'power' ? 175 : 140, sfxEnabled);
                triggerDeckHaptic(6, hapticsEnabled);
            }
        }
    };

    const handleBreakerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        const r = pointerToRatio(e.clientY);
        if (r === null) return;
        setDragRatio(r);
        const target: LobbyGameMode = r < 0.5 ? 'power' : 'classic';
        if (target !== dragModeRef.current) {
            dragModeRef.current = target;
            playDeckClick(target === 'power' ? 760 : 540, target === 'power' ? 175 : 140, sfxEnabled);
            triggerDeckHaptic(6, hapticsEnabled);
        }
    };

    const finishBreakerPointer = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {
            /* ignore */
        }
        const r = pointerToRatio(e.clientY) ?? dragRatio ?? (gameMode === 'power' ? 0 : 1);
        const target: LobbyGameMode = r < 0.5 ? 'power' : 'classic';
        setDragRatio(null);
        if (target !== gameMode) {
            if (dragModeRef.current !== target) {
                playDeckClick(target === 'power' ? 760 : 540, target === 'power' ? 175 : 140, sfxEnabled);
                triggerDeckHaptic(6, hapticsEnabled);
            }
            onChangeGameMode(target);
        }
    };

    const handleBreakerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'Home') {
            e.preventDefault();
            commitGameMode('power');
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'End') {
            e.preventDefault();
            commitGameMode('classic');
        } else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            commitGameMode(gameMode === 'power' ? 'classic' : 'power');
        }
    };

    return (
        <div
            className={`${
                themeVariant === 'retro' ? 'lobby-deck-retro' : 'lobby-deck-3077'
            } relative w-full overflow-visible rounded-2xl p-2.5 flex flex-col gap-2 backdrop-blur-md border`}
            style={{
                background:
                    'linear-gradient(180deg, rgba(10, 16, 30, 0.94) 0%, rgba(6, 11, 20, 0.96) 100%)',
                borderColor: `rgba(${activePalette.rgb}, 0.34)`,
                boxShadow: `0 16px 34px rgba(0, 0, 0, 0.56), 0 0 20px rgba(${activePalette.rgb}, 0.12), inset 0 1px 0 rgba(${activePalette.rgb}, 0.16)`,
            }}
        >
            {/* Subtle corner chassis pins */}
            <span aria-hidden="true" className="pointer-events-none absolute top-1.5 left-1.5 w-1 h-1 rounded-full bg-ink-faint/35" />
            <span aria-hidden="true" className="pointer-events-none absolute top-1.5 right-1.5 w-1 h-1 rounded-full bg-ink-faint/35" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 left-1.5 w-1 h-1 rounded-full bg-ink-faint/35" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 right-1.5 w-1 h-1 rounded-full bg-ink-faint/35" />

            {/* Dual-Bay Split Row: Left = Mode (vertical), Right = Formation (3 tall keys) */}
            <div className="grid grid-cols-[minmax(0,0.88fr)_minmax(0,1.26fr)] gap-2 items-stretch">
                {/* LEFT BAY: // MODE (POWER first on top, CLASSIC bottom) */}
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center justify-between px-1">
                        <span className="text-ludo-xs font-mono font-bold uppercase tracking-[0.18em] text-ink-faint">
                            {'// MODE'}
                        </span>
                        <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                                backgroundColor: accentHex,
                                boxShadow: `0 0 6px ${accentHex}`,
                            }}
                            aria-hidden="true"
                        />
                    </div>

                    <div
                        ref={trackRef}
                        role="radiogroup"
                        aria-label="Select Game Mode"
                        tabIndex={0}
                        onKeyDown={handleBreakerKeyDown}
                        onPointerDown={handleBreakerPointerDown}
                        onPointerMove={handleBreakerPointerMove}
                        onPointerUp={finishBreakerPointer}
                        onPointerCancel={finishBreakerPointer}
                        className="relative h-[84px] rounded-xl p-1 grid grid-rows-2 touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                        style={{
                            background: 'rgba(4, 7, 14, 0.84)',
                            border: `1px solid ${accentHex}2e`,
                            boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.82)',
                        }}
                    >
                        {/* Vertical Sliding Knurled Cartridge (strictly transform-only) */}
                        <div className="pointer-events-none absolute inset-1">
                            <div
                                className="w-full h-1/2 rounded-lg"
                                style={{
                                    transform: `translateY(${activeRatio * 100}%)`,
                                    transition:
                                        dragRatio !== null || reducedMotion
                                            ? 'none'
                                            : 'transform 190ms cubic-bezier(0.22, 1, 0.36, 1), border-color 180ms ease, box-shadow 180ms ease',
                                    background:
                                        'linear-gradient(180deg, #27354a 0%, #151e2e 58%, #0c121e 100%)',
                                    border: `1px solid ${accentHex}cc`,
                                    boxShadow: `0 4px 12px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(${activePalette.rgb}, 0.28), 0 0 14px ${accentHex}2a`,
                                }}
                            />
                        </div>

                        {MODE_ORDER.map((mode) => {
                            const selected = previewMode === mode;
                            return (
                                <button
                                    key={mode}
                                    type="button"
                                    role="radio"
                                    aria-checked={gameMode === mode}
                                    tabIndex={-1}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        commitGameMode(mode);
                                    }}
                                    className="relative z-10 flex items-center justify-between gap-1.5 px-2.5 text-ludo-xs font-mono font-extrabold uppercase tracking-[0.14em] transition-colors cursor-pointer"
                                    style={{
                                        color: selected ? activePalette.bright : 'var(--ink-muted)',
                                    }}
                                >
                                    <span className="inline-flex items-center gap-1.5 min-w-0">
                                        {mode === 'power' ? (
                                            <OverdriveBoltIcon
                                                className="w-3.5 h-3.5 shrink-0"
                                                active={selected}
                                            />
                                        ) : (
                                            <ClassicGridIcon
                                                className="w-3.5 h-3.5 shrink-0"
                                                active={selected}
                                            />
                                        )}
                                        <span className="truncate">{mode}</span>
                                    </span>
                                    <span
                                        className="w-1.5 h-1.5 rounded-full shrink-0"
                                        style={{
                                            backgroundColor: selected
                                                ? accentHex
                                                : 'rgba(100, 116, 139, 0.4)',
                                            boxShadow: selected ? `0 0 6px ${accentHex}` : undefined,
                                        }}
                                        aria-hidden="true"
                                    />
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* RIGHT BAY: // FORMATION (3 Vertical Keycaps 1v1 · 2v2 · 4P) */}
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center justify-between px-1 gap-1">
                        <span className="text-ludo-xs font-mono font-bold uppercase tracking-[0.16em] text-ink-faint shrink-0">
                            {'// FORMATION'}
                        </span>
                        <TerminalTypeText
                            text={FORMATION_META[matchType]}
                            charMs={18}
                            className="text-ludo-xs font-mono font-bold uppercase tracking-[0.12em]"
                            style={{ color: activePalette.bright }}
                        />
                    </div>

                    <div
                        role="radiogroup"
                        aria-label="Match Type"
                        className="h-[84px] rounded-xl p-1 grid grid-cols-3 gap-1.5"
                        style={{
                            background: 'rgba(4, 7, 14, 0.84)',
                            border: `1px solid ${accentHex}29`,
                            boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.82)',
                        }}
                    >
                        {FORMATION_ORDER.map((type) => {
                            const active = matchType === type;
                            return (
                                <button
                                    key={type}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    onClick={() => commitMatchType(type)}
                                    className="relative h-full rounded-lg flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-[border-color,box-shadow,transform] active:scale-[0.98]"
                                    style={
                                        active
                                            ? {
                                                  background: `linear-gradient(180deg, rgba(${activePalette.rgb}, 0.16) 0%, rgba(${activePalette.rgb}, 0.06) 100%)`,
                                                  border: `1px solid ${accentHex}cc`,
                                                  boxShadow: `inset 0 2px 8px rgba(0, 0, 0, 0.78), 0 0 12px ${accentHex}2e`,
                                              }
                                            : {
                                                  background:
                                                      'linear-gradient(180deg, #172030 0%, #0d1320 100%)',
                                                  border: '1px solid rgba(148, 163, 184, 0.16)',
                                                  boxShadow:
                                                      '0 2px 0 #04070d, inset 0 1px 0 rgba(255, 255, 255, 0.08)',
                                              }
                                    }
                                >
                                    {active && (
                                        <span
                                            className="absolute top-0 left-2.5 right-2.5 h-[2px] rounded-b-full"
                                            style={{
                                                backgroundColor: accentHex,
                                                boxShadow: `0 0 6px ${accentHex}`,
                                            }}
                                            aria-hidden="true"
                                        />
                                    )}
                                    <FormationRadarGlyph
                                        type={type}
                                        accentHex={accentHex}
                                        active={active}
                                        teamHex={activeTeamHex}
                                    />
                                    <span
                                        className="text-ludo-sm font-mono font-extrabold leading-none tracking-wider"
                                        style={{ color: active ? accentHex : 'var(--ink-muted)' }}
                                    >
                                        {type}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom Entry Fee Telemetry Dock (keeps RetroSynthFeeFader intact) */}
            {feeDock}
        </div>
    );
}

export default LobbyCommandDeck;
