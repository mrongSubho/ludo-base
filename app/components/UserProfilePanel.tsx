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
                /* Unified global panel layout: top-64, bottom-80, bg-20 glass */
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[468px] bg-[#1a1c29]/20 backdrop-blur-xl border border-white/10 rounded-[32px] z-[110] flex flex-col shadow-2xl overflow-hidden"
            >
                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-indigo-400">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            Profile
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

                    {/* Identity Section */}
                    <div className="flex flex-col items-center glass-card relative">
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

                    {/* Stats Section - Redesigned Performance */}
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-wider mb-3 px-2">Performance</h3>
                        <div className="space-y-3">

                            {/* Central Wins Hub */}
                            <div className="glass-card flex flex-col items-center justify-center py-8 relative overflow-hidden group">
                                {/* Background Decorations */}
                                <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 to-transparent opacity-50" />
                                <div className="absolute -top-10 -around-10 w-32 h-32 bg-indigo-500/20 blur-[60px] rounded-full group-hover:bg-indigo-500/30 transition-colors" />

                                <div className="relative z-10 flex flex-col items-center">
                                    <div className="mb-2 p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-indigo-400">
                                            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                                            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                                            <path d="M4 22h16"></path>
                                            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                                            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                                            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
                                        </svg>
                                    </div>
                                    <span className="text-5xl font-black text-white tracking-tighter mb-1 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">42</span>
                                    <span className="text-xs font-black uppercase tracking-[0.3em] text-indigo-400/80">Total Wins</span>
                                </div>
                            </div>

                            {/* Stats Row: Win Rate, Matches, Streak */}
                            <div className="grid grid-cols-3 gap-3">
                                {/* Win Rate Compact */}
                                <div className="glass-card-sm flex flex-col items-center justify-center !py-3">
                                    <div className="relative w-12 h-12 mb-2">
                                        <svg className="w-full h-full" viewBox="0 0 90 90">
                                            <circle cx="45" cy="45" r={radius} strokeWidth="12" className="stroke-white/5 fill-none" />
                                            <circle
                                                cx="45" cy="45" r={radius}
                                                strokeWidth="12"
                                                strokeDasharray={circumference}
                                                strokeDashoffset={strokeDashoffset}
                                                className="stroke-indigo-500 fill-none"
                                                strokeLinecap="round"
                                                transform="rotate(-90 45 45)"
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-[10px] font-black text-white">{chartProgress}%</span>
                                        </div>
                                    </div>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-white/30">Win Rate</span>
                                </div>

                                {/* Matches */}
                                <div className="glass-card-sm flex flex-col items-center justify-center !py-3">
                                    <span className="text-lg font-bold text-white mb-1">114</span>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-white/30">Matches</span>
                                </div>

                                {/* Streak */}
                                <div className="glass-card-sm flex flex-col items-center justify-center border-orange-500/20 !py-3">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-orange-500">
                                            <path d="M8.537 19.908c-.243-.07-.47-.17-.68-.3a3.35 3.35 0 0 0-1.036-.422 6.07 6.07 0 0 1-.351-.12.651.651 0 0 1-.41-.53.648.648 0 0 1 .42-.64c.05-.02.1-.03.15-.05.161-.05.322-.1.482-.16.141-.05.29-.11.43-.17.07-.03.14-.07.21-.11.131-.07.261-.15.392-.23a4.01 4.01 0 0 1 .632-.34c.15-.07.29-.14.43-.22.1-.06.2-.13.3-.2.07-.05.151-.101.221-.161l.03-.02a.65.65 0 0 1 .9 0 .638.638 0 0 1 .151.21.64.64 0 0 1-.03.62c-.01.02-.02.04-.04.06l-.01.02c-.08.1-.17.21-.26.3-.08.08-.15.17-.23.25a6.002 6.002 0 0 1-.68.61c-.08.06-.171.121-.261.181a4.8 4.8 0 0 1-.5.31c-.09.05-.181.1-.271.15-.12.06-.24.12-.361.18-.08.04-.15.08-.23.12-.04.02-.09.04-.131.06a3.352 3.352 0 0 0-.25.13l-.01.01a.633.633 0 0 1-.31.08Z" />
                                            <path d="M11.71 1.17a.64.64 0 0 0-.58.07c-2.85 2.1-4.13 5.4-3.15 8.71.07.24-.1.47-.32.49-1.29.13-2.5 1.05-3.08 2.27-1.12 2.37-.18 4.7 1.83 6.13a.64.64 0 0 0 .8-.09.64.64 0 0 0-.05-.91c-1.28-.99-1.89-2.57-1.42-3.8.31-.83 1.16-1.5 2.05-1.6.81-.1 1.55.57 1.55 1.38 0 .43-.2.83-.54 1.1a4.25 4.25 0 0 0-.67.65 3.39 3.39 0 0 0-.81 2.37c.07 1.89 1.63 3.42 3.52 3.48a3.55 3.55 0 0 0 3.65-3.54c.02-2.31-1.39-4.42-3.52-5.26-.22-.09-.32-.34-.21-.55.33-.65.23-1.42-.26-2.03-.52-.65-1.37-.89-2.1-.64.1-.38.25-.76.47-1.11.95-1.55 2.65-2.52 4.45-2.52.26 0 .52.02.77.06.26.04.49-.16.5-.42.06-1.39-.45-2.77-1.4-3.76a.63.63 0 0 0-.43-.19Z" />
                                        </svg>
                                        <span className="text-lg font-bold text-orange-500">3</span>
                                    </div>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-white/30">Streak</span>
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
