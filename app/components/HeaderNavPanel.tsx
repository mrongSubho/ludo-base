"use client";

import React from 'react';
import { HiOutlineAtSymbol } from "react-icons/hi";

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

export const TokenIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v12M8 10h8M8 14h8" />
    </svg>
);

// ─── Component ───────────────────────────────────────────────────────────────

interface HeaderNavPanelProps {
    finalAvatar: string | null;
    finalName: string;
    level: number;
    tier: string;
    coins: number;
    unreadCount: number;
    onMessagesClick: () => void;
    onSettingsClick: () => void;
}

export const HeaderNavPanel = ({
    finalAvatar,
    finalName,
    level,
    tier,
    coins,
    unreadCount,
    onMessagesClick,
    onSettingsClick
}: HeaderNavPanelProps) => {
    return (
        <header className="header dash-header px-0 flex items-center justify-between py-4 gap-1.5 sticky top-0 z-[200]">
            {/* [x] Header Redesign (3 Pills) */}
            {/* [x] Header Refinement (Compact Symmetrical Spaced Pills) */}
            {/* [x] Verify changes (Fixed widths and "free space" gaps) */}
            {/* Pill 1: Left - Coin Balance */}
            <div className="w-[110px] flex-none h-[44px] flex items-center justify-start bg-transparent border border-cyan-500/50 rounded-r-full rounded-l-none shadow-[0_4px_20px_rgba(0,0,0,0.4)] shimmer-effect relative overflow-hidden">
                <div className="flex items-center gap-2 z-10 px-3 w-full justify-start">
                    <div className="w-5 h-5 text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.7)] flex-shrink-0">
                        <TokenIcon />
                    </div>
                    <span className="text-sm font-black text-white tracking-tight truncate max-w-[80px]">
                        {coins.toLocaleString()}
                    </span>
                </div>
            </div>

            {/* Pill 2: Center - User Profile */}
            <div className="w-[150px] flex-none h-[44px] flex items-center justify-center bg-transparent border border-cyan-500/50 rounded-full shadow-[0_4px_25px_rgba(0,0,0,0.45)] shimmer-effect relative overflow-hidden">
                <div className="flex items-center gap-2.5 w-full justify-center z-10 px-1">
                    <div className="relative flex-shrink-0">
                        <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-cyan-400/60 bg-[#1a1c29] shadow-[0_0_15px_rgba(34,211,238,0.4)]">
                            {finalAvatar ? (
                                <img src={finalAvatar} alt={finalName} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-lg">🎮</div>
                            )}
                        </div>
                        {/* Green Online Status Dot */}
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-[#0b0f19] rounded-full shadow-[0_0_12px_rgba(34,197,94,1)] animate-pulse"></span>

                        {/* Level anchored to bottom of avatar */}
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-cyan-600 text-white text-[7px] font-black px-1.5 rounded-full border border-white/40 shadow-lg z-10 whitespace-nowrap scale-105">
                            LV.{level}
                        </div>
                    </div>

                    <div className="flex flex-col items-start min-w-0 pr-1 max-w-[80px]">
                        <span className="text-[10px] font-black text-white italic tracking-tighter uppercase truncate w-full">
                            {finalName}
                        </span>
                        <span className="text-[8px] font-bold text-cyan-300 uppercase tracking-widest leading-none mt-0.5">
                            {tier}
                        </span>
                    </div>
                </div>
            </div>

            {/* Pill 3: Right - Actions */}
            <div className="w-[110px] flex-none h-[44px] flex items-center justify-end bg-transparent border border-cyan-500/50 rounded-l-full rounded-r-none shadow-[0_4px_20px_rgba(0,0,0,0.9)] shimmer-effect relative overflow-hidden">
                <div className="flex items-center gap-1 z-10 w-full justify-end px-2">
                    <button
                        className={`w-9 h-9 flex items-center justify-center rounded-full text-white/95 hover:text-white hover:bg-white/10 transition-all relative ${unreadCount > 0 ? 'ping-glow' : ''}`}
                        onClick={onMessagesClick}
                        title="Messages"
                    >
                        <HiOutlineAtSymbol className="w-6 h-6" />
                        {/* White Number Badge */}
                        {unreadCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-[16px] px-1 bg-white text-black text-[9px] font-black rounded-full shadow-[0_0_12px_rgba(255,255,255,0.7)] border border-cyan-500/30">
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                        )}
                    </button>
                    
                    <div className="w-px h-5 bg-white/20 mx-1"></div>

                    <button
                        className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
                        onClick={onSettingsClick}
                        title="Settings"
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                        </svg>
                    </button>
                </div>
            </div>
        </header>
    );
};
