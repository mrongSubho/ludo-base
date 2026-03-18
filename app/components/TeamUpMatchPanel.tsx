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

// --- ICONS & ASSETS ---
const LudoTokenIcon = ({ className, color = "currentColor", wireframe = false }: { className?: string; color?: string; wireframe?: boolean }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="45" stroke={color} strokeWidth={wireframe ? "2" : "0"} fill={wireframe ? "none" : color} fillOpacity={wireframe ? "0" : "1"} />
        <circle cx="50" cy="50" r="30" stroke={color} strokeWidth="2" strokeDasharray={wireframe ? "4 4" : "0"} />
        <path d="M50 20V80M20 50H80" stroke={color} strokeWidth="2" strokeLinecap="round" opacity={wireframe ? "0.3" : "0.5"} />
    </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

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
            {/* Darkened Blurry Background - Standard Z-index and backdrop-blur */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md"
                onClick={onClose}
            />

            {/* Tactical Console Container - Re-synced with HeaderNav/Footer Offsets */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-3xl z-[110] flex flex-col items-center bg-slate-900/40 backdrop-blur-2xl border border-white/10 rounded-[40px] p-8 shadow-2xl overflow-hidden"
            >

                {/* Close Button Top Right */}
                <button onClick={onClose} className="absolute top-6 right-8 text-white/40 hover:text-white transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-6 h-6"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>

                {/* Top System Status Text */}
                <div className="text-center mb-6 flex flex-col gap-1">
                    <span className="text-[10px] font-black tracking-[0.3em] text-cyan-400 uppercase drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
                        Matchmaking Table: Linked
                    </span>
                    <span className="text-[10px] font-black tracking-[0.3em] text-white/50 uppercase cursor-pointer hover:text-white transition-colors" onClick={() => { playSelect(); navigator.clipboard.writeText(currentRoomId); }}>
                        Room_ID: {currentRoomId || '000000'} // Tap to Copy
                    </span>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 w-full flex flex-col overflow-hidden">
                    <AnimatePresence mode="wait">
                        {view === 'console' && (
                            <motion.div 
                                key="console"
                                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                className="flex-1 flex flex-col"
                            >
                                {/* Main 1x2 Tactical Grid */}
                                <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 items-center">

                                    {/* LEFT POD: COMMANDER (HOST) */}
                                    <div className="flex flex-col items-center p-8 rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-lg shadow-2xl relative">
                                        {/* VIP Marker: Golden Token */}
                                        <div className="absolute top-4 right-4 w-7 h-7 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]">
                                            <LudoTokenIcon color="#f59e0b" className="w-full h-full" />
                                        </div>

                                        <div className="absolute -top-4 bg-slate-900 border border-amber-500/50 px-6 py-1.5 rounded-full shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                                            <span className="text-[10px] text-amber-500 font-black tracking-widest uppercase">Commander</span>
                                        </div>

                                        <div className="relative w-32 h-32 flex items-center justify-center mt-2 mb-4">
                                            <DashedRadarRing color="#f59e0b" />
                                            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-white/20 bg-slate-800 relative z-10">
                                                {lobbyState?.slots[0]?.playerAvatar ? (
                                                    <img src={lobbyState.slots[0].playerAvatar} alt="host" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-4xl font-black text-white/30 truncate uppercase">
                                                        {(lobbyState?.slots[0]?.playerName?.[0] || 'H')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="text-center">
                                            <span className="block text-xl font-black text-white italic uppercase tracking-tighter truncate max-w-[200px] mb-1">
                                                {lobbyState?.slots[0]?.playerName || 'HOST_USER'}
                                            </span>
                                            <span className="text-[10px] font-bold text-cyan-400/60 tracking-[0.2em] uppercase">LEVEL 42 • READY</span>
                                        </div>
                                    </div>

                                    {/* RIGHT POD: VACANT / TEAMMATE */}
                                    <div className="h-full">
                                        {!lobbyState?.slots.find(s => s.role === 'opponent' && s.status === 'joined') ? (
                                            <div
                                                onClick={() => { playSelect(); setView('roster'); }}
                                                className="flex h-full flex-col items-center justify-center p-8 rounded-[2.5rem] bg-white/5 border border-white/10 hover:border-purple-500/50 hover:bg-white/10 backdrop-blur-lg shadow-2xl relative cursor-pointer group transition-all"
                                            >
                                                <div className="absolute -top-4 bg-slate-900 border border-white/20 group-hover:border-purple-500/50 px-6 py-1.5 rounded-full transition-colors">
                                                    <span className="text-[10px] text-white/50 group-hover:text-purple-400 font-black tracking-widest uppercase transition-colors">Vacant Seat</span>
                                                </div>

                                                <div className="relative w-32 h-32 flex items-center justify-center mt-2 mb-4">
                                                    <DashedRadarRing color="#a855f7" />
                                                    <div className="w-12 h-12 flex items-center justify-center rounded-full bg-white/5 group-hover:bg-purple-500/20 group-hover:scale-110 transition-all">
                                                        <PlusIcon className="w-6 h-6 text-white/30 group-hover:text-purple-400" />
                                                    </div>
                                                </div>

                                                <div className="text-center">
                                                    <span className="block text-sm font-black text-white/50 group-hover:text-purple-400 italic uppercase tracking-widest mb-1 transition-colors">
                                                        Awaiting Teammate
                                                    </span>
                                                    <span className="text-[10px] font-bold text-white/30 tracking-[0.2em] uppercase">Tap to invite friends</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center p-8 rounded-[2.5rem] bg-white/5 border border-cyan-500/30 backdrop-blur-lg shadow-2xl relative h-full">
                                                <div className="absolute -top-4 bg-slate-900 border border-cyan-500/50 px-6 py-1.5 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                                                    <span className="text-[10px] text-cyan-400 font-black tracking-widest uppercase">Teammate</span>
                                                </div>

                                                <div className="relative w-32 h-32 flex items-center justify-center mt-2 mb-4">
                                                    <DashedRadarRing color="#22d3ee" />
                                                    <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-white/20 bg-slate-800 relative z-10">
                                                        {lobbyState.slots.find(s => s.role === 'opponent')?.playerAvatar ? (
                                                            <img src={lobbyState.slots.find(s => s.role === 'opponent')?.playerAvatar} alt="teammate" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-4xl font-black text-white/30 uppercase">
                                                                {(lobbyState.slots.find(s => s.role === 'opponent')?.playerName?.[0] || 'O')}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="text-center">
                                                    <span className="block text-xl font-black text-white italic uppercase tracking-tighter truncate max-w-[200px] mb-1">
                                                        {lobbyState.slots.find(s => s.role === 'opponent')?.playerName || 'TEAMMATE'}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-white/40 tracking-[0.2em] uppercase">LINK ESTABLISHED</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Parameters Pill */}
                                <div className="mt-8 mb-4 self-center bg-slate-900 border border-amber-500/30 px-8 py-2.5 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.1)]">
                                    <span className="text-sm font-black text-white italic tracking-widest uppercase drop-shadow-md">
                                        {activeParams.mode} <span className="text-white/20 mx-2">|</span> <span className="text-amber-400">{activeParams.wager} COINS</span>
                                    </span>
                                </div>
                                
                                <button onClick={() => setView('join')} className="self-center mt-2 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] hover:text-cyan-400 transition-colors">
                                    Manual Entry // Join Existing Room
                                </button>
                            </motion.div>
                        )}

                        {view === 'roster' && (
                            <motion.div
                                key="roster"
                                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                                className="flex-1 flex flex-col p-6 rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-lg shadow-2xl overflow-hidden"
                            >
                                <div className="flex justify-between items-center mb-6">
                                    <span className="text-xs font-black text-cyan-400 tracking-[0.2em] uppercase">Elite Roster Manifest</span>
                                    <button onClick={() => { playClick(); setView('console'); }} className="text-[10px] text-white/40 hover:text-white uppercase tracking-widest font-bold flex items-center gap-2">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg>
                                        RETURN
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar pb-8">
                                    {isLoadingFriends ? (
                                        <div className="h-full flex items-center justify-center"><div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" /></div>
                                    ) : (
                                        [...friendsData.gameFriends, ...friendsData.onchainFriends].length > 0 ? (
                                            [...friendsData.gameFriends, ...friendsData.onchainFriends].map((f, i) => (
                                                <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-cyan-400/30 transition-colors group">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center overflow-hidden border border-white/10">
                                                            {f.avatar_url ? <img src={f.avatar_url} className="w-full h-full object-cover" /> : <span className="text-white/40 font-bold">{f.username?.[0]}</span>}
                                                        </div>
                                                        <div>
                                                            <span className="block text-sm font-black italic text-white truncate max-w-[120px] uppercase tracking-tight">{f.username}</span>
                                                            <span className="text-[10px] text-emerald-400/60 tracking-widest uppercase font-black">ACTIVE_SIGNAL</span>
                                                        </div>
                                                    </div>
                                                    <button onClick={() => handleInvite(f)} className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-500 hover:text-white transition-all">
                                                        <PlusIcon className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="h-full flex flex-col items-center justify-center text-center opacity-20">
                                                <LudoTokenIcon className="w-16 h-16 mb-4" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.5em]">No Allies Online</span>
                                            </div>
                                        )
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {view === 'join' && (
                            <motion.div 
                                key="join"
                                initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }}
                                className="flex-1 flex flex-col justify-center px-8"
                            >
                                <div className="text-center space-y-8">
                                    <h3 className="text-sm font-black text-cyan-400 uppercase tracking-[0.5em]">System_Connect / Input Code</h3>
                                    <input
                                        type="text"
                                        placeholder="CODE"
                                        value={roomCode}
                                        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                        className="w-full bg-white/5 border-2 border-white/10 text-center text-6xl font-black italic tracking-tighter text-white py-10 rounded-[3rem] focus:outline-none focus:border-cyan-400/50 transition-all uppercase"
                                        maxLength={6}
                                    />
                                    <div className="flex flex-col gap-4">
                                        <button
                                            onClick={() => onJoin(roomCode)}
                                            disabled={roomCode.length < 3}
                                            className="w-full py-5 bg-white text-slate-900 text-2xl font-black italic tracking-tighter rounded-full shadow-xl hover:scale-105 active:scale-95 disabled:opacity-20 transition-all uppercase"
                                        >
                                            ESTABLISH_LINK
                                        </button>
                                        <button onClick={() => setView('console')} className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-white">
                                            Return to Console
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Bottom Action Section */}
                {view === 'console' && (
                    <div className="w-full max-w-md mt-6">
                        <motion.button
                            whileHover={isReady ? { scale: 1.02, y: -2 } : {}}
                            whileTap={isReady ? { scale: 0.98 } : {}}
                            onClick={() => {
                                if (isReady) {
                                    playDiceLand();
                                    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
                                    onStartMatch();
                                }
                            }}
                            disabled={!isReady}
                            className={`w-full py-5 rounded-[2rem] font-black italic tracking-widest text-xl uppercase transition-all duration-300 relative overflow-hidden border
                                ${isReady
                                    ? 'bg-white text-black shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)]'
                                    : 'bg-white/5 text-white/10 border-white/5 cursor-not-allowed'
                                }
                            `}
                        >
                            {isReady && (
                                <motion.div 
                                    className="absolute inset-0 bg-gradient-to-r from-transparent via-black/5 to-transparent"
                                    animate={{ x: ['-200%', '200%'] }}
                                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                />
                            )}
                            <span className="relative z-10">{isReady ? 'Commence Match' : 'Awaiting Allies...'}</span>
                        </motion.button>
                    </div>
                )}

            </motion.div>
        </>
    );
};