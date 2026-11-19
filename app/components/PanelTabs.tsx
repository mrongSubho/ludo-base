'use client';

import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { useIsMobileView } from '@/hooks/useIsMobileView';

// ─── Shared panel tabs (single source of truth) ─────────────────────────────
// Every sandwich panel renders its tabs through these two components so the
// tab language can never drift again: parent = segmented block, child =
// text-underline row subordinate to it. Theme-reactive via semantic tokens +
// `theme-3077.css` cyber-tactical accents.

export interface PanelTabOption<T extends string> {
    value: T;
    label: React.ReactNode;
    /** Leading icon — tinted accent when active (pass plain node). */
    icon?: React.ReactNode;
    /** Trailing node — count pills, status dots. */
    badge?: React.ReactNode;
    ariaLabel?: string;
}

// Parent segmented control (STORE/LOADOUT/THEME vocabulary).
export function PanelTabs<T extends string>({
    options,
    value,
    onPick,
    cols,
}: {
    options: PanelTabOption<T>[];
    value: T;
    onPick: (v: T) => void;
    cols?: 2 | 3 | 4;
}) {
    const uid = useId();
    const isMobile = useIsMobileView();
    const colCount = cols ?? (options.length >= 4 ? 4 : options.length === 3 ? 3 : 2);
    const grid = colCount === 4 ? 'grid-cols-4' : colCount === 3 ? 'grid-cols-3' : 'grid-cols-2';

    return (
        <div className={`panel-tabs-3077 grid ${grid} gap-1 p-1 rounded-2xl bg-surface-recessed border border-line-soft`}>
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        onClick={() => onPick(o.value)}
                        aria-label={o.ariaLabel}
                        aria-pressed={active}
                        className={`relative z-10 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-ludo-xs font-bold uppercase tracking-[0.16em] transition-colors ${
                            active ? 'text-ink-strong' : 'text-ink-muted hover:text-ink-strong'
                        }`}
                    >
                        {active &&
                            (isMobile ? (
                                <span
                                    aria-hidden="true"
                                    className="panel-tab-active-3077 absolute inset-0 -z-10 rounded-xl bg-accent-soft border border-line-strong"
                                />
                            ) : (
                                <motion.span
                                    aria-hidden="true"
                                    layoutId={`panel-tab-bg-${uid}`}
                                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                                    className="panel-tab-active-3077 absolute inset-0 -z-10 rounded-xl bg-accent-soft border border-line-strong"
                                />
                            ))}
                        {o.icon && <span className={active ? 'text-accent' : ''}>{o.icon}</span>}
                        <span className="truncate">{o.label}</span>
                        {o.badge}
                    </button>
                );
            })}
        </div>
    );
}

// Child underline tabs (Daily/Weekly vocabulary) — deliberately subordinate
// to the parent block: no fill, smaller type, laser rail on active.
export function PanelChildTabs<T extends string>({
    options,
    value,
    onPick,
    ariaLabel,
}: {
    options: { value: T; label: React.ReactNode; pill?: React.ReactNode }[];
    value: T;
    onPick: (v: T) => void;
    ariaLabel: string;
}) {
    const uid = useId();
    const isMobile = useIsMobileView();

    return (
        <div className="flex items-center gap-5 border-b border-line-soft px-1" role="tablist" aria-label={ariaLabel}>
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onPick(o.value)}
                        className={`pb-2 text-ludo-sm font-bold uppercase tracking-[0.18em] transition-colors relative rounded-sm ${
                            active ? 'text-ink-strong' : 'text-ink-muted hover:text-ink-strong'
                        }`}
                    >
                        <span className="flex items-center gap-1.5">
                            {o.label}
                            {o.pill}
                        </span>
                        {active &&
                            (isMobile ? (
                                <span
                                    aria-hidden="true"
                                    className="panel-child-rail-3077 absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                                />
                            ) : (
                                <motion.span
                                    aria-hidden="true"
                                    layoutId={`panel-child-rail-${uid}`}
                                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                                    className="panel-child-rail-3077 absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                                />
                            ))}
                    </button>
                );
            })}
        </div>
    );
}

// Standard count pill used inside tab badges.
export const TabCount = ({ active, children }: { active: boolean; children: React.ReactNode }) => (
    <span
        className={`px-1.5 py-0.5 rounded-md text-ludo-xs font-mono ${
            active ? 'bg-accent-soft text-accent' : 'bg-surface-recessed text-ink-faint'
        }`}
    >
        {children}
    </span>
);
