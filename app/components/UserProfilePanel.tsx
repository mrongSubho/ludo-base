'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const AVATARS = ['🎮', '👾', '🦊', '🦁', '🐉', '🤖', '💀', '👽'];

export default function UserProfilePanel({ onClose }: { onClose: () => void }) {
    const [name, setName] = useState('Player');
    const [avatarIndex, setAvatarIndex] = useState(0);
    const [isPublic, setIsPublic] = useState(true);
    const [allowRequests, setAllowRequests] = useState(true);

    // Animate the donut chart on mount
    const [chartProgress, setChartProgress] = useState(0);
    useEffect(() => {
        const timer = setTimeout(() => setChartProgress(78), 200); // 78% win rate
        return () => clearTimeout(timer);
    }, []);

    const handleAvatarCycle = () => {
        setAvatarIndex((prev) => (prev + 1) % AVATARS.length);
    };

    const currentAvatar = AVATARS[avatarIndex];

    // Calculate SVG stroke offset for the 78% chart
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (chartProgress / 100) * circumference;

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
                /* Specific transparent glass background applied here to match FriendsPanel (approx 20%) */
                className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] h-[85vh] bg-[#1a1c29]/20 backdrop-blur-xl border-t border-white/10 rounded-t-[32px] z-50 flex flex-col shadow-2xl"
            >
                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-6 pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-indigo-400">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            Profile
                        </h2>
                        <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition-colors">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6 pb-safe-footer">

                    {/* Identity Section */}
                    <div className="flex flex-col items-center bg-white/5 border border-white/10 rounded-2xl p-6 relative">
                        <div
                            className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-500 to-teal-400 p-1 cursor-pointer hover:scale-105 transition-transform flex items-center justify-center text-4xl mb-4 relative shadow-lg"
                            onClick={handleAvatarCycle}
                            title="Click to change Avatar"
                        >
                            <div className="w-full h-full bg-[#1a1c29] rounded-full flex items-center justify-center">
                                {currentAvatar}
                            </div>
                            <div className="absolute bottom-0 right-0 w-7 h-7 bg-indigo-500 rounded-full border-2 border-[#1a1c29] flex items-center justify-center text-white">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                                </svg>
                            </div>
                        </div>

                        <div className="flex flex-col items-center w-full max-w-[200px]">
                            <input
                                type="text"
                                className="w-full bg-transparent text-center text-2xl font-bold text-white focus:outline-none focus:bg-white/5 rounded-lg py-1 transition-colors"
                                value={name}
                                onChange={(e) => setName(e.target.value.slice(0, 12))}
                                maxLength={12}
                            />
                            <div className="flex items-center gap-2 mt-2 bg-black/40 px-3 py-1 rounded-full border border-white/10">
                                <span className="text-[11px] font-extrabold uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-gray-300 to-slate-400">Silver II</span>
                                <div className="w-1 h-1 bg-white/30 rounded-full" />
                                <span className="text-[11px] text-white/70 font-bold">Lv. 8</span>
                            </div>
                        </div>
                    </div>

                    {/* Stats Section with Chart */}
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-wider mb-3 px-2">Performance</h3>
                        <div className="grid grid-cols-2 gap-3">

                            {/* Chart Card */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center col-span-1">
                                <div className="relative w-[90px] h-[90px]">
                                    <svg className="w-full h-full" viewBox="0 0 90 90">
                                        <circle cx="45" cy="45" r={radius} strokeWidth="8" className="stroke-white/10 fill-none" />
                                        <circle
                                            cx="45" cy="45" r={radius}
                                            strokeWidth="8"
                                            strokeDasharray={circumference}
                                            strokeDashoffset={strokeDashoffset}
                                            className="stroke-indigo-500 fill-none transition-all duration-1000 ease-out"
                                            strokeLinecap="round"
                                            transform="rotate(-90 45 45)"
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-xl font-black text-white">{chartProgress}%</span>
                                        <span className="text-[9px] font-bold text-indigo-400 tracking-wider">WIN</span>
                                    </div>
                                </div>
                            </div>

                            {/* Stats Mini Cards Grid */}
                            <div className="flex flex-col gap-2 col-span-1">
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col justify-center flex-1">
                                    <span className="text-lg font-bold text-white">42</span>
                                    <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Total Wins</span>
                                </div>
                                <div className="flex gap-2 flex-1">
                                    <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col items-center justify-center flex-1">
                                        <span className="text-sm font-bold text-white">114</span>
                                        <span className="text-[9px] uppercase font-bold text-white/40">Matches</span>
                                    </div>
                                    <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-2 flex flex-col items-center justify-center flex-1">
                                        <span className="text-sm font-bold text-orange-400">3</span>
                                        <span className="text-[9px] uppercase font-bold text-orange-400/70">Streak</span>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>


                    {/* Privacy & Social Controls */}
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-wider mb-3 px-2">Privacy</h3>

                        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                            <div className="flex items-center justify-between p-4 border-b border-white/5">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                            <circle cx="12" cy="12" r="3"></circle>
                                        </svg>
                                    </div>
                                    <span className="text-sm font-medium text-white">Public Profile</span>
                                </div>
                                <button
                                    className={`w-12 h-6 rounded-full p-1 transition-colors relative ${isPublic ? 'bg-indigo-500' : 'bg-white/10'}`}
                                    onClick={() => setIsPublic(!isPublic)}
                                >
                                    <motion.div
                                        layout
                                        className="w-4 h-4 bg-white rounded-full shadow-sm"
                                        animate={{ x: isPublic ? 24 : 0 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    />
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                            <circle cx="8.5" cy="7" r="4"></circle>
                                            <line x1="20" y1="8" x2="20" y2="14"></line>
                                            <line x1="23" y1="11" x2="17" y2="11"></line>
                                        </svg>
                                    </div>
                                    <span className="text-sm font-medium text-white">Allow Requests</span>
                                </div>
                                <button
                                    className={`w-12 h-6 rounded-full p-1 transition-colors relative ${allowRequests ? 'bg-teal-500' : 'bg-white/10'}`}
                                    onClick={() => setAllowRequests(!allowRequests)}
                                >
                                    <motion.div
                                        layout
                                        className="w-4 h-4 bg-white rounded-full shadow-sm"
                                        animate={{ x: allowRequests ? 24 : 0 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    />
                                </button>
                            </div>
                        </div>

                    </div>

                </div>

            </motion.div>
        </>
    );
}
