"use client";

import React from 'react';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';

const LABEL: Record<MatchConnectionStatus, string> = {
    offline: 'LOCAL',
    connected: 'LIVE',
    reconnecting: 'DEGRADED',
    syncing: 'RESYNC',
    ended: 'ENDED',
};

const TITLE: Record<MatchConnectionStatus, string> = {
    offline: 'Not in a networked match — local/bot only',
    connected: 'Live — authoritative snapshots current',
    reconnecting: 'Degraded — local timers paused until resync',
    syncing: 'Resyncing — fetching authoritative match state',
    ended: 'Match finished',
};

/**
 * N5 — in-match connection badge. Never a silent freeze: status is always visible.
 * `compact` matches BoardHeaderCompact density.
 */
export function ConnectionBadge({
    status,
    compact = false,
}: {
    status: MatchConnectionStatus;
    compact?: boolean;
}) {
    const label = LABEL[status] ?? status;
    const title = TITLE[status] ?? status;
    const tone =
        status === 'connected' ? 'ok' :
        status === 'ended' ? 'end' :
        status === 'offline' ? 'off' : 'warn';

    if (compact) {
        const connectionClass = {
            off: 'text-white/45 border-white/10 bg-white/5',
            ok: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10',
            warn: 'text-amber-300 border-amber-400/30 bg-amber-400/10 animate-pulse',
            end: 'text-white/60 border-white/15 bg-white/10',
        }[tone];
        return (
            <span
                className={`rounded-full border px-1.5 py-0.5 text-[6px] font-black tracking-[0.16em] whitespace-nowrap ${connectionClass}`}
                role="status"
                aria-live="polite"
                aria-label={`Match connection: ${label}`}
                title={title}
                data-conn={status}
            >
                {label}
            </span>
        );
    }

    return (
        <div
            className={`conn-badge conn-badge-${tone}`}
            role="status"
            aria-live="polite"
            title={title}
            data-conn={status}
        >
            <span className="conn-badge-dot" aria-hidden />
            <span className="conn-badge-label">{label}</span>
        </div>
    );
}

export default ConnectionBadge;
