'use client';

import React, { useEffect, useState } from 'react';
import type { DeployModeId } from '@/lib/deployTheme';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

interface DaybreakModeDockProps {
    activeMode: DeployModeId;
    disabled?: boolean;
    onSelectMode: (mode: DeployModeId) => void;
}

const DAYBREAK_MODES: readonly { id: DeployModeId; label: string; hex: string; deep: string }[] = [
    { id: 'quick', label: 'QUICK', hex: '#0D6D87', deep: '#0A586D' },
    { id: 'team', label: 'TEAM', hex: '#B45309', deep: '#92400E' },
    { id: 'offline', label: 'OFFLINE', hex: '#166534', deep: '#14532D' },
];

/**
 * Daybreak Segmented Porcelain Mode Dock beneath the 3D ActionDice.
 * Uses a recessed alabaster trough and a sliding ceramic shuttle pill.
 */
export function DaybreakModeDock({
    activeMode,
    disabled = false,
    onSelectMode,
}: DaybreakModeDockProps) {
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => setReducedMotion(prefersReducedMotion()));
        const unsubscribe = onReducedMotionChange(setReducedMotion);
        return () => {
            window.cancelAnimationFrame(raf);
            unsubscribe();
        };
    }, []);

    const activeIdx = Math.max(
        0,
        DAYBREAK_MODES.findIndex((m) => m.id === activeMode),
    );
    const activeSpec = DAYBREAK_MODES[activeIdx] ?? DAYBREAK_MODES[0];

    return (
        <div
            role="radiogroup"
            aria-label="Deployment Mode Switcher"
            className="daybreak-mode-dock relative mt-2.5 w-full max-w-[272px] rounded-full p-1 grid grid-cols-3 border"
            style={{
                background: '#EAE5DC',
                borderColor: 'rgba(28, 25, 23, 0.11)',
                boxShadow:
                    'inset 0 2px 5px rgba(28, 25, 23, 0.10), inset 0 -1px 0 rgba(255, 255, 255, 0.85)',
            }}
        >
            {/* Sliding elevated porcelain shuttle */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] rounded-full border"
                style={{
                    transform: `translateX(${activeIdx * 100}%)`,
                    transition: reducedMotion
                        ? 'none'
                        : 'transform 190ms cubic-bezier(0.22, 1, 0.36, 1)',
                    background: 'linear-gradient(180deg, #FFFFFF 0%, #FAF8F3 100%)',
                    borderColor: `${activeSpec.hex}55`,
                    boxShadow:
                        '0 2px 8px rgba(28, 25, 23, 0.12), inset 0 1px 0 #FFFFFF',
                }}
            />

            {DAYBREAK_MODES.map((m) => {
                const selected = m.id === activeMode;
                return (
                    <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled}
                        onClick={() => onSelectMode(m.id)}
                        className="relative z-10 min-h-[34px] px-2 rounded-full text-ludo-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
                        style={{
                            color: selected ? m.deep : 'var(--ink-muted)',
                        }}
                    >
                        <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                                backgroundColor: selected ? m.hex : 'rgba(28, 25, 23, 0.24)',
                            }}
                            aria-hidden="true"
                        />
                        <span>{m.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
