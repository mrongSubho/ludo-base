'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TEAM_PAIRINGS } from '@/lib/constants';
import { seatedColorsFor } from '@/lib/engine/core';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { ClassicGridIcon, OverdriveBoltIcon } from './icons';

export type LobbyGameMode = 'classic' | 'power';
export type LobbyMatchType = '1v1' | '2v2' | '4P';

interface LobbyCommandDeckProps {
    gameMode: LobbyGameMode;
    onChangeGameMode: (mode: LobbyGameMode) => void;
    matchType: LobbyMatchType;
    onChangeMatchType: (type: LobbyMatchType) => void;
    sfxEnabled: boolean;
    hapticsEnabled: boolean;
    /** Lower docked Entry Fee bar (plus in-place expanding EntryFeeKnob dropdown). */
    feeDock: React.ReactNode;
}

const MODE_ORDER: readonly LobbyGameMode[] = ['power', 'classic'] as const;
const FORMATION_ORDER: readonly LobbyMatchType[] = ['1v1', '2v2', '4P'] as const;

const FORMATION_META: Record<LobbyMatchType, string> = {
    '1v1': '2P DIAGONAL DUEL',
    '2v2': '2v2 SQUAD PAIRS',
    '4P': '4P FREE-FOR-ALL',
};

const TEAM_HEX: Record<'green' | 'red' | 'blue' | 'yellow', string> = {
    green: '#00FF66',
    red: '#FF0055',
    blue: '#0099FF',
    yellow: '#FFD000',
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
}: {
    type: LobbyMatchType;
    accentHex: string;
    active: boolean;
}) {
    const seated = seatedColorsFor(type);
    const dim = 'rgba(100, 116, 139, 0.35)';
    const tl = type === '2v2' ? TEAM_HEX.red : seated.includes('blue') ? TEAM_HEX.blue : dim;
    const tr = type === '2v2' ? TEAM_HEX[TEAM_PAIRINGS.green] : seated.includes('yellow') ? TEAM_HEX.yellow : dim;
    const bl = seated.includes('green') ? TEAM_HEX.green : dim;
    const br = type === '2v2' ? TEAM_HEX[TEAM_PAIRINGS.red] : seated.includes('red') ? TEAM_HEX.red : dim;

    return (
        <svg viewBox="0 0 22 22" className="w-[18px] h-[18px] shrink-0" aria-hidden="true">
            <rect
                x="2"
                y="2"
                width="18"
                height="18"
                rx="3"
                fill="rgba(4, 7, 13, 0.65)"
                stroke={active ? `${accentHex}66` : 'rgba(148, 163, 184, 0.22)'}
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
                        stroke={TEAM_HEX[TEAM_PAIRINGS.green]}
                        strokeOpacity={active ? 0.85 : 0.45}
                        strokeWidth="1.15"
                    />
                    <line
                        x1="6.5"
                        y1="6.5"
                        x2="15.5"
                        y2="15.5"
                        stroke={TEAM_HEX.red}
                        strokeOpacity={active ? 0.85 : 0.45}
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
            <circle cx="6.5" cy="6.5" r={tl === dim ? 1.5 : 2.15} fill={tl} />
            <circle cx="15.5" cy="6.5" r={tr === dim ? 1.5 : 2.15} fill={tr} />
            <circle cx="6.5" cy="15.5" r={bl === dim ? 1.5 : 2.15} fill={bl} />
            <circle cx="15.5" cy="15.5" r={br === dim ? 1.5 : 2.15} fill={br} />
        </svg>
    );
}

/**
 * Unified 3077 Tactical Command Console housing:
 * 1. Armed Ruleset Slide-Breaker (POWER left -> Amber | CLASSIC right -> Cyan)
 * 2. 3-Bay Mechanical Radar Formation Matrix (1v1 · 2v2 · 4P)
 * 3. Docked Entry Fee Telemetry Slot (expands EntryFeeKnob in-place)
 */
