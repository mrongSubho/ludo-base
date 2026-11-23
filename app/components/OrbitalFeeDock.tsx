'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { type DeployModeId, useDeployTheme } from '@/lib/deployTheme';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { Button } from './Button';
import { HudCornerTicks } from './HudPrimitives';
import { ChevronGlyphIcon, WarningHexIcon } from './icons';

const RETRO_CAPSULE_ACCENTS: Record<DeployModeId, { hex: string; rgb: string; bright: string }> = {
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
    onConfirm: () => void;
    formatFee: (val: number) => string;
    /** Controls rendered inside the overlapping expanded drawer (e.g., EntryFeeKnob in 3077). */
    expandedBody: React.ReactNode;
    themeVariant?: '3077' | 'retro';
    expandedClassName?: string;
    showCornerTicks?: boolean;
    /** Render the expanded drawer as a true circular orbital pod. */
    circular?: boolean;
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
    onConfirm,
    formatFee,
    expandedBody,
    themeVariant = '3077',
    expandedClassName = 'fee-tier-expanded-3077',
    showCornerTicks = false,
    circular = false,
}: OrbitalFeeDockProps) {
    const { mode, theme: deployTheme } = useDeployTheme();
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => setReducedMotion(prefersReducedMotion()));
        const unsubscribe = onReducedMotionChange(setReducedMotion);
        return () => {
            window.cancelAnimationFrame(raf);
            unsubscribe();
        };
    }, []);

    const palette =
        themeVariant === '3077'
            ? { hex: deployTheme.hex, rgb: deployTheme.rgb, bright: deployTheme.bright }
            : (RETRO_CAPSULE_ACCENTS[mode] ?? RETRO_CAPSULE_ACCENTS.quick);

    const isOverBalance = wager > playableChips;
    const isDialOverBalance = dialWager > playableChips;
    const dangerBorder = themeVariant === '3077' ? 'rgba(244, 63, 94, 0.85)' : 'rgba(251, 113, 133, 0.85)';
    const dangerSoft = themeVariant === '3077' ? 'rgba(244, 63, 94, 0.55)' : 'rgba(251, 113, 133, 0.58)';

    return (
        <div
            ref={feeTierRef}
            className="fee-tier fee-tier-orbital-capsule relative z-40 rounded-full flex flex-col items-center border backdrop-blur-md"
            style={{
                background: themeVariant === '3077' ? 'rgba(6, 10, 18, 0.78)' : 'rgba(7, 13, 24, 0.86)',
                borderColor: isOverBalance ? dangerSoft : `rgba(${palette.rgb}, 0.44)`,
                boxShadow: isOverBalance
                    ? '0 0 16px rgba(244, 63, 94, 0.2)'
                    : `0 0 16px rgba(${palette.rgb}, 0.13), inset 0 1px 0 rgba(${palette.rgb}, 0.16)`,
            }}
        >
            <button
                type="button"
                onClick={onToggleOpen}
                aria-expanded={showFee}
                className={`w-full flex items-center justify-between px-4 py-2 rounded-full transition-[background-color,transform,opacity] duration-150 ${
                    showFee && circular
                        ? 'opacity-0 pointer-events-none scale-95'
                        : 'hover:bg-surface-hover active:scale-[0.99] cursor-pointer'
                }`}
            >
                <span
                    className="inline-flex items-center gap-2 text-ludo-xs label-chrome font-bold uppercase tracking-[0.2em]"
                    style={{ color: themeVariant === '3077' ? palette.bright : 'var(--ink-strong)' }}
                >
                    <OrbitalSparkGlyph color={wager > 0 ? palette.bright : 'var(--ink-muted)'} />
                    <span>Entry Fee</span>
                </span>
                <span className="inline-flex items-center gap-2">
                    <span
                        className={`text-ludo-sm font-mono font-bold tracking-wide tabular-nums ${
                            isOverBalance ? 'text-negative animate-knob-alert-blink' : ''
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
                    circular ? (
                        <motion.div
                            key="orbital-fee-dropdown"
                            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.72, y: 18 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={
                                reducedMotion
                                    ? { opacity: 0, transition: { duration: 0.1 } }
                                    : {
                                          opacity: 0,
                                          scale: 0.76,
                                          y: 14,
                                          transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
                                      }
                            }
                            transition={
                                reducedMotion
                                    ? { duration: 0.12 }
                                    : { type: 'spring', stiffness: 360, damping: 28, mass: 0.85 }
                            }
                            style={{
                                transformOrigin: '50% 24%',
                                background: 'radial-gradient(circle at 50% 38%, rgba(15, 22, 36, 0.98) 0%, rgba(5, 8, 15, 0.98) 100%)',
                                borderColor: isDialOverBalance ? dangerBorder : `rgba(${palette.rgb}, 0.82)`,
                                boxShadow: isDialOverBalance
                                    ? '0 0 26px rgba(244, 63, 94, 0.28), var(--panel-shadow)'
                                    : `0 0 28px rgba(${palette.rgb}, 0.26), var(--panel-shadow)`,
                            }}
                            className={`fee-tier fee-tier-orbital-pod ${expandedClassName} absolute -top-10 left-0 right-0 mx-auto z-40 w-[292px] max-w-[88vw] aspect-square rounded-full border backdrop-blur-2xl flex flex-col items-center justify-between pt-4 pb-5 px-4 overflow-hidden`}
                        >
                            {/* Concentric dashed orbital ring (counter-twists on orbital iris open/close) */}
                            <motion.svg
                                viewBox="0 0 300 300"
                                initial={reducedMotion ? false : { rotate: -38, opacity: 0.25, scale: 0.88 }}
                                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                                exit={reducedMotion ? { opacity: 0 } : { rotate: 28, opacity: 0, scale: 0.9 }}
                                transition={
                                    reducedMotion
                                        ? { duration: 0.1 }
                                        : { type: 'spring', stiffness: 260, damping: 24, mass: 0.9 }
                                }
                                className="pointer-events-none absolute inset-1.5 w-[calc(100%-12px)] h-[calc(100%-12px)]"
                                aria-hidden="true"
                            >
                                <circle
                                    cx="150"
                                    cy="150"
                                    r="147"
                                    fill="none"
                                    stroke={isDialOverBalance ? '#f43f5e' : palette.hex}
                                    strokeOpacity="0.28"
                                    strokeWidth="1.2"
                                    strokeDasharray="3 6"
                                />
                            </motion.svg>

                            {/* Compact top close pill nested inside upper chord */}
                            <button
                                type="button"
                                onClick={onClose}
                                aria-expanded={true}
                                className="relative z-10 inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-surface-recessed/75 border border-line-soft hover:bg-surface-hover active:scale-95 transition-[background-color,transform] cursor-pointer shrink-0"
                            >
                                <OrbitalSparkGlyph color={dialWager > 0 ? palette.bright : 'var(--ink-muted)'} />
                                <span
                                    className="text-ludo-xs label-chrome font-bold uppercase tracking-[0.18em]"
                                    style={{ color: palette.bright }}
                                >
                                    Entry Fee
                                </span>
                                <ChevronGlyphIcon
                                    direction="down"
                                    className="w-3 h-3 rotate-180 text-ink-muted"
                                />
                            </button>

                            {/* Center Rotary Dial (staggered inner iris bloom) */}
                            <motion.div
                                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                                transition={
                                    reducedMotion
                                        ? { duration: 0.1 }
                                        : { duration: 0.22, delay: 0.04, ease: [0.22, 1, 0.36, 1] }
                                }
                                className="relative z-10 w-full flex-1 flex items-center justify-center min-h-0"
                            >
                                {expandedBody}
                            </motion.div>

                            {/* Bottom warning + nested pill CTA */}
                            <div className="relative z-10 flex flex-col items-center gap-1.5 shrink-0">
                                {dialWarning && (
                                    <div
                                        role="alert"
                                        className="max-w-[204px] px-2.5 py-0.5 rounded-full bg-negative/15 border border-negative/40 text-negative flex items-center justify-center gap-1 text-ludo-xs font-mono font-bold"
                                    >
                                        <WarningHexIcon className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{dialWarning}</span>
                                    </div>
                                )}
                                <div className="w-[156px]">
                                    <Button
                                        variant={isDialOverBalance ? 'danger' : 'primary'}
                                        size="sm"
                                        fullWidth
                                        onClick={onConfirm}
                                        className="uppercase tracking-[0.14em] font-extrabold rounded-full"
                                    >
                                        Confirm · {formatFee(dialWager)}
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="orbital-fee-dropdown"
                            initial={{ opacity: 0, y: -4, scaleY: 0.94 }}
                            animate={{ opacity: 1, y: 0, scaleY: 1 }}
                            exit={{ opacity: 0, y: -4, scaleY: 0.94 }}
                            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                            style={{
                                transformOrigin: 'top center',
                                background: 'var(--panel-bg)',
                                borderColor: isDialOverBalance ? dangerBorder : `rgba(${palette.rgb}, 0.82)`,
                                boxShadow: isDialOverBalance
                                    ? '0 0 22px rgba(244, 63, 94, 0.25), var(--panel-shadow)'
                                    : `0 0 24px rgba(${palette.rgb}, 0.24), var(--panel-shadow)`,
                            }}
                            className={`fee-tier ${expandedClassName} absolute top-0 left-0 right-0 z-40 rounded-2xl border backdrop-blur-2xl flex flex-col items-center overflow-hidden`}
                        >
                            {showCornerTicks && <HudCornerTicks />}

                            <button
                                type="button"
                                onClick={onClose}
                                aria-expanded={true}
                                className="relative z-10 w-full flex items-center justify-between px-4 py-2 rounded-t-2xl hover:bg-surface-hover active:scale-[0.99] transition-[background-color,transform] cursor-pointer"
                            >
                                <span
                                    className="inline-flex items-center gap-2 text-ludo-xs label-chrome font-bold uppercase tracking-[0.2em]"
                                    style={{ color: themeVariant === '3077' ? palette.bright : 'var(--ink-strong)' }}
                                >
                                    <OrbitalSparkGlyph color={dialWager > 0 ? palette.bright : 'var(--ink-muted)'} />
                                    <span>Entry Fee</span>
                                </span>
                                <span className="inline-flex items-center gap-2">
                                    <span
                                        className={`text-ludo-sm font-mono font-bold tracking-wide tabular-nums ${
                                            isDialOverBalance ? 'text-negative animate-knob-alert-blink' : ''
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

                            <div className="relative z-10 w-full px-2.5 pb-3 pt-1 flex flex-col items-center gap-2">
                                {expandedBody}

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
                    )
                )}
            </AnimatePresence>
        </div>
    );
}
