"use client";

import React from 'react';

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

export const TokenIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v12M8 10h8M8 14h8" />
    </svg>
);

const HeaderMessageIcon = () => (
    <svg className="dm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
);

// ─── Component ───────────────────────────────────────────────────────────────

interface HeaderNavPanelProps {
    finalAvatar: string | null;
    finalName: string;
    hasUnreadMessages: boolean;
    onMessagesClick: () => void;
    onSettingsClick: () => void;
}

export const HeaderNavPanel = ({
    finalAvatar,
    finalName,
    hasUnreadMessages,
    onMessagesClick,
    onSettingsClick
}: HeaderNavPanelProps) => {
    return (
        <header className="header dash-header px-safe">
            <div className="header-left">
                <div className="token-pill shimmer-effect">
                    <TokenIcon />
                    <span>1,250</span>
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
                    <span className="user-level-mini">Lv.8</span>
                </div>
            </div>
            <div className="header-right">
                <button
                    className={`dm-btn ${hasUnreadMessages ? 'ping-glow' : ''}`}
                    onClick={onMessagesClick}
                    title="Messages"
                >
                    <HeaderMessageIcon />
                    {/* Glowing Notification Pulse */}
                    {hasUnreadMessages && (
                        <span className="absolute top-2 right-2 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
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
