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

// --- TABLE SEATS ---

const HostSeat = ({ slot }: { slot: LobbySlot }) => {
    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl min-h-[200px] w-full group overflow-hidden"
        >
            {/* VIP Marker: Golden Token */}
            <div className="absolute top-4 right-4 w-8 h-8 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]">
                <LudoTokenIcon color="#f59e0b" className="w-full h-full" />
            </div>

            <div className="flex flex-col items-center gap-4">
                <div className="relative w-24 h-24">
                    <div className="absolute inset-0 rounded-full border-2 border-cyan-400/30 animate-pulse" />
                    <div className="w-full h-full rounded-full overflow-hidden border-2 border-white/20 bg-slate-800 p-1">
                        {slot.playerAvatar ? (
                            <img src={slot.playerAvatar} alt="host" className="w-full h-full rounded-full object-cover" />
                        ) : (
                            <div className="w-full h-full rounded-full flex items-center justify-center text-3xl font-black text-white/40 bg-white/5">
                                {(slot.playerName?.[0] || 'H').toUpperCase()}
                            </div>
                        )}
                    </div>
                </div>

                <div className="text-center">
                    <span className="block text-xl font-black italic tracking-tighter text-white uppercase truncate max-w-[160px]">
                        {slot.playerName || 'USER'}
                    </span>
                    <div className="flex items-center justify-center gap-2 mt-2">
                        <span className="text-[10px] font-black text-cyan-400/80 tracking-widest uppercase">LVL 42</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span className="text-[10px] font-black text-white/40 tracking-widest uppercase">COMMANDER</span>
                    </div>
                </div>
            </div>

            {/* Subtle glow background */}
            <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-cyan-500/5 blur-[50px] rounded-full" />
        </motion.div>
    );
};

const InvitationNode = ({ onClick, isInvited }: { onClick: () => void; isInvited?: boolean }) => {
    return (
        <motion.div 
            onClick={onClick}
            whileHover={{ scale: 1.02, backgroundColor: 'rgba(255, 255, 255, 0.08)', borderColor: 'rgba(34, 211, 238, 0.3)' }}
            whileTap={{ scale: 0.98 }}
            className="group relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] border-2 border-dashed border-white/10 bg-white/2 backdrop-blur-md cursor-pointer transition-all min-h-[200px] w-full overflow-hidden"
        >
            <div className="relative flex flex-col items-center gap-4 z-10">
                <div className="relative w-24 h-24 flex items-center justify-center">
                    <motion.div 
                        className="absolute inset-0"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                    >
                        <LudoTokenIcon color="rgba(34, 211, 238, 0.3)" wireframe className="w-full h-full" />
                    </motion.div>
                    
                    {isInvited ? (
                        <div className="w-10 h-10 border-4 border-white/20 border-t-cyan-400 rounded-full animate-spin" />
                    ) : (
                        <PlusIcon className="w-10 h-10 text-white/20 group-hover:text-cyan-400 group-hover:scale-110 transition-all" />
                    )}
                </div>
                
                <div className="text-center">
                    <span className="block text-sm font-black tracking-[0.2em] text-white/30 group-hover:text-cyan-400 uppercase transition-colors">
                        {isInvited ? 'INVITATION SENT' : 'ADD TEAMMATE'}
                    </span>
                    <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-white/10 mt-2">OPEN ROSTER</span>
                </div>
            </div>
            
            {/* Energy pulse ring */}
            <motion.div 
                className="absolute inset-8 rounded-full border border-cyan-400/5 pointer-events-none"
                animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0, 0.1] }}
                transition={{ duration: 4, repeat: Infinity }}
            />
        </motion.div>
    );
};

