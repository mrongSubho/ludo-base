"use client";

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { InvitePayload } from '@/lib/types';
import { useMultiplayerContext } from '@/hooks/MultiplayerContext';

export const InviteNotification = () => {
    const { pendingInvite, acceptInvite, rejectInvite } = useMultiplayerContext();
    const [countdown, setCountdown] = useState(15);

    // Auto-dismiss after 15 seconds
    useEffect(() => {
        if (!pendingInvite) {
            setCountdown(15);
            return;
        }

        setCountdown(15);
        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    rejectInvite();
                    return 15;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [pendingInvite, rejectInvite]);

    return (
        <AnimatePresence>
            {pendingInvite && (
                <motion.div
                    initial={{ y: -120, opacity: 0, scale: 0.95 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: -120, opacity: 0, scale: 0.95 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                    className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[420px] z-[300] pointer-events-auto"
                >
                    <div className="relative bg-purple-900/90 backdrop-blur-2xl border border-purple-500/30 rounded-3xl p-5 shadow-[0_0_40px_rgba(147,51,234,0.3)] overflow-hidden">
                        {/* Countdown Bar */}
                        <div className="absolute top-0 left-0 right-0 h-1 bg-white/10 rounded-t-3xl overflow-hidden">
                            <motion.div
                                initial={{ width: '100%' }}
                                animate={{ width: '0%' }}
                                transition={{ duration: 15, ease: 'linear' }}
                                className="h-full bg-gradient-to-r from-cyan-400 to-purple-500"
                            />
                        </div>

                        <div className="flex items-start gap-4">
                            {/* Host Avatar */}
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-cyan-500 flex items-center justify-center shrink-0 border border-white/20 shadow-lg">
                                {pendingInvite.hostAvatar ? (
                                    <img src={pendingInvite.hostAvatar} alt="host" className="w-full h-full rounded-2xl object-cover" />
                                ) : (
                                    <span className="text-2xl">🎮</span>
                                )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <h3 className="text-white font-black text-lg tracking-tight truncate">
                                    {pendingInvite.hostName} invites you!
                                </h3>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-500/30">
                                        {pendingInvite.matchType}
                                    </span>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300 bg-cyan-500/20 px-2 py-0.5 rounded-full border border-cyan-500/30">
                                        {pendingInvite.gameMode}
                                    </span>
                                    {pendingInvite.entryFee > 0 && (
                                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">
                                            {pendingInvite.entryFee >= 1000 ? `${pendingInvite.entryFee / 1000}k` : pendingInvite.entryFee} entry
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Timer Badge */}
                            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/10">
                                <span className="text-sm font-black text-white/70">{countdown}</span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={rejectInvite}
                                className="flex-1 py-3 bg-white/10 hover:bg-white/15 border border-white/10 text-white/80 font-black uppercase tracking-widest text-xs rounded-xl transition-all"
                            >
                                Decline
                            </button>
                            <button
                                onClick={acceptInvite}
                                className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-[0_0_15px_rgba(34,211,238,0.3)]"
                            >
                                Accept ✓
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
