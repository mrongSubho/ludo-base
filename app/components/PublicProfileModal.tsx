'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface PublicProfileModalProps {
    isOpen: boolean;
    userAddress: string | null;
    onClose: () => void;
    onDM: (address: string) => void;
}

export default function PublicProfileModal({ isOpen, userAddress, onClose, onDM }: PublicProfileModalProps) {
    const { address: currentUserAddress } = useCurrentUser();
    const [isLoading, setIsLoading] = useState(false);

    // Target User Data
    const [profile, setProfile] = useState<any>(null);
    const [isFriend, setIsFriend] = useState(false);

    // Reset when modal opens with new user
    useEffect(() => {
        if (!isOpen || !userAddress || !currentUserAddress) {
            setProfile(null);
            setIsFriend(false);
            return;
        }

        const fetchProfileData = async () => {
            setIsLoading(true);
            try {
                // 1. Fetch user stats from Supabase
                const { data: userData, error: userError } = await supabase
                    .from('players')
                    .select('*')
                    .ilike('wallet_address', userAddress)
                    .single();

                if (userError) {
                    console.error("Error fetching player profile:", userError);
                } else {
                    setProfile(userData);
                }

                // 2. Fetch current user's friends list to validate DM capability
                const response = await fetch(`/api/friends?wallet=${currentUserAddress}`);
                if (response.ok) {
                    const data = await response.json();

                    // Check if targeted user exists in Onchain or Game Friends
                    const isFollowing = data.onchainFriends?.some((f: any) => f.address.toLowerCase() === userAddress.toLowerCase()) || false;
                    const isGameFriend = data.gameFriends?.some((f: any) => f.address.toLowerCase() === userAddress.toLowerCase()) || false;

                    setIsFriend(isFollowing || isGameFriend);
                }

            } catch (err) {
                console.error("Error during profile validation:", err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchProfileData();

    }, [isOpen, userAddress, currentUserAddress]);

    // Derived Display Values
    const displayName = profile?.username && !profile.username.startsWith('0x')
        ? profile.username
        : `User ${userAddress?.substring(0, 6).toUpperCase()}`;

    const displayAvatar = profile?.avatar_url || '1';
    const displayWins = profile?.total_wins || 0;

    const handleAction = (action: string) => {
        // Visual hooks for requested features
        console.log(`[Public Profile] Triggered Action: ${action} on ${userAddress}`);
        // To be connected to backend tables if requested
    };

    return (
        <AnimatePresence>
            {isOpen && userAddress && (
                <>
                    {/* Dark Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    {/* Pop-up Modal Container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-48px)] max-w-sm bg-purple-900/40 backdrop-blur-xl border border-white/10 rounded-3xl z-[210] overflow-hidden shadow-2xl flex flex-col"
                    >
                        {/* Header Gradient */}
                        <div className="h-16 bg-gradient-to-b from-purple-500/20 to-transparent w-full absolute top-0 left-0 pointer-events-none" />

                        {/* Top Controls */}
                        <div className="flex justify-end p-4 relative z-10">
                            <button
                                onClick={onClose}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>

                        {/* Profile Content */}
                        <div className="px-6 pb-6 pt-2 flex flex-col items-center relative z-10">
                            {isLoading ? (
                                <div className="py-12 flex flex-col items-center justify-center space-y-4">
                                    <div className="w-8 h-8 border-3 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                                    <span className="text-white/40 text-xs font-bold uppercase tracking-widest animate-pulse">Decrypting Profile...</span>
                                </div>
                            ) : (
                                <>
                                    {/* Avatar */}
                                    <div className="relative mb-4">
                                        <div className="w-24 h-24 rounded-full overflow-hidden bg-[#1a1c29] border-4 border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
                                            <img
                                                src={displayAvatar.startsWith('http') ? displayAvatar : `/avatars/${displayAvatar}.png`}
                                                alt={displayName}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    </div>

                                    {/* Name & Wallet */}
                                    <h3 className="text-2xl font-bold text-white mb-1 text-center truncate w-full px-4">
                                        {displayName}
                                    </h3>
                                    <div className="bg-black/40 px-3 py-1 rounded-full border border-white/5 mb-6 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
                                        <span className="text-xs text-white/50 font-mono">
                                            {userAddress.substring(0, 6)}...{userAddress.substring(userAddress.length - 4)}
                                        </span>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 gap-3 w-full mb-6">
                                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center">
                                            <span className="text-2xl font-black text-purple-400">{displayWins}</span>
                                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">Total Wins</span>
                                        </div>
                                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center">
                                            <span className="text-2xl font-black text-white/80">-</span>
                                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">Win Rate</span>
                                        </div>
                                    </div>

                                    {/* Primary Actions (Only for friends) */}
                                    {isFriend ? (
                                        <button
                                            onClick={() => onDM(userAddress)}
                                            className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3.5 rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all flex items-center justify-center gap-2 mb-3"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                            DIRECT MESSAGE
                                        </button>
                                    ) : (
                                        <div className="w-full text-center text-xs text-white/30 border border-white/5 bg-black/20 rounded-xl py-3 mb-3">
                                            Must be friends to send DMs
                                        </div>
                                    )}

                                    {/* Secondary Actions Row */}
                                    <div className="flex gap-2 w-full">
                                        {!isFriend && (
                                            <button
                                                onClick={() => handleAction('Add Friend')}
                                                className="flex-1 bg-white/10 hover:bg-white/15 text-white/90 text-sm font-bold py-2.5 rounded-xl transition-all border border-white/5 flex items-center justify-center gap-1.5"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                                                Add
                                            </button>
                                        )}

                                        <button
                                            onClick={() => handleAction('Block')}
                                            className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-bold py-2.5 rounded-xl transition-all border border-red-500/10 flex items-center justify-center gap-1.5"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                                            Block
                                        </button>

                                        <button
                                            onClick={() => handleAction('Report')}
                                            className="w-10 flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-xl transition-all border border-white/5 shrink-0"
                                            title="Report User"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
