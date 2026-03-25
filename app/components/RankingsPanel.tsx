'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';
import { LuTrophy, LuTrendingUp, LuUsers, LuSearch, LuChevronRight, LuX } from 'react-icons/lu';

interface RankingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenProfile: (address: string) => void;
}

export default function RankingsPanel({ isOpen, onClose, onOpenProfile }: RankingsPanelProps) {
    const { address } = useAccount();
    const { leaderboard: players, isBooting } = useGameData();
    const [activeFilter, setActiveFilter] = useState<'global' | 'friends'>('global');
    const [searchQuery, setSearchQuery] = useState('');

    const filteredPlayers = players.filter(p => 
        p.username?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        p.wallet_address.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getTierColor = (tier: string) => {
        switch (tier) {
            case 'Arena Master': return 'text-orange-400';
            case 'Diamond': return 'text-cyan-300';
            case 'Platinum': return 'text-blue-400';
            case 'Gold': return 'text-yellow-400';
            case 'Silver': return 'text-slate-300';
            default: return 'text-amber-600';
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                        onClick={onClose}
                    />

                    {/* Panel Container */}
                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            className="w-full max-w-[500px] relative h-full pointer-events-auto"
                        >
                            <div
                                className="absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                                style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13, 13, 13, 0.92)', backdropFilter: 'blur(32px)' }}
                            >
                                {/* Authentic Subdued Cosmic Orbs */}
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                {/* Drag Handle */}
                                <div className="w-full flex justify-center pt-4 pb-2">
                                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                {/* Header */}
                                <div className="px-6 pb-4 border-b border-white/10 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
                                            <LuTrendingUp className="text-cyan-400 w-6 h-6" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-white uppercase tracking-wider italic">Rankings</h2>
                                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-[0.2em]">Competitive Tiers</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={onClose} 
                                        className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 text-white/40 hover:text-white transition-all border border-white/5"
                                    >
                                        <LuX className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* Filters & Search */}
                                <div className="p-4 space-y-3">
                                    <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 shadow-inner">
                                        <button 
                                            onClick={() => setActiveFilter('global')}
                                            className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 ${activeFilter === 'global' ? 'bg-cyan-700 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                                        >
                                            <LuUsers className="w-3.5 h-3.5" />
                                            Global
                                        </button>
                                        <button 
                                            onClick={() => setActiveFilter('friends')}
                                            className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 ${activeFilter === 'friends' ? 'bg-cyan-700 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                                        >
                                            <LuTrophy className="w-3.5 h-3.5" />
                                            Friends
                                        </button>
                                    </div>
                                    <div className="relative">
                                        <LuSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 w-4 h-4" />
                                        <input 
                                            type="text"
                                            placeholder="Search Players..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full bg-black/40 border border-white/10 rounded-2xl py-2.5 pl-11 pr-4 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-all placeholder:text-white/20"
                                        />
                                    </div>
                                </div>

                                {/* List */}
                                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 custom-scrollbar relative z-10">
                                    {isBooting ? (
                                        <div className="h-full flex flex-col items-center justify-center gap-4">
                                            <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
                                            <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Synching Tiers</span>
                                        </div>
                                    ) : filteredPlayers.map((p, idx) => (
                                        <motion.div 
                                            key={p.wallet_address}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: idx * 0.05 }}
                                            className={`group flex items-center gap-4 p-3 rounded-2xl border transition-all cursor-pointer ${p.wallet_address.toLowerCase() === address?.toLowerCase() ? 'bg-cyan-500/10 border-cyan-500/40 shadow-[0_0_20px_rgba(34,211,238,0.1)]' : 'bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10'}`}
                                            onClick={() => onOpenProfile(p.wallet_address)}
                                        >
                                            <div className="w-6 flex-shrink-0 text-center text-white/20 font-black italic text-lg">{idx + 1}</div>
                                            <div className="w-12 h-12 rounded-full border-2 border-white/10 overflow-hidden bg-cyan-900/50 flex-shrink-0 relative">
                                                {p.avatar_url ? (
                                                    <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-white/20">{p.username?.[0] || 'L'}</div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-white font-bold truncate text-sm">{p.username || `${p.wallet_address.slice(0, 6)}...`}</h4>
                                                    {p.wallet_address.toLowerCase() === address?.toLowerCase() && (
                                                        <span className="bg-cyan-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-sm uppercase tracking-wider">YOU</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className={`text-[10px] font-black uppercase tracking-widest ${getTierColor(p.rank_tier || 'Bronze')}`}>{p.rank_tier || 'Bronze'} {p.subRank}</span>
                                                    <span className="text-[9px] text-white/20 font-bold uppercase tracking-widest">Lv.{p.level}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end mr-1">
                                                <div className="text-lg font-black text-white tracking-tighter leading-none">{p.rating || 1200}</div>
                                                <div className="text-[8px] text-white/30 font-black uppercase tracking-widest mt-0.5">ELO</div>
                                            </div>
                                            <LuChevronRight className="w-4 h-4 text-white/10 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
                                        </motion.div>
                                    ))}
                                </div>

                                {/* Footer Info */}
                                <div className="p-5 bg-black/40 border-t border-white/5 mt-auto">
                                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/30">
                                        <span>Season 1 Ends in 24 Days</span>
                                        <span className="text-cyan-400">Prizepool: $50,000</span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}
