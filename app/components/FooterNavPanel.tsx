/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAccount, useChainId } from 'wagmi';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useIsMobileView } from '@/hooks/useIsMobileView';
import { StatusBadge, StatusBadgeState } from './account/StatusBadge';
import { AccountSheet } from './account/AccountSheet';
import { useAccountDockState, TARGET_CHAIN_ID } from './account/useAccountDockState';

// Tab Type
type Tab = 'friends' | 'leaderboard' | 'mission' | 'arena' | 'marketplace' | 'settings' | 'messages' | 'wallet' | 'profile' | 'clan' | null;

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

const ShieldIcon = () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);

const UsersIcon = () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const TrophyIcon = () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21h8M12 17v4M7 4h10M5 4h14v5a7 7 0 0 1-14 0V4z" />
    </svg>
);

const TournamentIcon = () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
);

const MissionIcon = () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
);

const ShopIcon = () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
);

// ─── Component ───────────────────────────────────────────────────────────────

interface FooterNavPanelProps {
    activeTab: Tab;
    onToggleTab: (tab: Tab) => void;
    onCloseTab: () => void;
    selectedChatId: string | null;
    onSelectChat: (id: string | null) => void;
    onOpenProfile: (address: string) => void;
}

export const FooterNavPanel = ({
    activeTab,
    onToggleTab,
    onCloseTab,
    selectedChatId,
    onSelectChat,
    onOpenProfile
}: FooterNavPanelProps) => {
    // Mobile: no layout spring / backdrop-blur on the active pill — those
    // stall the compositor while sandwich panels are mounting beside it.
    const isMobile = useIsMobileView();
    const { profile, address, displayName, isConnected } = useCurrentUser();
    const chainId = useChainId();

    const {
        isExpanded,
        isConfirmingDisconnect,
        expand,
        collapse,
        requestDisconnect,
        cancelDisconnect,
        confirmDisconnect,
    } = useAccountDockState({
        isConnected,
        chainId,
    });

    const isWrongChain = chainId != null && chainId !== TARGET_CHAIN_ID;
    const statusState: StatusBadgeState = !isConnected ? "offline" : isWrongChain ? "pending" : "online";

    // Whenever a panel tab opens, collapse the account sheet
    useEffect(() => {
        if (activeTab !== null) {
            collapse();
        }
    }, [activeTab, collapse]);

    // Single source of truth for footer clearance: measure the real rendered
    // box (compact vs full breakpoint, font loading — safe-area padding
    // included). Use sites add breathing room ONLY, never env(safe-area…)
    // again: in-app webviews report large bottom insets and it triple-counts.
    useEffect(() => {
        const el = document.querySelector('.footer-nav');
        if (!el) return;
        const set = () => {
            document.documentElement.style.setProperty('--footer-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
        };
        set();
        const ro = new ResizeObserver(set);
        ro.observe(el);
        window.addEventListener('resize', set);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', set);
        };
    }, []);

    const navTabs = [
        { id: 'friends', icon: UsersIcon, label: 'Friends' },
        { id: 'leaderboard', icon: TrophyIcon, label: 'Leaderboard' },
        { id: 'clan', icon: ShieldIcon, label: 'Clan' },
        { id: 'mission', icon: MissionIcon, label: 'Mission' },
        { id: 'arena', icon: TournamentIcon, label: 'Arena' },
        { id: 'marketplace', icon: ShopIcon, label: 'Market' },
    ] as const;

    return (
        <>
            <nav className="footer-nav ludo-footer-scope overflow-hidden">
                {navTabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            className={`nav-item relative z-10 group ${isActive ? 'active' : ''}`}
                            onClick={() => {
                                collapse();
                                onToggleTab(tab.id as Tab);
                            }}
                        >
                            {/* Active indicator: static on mobile, spring slide on desktop */}
                            {isActive && (isMobile ? (
                                <div
                                    className="absolute inset-0 border border-line-subtle rounded-2xl -z-10"
                                    style={{ background: 'var(--nav-active-bg, var(--surface-1))' }}
                                />
                            ) : (
                                <motion.div
                                    layoutId="active-nav-bg"
                                    className="absolute inset-0 border border-line-subtle rounded-2xl -z-10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
                                    style={{ background: 'var(--nav-active-bg, var(--surface-1))' }}
                                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                                />
                            ))}
                            {/* Hover Background */}
                            {!isActive && (
                                <div className="absolute inset-0 bg-surface-1 border border-line-dim rounded-2xl -z-10 opacity-0 group-hover:opacity-100 transition-all duration-300" />
                            )}

                            <div className="relative inline-flex items-center justify-center">
                                <Icon />
                            </div>

                            <span className="nav-label">{tab.label}</span>
                        </button>
                    );
                })}

                {/* §5.1 / D1 Mobile Account Avatar Slot */}
                <button
                    key="account"
                    type="button"
                    aria-label="Account"
                    aria-expanded={isExpanded}
                    className={`nav-item relative z-10 group ${isExpanded ? 'active' : ''}`}
                    onClick={() => {
                        if (activeTab !== null) {
                            onCloseTab();
                        }
                        if (isExpanded) {
                            collapse();
                        } else {
                            expand();
                        }
                    }}
                >
                    {isExpanded && (isMobile ? (
                        <div
                            className="absolute inset-0 border border-line-subtle rounded-2xl -z-10"
                            style={{ background: 'var(--nav-active-bg, var(--surface-1))' }}
                        />
                    ) : (
                        <motion.div
                            layoutId="active-nav-bg"
                            className="absolute inset-0 border border-line-subtle rounded-2xl -z-10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
                            style={{ background: 'var(--nav-active-bg, var(--surface-1))' }}
                            transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        />
                    ))}
                    {!isExpanded && (
                        <div className="absolute inset-0 bg-surface-1 border border-line-dim rounded-2xl -z-10 opacity-0 group-hover:opacity-100 transition-all duration-300" />
                    )}

                    <div className="relative inline-flex items-center justify-center">
                        <div className="relative w-6 h-6 rounded-md bg-surface-2 border border-line-dim flex items-center justify-center overflow-hidden">
                            {profile?.avatar_url ? (
                                <img src={profile.avatar_url} alt={displayName} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-accent font-mono text-ludo-xs font-bold">
                                    {displayName ? displayName.slice(0, 2).toUpperCase() : 'G'}
                                </div>
                            )}
                            <StatusBadge status={statusState} size={7} />
                        </div>
                    </div>

                    <span className="nav-label">Account</span>
                </button>
            </nav>

            {/* §5.1 / §5.3 / D1 Mobile Account Bottom Sheet */}
            <AccountSheet
                isOpen={isExpanded}
                onClose={collapse}
                onOpenProfile={() => {
                    collapse();
                    onToggleTab('profile');
                }}
                onOpenHistory={() => {
                    collapse();
                    onToggleTab('profile');
                }}
                onOpenSettings={() => {
                    collapse();
                    onToggleTab('settings');
                }}
                onOpenAllowances={() => {
                    collapse();
                    onToggleTab('wallet');
                }}
                isConfirmingDisconnect={isConfirmingDisconnect}
                onRequestDisconnect={requestDisconnect}
                onCancelDisconnect={cancelDisconnect}
                onConfirmDisconnect={confirmDisconnect}
            />
        </>
    );
};
