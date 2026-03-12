"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMatchmaking } from '@/hooks/useMatchmaking';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMultiplayerContext } from '@/hooks/MultiplayerContext';

const PRO_TIPS = [
    "Safe zones protect you from capture!",
    "Capture opponents to get a bonus roll!",
    "Win to climb the global leaderboard!",
    "Use power-ups strategically to gain an edge.",
    "Rolling a 6 gives you an extra turn!",
    "Block your opponents to slow them down."
];

interface QuickMatchPanelProps {
    gameMode: 'classic' | 'power';
    matchType: '1v1' | '2v2' | '4P';
    wager: number;
    onStartGame: (isBotMatch?: boolean) => void;
    onCancel: () => void;
    isHybrid?: boolean;
    roomCode?: string;
    slotsNeeded?: number;
}

export const QuickMatchPanel = ({
    gameMode,
    matchType,
    wager,
    onStartGame,
    onCancel,
    isHybrid = false,
    roomCode,
    slotsNeeded = 1
}: QuickMatchPanelProps) => {
    const { address, profile, displayName: finalName } = useCurrentUser();
    const { joinGame } = useMultiplayerContext();

    const [countdown, setCountdown] = useState<number | null>(null);
    const [currentTipIndex, setCurrentTipIndex] = useState(0);

    const onMatchFound = useCallback((id: string) => {
        console.log('🎉 Match found! Starting countdown...');
        if (isHybrid) {
            // In hybrid mode, we don't need a countdown, the players will join the PeerJS lobby
            // The Lobby UI will update automatically
            onCancel(); 
            return;
        }
        setCountdown(3);
        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev === 1) {
                    clearInterval(timer);
                    joinGame(id);
                    onStartGame();
                    return null;
                }
                return prev ? prev - 1 : null;
            });
        }, 1000);
    }, [joinGame, onStartGame, isHybrid, onCancel]);

    const { status, searchTime, startSearch, startHybridSearch, cancelSearch } = useMatchmaking({
        playerId: address || 'guest',
        gameMode,
        matchType,
        wager,
        onMatchFound
    });

    // Auto-start search when this panel mounts
    useEffect(() => {
        let mounted = true;

        if (mounted) {
            if (isHybrid && roomCode) {
                startHybridSearch(roomCode, slotsNeeded, matchType);
            } else {
                startSearch();
            }
        }

        return () => {
            mounted = false;
            cancelSearch(); // ALWAYS cancel if the panel unmounts mid-search
        };
    }, [startSearch, startHybridSearch, cancelSearch, isHybrid, roomCode, slotsNeeded, matchType]);

    // Tip rotation logic
    useEffect(() => {
        if (status === 'searching' || status === 'expanding') {
            const tipInterval = setInterval(() => {
                setCurrentTipIndex(prev => (prev + 1) % PRO_TIPS.length);
            }, 10000);
            return () => clearInterval(tipInterval);
        }
    }, [status]);

    const handlePlayVsAi = () => {
        console.log("Initializing AI match...");
        onStartGame(true);
    };

    const handleCancelAndClose = () => {
        cancelSearch();
        onCancel();
    };

    const isSearching = status === 'searching' || status === 'expanding';

    return (
        <>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[468px] bg-purple-600/20 backdrop-blur-xl border border-white/10 rounded-[32px] z-[110] flex flex-col shadow-2xl overflow-hidden"
            >
                {/* Header / Title */}
                <div className="w-full flex justify-center pt-4 pb-2">
                    <div className="w-12 h-1.5 bg-white/20 rounded-full cursor-pointer" />
                </div>

                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-purple-400">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            Matchmaking
                        </h2>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-panel-gutter py-8 space-y-12 flex flex-col items-center justify-center relative">

                    <AnimatePresence mode="wait">
                        {/* 1. SEARCHING STATE */}
                        {isSearching && (
                            <motion.div
                                key="searching"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex flex-col items-center w-full"
                            >
                                {/* Radar Orb */}
                                <div className="relative w-64 h-64 flex items-center justify-center mb-8">
                                    {/* Outer Pulsing Rings */}
                                    <motion.div
                                        animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                        className={`absolute inset-0 rounded-full border-2 ${status === 'expanding' ? 'border-amber-500/30' : 'border-purple-600/30'}`}
                                    />
                                    <motion.div
                                        animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                                        transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                                        className={`absolute inset-0 rounded-full border-2 ${status === 'expanding' ? 'border-amber-500/20' : 'border-purple-600/20'}`}
                                    />

                                    {/* Center Glowing Orb */}
                                    <motion.div
                                        animate={{
                                            scale: [1, 1.1, 1],
                                            boxShadow: status === 'expanding'
                                                ? ["0 0 50px rgba(245,158,11,0.2)", "0 0 80px rgba(245,158,11,0.4)", "0 0 50px rgba(245,158,11,0.2)"]
                                                : ["0 0 50px rgba(99,102,241,0.2)", "0 0 80px rgba(99,102,241,0.4)", "0 0 50px rgba(99,102,241,0.2)"]
                                        }}
                                        transition={{ duration: 3, repeat: Infinity }}
                                        className={`w-40 h-40 rounded-full backdrop-blur-3xl border flex flex-col items-center justify-center transition-colors duration-1000 ${status === 'expanding' ? 'bg-amber-500/20 border-amber-500/40' : 'bg-purple-600/20 border-purple-600/40'}`}
                                    >
                                        <span className="text-4xl font-black text-white italic">{searchTime}s</span>
                                        <span className={`text-[10px] font-black uppercase tracking-widest mt-1 transition-colors duration-1000 ${status === 'expanding' ? 'text-amber-400' : 'text-purple-400'}`}>Elapsed</span>
                                    </motion.div>

                                    {/* Rotating Scan Line */}
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                                        className="absolute inset-0 z-20"
                                    >
                                        <div className="w-1/2 h-1 bg-gradient-to-r from-transparent via-white/40 to-white/60 absolute top-1/2 left-1/2 origin-left -translate-y-1/2 blur-[1px]" />
                                    </motion.div>
                                </div>

                                <div className="text-center space-y-4">
                                    <motion.h3
                                        animate={{ opacity: [0.5, 1, 0.5] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                        className="text-2xl font-black text-white italic tracking-tighter"
                                    >
                                        {isHybrid ? "FILLING REMAINING SLOTS..." : (status === 'expanding' ? "EXPANDING SEARCH..." : "SEARCHING...")}
                                    </motion.h3>

                                    <div className="h-4">
                                        <AnimatePresence mode="wait">
                                            <motion.p
                                                key={currentTipIndex}
                                                initial={{ opacity: 0, y: 5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -5 }}
                                                className="text-white/50 text-xs font-bold uppercase tracking-wide"
                                            >
                                                Tip: {PRO_TIPS[currentTipIndex]}
                                            </motion.p>
                                        </AnimatePresence>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* 2. TIMEOUT RESOLUTION MODAL (Only for non-hybrid) */}
                        {status === 'timeout' && !isHybrid && (
                            <motion.div
                                key="timeout"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center w-full px-4"
                            >
                                {/* AI Proposal Header */}
                                <div className="space-y-4 text-center mb-8 w-full flex flex-col items-center">
                                    <div className="w-20 h-20 rounded-3xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.2)]">
                                        <motion.svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="w-10 h-10 text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]"
                                            animate={{ y: [-2, 2, -2] }}
                                            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                                        >
                                            <rect x="3" y="10" width="18" height="10" rx="2" />
                                            <circle cx="12" cy="6" r="2" />
                                            <path d="M12 8v2" />
                                            <line x1="8" y1="15" x2="8.01" y2="15" strokeWidth="3" />
                                            <line x1="16" y1="15" x2="16.01" y2="15" strokeWidth="3" />
                                        </motion.svg>
                                    </div>
                                    <h3 className="text-3xl font-black text-white italic tracking-tighter">NO MATCH FOUND</h3>
                                    <p className="text-white/60 text-sm font-medium px-4">
                                        The network is currently quiet.<br />
                                        Want to charge-up your skills against our advanced AI?
                                    </p>
                                </div>

                                <div className="w-full max-w-sm space-y-4 relative z-10">
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={handlePlayVsAi}
                                        className="w-full py-5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black rounded-2xl transition-all shadow-[0_0_20px_rgba(147,51,234,0.4)] flex flex-col items-center justify-center gap-1"
                                    >
                                        <span className="text-xl italic tracking-tighter">PLAY VS AI</span>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white/80">Offline Mode</span>
                                    </motion.button>

                                    <div className="w-full py-2">
                                        <hr className="border-white/10" />
                                    </div>

                                    <button
                                        onClick={startSearch}
                                        className="w-full py-4 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black rounded-2xl transition-all"
                                    >
                                        RETRY SEARCH
                                    </button>
                                </div>

                                {/* Rotating AI Tips */}
                                <div className="mt-8 h-4">
                                    <AnimatePresence mode="wait">
                                        <motion.p
                                            key={currentTipIndex}
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -5 }}
                                            className="text-amber-500/70 text-[10px] font-black uppercase tracking-widest text-center"
                                        >
                                            AI Tip: {
                                                [
                                                    "AI opponents analyze their moves instantly.",
                                                    "Bots prioritize capturing your pieces.",
                                                    "Practice advanced strategies offline.",
                                                    "AI difficulty scales with your level."
                                                ][currentTipIndex % 4]
                                            }
                                        </motion.p>
                                    </AnimatePresence>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Sticky Bottom Actions */}
                <div className="p-panel-gutter pt-0 mt-auto">
                    <button
                        onClick={handleCancelAndClose}
                        className="w-full py-5 rounded-2xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 hover:border-red-500/50 text-red-400 font-black tracking-widest uppercase transition-all flex items-center justify-center gap-2 shadow-lg"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                        Cancel Search
                    </button>
                </div>
            </motion.div>



            {/* 3. MATCH COUNTDOWN OVERLAY (VS SCREEN) - STAYS FULLSCREEN */}
            <AnimatePresence>
                {countdown !== null && (
                    <motion.div
                        key="countdown"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/80 backdrop-blur-2xl overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/30 to-purple-900/30" />
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                            className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-[url('/mesh-grid.svg')] opacity-10 mix-blend-overlay pointer-events-none"
                        />

                        <div className="relative w-full max-w-4xl flex items-center justify-between px-8 md:px-24">
                            {/* Player 1 (Left) */}
                            <motion.div
                                initial={{ x: -200, opacity: 0, rotateY: -45 }}
                                animate={{ x: 0, opacity: 1, rotateY: 0 }}
                                transition={{ type: "spring", damping: 20, stiffness: 100 }}
                                className="flex flex-col items-center z-10"
                            >
                                <div className="w-32 h-32 md:w-48 md:h-48 rounded-full border-4 border-purple-600 shadow-[0_0_50px_rgba(99,102,241,0.5)] overflow-hidden bg-purple-600 flex items-center justify-center text-6xl">
                                    {profile?.avatar_url ? (
                                        <img src={profile.avatar_url} alt={finalName} className="w-full h-full object-cover" />
                                    ) : (
                                        <span>🎮</span>
                                    )}
                                </div>
                                <h3 className="mt-6 text-2xl md:text-4xl font-black text-white italic tracking-tighter neon-glow-cyan text-center">
                                    {finalName}
                                </h3>
                                <div className="mt-2 bg-purple-600/20 px-4 py-1 rounded-full border border-purple-600/50">
                                    <span className="text-xs font-bold text-purple-300 uppercase tracking-widest">Lv. 8</span>
                                </div>
                            </motion.div>

                            {/* Center VS Badge & Timer */}
                            <motion.div
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ delay: 0.3, type: "spring" }}
                                className="relative flex flex-col items-center justify-center z-20 mx-4"
                            >
                                <div className="absolute inset-0 bg-cyan-500/20 blur-[60px] rounded-full" />
                                <h2 className="text-6xl md:text-[8rem] font-black text-white italic tracking-tighter leading-none drop-shadow-[0_0_30px_rgba(255,255,255,0.8)]">
                                    VS
                                </h2>
                                <motion.div
                                    key={countdown}
                                    initial={{ scale: 2, opacity: 0, filter: 'blur(10px)' }}
                                    animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                                    className="mt-8 text-[4rem] md:text-[6rem] font-black text-white italic leading-none drop-shadow-2xl"
                                >
                                    {countdown}
                                </motion.div>
                            </motion.div>

                            {/* Player 2 (Right - Mocked Rival or AI) */}
                            <motion.div
                                initial={{ x: 200, opacity: 0, rotateY: 45 }}
                                animate={{ x: 0, opacity: 1, rotateY: 0 }}
                                transition={{ type: "spring", damping: 20, stiffness: 100 }}
                                className="flex flex-col items-center z-10"
                            >
                                <div className="w-32 h-32 md:w-48 md:h-48 rounded-full border-4 border-amber-500 shadow-[0_0_50px_rgba(245,158,11,0.5)] overflow-hidden bg-purple-600 flex items-center justify-center">
                                    <motion.svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="w-16 h-16 md:w-24 md:h-24 text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.8)]"
                                        animate={{ y: [-4, 4, -4] }}
                                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                                    >
                                        <rect x="3" y="8" width="18" height="10" rx="2" />
                                        <circle cx="12" cy="4" r="2" />
                                        <path d="M12 6v2" />
                                        <line x1="8" y1="13" x2="8.01" y2="13" strokeWidth="3" />
                                        <line x1="16" y1="13" x2="16.01" y2="13" strokeWidth="3" />
                                    </motion.svg>
                                </div>
                                <h3 className="mt-6 text-2xl md:text-4xl font-black text-white italic tracking-tighter neon-glow-purple text-center">
                                    Rival
                                </h3>
                                <div className="mt-2 bg-amber-500/20 px-4 py-1 rounded-full border border-amber-500/50">
                                    <span className="text-xs font-bold text-amber-300 uppercase tracking-widest">Lv. ?</span>
                                </div>
                            </motion.div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};
