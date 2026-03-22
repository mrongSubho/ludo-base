"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiSearch, FiUsers, FiCheck, FiX } from 'react-icons/fi';
import { supabase } from '@/lib/supabase';
import { useGameData } from '@/hooks/GameDataContext';

interface PooledSearch {
    player_id: string;
    game_mode: string;
    wager: number;
    status: string;
    created_at: string;
}

export const LiveMatchmakingFeed = () => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [pooledSearches, setPooledSearches] = useState<PooledSearch[]>([]);
    const { user } = useGameData();

    // Fetch initial state
    useEffect(() => {
        const fetchRecentSearches = async () => {
            const { data, error } = await supabase
                .from('matchmaking_pool')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);
            
            if (data) setPooledSearches(data);
        };

        fetchRecentSearches();

        // Real-time subscription to the pool
        const channel = supabase
            .channel('public:matchmaking_pool')
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'matchmaking_pool' 
            }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    setPooledSearches(prev => [payload.new as PooledSearch, ...prev].slice(0, 10));
                } else if (payload.eventType === 'UPDATE') {
                    setPooledSearches(prev => prev.map(s => 
                        s.player_id === (payload.new as PooledSearch).player_id ? (payload.new as PooledSearch) : s
                    ));
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const handleJoinMatch = useCallback((search: PooledSearch) => {
        // Logic to initiate join via GameLobby
        console.log("Initiating join for:", search);
        setIsExpanded(false);
        // This would typically trigger a callback passed from GameLobby
    }, []);

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
        
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    };

    return (
        <>
            <div className="fixed bottom-[110px] left-0 right-0 flex justify-center pointer-events-none z-50 px-4">
                <div 
                    className="pointer-events-auto h-[72px] w-full max-w-[480px] rounded-full flex items-center justify-between px-6 relative overflow-hidden transition-all group glass-panel cursor-pointer hover:border-white/20 hover:scale-[1.02] active:scale-[0.98]"
                    onClick={() => setIsExpanded(true)}
                >
                    <div className="flex items-center gap-6 relative z-10">
                        <div className="w-11 h-11 rounded-full border border-white/20 bg-slate-900/80 flex items-center justify-center overflow-hidden shadow-lg">
                            <FiSearch className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] italic">Network Grid</span>
                            <div className="flex items-center gap-3">
                                <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse" />
                                <span className="text-xs font-black text-cyan-400 italic uppercase tracking-wider">Establishing Active Links...</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 max-w-[280px] overflow-hidden ml-8 relative">
                        <div className="animate-marquee whitespace-nowrap flex gap-12">
                            {pooledSearches.length > 0 ? (
                                pooledSearches.map((s, i) => (
                                    <span key={i} className="text-[11px] font-black text-white uppercase tracking-tighter italic flex items-center gap-2">
                                        <span className="text-cyan-400 opacity-50">LINK:</span> 
                                        {s.game_mode.toUpperCase()} x {s.wager.toLocaleString()} 
                                        <span className="text-white/20 font-medium ml-2">{formatTime(s.created_at)}</span>
                                    </span>
                                ))
                            ) : (
                                <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.4em] italic">Scanning Grid Signals...</span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-4 relative z-10">
                        <div className="h-8 w-px bg-white/5" />
                        <div className="flex flex-col items-end">
                            <span className="text-[9px] font-black text-white/30 uppercase">Node</span>
                            <span className="text-[10px] font-black text-cyan-400 italic uppercase">Broadcast</span>
                        </div>
                    </div>
                </div>
            </div>

            {isExpanded && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent lg:hidden"
                        onClick={() => setIsExpanded(false)}
                    />

                    {/* Panel Container */}
                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <div className="w-full max-w-[500px] relative h-full">
                            <div 
                                className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden animate-in fade-in duration-300"
                                style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                            >
                                {/* Authentic Subdued Cosmic Orbs */}
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                <div className="w-full flex justify-between items-center p-8 relative z-10">
                                    <div>
                                        <h3 className="text-white font-black italic text-3xl tracking-tighter uppercase">Match Browser</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            <span className="text-[9px] font-black text-emerald-500 tracking-[0.2em] uppercase">Live_Node: Active</span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => setIsExpanded(false)}
                                        className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                                    >
                                        <FiX className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto px-8 custom-scrollbar relative z-10">
                                    {pooledSearches.length > 0 ? pooledSearches.map((s, i) => (
                                        <div key={i} className="group relative mb-3 hover:scale-[1.02] transition-all duration-300">
                                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
                                            <div className="relative p-4 rounded-2xl border border-white/5 bg-white/[0.02] flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 rounded-xl border border-white/10 bg-slate-900 flex items-center justify-center text-cyan-400">
                                                        {s.status === 'matched' ? <FiCheck className="w-6 h-6" /> : <FiSearch className="w-6 h-6" />}
                                                    </div>
                                                    <div>
                                                        <span className="block text-sm font-black italic text-white uppercase tracking-tight">
                                                            {s.game_mode} {s.game_mode.includes('v') ? '' : 'Power'}
                                                        </span>
                                                        <div className="flex items-center gap-3 mt-0.5">
                                                            <span className="text-[10px] font-black text-cyan-400 uppercase">Wager: <span className="text-white">{s.wager.toLocaleString()}</span></span>
                                                            <span className="text-[9px] font-medium text-white/20 uppercase">{formatTime(s.created_at)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {s.status !== 'matched' && (
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleJoinMatch(s); }}
                                                        className="px-4 py-2 rounded-full bg-white text-slate-900 text-[10px] font-black italic uppercase tracking-tighter hover:scale-105 active:scale-95 transition-all shadow-lg"
                                                    >
                                                        Join Match
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="h-full flex flex-col items-center justify-center text-white/10 py-20">
                                            <p className="text-[10px] font-black uppercase tracking-[0.4em]">Establishing Link...</p>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-6 w-full p-8 border-t border-white/5 text-center relative z-10">
                                    <span className="text-[9px] font-medium text-white/20 uppercase tracking-[0.3em]">Encrypted Real-time Feed | v1.0.4</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};
