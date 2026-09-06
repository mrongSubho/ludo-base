'use client';

import React from 'react';

// ─── Shared panel tabs (single source of truth) ─────────────────────────────
// Every sandwich panel renders its tabs through these two components so the
// tab language can never drift again: parent = segmented block, child =
// text-underline row subordinate to it. Theme-agnostic (white ink + cyan
// accents on the shared dark shell); daylight remaps happen in globals.css.

export interface PanelTabOption<T extends string> {
    value: T;
    label: React.ReactNode;
    /** Leading icon — tinted cyan when active (pass plain node). */
    icon?: React.ReactNode;
    /** Trailing node — count pills, status dots. */
    badge?: React.ReactNode;
    ariaLabel?: string;
}

// Parent segmented control (STORE/LOADOUT vocabulary).
export function PanelTabs<T extends string>({ options, value, onPick, cols }: {
    options: PanelTabOption<T>[];
    value: T;
    onPick: (v: T) => void;
    cols?: 2 | 3 | 4;
}) {
    const grid = cols === 4 ? 'grid-cols-4' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2';
    return (
        <div className={`grid ${grid} gap-1 p-1 rounded-2xl bg-black/50 border border-white/10`}>
            {options.map(o => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        onClick={() => onPick(o.value)}
                        aria-label={o.ariaLabel}
                        aria-pressed={active}
                        className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${active ? 'bg-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]' : 'text-white/35 hover:text-white/70'}`}
                    >
                        {o.icon && <span className={active ? 'text-cyan-300' : ''}>{o.icon}</span>}
                        {o.label}
                        {o.badge}
                    </button>
                );
            })}
        </div>
    );
}

// Child underline tabs (Daily/Weekly vocabulary) — deliberately subordinate
// to the parent block: no fill, smaller type, cyan rule on active.
export function PanelChildTabs<T extends string>({ options, value, onPick, ariaLabel }: {
    options: { value: T; label: React.ReactNode; pill?: React.ReactNode }[];
    value: T;
    onPick: (v: T) => void;
    ariaLabel: string;
}) {
    return (
        <div className="flex items-center gap-5 border-b border-white/5 px-1" role="tablist" aria-label={ariaLabel}>
            {options.map(o => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        role="tab"
                        aria-selected={active}
                        onClick={() => onPick(o.value)}
                        className={`pb-2 text-[11px] font-black uppercase tracking-[0.2em] transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 rounded-sm ${active ? 'text-white' : 'text-white/35 hover:text-white/70'}`}
                    >
                        <span className="flex items-center gap-1.5">
                            {o.label}
                            {o.pill}
                        </span>
                        {active && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 rounded-t-full shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                        )}
                    </button>
                );
            })}
        </div>
    );
}

// Standard count pill used inside tab badges.
export const TabCount = ({ active, children }: { active: boolean; children: React.ReactNode }) => (
    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono ${active ? 'bg-cyan-400/20 text-cyan-200' : 'bg-white/5 text-white/30'}`}>
        {children}
    </span>
);
