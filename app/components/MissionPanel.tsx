'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type MissionTab = 'daily' | 'weekly';

interface Mission {
    id: string;
    type: 'play' | 'win' | 'streak' | 'social';
    title: string;
    description: string;
    target: number;
    current: number;
    rewardType: 'coins' | 'gems';
    rewardAmount: number;
}

interface MissionPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function MissionPanel({ isOpen, onClose }: MissionPanelProps) {
    const [activeTab, setActiveTab] = useState<MissionTab>('daily');

    // MOCK DATA: Interactive Missions
    const getMissions = (tab: MissionTab): Mission[] => {
        if (tab === 'daily') {
            return [
                { id: 'd1', type: 'play', title: 'Warm Up', description: 'Play 3 classic matches.', target: 3, current: 3, rewardType: 'coins', rewardAmount: 500 },
                { id: 'd2', type: 'win', title: 'Champion', description: 'Win 2 matches in any mode.', target: 2, current: 1, rewardType: 'gems', rewardAmount: 5 },
                { id: 'd3', type: 'social', title: 'Friendly Fire', description: 'Send a match invite to a friend.', target: 1, current: 0, rewardType: 'coins', rewardAmount: 200 }
            ];
        } else {
            return [
                { id: 'w1', type: 'streak', title: 'Unstoppable', description: 'Achieve a 5-win streak.', target: 5, current: 2, rewardType: 'gems', rewardAmount: 50 },
                { id: 'w2', type: 'play', title: 'Marathon', description: 'Play 50 total matches.', target: 50, current: 28, rewardType: 'coins', rewardAmount: 5000 },
                { id: 'w3', type: 'win', title: 'Dominator', description: 'Eliminate 100 opponent tokens.', target: 100, current: 100, rewardType: 'gems', rewardAmount: 20 }
            ];
        }
    };

    const missions = getMissions(activeTab);

