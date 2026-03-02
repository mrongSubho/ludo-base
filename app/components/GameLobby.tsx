"use client";

import React, { useState } from 'react';

export default function GameLobby() {
    const [roomId, setRoomId] = useState('');

    const handleHost = () => {
        console.log('🎲 Hosting game...');
        // PeerJS logic will go here
    };

    const handleJoin = () => {
        if (!roomId) {
            alert('Please enter a Room ID');
            return;
        }
        console.log(`🔗 Joining game room: ${roomId}`);
        // PeerJS logic will go here
    };

    return (
        <div className="flex flex-col items-center justify-center p-6 space-y-8">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-white mb-2">Multiplayer Lobby</h2>
                <p className="text-white/60">Host a new game or join a friend</p>
            </div>

            <div className="w-full max-w-sm space-y-6">
                {/* Host Section */}
                <button
                    onClick={handleHost}
                    className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
                >
                    Host New Game
                </button>

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
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value)}
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
