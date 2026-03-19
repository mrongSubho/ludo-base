"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { useSoundEffects } from '../hooks/useSoundEffects';

export const InviteNotification = () => {
    const { address } = useAccount();
    const { joinGame } = useTeamUpContext();
    const { playSelect } = useSoundEffects();
    const [invite, setInvite] = useState<any>(null);
    const [hostProfile, setHostProfile] = useState<{ username: string; avatar_url: string } | null>(null);

    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        // 1. Listen for NEW inserts into game_invites where guest_address matches
        const channel = supabase
            .channel('global-invites')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'game_invites',
                    filter: `guest_address=eq.${lowerAddr}`
                },
                async (payload) => {
                    console.log('🎁 Global Invite Received:', payload);
                    const newInvite = payload.new;
                    
                    // 2. Fetch Host Profile
                    const { data: profile } = await supabase
                        .from('players')
                        .select('username, avatar_url')
                        .eq('wallet_address', newInvite.host_address.toLowerCase())
                        .single();

                    setHostProfile(profile || { username: 'Host', avatar_url: '' });
                    setInvite(newInvite);
                    playSelect();

                    // Auto-hide after 15 seconds
                    setTimeout(() => setInvite(null), 15000);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [address, playSelect]);

    const handleAccept = () => {
        if (invite) {
            joinGame(invite.room_code);
            setInvite(null);
        }
    };

    return (
        <AnimatePresence>
            {invite && (
                <motion.div
                    initial={{ opacity: 0, y: -100, x: '-50%' }}
                    animate={{ opacity: 1, y: 20, x: '-50%' }}
                    exit={{ opacity: 0, y: -100, x: '-50%' }}
                    className="fixed top-0 left-1/2 z-[200] w-[calc(100%-32px)] max-w-[400px]"
                >
                    <div className="bg-slate-900/90 backdrop-blur-2xl border border-cyan-500/30 rounded-[32px] p-6 shadow-[0_0_50px_rgba(34,211,238,0.2)] overflow-hidden relative">
                        {/* Glowing Background Pulse */}
                        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 to-transparent pointer-events-none" />
                        
                        <div className="flex items-center gap-4 relative z-10">
                            {/* Host Avatar Pod */}
                            <div className="relative w-16 h-16 shrink-0">
                                <div className="absolute inset-0 bg-cyan-500/20 rounded-full animate-pulse" />
                                <div className="w-full h-full rounded-full border-2 border-cyan-400/50 overflow-hidden bg-slate-800">
                                    {hostProfile?.avatar_url ? (
                                        <img src={hostProfile.avatar_url} alt="host" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-2xl font-black text-cyan-400">
                                            {hostProfile?.username?.[0] || 'H'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1">
                                <span className="block text-[10px] font-black text-cyan-400 tracking-[0.2em] uppercase mb-1">Incoming Signal</span>
                                <h4 className="text-white font-black italic uppercase tracking-tight text-lg leading-tight">
                                    {hostProfile?.username || 'WARRIOR'} <span className="text-white/40 not-italic font-medium">invites you</span>
                                </h4>
                                <div className="flex gap-3 mt-1">
                                    <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">{invite.match_type}</span>
                                    <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest">{invite.entry_fee?.toLocaleString()} LUDO</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6 relative z-10">
                            <button
                                onClick={handleAccept}
                                className="flex-1 py-3 bg-cyan-500 text-slate-950 font-black italic uppercase tracking-tighter rounded-2xl hover:bg-cyan-400 transition-all active:scale-95 shadow-lg shadow-cyan-500/20"
                            >
                                Accept Entry
                            </button>
                            <button
                                onClick={() => setInvite(null)}
                                className="px-6 py-3 bg-white/5 border border-white/10 text-white/60 font-black italic uppercase tracking-tighter rounded-2xl hover:bg-white/10 transition-all"
                            >
                                Ignore
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
