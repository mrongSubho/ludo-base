"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// Panel Imports
import UserProfilePanel from './UserProfilePanel';
import FriendsPanel from './FriendsPanel';
import Leaderboard from './Leaderboard';
import MissionPanel from './MissionPanel';
import MarketplacePanel from './MarketplacePanel';
import MessagesPanel from './MessagesPanel';

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

const ProfileIcon = () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
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

const TargetIcon = () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
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

type Tab = 'profile' | 'friends' | 'leaderboard' | 'mission' | 'marketplace' | 'settings' | 'messages' | null;

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
    const { address: connectedAddress } = useCurrentUser();
    const [pendingCount, setPendingCount] = useState(0);

    useEffect(() => {
        if (!connectedAddress) return;

        const fetchPendingCount = async () => {
            const { count } = await supabase
                .from('friendships')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending')
                .ilike('friend_address', connectedAddress);

            if (count !== null) setPendingCount(count);
        };

        fetchPendingCount();
        const interval = setInterval(fetchPendingCount, 15000); // Poll every 15s to update badge
        return () => clearInterval(interval);
    }, [connectedAddress]);

    return (
        <>
            <nav className="footer-nav relative overflow-hidden">
                {[
                    { id: 'profile', icon: ProfileIcon, label: 'Profile' },
                    { id: 'friends', icon: UsersIcon, label: 'Friends' },
                    { id: 'leaderboard', icon: TrophyIcon, label: 'Leaderboard' },
                    { id: 'mission', icon: TargetIcon, label: 'Mission' },
                    { id: 'marketplace', icon: ShopIcon, label: 'Market' }
                ].map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            className={`nav-item relative z-10 group ${isActive ? 'active' : ''}`}
                            onClick={() => onToggleTab(tab.id as Tab)}
                        >
                            {/* Active Sliding Background */}
                            {isActive && (
                                <motion.div
                                    layoutId="active-nav-bg"
                                    className="absolute inset-0 bg-purple-600/10 rounded-[20px] backdrop-blur-sm -z-10"
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                />
                            )}
                            {/* Hover Background */}
                            {!isActive && (
                                <div className="absolute inset-0 bg-purple-600/10 rounded-[20px] backdrop-blur-sm -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                            )}

                            <div className="relative inline-flex items-center justify-center">
                                {/* Pending Friend Requests Badge */}
                                {tab.id === 'friends' && pendingCount > 0 && (
                                    <div className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] font-bold px-1 py-0 rounded-full border border-[#131520] z-20 shadow-md min-w-[16px] text-center">
                                        {pendingCount > 9 ? '9+' : pendingCount}
                                    </div>
                                )}
                                <Icon />
                            </div>

                            <span className="nav-label">{tab.label}</span>
                        </button>
                    );
                })}
            </nav>

            {/* Slide-up Panels for footer tabs */}
            <AnimatePresence mode="wait">
                {activeTab === 'profile' && (
                    <UserProfilePanel key="profile" onClose={onCloseTab} />
                )}
                {activeTab === 'friends' && (
                    <FriendsPanel
                        key="friends"
                        onClose={onCloseTab}
                        onDM={(friendId) => {
                            onSelectChat(friendId);
                            onToggleTab('messages');
                        }}
                        onOpenProfile={onOpenProfile}
                    />
                )}
                {activeTab === 'leaderboard' && (
                    <Leaderboard
                        key="leaderboard"
                        isOpen={true}
                        onClose={onCloseTab}
                        onOpenProfile={onOpenProfile}
                    />
                )}
                {activeTab === 'mission' && (
                    <MissionPanel key="mission" isOpen={true} onClose={onCloseTab} />
                )}
                {activeTab === 'marketplace' && (
                    <MarketplacePanel key="marketplace" isOpen={true} onClose={onCloseTab} />
                )}

                {activeTab === 'messages' && (
                    <MessagesPanel
                        key="messages"
                        onClose={() => {
                            onCloseTab();
                            onSelectChat(null);
                        }}
                        initialChatId={selectedChatId}
                        onOpenProfile={onOpenProfile}
                    />
                )}
            </AnimatePresence>
        </>
    );
};
