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

// --- ICONS ---
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
    currentRoomId,
    lobbyState,
    onStartMatch,
    onSendInvite,
}: TeamUpMatchPanelProps) => {
    const { playSelect, playClick, playDiceLand } = useSoundEffects();
    const [view, setView] = useState<'console' | 'roster' | 'join'>('console');
    const [roomCode, setRoomCode] = useState('');

    const { friends: friendsData, isBooting: isLoadingFriends } = useGameData();
    const isReady = lobbyState ? canStartMatch(lobbyState) : false;

    // Data Mapping
    const hostSlot = lobbyState?.slots[0];
    const teammateSlot = lobbyState?.slots.find(s => s.role === 'opponent' && s.status === 'joined');
    const invitationPending = lobbyState?.slots.some(s => s.status === 'invited');

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
            {/* Blurring Overlay */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md"
                onClick={onClose}
            />

            {/* Main Panel Container - Standard max-w-[440px] and top/bottom offsets */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[440px] z-[110] flex flex-col items-center bg-slate-900/40 backdrop-blur-2xl border border-white/10 rounded-[40px] p-8 shadow-2xl overflow-hidden"
            >

                {/* Close Button Top Right */}
                <button onClick={onClose} className="absolute top-6 right-8 text-white/40 hover:text-white transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-6 h-6"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>

                {/* UI Status & Room Info */}
                <div className="text-center mb-6 pointer-events-none">
                    <span className="text-[10px] font-black tracking-[0.3em] text-cyan-400 uppercase drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
                        Lobby Connection: Established
                    </span>
                    <button 
                        onClick={(e) => { e.stopPropagation(); playSelect(); navigator.clipboard.writeText(currentRoomId); }}
                        className="pointer-events-auto block text-[10px] font-black tracking-[0.2em] text-white/40 uppercase mt-1 hover:text-white transition-colors"
                    >
                        Room_ID: {currentRoomId || '------'} // Tap to Copy
                    </button>
                </div>

                {/* Core Context View */}
                <div className="flex-1 w-full flex flex-col overflow-hidden">
                    <AnimatePresence mode="wait">
                        {view === 'console' && (
                            <motion.div 
                                key="console"
                                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                className="flex-1 flex flex-col gap-4"
                            >
                                {/* Host / Commander Pod */}
                                <div className="flex flex-col items-center p-6 rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-lg relative shrink-0">
                                    <div className="absolute top-4 right-4 w-6 h-6 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]">
                                        <LudoTokenIcon color="#f59e0b" className="w-full h-full" />
                                    </div>
                                    <div className="absolute -top-3 bg-slate-900 border border-amber-500/50 px-5 py-1 rounded-full shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                                        <span className="text-[9px] text-amber-500 font-black tracking-[0.2em] uppercase">Commander</span>
                                    </div>

                                    <div className="relative w-28 h-28 flex items-center justify-center mb-3">
                                        <DashedRadarRing color="#f59e0b" />
                                        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-white/20 bg-slate-800 relative z-10">
                                            {hostSlot?.playerAvatar ? (
                                                <img src={hostSlot.playerAvatar} alt="host" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-3xl font-black text-white/20 uppercase">
                                                    {hostSlot?.playerName?.[0] || 'H'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-lg font-black text-white italic truncate max-w-[180px] uppercase tracking-tight">
                                        {hostSlot?.playerName || 'HOST_PLAYER'}
                                    </span>
                                </div>

                                {/* Teammate / Vacant Pod */}
                                <div className="flex-1 min-h-[160px]">
                                    {teammateSlot ? (
                                        <motion.div 
                                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                                            className="h-full flex flex-col items-center justify-center p-6 rounded-[2.5rem] bg-white/5 border border-cyan-500/30 backdrop-blur-lg relative"
                                        >
                                            <div className="absolute -top-3 bg-slate-900 border border-cyan-500/50 px-5 py-1 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                                                <span className="text-[9px] text-cyan-400 font-black tracking-[0.2em] uppercase">Teammate</span>
                                            </div>
                                            <div className="relative w-24 h-24 flex items-center justify-center mb-3">
                                                <DashedRadarRing color="#22d3ee" />
                                                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white/20 bg-slate-800 relative z-10">
                                                    {teammateSlot.playerAvatar ? (
                                                        <img src={teammateSlot.playerAvatar} alt="teammate" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-2xl font-black text-white/20 uppercase">
                                                            {teammateSlot.playerName?.[0] || 'T'}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="text-md font-black text-white italic truncate max-w-[180px] uppercase tracking-tight">
                                                {teammateSlot.playerName}
                                            </span>
                                            <span className="text-[9px] font-bold text-cyan-400 tracking-[0.2em] uppercase mt-1">LINK_ESTABLISHED</span>
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            onClick={() => { playSelect(); setView('roster'); }}
                                            className="h-full flex flex-col items-center justify-center p-6 rounded-[2.5rem] bg-white/5 border-2 border-dashed border-white/10 hover:border-purple-500/50 hover:bg-white/10 transition-all cursor-pointer group relative"
                                        >
                                            <div className="absolute -top-3 bg-slate-900 border border-white/20 group-hover:border-purple-500/50 px-5 py-1 rounded-full transition-colors">
                                                <span className="text-[9px] text-white/40 group-hover:text-purple-400 font-black tracking-[0.2em] uppercase">Vacant Pod</span>
                                            </div>
                                            <div className="relative w-20 h-20 flex items-center justify-center mb-3">
                                                <DashedRadarRing color="#a855f7" />
                                                <PlusIcon className="w-8 h-8 text-white/20 group-hover:text-purple-400 group-hover:scale-110 transition-all z-10" />
                                            </div>
                                            <span className="text-sm font-black text-white/30 group-hover:text-purple-400 italic uppercase tracking-[0.1em] transition-all">
                                                {invitationPending ? 'SIGNAL_BROADCASTING...' : 'SUMMON REINFORCEMENTS'}
                                            </span>
                                        </motion.div>
                                    )}
                                </div>

                                <button onClick={() => setView('join')} className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-cyan-400 mt-2 transition-colors self-center">
                                    Manual Link // Session Code
                                </button>
                            </motion.div>
                        )}

                        {view === 'roster' && (
                            <motion.div
                                key="roster"
                                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                                className="flex-1 flex flex-col p-6 rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-lg overflow-hidden"
                            >
                                <div className="flex justify-between items-center mb-6">
                                    <span className="text-[10px] font-black text-cyan-400 tracking-[0.2em] uppercase">Roster Manifest</span>
                                    <button onClick={() => { playClick(); setView('console'); }} className="text-[9px] text-white/40 hover:text-white uppercase font-black flex items-center gap-2">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg>
                                        RETURN
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar pb-4">
                                    {isLoadingFriends ? (
                                        <div className="h-full flex items-center justify-center opacity-30"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>
                                    ) : (
                                        [...friendsData.gameFriends, ...friendsData.onchainFriends].length > 0 ? (
                                            [...friendsData.gameFriends, ...friendsData.onchainFriends].map((f, i) => (
                                                <div key={i} className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-cyan-500/30 transition-colors group">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-slate-800 rounded-xl overflow-hidden border border-white/10">
                                                            {f.avatar_url ? <img src={f.avatar_url} className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center text-white/30 font-bold">{f.username?.[0]}</span>}
                                                        </div>
                                                        <div>
                                                            <span className="block text-xs font-black italic text-white leading-tight uppercase truncate max-w-[100px]">{f.username}</span>
                                                            <span className="text-[8px] text-emerald-400 font-bold tracking-widest uppercase">ENCRYPTED_ID</span>
                                                        </div>
                                                    </div>
                                                    <button onClick={() => handleInvite(f)} className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-500 hover:text-white transition-all">
                                                        <PlusIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="h-full flex flex-col items-center justify-center opacity-10 text-center">
                                                <LudoTokenIcon className="w-12 h-12 mb-4" />
                                                <span className="text-[9px] font-black uppercase tracking-[0.4em]">Grid Empty</span>
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
                                className="flex-1 flex flex-col justify-center px-4"
                            >
                                <div className="text-center space-y-6">
                                    <h3 className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.3em]">Establish Remote Link</h3>
                                    <input
                                        type="text"
                                        placeholder="CODE"
                                        value={roomCode}
                                        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                        className="w-full bg-white/5 border-2 border-white/10 text-center text-5xl font-black italic tracking-tighter text-white py-8 rounded-[2.5rem] focus:outline-none focus:border-cyan-400 transition-all uppercase"
                                        maxLength={6}
                                    />
                                    <div className="flex flex-col gap-3">
                                        <button
                                            onClick={() => onJoin(roomCode)}
                                            disabled={roomCode.length < 3}
                                            className="w-full py-4 bg-white text-slate-900 text-xl font-black italic tracking-tighter rounded-full shadow-xl hover:scale-105 active:scale-95 disabled:opacity-20 transition-all uppercase"
                                        >
                                            Infiltrate Lobby
                                        </button>
                                        <button onClick={() => setView('console')} className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-white">
                                            Cancel Operation
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Tactical HUD Footer */}
                <div className="w-full mt-6 space-y-4">
                    <div className="bg-slate-900/60 border border-amber-500/30 px-6 py-2 rounded-full flex items-center justify-between">
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Protocol: <span className="text-white">{activeParams.mode}</span></span>
                        <div className="w-1 h-3 bg-white/10 rounded-full" />
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Wager: <span className="text-amber-400">{activeParams.wager}</span></span>
                    </div>

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
                        className={`w-full py-5 rounded-[2rem] font-black italic tracking-widest text-lg uppercase transition-all duration-300 relative overflow-hidden border
                            ${isReady 
                                ? 'bg-white text-slate-950 shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)]' 
                                : 'bg-white/5 text-white/10 border-white/5 cursor-not-allowed'
                            }
                        `}
                    >
                        {isReady ? 'Commence Operation' : 'Awaiting Signals...'}
                    </motion.button>
                </div>

            </motion.div>
        </>
    );
};