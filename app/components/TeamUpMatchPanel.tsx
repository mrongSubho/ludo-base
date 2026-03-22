"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameData } from '@/hooks/GameDataContext';
import { LobbyState, LobbySlot } from '@/lib/types';
import { canStartMatch } from '@/lib/gameLogic';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { FiX } from 'react-icons/fi';

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
    <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
    >
        <motion.svg
            viewBox="0 0 100 100"
            className="w-full h-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
            <circle cx="50" cy="50" r="48" fill="none" stroke={color} strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
            <circle cx="50" cy="50" r="38" fill="none" stroke={color} strokeWidth="0.5" strokeDasharray="2 2" opacity="0.2" />
            <circle cx="50" cy="50" r="28" fill="none" stroke={color} strokeWidth="0.5" opacity="0.1" />
        </motion.svg>
        
        {/* Scanning Sweep */}
        <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-500/10 to-transparent"
            style={{ clipPath: 'polygon(50% 50%, 100% 0, 100% 50%)' }}
        />
    </motion.div>
);

export const TeamUpMatchPanel = ({
    onClose,
    onJoin,
    currentRoomId,
    lobbyState,
    onStartMatch,
    onSendInvite,
    onQuickMatch,
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
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={onClose}
            />

            {/* Main Panel Container */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden pb-[40px]"
                        style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                    >
                        {/* Authentic Subdued Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        <div className="w-full flex justify-between items-center p-8 relative z-10">
                            <div>
                                <h3 className="text-white font-black italic text-3xl tracking-tighter uppercase">Team Up</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                                    <span className="text-[9px] font-black text-cyan-500 tracking-[0.2em] uppercase">Network: Ready</span>
                                </div>
                            </div>
                            <button 
                                onClick={onClose}
                                className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                            >
                                <FiX className="w-5 h-5" />
                            </button>
                        </div>

                        {/* UI Status & Room Info (Subdued) */}
                        <div className="px-8 mb-6 relative z-10 flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black tracking-[0.3em] text-white/30 uppercase">
                                    Lobby Connection
                                </span>
                                <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mt-0.5">Established</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); playSelect(); navigator.clipboard.writeText(currentRoomId); }}
                                className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-[10px] font-black tracking-[0.1em] text-white/60 uppercase hover:text-white transition-colors"
                            >
                                ID: {currentRoomId || '------'}
                            </button>
                        </div>

                        {/* Core Context View */}
                        <div className="flex-1 w-full flex flex-col overflow-hidden relative z-10">
                            {view === 'console' && (
                                <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-200 px-8">
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
                                            <div className="h-full flex flex-col items-center justify-center p-6 rounded-[2.5rem] bg-white/5 border border-cyan-500/30 backdrop-blur-lg relative animate-in zoom-in-95 duration-200">
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
                                            </div>
                                        ) : (
                                            <div
                                                onClick={() => { playSelect(); setView('roster'); }}
                                                className="h-full flex flex-col items-center justify-center p-6 rounded-[2.5rem] bg-white/5 border-2 border-dashed border-white/10 hover:border-cyan-500/50 hover:bg-white/10 transition-all cursor-pointer group relative"
                                            >
                                                <div className="absolute -top-3 bg-slate-900 border border-white/20 group-hover:border-cyan-500/50 px-5 py-1 rounded-full transition-colors">
                                                    <span className="text-[9px] text-white/40 group-hover:text-cyan-400 font-black tracking-[0.2em] uppercase">Vacant Pod</span>
                                                </div>
                                                <div className="relative w-20 h-20 flex items-center justify-center mb-3">
                                                    <DashedRadarRing color="#22d3ee" />
                                                    <PlusIcon className="w-8 h-8 text-white/20 group-hover:text-cyan-400 group-hover:scale-110 transition-all z-10" />
                                                </div>
                                                <span className="text-sm font-black text-white/30 group-hover:text-cyan-400 italic uppercase tracking-[0.1em] transition-all">
                                                    {invitationPending ? 'SIGNAL_BROADCASTING...' : 'SUMMON REINFORCEMENTS'}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Manual Link Label */}
                                    <button onClick={() => setView('join')} className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-cyan-400 mt-2 transition-colors self-center">
                                        Manual Link // Session Code
                                    </button>

                                    {/* Hybrid Quick Match Trigger */}
                                    {lobbyState && !isReady && (
                                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex flex-col items-center">
                                            <button onClick={(e) => { e.stopPropagation(); playSelect(); onQuickMatch(); }} className="text-[10px] font-black text-cyan-400/60 uppercase tracking-[0.2em] hover:text-cyan-400 transition-colors py-2 px-4 rounded-full border border-cyan-400/20 hover:border-cyan-400/50 bg-cyan-400/5">
                                                Fill Remaining with Quick Match
                                            </button>
                                        </motion.div>
                                    )}
                                </div>
                            )}

                            {view === 'roster' && (
                                <div className="flex-1 flex flex-col p-6 rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-lg overflow-hidden animate-in slide-in-from-right-4 duration-200 mx-8">
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
                                                                {f.avatar_url ? (
                                                                    <img src={f.avatar_url} alt="friend" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center text-white/20 font-black">{f.username[0]}</div>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-xs font-black text-white uppercase italic tracking-tight">{f.username}</span>
                                                                <span className="text-[8px] font-black text-white/30 uppercase tracking-widest">{f.status || 'OFFLINE'}</span>
                                                            </div>
                                                        </div>
                                                        <button onClick={() => handleInvite(f)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black text-white/60 uppercase hover:bg-cyan-500 hover:text-slate-950 transition-all">Invoke</button>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="h-full flex flex-col items-center justify-center opacity-30">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-center px-4">No active signals found in roster</span>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            )}

                            {view === 'join' && (
                                <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white/5 mx-8 rounded-[2.5rem] border border-white/10 animate-in zoom-in-95 duration-200">
                                    <div className="text-center mb-10">
                                        <h4 className="text-2xl font-black italic text-white uppercase tracking-tighter mb-2">Manual Link</h4>
                                        <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Enter Secure Session Code</p>
                                    </div>
                                    <div className="w-full space-y-8">
                                        <input
                                            type="text"
                                            value={roomCode}
                                            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                            placeholder="XXXXXX"
                                            className="w-full bg-slate-900 border-2 border-white/10 rounded-2xl p-6 text-center text-4xl font-black text-cyan-400 placeholder:text-white/5 focus:border-cyan-500 outline-none transition-all uppercase tracking-[0.2em]"
                                            maxLength={6}
                                        />
                                        <div className="flex flex-col gap-3">
                                            <button onClick={() => onJoin(roomCode)} disabled={roomCode.length < 3} className="w-full py-4 bg-white text-slate-900 text-xl font-black italic tracking-tighter rounded-full shadow-xl hover:scale-105 active:scale-95 disabled:opacity-20 transition-all uppercase">
                                                Infiltrate Lobby
                                            </button>
                                            <button onClick={() => setView('console')} className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-white">
                                                Cancel Operation
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Tactical HUD Footer */}
                        <div className="w-full mt-6 space-y-4 px-8 relative z-10">
                            <div className="bg-slate-900/60 border border-amber-500/30 px-6 py-2 rounded-full flex items-center justify-between">
                                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Protocol: <span className="text-white">{activeParams.mode}</span></span>
                                <div className="w-1 h-3 bg-white/10 rounded-full" />
                                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Wager: <span className="text-amber-400">{activeParams.wager}</span></span>
                            </div>

                            <button
                                onClick={() => { 
                                    if (isReady) { 
                                        playDiceLand(); 
                                        if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
                                        onStartMatch(); 
                                    } 
                                }}
                                disabled={!isReady}
                                className={`w-full py-5 rounded-[2rem] font-black italic tracking-widest text-lg uppercase transition-all duration-300 relative overflow-hidden border active:scale-95
                                    ${isReady 
                                        ? 'bg-white text-slate-950 shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)]' 
                                        : 'bg-white/5 text-white/10 border-white/5 cursor-not-allowed'
                                    }
                                `}
                            >
                                {isReady ? 'Commence Operation' : 'Awaiting Signals...'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};