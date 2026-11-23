'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LuMinus, LuPlus } from 'react-icons/lu';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { useDeployTheme } from '@/lib/deployTheme';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { DAYBREAK_PALETTES } from './DaybreakStudioDeck';

export const DAYBREAK_FEE_TIERS = [
    0,
    500,
    1_000,
    10_000,
    100_000,
    500_000,
    1_000_000,
    3_000_000,
    5_000_000,
    10_000_000,
] as const;

export const DAYBREAK_FEE_LABELS = [
    'FREE',
    '500',
    '1K',
    '10K',
    '100K',
    '500K',
    '1M',
    '3M',
    '5M',
    '10M',
] as const;

export const DAYBREAK_TIER_NAMES = [
    'Scout',
    'Skirmish',
    'Standard',
    'Tactical',
    'Vanguard',
    'Command',
    'Apex',
    'Grand',
    'Titan',
    'Legend',
] as const;

const LANDMARK_INDICES = [0, 2, 3, 4, 6, 9] as const;

/** Clamp any wager to the closest detent index (0..9) on the Daybreak Vernier scale. */
export function nearestDaybreakTierIndex(wager: number): number {
    if (!Number.isFinite(wager) || wager <= 0) return 0;
    let bestIdx = 0;
    let bestDiff = Math.abs(wager - DAYBREAK_FEE_TIERS[0]);
    for (let i = 1; i < DAYBREAK_FEE_TIERS.length; i++) {
        const diff = Math.abs(wager - DAYBREAK_FEE_TIERS[i]);
        if (diff <= bestDiff) {
            bestDiff = diff;
            bestIdx = i;
        }
    }
    return bestIdx;
}

interface DaybreakFeePickerProps {
    wager: number;
    playableChips: number;
    onChange: (nextWager: number) => void;
    sfxEnabled: boolean;
    hapticsEnabled: boolean;
    formatBalance: (val: number) => string;
}

/**
 * Daybreak Precision Vernier Ruler & Ceramic Slide Puck for Entry Fee selection.
 * Pairs machined `-`/`+` ceramic steppers with a draggable milled scale track
 * (`scaleX` fill + `translateX` cylindrical puck — strictly compositor-only).
 */
