'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { type DeployModeId, useDeployTheme } from '@/lib/deployTheme';
import { Button } from './Button';
import { ChevronGlyphIcon, WarningHexIcon } from './icons';

const ORBITAL_FEE_PRESETS = [
    { value: 0, label: 'FREE' },
    { value: 100, label: '100' },
    { value: 1_000, label: '1K' },
    { value: 10_000, label: '10K' },
    { value: 100_000, label: '100K' },
    { value: 1_000_000, label: '1M' },
    { value: 10_000_000, label: '10M' },
] as const;

const ORBITAL_ACCENTS: Record<DeployModeId, { hex: string; rgb: string; bright: string }> = {
    quick: { hex: '#5CE1FF', rgb: '92, 225, 255', bright: '#A5F3FC' },
    team: { hex: '#FBBF24', rgb: '251, 191, 36', bright: '#FDE68A' },
    offline: { hex: '#34D399', rgb: '52, 211, 153', bright: '#A7F3D0' },
};

interface OrbitalFeeDockProps {
    wager: number;
    dialWager: number;
    playableChips: number;
    showFee: boolean;
    dialWarning: string | null;
    feeTierRef: React.RefObject<HTMLDivElement | null>;
    onToggleOpen: () => void;
    onClose: () => void;
    onSelectPreset: (amount: number) => void;
    onConfirm: () => void;
    formatFee: (val: number) => string;
}

/** 4-point orbital star glyph from Option B Entry Fee capsule. */
const OrbitalSparkGlyph = ({ color }: { color: string }) => (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
        <path
            d="M8 1L9.6 6.4L15 8L9.6 9.6L8 15L6.4 9.6L1 8L6.4 6.4L8 1Z"
            fill={color}
        />
    </svg>
);

