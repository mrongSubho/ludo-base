'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { type DeployModeId, useDeployTheme } from '@/lib/deployTheme';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

export const RETRO_SYNTH_TIERS = [
    0,
    500,
    1_000,
    10_000,
    100_000,
    1_000_000,
    10_000_000,
] as const;

export const RETRO_SYNTH_LABELS = [
    'FREE',
    '500',
    '1K',
    '10K',
    '100K',
    '1M',
    '10M',
] as const;

/** Snap any numeric wager to the closest detent index (0..6) on the Synth VU ladder. */
export function nearestSynthTierIndex(wager: number): number {
    if (!Number.isFinite(wager) || wager <= 0) return 0;
    let bestIdx = 0;
    let bestDiff = Math.abs(wager - RETRO_SYNTH_TIERS[0]);
    for (let i = 1; i < RETRO_SYNTH_TIERS.length; i++) {
        const diff = Math.abs(wager - RETRO_SYNTH_TIERS[i]);
        if (diff <= bestDiff) {
            bestDiff = diff;
            bestIdx = i;
        }
    }
    return bestIdx;
}

const RETRO_FADER_PALETTE: Record<
    DeployModeId,
    { hex: string; rgb: string; bright: string }
> = {
    quick: { hex: '#5CE1FF', rgb: '92, 225, 255', bright: '#A5F3FC' },
    team: { hex: '#FBBF24', rgb: '251, 191, 36', bright: '#FDE68A' },
    offline: { hex: '#34D399', rgb: '52, 211, 153', bright: '#A7F3D0' },
};

interface RetroSynthFeeFaderProps {
    wager: number;
    playableChips: number;
    onChange: (nextWager: number) => void;
    sfxEnabled: boolean;
    formatBalance: (val: number) => string;
}

/**
 * Retro Arcade Synth VU-Meter & Knurled Step-Fader for Entry Fee selection.
 * Combines 7 ascending LED equalizer columns (1-tap select) with a draggable
 * alloy fader slider calibrated to the Retro deployment palette.
 */
