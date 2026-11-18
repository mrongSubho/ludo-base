"use client";

import React from "react";
import type { ClanCrest } from "@/lib/clan/types";

export const CREST_EMBLEMS = ["shield", "swords", "crown", "diamond"] as const;
export type CrestEmblem = (typeof CREST_EMBLEMS)[number];

export const CREST_PALETTES: Array<{ primary: string; secondary: string; label: string }> = [
    { primary: "#00E5FF", secondary: "#0D1117", label: "Cyber Cyan" },
    { primary: "#F59E0B", secondary: "#1C1407", label: "Solar Amber" },
    { primary: "#10B981", secondary: "#062018", label: "Emerald Ops" },
    { primary: "#F43F5E", secondary: "#1F0910", label: "Crimson Edge" },
];

export function ShieldIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
    );
}

export function SwordsIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
            <line x1="13" y1="19" x2="19" y2="13" />
            <line x1="16" y1="16" x2="20" y2="20" />
            <line x1="19" y1="21" x2="21" y2="19" />
            <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
            <line x1="5" y1="14" x2="9" y2="18" />
            <line x1="7" y1="17" x2="4" y2="20" />
            <line x1="3" y1="19" x2="5" y2="21" />
        </svg>
    );
}

export function CrownIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18h18l-2-10-4.5 4L12 5l-2.5 7L5 8z" />
            <line x1="3" y1="21" x2="21" y2="21" />
        </svg>
    );
}

export function StarIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
    );
}

export function DiamondIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h12l4 6-10 12L2 9z" />
        </svg>
    );
}

export function SettingsGearIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

export function ClanCrestBadge({
    crest,
    tag,
    size = "md",
}: {
    crest?: Partial<ClanCrest> | null;
    tag?: string;
    size?: "sm" | "md" | "lg";
}) {
    const primary = crest?.primary || "#00E5FF";
    const secondary = crest?.secondary || "#0D1117";
    const emblem = crest?.emblem || "shield";
    const boxSize = size === "lg" ? "w-12 h-12" : size === "sm" ? "w-8 h-8" : "w-10 h-10";
    const iconSize = size === "lg" ? "w-6 h-6" : size === "sm" ? "w-4 h-4" : "w-5 h-5";

    const renderEmblem = () => {
        if (emblem === "swords") return <SwordsIcon className={iconSize} />;
        if (emblem === "crown") return <CrownIcon className={iconSize} />;
        if (emblem === "diamond") return <DiamondIcon className={iconSize} />;
        return <ShieldIcon className={iconSize} />;
    };

    return (
        <div
            className={`${boxSize} rounded-xl flex items-center justify-center shrink-0 relative overflow-hidden border`}
            style={{
                backgroundColor: secondary,
                borderColor: primary,
                color: primary,
                boxShadow: `0 0 14px ${primary}33`,
            }}
            title={tag ? `[${tag}]` : undefined}
        >
            {renderEmblem()}
        </div>
    );
}
