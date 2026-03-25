'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';

const ITEMS_PER_PAGE = 20;

// getTierFromWins moved to GameDataContext

type LeaderboardTab = 'tier' | 'daily' | 'monthly';

interface LeaderboardEntry {
    id: string;
    name: string;
    avatar: string | null;
    wins: number;
    rating: number;
    lastWin: number;
    isCurrentUser?: boolean;

    // Advanced Ranking Fields (Updated)
    tierName: string;
    subRank: string;
    level: number;
}

interface LeaderboardProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenProfile: (address: string) => void;
}

export default function Leaderboard({ isOpen, onClose, onOpenProfile }: LeaderboardProps) {
    const { address } = useAccount();
    const { leaderboard: rawLeaders, isBooting: isLoading } = useGameData();

    const [activeTab, setActiveTab] = useState<LeaderboardTab>('tier');
    const [scope, setScope] = useState<'global' | 'friends'>('global');
    const [showQuarterInfo, setShowQuarterInfo] = useState(false);
    const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;

    const [currentPage, setCurrentPage] = useState(1);
    
    // Format leaders from Context
    const leaders: LeaderboardEntry[] = rawLeaders.map(player => ({
        id: player.wallet_address,
        name: (player.username && !player.username.startsWith('0x')) ? player.username : "Guest " + player.wallet_address.slice(-6).toUpperCase(),
        avatar: player.avatar_url,
        wins: player.total_wins || 0,
        rating: player.rating || 1200,
        lastWin: new Date(player.last_played_at || Date.now()).getTime(),
        isCurrentUser: address ? player.wallet_address.toLowerCase() === address.toLowerCase() : false,
        tierName: player.rank_tier || player.tierName || 'Bronze',
        subRank: player.subRank || '',
        level: player.level || 1
    }));

    const paginatedLeaders = leaders.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
    const totalPages = Math.ceil(leaders.length / ITEMS_PER_PAGE) || 1;

    useEffect(() => {
        if (!isOpen) setCurrentPage(1);
    }, [isOpen]);

    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, scope]);

    const getRankBadge = (rank: number) => {
        if (rank === 1) return <div className="w-8 h-8 rounded-full bg-yellow-400/20 text-yellow-400 font-extrabold flex items-center justify-center border border-yellow-400/30 shadow-[0_0_10px_rgba(250,204,21,0.2)]">1</div>;
        if (rank === 2) return <div className="w-8 h-8 rounded-full bg-slate-300/20 text-slate-300 font-bold flex items-center justify-center border border-slate-300/30">2</div>;
        if (rank === 3) return <div className="w-8 h-8 rounded-full bg-orange-700/20 text-orange-400 font-bold flex items-center justify-center border border-orange-700/30">3</div>;
        return <div className="w-8 h-8 text-white/40 font-bold flex items-center justify-center">{rank}</div>;
    };

    const getTierConfig = (tierName: string) => {
        switch (tierName) {
            case 'Arena Master': return { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', shadow: 'shadow-[0_0_15px_rgba(251,146,60,0.3)]', dot: 'bg-orange-400' };
            case 'Diamond': return { color: 'text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', shadow: 'shadow-[0_0_15px_rgba(103,232,249,0.3)]', dot: 'bg-cyan-300' };
            case 'Platinum': return { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', shadow: '', dot: 'bg-blue-400' };
            case 'Gold': return { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', shadow: '', dot: 'bg-yellow-400' };
            case 'Silver': return { color: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/20', shadow: '', dot: 'bg-slate-300' };
            case 'Bronze': return { color: 'text-amber-600', bg: 'bg-amber-900/20', border: 'border-amber-900/30', shadow: '', dot: 'bg-amber-600' };
            default: return { color: 'text-white/40', bg: 'bg-white/5', border: 'border-white/10', shadow: '', dot: 'bg-white/20' };
        }
    }

    return (
        <>
            {isOpen && (
                <>
                    <div
                        className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                    />

                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <div className="w-full max-w-[500px] relative h-full">
                            <div
                                /* Unified global panel layout: top-64, bottom-80 sandwich */
                                className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-y-auto pb-[40px]"
                                style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                            >
                        {/* Authentic Subdued Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        <div className="w-full flex justify-center pt-4 pb-2">
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
                                        className={`flex-1 py-2 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all ${activeTab === tab ? 'bg-cyan-700 text-white shadow-[0_0_15px_rgba(34,211,238,0.4)] scale-[1.02]' : 'text-white/30 hover:text-white/60'}`}
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
                                    <div className="w-10 h-10 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
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
                                        {paginatedLeaders.map((entry, idx) => {
                                            const tierStyles = getTierConfig(entry.tierName);
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
                                                        ? 'bg-white/5 border-2 border-cyan-400/50 shadow-[0_0_20px_rgba(34,211,238,0.2)]'
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

                                                    <button
                                                        onClick={() => onOpenProfile(entry.id)}
                                                        className="relative hover:scale-105 transition-transform active:scale-95 text-left focus:outline-none focus:ring-2 focus:ring-cyan-500/50 rounded-full"
                                                    >
                                                        <div className={`w-12 h-12 rounded-full overflow-hidden bg-cyan-900 flex-shrink-0 border-2 ${isMe ? 'border-cyan-400' : 'border-white/10'}`}>
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
                                                            <div className="absolute -bottom-1 -right-1 bg-cyan-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md border border-cyan-300">
                                                                YOU
                                                            </div>
                                                        )}
                                                    </button>

                                                    <button
                                                        onClick={() => onOpenProfile(entry.id)}
                                                        className="flex flex-col flex-1 min-w-0 text-left hover:opacity-80 transition-opacity focus:outline-none rounded-lg"
                                                    >
                                                        <span className={`font-bold text-[15px] truncate w-full ${isMe ? 'text-cyan-100' : 'text-white'}`}>
                                                            {entry.name}
                                                        </span>

                                                        {activeTab === 'tier' ? (
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <div className={`w-2 h-2 rounded-full ${tierStyles?.dot} ${tierStyles?.shadow}`} />
                                                                <span className={`text-[11px] font-bold tracking-widest uppercase ${tierStyles?.color}`}>
                                                                    {entry.tierName} {entry.subRank}
                                                                </span>
                                                                <span className="text-[9px] text-white/30 font-bold ml-1">Lv.{entry.level}</span>
                                                            </div>
                                                        ) : null}
                                                    </button>

                                                    <div className={`flex flex-col items-end justify-center rounded-xl px-4 py-2 border ${isMe ? 'bg-cyan-600/50 border-cyan-600/30' : 'bg-black/40 border-white/5'}`}>
                                                        <span className={`text-lg font-black leading-none ${isMe ? 'text-cyan-300' : 'text-cyan-400'}`}>
                                                            {activeTab === 'tier' ? entry.rating : entry.wins}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest mt-1">
                                                            {activeTab === 'tier' ? 'Rating' : 'Wins'}
                                                        </span>
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
                                                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${currentPage === page ? 'bg-cyan-700 text-white shadow-[0_0_10px_rgba(34,211,238,0.4)]' : 'bg-transparent text-white/50 hover:bg-white/5'}`}
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
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
