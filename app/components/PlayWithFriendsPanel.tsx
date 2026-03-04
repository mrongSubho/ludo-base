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
        <>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[468px] bg-[#1a1c29]/20 backdrop-blur-xl border border-white/10 rounded-[32px] z-[110] flex flex-col shadow-2xl overflow-hidden"
            >
                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2 cursor-pointer" onClick={onClose}>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-purple-400">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            Friends
                        </h2>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto px-panel-gutter py-4 space-y-6 custom-scrollbar">

                    {/* Custom Tabs */}
                    <div className="flex bg-white/5 rounded-full p-1 mb-2">
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
                                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 text-center shadow-inner">
                                    <span className="block text-xs text-white/50 font-bold uppercase tracking-widest mb-2">Room Code</span>
                                    <div className="flex items-center justify-center gap-4">
                                        <span className="text-4xl font-mono text-purple-400 font-bold tracking-widest bg-purple-500/10 px-4 py-2 rounded-xl border border-purple-500/20">A7X9K</span>
                                        <button className="p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors shrink-0 text-white shadow-sm" title="Copy Code">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <span className="block text-xs text-white/50 font-bold uppercase tracking-widest mb-3 px-2">Online Friends</span>
                                    <div className="space-y-2">
                                        {mockFriends.map(friend => (
                                            <div key={friend.id} className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/10 shadow-sm transition-all hover:bg-white/10">
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
                                                    <button className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-bold text-white shadow-[0_0_10px_rgba(176,38,255,0.4)] transition-colors">Invite</button>
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
                                className="space-y-8 mt-4"
                            >
                                <div className="text-center space-y-4">
                                    <span className="block text-sm text-white/70 font-bold uppercase tracking-widest">Have a room code?</span>
                                    <input
                                        type="text"
                                        placeholder="ENTER CODE"
                                        value={roomCode}
                                        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                        className="w-full bg-black/40 text-center text-3xl font-mono text-white placeholder-white/20 px-6 py-6 rounded-3xl border border-white/10 focus:border-purple-500/50 focus:outline-none focus:ring-2 focus:ring-purple-500/20 uppercase tracking-widest transition-all shadow-inner"
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
        </>
    );
};
