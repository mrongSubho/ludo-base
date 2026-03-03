'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';

const ITEMS_PER_PAGE = 20;

const getTierFromWins = (wins: number) => {
    if (wins >= 100) return { tier: 'Legendary' as const, stage: wins >= 150 ? 'III' as const : (wins >= 125 ? 'II' as const : 'I' as const) };
    if (wins >= 50) return { tier: 'Platinum' as const, stage: wins >= 80 ? 'III' as const : (wins >= 65 ? 'II' as const : 'I' as const) };
    if (wins >= 20) return { tier: 'Gold' as const, stage: wins >= 40 ? 'III' as const : (wins >= 30 ? 'II' as const : 'I' as const) };
    if (wins >= 5) return { tier: 'Silver' as const, stage: wins >= 15 ? 'III' as const : (wins >= 10 ? 'II' as const : 'I' as const) };
    return { tier: 'Rookie' as const, stage: wins >= 3 ? 'III' as const : (wins >= 1 ? 'II' as const : 'I' as const) };
};

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
    const { address } = useAccount();
    const [activeTab, setActiveTab] = useState<LeaderboardTab>('tier');
    const [scope, setScope] = useState<'global' | 'friends'>('global');
    const [showQuarterInfo, setShowQuarterInfo] = useState(false);
    const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;

    const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    useEffect(() => {
        const fetchLeaderboard = async () => {
            setIsLoading(true);
            const from = (currentPage - 1) * ITEMS_PER_PAGE;
            const to = from + ITEMS_PER_PAGE - 1;

            const { data, count, error } = await supabase
                .from('players')
                .select('*', { count: 'exact' })
                .order('total_wins', { ascending: false })
                .range(from, to);

            if (!error && data) {
                const formattedData = data.map(player => ({
                    id: player.wallet_address,
                    name: player.username || `${player.wallet_address.slice(0, 6)}...`,
                    avatar: player.avatar_url,
                    wins: player.total_wins,
                    lastWin: new Date(player.last_played_at).getTime(),
                    isCurrentUser: player.wallet_address === address,
                    ...getTierFromWins(player.total_wins)
                }));
                setLeaders(formattedData);
                if (count) setTotalPages(Math.ceil(count / ITEMS_PER_PAGE));
            }
            setIsLoading(false);
        };

        if (isOpen) {
            fetchLeaderboard();
        }
    }, [isOpen, activeTab, scope, currentPage, address]);

    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, scope]);

    const getRankBadge = (rank: number) => {
        if (rank === 1) return <div className="w-8 h-8 rounded-full bg-yellow-400/20 text-yellow-400 font-extrabold flex items-center justify-center border border-yellow-400/30 shadow-[0_0_10px_rgba(250,204,21,0.2)]">1</div>;
        if (rank === 2) return <div className="w-8 h-8 rounded-full bg-slate-300/20 text-slate-300 font-bold flex items-center justify-center border border-slate-300/30">2</div>;
        if (rank === 3) return <div className="w-8 h-8 rounded-full bg-orange-700/20 text-orange-400 font-bold flex items-center justify-center border border-orange-700/30">3</div>;
        return <div className="w-8 h-8 text-white/40 font-bold flex items-center justify-center">{rank}</div>;
    };

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
                        className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[468px] bg-[#1a1c29]/20 backdrop-blur-xl border border-white/10 rounded-[32px] z-[110] flex flex-col shadow-2xl overflow-hidden"
                    >
                        <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        <div className="px-panel-gutter pb-4 border-b border-white/10 flex flex-col gap-4">
                            <div className="flex items-center justify-between mt-2">
                                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-yellow-500">
                                        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                                        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                                        <path d="M4 22h16"></path>
                                        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                                        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                                        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
                                    </svg>
                                    Leaderboard
                                </h2>
                                <button
                                    onClick={onClose}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
                                <button
                                    onClick={() => setScope('global')}
                                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center justify-center gap-1.5 transition-all ${scope === 'global' ? 'bg-white/15 text-white shadow-md' : 'text-white/40 hover:text-white/70'}`}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                                    Global
                                </button>
                                <button
                                    onClick={() => setScope('friends')}
                                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center justify-center gap-1.5 transition-all ${scope === 'friends' ? 'bg-white/15 text-white shadow-md' : 'text-white/40 hover:text-white/70'}`}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                    Friends
                                </button>
                            </div>

                            <div className="flex bg-black/30 p-1.5 rounded-2xl w-full max-w-sm mx-auto self-center">
                                {(['tier', 'daily', 'monthly'] as LeaderboardTab[]).map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={`flex-1 py-2 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all ${activeTab === tab ? 'bg-indigo-600 text-white shadow-lg scale-[1.02]' : 'text-white/30 hover:text-white/60'}`}
                                    >
                                        {tab === 'tier' ? (
                                            <>
                                                TIER
                                                <div
                                                    className="relative"
                                                    onMouseEnter={() => setShowQuarterInfo(true)}
                                                    onMouseLeave={() => setShowQuarterInfo(false)}
                                                >
                                                    <span
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setShowQuarterInfo(!showQuarterInfo);
                                                        }}
                                                        className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold cursor-pointer ${activeTab === 'tier' ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-white/10 text-white/30'}`}
                                                    >
                                                        Q{currentQuarter}
                                                    </span>

                                                    <AnimatePresence>
                                                        {showQuarterInfo && (
                                                            <motion.div
                                                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                                exit={{ opacity: 0, y: 5, scale: 0.95 }}
                                                                className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-48 p-3 bg-[#1e2030]/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl z-50 normal-case tracking-normal text-left"
                                                            >
                                                                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#1e2030] border-t border-l border-white/20 rotate-45" />

                                                                <div className="relative z-10">
                                                                    <div className="flex items-center gap-1.5 mb-1.5">
                                                                        <span className="text-white text-xs font-bold w-full truncate">Quarterly Resets</span>
                                                                    </div>
                                                                    <p className="text-[10px] text-white/70 leading-snug">
                                                                        The Tier system ranks players across a 3-month season (Q1-Q4). Ranks reset at the start of the next quarter.
                                                                    </p>
                                                                </div>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            </>
                                        ) : tab}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar relative">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center h-full space-y-4">
                                    <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                                    <p className="text-white/40 text-xs font-bold uppercase tracking-widest animate-pulse">Syncing Throne...</p>
                                </div>
                            ) : leaders.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-60">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16 mb-4 text-white/40">
                                        <path d="M6 3h12l4 6-10 13L2 9z"></path>
                                        <path d="M11 3 8 9l4 13 4-13-3-6"></path>
                                        <path d="M2 9h20"></path>
                                    </svg>
                                    <h3 className="text-xl font-bold text-white mb-2">The throne is empty</h3>
                                    <p className="text-sm text-white/60">No records found for this period.</p>
                                </div>
                            ) : (
                                <div className="space-y-3 px-panel-gutter pb-4">
                                    <AnimatePresence mode="popLayout">
                                        {leaders.map((entry, idx) => {
                                            const tierStyles = getTierConfig(entry.tier);
                                            const isMe = entry.isCurrentUser;
                                            const rank = (currentPage - 1) * ITEMS_PER_PAGE + idx + 1;

                                            return (
                                                <motion.div
                                                    layout
                                                    initial={{ opacity: 0, scale: 0.95 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    key={entry.id}
                                                    className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${isMe
                                                        ? 'bg-indigo-500/20 border-2 border-indigo-400/50 shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                                                        : 'bg-white/5 border border-white/10 hover:bg-white/10'
                                                        }`}
                                                >
                                                    <div className="flex-shrink-0 mr-1">
                                                        {activeTab === 'tier' ? (
                                                            <div className="w-8 h-8 text-white/40 font-bold flex items-center justify-center text-sm">{rank}</div>
                                                        ) : (
                                                            getRankBadge(rank)
                                                        )}
                                                    </div>

                                                    <div className="relative">
                                                        <div className={`w-12 h-12 rounded-full overflow-hidden bg-[#2a2d3e] flex-shrink-0 border-2 ${isMe ? 'border-indigo-400' : 'border-white/10'}`}>
                                                            {entry.avatar ? (
                                                                <img
                                                                    src={entry.avatar}
                                                                    alt={entry.name}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-white/20">
                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {isMe && (
                                                            <div className="absolute -bottom-1 -right-1 bg-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md border border-indigo-300">
                                                                YOU
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex flex-col flex-1 min-w-0">
                                                        <span className={`font-bold text-[15px] truncate ${isMe ? 'text-indigo-100' : 'text-white'}`}>
                                                            {entry.name}
                                                        </span>

                                                        {activeTab === 'tier' ? (
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <div className={`w-2 h-2 rounded-full ${tierStyles?.dot} ${tierStyles?.shadow}`} />
                                                                <span className={`text-[11px] font-bold tracking-widest uppercase ${tierStyles?.color}`}>
                                                                    {entry.tier} {entry.stage}
                                                                </span>
                                                            </div>
                                                        ) : null}
                                                    </div>

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

                                    {totalPages > 1 && (
                                        <div className="flex justify-center items-center gap-2 mt-4 pt-4 border-t border-white/10 pb-6 shrink-0">
                                            <button
                                                disabled={currentPage === 1}
                                                onClick={() => setCurrentPage(prev => prev - 1)}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white transition-all"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"></polyline></svg>
                                            </button>
                                            <div className="flex items-center gap-1">
                                                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                                                    <button
                                                        key={page}
                                                        onClick={() => setCurrentPage(page)}
                                                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${currentPage === page ? 'bg-indigo-600 text-white shadow-[0_0_10px_rgba(79,70,229,0.4)]' : 'bg-transparent text-white/50 hover:bg-white/5'}`}
                                                    >
                                                        {page}
                                                    </button>
                                                ))}
                                            </div>
                                            <button
                                                disabled={currentPage === totalPages}
                                                onClick={() => setCurrentPage(prev => prev + 1)}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white transition-all"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
