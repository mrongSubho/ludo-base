"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameData } from '@/hooks/GameDataContext';
import { LobbyState, LobbySlot } from '@/lib/types';
import { canStartMatch } from '@/lib/gameLogic';
import { useSoundEffects } from '../hooks/useSoundEffects';

interface TeamUpMatchPanelProps {
    onClose: () => void;
    onJoin: (code: string) => void;
    onHost: () => void;
    currentRoomId: string;
    isHost: boolean;
    isLobbyConnected: boolean;
    lobbyState: LobbyState | null;
    onStartMatch: () => void;
    onSwapPlayers: (indexA: number, indexB: number) => void;
    onKickPlayer: (slotIndex: number) => void;
    onSendInvite: (friendId: string, friendName?: string) => void;
    onQuickMatch: () => void;
}

// --- ROTATING RADAR RING SVG ---
const DashedRadarRing = ({ color = "#22d3ee", className = "" }) => (
    <motion.svg
        viewBox="0 0 100 100"
        className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
    >
        <circle cx="50" cy="50" r="48" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="8 6" opacity="0.6" />
        <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="0.5" opacity="0.2" />
    </motion.svg>
);

export const TeamUpMatchPanel = ({
    onClose,
    onJoin,
    onHost,
    currentRoomId,
    isHost,
    isLobbyConnected,
    lobbyState,
    onStartMatch,
    onKickPlayer,
    onSendInvite,
}: TeamUpMatchPanelProps) => {
    const { playSelect, playClick, playDiceLand } = useSoundEffects();
    const [view, setView] = useState<'console' | 'roster' | 'join'>('console');
    const [roomCode, setRoomCode] = useState('');

    const { friends: friendsData, isBooting: isLoadingFriends } = useGameData();
    const isReady = lobbyState ? canStartMatch(lobbyState) : false;

    const activeParams = {
        mode: lobbyState?.gameMode === 'power' ? 'POWER' : 'CLASSIC',
        wager: lobbyState?.entryFee?.toLocaleString() || '1,000,000',
    };

    const handleInvite = (friend: any) => {
        playSelect();
        onSendInvite(friend.wallet_address, friend.username);
        setView('console');
    };

    return (
        <>
            {/* Darkened Blurry Background */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md"
                onClick={onClose}
            />

            {/* Tactical Console Container */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-32px)] max-w-3xl z-[110] flex flex-col items-center"
            >

                {/* Close Button Top Right */}
                <button onClick={onClose} className="absolute -top-12 right-0 text-white/40 hover:text-white transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>

                {/* Top System Status Text */}
                <div className="text-center mb-8 flex flex-col gap-1">
                    <span className="text-[10px] font-black tracking-[0.3em] text-cyan-400 uppercase drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
                        System Link: Secured
                    </span>
                    <span className="text-[10px] font-black tracking-[0.3em] text-white/50 uppercase cursor-pointer hover:text-white transition-colors" onClick={() => { playSelect(); navigator.clipboard.writeText(currentRoomId); }}>
                        Room_ID: {currentRoomId || '000000'} // Tap to Copy
                    </span>
                </div>

                {/* Main 1x2 Tactical Grid */}
                <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 relative">

                    {/* LEFT POD: COMMANDER */}
                    <div className="flex flex-col items-center p-8 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-lg shadow-2xl relative">
                        {/* Floating Commander Pill */}
                        <div className="absolute -top-4 bg-slate-900 border border-amber-500/50 px-6 py-1.5 rounded-full shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                            <span className="text-[10px] text-amber-500 font-black tracking-widest uppercase">Commander</span>
                        </div>

                        {/* Radar Avatar */}
                        <div className="relative w-36 h-36 flex items-center justify-center mt-4 mb-6">
                            <DashedRadarRing color="#f59e0b" />
                            <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-white/20 bg-slate-800 relative z-10">
                                {lobbyState?.slots[0]?.playerAvatar ? (
                                    <img src={lobbyState.slots[0].playerAvatar} alt="host" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-5xl font-black text-white/30">H</div>
                                )}
                            </div>
                        </div>

                        {/* Player Info */}
                        <div className="text-center">
                            <span className="block text-xl font-black text-white italic uppercase tracking-tighter truncate max-w-[200px] mb-1">
                                {lobbyState?.slots[0]?.playerName || 'HOST_USER'}
                            </span>
                            <span className="text-[10px] font-bold text-white/40 tracking-[0.2em] uppercase">LVL 42 | 1240 WINS</span>
                        </div>
                    </div>

                    {/* RIGHT POD: VACANT / ROSTER */}
                    <AnimatePresence mode="wait">
                        {view === 'console' && !lobbyState?.slots.find(s => s.role === 'opponent' && s.status === 'joined') && (
                            <motion.div
                                key="vacant"
                                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                onClick={() => { playSelect(); setView('roster'); }}
                                className="flex flex-col items-center justify-center p-8 rounded-[2rem] bg-white/5 border border-white/10 hover:border-purple-500/50 hover:bg-white/10 backdrop-blur-lg shadow-2xl relative cursor-pointer group transition-all"
                            >
                                <div className="absolute -top-4 bg-slate-900 border border-white/20 group-hover:border-purple-500/50 px-6 py-1.5 rounded-full transition-colors">
                                    <span className="text-[10px] text-white/50 group-hover:text-purple-400 font-black tracking-widest uppercase transition-colors">Vacant Pod</span>
                                </div>

                                <div className="relative w-36 h-36 flex items-center justify-center mt-4 mb-6">
                                    <DashedRadarRing color="#a855f7" />
                                    <div className="w-12 h-12 flex items-center justify-center rounded-full bg-white/5 group-hover:bg-purple-500/20 group-hover:scale-110 transition-all">
                                        <PlusIcon className="w-6 h-6 text-white/30 group-hover:text-purple-400" />
                                    </div>
                                </div>

                                <div className="text-center">
                                    <span className="block text-sm font-black text-white/50 group-hover:text-purple-400 italic uppercase tracking-widest mb-1 transition-colors">
                                        Waiting for Signal
                                    </span>
                                    <span className="text-[10px] font-bold text-white/30 tracking-[0.2em] uppercase">Tap to open roster</span>
                                </div>
                            </motion.div>
                        )}

                        {view === 'console' && lobbyState?.slots.find(s => s.role === 'opponent' && s.status === 'joined') && (
                            <motion.div
                                key="occupied"
                                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                className="flex flex-col items-center p-8 rounded-[2rem] bg-white/5 border border-cyan-500/30 backdrop-blur-lg shadow-2xl relative"
                            >
                                <div className="absolute -top-4 bg-slate-900 border border-cyan-500/50 px-6 py-1.5 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                                    <span className="text-[10px] text-cyan-400 font-black tracking-widest uppercase">Teammate</span>
                                </div>

                                <div className="relative w-36 h-36 flex items-center justify-center mt-4 mb-6">
                                    <DashedRadarRing color="#22d3ee" />
                                    <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-white/20 bg-slate-800 relative z-10">
                                        {/* Inject opponent avatar here */}
                                        <div className="w-full h-full flex items-center justify-center text-5xl font-black text-white/30">O</div>
                                    </div>
                                </div>

                                <div className="text-center">
                                    <span className="block text-xl font-black text-white italic uppercase tracking-tighter truncate max-w-[200px] mb-1">
                                        TEAMMATE_01
                                    </span>
                                    <span className="text-[10px] font-bold text-white/40 tracking-[0.2em] uppercase">LINK ESTABLISHED</span>
                                </div>
                            </motion.div>
                        )}

                        {view === 'roster' && (
                            <motion.div
                                key="roster"
                                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                                className="flex flex-col p-6 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-lg shadow-2xl h-full min-h-[300px]"
                            >
                                <div className="flex justify-between items-center mb-4">
                                    <span className="text-xs font-black text-cyan-400 tracking-[0.2em] uppercase">Roster Manifest</span>
                                    <button onClick={() => { playClick(); setView('console'); }} className="text-[10px] text-white/40 hover:text-white uppercase tracking-widest font-bold">Close</button>
                                </div>
                                <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                                    {isLoadingFriends ? (
                                        <div className="h-full flex items-center justify-center"><div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" /></div>
                                    ) : (
                                        [...friendsData.gameFriends, ...friendsData.onchainFriends].map((f, i) => (
                                            <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:border-cyan-400/30 transition-colors group">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center overflow-hidden border border-white/10">
                                                        {f.avatar_url ? <img src={f.avatar_url} className="w-full h-full object-cover" /> : <span className="text-white/40 font-bold">{f.username?.[0]}</span>}
                                                    </div>
                                                    <div>
                                                        <span className="block text-sm font-black italic text-white truncate max-w-[100px]">{f.username}</span>
                                                        <span className="text-[9px] text-white/30 tracking-widest uppercase">SENSORS_ACTIVE</span>
                                                    </div>
                                                </div>
                                                <button onClick={() => handleInvite(f)} className="text-[10px] font-black text-cyan-400 hover:text-white bg-cyan-500/10 px-3 py-1.5 rounded border border-cyan-500/30 transition-colors">
                                                    Signal
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Floating Parameters Pill */}
                <div className="mt-8 mb-6 bg-slate-900 border border-amber-500/30 px-8 py-2.5 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.1)]">
                    <span className="text-sm font-black text-white italic tracking-widest uppercase drop-shadow-md">
                        {activeParams.mode} <span className="text-white/20 mx-2">|</span> <span className="text-amber-400">{activeParams.wager} COINS</span>
                    </span>
                </div>

                {/* Bottom Commence Button */}
                <div className="w-full max-w-md">
                    <motion.button
                        whileHover={isReady ? { scale: 1.02 } : {}}
                        whileTap={isReady ? { scale: 0.98 } : {}}
                        onClick={() => {
                            if (isReady) {
                                playDiceLand();
                                if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
                                onStartMatch();
                            }
                        }}
                        disabled={!isReady}
                        className={`w-full py-5 rounded-2xl font-black italic tracking-widest text-lg uppercase transition-all duration-300 relative overflow-hidden border
                            ${isReady
                                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-400/50 shadow-[0_0_30px_rgba(34,211,238,0.2)] hover:bg-cyan-400 hover:text-slate-900 hover:shadow-[0_0_40px_rgba(34,211,238,0.6)]'
                                : 'bg-white/5 text-white/20 border-white/10 cursor-not-allowed'
                            }
                        `}
                    >
                        {isReady ? 'Commence Encounter' : 'Awaiting Reinforcements...'}
                    </motion.button>
                </div>

                {/* Join Option Link */}
                {!isReady && view === 'console' && (
                    <button onClick={() => setView('join')} className="mt-6 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] hover:text-cyan-400 transition-colors">
                        Manual Entry // Join Existing Room
                    </button>
                )}

            </motion.div>
        </>
    );
};