'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { LuTrophy, LuTimer, LuUsers, LuChevronRight, LuX, LuShieldCheck } from 'react-icons/lu';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface TournamentPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function TournamentPanel({ isOpen, onClose }: TournamentPanelProps) {
    const { address } = useCurrentUser();
    const [tournaments, setTournaments] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchTournaments = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await (supabase as any)
                .from('tournaments')
                .select('*')
                .order('start_at', { ascending: true });
            
            if (error) throw error;
            if (data) setTournaments(data);
        } catch (err: any) {
            console.error('Fetch tournaments error:', err.message || err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchTournaments();
        }
    }, [isOpen]);

    const handleJoin = async (tId: string) => {
        if (!address) return;
        try {
            const { error } = await (supabase as any).rpc('join_tournament', {
                p_tournament_id: tId,
                p_player_id: address.toLowerCase()
            });
            if (error) alert(error.message);
            else fetchTournaments();
        } catch (err) {
            console.error('Join error:', err);
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
                                            <LuTrophy className="text-cyan-400 w-6 h-6" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-white uppercase tracking-wider italic">Arena</h2>
                                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-[0.2em]">Tournament Discovery</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={onClose} 
                                        className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 text-white/40 hover:text-white transition-all border border-white/5"
                                    >
                                        <LuX className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* List */}
                                <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 custom-scrollbar relative z-10">
                                    {isLoading ? (
                                        <div className="h-full flex flex-col items-center justify-center gap-4">
                                            <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
                                            <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Locating Arenas</span>
                                        </div>
                                    ) : tournaments.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-60">
                                            <LuShieldCheck className="text-5xl text-white/20 mb-4" />
                                            <h3 className="text-xl font-bold text-white mb-2">Construction Mode</h3>
                                            <p className="text-sm text-white/60">Automated brackets coming soon. Check back shortly!</p>
                                        </div>
                                    ) : tournaments.map((t, idx) => (
                                        <motion.div 
                                            key={t.id}
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ delay: idx * 0.1 }}
                                            className="group relative flex flex-col gap-4 p-5 rounded-3xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/10 transition-all overflow-hidden"
                                        >
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h4 className="text-lg font-black text-white italic truncate">{t.title}</h4>
                                                    <p className="text-[11px] text-white/40 font-bold uppercase tracking-widest mt-1">
                                                        Entry: <span className="text-yellow-400">{t.entry_fee} COINS</span>
                                                    </p>
                                                </div>
                                                <div className="p-2 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
                                                    <LuUsers className="text-cyan-400 w-5 h-5" />
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6 mt-2">
                                                <div className="flex items-center gap-2">
                                                    <LuTimer className="text-white/20 w-4 h-4" />
                                                    <span className="text-[10px] text-white/60 font-black uppercase tracking-widest">Starts in 3h 20m</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <LuUsers className="text-white/20 w-4 h-4" />
                                                    <span className="text-[10px] text-white/60 font-black uppercase tracking-widest">JOINED: {t.current_participants || 0}/{t.max_players}</span>
                                                </div>
                                            </div>

                                            <button 
                                                onClick={() => handleJoin(t.id)}
                                                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl shadow-lg border border-cyan-400/20 transition-all active:scale-95"
                                            >
                                                Register Entry
                                            </button>
                                        </motion.div>
                                    ))}
                                </div>

                                {/* Footer Info */}
                                <div className="p-5 bg-black/40 border-t border-white/5 mt-auto">
                                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/30">
                                        <span>Official Ludo Base League</span>
                                        <span className="text-cyan-400">Phase 16 Sync</span>
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