export function OrbitalFeeDock({
    wager,
    dialWager,
    playableChips,
    showFee,
    dialWarning,
    feeTierRef,
    onToggleOpen,
    onClose,
    onSelectPreset,
    onConfirm,
    formatFee,
}: OrbitalFeeDockProps) {
    const { mode } = useDeployTheme();
    const palette = ORBITAL_ACCENTS[mode] ?? ORBITAL_ACCENTS.quick;
    const isOverBalance = wager > playableChips;
    const isDialOverBalance = dialWager > playableChips;

    return (
        <div
            ref={feeTierRef}
            className="fee-tier relative z-40 rounded-full flex flex-col items-center border backdrop-blur-md"
            style={{
                background: 'rgba(7, 13, 24, 0.86)',
                borderColor: isOverBalance ? 'rgba(251, 113, 133, 0.58)' : `rgba(${palette.rgb}, 0.44)`,
                boxShadow: isOverBalance
                    ? '0 0 16px rgba(251, 113, 133, 0.2)'
                    : `0 0 18px rgba(${palette.rgb}, 0.14), inset 0 1px 0 rgba(${palette.rgb}, 0.18)`,
            }}
        >
            <button
                type="button"
                onClick={onToggleOpen}
                aria-expanded={showFee}
                className="w-full flex items-center justify-between px-4 py-2 rounded-full hover:bg-surface-hover active:scale-[0.99] transition-[background-color,transform] cursor-pointer"
            >
                <span className="inline-flex items-center gap-2 text-ludo-xs label-chrome font-bold uppercase tracking-[0.2em] text-ink-strong">
                    <OrbitalSparkGlyph color={wager > 0 ? palette.bright : 'var(--ink-muted)'} />
                    <span>Entry Fee</span>
                </span>
                <span className="inline-flex items-center gap-2">
                    <span
                        className={`text-ludo-sm font-mono font-bold tracking-wide tabular-nums ${
                            isOverBalance ? 'text-negative' : ''
                        }`}
                        style={isOverBalance ? undefined : { color: palette.bright }}
                    >
                        {formatFee(wager)}
                    </span>
                    <ChevronGlyphIcon
                        direction="down"
                        className={`w-3.5 h-3.5 text-ink-muted transition-transform duration-200 ${showFee ? 'rotate-180' : ''}`}
                    />
                </span>
            </button>

            <AnimatePresence initial={false}>
                {showFee && (
                    <motion.div
                        key="orbital-fee-dropdown"
                        initial={{ opacity: 0, y: -4, scaleY: 0.94 }}
                        animate={{ opacity: 1, y: 0, scaleY: 1 }}
                        exit={{ opacity: 0, y: -4, scaleY: 0.94 }}
                        transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                        style={{
                            transformOrigin: 'top center',
                            background: 'var(--panel-bg)',
                            borderColor: isDialOverBalance
                                ? 'rgba(251, 113, 133, 0.85)'
                                : `rgba(${palette.rgb}, 0.78)`,
                            boxShadow: isDialOverBalance
                                ? '0 0 24px rgba(251, 113, 133, 0.25), var(--panel-shadow)'
                                : `0 0 26px rgba(${palette.rgb}, 0.24), var(--panel-shadow)`,
                        }}
                        className="fee-tier fee-tier-expanded-retro absolute top-0 left-0 right-0 z-40 rounded-2xl border backdrop-blur-2xl flex flex-col items-center overflow-hidden"
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            aria-expanded={true}
                            className="relative z-10 w-full flex items-center justify-between px-4 py-2 rounded-t-2xl hover:bg-surface-hover active:scale-[0.99] transition-[background-color,transform] cursor-pointer"
                        >
                            <span className="inline-flex items-center gap-2 text-ludo-xs label-chrome font-bold uppercase tracking-[0.2em] text-ink-strong">
                                <OrbitalSparkGlyph color={dialWager > 0 ? palette.bright : 'var(--ink-muted)'} />
                                <span>Entry Fee</span>
                            </span>
                            <span className="inline-flex items-center gap-2">
                                <span
                                    className={`text-ludo-sm font-mono font-bold tracking-wide tabular-nums ${
                                        isDialOverBalance ? 'text-negative' : ''
                                    }`}
                                    style={isDialOverBalance ? undefined : { color: palette.bright }}
                                >
                                    {formatFee(dialWager)}
                                </span>
                                <ChevronGlyphIcon
                                    direction="down"
                                    className="w-3.5 h-3.5 rotate-180 text-ink-muted transition-transform duration-200"
                                />
                            </span>
                        </button>

                        <div className="relative z-10 w-full px-3 pb-3 pt-1 flex flex-col gap-2.5">
                            <div className="flex items-center justify-between px-2.5 py-1 rounded-full bg-surface-recessed border border-line-soft text-ludo-xs font-mono">
                                <span className="uppercase tracking-widest text-ink-muted">Playable</span>
                                <span className="font-bold text-ink-strong tabular-nums">
                                    {playableChips.toLocaleString()} CHIPS
                                </span>
                            </div>

                            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Entry Fee Presets">
                                {ORBITAL_FEE_PRESETS.map((preset) => {
                                    const active = dialWager === preset.value;
                                    const unaffordable = preset.value > playableChips;
                                    return (
                                        <button
                                            key={preset.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={active}
                                            onClick={() => onSelectPreset(preset.value)}
                                            className={`h-9 px-2 rounded-full border font-mono text-ludo-xs font-bold uppercase tracking-wider transition-[background-color,border-color,color,transform] active:scale-95 cursor-pointer ${
                                                active
                                                    ? 'text-accent-ink'
                                                    : unaffordable
                                                      ? 'bg-surface-recessed/60 border-line-soft text-ink-faint hover:text-ink-muted'
                                                      : 'bg-surface-recessed border-line-soft text-ink-strong hover:border-line-strong'
                                            }`}
                                            style={
                                                active
                                                    ? {
                                                          background: palette.hex,
                                                          borderColor: palette.bright,
                                                          boxShadow: `0 0 12px rgba(${palette.rgb}, 0.45)`,
                                                      }
                                                    : undefined
                                            }
                                        >
                                            {preset.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {dialWarning && (
                                <div
                                    role="alert"
                                    className="w-full px-3 py-1.5 rounded-xl bg-negative/15 border border-negative/40 text-negative flex items-center justify-center gap-1.5 text-ludo-xs font-mono font-bold"
                                >
                                    <WarningHexIcon className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{dialWarning}</span>
                                </div>
                            )}

                            <Button
                                variant={isDialOverBalance ? 'danger' : 'primary'}
                                size="md"
                                fullWidth
                                onClick={onConfirm}
                                className="uppercase tracking-[0.18em] font-extrabold rounded-full"
                            >
                                Confirm · {formatFee(dialWager)}
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