const RosterCard = ({ friend, onInvite }: { friend: any; onInvite: () => void }) => {
    return (
        <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all group overflow-hidden"
        >
            <div className="flex items-center gap-4">
                <div className="relative w-12 h-12">
                    <div className="w-full h-full rounded-full border border-white/10 overflow-hidden bg-slate-800">
                        {friend.avatar_url ? (
                            <img src={friend.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg font-black text-white/30">
                                {(friend.username?.[0] || '?').toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-slate-900 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                </div>
                <div>
                    <span className="block text-sm font-black text-white italic truncate max-w-[140px] uppercase tracking-tight">
                        {friend.username || 'FRIEND'}
                    </span>
                    <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">LEVEL 24 • ONLINE</span>
                </div>
            </div>

            <button 
                onClick={onInvite}
                className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-500 hover:text-white transition-all active:scale-95"
            >
                <PlusIcon className="w-5 h-5" />
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

    // Clean HUD Parameters matching Lobby Style
    const activeParams = {
        mode: lobbyState?.gameMode === 'power' ? 'POWER' : 'CLASSIC',
        wager: lobbyState?.entryFee?.toLocaleString() || '1,000,000',
    };

    const handleInvite = (friend: any) => {
        playSelect();
        onSendInvite(friend.wallet_address, friend.username);
        setView('console');
    };

    // Vibrate on activation
    useEffect(() => {
        if (isReady && view === 'console') {
            if (typeof window !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(20);
            }
        }
    }, [isReady, view]);

    return (
        <>
            {/* Blurring Lobby Overlay */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md"
                onClick={onClose}
            />

            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[500px] h-[85vh] bg-slate-900/40 border border-white/10 rounded-[4rem] z-[110] flex flex-col shadow-[0_50px_100px_rgba(0,0,0,0.8)] overflow-hidden glass-panel"
            >
                {/* Clean Header Bar */}
                <div className="w-full h-14 flex items-center justify-between px-10 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
                        <span className="text-[10px] font-black text-white/40 tracking-[0.2em] uppercase">Private Match Room</span>
                    </div>
                    
                    <button 
                        onClick={() => { playClick(); onClose(); }}
                        className="p-2 transition-all hover:scale-125 text-white/20 hover:text-white"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                {/* Console Core */}
                <div className="flex-1 flex flex-col pt-4 overflow-hidden">
                    
                    {/* Header: Title & Code Projections */}
                    <div className="px-10 pb-6 text-center">
                        <h2 className="text-white text-[11px] font-black uppercase tracking-[0.4em] drop-shadow-md mb-4 opacity-60">
                            TeamUp Waiting Room
                        </h2>
                        
                        <div 
                            className="relative py-2 group cursor-pointer inline-block" 
                            onClick={() => { playSelect(); currentRoomId && navigator.clipboard.writeText(currentRoomId); }}
                        >
                            <span className="text-6xl font-black italic tracking-tighter text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.2)] block transition-transform group-hover:scale-105">
                                {currentRoomId || '000000'}
                            </span>
                            <span className="text-[9px] font-black text-cyan-400 tracking-[0.3em] uppercase mt-2 block opacity-50 group-hover:opacity-100 transition-opacity">
                                TAP TO COPY CODE
                            </span>
                        </div>
                    </div>

                    {/* View Controller */}
                    <div className="flex-1 overflow-hidden px-8 flex flex-col">
                        <AnimatePresence mode="wait">
                            {view === 'console' ? (
                                <motion.div 
                                    key="console"
                                    initial={{ opacity: 0, scale: 0.98 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.98 }}
                                    className="flex-1 flex flex-col justify-center space-y-8"
                                >
                                    {/* Clean HUD Projection */}
                                    <div className="flex justify-center gap-12 py-4">
                                        <div className="text-center">
                                            <span className="block text-[9px] font-black text-white/30 tracking-[0.2em] uppercase mb-1">Mode</span>
                                            <div className="px-4 py-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/5">
                                                <span className="text-base font-black text-cyan-400 italic tracking-tighter uppercase">{activeParams.mode}</span>
                                            </div>
                                        </div>
                                        <div className="text-center">
                                            <span className="block text-[9px] font-black text-white/30 tracking-[0.2em] uppercase mb-1">Bet Amount</span>
                                            <div className="px-4 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/5 flex items-center gap-2">
                                                <span className="text-base font-black text-amber-500 italic tracking-tighter font-mono">{activeParams.wager}</span>
                                                <div className="w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-[9px] font-black text-slate-900">C</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Table Grid (1x2) */}
                                    <div className="grid grid-cols-2 gap-6 relative">
                                        {/* Host Seat */}
                                        {lobbyState?.slots[0] ? (
                                            <HostSeat slot={lobbyState.slots[0]} />
                                        ) : (
                                            <div className="min-h-[200px] rounded-[2.5rem] bg-white/5 border border-white/5 flex items-center justify-center">
                                                <div className="w-8 h-8 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
                                            </div>
                                        )}

                                        {/* Dynamic Opponent Seat */}
                                        {lobbyState?.slots.find(s => s.role === 'opponent' && s.status === 'joined') ? (
                                            <HostSeat slot={lobbyState.slots.find(s => s.role === 'opponent')!} />
                                        ) : (
                                            <InvitationNode 
                                                onClick={() => { playSelect(); setView('roster'); }} 
                                                isInvited={lobbyState?.slots.some(s => s.status === 'invited')}
                                            />
                                        )}
                                    </div>

                                    <div className="flex justify-center">
                                        <button 
                                            onClick={() => setView('join')}
                                            className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] hover:text-white transition-colors"
                                        >
                                            Have a Code? <span className="text-cyan-400">Join Here</span>
                                        </button>
                                    </div>
                                </motion.div>
                            ) : view === 'roster' ? (
                                <motion.div 
                                    key="roster"
                                    initial={{ opacity: 0, scale: 1.05 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="flex-1 flex flex-col pt-2"
                                >
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-white italic">Elite Roster</h3>
                                        <button 
                                            onClick={() => { playClick(); setView('console'); }}
                                            className="text-[10px] font-black text-cyan-400 uppercase tracking-widest flex items-center gap-2 hover:translate-x-[-4px] transition-transform"
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg>
                                            Back
                                        </button>
                                    </div>

                                    <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                                        {isLoadingFriends ? (
                                            <div className="h-full flex flex-col items-center justify-center opacity-30">
                                                <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-4" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.3em]">Accessing Data...</span>
                                            </div>
                                        ) : (
                                            [...friendsData.gameFriends, ...friendsData.onchainFriends].length > 0 ? (
                                                [...friendsData.gameFriends, ...friendsData.onchainFriends].map((f, i) => (
                                                    <RosterCard key={i} friend={f} onInvite={() => handleInvite(f)} />
                                                ))
                                            ) : (
                                                <div className="h-full flex flex-col items-center justify-center text-center px-10">
                                                    <LudoTokenIcon color="rgba(255,255,255,0.05)" className="w-20 h-20 mb-6" />
                                                    <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.5em]">No Allies Detected</span>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </motion.div>
                            ) : (
                                /* JOIN VIEW */
                                <motion.div 
                                    key="join"
                                    initial={{ opacity: 0, y: 30 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -30 }}
                                    className="flex-1 flex flex-col pt-10"
                                >
                                    <div className="flex-1 flex flex-col items-center text-center">
                                        <h3 className="text-[11px] font-black text-cyan-400 uppercase tracking-[0.5em] mb-10">Enter Match Code</h3>
                                        <input
                                            type="text"
                                            placeholder="CODE"
                                            value={roomCode}
                                            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                            className="w-full bg-white/5 border-2 border-white/5 text-center text-5xl font-black italic tracking-tighter text-white py-10 rounded-[3rem] focus:outline-none focus:border-cyan-400/50 transition-all uppercase mb-10"
                                            maxLength={6}
                                        />
                                        <button
                                            onClick={() => onJoin(roomCode)}
                                            disabled={roomCode.length < 3}
                                            className="w-full py-6 bg-white text-slate-900 text-xl font-black italic tracking-tighter rounded-[2.5rem] shadow-xl hover:scale-105 active:scale-95 disabled:opacity-20 transition-all uppercase"
                                        >
                                            Join Waiting Room
                                        </button>
                                        <button 
                                            onClick={() => setView('console')}
                                            className="mt-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-white"
                                        >
                                            Return to Table
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                </div>

                {/* --- FOOTER: COMMENCE MATCH --- */}
                <div className="p-10 shrink-0">
                    <div className="mb-6 flex flex-col items-center">
                        <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.4em] mb-1">Mission Summary</span>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-white italic tracking-tighter uppercase">{activeParams.mode} MODE</span>
                            <div className="w-1 h-1 rounded-full bg-white/20" />
                            <span className="text-xs font-black text-amber-500 italic tracking-tighter uppercase">{activeParams.wager} COINS</span>
                        </div>
                    </div>

                    <motion.button
                        whileHover={isReady ? { scale: 1.02, boxShadow: '0 0 30px rgba(34,211,238,0.3)' } : {}}
                        whileTap={isReady ? { scale: 0.98 } : {}}
                        onClick={() => { 
                            if (isReady) { 
                                playDiceLand(); 
                                if (typeof window !== 'undefined' && navigator.vibrate) {
                                    navigator.vibrate([40, 60, 40]);
                                }
                                onStartMatch(); 
                            } 
                        }}
                        disabled={!isReady}
                        className={`w-full py-6 rounded-[2.5rem] font-black italic tracking-tighter text-2xl uppercase transition-all duration-300 relative overflow-hidden
                            ${isReady 
                                ? 'bg-cyan-500 text-white shadow-lg' 
                                : 'bg-white/5 text-white/10 border border-white/5 cursor-not-allowed'
                            }
                        `}
                    >
                        {isReady && (
                            <motion.div 
                                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                                animate={{ x: ['-200%', '200%'] }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                            />
                        )}
                        <span className="relative z-10">Commence Match</span>
                    </motion.button>
                </div>
            </motion.div>
        </>
    );
};
