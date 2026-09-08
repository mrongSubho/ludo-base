"use client";

import React from 'react';
import { TokenIcon } from './HeaderNavPanel';
import { ChatIcon, SlidersIcon } from './icons';

// ─── BoardHeaderCompact ──────────────────────────────────────────────────────
// In-game header: ONE shell pill holding the main-header clusters
// (coins / profile / DM+settings) with the mode strip ("Power 2v2 10k")
// docked inside as its own inner pill. In-flow + sticky (never absolute)
// so it can never overlap board elements.

interface BoardHeaderCompactProps {
    finalAvatar: string | null;
    finalName: string;
    level: number;
    tier: string;
    coins: number;
    unreadCount: number;
    hasNotifications: boolean;
    onMessagesClick: () => void;
    onSettingsClick: () => void;
    modeLabel: string;
    spectators?: number;
    streamNode?: React.ReactNode;
}

export const BoardHeaderCompact = ({
    finalAvatar,
    finalName,
    level,
    tier,
    coins,
    unreadCount,
    hasNotifications,
    onMessagesClick,
    onSettingsClick,
    modeLabel,
    spectators = 0,
    streamNode,
}: BoardHeaderCompactProps) => {
    return (
        <header className="board-compact-header ludo-header-scope px-0 pt-2 sticky top-0 z-[200]">
            {/* ── Single shell: clusters row + mode strip live inside ── */}
            <div className="board-header-shell shimmer-effect relative overflow-hidden bg-transparent border border-cyan-500/50 rounded-[18px] shadow-[0_4px_25px_rgba(0,0,0,0.45)] px-1 pt-1 pb-1.5 flex flex-col gap-1">
                {/* Clusters row: same design language as the main header */}
                <div className="flex items-center justify-between gap-1">
                    {/* Cluster 1: Left - Coin Balance */}
                    <div className="w-[86px] flex-none h-[34px] flex items-center justify-start">
                        <div className="flex items-center gap-1.5 z-10 px-2.5 w-full justify-start">
                            <div className="w-4 h-4 text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.7)] flex-shrink-0">
                                <TokenIcon />
                            </div>
                            <span className="text-xs font-black text-white tracking-tight truncate max-w-[56px]">
                                {coins.toLocaleString()}
                            </span>
                        </div>
                    </div>

                    <div className="w-px h-6 bg-white/10 flex-none" />

                    {/* Cluster 2: Center - User Profile */}
                    <div className="flex-1 max-w-[150px] h-[34px] flex items-center justify-center">
                        <div className="flex items-center gap-1.5 w-full justify-center z-10 px-1">
                            <div className="relative flex-shrink-0">
                                <div className="w-6 h-6 rounded-full overflow-hidden border-2 border-cyan-400/60 bg-[#1a1c29] shadow-[0_0_15px_rgba(34,211,238,0.4)]">
                                    {finalAvatar ? (
                                        <img src={finalAvatar} alt={finalName} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-cyan-300">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                        </div>
                                    )}
                                </div>
                                {/* Green Online Status Dot */}
                                <span className="absolute -bottom-0 -right-0 w-2 h-2 bg-green-500 border border-[#0b0f19] rounded-full shadow-[0_0_12px_rgba(34,197,94,1)] animate-pulse"></span>

                                {/* Level anchored to bottom of avatar */}
                                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-cyan-600 text-white text-[6px] font-black px-1 rounded-full border border-white/40 shadow-lg z-10 whitespace-nowrap leading-tight">
                                    LV.{level}
                                </div>
                            </div>

                            <div className="flex flex-col items-start min-w-0 pr-1 max-w-[72px]">
                                <span className="text-[9px] font-black text-white italic tracking-tighter uppercase truncate w-full">
                                    {finalName}
                                </span>
                                <span className="text-[6px] font-bold text-cyan-300 uppercase tracking-widest leading-none mt-0.5">
                                    {tier}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="w-px h-6 bg-white/10 flex-none" />

                    {/* Cluster 3: Right - Actions (DM + Settings) */}
                    <div className="w-[86px] flex-none h-[34px] flex items-center justify-end">
                        <div className="flex items-center gap-0.5 z-10 w-full justify-end px-1.5">
                            <button
                                className={`w-7 h-7 flex items-center justify-center rounded-full text-white/95 hover:text-white hover:bg-white/10 transition-all relative ${unreadCount > 0 ? 'ping-glow' : ''}`}
                                onClick={onMessagesClick}
                                title="Messages"
                            >
                                <ChatIcon className="w-5 h-5" />
                                {hasNotifications && (
                                    <span className="absolute top-0 left-0 w-2 h-2 rounded-full bg-amber-400 border border-[#131520] shadow-[0_0_10px_rgba(251,191,36,0.9)] animate-pulse" />
                                )}
                                {unreadCount > 0 && (
                                    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 bg-white text-black text-[8px] font-black rounded-full shadow-[0_0_12px_rgba(255,255,255,0.7)] border border-cyan-500/30">
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </span>
                                )}
                            </button>

                            <div className="w-px h-4 bg-white/20 mx-0.5"></div>

                            <button
                                className="w-7 h-7 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
                                onClick={onSettingsClick}
                                title="Settings"
                            >
                                <SlidersIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Mode strip: pure status pill, one line, 7px, theme-proof ── */}
                <div className="mode-strip-pill mx-0.5 flex items-center justify-between rounded-full border border-white/10 bg-white/5 pl-1.5 pr-1.5 py-[5px]">
                    <span className="w-6 flex-none" />

                    <span className="mode-strip-text text-[7px] font-black uppercase tracking-[0.3em] text-cyan-300 whitespace-nowrap overflow-hidden text-ellipsis px-2">
                        {modeLabel}
                    </span>

                    <div className="flex-none min-w-[24px] flex items-center justify-end gap-1.5">
                        {spectators > 0 && (
                            <span
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[7px] font-black bg-pink-500/15 text-pink-300 border border-pink-500/30 whitespace-nowrap"
                                title="Spectators watching this match"
                            >
                                <span className="w-1 h-1 rounded-full bg-pink-400 animate-pulse" />
                                {spectators}
                            </span>
                        )}
                        {streamNode}
                    </div>
                </div>
            </div>
        </header>
    );
};
