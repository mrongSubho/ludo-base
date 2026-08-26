'use client';

import { usePreferences } from '@/hooks/usePreferences';

type TokenStyle = 'pawn' | 'orb';

export default function TokenStyleSwitcher() {
    const { preferences, updatePreference } = usePreferences();
    const active = (preferences.tokenStyle as TokenStyle) || 'pawn';

    const pick = (style: TokenStyle) => {
        if (style === active) return;
        updatePreference('token-style', style);
    };

    const PawnIcon = (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M12 4.5a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z" />
            <path d="M10 10.9h4l1.1 7.8H8.9z" />
            <ellipse cx="12" cy="20.5" rx="6.5" ry="1" />
        </svg>
    );

    const OrbIcon = (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <circle cx="12" cy="14.5" r="7" />
            <circle cx="12" cy="14.5" r="2.2" fill="currentColor" stroke="none" opacity="0.85" />
            <path d="M7 8.5c2-1.4 8.5-2.4 10 1.8" />
        </svg>
    );

    return (
        <div className="theme-switcher-inline">
            <div
                onClick={() => pick('pawn')}
                className={`theme-inline-btn ${active === 'pawn' ? 'active' : 'cursor-pointer'}`}
            >
                <span className="theme-icon">{PawnIcon}</span>
                <span className="theme-label">Pawn Pieces</span>
            </div>
            <div
                onClick={() => pick('orb')}
                className={`theme-inline-btn ${active === 'orb' ? 'active' : 'cursor-pointer'}`}
            >
                <span className="theme-icon">{OrbIcon}</span>
                <span className="theme-label">Classic Orbs</span>
            </div>
        </div>
    );
}
