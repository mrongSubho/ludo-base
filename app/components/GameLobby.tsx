"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { useMatchmaking } from '@/hooks/useMatchmaking';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export default function GameLobby() {
    const [inputRoomId, setInputRoomId] = useState('');
    const {
        roomId,
        isLobbyConnected,
        isHost,
        lastRoll,
        hostGame,
        joinGame,
        rollDice,
        sendAction,
        setGameMode: setMultiplayerGameMode // Assuming we might need to sync this
    } = useMultiplayer();

    const { user } = useCurrentUser();
    const [gameMode, setGameMode] = useState<'classic' | 'power'>('classic');
    const [matchType, setMatchType] = useState<'1v1' | '2v2' | '4P'>('1v1');
    const [wager, setWager] = useState(0);

    const { status, searchTime, startSearch, cancelSearch } = useMatchmaking({
        playerId: user?.wallet_address || 'guest',
        gameMode,
        matchType,
        wager,
        onMatchFound: (id) => {
            console.log('🎉 Match found! Joining room:', id);
            joinGame(id);
        }
    });

    const handleHost = () => {
        hostGame();
    };

    const handleJoin = () => {
        if (!inputRoomId) {
            alert('Please enter a Room ID');
            return;
        }
        joinGame(inputRoomId);
    };

    if (isLobbyConnected) {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl space-y-6">
                <h2 className="text-2xl font-bold text-teal-400">✅ Match Connected!</h2>

                <div className="flex flex-col items-center p-8 bg-black/20 rounded-2xl border border-white/5 w-full">
                    <span className="text-white/40 text-xs uppercase tracking-widest mb-2">Sync Test</span>
                    <div className="text-5xl font-bold text-white mb-6">
                        {lastRoll ?? '?'}
                    </div>
                    <button
                        onClick={rollDice}
                        className="w-full py-4 bg-teal-500 hover:bg-teal-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-teal-500/20 active:scale-95"
                    >
                        Roll Dice
                    </button>
                </div>

                {isHost ? (
                    <button
                        onClick={() => sendAction('START_GAME')}
                        className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/20 active:scale-95 text-lg uppercase tracking-wider"
                    >
                        🚀 Start Game
                    </button>
                ) : (
                    <p className="text-white/40 text-sm animate-pulse italic">Waiting for host to start...</p>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center p-6 space-y-8 w-full max-w-2xl mx-auto">
            <div className="text-center">
                <h2 className="text-4xl font-black text-white mb-2 tracking-tight">GAME LOBBY</h2>
                <p className="text-white/50 font-medium">Find a match or play with friends</p>
            </div>

            {/* Matchmaking Options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                <div className="space-y-4 bg-white/5 p-6 rounded-3xl border border-white/10">
                    <h3 className="text-white/60 text-xs font-bold uppercase tracking-widest">Match Settings</h3>

                    <div className="space-y-3">
                        <label className="block text-sm text-white/40">Game Mode</label>
                        <div className="flex gap-2">
                            {(['classic', 'power'] as const).map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => setGameMode(mode)}
                                    className={`flex-1 py-2 rounded-xl text-sm font-bold capitalize transition-all ${gameMode === mode ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                                >
                                    {mode}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="block text-sm text-white/40">Players</label>
                        <div className="flex gap-2">
                            {(['1v1', '2v2', '4P'] as const).map(type => (
                                <button
                                    key={type}
                                    onClick={() => setMatchType(type)}
                                    className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${matchType === type ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-6 flex flex-col justify-center">
                    <button
                        onClick={startSearch}
                        className="group relative w-full py-6 bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-black rounded-3xl transition-all shadow-xl shadow-indigo-500/20 active:scale-95 overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span className="relative text-xl tracking-tighter italic">FIND QUICK MATCH</span>
                    </button>

                    <div className="relative flex items-center">
                        <div className="flex-grow border-t border-white/10"></div>
                        <span className="flex-shrink mx-4 text-white/20 text-xs font-bold">OR PRIVATE ROOM</span>
                        <div className="flex-grow border-t border-white/10"></div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={handleHost}
                            className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl border border-white/10 transition-all text-sm"
                        >
                            Host
                        </button>
                        <div className="flex-[2] flex gap-2">
                            <input
                                type="text"
                                placeholder="ID"
                                value={inputRoomId}
                                onChange={(e) => setInputRoomId(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-2xl px-4 py-2 text-white font-mono text-center focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                            />
                            <button
                                onClick={handleJoin}
                                className="px-6 bg-white/10 hover:bg-white/20 text-white font-bold rounded-2xl transition-all"
                            >
                                Join
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Matchmaking Overlay */}
            <AnimatePresence>
                {(status !== 'idle' && status !== 'matched' && status !== 'error') && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl p-6"
                    >
                        <div className="w-full max-w-md bg-[#1a1c2e] p-10 rounded-[40px] border border-white/10 shadow-2xl text-center space-y-8 relative overflow-hidden">
                            {/* Animated Background Pulse */}
                            <motion.div
                                animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1] }}
                                transition={{ duration: 4, repeat: Infinity }}
                                className="absolute inset-0 bg-indigo-500/20 blur-[100px] -z-10"
                            />

                            <div className="space-y-2">
                                <h3 className="text-3xl font-black text-white italic tracking-tighter">
                                    {status === 'searching' && "FINDING RIVALS..."}
                                    {status === 'expanding' && "EXPANDING SEARCH..."}
                                    {status === 'timeout' && "SEARCH EXPIRED"}
                                </h3>
                                <p className="text-indigo-400 font-bold text-sm tracking-widest uppercase">
                                    {gameMode} • {matchType}
                                </p>
                            </div>

                            {/* Circular Loader */}
                            <div className="relative w-40 h-40 mx-auto flex items-center justify-center">
                                <svg className="w-full h-full rotate-[-90deg]">
                                    <circle
                                        cx="80" cy="80" r="70"
                                        className="stroke-white/5 fill-none"
                                        strokeWidth="8"
                                    />
                                    <motion.circle
                                        cx="80" cy="80" r="70"
                                        className="stroke-indigo-500 fill-none"
                                        strokeWidth="8"
                                        strokeDasharray="440"
                                        animate={{ strokeDashoffset: 440 - (440 * (searchTime / 40)) }}
                                        transition={{ duration: 1, ease: "linear" }}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-4xl font-black text-white">{searchTime}s</span>
                                    <span className="text-[10px] text-white/40 uppercase font-black tracking-widest">Elapsed</span>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {status === 'timeout' ? (
                                    <div className="flex flex-col gap-3">
                                        <button
                                            onClick={startSearch}
                                            className="w-full py-4 bg-white text-black font-black rounded-2xl hover:scale-[1.02] transition-transform active:scale-95"
                                        >
                                            RETRY SEARCH
                                        </button>
                                        <button
                                            onClick={() => {/* Mock AI trigger or logic */ }}
                                            className="w-full py-4 bg-white/5 hover:bg-white/10 text-white font-black rounded-2xl border border-white/10 transition-all active:scale-95"
                                        >
                                            PLAY VS AI (SOLO)
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={cancelSearch}
                                        className="w-full py-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-black rounded-2xl transition-all border border-red-500/20"
                                    >
                                        CANCEL SEARCH
                                    </button>
                                )}
                            </div>

                            {/* Dynamic Tips */}
                            <motion.p
                                key={Math.floor(searchTime / 5)}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-white/30 text-[10px] font-bold uppercase tracking-widest"
                            >
                                Tip: {status === 'searching' ? "Safe zones protect you from capture!" : "Win to climb the global leaderboard!"}
                            </motion.p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