export function DaybreakFeePicker({
    wager,
    playableChips,
    onChange,
    sfxEnabled,
    hapticsEnabled,
    formatBalance,
}: DaybreakFeePickerProps) {
    const { mode: deployMode } = useDeployTheme();
    const palette = DAYBREAK_PALETTES[deployMode] ?? DAYBREAK_PALETTES.quick;
    const sliderRef = useRef<HTMLDivElement | null>(null);
    const [dragging, setDragging] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => setReducedMotion(prefersReducedMotion()));
        const unsubscribe = onReducedMotionChange(setReducedMotion);
        return () => {
            window.cancelAnimationFrame(raf);
            unsubscribe();
        };
    }, []);

    const activeIdx = nearestDaybreakTierIndex(wager);
    const maxIdx = DAYBREAK_FEE_TIERS.length - 1;
    const ratio = activeIdx / maxIdx;
    const isOverBalance = wager > playableChips;
    const tierName = DAYBREAK_TIER_NAMES[activeIdx];
    const canStepDown = activeIdx > 0;
    const canStepUp = activeIdx < maxIdx;

    const triggerFeedback = useCallback(
        (tierIndex: number) => {
            if (sfxEnabled) {
                getSoundEngine().play('ui_knob_tick', { tierIndex });
            }
            if (hapticsEnabled) {
                getSoundEngine().triggerHaptic(5);
            }
        },
        [sfxEnabled, hapticsEnabled],
    );

    const selectIdx = useCallback(
        (nextIdx: number) => {
            const clamped = Math.max(0, Math.min(maxIdx, Math.round(nextIdx)));
            const nextVal = DAYBREAK_FEE_TIERS[clamped];
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
            : 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1)';

    return (
        <div className="w-full flex flex-col gap-3 select-none">
            {/* Editorial Tabular Readout + Machined Circular Steppers */}
            <div className="flex items-center justify-between gap-2 px-1">
                <button
                    type="button"
                    disabled={!canStepDown}
                    onClick={() => selectIdx(activeIdx - 1)}
                    aria-label="Decrease entry fee"
                    className="w-10 h-10 rounded-full border flex items-center justify-center active:scale-95 transition-transform disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer shrink-0"
                    style={{
                        background: 'linear-gradient(180deg, #FFFFFF 0%, #F4F1EA 100%)',
                        borderColor: canStepDown ? 'rgba(28, 25, 23, 0.16)' : 'rgba(28, 25, 23, 0.08)',
                        color: 'var(--ink-strong)',
                        boxShadow: canStepDown
                            ? '0 2px 6px rgba(28, 25, 23, 0.10), inset 0 1px 0 #FFFFFF'
                            : undefined,
                    }}
                >
                    <LuMinus className="w-4 h-4 stroke-[2.75px]" />
                </button>

                <div className="flex flex-col items-center text-center min-w-0">
                    <span
                        className={`text-2xl font-extrabold font-mono tabular-nums tracking-tight leading-none ${
                            isOverBalance ? 'text-negative' : ''
                        }`}
                        style={isOverBalance ? undefined : { color: palette.deep }}
                    >
                        {wager === 0 ? 'FREE' : formatBalance(wager)}
                    </span>
                    <span className="mt-1 text-ludo-xs font-bold uppercase tracking-[0.14em] text-ink-muted tabular-nums leading-none">
                        {wager === 0 ? `${tierName} · No Stake` : `CHIPS · ${tierName}`}
                    </span>
                    <span className="mt-0.5 text-ludo-xs font-mono font-semibold text-ink-faint tabular-nums leading-none">
                        Balance: {formatBalance(playableChips)}
                    </span>
                </div>

                <button
                    type="button"
                    disabled={!canStepUp}
                    onClick={() => selectIdx(activeIdx + 1)}
                    aria-label="Increase entry fee"
                    className="w-10 h-10 rounded-full border flex items-center justify-center active:scale-95 transition-transform disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer shrink-0"
                    style={{
                        background: 'linear-gradient(180deg, #FFFFFF 0%, #F4F1EA 100%)',
                        borderColor: canStepUp ? 'rgba(28, 25, 23, 0.16)' : 'rgba(28, 25, 23, 0.08)',
                        color: 'var(--ink-strong)',
                        boxShadow: canStepUp
                            ? '0 2px 6px rgba(28, 25, 23, 0.10), inset 0 1px 0 #FFFFFF'
                            : undefined,
                    }}
                >
                    <LuPlus className="w-4 h-4 stroke-[2.75px]" />
                </button>
            </div>

            {/* Precision Vernier Ruler Track + Ceramic Cylindrical Puck */}
            <div
                className="rounded-xl px-2.5 pt-2.5 pb-2 border"
                style={{
                    background: '#F2EEE6',
                    borderColor: 'rgba(28, 25, 23, 0.09)',
                    boxShadow: 'inset 0 2px 6px rgba(28, 25, 23, 0.08)',
                }}
            >
                {/* Engraved Architectural Scale Ticks */}
                <div className="px-3.5 flex items-end justify-between h-2.5 mb-1" aria-hidden="true">
                    {DAYBREAK_FEE_TIERS.map((tier, idx) => {
                        const isMajor = idx === 0 || idx === 3 || idx === 4 || idx === 6 || idx === 9;
                        const reached = idx <= activeIdx;
                        return (
                            <span
                                key={tier}
                                className={`w-px rounded-full ${isMajor ? 'h-2.5' : 'h-1.5'}`}
                                style={{
                                    backgroundColor: reached
                                        ? isOverBalance
                                            ? '#b91c1c'
                                            : palette.hex
                                        : 'rgba(28, 25, 23, 0.24)',
                                }}
                            />
                        );
                    })}
                </div>

                {/* Interactive Vernier Slider Groove */}
                <div
                    ref={sliderRef}
                    role="slider"
                    tabIndex={0}
                    aria-label="Entry fee"
                    aria-valuemin={0}
                    aria-valuemax={DAYBREAK_FEE_TIERS[maxIdx]}
                    aria-valuenow={wager}
                    aria-valuetext={
                        wager === 0
                            ? `${tierName}, Free`
                            : `${tierName}, ${formatBalance(wager)} CHIPS`
                    }
                    onPointerDown={handleSliderPointerDown}
                    onPointerMove={handleSliderPointerMove}
                    onPointerUp={finishSliderPointer}
                    onPointerCancel={finishSliderPointer}
                    onKeyDown={handleSliderKeyDown}
                    className="relative h-8 flex items-center touch-none cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
                >
                    {/* Recessed groove */}
                    <div
                        className="relative w-full h-2.5 rounded-full overflow-hidden border"
                        style={{
                            background: '#E3DDD2',
                            borderColor: 'rgba(28, 25, 23, 0.12)',
                            boxShadow: 'inset 0 1px 3px rgba(28, 25, 23, 0.16)',
                        }}
                    >
                        <div
                            className="h-full w-full origin-left rounded-full"
                            style={{
                                transform: `scaleX(${ratio})`,
                                transition: motionTransition,
                                backgroundColor: isOverBalance ? '#b91c1c' : palette.hex,
                                opacity: 0.85,
                            }}
                        />
                    </div>

                    {/* Cylindrical Ceramic Thumb Puck */}
                    <div className="pointer-events-none absolute inset-x-3.5 top-1/2 -translate-y-1/2 h-7">
                        <div
                            className="w-full h-full"
                            style={{
                                transform: `translateX(${ratio * 100}%)`,
                                transition: motionTransition,
                            }}
                        >
                            <div
                                className="-ml-3.5 w-7 h-7 rounded-full border flex items-center justify-center gap-0.5"
                                style={{
                                    background: 'linear-gradient(180deg, #FFFFFF 0%, #EFEAE0 100%)',
                                    borderColor: isOverBalance
                                        ? '#b91c1c'
                                        : `rgba(${palette.rgb}, 0.55)`,
                                    boxShadow:
                                        '0 3px 8px rgba(28, 25, 23, 0.22), inset 0 1px 0 #FFFFFF',
                                }}
                            >
                                <span
                                    className="w-px h-2.5 rounded-full"
                                    style={{ backgroundColor: 'rgba(28, 25, 23, 0.24)' }}
                                />
                                <span
                                    className="w-0.5 h-3.5 rounded-full"
                                    style={{
                                        backgroundColor: isOverBalance ? '#b91c1c' : palette.hex,
                                    }}
                                />
                                <span
                                    className="w-px h-2.5 rounded-full"
                                    style={{ backgroundColor: 'rgba(28, 25, 23, 0.24)' }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Compact 1-Tap Ruler Landmarks */}
            <div className="grid grid-cols-6 gap-1">
                {LANDMARK_INDICES.map((idx) => {
                    const tier = DAYBREAK_FEE_TIERS[idx];
                    const selected = activeIdx === idx;
                    const overBal = tier > playableChips;
                    return (
                        <button
                            key={tier}
                            type="button"
                            onClick={() => selectIdx(idx)}
                            className="min-h-[34px] rounded-lg border text-ludo-xs font-mono font-bold tabular-nums transition-colors cursor-pointer active:scale-95"
                            style={{
                                background: selected ? palette.tint : '#F7F4EE',
                                borderColor: selected
                                    ? isOverBalance
                                        ? '#b91c1c'
                                        : `rgba(${palette.rgb}, 0.50)`
                                    : 'rgba(28, 25, 23, 0.10)',
                                color: selected
                                    ? isOverBalance
                                        ? '#b91c1c'
                                        : palette.deep
                                    : overBal
                                      ? 'var(--ink-faint)'
                                      : 'var(--ink-muted)',
                            }}
                        >
                            {DAYBREAK_FEE_LABELS[idx]}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
