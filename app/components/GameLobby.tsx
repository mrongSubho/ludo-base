"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TeamUpMatchPanel } from './TeamUpMatchPanel';
import { QuickMatchPanel } from './QuickMatchPanel';
import { OfflineMatchPanel } from './OfflineMatchPanel';
import { useTeamUpContext } from '@/hooks/TeamUpContext';

interface GameLobbyProps {
    gameMode: 'classic' | 'power';
    setGameMode: (mode: 'classic' | 'power') => void;
    matchType: '1v1' | '2v2' | '4P';
    setMatchType: (type: '1v1' | '2v2' | '4P') => void;
    wager: number;
    setWager: (wager: number) => void;
    onStartGame: (isBotMatch?: boolean) => void;
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
    const {
        roomId,
        isLobbyConnected,
        isHost,
        hostGame,
        joinGame,
        broadcastAction,
        lobbyState,
        sendInvite,
        swapPlayers,
        kickPlayer,
        startQuickMatch,
        leaveGame
    } = useTeamUpContext();

    // Configuration State
    const [showTeamUpOptions, setShowTeamUpOptions] = useState(false);
    const [showOfflineOptions, setShowOfflineOptions] = useState(false);
    const [isQuickMatchActive, setIsQuickMatchActive] = useState(false);
    const [inputRoomId, setInputRoomId] = useState('');