export function RetroSynthFeeFader({
    wager,
    playableChips,
    onChange,
    sfxEnabled,
    formatBalance,
}: RetroSynthFeeFaderProps) {
    const { mode: deployMode } = useDeployTheme();
    const palette = RETRO_FADER_PALETTE[deployMode] ?? RETRO_FADER_PALETTE.quick;
    const sliderRef = useRef<HTMLDivElement | null>(null);
    const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
    const [dragging, setDragging] = useState(false);

    useEffect(() => onReducedMotionChange(setReducedMotion), []);

    const activeIdx = nearestSynthTierIndex(wager);
    const maxIdx = RETRO_SYNTH_TIERS.length - 1;
    const ratio = activeIdx / maxIdx;
    const isClipped = wager > playableChips;

    const triggerFeedback = useCallback(
        (tierIndex: number) => {
            if (sfxEnabled) {
                getSoundEngine().play('ui_knob_tick', { tierIndex });
            }
            getSoundEngine().triggerHaptic(5);
        },
        [sfxEnabled],
    );

    const selectIdx = useCallback(
        (nextIdx: number) => {
            const clamped = Math.max(0, Math.min(maxIdx, Math.round(nextIdx)));
            const nextVal = RETRO_SYNTH_TIERS[clamped];
            if (nextVal !== wager) {
                triggerFeedback(clamped);
                onChange(nextVal);
            }
        },
        [maxIdx, wager, triggerFeedback, onChange],
    );

    const pointerToIdx = useCallback(
        (clientX: number): number | null => {
            const el = sliderRef.current;
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            const usableWidth = Math.max(1, rect.width - 28);
            const raw = (clientX - (rect.left + 14)) / usableWidth;
            const clamped = Math.max(0, Math.min(1, raw));
            return Math.round(clamped * maxIdx);
        },
        [maxIdx],
    );

    const handleSliderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* ignore if pointer capture unavailable */
        }
        setDragging(true);
        const idx = pointerToIdx(e.clientX);
        if (idx !== null) selectIdx(idx);
    };

    const handleSliderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging) return;
        const idx = pointerToIdx(e.clientX);
        if (idx !== null) selectIdx(idx);
    };

    const finishSliderPointer = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging) return;
        setDragging(false);
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {
            /* ignore */
        }
    };

    const handleSliderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            selectIdx(activeIdx + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            selectIdx(activeIdx - 1);
        } else if (e.key === 'Home') {
            e.preventDefault();
            selectIdx(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            selectIdx(maxIdx);
        }
    };

    const motionTransition =
        dragging || reducedMotion
            ? 'none'
            : 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1)';

    return (
        <div className="retro-synth-fader w-full flex flex-col gap-2.5 select-none">
            {/* Recessed CRT Telemetry Screen */}
            <div
                className="relative rounded-xl border px-3 py-2 flex items-center justify-between gap-2 overflow-hidden"
                style={{
                    background:
                        'repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 3px), linear-gradient(180deg, #040812 0%, #070e1c 100%)',
                    borderColor: isClipped ? 'rgba(251, 113, 133, 0.52)' : `rgba(${palette.rgb}, 0.32)`,
                    boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.85)',
                }}
            >
                <div className="flex flex-col min-w-0">
                    <span className="text-ludo-xs font-mono font-bold uppercase tracking-[0.18em] text-ink-faint leading-none">
                        Stake Level
                    </span>
                    <span
                        className={`mt-1 text-ludo-lg font-mono font-extrabold tabular-nums leading-none truncate ${
                            isClipped ? 'text-negative' : ''
                        }`}
                        style={isClipped ? undefined : { color: palette.bright }}
                    >
                        {formatBalance(wager)} CHIPS
                    </span>
                </div>

                <div className="flex flex-col items-end shrink-0 gap-1">
                    <span
                        className={`px-2 py-0.5 rounded-full border text-ludo-xs font-mono font-extrabold uppercase tracking-wider leading-none ${
                            isClipped
                                ? 'bg-negative/15 border-negative/45 text-negative'
                                : 'bg-positive/10 border-positive/40 text-positive'
                        }`}
                    >
                        {isClipped ? 'CLIP' : 'READY'}
                    </span>
                    <span className="text-ludo-xs font-mono font-bold text-ink-muted tabular-nums leading-none">
                        BAL · {formatBalance(playableChips)}
                    </span>
                </div>
            </div>

            {/* 7-Column Ascending Phosphor VU Equalizer */}
            <div
                role="radiogroup"
                aria-label="Entry Fee Levels"
                className="rounded-xl border border-line-soft px-2 pt-2.5 pb-1.5 grid grid-cols-7 gap-1"
                style={{
                    background: 'rgba(4, 8, 17, 0.78)',
                    boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.72)',
                }}
            >
                {RETRO_SYNTH_TIERS.map((tier, idx) => {
                    const lit = idx <= activeIdx;
                    const current = idx === activeIdx;
                    const overBal = tier > playableChips;
                    const brickCount = idx + 2; // 2..8 bricks ascending

                    const tierHex =
                        overBal && lit
                            ? '#FB7185'
                            : idx <= 3
                              ? palette.hex
                              : idx === 4
                                ? '#FBBF24'
                                : '#FB7185';
                    const peakHex =
                        overBal && lit
                            ? '#FDA4AF'
                            : idx <= 3
                              ? palette.bright
                              : idx === 4
                                ? '#FDE68A'
                                : '#FDA4AF';

                    return (
                        <button
                            key={tier}
                            type="button"
                            role="radio"
                            aria-checked={current}
                            aria-label={`${RETRO_SYNTH_LABELS[idx]} CHIPS`}
                            onClick={() => selectIdx(idx)}
                            className={`group flex flex-col items-center justify-end gap-1 pt-1 pb-1 px-0.5 rounded-lg cursor-pointer transition-colors active:scale-95 ${
                                current ? 'bg-surface-active' : 'hover:bg-surface-hover'
                            }`}
                        >
                            {/* Ascending Brick Stack (bottom-aligned) */}
                            <div className="w-full h-12 flex flex-col-reverse items-center gap-[2px] justify-start px-0.5">
                                {Array.from({ length: brickCount }).map((_, b) => {
                                    const isTop = b === brickCount - 1;
                                    const fill = lit
                                        ? isTop
                                            ? peakHex
                                            : tierHex
                                        : overBal
                                          ? 'rgba(148, 163, 184, 0.10)'
                                          : 'rgba(148, 163, 184, 0.18)';

                                    return (
                                        <span
                                            key={b}
                                            className="w-full h-1 rounded-xs block"
                                            style={{
                                                backgroundColor: fill,
                                                opacity: lit ? (isTop ? 1 : 0.78) : 1,
                                                boxShadow:
                                                    lit && (current || isTop)
                                                        ? `0 0 6px ${tierHex}88`
                                                        : undefined,
                                            }}
                                            aria-hidden="true"
                                        />
                                    );
                                })}
                            </div>

                            <span
                                className="text-ludo-xs font-mono font-bold tracking-tight leading-none"
                                style={{
                                    color: current
                                        ? peakHex
                                        : lit
                                          ? tierHex
                                          : overBal
                                            ? 'var(--ink-faint)'
                                            : 'var(--ink-muted)',
                                }}
                            >
                                {RETRO_SYNTH_LABELS[idx]}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Draggable Knurled Alloy Step-Fader Track */}
            <div
                ref={sliderRef}
                role="slider"
                aria-label="Entry Fee Fader"
                aria-valuemin={0}
                aria-valuemax={maxIdx}
                aria-valuenow={activeIdx}
                aria-valuetext={RETRO_SYNTH_LABELS[activeIdx]}
                tabIndex={0}
                onKeyDown={handleSliderKeyDown}
                onPointerDown={handleSliderPointerDown}
                onPointerMove={handleSliderPointerMove}
                onPointerUp={finishSliderPointer}
                onPointerCancel={finishSliderPointer}
                className="relative h-9 px-3.5 rounded-xl border border-line-soft flex items-center touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
                style={{
                    background: 'rgba(5, 9, 18, 0.85)',
                    boxShadow: 'inset 0 2px 7px rgba(0, 0, 0, 0.78)',
                }}
            >
                {/* Channel Slot */}
                <div className="relative w-full h-2 rounded-full bg-[#03060d] border border-line-soft overflow-hidden">
                    <div
                        className="absolute inset-0 rounded-full origin-left"
                        style={{
                            background: isClipped
                                ? 'linear-gradient(90deg, #FB7185 0%, #F43F5E 100%)'
                                : `linear-gradient(90deg, rgba(${palette.rgb}, 0.45) 0%, ${palette.hex} 100%)`,
                            transform: `scaleX(${ratio})`,
                            transition: motionTransition,
                        }}
                    />
                </div>

                {/* 7 Detent Notches */}
                <div
                    className="pointer-events-none absolute inset-x-3.5 top-1/2 -translate-y-1/2 flex items-center justify-between"
                    aria-hidden="true"
                >
                    {RETRO_SYNTH_TIERS.map((tier, idx) => (
                        <span
                            key={tier}
                            className="w-[2px] h-3 rounded-full"
                            style={{
                                backgroundColor:
                                    idx <= activeIdx ? palette.bright : 'rgba(148, 163, 184, 0.28)',
                                opacity: idx === activeIdx ? 0 : 0.7,
                            }}
                        />
                    ))}
                </div>

                {/* Sliding Knurled Alloy Fader Cap (GPU transform only) */}
                <div
                    className="pointer-events-none absolute inset-y-0 left-3.5 right-3.5 flex items-center"
                    aria-hidden="true"
                >
                    <div
                        className="w-full flex items-center"
                        style={{
                            transform: `translateX(${ratio * 100}%)`,
                            transition: motionTransition,
                        }}
                    >
                        <div
                            className="w-7 h-7 -translate-x-1/2 rounded-lg border flex items-center justify-center gap-0.5"
                            style={{
                                background:
                                    'linear-gradient(180deg, #35445a 0%, #1a2332 54%, #0d131d 100%)',
                                borderColor: isClipped ? '#FB7185' : `${palette.hex}d9`,
                                boxShadow: `0 3px 10px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 0 12px ${
                                    isClipped ? 'rgba(251, 113, 133, 0.35)' : `rgba(${palette.rgb}, 0.32)`
                                }`,
                            }}
                        >
                            <span
                                className="w-[1.5px] h-3.5 rounded-sm opacity-65"
                                style={{ background: '#05080f' }}
                            />
                            <span
                                className="w-[2px] h-4 rounded-full"
                                style={{
                                    backgroundColor: isClipped ? '#FB7185' : palette.bright,
                                    boxShadow: `0 0 6px ${isClipped ? '#FB7185' : palette.hex}`,
                                }}
                            />
                            <span
                                className="w-[1.5px] h-3.5 rounded-sm opacity-65"
                                style={{ background: '#05080f' }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
