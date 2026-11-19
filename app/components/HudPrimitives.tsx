'use client';

import React from 'react';

/**
 * Corner targeting ticks — purely decorative L-brackets that appear ONLY under
 * `body.theme-3077` (`.hud-ticks-3077 { display: none; }` globally). Keeps Retro
 * and Daybreak visually untouched.
 */
export function HudCornerTicks({ className = '' }: { className?: string }) {
    return (
        <div
            className={`hud-ticks-3077 pointer-events-none absolute inset-0 z-20 ${className}`}
            aria-hidden="true"
        >
            <span className="hud-tick hud-tick-tl" />
            <span className="hud-tick hud-tick-tr" />
            <span className="hud-tick hud-tick-bl" />
            <span className="hud-tick hud-tick-br" />
        </div>
    );
}

/**
 * Compositor-only segmented tactical progress gauge.
 * Animates strictly via `transform: scaleX(...)` — never layout `width`.
 */
export function HudProgressGauge({
    percent,
    tone = 'accent',
    className = '',
}: {
    percent: number;
    tone?: 'accent' | 'positive' | 'warn' | 'muted';
    className?: string;
}) {
    const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
    const ratio = clamped / 100;

    const fillStyle: React.CSSProperties = {
        transform: `scaleX(${ratio})`,
        transformOrigin: 'left center',
        transition: 'transform 420ms var(--ease-standard, cubic-bezier(0.2, 0, 0, 1))',
        backgroundColor:
            tone === 'positive'
                ? 'var(--positive, #4ade80)'
                : tone === 'warn'
                  ? 'var(--warn, #fbbf24)'
                  : tone === 'muted'
                    ? 'var(--ink-faint, rgba(255,255,255,0.28))'
                    : 'var(--accent, #00e5ff)',
    };

    return (
        <div
            className={`hud-progress-track relative w-full h-2 rounded-sm overflow-hidden border border-line-soft bg-surface-recessed ${className}`}
            role="progressbar"
            aria-valuenow={Math.round(clamped)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div className="h-full w-full relative" style={fillStyle}>
                <span className="hud-progress-leading-glow" aria-hidden="true" />
            </div>
            <div className="hud-progress-notches pointer-events-none absolute inset-0" aria-hidden="true" />
        </div>
    );
}

/**
 * Crisp Mecha-Tactical section header (`// LABEL`) with subtle gradient rule.
 */
export function HudSectionLabel({
    children,
    right,
    className = '',
}: {
    children: React.ReactNode;
    right?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`flex items-center gap-2.5 ${className}`}>
            <span className="hud-section-pill px-2 py-0.5 rounded-sm bg-surface-recessed border border-line-soft text-ludo-xs font-bold tracking-[0.16em] text-ink-muted font-mono uppercase">
                <span className="text-accent mr-1" aria-hidden="true">
                    {'//'}
                </span>
                {children}
            </span>
            <div
                className="flex-1 h-px"
                style={{
                    background: 'linear-gradient(to right, var(--line-strong), transparent)',
                }}
            />
            {right}
        </div>
    );
}
