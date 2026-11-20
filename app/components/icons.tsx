'use client';

import React from 'react';

// ─── Ludo 3077 Crisp Mecha-Tactical Duotone SVG Icon Library ─────────────────
// Single source of truth for HUD, Navigation Dock, Modes, Economy, and Board
// hazards. Built on a 24x24 geometric grid with angular chamfers, consistent
// 1.85 stroke weight, and reactive duotone fill cores.

export interface IconProps {
    className?: string;
    active?: boolean;
}

const fillOp = (active?: boolean) => (active ? 0.24 : 0.08);

// ── Header & System Controls ─────────────────────────────────────────────────

export const ChatIcon = ({ className = 'w-4 h-4', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path
            d="M4 5.5L6.5 3.5H19.5L21.5 5.5V15.5L19.5 17.5H9.5L4.5 21V17.5L4 17V5.5Z"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <path d="M8 9.5H16.5" />
        <path d="M8 13H13" />
    </svg>
);

export const SlidersIcon = ({ className = 'w-4 h-4', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <line x1="3" y1="8" x2="11" y2="8" />
        <line x1="17" y1="8" x2="21" y2="8" />
        <polygon points="14,5 17,8 14,11 11,8" fill="currentColor" fillOpacity={active ? 0.35 : 0.14} />
        <line x1="3" y1="16" x2="7" y2="16" />
        <line x1="13" y1="16" x2="21" y2="16" />
        <polygon points="10,13 13,16 10,19 7,16" fill="currentColor" fillOpacity={active ? 0.35 : 0.14} />
    </svg>
);

export const ChipsHexIcon = ({ className = 'w-4 h-4', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="12,2 20.5,7 20.5,17 12,22 3.5,17 3.5,7"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <polygon points="12,6.5 16.8,12 12,17.5 7.2,12" fill="currentColor" fillOpacity={active ? 0.35 : 0.15} />
        <line x1="12" y1="9.5" x2="12" y2="14.5" />
    </svg>
);

export const VaultShieldIcon = ({ className = 'w-4 h-4', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path
            d="M12 2.5L20 5.5V12.5C20 17.2 16.4 20.4 12 22C7.6 20.4 4 17.2 4 12.5V5.5L12 2.5Z"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <rect x="9" y="11" width="6" height="5" rx="1" />
        <path d="M10.2 11V9.2C10.2 8.2 11 7.5 12 7.5C13 7.5 13.8 8.2 13.8 9.2V11" />
    </svg>
);

export const PilotAvatarFallbackIcon = ({ className = 'w-4 h-4', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="12,3 17,6 17,11 12,14 7,11 7,6"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <path d="M4.5 20.5L7 16.5H17L19.5 20.5" />
        <path d="M9 8.5H15" />
    </svg>
);

export const CloseReticleIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <path d="M7 7L17 17M17 7L7 17" />
        <path d="M4 6V4H6M18 4H20V6M4 18V20H6M18 20H20V18" strokeWidth="1.4" opacity="0.55" />
    </svg>
);

export const CheckGlyphIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polyline points="5 12.5 9.5 17 19 7.5" />
    </svg>
);

export const ChevronGlyphIcon = ({
    className = 'w-4 h-4',
    direction = 'right',
}: IconProps & { direction?: 'left' | 'right' | 'up' | 'down' }) => {
    const rot = direction === 'left' ? 180 : direction === 'up' ? -90 : direction === 'down' ? 90 : 0;
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            style={rot ? { transform: `rotate(${rot}deg)` } : undefined}
            aria-hidden="true"
        >
            <polyline points="9 6 15 12 9 18" />
        </svg>
    );
};

export const WarningHexIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon points="12,2.5 21,7.5 21,16.5 12,21.5 3,16.5 3,7.5" fill="currentColor" fillOpacity="0.14" />
        <line x1="12" y1="8" x2="12" y2="13.5" />
        <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
);

export const PhoneLinkIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="currentColor" fillOpacity="0.08" />
        <line x1="10" y1="5.5" x2="14" y2="5.5" />
        <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
);

