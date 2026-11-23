'use client';

import React, { useEffect, useState } from 'react';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import type { DeployModeId } from '@/lib/deployTheme';

interface OrbitalModeDockProps {
    activeMode: DeployModeId;
    disabled?: boolean;
    onSelectMode: (mode: DeployModeId) => void;
}

const MODES: readonly { id: DeployModeId; label: string; hex: string }[] = [
    { id: 'quick', label: 'QUICK', hex: '#5CE1FF' },
    { id: 'team', label: 'TEAM', hex: '#FBBF24' },
    { id: 'offline', label: 'OFFLINE', hex: '#34D399' },
];

/** Concave curved orbital dock mirroring the Option B canopy beneath the 3D ActionDice. */
export function OrbitalModeDock({
    activeMode,
    disabled = false,
    onSelectMode,
}: OrbitalModeDockProps) {
    const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
    useEffect(() => onReducedMotionChange(setReducedMotion), []);

    const activeSpec = MODES.find((m) => m.id === activeMode) ?? MODES[0];

    return (
        <div className="relative mt-2 w-full max-w-[292px] flex flex-col items-center">
            {/* Subtle concave orbital arc framing the dock */}
            <svg
                viewBox="0 0 280 22"
                className="w-[260px] h-5 -mb-2 pointer-events-none select-none"
                aria-hidden="true"
            >
                <path
                    d="M 14 4 Q 140 24 266 4"
                    fill="none"
                    stroke={activeSpec.hex}
                    strokeOpacity="0.42"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                />
                <path
                    d="M 38 9 Q 140 24 242 9"
                    fill="none"
                    stroke={activeSpec.hex}
                    strokeOpacity="0.16"
                    strokeWidth="1"
                    strokeDasharray="3 4"
                    strokeLinecap="round"
                />
            </svg>

            <div
                role="radiogroup"
                aria-label="Deployment Mode Switcher"
                className="relative z-10 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-full border bg-surface-panel/90 backdrop-blur-md"
                style={{
                    borderColor: 'var(--line-soft)',
                    boxShadow: 'inset 0 1px 0 rgba(240, 246, 252, 0.06), 0 8px 20px rgba(0, 0, 0, 0.45)',
                }}
            >
                {MODES.map((m, idx) => {
                    const selected = m.id === activeMode;
                    // Subtle arc elevation on outer two pills so they follow the concave curve
                    const arcOffsetClass = idx === 1 ? 'translate-y-0.5' : '-translate-y-0.5';
                    return (
                        <button
                            key={m.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled}
                            onClick={() => onSelectMode(m.id)}
                            className={`px-3 py-1.5 rounded-full text-ludo-xs font-mono font-bold uppercase tracking-wider border flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                                reducedMotion ? '' : arcOffsetClass
                            } ${
                                selected
                                    ? 'text-ink-strong'
                                    : 'bg-surface-recessed/75 text-ink-muted border-line-soft hover:text-ink-strong hover:border-line-strong'
                            }`}
                            style={{
                                transition: reducedMotion
                                    ? undefined
                                    : 'background-color 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out, transform 160ms ease-out',
                                ...(selected
                                    ? {
                                          backgroundColor: `${m.hex}1c`,
                                          borderColor: `${m.hex}aa`,
                                          color: m.hex,
                                          boxShadow: `0 0 14px ${m.hex}2b, inset 0 1px 0 ${m.hex}44`,
                                      }
                                    : undefined),
                            }}
                        >
                            <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                    backgroundColor: selected ? m.hex : 'var(--ink-faint)',
                                    boxShadow: selected ? `0 0 6px ${m.hex}` : undefined,
                                }}
                                aria-hidden="true"
                            />
                            {m.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
