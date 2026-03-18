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

// --- COMMANDER MODULE (Slot) ---
const CommanderModule = ({ slot, isHost, onKick }: { slot: LobbySlot; isHost: boolean; onKick: () => void }) => {
    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] border border-cyan-500/30 bg-slate-900/60 backdrop-blur-xl shadow-[0_0_30px_rgba(34,211,238,0.15)] overflow-hidden min-h-[180px] w-full"
        >
            {/* Holographic scanner effect line */}
            <motion.div 
                className="absolute top-0 left-0 w-full h-[2px] bg-cyan-400/50 shadow-[0_0_10px_cyan] z-20"
                animate={{ top: ['0%', '100%', '0%'] }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />

            <div className="relative z-10 flex flex-col items-center gap-4">
                {/* Avatar Projection */}
                <div className="relative w-20 h-20">
                    <div className="absolute inset-0 rounded-full border-2 border-cyan-400/50 animate-pulse" />
                    <div className="absolute -inset-1 rounded-full border border-cyan-400/20 animate-ping" />
                    <div className="w-full h-full rounded-full overflow-hidden border border-cyan-400 bg-slate-800 shadow-[0_0_20px_rgba(34,211,238,0.4)]">
                        {slot.playerAvatar ? (
                            <img src={slot.playerAvatar} alt="commander" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-3xl font-black text-cyan-400 font-mono">
                                {(slot.playerName?.[0] || 'C').toUpperCase()}
                            </div>
                        )}
                    </div>
                </div>

                <div className="text-center">
                    <span className="block text-xl font-black italic tracking-tighter text-white drop-shadow-[0_0_10px_rgba(34,211,238,0.5)] uppercase truncate max-w-[140px]">
                        {slot.playerName || 'COMMANDER'}
                    </span>
                    <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-400/10 border border-cyan-400/30 shadow-[0_0_10px_rgba(34,211,238,0.1)]">
                        <div className="w-2h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_5px_cyan]" />
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400 leading-none">COMMANDER - ACTIVE</span>
                    </div>
                </div>
            </div>

            {/* Kick Button if Host and not kicking self */}
            {isHost && slot.role !== 'host' && (
                <button 
                    onClick={onKick}
                    className="absolute top-4 right-4 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/30 hover:scale-110 transition-all z-30"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            )}
        </motion.div>
    );
};