    // Helpers for rendering aesthetic badges
    const getTypeBadge = (type: Mission['type']) => {
        switch (type) {
            case 'play': return {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M7 7h.01"></path><path d="M17 7h.01"></path><path d="M12 12h.01"></path><path d="M7 17h.01"></path><path d="M17 17h.01"></path></svg>,
                color: 'text-blue-400',
                bg: 'bg-blue-500/20'
            };
            case 'win': return {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v6a5 5 0 0 1-10 0V4"></path><path d="M3 5h4v4A5 5 0 0 1 3 5"></path><path d="M21 5h-4v4a5 5 0 0 0 4-4"></path></svg>,
                color: 'text-yellow-400',
                bg: 'bg-yellow-500/20'
            };
            case 'streak': return {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]"><path d="M17 10C15 8 13.97 3 13.97 3 10 5.25 10 10 10 10c-3-2-2.5-6.5-2.5-6.5C4 6.5 4 11 4 14a8 8 0 0 0 16 0c0-2.5-1.5-4-3-4z"></path></svg>,
                color: 'text-orange-400',
                bg: 'bg-orange-500/20'
            };
            case 'social': return {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>,
                color: 'text-indigo-400',
                bg: 'bg-indigo-500/20'
            };
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
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
                        {/* Drag Handle */}
                        <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        {/* Header Section */}
                        <div className="px-4 pb-4 border-b border-white/10">
                            <div className="flex items-center justify-between mb-6 mt-2">
                                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-teal-400">
                                        <circle cx="12" cy="12" r="10" />
                                        <circle cx="12" cy="12" r="6" />
                                        <circle cx="12" cy="12" r="2" />
                                    </svg>
                                    Missions
                                </h2>
                                <button
                                    onClick={onClose}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            {/* Standard Pill Switcher */}
                            <div className="flex bg-black/30 p-1.5 rounded-2xl w-full max-w-sm mx-auto self-center">
                                {['daily', 'weekly'].map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab as MissionTab)}
                                        className={`flex-1 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl transition-all ${activeTab === tab
                                            ? 'bg-blue-600/80 text-white shadow-lg border border-blue-500/30'
                                            : 'text-white/40 hover:text-white/70'
                                            }`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Missions Content */}
                        <div className="flex-1 overflow-y-auto pt-4 px-safe custom-scrollbar relative">
                            {missions.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-60">
                                    <span className="text-6xl mb-4">✨</span>
                                    <h3 className="text-xl font-bold text-white mb-2">All Caught Up!</h3>
                                    <p className="text-sm text-white/60">Check back later for new missions.</p>
                                </div>
                            ) : (
                                <div className="space-y-4 pb-safe-footer">
                                    <AnimatePresence mode="popLayout">
                                        {missions.map((mission) => {
                                            const isCompleted = mission.current >= mission.target;
                                            const progressPercent = Math.min((mission.current / mission.target) * 100, 100);
                                            const badge = getTypeBadge(mission.type);

                                            return (
                                                <motion.div
                                                    layout
                                                    initial={{ opacity: 0, scale: 0.95 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    key={mission.id}
                                                    className="flex flex-col gap-3 bg-white/5 border border-white/10 p-4 rounded-2xl hover:bg-white/10 transition-colors relative overflow-hidden group"
                                                >
                                                    {/* Background Glow for completed missions */}
                                                    {isCompleted && (
                                                        <div className="absolute inset-0 bg-green-500/5 opacity-50 blur-xl pointer-events-none" />
                                                    )}

                                                    <div className="flex items-start gap-4">
                                                        {/* Icon Badge */}
                                                        <div className={`w-12 h-12 flex items-center justify-center rounded-2xl flex-shrink-0 ${badge.bg} ${badge.color} text-2xl shadow-inner border border-white/5`}>
                                                            {badge.icon}
                                                        </div>

                                                        {/* Mission Details */}
                                                        <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                                                            <div className="flex items-start justify-between gap-2">
                                                                <h3 className={`font-bold text-[15px] truncate ${isCompleted ? 'text-green-300' : 'text-white'}`}>
                                                                    {mission.title}
                                                                </h3>
                                                                {/* Reward Tag */}
                                                                <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5 flex-shrink-0">
                                                                    {mission.rewardType === 'coins' ? (
                                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-yellow-400">
                                                                            <circle cx="12" cy="12" r="8"></circle>
                                                                            <line x1="12" y1="8" x2="12" y2="16"></line>
                                                                            <path d="M16 12H8"></path>
                                                                        </svg>
                                                                    ) : (
                                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-cyan-400">
                                                                            <path d="M6 3h12l4 6-10 13L2 9z"></path>
                                                                            <path d="M11 3 8 9l4 13 4-13-3-6"></path>
                                                                        </svg>
                                                                    )}
                                                                    <span className={`text-[11px] font-black leading-none ${mission.rewardType === 'coins' ? 'text-yellow-400' : 'text-cyan-400'}`}>
                                                                        {mission.rewardAmount}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <p className="text-[11px] font-medium text-white/60 mt-1 leading-snug pr-2">
                                                                {mission.description}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Bottom Row: Progress Bar & Button */}
                                                    <div className="flex items-center gap-4 mt-1">
                                                        <div className="flex-1">
                                                            <div className="flex items-end justify-between mb-1.5 px-0.5">
                                                                <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Progress</span>
                                                                <span className={`text-xs font-black ${isCompleted ? 'text-green-400' : 'text-white'}`}>
                                                                    {mission.current} <span className="text-white/30 text-[10px]">/ {mission.target}</span>
                                                                </span>
                                                            </div>
                                                            {/* Custom CSS Progress Bar */}
                                                            <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                                                                <div
                                                                    className={`h-full rounded-full transition-all duration-1000 ease-out ${isCompleted ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-blue-500'}`}
                                                                    style={{ width: `${progressPercent}%` }}
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* Action Button */}
                                                        <button
                                                            className={`min-w-[70px] py-2 px-3 rounded-xl font-bold text-xs transition-all shadow-lg active:scale-95 flex items-center justify-center gap-1
                                                                ${isCompleted
                                                                    ? 'bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.2)]'
                                                                    : 'bg-white/10 text-white border border-white/10 hover:bg-white/20'
                                                                }
                                                            `}
                                                        >
                                                            {isCompleted ? (
                                                                <>
                                                                    Claim <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                                </>
                                                            ) : 'Go'}
                                                        </button>
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
