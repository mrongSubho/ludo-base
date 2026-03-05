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
    onStartGame: () => void;
    onCancel: () => void;
}

export const QuickMatchPanel = ({
    gameMode,
    matchType,
    wager,
    onStartGame,
    onCancel
}: QuickMatchPanelProps) => {
    const { address, profile, displayName: finalName } = useCurrentUser();
    const { joinGame } = useMultiplayerContext();

    const [countdown, setCountdown] = useState<number | null>(null);
    const [currentTipIndex, setCurrentTipIndex] = useState(0);

    const onMatchFound = useCallback((id: string) => {
        console.log('🎉 Match found! Starting countdown...');
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
    }, [joinGame, onStartGame]);

    const { status, searchTime, startSearch, cancelSearch } = useMatchmaking({
        playerId: address || 'guest',
        gameMode,
        matchType,
        wager,
        onMatchFound
    });

    // Auto-start search when this panel mounts
    useEffect(() => {
        startSearch();
        // We'll trust the hook's internal cleanup if the component unmounts unexpectedly
        return () => {
            if (status === 'searching' || status === 'expanding') {
                cancelSearch();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        onStartGame();
    };

    const handleCancelAndClose = () => {
        cancelSearch();
        onCancel();
    };

    const isSearching = status === 'searching' || status === 'expanding';

    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-xl">
            <AnimatePresence mode="wait">
                {/* 1. SEARCHING STATE */}
                {isSearching && (
                    <motion.div
                        key="searching"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col items-center space-y-12"
                    >
                        {/* Radar Orb */}
                        <div className="relative w-64 h-64 flex items-center justify-center">
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
                                <span className={`text-[8px] font-black uppercase tracking-widest mt-1 transition-colors duration-1000 ${status === 'expanding' ? 'text-amber-400' : 'text-purple-400'}`}>Elapsed</span>
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
                                className="text-3xl font-black text-white italic tracking-tighter"
                            >
                                {status === 'expanding' ? "EXPANDING SEARCH PARAMS..." : "SEARCHING FOR RIVALS..."}
                            </motion.h3>

                            <div className="h-4">
                                <AnimatePresence mode="wait">
                                    <motion.p
                                        key={currentTipIndex}
                                        initial={{ opacity: 0, y: 5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="text-white/40 text-xs font-bold uppercase tracking-widest"
                                    >
                                        Pro Tip: {PRO_TIPS[currentTipIndex]}
                                    </motion.p>
                                </AnimatePresence>
                            </div>
                        </div>

                        <button
                            onClick={handleCancelAndClose}
                            className="bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 px-12 py-4 rounded-3xl text-white/40 hover:text-red-500 text-[10px] font-black uppercase tracking-widest transition-all"
                        >
                            Cancel Search
                        </button>
                    </motion.div>
                )}

                {/* 2. TIMEOUT RESOLUTION MODAL */}
                {status === 'timeout' && (
                    <motion.div
                        key="timeout"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-xl"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="w-full max-w-lg glass-panel rounded-[64px] p-12 text-center space-y-10 shadow-2xl relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-white/5 pointer-events-none" />

                            <div className="space-y-3">
                                <h3 className="text-5xl font-black text-white italic tracking-tightest">NO MATCH FOUND</h3>
                                <p className="text-white/40 text-sm font-medium">Servers are quiet. What would you like to do?</p>
                            </div>

                            <div className="grid grid-cols-1 gap-4 relative z-10">
                                <button
                                    onClick={startSearch}
                                    className="w-full py-6 bg-white text-black font-black rounded-[32px] hover:scale-[1.02] transition-all active:scale-95"
                                >
                                    RETRY SEARCH
                                </button>
                                <button
                                    onClick={handlePlayVsAi}
                                    className="w-full py-6 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black rounded-[32px] transition-all active:scale-95"
                                >
                                    PLAY VS AI (OFFLINE)
                                </button>
                                <button
                                    onClick={handleCancelAndClose}
                                    className="text-white/20 hover:text-white/40 text-[10px] font-bold uppercase tracking-widest mt-4 transition-colors"
                                >
                                    Return to Menu
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {/* 3. MATCH COUNTDOWN OVERLAY (VS SCREEN) */}
                {countdown !== null && (
                    <motion.div
                        key="countdown"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
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
                                <div className="w-32 h-32 md:w-48 md:h-48 rounded-full border-4 border-amber-500 shadow-[0_0_50px_rgba(245,158,11,0.5)] overflow-hidden bg-purple-600 flex items-center justify-center text-6xl">
                                    <span>🤖</span>
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
        </div>
    );
};
