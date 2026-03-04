import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export const PlayWithFriendsPanel = ({ onClose, onJoin, onHost }: any) => {
    const [activeTab, setActiveTab] = useState<'host' | 'join'>('host');
    const [roomCode, setRoomCode] = useState('');

    const mockFriends = [
        { id: '1', name: 'Alex', status: 'online' },
        { id: '2', name: 'Sarah', status: 'in-game' },
        { id: '3', name: 'Mike', status: 'online' },
    ];

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 backdrop-blur-md bg-black/40"
        >
            <div className="w-full max-w-md bg-[#1a1c29]/80 backdrop-blur-xl border border-white/10 rounded-[40px] shadow-2xl p-6 relative overflow-hidden">
                {/* Close Button */}
                <button onClick={onClose} className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>

                <h2 className="text-2xl font-black italic tracking-tighter text-white text-center mb-6 drop-shadow-md">PLAY WITH FRIENDS</h2>

                {/* Custom Tabs */}
                <div className="flex bg-white/5 rounded-full p-1 mb-8">
                    <button
                        onClick={() => setActiveTab('host')}
                        className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest rounded-full transition-all ${activeTab === 'host' ? 'bg-purple-600 text-white shadow-lg' : 'text-white/50 hover:text-white/80'}`}
                    >
                        Host Game
                    </button>
                    <button
                        onClick={() => setActiveTab('join')}
                        className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest rounded-full transition-all ${activeTab === 'join' ? 'bg-purple-600 text-white shadow-lg' : 'text-white/50 hover:text-white/80'}`}
                    >
                        Join Game
                    </button>
                </div>

                {/* Tab Content */}
                <AnimatePresence mode="wait">
                    {activeTab === 'host' ? (
                        <motion.div
                            key="host"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="space-y-6"
                        >
                            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 text-center">
                                <span className="block text-xs text-white/50 font-bold uppercase tracking-widest mb-2">Room Code</span>
                                <div className="flex items-center justify-center gap-4">
                                    <span className="text-4xl font-mono text-purple-400 font-bold tracking-widest bg-purple-500/10 px-4 py-2 rounded-xl border border-purple-500/20">A7X9K</span>
                                    <button className="p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors shrink-0 text-white" title="Copy Code">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    </button>
                                </div>
                            </div>

                            <div>
                                <span className="block text-xs text-white/50 font-bold uppercase tracking-widest mb-3">Online Friends</span>
                                <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                                    {mockFriends.map(friend => (
                                        <div key={friend.id} className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/10">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center font-bold text-white shadow-inner">
                                                    {friend.name[0]}
                                                </div>
                                                <div>
                                                    <span className="block text-sm font-bold text-white">{friend.name}</span>
                                                    <span className={`block text-[10px] uppercase font-bold tracking-widest ${friend.status === 'online' ? 'text-green-400' : 'text-amber-400'}`}>
                                                        {friend.status}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold text-white transition-colors">DM</button>
                                                <button className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-bold text-white shadow-lg transition-colors">Invite</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="join"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="space-y-8"
                        >
                            <div className="text-center space-y-4">
                                <span className="block text-sm text-white/70 font-bold">Have a room code?</span>
                                <input
                                    type="text"
                                    placeholder="ENTER CODE"
                                    value={roomCode}
                                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                    className="w-full bg-black/40 text-center text-3xl font-mono text-white placeholder-white/20 px-6 py-4 rounded-3xl border border-white/10 focus:border-purple-500/50 focus:outline-none focus:ring-2 focus:ring-purple-500/20 uppercase tracking-widest transition-all"
                                    maxLength={6}
                                />
                            </div>
                            <button
                                onClick={() => onJoin(roomCode)}
                                disabled={roomCode.length < 3}
                                className="w-full py-5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black italic tracking-tighter rounded-[24px] shadow-[0_0_30px_rgba(176,38,255,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xl"
                            >
                                JOIN GAME
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};
