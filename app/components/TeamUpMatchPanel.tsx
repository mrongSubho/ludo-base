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

// --- TABLE SEATS (PREMIUM CARDS) ---
const HostSeat = ({ slot }: { slot: LobbySlot }) => {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative flex flex-col items-center justify-center p-6 rounded-[2rem] bg-gradient-to-br from-white/10 to-white/0 border border-white/20 border-t-cyan-400/50 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-md min-h-[200px] w-full overflow-hidden group"
        >
            {/* VIP Golden Token */}
            <div className="absolute top-4 right-4 w-6 h-6 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]">
                <LudoTokenIcon color="#fbbf24" className="w-full h-full" />
            </div>

            {/* Glowing Avatar Ring */}
            <div className="relative w-24 h-24 mb-4">
                <div className="absolute inset-0 rounded-full bg-cyan-400/20 blur-xl animate-pulse" />
                <div className="absolute inset-[-4px] rounded-full border border-cyan-400/30" />
                <div className="w-full h-full rounded-full overflow-hidden border-2 border-white/40 bg-slate-800 relative z-10 shadow-inner">
                    {slot.playerAvatar ? (
                        <img src={slot.playerAvatar} alt="host" className="w-full h-full rounded-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl font-black text-white/50 bg-gradient-to-br from-slate-700 to-slate-900">
                            {(slot.playerName?.[0] || 'H').toUpperCase()}
                        </div>
                    )}
                </div>
            </div>

            <div className="text-center relative z-10">
                <span className="block text-xl font-black italic tracking-tighter text-white uppercase drop-shadow-md truncate max-w-[140px]">
                    {slot.playerName || 'USER'}
                </span>
                <div className="inline-flex items-center justify-center gap-1.5 mt-2 px-3 py-1 rounded-full bg-black/30 border border-white/10">
                    <span className="text-[10px] font-black text-cyan-400 tracking-widest uppercase">LVL 42</span>
                    <div className="w-1 h-1 rounded-full bg-cyan-400" />
                    <span className="text-[10px] font-black text-white/60 tracking-widest uppercase">COMMANDER</span>
                </div>
            </div>
        </motion.div>
    );
};