export function LobbyCommandDeck({
    gameMode,
    onChangeGameMode,
    matchType,
    onChangeMatchType,
    sfxEnabled,
    hapticsEnabled,
    feeDock,
}: LobbyCommandDeckProps) {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [reducedMotion, setReducedMotion] = useState(false);
    const [dragRatio, setDragRatio] = useState<number | null>(null);
    const draggingRef = useRef(false);
    const dragModeRef = useRef<LobbyGameMode>(gameMode);

    useEffect(() => {
        setReducedMotion(prefersReducedMotion());
        return onReducedMotionChange(setReducedMotion);
    }, []);

    // Preview mode follows live drag across midpoint; 0 = POWER (left), 1 = CLASSIC (right)
    const activeRatio = dragRatio !== null ? dragRatio : gameMode === 'power' ? 0 : 1;
    const previewMode: LobbyGameMode = activeRatio < 0.5 ? 'power' : 'classic';
    const isPower = previewMode === 'power';
    const accentHex = isPower ? '#F59E0B' : '#00E5FF';

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

    const pointerToRatio = useCallback((clientX: number): number | null => {
        const el = trackRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return null;
        const raw = (clientX - rect.left) / rect.width;
        // Center of left slot = 0.25, center of right slot = 0.75 -> map to [0, 1]
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

        const r = pointerToRatio(e.clientX);
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
        const r = pointerToRatio(e.clientX);
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
        const r = pointerToRatio(e.clientX) ?? dragRatio ?? (gameMode === 'power' ? 0 : 1);
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
        if (e.key === 'ArrowLeft' || e.key === 'Home') {
            e.preventDefault();
            commitGameMode('power');
        } else if (e.key === 'ArrowRight' || e.key === 'End') {
            e.preventDefault();
            commitGameMode('classic');
        } else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            commitGameMode(gameMode === 'power' ? 'classic' : 'power');
        }
    };

    return (
        <div
            className="lobby-deck-3077 relative w-full overflow-visible rounded-[18px] p-2.5 sm:p-3 flex flex-col gap-2.5"
            style={{
                background: 'linear-gradient(180deg, #151e2d 0%, #0b1019 52%, #070b12 100%)',
                border: `1px solid ${accentHex}4d`,
                boxShadow: `0 12px 28px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(226, 232, 240, 0.14), 0 0 20px ${accentHex}14`,
            }}
        >
            {/* 4 CNC corner micro-fastener rivets */}
            <span className="lobby-deck-rivet top-1.5 left-1.5" aria-hidden="true" />
            <span className="lobby-deck-rivet top-1.5 right-1.5" aria-hidden="true" />
            <span className="lobby-deck-rivet bottom-1.5 left-1.5" aria-hidden="true" />
            <span className="lobby-deck-rivet bottom-1.5 right-1.5" aria-hidden="true" />

            {/* ROW 1: RULESET — Armed Slide-Breaker (POWER first on left, CLASSIC on right) */}
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1">
                    <span className="text-ludo-xs font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
                        {'// RULESET'}
                    </span>
                    <span
                        className="text-ludo-xs font-mono font-bold uppercase tracking-[0.14em]"
                        style={{ color: accentHex }}
                    >
                        {isPower ? '6 POWER TILES · BOOSTS ON' : 'ORIGINAL RULES · NO BOOSTS'}
                    </span>
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
                    className="relative h-[42px] rounded-[11px] p-[3px] grid grid-cols-2 touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                    style={{
                        background: '#04070d',
                        border: '1px solid rgba(148, 163, 184, 0.18)',
                        boxShadow: 'inset 0 3px 8px rgba(0, 0, 0, 0.85)',
                    }}
                >
                    {/* Physical Knurled Alloy Slide-Actuator */}
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute top-[3px] bottom-[3px] left-[3px] rounded-[8px] flex items-center justify-between px-2.5"
                        style={{
                            width: 'calc(50% - 3px)',
                            transform: `translateX(${activeRatio * 100}%)`,
                            transition:
                                dragRatio !== null || reducedMotion
                                    ? 'none'
                                    : 'transform 190ms cubic-bezier(0.22, 1, 0.36, 1), border-color 180ms ease, box-shadow 180ms ease',
                            background: 'linear-gradient(180deg, #35445a 0%, #1a2332 54%, #0d131d 100%)',
                            border: `1px solid ${accentHex}cc`,
                            boxShadow: `0 4px 12px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 0 16px ${accentHex}30`,
                        }}
                    >
                        {/* Left machined knurl ridges */}
                        <span className="flex items-center gap-[2px] opacity-60">
                            <span className="w-[1.5px] h-3.5 rounded-sm" style={{ background: '#05080f', boxShadow: '1px 0 0 rgba(226,232,240,0.22)' }} />
                            <span className="w-[1.5px] h-3.5 rounded-sm" style={{ background: '#05080f', boxShadow: '1px 0 0 rgba(226,232,240,0.22)' }} />
                        </span>
                        {/* Right machined knurl ridges */}
                        <span className="flex items-center gap-[2px] opacity-60">
                            <span className="w-[1.5px] h-3.5 rounded-sm" style={{ background: '#05080f', boxShadow: '1px 0 0 rgba(226,232,240,0.22)' }} />
                            <span className="w-[1.5px] h-3.5 rounded-sm" style={{ background: '#05080f', boxShadow: '1px 0 0 rgba(226,232,240,0.22)' }} />
                        </span>
                    </div>

                    {MODE_ORDER.map((mode) => {
                        const selected = previewMode === mode;
                        const modeHex = mode === 'power' ? '#F59E0B' : '#00E5FF';
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
                                className="relative z-10 flex items-center justify-center gap-1.5 px-2 text-ludo-sm font-mono font-extrabold uppercase tracking-[0.14em] transition-colors cursor-pointer"
                                style={{ color: selected ? modeHex : 'var(--ink-muted)' }}
                            >
                                {mode === 'power' ? (
                                    <OverdriveBoltIcon className="w-3.5 h-3.5 shrink-0" active={selected} />
                                ) : (
                                    <ClassicGridIcon className="w-3.5 h-3.5 shrink-0" active={selected} />
                                )}
                                <span>{mode}</span>
                                <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{
                                        backgroundColor: selected ? modeHex : 'rgba(100, 116, 139, 0.45)',
                                        boxShadow: selected ? `0 0 6px ${modeHex}` : undefined,
                                    }}
                                    aria-hidden="true"
                                />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ROW 2: FORMATION — 3-Bay Depressing Mechanical Radar Matrix (1v1 · 2v2 · 4P) */}
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1">
                    <span className="text-ludo-xs font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
                        {'// FORMATION'}
                    </span>
                    <span
                        className="text-ludo-xs font-mono font-bold uppercase tracking-[0.14em]"
                        style={{ color: accentHex }}
                    >
                        {FORMATION_META[matchType]}
                    </span>
                </div>

                <div
                    role="radiogroup"
                    aria-label="Match Type"
                    className="rounded-[12px] p-1 grid grid-cols-3 gap-1.5"
                    style={{
                        background: '#04070d',
                        border: '1px solid rgba(148, 163, 184, 0.14)',
                        boxShadow: 'inset 0 2px 7px rgba(0, 0, 0, 0.85)',
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
                                className="relative h-[46px] rounded-[9px] flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-[border-color,box-shadow,transform] active:scale-[0.98]"
                                style={
                                    active
                                        ? {
                                              background: isPower
                                                  ? 'linear-gradient(180deg, #1b1408 0%, #24190a 100%)'
                                                  : 'linear-gradient(180deg, #0b1622 0%, #102030 100%)',
                                              border: `1px solid ${accentHex}bf`,
                                              boxShadow: `inset 0 2px 8px rgba(0, 0, 0, 0.85), 0 0 12px ${accentHex}2e`,
                                          }
                                        : {
                                              background: 'linear-gradient(180deg, #1b2433 0%, #101622 100%)',
                                              border: '1px solid rgba(148, 163, 184, 0.16)',
                                              boxShadow: '0 2px 0 #04070d, inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                          }
                                }
                            >
                                {/* Recessed top LED indicator bar on active depressed key */}
                                {active && (
                                    <span
                                        className="absolute top-0 left-3 right-3 h-[2px] rounded-b-full"
                                        style={{
                                            backgroundColor: accentHex,
                                            boxShadow: `0 0 6px ${accentHex}`,
                                        }}
                                        aria-hidden="true"
                                    />
                                )}
                                <FormationRadarGlyph type={type} accentHex={accentHex} active={active} />
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

            {/* ROW 3: Docked Entry Fee Telemetry Slot */}
            {feeDock}
        </div>
    );
}

export default LobbyCommandDeck;
