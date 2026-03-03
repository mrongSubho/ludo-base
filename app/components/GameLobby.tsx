"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
    const { address, isConnected } = useCurrentUser();
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
                            <div className="space-y-4">
                                <h3 className="text-white/40 text-[10px] font-black uppercase tracking-[0.2em] ml-2">Select Game Mode</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    {(['classic', 'power'] as const).map(mode => (
                                        <button
                                            key={mode}
                                            onClick={() => setGameMode(mode)}
                                            className={`relative p-6 rounded-[32px] border transition-all duration-500 overflow-hidden group glass-panel ${gameMode === mode
                                                ? 'border-cyan-400 shadow-[0_0_30px_rgba(0,255,255,0.2)]'
                                                : 'border-white/10 hover:border-white/30'
                                                }`}
                                        >
                                            <div className="relative z-10 text-left">
                                                <span className={`block text-lg font-black italic tracking-tighter capitalize transition-all duration-300 ${gameMode === mode ? 'neon-glow-cyan' : 'text-white/40'}`}>
                                                    {mode}
                                                </span>
                                                <span className={`text-[11px] font-semibold leading-tight mt-1 block ${gameMode === mode ? 'text-white' : 'text-white/50'}`}>
                                                    {mode === 'classic' ? 'Original Rules' : 'Special Power-ups'}
                                                </span>
                                            </div>
                                            {gameMode === mode && (
                                                <motion.div layoutId="mode-glow" className="absolute inset-0 bg-gradient-to-br from-cyan-400/10 to-transparent" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-white/40 text-[10px] font-black uppercase tracking-[0.2em] ml-2">Match Type</h3>
                                <div className="grid grid-cols-3 gap-4">
                                    {(['1v1', '2v2', '4P'] as const).map(type => (
                                        <button
                                            key={type}
                                            onClick={() => setMatchType(type)}
                                            className={`p-6 rounded-[32px] border transition-all duration-500 glass-panel ${matchType === type
                                                ? 'border-purple-500 shadow-[0_0_30px_rgba(176,38,255,0.2)]'
                                                : 'border-white/10 hover:border-white/30'
                                                }`}
                                        >
                                            <span className={`block text-xl font-black italic tracking-tighter transition-all duration-300 ${matchType === type ? 'neon-glow-purple' : 'text-white/40'}`}>
                                                {type}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Right: Wager & Start (2 cols) */}
                        <div className="lg:col-span-2 flex flex-col justify-end space-y-8">
                            <div className="p-8 rounded-[40px] glass-panel space-y-6">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-white/40 text-[10px] font-black uppercase tracking-[0.2em]">Match Wager</h3>
                                    <div className="px-3 py-1 bg-yellow-500/20 rounded-full border border-yellow-500/30">
                                        <span className="text-[10px] text-yellow-500 font-bold">LUDO COINS</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-4 py-2">
                                    <button
                                        onClick={() => setWager(Math.max(0, wager - 100))}
                                        className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                                    >
                                        −
                                    </button>
                                    <div className="text-center">
                                        <span className="text-4xl font-black text-white">{wager}</span>
                                        <span className="block text-[8px] text-white/30 font-bold uppercase tracking-widest mt-1">Entry Fee</span>
                                    </div>
                                    <button
                                        onClick={() => setWager(wager + 100)}
                                        className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                                    >
                                        +
                                    </button>
                                </div>

                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={startSearch}
                                    className="group relative w-full py-6 bg-white text-black font-black rounded-[32px] transition-all overflow-hidden shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_40px_rgba(255,255,255,0.8)]"
                                >
                                    <div className="absolute inset-0 bg-indigo-500 opacity-0 group-hover:opacity-10 transition-opacity" />
                                    <span className="relative text-xl italic tracking-tighter">PLAY ONLINE</span>
                                </motion.button>
                            </div>

                            <button
                                onClick={() => setShowPrivateOptions(!showPrivateOptions)}
                                className="text-white/30 hover:text-white/60 text-[10px] font-bold uppercase tracking-widest transition-colors"
                            >
                                {showPrivateOptions ? "✕ Close Private Options" : "⬚ Host/Join Private Room"}
                            </button>

                            <AnimatePresence>
                                {showPrivateOptions && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="flex gap-2 p-2 bg-white/5 rounded-3xl border border-white/10">
                                            <input
                                                type="text"
                                                placeholder="ROOM ID"
                                                value={inputRoomId}
                                                onChange={(e) => setInputRoomId(e.target.value.toUpperCase())}
                                                className="flex-grow bg-transparent px-4 py-3 text-white font-mono text-sm placeholder-white/20 focus:outline-none"
                                            />
                                            <button
                                                onClick={() => joinGame(inputRoomId)}
                                                className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-2xl transition-all"
                                            >
                                                JOIN
                                            </button>
                                            <button
                                                onClick={hostGame}
                                                className="px-6 py-3 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-500/20"
                                            >
                                                HOST
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
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
                                className={`absolute inset-0 rounded-full border-2 ${status === 'expanding' ? 'border-amber-500/30' : 'border-indigo-500/30'}`}
                            />
                            <motion.div
                                animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                                transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                                className={`absolute inset-0 rounded-full border-2 ${status === 'expanding' ? 'border-amber-500/20' : 'border-indigo-500/20'}`}
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
                                className={`w-40 h-40 rounded-full backdrop-blur-3xl border flex flex-col items-center justify-center transition-colors duration-1000 ${status === 'expanding' ? 'bg-amber-500/20 border-amber-500/40' : 'bg-indigo-500/20 border-indigo-500/40'
                                    }`}
                            >
                                <span className="text-4xl font-black text-white italic">{searchTime}s</span>
                                <span className={`text-[8px] font-black uppercase tracking-widest mt-1 transition-colors duration-1000 ${status === 'expanding' ? 'text-amber-400' : 'text-indigo-400'
                                    }`}>Elapsed</span>
                            </motion.div>

                            {/* Rotating Scan Line */}
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                                className="absolute inset-0 z-20"
                            >
                                <div className={`w-1/2 h-1 bg-gradient-to-r from-transparent via-white/40 to-white/60 absolute top-1/2 left-1/2 origin-left -translate-y-1/2 blur-[1px]`} />
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

                {/* 4. MATCH COUNTDOWN OVERLAY */}
                {countdown !== null && (
                    <motion.div
                        key="countdown"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-indigo-600"
                    >
                        <motion.h2
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="text-white/40 text-xl font-black uppercase tracking-[0.5em] mb-4"
                        >
                            Match Starting
                        </motion.h2>
                        <motion.div
                            key={countdown}
                            initial={{ scale: 2, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="text-[15rem] font-black text-white italic leading-none"
                        >
                            {countdown}
                        </motion.div>
                        <div className="mt-12 flex gap-4">
                            <div className="w-2 h-2 rounded-full bg-white/20 animate-bounce" style={{ animationDelay: '0s' }} />
                            <div className="w-2 h-2 rounded-full bg-white/20 animate-bounce" style={{ animationDelay: '0.2s' }} />
                            <div className="w-2 h-2 rounded-full bg-white/20 animate-bounce" style={{ animationDelay: '0.4s' }} />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
