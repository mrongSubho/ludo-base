"use client";

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useIsMobileView } from '@/hooks/useIsMobileView';
import {
    ApexRankIcon,
    ArenaBladesIcon,
    ArmoryCrateIcon,
    DirectiveTargetIcon,
    SquadLinkIcon,
    SyndicateShieldIcon,
} from './icons';

// Tab Type
type Tab = 'friends' | 'leaderboard' | 'mission' | 'arena' | 'marketplace' | 'settings' | 'messages' | 'wallet' | 'profile' | 'clan' | null;

// ─── Component ───────────────────────────────────────────────────────────────

interface FooterNavPanelProps {
    activeTab: Tab;
    onToggleTab: (tab: Tab) => void;
    onCloseTab: () => void;
    selectedChatId: string | null;
    onSelectChat: (id: string | null) => void;
    onOpenProfile: (address: string) => void;
}

const NAV_TABS = [
    { id: 'friends', icon: SquadLinkIcon, label: 'Friends' },
    { id: 'leaderboard', icon: ApexRankIcon, label: 'Leaderboard' },
    { id: 'clan', icon: SyndicateShieldIcon, label: 'Clan' },
    { id: 'mission', icon: DirectiveTargetIcon, label: 'Mission' },
    { id: 'arena', icon: ArenaBladesIcon, label: 'Arena' },
    { id: 'marketplace', icon: ArmoryCrateIcon, label: 'Market' },
] as const;

export const FooterNavPanel = ({
    activeTab,
    onToggleTab,
}: FooterNavPanelProps) => {
    // Mobile: no layout spring / backdrop-blur on the active pill — those
    // stall the compositor while sandwich panels are mounting beside it.
    const isMobile = useIsMobileView();

    // Single source of truth for footer clearance: measure the real rendered
    // box (compact vs full breakpoint, font loading — safe-area padding included).
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

    return (
        <nav className="footer-nav ludo-footer-scope overflow-hidden">
            {NAV_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        className={`nav-item relative z-10 group ${isActive ? 'active' : ''}`}
                        onClick={() => onToggleTab(tab.id as Tab)}
                        aria-pressed={isActive}
                    >
                        {/* Active indicator: static on mobile, spring slide on desktop */}
                        {isActive &&
                            (isMobile ? (
                                <div
                                    className="footer-active-plate absolute inset-0 border border-white/10 rounded-2xl -z-10"
                                    style={{ background: 'var(--nav-active-bg, rgba(13, 13, 13, 0.4))' }}
                                >
                                    <span className="footer-active-laser" aria-hidden="true" />
                                </div>
                            ) : (
                                <motion.div
                                    layoutId="active-nav-bg"
                                    className="footer-active-plate absolute inset-0 border border-white/10 rounded-2xl -z-10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
                                    style={{ background: 'var(--nav-active-bg, rgba(13, 13, 13, 0.4))' }}
                                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                                >
                                    <span className="footer-active-laser" aria-hidden="true" />
                                </motion.div>
                            ))}

                        {/* Hover Background */}
                        {!isActive && (
                            <div className="absolute inset-0 bg-white/[0.04] border border-white/5 rounded-2xl -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                        )}

                        <div className="relative inline-flex items-center justify-center">
                            <Icon className="nav-icon" active={isActive} />
                        </div>

                        <span className="nav-label">{tab.label}</span>
                    </button>
                );
            })}
        </nav>
    );
};
