'use client';

import React from 'react';

// ─── Shared iconography (single source of truth) ────────────────────────────
// Stroke icons (round caps/joins, currentColor). Use these instead of pulling
// react-icons one-offs.

// Messenger-style chat bubble — messages, DMs, threads.
export const ChatIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 3a9 9 0 0 0-9 9c0 1.6.4 3 1.1 4.3L3.5 20.5l4.3-1.4A9 9 0 1 0 12 3z" />
        <path d="M8 13.2 10.8 10l3.2 3.6L17.5 10" />
    </svg>
);

// Sliders — settings / tune entry points.
export const SlidersIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
        <line x1="3" y1="8" x2="12.5" y2="8" />
        <line x1="17.5" y1="8" x2="21" y2="8" />
        <circle cx="15" cy="8" r="2.5" />
        <line x1="3" y1="16" x2="6.5" y2="16" />
        <line x1="11.5" y1="16" x2="21" y2="16" />
        <circle cx="9" cy="16" r="2.5" />
    </svg>
);
