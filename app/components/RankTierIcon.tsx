"use client";

import React from 'react';

export type RankTier =
    | 'Bronze'
    | 'Silver'
    | 'Gold'
    | 'Platinum'
    | 'Diamond'
    | 'Arena Master'
    | 'Bot Squad'
    | string;

export interface RankTierIconProps {
    tier?: RankTier | null;
    isAi?: boolean;
    className?: string;
    size?: number;
}

/**
 * Tactical CODM-style Vector Insignia for Ludo Base Rank Tiers.
 * 
 * Insignia Hierarchy:
 * - Bronze: Heavy notched combat shield with single copper chevron.
 * - Silver: Dual chevron tactical crest with polished steel bevels.
 * - Gold: Gilded winged shield with central combat star.
 * - Platinum: Faceted cobalt crown crest with crystalline core.
 * - Diamond: Prismatic brilliant-cut diamond gem with electric cyan glow.
 * - Arena Master: Crowned skull/crest with flaming crimson-orange wings.
 * - Bot Squad / AI: Microprocessor tactical AI core.
 */
export function RankTierIcon({
    tier = 'Bronze',
    isAi = false,
    className = 'w-3 h-3',
    size,
}: RankTierIconProps) {
    const style = size ? { width: size, height: size } : undefined;
    const norm = (tier || '').toLowerCase().trim();

    if (isAi || norm.includes('ai') || norm.includes('bot')) {
        return (
            <svg
                viewBox="0 0 16 16"
                className={className}
                style={style}
                fill="none"
                aria-label="Bot Squad Insignia"
            >
                <rect
                    x="3"
                    y="3"
                    width="10"
                    height="10"
                    rx="2.5"
                    stroke="#f59e0b"
                    strokeWidth="1.2"
                    fill="#78350f"
                    fillOpacity="0.4"
                />
                <circle cx="6" cy="7" r="1.1" fill="#fbbf24" />
                <circle cx="10" cy="7" r="1.1" fill="#fbbf24" />
                <path d="M5.5 10.5H10.5" stroke="#fbbf24" strokeWidth="1.1" strokeLinecap="round" />
                <path d="M8 1V3M8 13V15M1 8H3M13 8H15" stroke="#d97706" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
        );
    }

    if (norm.includes('master') || norm.includes('grandmaster')) {
        return (
            <svg
                viewBox="0 0 16 16"
                className={className}
                style={style}
                fill="none"
                aria-label="Arena Master Insignia"
            >
                <path
                    d="M8 1.2L10.2 3.5L13.5 3L12.5 6.5L15 9L12 11.5L12.5 15L9 13.5L8 15L7 13.5L3.5 15L4 11.5L1 9L3.5 6.5L2.5 3L5.8 3.5L8 1.2Z"
                    stroke="#ea580c"
                    strokeWidth="1.1"
                    fill="#7c2d12"
                    fillOpacity="0.5"
                />
                <circle cx="8" cy="8.5" r="2.8" fill="#f97316" stroke="#fdba74" strokeWidth="0.8" />
                <path d="M7 8.5H9M8 7.5V9.5" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" />
            </svg>
        );
    }

    if (norm.includes('diamond')) {
        return (
            <svg
                viewBox="0 0 16 16"
                className={className}
                style={style}
                fill="none"
                aria-label="Diamond Insignia"
            >
                <path
                    d="M5 2.5H11L14.5 6.5L8 14.2L1.5 6.5L5 2.5Z"
                    stroke="#22d3ee"
                    strokeWidth="1.2"
                    fill="#0891b2"
                    fillOpacity="0.4"
                />
                <path d="M1.5 6.5H14.5" stroke="#67e8f9" strokeWidth="0.9" />
                <path d="M5 2.5L3.5 6.5L8 14L12.5 6.5L11 2.5" stroke="#a5f3fc" strokeWidth="0.8" />
                <path d="M8 2.5V14" stroke="#e0f2fe" strokeWidth="0.8" strokeDasharray="1.5 1.5" />
            </svg>
        );
    }

    if (norm.includes('platinum')) {
        return (
            <svg
                viewBox="0 0 16 16"
                className={className}
                style={style}
                fill="none"
                aria-label="Platinum Insignia"
            >
                <path
                    d="M8 1.5L2.8 4.5L3.8 9.5C4.3 12 6.5 13.8 8 14.5C9.5 13.8 11.7 12 12.2 9.5L13.2 4.5L8 1.5Z"
                    stroke="#60a5fa"
                    strokeWidth="1.2"
                    fill="#1e3a8a"
                    fillOpacity="0.4"
                />
                <path d="M8 4L10.5 7L8 12L5.5 7L8 4Z" fill="#93c5fd" stroke="#3b82f6" strokeWidth="0.8" />
                <path d="M5.5 7H10.5" stroke="#dbeafe" strokeWidth="0.8" />
            </svg>
        );
    }

    if (norm.includes('gold')) {
        return (
            <svg
                viewBox="0 0 16 16"
                className={className}
                style={style}
                fill="none"
                aria-label="Gold Insignia"
            >
                <path
                    d="M8 1.5L2 4.5V8C2 11.8 4.8 14.2 8 15C11.2 14.2 14 11.8 14 8V4.5L8 1.5Z"
                    stroke="#eab308"
                    strokeWidth="1.2"
                    fill="#854d0e"
                    fillOpacity="0.4"
                />
                <path
                    d="M8 4.2L9.2 6.8L12 7.1L9.9 9.1L10.5 11.9L8 10.4L5.5 11.9L6.1 9.1L4 7.1L6.8 6.8L8 4.2Z"
                    fill="#facc15"
                    stroke="#ca8a04"
                    strokeWidth="0.8"
                />
            </svg>
        );
    }

    if (norm.includes('silver')) {
        return (
            <svg
                viewBox="0 0 16 16"
                className={className}
                style={style}
                fill="none"
                aria-label="Silver Insignia"
            >
                <path
                    d="M8 1.5L2.5 4V8.5C2.5 11.5 5 13.8 8 14.5C11 13.8 13.5 11.5 13.5 8.5V4L8 1.5Z"
                    stroke="#94a3b8"
                    strokeWidth="1.2"
                    fill="#334155"
                    fillOpacity="0.4"
                />
                <path
                    d="M5 5.5L8 8L11 5.5"
                    stroke="#cbd5e1"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M5 8.5L8 11L11 8.5"
                    stroke="#f8fafc"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }

    // Default to Bronze
    return (
        <svg
            viewBox="0 0 16 16"
            className={className}
            style={style}
            fill="none"
            aria-label="Bronze Insignia"
        >
            <path
                d="M8 1.5L2.5 4V8.5C2.5 11.5 5 13.8 8 14.5C11 13.8 13.5 11.5 13.5 8.5V4L8 1.5Z"
                stroke="#b45309"
                strokeWidth="1.2"
                fill="#78350f"
                fillOpacity="0.4"
            />
            <path
                d="M5 7L8 9.5L11 7"
                stroke="#f59e0b"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/**
 * Returns the thematic text color class matching the rank tier.
 */
export function getTierColorClass(tier?: string | null, isAi = false): string {
    if (isAi) return 'text-amber-400/80';
    const norm = (tier || '').toLowerCase().trim();
    if (norm.includes('master')) return 'text-orange-400';
    if (norm.includes('diamond')) return 'text-cyan-300';
    if (norm.includes('platinum')) return 'text-blue-400';
    if (norm.includes('gold')) return 'text-yellow-400';
    if (norm.includes('silver')) return 'text-slate-300';
    return 'text-amber-500/90';
}

export default RankTierIcon;
