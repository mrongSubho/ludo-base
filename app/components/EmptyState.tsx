"use client";

import React from 'react';
import { Button } from './Button';

/**
 * Shared empty / error surface for panels and feeds.
 * Same glass language as sandwich panels — no second visual system.
 *
 * The CTA is the shared Button (UI_COMPONENT_AUDIT B.2). It used to be a
 * white-fill pill, which meant a third CTA flavour: `bg-white text-black` is
 * correct in neither theme (it reads as "the primary action" in Retro and as
 * a stray white block in Daybreak). `variant="primary"` makes it the accent —
 * one accent per theme, one meaning — and brings the shared press/disabled
 * treatment with it.
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
    const accent = tone === 'error' ? 'text-warn' : 'text-accent';
    return (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center rounded-2xl border border-line-soft bg-surface-recessed">
            <p className={`text-ludo-xs font-bold label-chrome uppercase tracking-[0.28em] ${accent}`}>
                {title}
            </p>
            {body && (
                <p className="text-ludo-md font-medium leading-relaxed text-ink-muted max-w-[280px]">
                    {body}
                </p>
            )}
            {actionLabel && onAction && (
                <Button
                    variant="primary"
                    size="lg"
                    onClick={onAction}
                    className="mt-2 rounded-full uppercase tracking-[0.18em]"
                >
                    {actionLabel}
                </Button>
            )}
        </div>
    );
}