export const BrandMark3077Icon = ({ className = 'w-6 h-6', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <circle
            cx="12"
            cy="12"
            r="9.2"
            fill="currentColor"
            fillOpacity={active ? 0.18 : 0.08}
        />
        <rect x="1.6" y="10.2" width="1.8" height="3.6" rx="0.6" fill="currentColor" stroke="none" />
        <polygon points="12,5.6 13.8,7.4 12,9.2 10.2,7.4" fill="currentColor" stroke="none" />
        <polygon points="8.6,9.4 11.2,12 8.6,14.6 6,12" strokeWidth="1.35" />
        <polygon points="15.4,9.4 18,12 15.4,14.6 12.8,12" strokeWidth="1.35" />
        <polygon points="12,12.8 14.6,15.4 12,18 9.4,15.4" strokeWidth="1.35" />
    </svg>
);

// ── Footer Navigation Dock Icons ─────────────────────────────────────────────

export const SquadLinkIcon = ({ className = 'w-5 h-5', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="9,4 13,6.5 13,10.5 9,13 5,10.5 5,6.5"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <path d="M2.5 20L5 15.5H13L15.5 20" />
        <polygon points="17.5,5.5 20.5,7.2 20.5,10.8 17.5,12.5 14.5,10.8 14.5,7.2" fill="currentColor" fillOpacity={active ? 0.22 : 0.06} />
        <path d="M16.5 15.5H20L22 19.5" />
    </svg>
);

export const ApexRankIcon = ({ className = 'w-5 h-5', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="9.5,6.5 14.5,6.5 15.5,20.5 8.5,20.5"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <polyline points="3,20.5 3,12.5 8.5,12.5" />
        <polyline points="15.5,14 21,14 21,20.5" />
        <polyline points="9.5,4.2 12,2.2 14.5,4.2" />
    </svg>
);

export const SyndicateShieldIcon = ({ className = 'w-5 h-5', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="12,2.5 20,6 20,13.5 12,21.5 4,13.5 4,6"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <polygon points="12,7 15.5,11 12,16 8.5,11" fill="currentColor" fillOpacity={active ? 0.45 : 0.14} />
    </svg>
);

export const DirectiveTargetIcon = ({ className = 'w-5 h-5', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="7.5,3.5 16.5,3.5 20.5,7.5 20.5,16.5 16.5,20.5 7.5,20.5 3.5,16.5 3.5,7.5"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <polygon points="12,8.5 15.5,12 12,15.5 8.5,12" fill="currentColor" fillOpacity={active ? 0.5 : 0.18} />
        <line x1="12" y1="2" x2="12" y2="5.5" />
        <line x1="12" y1="18.5" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5.5" y2="12" />
        <line x1="18.5" y1="12" x2="22" y2="12" />
    </svg>
);

export const ArenaBladesIcon = ({ className = 'w-5 h-5', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="4,4 9,4 20,15 17,18 6,7"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <path d="M20 4H15L4 15L7 18L18 7" />
        <path d="M4 20L8.5 15.5M20 20L15.5 15.5" />
        <path d="M3 16.5L7.5 21M21 16.5L16.5 21" />
    </svg>
);

export const ArmoryCrateIcon = ({ className = 'w-5 h-5', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="12,2.5 20.5,7 20.5,17 12,21.5 3.5,17 3.5,7"
            fill="currentColor"
            fillOpacity={fillOp(active)}
        />
        <polyline points="3.5,7 12,11.5 20.5,7" />
        <line x1="12" y1="11.5" x2="12" y2="21.5" />
        <polygon points="12,6.2 15,8 12,9.8 9,8" fill="currentColor" fillOpacity={active ? 0.5 : 0.16} stroke="none" />
    </svg>
);

// ── Lobby Mode & Deployment Icons ────────────────────────────────────────────

export const ClassicGridIcon = ({ className = 'w-4 h-4', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity={fillOp(active)} />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity={fillOp(active)} />
    </svg>
);

export const OverdriveBoltIcon = ({ className = 'w-4 h-4', active }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon
            points="13.5,2.5 4.5,13.5 11.5,13.5 10.5,21.5 19.5,10.5 12.5,10.5"
            fill="currentColor"
            fillOpacity={active ? 0.32 : 0.12}
        />
    </svg>
);

export const QuickDeployIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polyline points="5 6 11 12 5 18" />
        <polyline points="12 6 18 12 12 18" />
    </svg>
);

export const SquadRoomIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" fill="currentColor" fillOpacity="0.22" />
        <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
        <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
        <rect x="14" y="14" width="6.5" height="6.5" rx="1" fill="currentColor" fillOpacity="0.22" />
        <line x1="10" y1="6.75" x2="14" y2="6.75" />
        <line x1="10" y1="17.25" x2="14" y2="17.25" />
    </svg>
);

export const SimBotIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" fillOpacity="0.16" />
        <circle cx="9.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
        <line x1="9" y1="14.5" x2="15" y2="14.5" />
        <path d="M9 2.5V5M15 2.5V5M9 19V21.5M15 19V21.5M2.5 9H5M2.5 15H5M19 9H21.5M19 15H21.5" />
    </svg>
);

// ── Board Hazard & Theme/Token Switchers ─────────────────────────────────────

export const ProximityMineIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" strokeDasharray="3 2.5" opacity="0.7" />
        <polygon points="8.5,5.5 15.5,5.5 18.5,8.5 18.5,15.5 15.5,18.5 8.5,18.5 5.5,15.5 5.5,8.5" fill="currentColor" fillOpacity="0.22" />
        <path d="M5 5L7.2 7.2M19 5L16.8 7.2M5 19L7.2 16.8M19 19L16.8 16.8" />
        <circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none" />
    </svg>
);

export const Theme3077Icon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" />
        <line x1="22" y1="12" x2="18" y2="12" />
        <line x1="6" y1="12" x2="2" y2="12" />
        <line x1="12" y1="6" x2="12" y2="2" />
        <line x1="12" y1="22" x2="12" y2="18" />
        <circle cx="12" cy="12" r="3.5" fill="currentColor" fillOpacity="0.25" />
    </svg>
);

export const ThemeRetroIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" fillOpacity="0.16" />
    </svg>
);

export const ThemeDaybreakIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.18" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
);

export const TokenChessIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        <circle cx="12" cy="7" r="3" fill="currentColor" fillOpacity="0.18" />
        <path d="M12 10v7M8.5 21h7M9.5 17h5" />
    </svg>
);

export const TokenOrbIcon = ({ className = 'w-4 h-4' }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="currentColor" fillOpacity="0.1" />
        <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.32" />
    </svg>
);
