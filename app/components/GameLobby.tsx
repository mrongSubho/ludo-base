"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayWithFriendsPanel } from './PlayWithFriendsPanel';
import { useMultiplayerContext } from '@/hooks/MultiplayerContext';
import { useMatchmaking } from '@/hooks/useMatchmaking';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const PRO_TIPS = [
    "Safe zones protect you from capture!",
    "Capture opponents to get a bonus roll!",
    "Win to climb the global leaderboard!",
    "Use power-ups strategically to gain an edge.",
    "Rolling a 6 gives you an extra turn!",
    "Block your opponents to slow them down."
];

interface GameLobbyProps {
    gameMode: 'classic' | 'power';
    setGameMode: (mode: 'classic' | 'power') => void;
    matchType: '1v1' | '2v2' | '4P';
    setMatchType: (type: '1v1' | '2v2' | '4P') => void;
    wager: number;
    setWager: (wager: number) => void;
    onStartGame: () => void;
}

export default function GameLobby({
    gameMode,
    setGameMode,
    matchType,
    setMatchType,
    wager,
    setWager,
    onStartGame
}: GameLobbyProps) {
    const { address, profile, displayName: finalName } = useCurrentUser();
    const {
        roomId,
        isLobbyConnected,
        isHost,
        hostGame,
        joinGame
    } = useMultiplayerContext();

    // Configuration State
    const [showPrivateOptions, setShowPrivateOptions] = useState(false);
    const [inputRoomId, setInputRoomId] = useState('');

    // Matchmaking State
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

    const isSearching = status === 'searching' || status === 'expanding';

    return (
        <div className="relative w-full max-w-4xl mx-auto px-4 py-12 min-h-[600px] flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
                {/* 1. INITIAL SETUP PANEL */}
                {status === 'idle' && !countdown && (
                    <motion.div
                        key="setup"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="w-full grid grid-cols-1 lg:grid-cols-5 gap-8"
                    >
                        {/* Left: Mode & Match Type (3 cols) */}
                        <div className="lg:col-span-3 space-y-8">
                            <div className="space-y-4 flex flex-col items-center lg:items-start">
                                <h3 className="text-white/80 text-xs font-black uppercase tracking-[0.2em] text-center drop-shadow-md mb-2">Select Game Mode</h3>
                                <div className="flex justify-center gap-4">
                                    {(['classic', 'power'] as const).map(mode => (
                                        <button
                                            key={mode}
                                            onClick={() => setGameMode(mode)}
                                            className={`relative px-8 py-3 rounded-full border transition-all duration-300 overflow-hidden group glass-panel flex flex-col items-center justify-center min-w-[140px] ${gameMode === mode
                                                ? 'border-cyan-400 shadow-[0_0_15px_rgba(0,255,255,0.2)] bg-cyan-900/10'
                                                : 'border-white/20 hover:border-white/40 bg-white/5'
                                                }`}
                                        >
                                            <div className="relative z-10 text-center">
                                                <span className={`block text-xl font-black italic tracking-tighter capitalize drop-shadow-md ${gameMode === mode ? 'text-cyan-400' : 'text-white/90'}`}>
                                                    {mode}
                                                </span>
                                                <span className={`block text-[8px] font-black uppercase tracking-[0.2em] mt-0.5 ${gameMode === mode ? 'text-cyan-400' : 'text-white/50'}`}>
                                                    {mode === 'classic' ? 'Original Rules' : 'Special Power-ups'}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4 flex flex-col items-center">
                                <h3 className="text-white/80 text-xs font-black uppercase tracking-[0.2em] drop-shadow-md mt-2">Match Type</h3>
                                <div className="flex justify-center gap-3">
                                    {(['1v1', '2v2', '4P'] as const).map(type => (
                                        <button
                                            key={type}
                                            onClick={() => setMatchType(type)}
                                            className={`w-14 h-14 rounded-full border transition-all duration-300 glass-panel flex items-center justify-center ${matchType === type
                                                ? 'border-white/60 shadow-[0_0_15px_rgba(255,255,255,0.2)] bg-white/10'
                                                : 'border-white/10 hover:border-white/30 bg-white/5'
                                                }`}
                                        >
                                            <span className={`block text-xl font-black italic tracking-tighter drop-shadow-md ${matchType === type ? 'text-white' : 'text-white/60'}`}>
                                                {type}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Right: Wager & Start (2 cols) */}
                        <div className="lg:col-span-2 flex flex-col justify-end space-y-4">

                            {/* NEW WAGER SECTION */}
                            <div className="p-6 pb-8 rounded-[40px] glass-panel flex flex-col items-center shadow-2xl border-white/20">
                                {/* Header: Match Fees & Ludo Coins */}
                                <div className="w-full flex justify-between items-start mb-8 px-2">
                                    <span className="text-white/80 text-xs font-black uppercase tracking-[0.2em] drop-shadow-md">Match Fees</span>
                                    <div className="px-3 py-1 flex items-center justify-center bg-yellow-400/10 border border-yellow-400/40 rounded-full shadow-[0_0_10px_rgba(250,204,21,0.2)]">
                                        <span className="text-yellow-400 text-[10px] font-black uppercase tracking-widest drop-shadow-sm">Ludo Coins</span>
                                    </div>
                                </div>

                                {/* Stepper + Input */}
                                <div className="flex items-center justify-between w-full px-2 mb-6">
                                    <button
                                        onClick={() => setWager(Math.max(0, wager - (wager >= 1000 ? 1000 : 100)))}
                                        className="w-14 h-14 rounded-[20px] bg-white/5 border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 transition-colors active:scale-95 shadow-lg backdrop-blur-md"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </button>

                                    <div className="flex-1 flex flex-col items-center justify-center relative -mt-4">
                                        <input
                                            type="number"
                                            value={wager}
                                            onChange={(e) => setWager(Math.max(0, parseInt(e.target.value) || 0))}
                                            className="w-full bg-transparent text-center text-6xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-purple-600/50 rounded-xl"
                                            style={{ appearance: 'textfield', WebkitAppearance: 'none', margin: 0 }}
                                        />
                                        <span className="text-[10px] text-white/50 font-black uppercase tracking-[0.2em] mt-2 drop-shadow-md">Entry Fee</span>
                                    </div>

                                    <button
                                        onClick={() => setWager(wager + (wager >= 1000 ? 1000 : 100))}
                                        className="w-14 h-14 rounded-[20px] bg-white/5 border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 transition-colors active:scale-95 shadow-lg backdrop-blur-md"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </button>
                                </div>
                            </div>
                            <div className="w-full space-y-3">
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={startSearch}
                                    className="group relative w-full py-5 bg-white text-black font-black rounded-full transition-all overflow-hidden shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_40px_rgba(255,255,255,0.8)] -mt-6 z-10"
                                >
                                    <span className="relative text-xl italic tracking-tighter">PLAY ONLINE</span>
                                </motion.button>

                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setShowPrivateOptions(true)}
                                    className="group relative w-full py-4 bg-white/5 border border-white/10 text-white font-black rounded-[32px] transition-all overflow-hidden hover:bg-white/10"
                                >
                                    <div className="absolute inset-0 bg-purple-500 opacity-0 group-hover:opacity-10 transition-opacity" />
                                    <span className="relative text-lg italic tracking-tighter shadow-sm flex items-center justify-center gap-2">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                        PLAY WITH FRIENDS
                                    </span>
                                </motion.button>
                            </div>
                        </div>

                        <AnimatePresence>
                            {showPrivateOptions && (
                                <PlayWithFriendsPanel
                                    onClose={() => setShowPrivateOptions(false)}
                                    onJoin={(code: string) => joinGame(code)}
                                    onHost={hostGame}
                                />
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}

                {/* 2. SEARCHING STATE (PHASE 1 & 2) */}
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
                                className={`w-40 h-40 rounded-full backdrop-blur-3xl border flex flex-col items-center justify-center transition-colors duration-1000 ${status === 'expanding' ? 'bg-purple-600mber-500/20 border-amber-500/40' : 'bg-purple-600/20 border-purple-600/40'}`}
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
                            onClick={cancelSearch}
                            className="bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 px-12 py-4 rounded-3xl text-white/40 hover:text-red-500 text-[10px] font-black uppercase tracking-widest transition-all"
                        >
                            Cancel Search
                        </button>
                    </motion.div>
                )}

                {/* 3. TIMEOUT RESOLUTION MODAL (PHASE 3 & 4) */}
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
                            {/* Frost Effect */}
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
                                    onClick={cancelSearch}
                                    className="text-white/20 hover:text-white/40 text-[10px] font-bold uppercase tracking-widest mt-4 transition-colors"
                                >
                                    Return to Menu
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {/* 4. MATCH COUNTDOWN OVERLAY (VS SCREEN) */}
                {countdown !== null && (
                    <motion.div
                        key="countdown"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/80 backdrop-blur-2xl overflow-hidden"
                    >
                        {/* Background Effects */}
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/30 to-purple-900/30" />
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                            className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-[url('/mesh-grid.svg')] opacity-10 mix-blend-overlay pointer-events-none"
                        />

                        {/* VS Container */}
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
                                <div className="absolute inset-0 bg-purple-600yan-500/20 blur-[60px] rounded-full" />
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
                                <div className="mt-2 bg-purple-600mber-500/20 px-4 py-1 rounded-full border border-amber-500/50">
                                    <span className="text-xs font-bold text-amber-300 uppercase tracking-widest">Lv. ?</span>
                                </div>
                            </motion.div>

                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
}
