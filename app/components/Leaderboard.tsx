'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type LeaderboardTab = 'tier' | 'daily' | 'monthly';

interface LeaderboardEntry {
    id: string;
    name: string;
    avatar: string;
    wins: number;
    lastWin: number;
    isCurrentUser?: boolean;

    // Advanced Ranking Fields
    tier: 'Legendary' | 'Platinum' | 'Gold' | 'Silver' | 'Rookie';
    stage: 'I' | 'II' | 'III';
}

interface LeaderboardProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Leaderboard({ isOpen, onClose }: LeaderboardProps) {
    const [activeTab, setActiveTab] = useState<LeaderboardTab>('tier');

    // MOCK DATA: 5-Tier Advanced Ranking System
    const getStats = (tab: LeaderboardTab): LeaderboardEntry[] => {
        const dummyEntries: LeaderboardEntry[] = [
            { id: '1', name: 'Mrong', avatar: '1', wins: 42, lastWin: Date.now() - 3600000, isCurrentUser: true, tier: 'Platinum', stage: 'I' },
            { id: '2', name: 'Fahmida', avatar: '2', wins: 89, lastWin: Date.now() - 86400000, tier: 'Legendary', stage: 'III' },
            { id: '3', name: 'Gemini (AI)', avatar: '3', wins: 12, lastWin: Date.now() - 172800000, tier: 'Silver', stage: 'II' },
            { id: '4', name: 'Core (AI)', avatar: '4', wins: 8, lastWin: Date.now() - 259200000, tier: 'Rookie', stage: 'I' },
            { id: '5', name: 'Alex', avatar: '5', wins: 56, lastWin: Date.now() - 4000000, tier: 'Gold', stage: 'III' },
            { id: '6', name: 'Sarah Ludo', avatar: '6', wins: 24, lastWin: Date.now() - 900000, tier: 'Silver', stage: 'III' },
            { id: '7', name: 'MasterG', avatar: '7', wins: 102, lastWin: Date.now() - 120000, tier: 'Legendary', stage: 'II' }
        ];

        // Sort differently based on the active tab
        if (tab === 'tier') {
            // Sort by Tier Hierarchy, then Stage, then Wins
            const tierWeight = { 'Legendary': 5, 'Platinum': 4, 'Gold': 3, 'Silver': 2, 'Rookie': 1 };
            const stageWeight = { 'III': 3, 'II': 2, 'I': 1 };

            return dummyEntries.sort((a, b) => {
                const tierDiff = tierWeight[b.tier] - tierWeight[a.tier];
                if (tierDiff !== 0) return tierDiff;

                const stageDiff = stageWeight[b.stage] - stageWeight[a.stage];
                if (stageDiff !== 0) return stageDiff;

                return b.wins - a.wins;
            });
        }

        const now = new Date();
        const startOfDayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const startOfMonthUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

        // Daily: Only records from today (UTC)
        if (tab === 'daily') {
            return dummyEntries
                .filter(e => e.lastWin >= startOfDayUTC)
                .sort((a, b) => b.wins - a.wins);
        }

        // Monthly: Only records from this month (UTC)
        if (tab === 'monthly') {
            return dummyEntries
                .filter(e => e.lastWin >= startOfMonthUTC)
                .sort((a, b) => b.wins - a.wins);
        }

        return dummyEntries;
    };

    const stats = getStats(activeTab);

    // Map the standard 1,2,3 ranks for Daily/Monthly
    const getRankBadge = (rank: number) => {
        if (rank === 1) return <div className="w-8 h-8 rounded-full bg-yellow-400/20 text-yellow-400 font-extrabold flex items-center justify-center border border-yellow-400/30 shadow-[0_0_10px_rgba(250,204,21,0.2)]">1</div>;
        if (rank === 2) return <div className="w-8 h-8 rounded-full bg-slate-300/20 text-slate-300 font-bold flex items-center justify-center border border-slate-300/30">2</div>;
        if (rank === 3) return <div className="w-8 h-8 rounded-full bg-orange-700/20 text-orange-400 font-bold flex items-center justify-center border border-orange-700/30">3</div>;
        return <div className="w-8 h-8 text-white/40 font-bold flex items-center justify-center">{rank}</div>;
    };

