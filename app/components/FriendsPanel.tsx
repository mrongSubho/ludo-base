'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FriendsPanelProps {
    onClose: () => void;
}

type MainTab = 'game' | 'base' | 'requests';
type RequestTab = 'incoming' | 'sent';

// Define the mock friend interfaces
interface Friend {
    id: string;
    name: string;
    avatar: string;
    status: 'Online' | 'In Match' | 'Offline';
}

interface Request {
    id: string;
    name: string;
    avatar: string;
    time: string;
}

// ── Mock Data ──
const GAME_FRIENDS: Friend[] = [
    { id: '1', name: 'AlexD', avatar: '1', status: 'In Match' },
    { id: '2', name: 'Sarah_99', avatar: '2', status: 'Online' },
    { id: '3', name: 'MikePro', avatar: '5', status: 'Offline' },
    { id: '4', name: 'JenPlays', avatar: '4', status: 'Online' },
];

const BASE_FRIENDS: Friend[] = [
    { id: '5', name: 'Chris_H', avatar: '3', status: 'Online' },
    { id: '6', name: 'EmmaWin', avatar: '6', status: 'Offline' },
    { id: '7', name: 'DavidL', avatar: '7', status: 'In Match' },
];

const INCOMING_REQUESTS: Request[] = [
    { id: '8', name: 'TomRider', avatar: '8', time: '2h ago' },
    { id: '9', name: 'LisaFox', avatar: '2', time: '5h ago' },
];

const SENT_REQUESTS: Request[] = [
    { id: '10', name: 'SamNinja', avatar: '5', time: '1d ago' },
];

// SVG Icons
const DMIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
    </svg>
);

const AcceptIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-green-500">
        <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
);

const RejectIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-red-500">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
);


export default function FriendsPanel({ onClose }: FriendsPanelProps) {
    const [activeMainTab, setActiveMainTab] = useState<MainTab>('game');
    const [activeRequestTab, setActiveRequestTab] = useState<RequestTab>('incoming');

    // Renders the list items for Game/Base Friends
    const renderFriendList = (friends: Friend[]) => {
        if (friends.length === 0) {
            return <div className="text-center text-white/50 py-8 text-sm">No friends here yet.</div>;
        }

        return friends.map((friend) => (
            <div key={friend.id} className="flex items-center justify-between p-3 mb-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="relative w-12 h-12 rounded-full overflow-hidden bg-[#2a2d3e]">
                        <img src={`/avatars/${friend.avatar}.png`} alt={friend.name} className="w-full h-full object-cover" />
                        <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#1a1c29] 
              ${friend.status === 'Online' ? 'bg-green-500' : friend.status === 'In Match' ? 'bg-orange-500' : 'bg-gray-500'}`}
                        />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-white font-medium text-[15px]">{friend.name}</span>
                        <span className={`text-[12px] font-medium 
              ${friend.status === 'Online' ? 'text-green-400' : friend.status === 'In Match' ? 'text-orange-400' : 'text-white/40'}`}>
                            {friend.status}
                        </span>
                    </div>
                </div>

                <button className="w-10 h-10 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center hover:bg-indigo-500 hover:text-white transition-all shadow-sm">
                    <DMIcon />
                </button>
            </div>
        ));
    };

    // Renders the list items for Requests (Incoming / Sent)
    const renderRequestList = (requests: Request[], isIncoming: boolean) => {
        if (requests.length === 0) {
            return <div className="text-center text-white/50 py-8 text-sm">No pending requests.</div>;
        }

        return requests.map((req) => (
            <div key={req.id} className="flex items-center justify-between p-3 mb-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-[#2a2d3e]">
                        <img src={`/avatars/${req.avatar}.png`} alt={req.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-white font-medium text-[15px]">{req.name}</span>
                        <span className="text-[12px] text-white/40 font-medium">{req.time}</span>
                    </div>
                </div>

                {isIncoming ? (
                    <div className="flex items-center gap-2">
                        <button className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center hover:bg-green-500 hover:text-white transition-all">
                            <AcceptIcon />
                        </button>
                        <button className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all">
                            <RejectIcon />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <span className="text-[12px] text-white/50 pr-2">Pending</span>
                        <button className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all">
                            <RejectIcon />
                        </button>
                    </div>
                )}
            </div>
        ));
    };


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
                /* Specific transparent glass background applied here as requested (approx 15-20%) */
                className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] h-[85vh] bg-[#1a1c29]/20 backdrop-blur-xl border-t border-white/10 rounded-t-[32px] z-50 flex flex-col shadow-2xl"
            >
                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header & Main Tabs */}
                <div className="px-6 pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mb-6 mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-indigo-400">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            Friends
                        </h2>
                        <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition-colors">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>

                    {/* Top-Level Segmented Control */}
                    <div className="flex bg-black/40 p-1 rounded-xl">
                        <button
                            className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'game' ? 'bg-indigo-600 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
                            onClick={() => setActiveMainTab('game')}
                        >
                            Game Friends
                        </button>
                        <button
                            className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'base' ? 'bg-indigo-600 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
                            onClick={() => setActiveMainTab('base')}
                        >
                            Base Friends
                        </button>
                        <button
                            className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'requests' ? 'bg-indigo-600 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
                            onClick={() => setActiveMainTab('requests')}
                        >
                            Requests
                        </button>
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    <AnimatePresence mode="wait">

                        {activeMainTab === 'game' && (
                            <motion.div key="game" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="pb-20">
                                <div className="px-2 pb-2 text-[12px] font-bold text-white/40 uppercase tracking-wider">
                                    Game Friends ({GAME_FRIENDS.length})
                                </div>
                                {renderFriendList(GAME_FRIENDS)}
                            </motion.div>
                        )}

                        {activeMainTab === 'base' && (
                            <motion.div key="base" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="pb-20">
                                <div className="px-2 pb-2 text-[12px] font-bold text-white/40 uppercase tracking-wider">
                                    Base Friends ({BASE_FRIENDS.length})
                                </div>
                                {renderFriendList(BASE_FRIENDS)}
                            </motion.div>
                        )}

                        {activeMainTab === 'requests' && (
                            <motion.div key="req" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="pb-20">

                                {/* Secondary Tab Switcher inside Requests */}
                                <div className="flex gap-4 mb-4 border-b border-white/5 px-2">
                                    <button
                                        className={`pb-3 text-sm font-semibold transition-colors relative ${activeRequestTab === 'incoming' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                                        onClick={() => setActiveRequestTab('incoming')}
                                    >
                                        Incoming ({INCOMING_REQUESTS.length})
                                        {activeRequestTab === 'incoming' && (
                                            <motion.div layoutId="reqTabUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />
                                        )}
                                    </button>
                                    <button
                                        className={`pb-3 text-sm font-semibold transition-colors relative ${activeRequestTab === 'sent' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                                        onClick={() => setActiveRequestTab('sent')}
                                    >
                                        Sent ({SENT_REQUESTS.length})
                                        {activeRequestTab === 'sent' && (
                                            <motion.div layoutId="reqTabUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />
                                        )}
                                    </button>
                                </div>

                                <div className="mt-2">
                                    {activeRequestTab === 'incoming'
                                        ? renderRequestList(INCOMING_REQUESTS, true)
                                        : renderRequestList(SENT_REQUESTS, false)
                                    }
                                </div>

                            </motion.div>
                        )}

                    </AnimatePresence>
                </div>

            </motion.div>
        </>
    );
}
