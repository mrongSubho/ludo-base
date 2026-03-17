"use client";

import React from 'react';
import { BiMessageSquareEdit } from "react-icons/bi";

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

export const TokenIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v12M8 10h8M8 14h8" />
    </svg>
);

const HeaderMessageIcon = () => (
    <BiMessageSquareEdit className="dm-icon" />
);

// ─── Component ───────────────────────────────────────────────────────────────

interface HeaderNavPanelProps {
    finalAvatar: string | null;
    finalName: string;
    level: number;
    coins: number;
    unreadCount: number;
    onMessagesClick: () => void;
    onSettingsClick: () => void;
}

export const HeaderNavPanel = ({
    finalAvatar,
    finalName,
    level,
    coins,
    unreadCount,
    onMessagesClick,
    onSettingsClick
}: HeaderNavPanelProps) => {
    return (
        <header className="header dash-header px-safe">
            <div className="header-left">
                <div className="token-pill shimmer-effect">
                    <TokenIcon />
                    <span>{coins.toLocaleString()}</span>
                </div>
            </div>
            <div className="header-center">
                <div className="user-avatar-mini relative">
                    {finalAvatar ? <img src={finalAvatar} alt={finalName} className="w-full h-full object-cover rounded-full" /> : <span>🎮</span>}
                    {/* Green Online Status Dot */}
                    <span className="absolute bottom-[-2px] right-[-2px] w-3 h-3 bg-green-500 border-2 border-[#0b0f19] rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                </div>
                <div className="user-info-mini">
                    <span className="user-name-mini">{finalName}</span>
                    <span className="user-level-mini">Lv.{level}</span>
                </div>
            </div>
            <div className="header-right">
                <button
                    className={`dm-btn ${unreadCount > 0 ? 'ping-glow' : ''}`}
                    onClick={onMessagesClick}
                    title="Messages"
                >
                    <HeaderMessageIcon />
                    {/* Cyan Number Badge */}
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-cyan-500 text-black text-[10px] font-black rounded-full shadow-[0_0_10px_rgba(6,182,212,0.6)] border border-white/20">
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </button>
                <button className="settings-dots-btn" onClick={onSettingsClick} title="Settings">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                    </svg>
                </button>
            </div>
        </header>
    );
};