    // Advanced Ranking UI Colors
    const getTierConfig = (tier: LeaderboardEntry['tier']) => {
        switch (tier) {
            case 'Legendary': return { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', shadow: 'shadow-[0_0_15px_rgba(239,68,68,0.3)]', dot: 'bg-red-400' };
            case 'Platinum': return { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', shadow: '', dot: 'bg-cyan-400' };
            case 'Gold': return { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', shadow: '', dot: 'bg-yellow-400' };
            case 'Silver': return { color: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/20', shadow: '', dot: 'bg-slate-300' };
            case 'Rookie': return { color: 'text-amber-700', bg: 'bg-amber-900/20', border: 'border-amber-900/30', shadow: '', dot: 'bg-amber-700' };
        }
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] h-[85vh] bg-[#1a1c29]/20 backdrop-blur-xl border-t border-white/10 rounded-t-[32px] z-50 flex flex-col shadow-2xl"
                    >
                        {/* Drag Handle */}
                        <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        {/* Header & Tabs */}
                        <div className="px-6 pb-4 border-b border-white/10 flex flex-col gap-4">
                            <div className="flex items-center justify-between mt-2">
                                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                    <span className="text-2xl">🏆</span>
                                    Leaderboard
                                </h2>
                                <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition-colors">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            {/* Tri-Tab Switcher */}
                            <div className="flex bg-black/30 p-1.5 rounded-2xl w-full max-w-sm mx-auto self-center">
                                {['tier', 'daily', 'monthly'].map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab as LeaderboardTab)}
                                        className={`flex-1 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl transition-all ${activeTab === tab
                                            ? 'bg-blue-600/80 text-white shadow-lg border border-blue-500/30'
                                            : 'text-white/40 hover:text-white/70'
                                            }`}
                                    >
                                        {tab === 'tier' ? 'TIER' : tab}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Leaderboard Content */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar relative">
                            {stats.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-60">
                                    <span className="text-6xl mb-4">👑</span>
                                    <h3 className="text-xl font-bold text-white mb-2">The throne is empty</h3>
                                    <p className="text-sm text-white/60">No records found for this period.</p>
                                </div>
                            ) : (
                                <div className="space-y-3 pb-20">
                                    <AnimatePresence mode="popLayout">
                                        {stats.map((entry, idx) => {
                                            const tierStyles = getTierConfig(entry.tier);
                                            const isMe = entry.isCurrentUser;

                                            return (
                                                <motion.div
                                                    layout
                                                    initial={{ opacity: 0, scale: 0.95 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    key={entry.id}
                                                    // Highlighted styling if it's the current user
                                                    className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${isMe
                                                        ? 'bg-indigo-500/20 border-2 border-indigo-400/50 shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                                                        : 'bg-white/5 border border-white/10 hover:bg-white/10'
                                                        }`}
                                                >
                                                    {/* Rank/Podium Badge */}
                                                    <div className="flex-shrink-0 mr-1">
                                                        {activeTab === 'tier' ? (
                                                            <div className="w-8 h-8 text-white/40 font-bold flex items-center justify-center text-sm">{idx + 1}</div>
                                                        ) : (
                                                            getRankBadge(idx + 1)
                                                        )}
                                                    </div>

                                                    {/* Avatar */}
                                                    <div className="relative">
                                                        <div className={`w-12 h-12 rounded-full overflow-hidden bg-[#2a2d3e] flex-shrink-0 border-2 ${isMe ? 'border-indigo-400' : 'border-white/10'}`}>
                                                            <img
                                                                src={`/avatars/${entry.avatar || (idx % 8 + 1)}.png`}
                                                                alt={entry.name}
                                                                className="w-full h-full object-cover"
                                                                onError={(e) => { e.currentTarget.src = '/avatars/1.png' }}
                                                            />
                                                        </div>
                                                        {isMe && (
                                                            <div className="absolute -bottom-1 -right-1 bg-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md border border-indigo-300">
                                                                YOU
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Info & Advanced Hierarchy */}
                                                    <div className="flex flex-col flex-1 min-w-0">
                                                        <span className={`font-bold text-[15px] truncate ${isMe ? 'text-indigo-100' : 'text-white'}`}>
                                                            {entry.name}
                                                        </span>

                                                        {activeTab === 'tier' ? (
                                                            // Display the Beautiful 5-Tier Badge System
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <div className={`w-2 h-2 rounded-full ${tierStyles.dot} ${tierStyles.shadow}`} />
                                                                <span className={`text-[11px] font-bold tracking-widest uppercase ${tierStyles.color}`}>
                                                                    {entry.tier} {entry.stage}
                                                                </span>
                                                            </div>
                                                        ) : null}
                                                    </div>

                                                    {/* Score Metric */}
                                                    <div className={`flex flex-col items-end justify-center rounded-xl px-4 py-2 border ${isMe ? 'bg-indigo-950/50 border-indigo-500/30' : 'bg-black/40 border-white/5'}`}>
                                                        <span className={`text-lg font-black leading-none ${isMe ? 'text-indigo-300' : 'text-indigo-400'}`}>
                                                            {entry.wins}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest mt-1">Wins</span>
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
