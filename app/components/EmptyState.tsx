"use client";

import React from 'react';

/**
 * Shared empty / error surface for panels and feeds.
 * Same glass language as sandwich panels — no second visual system.
 */
export function EmptyState({
    title,
    body,
    actionLabel,
    onAction,
    tone = 'empty',
}: {
    title: string;
    body?: string;
    actionLabel?: string;
    onAction?: () => void;
    tone?: 'empty' | 'error';
}) {
    const accent = tone === 'error' ? 'text-amber-300' : 'text-cyan-300';
    return (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <p className={`text-[10px] font-black uppercase tracking-[0.28em] ${accent}`}>
                {title}
            </p>
            {body && (
                <p className="text-[12px] font-medium leading-relaxed text-white/55 max-w-[280px]">
                    {body}
                </p>
            )}
            {actionLabel && onAction && (
                <button
                    type="button"
                    onClick={onAction}
                    className="mt-2 min-h-[44px] px-5 rounded-full bg-white text-black text-[11px] font-black uppercase tracking-[0.18em] hover:bg-white/90 active:scale-[0.98] transition-all"
                >
                    {actionLabel}
                </button>
            )}
        </div>
    );
}
