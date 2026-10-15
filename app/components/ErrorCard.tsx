"use client";

import React from 'react';

// ─── ErrorCard — the one error surface (image-1 design) ─────────────────────
// Shared by every error boundary in the app:
//   · PanelErrorBoundary — the scoped per-panel overlays (REA-08)
//   · app/error.tsx      — the route-segment boundary
// app/global-error.tsx renders the same design inline, because it must survive
// a root-layout failure where no stylesheet is guaranteed.
//
// Every colour is an `--err-*` token (globals.css), so the card is correct in
// both themes with zero patch rules. This replaces the old
// `body.theme-daybreak .panel-error-card` override block, which could only
// remap the EXACT `.text-white` / `.text-red-400` classes and therefore left
// the route card's `text-white/80` / `text-white/50` ink white-on-white in
// Daybreak. The Daybreak primary CTA also inverts to dark ink — a white
// button on the white error card was the reported visibility bug.

export interface ErrorCardAction {
    label: string;
    onClick: () => void;
    /** primary = filled CTA (inverts per theme so it always reads); ghost = outline. */
    kind?: 'primary' | 'ghost';
}

export interface ErrorCardProps {
    /** Red kicker line, e.g. "MISSION · SOMETHING BROKE". */
    kicker: string;
    /** Player-facing friendly copy (lib/errorCopy.ts). */
    copy: string;
    /** Optional display heading above the copy. */
    heading?: string;
    /** Raw diagnostic line (error message, optional digest). */
    raw?: string;
    /** React component stack, rendered in a scroll box. */
    stack?: string | null;
    /** CTAs in render order — the caller decides which buttons per case. */
    actions: ErrorCardAction[];
}

const BTN_BASE =
    'flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.18em] transition-all hover:brightness-95 active:scale-95';

export default function ErrorCard({ kicker, copy, heading, raw, stack, actions }: ErrorCardProps) {
    return (
        <div
            className="panel-error-card pointer-events-auto w-full max-w-[500px] rounded-[28px] border p-5 flex flex-col items-center gap-2.5 text-center shadow-2xl"
            style={{
                background: 'var(--err-card-bg)',
                borderColor: 'var(--err-card-border)',
                boxShadow: 'var(--err-card-shadow)',
                backdropFilter: 'blur(32px)',
            }}
        >
            <p
                className="text-[10px] font-black uppercase tracking-[0.3em]"
                style={{ color: 'var(--err-kicker)' }}
            >
                {kicker}
            </p>
            {heading && (
                <h1
                    className="text-lg font-black uppercase tracking-tight"
                    style={{ color: 'var(--err-ink)' }}
                >
                    {heading}
                </h1>
            )}
            <p className="text-[12px] font-bold break-words max-w-full" style={{ color: 'var(--err-ink)' }}>
                {copy}
            </p>
            {raw && (
                <p
                    className="text-[10px] font-mono break-words max-w-full"
                    style={{ color: 'var(--err-ink-muted)' }}
                >
                    {raw}
                </p>
            )}
            {stack && (
                <pre
                    className="panel-error-stack w-full max-h-28 overflow-auto text-left text-[10px] font-mono border rounded-xl p-2 whitespace-pre-wrap break-words"
                    style={{
                        background: 'var(--err-stack-bg)',
                        borderColor: 'var(--err-stack-border)',
                        color: 'var(--err-stack-ink)',
                    }}
                >
                    {stack}
                </pre>
            )}
            <div className="flex gap-2 w-full mt-1">
                {actions.map((action) => (
                    <button
                        key={action.label}
                        type="button"
                        onClick={action.onClick}
                        className={BTN_BASE}
                        style={
                            action.kind === 'ghost'
                                ? {
                                      background: 'var(--err-ghost-bg)',
                                      color: 'var(--err-ghost-ink)',
                                      border: '1px solid var(--err-ghost-border)',
                                  }
                                : {
                                      background: 'var(--err-cta-bg)',
                                      color: 'var(--err-cta-ink)',
                                      border: '1px solid var(--err-cta-border)',
                                  }
                        }
                    >
                        {action.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