    return (
        <div className="relative w-full max-w-4xl mx-auto px-4 py-12 min-h-[600px] flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
                {/* 1. INITIAL SETUP PANEL */}
                {!isQuickMatchActive && (
                    <motion.div
                        key="setup"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="w-full max-w-[420px] mx-auto flex flex-col gap-6"
                    >
                        {/* Mode & Match Type */}
                        <div className="w-full space-y-8 flex flex-col">
                            <div className="flex flex-col items-center w-full">
                                <div className="flex justify-center w-full mb-8 mt-2">
                                    <div className="inline-block px-6 py-2 bg-white/5 border border-white/10 rounded-full backdrop-blur-md">
                                        <h3 className="text-white/90 text-[11px] font-black uppercase tracking-[0.2em] text-center drop-shadow-md">Select Game Mode</h3>
                                    </div>
                                </div>
                                <div className="flex justify-center gap-4">
                                    {(['classic', 'power'] as const).map(mode => (
                                        <button
                                            key={mode}
                                            onClick={() => setGameMode(mode)}
                                            className={`relative px-8 py-4 rounded-full border transition-all duration-300 overflow-hidden group glass-panel flex flex-col items-center justify-center min-w-[150px] ${gameMode === mode
                                                ? 'border-cyan-400 shadow-[0_0_15px_rgba(0,255,255,0.2)] bg-cyan-900/10'
                                                : 'border-white/20 hover:border-white/40 bg-white/5'
                                                }`}
                                        >
                                            <div className="relative z-10 text-center">
                                                <span className={`block text-xl font-black italic tracking-tighter capitalize drop-shadow-md ${gameMode === mode ? 'text-cyan-400' : 'text-white/90'}`}>
                                                    {mode}
                                                </span>
                                                <div className={`mt-1 inline-block px-3 py-1 rounded-full border backdrop-blur-md ${gameMode === mode ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/10'}`}>
                                                    <span className={`text-[8px] font-black uppercase tracking-[0.2em] ${gameMode === mode ? 'text-cyan-400' : 'text-white/50'}`}>
                                                        {mode === 'classic' ? 'Original Rules' : 'Special Power-ups'}
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col items-center w-full">
                                <div className="flex justify-center w-full mt-6 mb-8">
                                    <div className="inline-block px-6 py-2 bg-white/5 border border-white/10 rounded-full backdrop-blur-md">
                                        <h3 className="text-white/90 text-[11px] font-black uppercase tracking-[0.2em] text-center drop-shadow-md">Match Type</h3>
                                    </div>
                                </div>
                                <div className="flex justify-center gap-3">
                                    {(['1v1', '2v2', '4P'] as const).map(type => (
                                        <button
                                            key={type}
                                            onClick={() => setMatchType(type)}
                                            className={`w-14 h-14 rounded-full border transition-all duration-300 glass-panel flex items-center justify-center ${matchType === type
                                                ? 'border-cyan-400 shadow-[0_0_15px_rgba(0,255,255,0.2)] bg-cyan-900/10'
                                                : 'border-white/10 hover:border-white/30 bg-white/5'
                                                }`}
                                        >
                                            <span className={`block text-xl font-black italic tracking-tighter drop-shadow-md ${matchType === type ? 'text-cyan-400' : 'text-white/60'}`}>
                                                {type}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Wager & Start */}
                        <div className="w-full flex flex-col space-y-4 pt-2">
                            <div className="p-8 pb-10 rounded-[40px] glass-panel space-y-6 flex flex-col items-center shadow-2xl border-white/20">
                                <div className="inline-block px-8 py-2.5 bg-white/5 border border-white/10 rounded-full backdrop-blur-md mb-2">
                                    <span className="text-white/90 text-[11px] font-black uppercase tracking-[0.2em] drop-shadow-md">Entry Fee</span>
                                </div>
                                <div className="flex items-center justify-between w-full px-2">
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
                                            className="w-full bg-transparent text-center text-6xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 rounded-xl [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            style={{ margin: 0 }}
                                        />
                                    </div>
                                    <button
                                        onClick={() => setWager(wager + (wager >= 1000 ? 1000 : 100))}
                                        className="w-14 h-14 rounded-[20px] bg-white/5 border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 transition-colors active:scale-95 shadow-lg backdrop-blur-md"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </button>
                                </div>
                                <div className="flex gap-2 justify-center flex-wrap pt-2">
                                    {[0, 1000, 10000, 100000, 1000000].map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setWager(val)}
                                            className={`px-5 py-2.5 rounded-full border transition-all active:scale-95 backdrop-blur-md shadow-sm text-[12px] font-black ${wager === val
                                                ? 'border-cyan-400 bg-cyan-900/10 text-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.2)]'
                                                : 'bg-white/5 hover:bg-white/15 border-white/10 text-white/90'
                                                }`}
                                        >
                                            {val === 0 ? 'Free' : val >= 1000000 ? `${val / 1000000} M` : val >= 1000 ? `${val / 1000} k` : val}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="w-full flex gap-4 pt-10">
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setIsQuickMatchActive(true)}
                                    className="group relative flex-1 py-5 bg-white text-black font-black rounded-full transition-all overflow-hidden shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_40px_rgba(255,255,255,0.8)] z-10"
                                >
                                    <span className="relative text-md lg:text-lg italic tracking-tighter">QUICK MATCH</span>
                                </motion.button>

                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setShowTeamUpOptions(true)}
                                    className="group relative flex-1 py-5 bg-white text-black font-black rounded-full transition-all overflow-hidden shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_40px_rgba(255,255,255,0.8)] z-10"
                                >
                                    <span className="relative text-md lg:text-lg italic tracking-tighter">TEAM UP</span>
                                </motion.button>
                            </div>

                            <div className="w-full flex justify-center pt-4">
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setShowOfflineOptions(true)}
                                    className="group relative w-[70%] py-4 bg-white/10 hover:bg-white/20 text-white font-black rounded-full border border-white/20 transition-all overflow-hidden shadow-lg z-10 backdrop-blur-md"
                                >
                                    <span className="relative text-sm italic tracking-tighter">OFFLINE MATCH</span>
                                </motion.button>
                            </div>
                        </div>

                        <AnimatePresence>
                            {showTeamUpOptions && (
                                <TeamUpMatchPanel
                                    onClose={() => {
                                        leaveGame();
                                        setShowTeamUpOptions(false);
                                    }}
                                    onJoin={(code: string) => joinGame(code)}
                                    onHost={() => hostGame(matchType, gameMode, wager)}
                                    currentRoomId={roomId}
                                    isHost={isHost}
                                    isLobbyConnected={isLobbyConnected}
                                    lobbyState={lobbyState}
                                    onStartMatch={() => {
                                        setShowTeamUpOptions(false);
                                        onStartGame();
                                    }}
                                    onSwapPlayers={swapPlayers}
                                    onKickPlayer={kickPlayer}
                                    onSendInvite={sendInvite}
                                    onQuickMatch={startQuickMatch}
                                />
                            )}
                        </AnimatePresence>

                        <AnimatePresence>
                            {showOfflineOptions && (
                                <OfflineMatchPanel
                                    gameMode={gameMode}
                                    matchType={matchType}
                                    onClose={() => setShowOfflineOptions(false)}
                                    onStartOfflineGame={() => {
                                        setShowOfflineOptions(false);
                                        onStartGame(true);
                                    }}
                                />
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}

                {(isQuickMatchActive || lobbyState?.status === 'quickmatch') && (
                    <QuickMatchPanel
                        gameMode={gameMode}
                        matchType={matchType}
                        wager={wager}
                        onStartGame={(isBotMatch) => onStartGame(isBotMatch)}
                        onCancel={() => setIsQuickMatchActive(false)}
                        isHybrid={lobbyState?.status === 'quickmatch'}
                        roomCode={roomId}
                        slotsNeeded={lobbyState?.slots.filter(s => s.status === 'empty').length}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
