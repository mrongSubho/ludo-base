'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getProgression } from '@/lib/progression';

interface PublicProfileModalProps {
    isOpen: boolean;
    userAddress: string | null;
    onClose: () => void;
    onDM: (address: string) => void;
}

export default function PublicProfileModal({ isOpen, userAddress, onClose, onDM }: PublicProfileModalProps) {
    const { address: currentUserAddress } = useCurrentUser();
    const [isProfileLoading, setProfileLoading] = useState(false);
    const [isFriendValidationLoading, setFriendValidationLoading] = useState(false);

    // Target User Data
    const [profile, setProfile] = useState<any>(null);
    const [isFriend, setIsFriend] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const [isBlocked, setIsBlocked] = useState(false);

    // Action States
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);
    const [reportStep, setReportStep] = useState<'none' | 'select' | 'submitting' | 'done'>('none');
    const [selectedReportReason, setSelectedReportReason] = useState<string>('');

    // Reset when modal opens with new user
    useEffect(() => {
        if (!isOpen || !userAddress || !currentUserAddress) {
            setProfile(null);
            setIsFriend(false);
            setIsPending(false);
            setIsBlocked(false);
            setActionSuccess(null);
            setReportStep('none');
            setSelectedReportReason('');
            setProfileLoading(false);
            setFriendValidationLoading(false);
            return;
        }

        const fetchProfileData = async () => {
            setProfileLoading(true);
            setFriendValidationLoading(true);

            try {
                // 1. Fetch user stats from Supabase (FAST)
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
            } catch (err) {
                console.error("Error fetching profile from Supabase:", err);
            } finally {
                setProfileLoading(false); // Render top half immediately
            }

            // 1.5 Fetch block status
            try {
                const { data: blockData } = await supabase
                    .from('user_blocks')
                    .select('id')
                    .eq('blocker_address', currentUserAddress)
                    .ilike('blocked_address', userAddress)
                    .single();

                setIsBlocked(!!blockData);
            } catch (err) {
                console.error("Error checking block status:", err);
            }

            // 2. Fetch current user's friends list to validate DM capability (SLOWER)
            try {
                const response = await fetch(`/api/friends?wallet=${currentUserAddress}`);
                if (response.ok) {
                    const data = await response.json();

                    // Check if targeted user exists in Onchain or Game Friends
                    const isFollowing = data.onchainFriends?.some((f: any) => (f.address?.toLowerCase() === userAddress.toLowerCase() || f.wallet_address?.toLowerCase() === userAddress.toLowerCase())) || false;
                    const isGameFriend = data.gameFriends?.some((f: any) => (f.address?.toLowerCase() === userAddress.toLowerCase() || f.wallet_address?.toLowerCase() === userAddress.toLowerCase())) || false;

                    setIsFriend(isFollowing || isGameFriend);
                }

                // 3. Fetch pending friend request state
                const { data: pendingData } = await supabase
                    .from('friendships')
                    .select('id')
                    .eq('status', 'pending')
                    .or(`and(user_address.ilike.${currentUserAddress},friend_address.ilike.${userAddress}),and(user_address.ilike.${userAddress},friend_address.ilike.${currentUserAddress})`)
                    .single();

                setIsPending(!!pendingData);

            } catch (err) {
                console.error("Error during profile validation:", err);
            } finally {
                setFriendValidationLoading(false); // Render bottom half actions
            }
        };

        fetchProfileData();

    }, [isOpen, userAddress, currentUserAddress]);

    // Derived Display Values
    const progression = getProgression(profile?.xp || 0, profile?.rating || 0);

    const displayName = profile?.username && !profile.username.startsWith('0x')
        ? profile.username
        : `User ${userAddress?.substring(0, 6).toUpperCase()}`;

    const displayAvatar = profile?.avatar_url || '1';
    const displayWins = profile?.total_wins || 0;
    const classicPlayed = profile?.classic_played || 0;
    const powerPlayed = profile?.power_played || 0;
    const aiPlayed = profile?.ai_played || 0;

    // Online Status from DB heuristics (Self-Healing)
    const lastPlayedAt = profile?.last_played_at ? new Date(profile.last_played_at) : null;
    let isOnline = profile?.status === 'Online' || profile?.status === 'In Match';

    // Force Offline if 'Online' but last seen > 5 minutes ago
    if (profile?.status === 'Online' && lastPlayedAt) {
        const now = new Date().getTime();
        const driftLimit = 5 * 60 * 1000;
        if (now - lastPlayedAt.getTime() > driftLimit) {
            isOnline = false;
        }
    }

    const localTimeString = lastPlayedAt ? new Intl.DateTimeFormat('default', {
        hour: 'numeric', minute: 'numeric', day: 'numeric', month: 'short'
    }).format(lastPlayedAt) : 'Never';

    // Graph Data Mocking (Assuming we implement a history tracking table later, mocking for now as requested by user)
    const [monthlyGraphHeights] = useState([30, 50, 20, 80, 40, 90, 60, 100, 40, 70]);

    const handleAction = async (action: 'Add Friend' | 'Unfriend' | 'Block' | 'Unblock' | 'Report' | 'Poke') => {
        if (!currentUserAddress || !userAddress || isActionLoading) return;

        if (action === 'Report') {
            setReportStep('select');
            return;
        }

        setIsActionLoading(true);
        try {
            if (action === 'Poke') {
                const response = await fetch('/api/social/poke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sender: currentUserAddress, receiver: userAddress })
                });
                const data = await response.json();
                if (response.ok) {
                    setActionSuccess(data.type === 'poke_back' ? `Poked Back! +${data.reward} Coins` : "Poke Sent!");
                    setTimeout(() => setActionSuccess(null), 2500);
                } else {
                    setActionSuccess(data.error || "Failed to Poke");
                    setTimeout(() => setActionSuccess(null), 2500);
                }
            } else if (action === 'Add Friend') {
                // Pre-emptively ensure both users exist in players table to avoid FK crashes
                await supabase.from('players').upsert([
                    { wallet_address: currentUserAddress.toLowerCase() },
                    { wallet_address: userAddress.toLowerCase() }
                ], { onConflict: 'wallet_address', ignoreDuplicates: true });

                const { data, error } = await supabase.from('friendships').upsert({
                    user_address: currentUserAddress.toLowerCase(),
                    friend_address: userAddress.toLowerCase(),
                    status: 'pending'
                }, { onConflict: 'user_address,friend_address' }).select();

                console.log("Add Friend Payload:", { user_address: currentUserAddress, friend_address: userAddress });

                if (!error) {
                    setActionSuccess("Friend Request Sent!");
                    setIsPending(true);
                    setTimeout(() => setActionSuccess(null), 2500);
                } else {
                    console.error("Supabase Add Friend Error:", error);
                    setActionSuccess("Failed to send request");
                    setTimeout(() => setActionSuccess(null), 2500);
                }
            } else if (action === 'Unfriend') {
                const { error } = await supabase.from('friendships')
                    .delete()
                    .or(`and(user_address.ilike.${currentUserAddress},friend_address.ilike.${userAddress}),and(user_address.ilike.${userAddress},friend_address.ilike.${currentUserAddress})`);
                if (!error) {
                    setIsFriend(false);
                    setActionSuccess("Friend Removed");
                    setTimeout(() => setActionSuccess(null), 2500);
                }
            } else if (action === 'Block') {
                const { error } = await supabase.from('user_blocks').insert({
                    blocker_address: currentUserAddress.toLowerCase(),
                    blocked_address: userAddress.toLowerCase()
                });
                if (!error) {
                    setIsBlocked(true);
                    setIsFriend(false); // Blocking someone immediately severs frontend friendship
                }
            } else if (action === 'Unblock') {
                const { error } = await supabase.from('user_blocks')
                    .delete()
                    .eq('blocker_address', currentUserAddress)
                    .ilike('blocked_address', userAddress);
                if (!error) setIsBlocked(false);
            }
        } catch (err) {
            console.error(`Failed to handle action ${action}:`, err);
        } finally {
            setIsActionLoading(false);
        }
    };

    const submitReport = async () => {
        if (!currentUserAddress || !userAddress || !selectedReportReason) return;
        setReportStep('submitting');

        try {
            const { error } = await supabase.from('user_reports').insert({
                reporter_address: currentUserAddress.toLowerCase(),
                reported_address: userAddress.toLowerCase(),
                reason: selectedReportReason
            });

            if (!error) {
                setReportStep('done');
                setTimeout(() => setReportStep('none'), 2000); // Reset UI after 2s
            } else {
                setReportStep('select'); // drop back on error
            }
        } catch (err) {
            console.error(err);
            setReportStep('select');
        }
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
                        <div className="flex justify-end p-4 relative z-10 w-full pl-6 pr-4">
                            {/* Only show online status if verified friend */}
                            {!isFriendValidationLoading && isFriend && (
                                <div className="absolute left-6 top-6 flex items-center gap-2">
                                    <div className={`w-2.5 h-2.5 rounded-full 
                                        ${(profile?.status === 'Online' && isOnline) ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)] animate-pulse' :
                                            profile?.status === 'In Match' ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)] animate-pulse' :
                                                'bg-white/20'}`}
                                    />
                                    <span className={`text-[10px] uppercase tracking-widest font-bold 
                                        ${(profile?.status === 'Online' && isOnline) ? 'text-green-400' :
                                            profile?.status === 'In Match' ? 'text-orange-400' :
                                                'text-white/50'}`}>
                                        {(profile?.status === 'Online' && !isOnline) ? 'Offline' : (profile?.status || 'Offline')}
                                    </span>
                                </div>
                            )}

                            <button
                                onClick={onClose}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>

                        {/* Profile Content */}
                        <div className="px-6 pb-6 pt-0 flex flex-col items-center relative z-10">
                            {isProfileLoading ? (
                                <div className="py-12 flex flex-col items-center justify-center space-y-4">
                                    <div className="w-8 h-8 border-3 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                                    <span className="text-white/40 text-xs font-bold uppercase tracking-widest animate-pulse">Decrypting Hex...</span>
                                </div>
                            ) : (
                                <>
                                    {/* Avatar */}
                                    <div className="relative mb-4 mt-2">
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

                                    <div className="h-8 mb-5 flex flex-col items-center justify-center">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest px-2 py-0.5 bg-purple-400/10 rounded-full border border-purple-400/20">
                                                {progression.tier} {progression.subRank}
                                            </span>
                                            <span className="text-[10px] font-black text-white/50 uppercase tracking-widest px-2 py-0.5 bg-white/5 rounded-full border border-white/10">
                                                Lv. {progression.level}
                                            </span>
                                        </div>
                                        {!isFriendValidationLoading && isFriend && (
                                            <div className="bg-black/40 px-3 py-0.5 rounded-full border border-white/5 flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-purple-400/50" />
                                                <span className="text-[9px] text-white/40 font-mono">
                                                    {userAddress.substring(0, 6)}...{userAddress.substring(userAddress.length - 4)}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 gap-3 w-full mb-3">
                                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center">
                                            <span className="text-2xl font-black text-purple-400">{displayWins}</span>
                                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">Total Wins</span>
                                        </div>
                                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center">
                                            <span className="text-2xl font-black text-white/80">-</span>
                                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">Win Rate</span>
                                        </div>
                                    </div>

                                    {/* Protected Friend Data Area */}
                                    <div className="w-full relative min-h-[140px] flex flex-col justify-end">
                                        {isFriendValidationLoading ? (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center animate-pulse gap-3">
                                                <div className="w-full h-12 bg-white/5 rounded-xl" />
                                                <div className="w-full h-12 bg-white/5 rounded-xl" />
                                            </div>
                                        ) : (
                                            <>
                                                {isFriend ? (
                                                    <motion.div
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        className="w-full flex flex-col gap-3 mb-4"
                                                    >
                                                        {/* Advanced Stats */}
                                                        <div className="w-full bg-black/30 border border-white/5 rounded-2xl p-3 flex justify-between items-center">
                                                            <div className="flex flex-col items-center flex-1">
                                                                <span className="text-sm font-bold text-white">{classicPlayed}</span>
                                                                <span className="text-[8px] uppercase tracking-widest text-white/30 font-bold">Classic</span>
                                                            </div>
                                                            <div className="w-px h-6 bg-white/10" />
                                                            <div className="flex flex-col items-center flex-1">
                                                                <span className="text-sm font-bold text-white">{powerPlayed}</span>
                                                                <span className="text-[8px] uppercase tracking-widest text-white/30 font-bold">Power</span>
                                                            </div>
                                                            <div className="w-px h-6 bg-white/10" />
                                                            <div className="flex flex-col items-center flex-1">
                                                                <span className="text-sm font-bold text-white">{aiPlayed}</span>
                                                                <span className="text-[8px] uppercase tracking-widest text-white/30 font-bold">vs AI</span>
                                                            </div>
                                                        </div>

                                                        {/* Monthly Activity Graph & Last Seen */}
                                                        <div className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 flex flex-col">
                                                            <div className="flex justify-between items-center mb-3">
                                                                <span className="text-[10px] uppercase font-bold text-white/50 tracking-widest">30-Day Activity</span>
                                                                <span className="text-[10px] text-white/30">Last seen: {localTimeString}</span>
                                                            </div>
                                                            <div className="flex items-end justify-between h-8 gap-1">
                                                                {monthlyGraphHeights.map((h, i) => (
                                                                    <div key={i} className="flex-1 bg-white/10 rounded-t-sm hover:bg-purple-500/50 transition-colors" style={{ height: `${h}%` }} />
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* Direct Message (Only visible to friends) */}
                                                        <button
                                                            onClick={() => onDM(userAddress)}
                                                            className="w-full mt-1 bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3.5 rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all flex items-center justify-center gap-2"
                                                        >
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                                            DIRECT MESSAGE
                                                        </button>

                                                    </motion.div>
                                                ) : (
                                                    <motion.div
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                        className="w-full flex pb-3"
                                                    >
                                                        <div className="flex flex-col gap-2 w-full mt-4">

                                                            {/* Report Flow Inline UI */}
                                                            <AnimatePresence mode="wait">
                                                                {actionSuccess ? (
                                                                    <motion.div
                                                                        key="success-toast"
                                                                        initial={{ opacity: 0, scale: 0.95 }}
                                                                        animate={{ opacity: 1, scale: 1 }}
                                                                        exit={{ opacity: 0, scale: 0.95 }}
                                                                        className="w-full bg-green-500/10 border border-green-500/20 rounded-xl p-3 flex flex-col items-center justify-center gap-1 my-2"
                                                                    >
                                                                        <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center mb-1">
                                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-green-400"><path d="M20 6L9 17l-5-5"></path></svg>
                                                                        </div>
                                                                        <span className="text-sm font-bold text-green-400">{actionSuccess}</span>
                                                                    </motion.div>
                                                                ) : reportStep !== 'none' ? (
                                                                    <motion.div
                                                                        key="report-ui"
                                                                        initial={{ opacity: 0, height: 0 }}
                                                                        animate={{ opacity: 1, height: 'auto' }}
                                                                        exit={{ opacity: 0, height: 0 }}
                                                                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-2 overflow-hidden"
                                                                    >
                                                                        {reportStep === 'done' ? (
                                                                            <div className="flex items-center justify-center p-2 text-green-400 font-bold text-sm gap-2">
                                                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                                                                Report Submitted
                                                                            </div>
                                                                        ) : (
                                                                            <>
                                                                                <span className="text-xs uppercase tracking-widest text-white/50 font-bold mb-1">Select Reason</span>
                                                                                <div className="flex gap-2">
                                                                                    {['Cheating', 'Abuse', 'Spam'].map((reason) => (
                                                                                        <button
                                                                                            key={reason}
                                                                                            onClick={() => setSelectedReportReason(reason)}
                                                                                            className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${selectedReportReason === reason ? 'bg-red-500/20 text-red-400 border-red-500/50' : 'bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white/70'}`}
                                                                                        >
                                                                                            {reason}
                                                                                        </button>
                                                                                    ))}
                                                                                </div>
                                                                                <div className="flex gap-2 mt-1">
                                                                                    <button
                                                                                        onClick={() => setReportStep('none')}
                                                                                        className="flex-1 py-2 text-xs font-bold text-white/50 hover:text-white/80 transition-colors"
                                                                                    >
                                                                                        Cancel
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={submitReport}
                                                                                        disabled={!selectedReportReason || reportStep === 'submitting'}
                                                                                        className="flex-1 py-2 bg-red-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-all flex justify-center items-center"
                                                                                    >
                                                                                        {reportStep === 'submitting' ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Submit'}
                                                                                    </button>
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </motion.div>
                                                                ) : (
                                                                    <motion.div key="action-buttons" className="flex flex-col gap-2 w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                                                        {!isBlocked && (
                                                                            <button
                                                                                onClick={() => handleAction('Poke')}
                                                                                disabled={isActionLoading}
                                                                                className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 rounded-xl shadow-[0_0_15px_rgba(234,179,8,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                                                            >
                                                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"></path><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path></svg>
                                                                                POKE
                                                                            </button>
                                                                        )}
                                                                        <div className="flex gap-2 w-full">
                                                                        {isBlocked ? (
                                                                            <button
                                                                                onClick={() => handleAction('Unblock')}
                                                                                disabled={isActionLoading}
                                                                                className="flex-1 bg-white/10 hover:bg-white/15 text-white/90 text-sm font-bold py-2.5 rounded-xl transition-all border border-white/5 flex items-center justify-center gap-1.5 disabled:opacity-50"
                                                                            >
                                                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 2v20"></path><path d="M2.5 10.5 12 2l9.5 8.5"></path><path d="M2.5 22.5 12 14l9.5 8.5"></path></svg>
                                                                                Unblock
                                                                            </button>
                                                                        ) : (
                                                                            <>
                                                                                <button
                                                                                    onClick={() => handleAction(isFriend ? 'Unfriend' : 'Add Friend')}
                                                                                    disabled={isActionLoading || isPending}
                                                                                    className="flex-1 bg-white/10 hover:bg-white/15 text-white/90 text-sm font-bold py-2.5 rounded-xl transition-all border border-white/5 flex items-center justify-center gap-1.5 disabled:opacity-50"
                                                                                >
                                                                                    {isFriend ? (
                                                                                        <>
                                                                                            <span className="text-white/50 hover:text-red-400 transition-colors">Unfriend</span>
                                                                                        </>
                                                                                    ) : isPending ? (
                                                                                        <>
                                                                                            <span className="text-white/60">Pending</span>
                                                                                        </>
                                                                                    ) : (
                                                                                        <>
                                                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                                                                                            Add Friend
                                                                                        </>
                                                                                    )}
                                                                                </button>

                                                                                <button
                                                                                    onClick={() => handleAction('Block')}
                                                                                    disabled={isActionLoading}
                                                                                    className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-bold py-2.5 rounded-xl transition-all border border-red-500/10 flex items-center justify-center gap-1.5 disabled:opacity-50"
                                                                                >
                                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                                                                                    Block
                                                                                </button>

                                                                                <button
                                                                                    onClick={() => handleAction('Report')}
                                                                                    disabled={isActionLoading}
                                                                                    className="w-10 flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-xl transition-all border border-white/5 shrink-0 disabled:opacity-50"
                                                                                    title="Report User"
                                                                                >
                                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                                                                                </button>
                                                                            </>
                                                                        )}
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </>
                                        )}
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