const InvitationNode = ({ onClick, isInvited }: { onClick: () => void; isInvited?: boolean }) => {
    return (
        <motion.div
            onClick={onClick}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="group relative flex flex-col items-center justify-center p-6 rounded-[2rem] bg-gradient-to-br from-purple-900/10 to-transparent border border-white/10 hover:border-purple-400/50 shadow-[inset_0_0_30px_rgba(0,0,0,0.5)] cursor-pointer transition-all min-h-[200px] w-full overflow-hidden"
        >
            {/* Animated dashed border effect using SVG */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20 group-hover:opacity-50 transition-opacity">
                <rect x="2" y="2" width="100%" height="100%" rx="30" fill="none" stroke="#a855f7" strokeWidth="2" strokeDasharray="8 8" />
            </svg>

            <div className="relative flex flex-col items-center gap-4 z-10">
                <div className="relative w-20 h-20 flex items-center justify-center">
                    <div className="absolute inset-0 bg-purple-500/20 rounded-full blur-xl group-hover:bg-purple-500/40 transition-all" />
                    <motion.div
                        className="absolute inset-0"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                    >
                        <LudoTokenIcon color="rgba(168, 85, 247, 0.4)" wireframe className="w-full h-full" />
                    </motion.div>

                    {isInvited ? (
                        <div className="w-10 h-10 border-4 border-white/10 border-t-purple-400 rounded-full animate-spin" />
                    ) : (
                        <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur-sm group-hover:bg-purple-500/20 group-hover:scale-110 transition-all shadow-lg">
                            <PlusIcon className="w-6 h-6 text-white/50 group-hover:text-purple-300" />
                        </div>
                    )}
                </div>

                <div className="text-center">
                    <span className="block text-sm font-black tracking-[0.2em] text-white/50 group-hover:text-purple-300 uppercase transition-colors">
                        {isInvited ? 'SIGNAL SENT' : 'ADD TEAMMATE'}
                    </span>
                    <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-white/20 mt-1">TAP TO OPEN ROSTER</span>
                </div>
            </div>
        </motion.div>
    );
};

const RosterCard = ({ friend, onInvite }: { friend: any; onInvite: () => void }) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-400/30 transition-all group overflow-hidden shadow-md"
        >
            <div className="flex items-center gap-4">
                <div className="relative w-14 h-14">
                    <div className="w-full h-full rounded-full border-2 border-white/20 overflow-hidden bg-slate-800 shadow-inner">
                        {friend.avatar_url ? (
                            <img src={friend.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl font-black text-white/40">
                                {(friend.username?.[0] || '?').toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-slate-900 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
                </div>
                <div>
                    <span className="block text-base font-black text-white italic truncate max-w-[160px] uppercase tracking-tight drop-shadow-sm">
                        {friend.username || 'FRIEND'}
                    </span>
                    <span className="text-[10px] font-black text-cyan-400/80 uppercase tracking-widest">LEVEL 24 • ONLINE</span>
                </div>
            </div>

            <button
                onClick={onInvite}
                className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-white/20 flex items-center justify-center text-white hover:border-white hover:scale-110 hover:shadow-[0_0_15px_rgba(255,255,255,0.3)] transition-all active:scale-95"
            >
                <PlusIcon className="w-6 h-6" />
            </button>
        </motion.div>
    );
};

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
            {/* Blurring Lobby Overlay */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="fixed inset-0 z-40 bg-black/70 backdrop-blur-md"
                onClick={onClose}
            />

            {/* Central Holographic Table Console */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-32px)] max-w-[460px] min-h-[600px] z-[110] flex flex-col"
            >
                {/* AMBIENT BACKGROUND LIGHTING (The secret to good glassmorphism) */}
                <div className="absolute inset-0 -z-10 overflow-hidden rounded-[3rem]">
                    <div className="absolute top-0 left-0 w-[200px] h-[200px] bg-cyan-500/30 rounded-full blur-[80px]" />
                    <div className="absolute bottom-0 right-0 w-[250px] h-[250px] bg-purple-600/20 rounded-full blur-[100px]" />
                </div>

                {/* THE GLASS PANEL */}
                <div className="flex-1 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[3rem] shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden relative">

                    {/* Header */}
                    <div className="p-8 pb-6 flex items-center justify-between border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400/20 to-purple-500/20 flex items-center justify-center border border-white/20 shadow-inner">
                                <LudoTokenIcon color="#fff" className="w-6 h-6 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                            </div>
                            <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase drop-shadow-md">VIP Lobby</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-10 h-10 flex items-center justify-center rounded-full bg-black/20 hover:bg-white/10 text-white/50 hover:text-white transition-all border border-white/10"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>

                    {/* Dynamic Content Area */}
                    <div className="flex-1 overflow-hidden flex flex-col p-8">
                        <AnimatePresence mode="wait">
                            {view === 'console' ? (
                                <motion.div
                                    key="console"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    className="flex-1 flex flex-col"
                                >
                                    {/* Holographic Room Code */}
                                    <div className="text-center mb-8">
                                        <div
                                            className="inline-block relative py-2 cursor-pointer group"
                                            onClick={() => { playSelect(); currentRoomId && navigator.clipboard.writeText(currentRoomId); }}
                                        >
                                            <span className="text-6xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60 drop-shadow-[0_0_20px_rgba(255,255,255,0.4)] transition-transform group-hover:scale-105 block">
                                                {currentRoomId || '000000'}
                                            </span>
                                            <div className="mt-2 flex items-center justify-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                                                <svg className="w-3 h-3 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                <span className="text-[9px] font-black text-cyan-400 tracking-[0.3em] uppercase">Copy Code</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* The Table Slots */}
                                    <div className="grid grid-cols-2 gap-5 mb-8 flex-1">
                                        {lobbyState?.slots[0] ? (
                                            <HostSeat slot={lobbyState.slots[0]} />
                                        ) : (
                                            <div className="min-h-[200px] rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center">
                                                <div className="w-10 h-10 border-4 border-white/10 border-t-white/50 rounded-full animate-spin" />
                                            </div>
                                        )}

                                        {lobbyState?.slots.find(s => s.role === 'opponent' && s.status === 'joined') ? (
                                            <HostSeat slot={lobbyState.slots.find(s => s.role === 'opponent')!} />
                                        ) : (
                                            <InvitationNode
                                                onClick={() => { playSelect(); setView('roster'); }}
                                                isInvited={lobbyState?.slots.some(s => s.status === 'invited')}
                                            />
                                        )}
                                    </div>

                                    {/* HUD Wager Display */}
                                    <div className="flex justify-between items-center px-6 py-4 rounded-2xl bg-black/30 border border-white/5">
                                        <div>
                                            <span className="block text-[9px] font-black text-white/40 tracking-[0.2em] uppercase mb-1">Match Type</span>
                                            <span className="text-sm font-black text-cyan-400 italic tracking-tighter uppercase">{activeParams.mode}</span>
                                        </div>
                                        <div className="h-8 w-px bg-white/10" />
                                        <div className="text-right">
                                            <span className="block text-[9px] font-black text-white/40 tracking-[0.2em] uppercase mb-1">Prize Pool</span>
                                            <div className="flex items-center gap-2 justify-end">
                                                <span className="text-lg font-black text-amber-400 italic tracking-tighter">{activeParams.wager}</span>
                                                <div className="w-4 h-4 bg-gradient-to-br from-amber-300 to-amber-500 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(251,191,36,0.5)]">
                                                    <span className="text-[9px] font-black text-amber-900">C</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : view === 'roster' ? (
                                <motion.div
                                    key="roster"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="flex-1 flex flex-col h-full"
                                >
                                    <div className="flex items-center justify-between mb-6 bg-white/5 p-4 rounded-2xl border border-white/10">
                                        <h3 className="text-base font-black uppercase tracking-[0.2em] text-white italic">Select Teammate</h3>
                                        <button
                                            onClick={() => { playClick(); setView('console'); }}
                                            className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-[10px] font-black text-white uppercase tracking-widest transition-all"
                                        >
                                            Return
                                        </button>
                                    </div>

                                    <div className="flex-1 space-y-3 overflow-y-auto pr-2 custom-scrollbar">
                                        {isLoadingFriends ? (
                                            <div className="h-full flex flex-col items-center justify-center opacity-50">
                                                <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mb-4" />
                                            </div>
                                        ) : (
                                            [...friendsData.gameFriends, ...friendsData.onchainFriends].length > 0 ? (
                                                [...friendsData.gameFriends, ...friendsData.onchainFriends].map((f, i) => (
                                                    <RosterCard key={i} friend={f} onInvite={() => handleInvite(f)} />
                                                ))
                                            ) : (
                                                <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                                                    <LudoTokenIcon className="w-20 h-20 mb-4" />
                                                    <span className="text-xs font-black uppercase tracking-[0.4em]">Roster Empty</span>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                    </div>

                    {/* The Action Button */}
                    <div className="p-8 pt-0 mt-auto">
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
                            className={`w-full py-5 rounded-[2rem] font-black italic tracking-tighter text-2xl uppercase transition-all duration-300 shadow-xl
                                ${isReady
                                    ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-900 shadow-[0_10px_30px_rgba(52,211,153,0.4)] hover:shadow-[0_10px_40px_rgba(52,211,153,0.6)]'
                                    : 'bg-white/5 text-white/20 border border-white/10 cursor-not-allowed'
                                }
                            `}
                        >
                            {isReady ? 'Commence Match' : 'Waiting for Players...'}
                        </motion.button>

                        {view === 'console' && !isReady && (
                            <div className="mt-4 text-center">
                                <button onClick={() => setView('join')} className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] hover:text-cyan-400 transition-colors">
                                    Have a friend's code? <span className="underline underline-offset-4">Join Their Table</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>
        </>
    );
};