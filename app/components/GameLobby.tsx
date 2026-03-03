"use client";

import React, { useState } from 'react';
import { useMultiplayer } from '@/hooks/useMultiplayer';

export default function GameLobby() {
    const [inputRoomId, setInputRoomId] = useState('');
    const { roomId, isLobbyConnected, lastRoll, hostGame, joinGame, rollDice } = useMultiplayer();

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

                <p className="text-white/40 text-sm animate-pulse italic">Ready to start the game soon...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center p-6 space-y-8">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-white mb-2">Multiplayer Lobby</h2>
                <p className="text-white/60">Host a new game or join a friend</p>
            </div>

            <div className="w-full max-w-sm space-y-6">
                {/* Host Section */}
                {!roomId ? (
                    <button
                        onClick={handleHost}
                        className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
                    >
                        Host New Game
                    </button>
                ) : (
                    <div className="bg-indigo-500/10 border border-indigo-500/30 p-6 rounded-2xl text-center space-y-2">
                        <span className="text-indigo-400 text-xs font-bold uppercase tracking-widest">Your Room ID</span>
                        <div className="text-2xl font-mono text-white select-all bg-black/20 p-3 rounded-xl border border-white/5">
                            {roomId}
                        </div>
                        <p className="text-indigo-300/60 text-xs">Share this ID with your friend</p>
                    </div>
                )}

                <div className="relative flex items-center py-4">
                    <div className="flex-grow border-t border-white/10"></div>
                    <span className="flex-shrink mx-4 text-white/40 text-sm">OR</span>
                    <div className="flex-grow border-t border-white/10"></div>
                </div>

                {/* Join Section */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl p-6 space-y-4">
                    <input
                        type="text"
                        placeholder="Enter Room ID"
                        value={inputRoomId}
                        onChange={(e) => setInputRoomId(e.target.value)}
                        className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono"
                    />
                    <button
                        onClick={handleJoin}
                        className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-all active:scale-95"
                    >
                        Join Game
                    </button>
                </div>
            </div>
        </div>
    );
}