// --- VACANT POD (Slot) ---
const VacantPod = ({ onClick, isInvited }: { onClick: () => void; isInvited?: boolean }) => {
    return (
        <motion.div 
            onClick={onClick}
            whileHover={{ scale: 1.02, backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.5)' }}
            whileTap={{ scale: 0.98 }}
            className="group relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] border-2 border-dashed border-red-500/20 bg-slate-900/30 backdrop-blur-md cursor-pointer transition-all min-h-[180px] w-full"
        >
            <div className="relative flex flex-col items-center gap-4 z-10 transition-transform group-hover:scale-105">
                <div className="w-20 h-20 rounded-full border-2 border-dashed border-red-500/30 flex items-center justify-center text-red-500/30 group-hover:border-red-500/50 group-hover:text-red-500/50 transition-all bg-red-500/5">
                    {isInvited ? (
                        <motion.div 
                            animate={{ rotate: 360 }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                            className="w-10 h-10 border-4 border-red-500/50 border-t-transparent rounded-full"
                        />
                    ) : (
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40 group-hover:opacity-100 transition-opacity">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                            <line x1="12" y1="11" x2="12" y2="13"></line>
                            <line x1="11" y1="12" x2="13" y2="12"></line>
                        </svg>
                    )}
                </div>
                <div className="text-center">
                    <span className="block text-sm font-black tracking-[0.2em] text-red-500/40 group-hover:text-red-500/80 uppercase transition-colors">
                        {isInvited ? 'SIGNAL INITIATED' : 'VACANT POD'}
                    </span>
                    <span className="block text-[9px] font-black uppercase tracking-[0.1em] text-white/20 mt-2 transition-colors group-hover:text-white/40">INITIALIZE RECRUIT SCAN</span>
                </div>
            </div>

            {/* Glowing red energy field pulse */}
            <motion.div 
                className="absolute inset-4 rounded-[2rem] border border-red-500/10 pointer-events-none"
                animate={{ opacity: [0.1, 0.4, 0.1], scale: [1, 1.02, 1] }}
                transition={{ duration: 3, repeat: Infinity }}
            />
        </motion.div>
    );
};

// --- ROSTER CARD (Friend) ---
const RosterCard = ({ friend, onInvite }: { friend: any; onInvite: () => void }) => {
    return (
        <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-cyan-500/10 hover:border-cyan-500/40 transition-all group overflow-hidden"
        >
            <div className="flex items-center gap-4 relative z-10">
                <div className="relative w-12 h-12">
                    <div className="w-full h-full rounded-full border border-white/20 overflow-hidden bg-slate-800 shadow-inner">
                        {friend.avatar_url ? (
                            <img src={friend.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg font-black text-white/60 font-mono">
                                {(friend.username?.[0] || '?').toUpperCase()}
                            </div>
                        )}
                    </div>
                    {/* Online status indicator */}
                    <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-slate-900 shadow-[0_0_8px_#10b981]" />
                </div>
                <div className="min-w-0">
                    <span className="block text-sm font-black text-white truncate max-w-[140px] uppercase tracking-tight">
                        {friend.username || 'GENERIC_USER'}
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/30">SKILL_RATING:</span>
                        <span className="text-[10px] font-black text-cyan-400 font-mono">A+</span>
                    </div>
                </div>
            </div>

            <button 
                onClick={onInvite}
                className="relative w-11 h-11 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 hover:bg-cyan-500 hover:text-white hover:shadow-[0_0_20px_rgba(34,211,238,0.5)] transition-all active:scale-95 group/btn"
                title="INITIATE BEACON"
            >
                <motion.span 
                    className="absolute h-full w-full rounded-xl border border-cyan-400 opacity-0 group-hover/btn:animate-ping"
                />
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
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

    // Dynamic HUD Parameters from Lobby State
    const activeParams = {
        mode: lobbyState?.gameMode === 'power' ? 'POWER LUDO' : 'CLASSIC LUDO',
        wager: lobbyState?.entryFee?.toLocaleString() || '1,000,000',
        matchType: lobbyState?.matchType || '1v1'
    };

    const handleInvite = (friend: any) => {
        playSelect();
        onSendInvite(friend.wallet_address, friend.username);
        setView('console');
    };

    // Find the primary opponent slot for the 1x2 display
    const opponentSlot = lobbyState?.slots.find(s => s.role === 'opponent');
    const opponentIndex = lobbyState?.slots.findIndex(s => s.role === 'opponent') ?? 1;

    return (
        <>
            {/* Immersive Dark Overlay */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-xl"
                onClick={onClose}
            >
                {/* Background data particles */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
                    {[...Array(20)].map((_, i) => (
                        <motion.div 
                            key={i}
                            className="absolute w-1 h-32 bg-cyan-500/10 blur-sm"
                            style={{ 
                                left: `${Math.random() * 100}%`,
                                top: `${Math.random() * 100}%`
                            }}
                            animate={{ 
                                y: [-100, 1000],
                                opacity: [0, 1, 0]
                            }}
                            transition={{ 
                                duration: Math.random() * 5 + 10,
                                repeat: Infinity,
                                delay: Math.random() * 5
                            }}
                        />
                    ))}
                </div>
            </motion.div>

            <motion.div
                initial={{ y: '100%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0 }}
                transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[540px] h-[92vh] bg-slate-900 border-t-2 border-x-2 border-slate-800 rounded-t-[4rem] z-[110] flex flex-col shadow-[0_-30px_60px_rgba(0,0,0,0.9)] overflow-hidden"
            >
                {/* Command Bar Header */}
                <div className="w-full h-14 bg-gradient-to-b from-slate-800 to-slate-900 border-b border-slate-700/50 flex items-center justify-between px-10 relative shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]" />
                        <span className="text-[9px] font-black text-white/40 tracking-[0.3em] font-mono">STATION_LINK: STABLE</span>
                    </div>
                    
                    <div className="absolute left-1/2 -translate-x-1/2 w-24 h-2 bg-slate-700 rounded-full" />
                    
                    <button 
                        onClick={() => { playClick(); onClose(); }}
                        className="p-2 transition-all hover:scale-125 hover:rotate-90 text-white/30 hover:text-white"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                {/* Console Main Container */}
                <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08)_0%,transparent_70%)]">
                    
                    {/* Header: Title & Code */}
                    <div className="px-10 pb-6 text-center space-y-4">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.6em] text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.4)] font-mono">
                            TEAMUP_COMMAND_TERMINAL
                        </h2>
                        
                        <div 
                            className="relative py-4 group cursor-pointer inline-block" 
                            onClick={() => { playSelect(); currentRoomId && navigator.clipboard.writeText(currentRoomId); }}
                        >
                            <div className="absolute -inset-12 bg-cyan-400/5 blur-[4rem] rounded-full animate-pulse group-hover:bg-cyan-400/15 transition-all" />
                            <span className="relative text-5xl font-mono font-black tracking-[0.5em] text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.4)] transition-all group-hover:scale-105 inline-block">
                                {currentRoomId || '000000'}
                            </span>
                            <div className="mt-3 text-[9px] font-black text-cyan-400/50 tracking-[0.4em] uppercase transition-colors group-hover:text-cyan-400">
                                TAP_TO_BROADCAST_SIGNAL
                            </div>
                        </div>
                    </div>

                    {/* Dynamic View Section */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-8 pb-10">
                        <AnimatePresence mode="wait">
                            {view === 'console' ? (
                                <motion.div 
                                    key="console"
                                    initial={{ opacity: 0, scale: 0.98 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.98 }}
                                    className="space-y-10"
                                >
                                    {/* Holographic Parameters HUD */}
                                    <div className="relative py-8 rounded-[2rem] bg-slate-950/60 border border-slate-800 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] flex flex-col items-center justify-center overflow-hidden">
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent animate-pulse" />
                                        
                                        <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-10 relative z-10 w-full px-12">
                                            <div className="text-right">
                                                <span className="block text-[8px] font-black text-white/30 tracking-widest uppercase mb-1">MODE_PROFILE</span>
                                                <span className="text-base font-black text-cyan-400 tracking-widest italic">{activeParams.mode}</span>
                                            </div>
                                            <div className="w-[1px] h-12 bg-slate-800" />
                                            <div className="text-left">
                                                <span className="block text-[8px] font-black text-white/30 tracking-widest uppercase mb-1">ASSET_WAGER</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-base font-black text-amber-500 tracking-tighter font-mono">{activeParams.wager}</span>
                                                    <div className="w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-[9px] font-black text-slate-900 shadow-[0_0_10px_rgba(245,158,11,0.5)]">C</div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-6 w-full px-10">
                                            <div className="w-full h-[1px] bg-slate-800/50" />
                                            <div className="py-2 text-center">
                                                <span className="text-[9px] font-black text-white/20 tracking-widest uppercase font-mono animate-pulse">
                                                    {isReady ? 'SYSTEM_LOCKED: READY_FOR_DEPLOIMENT' : `AWAITING_${activeParams.matchType}_ALIGNMENT`}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Command Grid Console (1x2 Focus) */}
                                    <div className="grid grid-cols-2 gap-6 relative">
                                        {/* Grid Decoration */}
                                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center z-20">
                                            <span className="text-[10px] font-black text-cyan-400">VS</span>
                                        </div>

                                        {/* Host Slot */}
                                        {lobbyState?.slots[0] ? (
                                            <CommanderModule 
                                                slot={lobbyState.slots[0]} 
                                                isHost={isHost} 
                                                onKick={() => onKickPlayer(0)} 
                                            />
                                        ) : (
                                            <div className="min-h-[180px] rounded-[2.5rem] bg-slate-900/60 border border-slate-800 flex items-center justify-center shadow-inner">
                                                <div className="w-10 h-10 border-2 border-white/5 border-t-white/20 rounded-full animate-spin" />
                                            </div>
                                        )}

                                        {/* Main Opponent Slot */}
                                        {opponentSlot?.status === 'joined' ? (
                                            <CommanderModule 
                                                slot={opponentSlot} 
                                                isHost={isHost} 
                                                onKick={() => onKickPlayer(opponentIndex)} 
                                            />
                                        ) : (
                                            <VacantPod 
                                                onClick={() => { playSelect(); setView('roster'); }} 
                                                isInvited={opponentSlot?.status === 'invited'}
                                            />
                                        )}
                                    </div>

                                    <div className="flex flex-col items-center gap-4">
                                        <button 
                                            onClick={() => setView('join')}
                                            className="px-8 py-3 rounded-full bg-white/5 border border-white/5 text-[10px] font-black text-white/30 uppercase tracking-[0.3em] hover:bg-white/10 hover:border-cyan-500/20 hover:text-white transition-all transition-colors active:scale-95"
                                        >
                                            CONNECTED_STATION? <span className="text-cyan-400">INPUT_CODE</span>
                                        </button>
                                    </div>
                                </motion.div>
                            ) : view === 'roster' ? (
                                <motion.div 
                                    key="roster"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="space-y-6"
                                >
                                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                                        <div>
                                            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-white">ASSET_MANIFEST: ROSTER</h3>
                                            <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">TRANSMITTING OVER SECURE LINK</span>
                                        </div>
                                        <button 
                                            onClick={() => { playClick(); setView('console'); }}
                                            className="px-4 py-2 rounded-xl bg-slate-800 text-cyan-400 text-[10px] font-black flex items-center gap-2 hover:bg-slate-700 transition-all border border-slate-700"
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg>
                                            BACK_TO_TERMINAL
                                        </button>
                                    </div>

                                    <div className="space-y-4 max-h-[440px] overflow-y-auto custom-scrollbar pr-3">
                                        {isLoadingFriends ? (
                                            <div className="py-20 flex flex-col items-center gap-4">
                                                <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(34,211,238,0.3)]" />
                                                <span className="text-[10px] font-black text-cyan-400 animate-pulse tracking-widest">SYNCHRONIZING_DATA...</span>
                                            </div>
                                        ) : (
                                            [...friendsData.gameFriends, ...friendsData.onchainFriends].length > 0 ? (
                                                [...friendsData.gameFriends, ...friendsData.onchainFriends].map((f, i) => (
                                                    <RosterCard key={i} friend={f} onInvite={() => handleInvite(f)} />
                                                ))
                                            ) : (
                                                <div className="py-20 flex flex-col items-center gap-4 bg-slate-900/40 rounded-[2.5rem] border-2 border-dashed border-slate-800">
                                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-white/10"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                                    <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">NO_ALLIES_DETECTED</span>
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
                                    className="space-y-10 pt-4"
                                >
                                    <div className="flex flex-col items-center space-y-6">
                                        <div className="w-20 h-20 rounded-3xl bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                        </div>
                                        <div className="text-center">
                                            <span className="block text-[11px] font-black text-cyan-400 uppercase tracking-[0.4em] mb-2 font-mono">CONNECTION_AUTHENTICATION</span>
                                            <span className="block text-xs text-white/40 tracking-widest font-bold uppercase">ENTER ENCRYPTED HASH CODE</span>
                                        </div>
                                        
                                        <div className="w-full relative">
                                            <input
                                                type="text"
                                                placeholder="HASH00"
                                                value={roomCode}
                                                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                                className="w-full bg-slate-950 text-center text-5xl font-mono text-white placeholder-white/5 py-10 rounded-[3rem] border-2 border-slate-800 focus:border-cyan-400 focus:outline-none focus:ring-[15px] focus:ring-cyan-400/5 uppercase tracking-[0.4em] transition-all shadow-[inset_0_5px_15px_rgba(0,0,0,0.5)]"
                                                maxLength={6}
                                            />
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <button
                                            onClick={() => onJoin(roomCode)}
                                            disabled={roomCode.length < 3}
                                            className="w-full py-6 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-black italic tracking-tighter rounded-[2.5rem] shadow-[0_15px_30px_rgba(34,211,238,0.3)] transition-all disabled:opacity-20 disabled:grayscale text-2xl active:scale-95 border border-cyan-400/30"
                                        >
                                            ESTABLISH_TERMINAL_LINK
                                        </button>
                                        
                                        <button 
                                            onClick={() => setView('console')}
                                            className="w-full text-[10px] font-black uppercase tracking-[0.3em] text-white/20 hover:text-white transition-all font-mono"
                                        >
                                            BACK_TO_COMMAND_CENTER
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                </div>

                {/* Footer: The Lucrative Commence Encounter Button */}
                <div className="p-10 bg-slate-950 border-t border-slate-800 shrink-0">
                    <motion.button
                        whileHover={isReady ? { scale: 1.02, boxShadow: '0 0 40px rgba(34,211,238,0.5)' } : {}}
                        whileTap={isReady ? { scale: 0.98 } : {}}
                        onClick={() => { if (isReady) { playDiceLand(); onStartMatch(); } }}
                        disabled={!isReady}
                        className={`w-full py-7 rounded-[3rem] font-black italic tracking-tighter text-3xl border-2 transition-all duration-300 relative overflow-hidden group/final
                            ${isReady 
                                ? 'bg-slate-900 border-cyan-400 text-white shadow-[0_0_20px_rgba(34,211,238,0.2)]' 
                                : 'bg-slate-950 text-white/5 border-slate-900 cursor-not-allowed'
                            }
                        `}
                    >
                        {/* Glowing Cyan Core Background */}
                        {isReady && (
                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-950 via-slate-900 to-indigo-950 opacity-100" />
                        )}
                        
                        {/* Moving light sweep */}
                        {isReady && (
                            <motion.div 
                                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent z-10"
                                animate={{ x: ['-200%', '200%'] }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                            />
                        )}

                        {/* Energy glow pulse */}
                        {isReady && (
                            <motion.div 
                                className="absolute inset-0 shadow-[inset_0_0_30px_rgba(34,211,238,0.4)] z-20"
                                animate={{ opacity: [0.5, 1, 0.5] }}
                                transition={{ duration: 2, repeat: Infinity }}
                            />
                        )}

                        <span className="relative z-30 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]">
                            {isReady ? 'COMMENCE ENCOUNTER' : 'SIGNAL_INTERFERENCE: OFFLINE'}
                        </span>
                    </motion.button>
                </div>
            </motion.div>
        </>
    );
};
