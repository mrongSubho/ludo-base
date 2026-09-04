"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameData } from '@/hooks/GameDataContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
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
    matchType?: '1v1' | '2v2' | '4P';
    gameMode?: 'classic' | 'power';
    entryFee?: number;
}

// --- ICONS ---
const PlusIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const LinkIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <polyline points="20 6 9 17 4 12" />
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

const COLOR_DOT: Record<string, string> = {
    green: '#22c55e',
    red: '#ef4444',
    yellow: '#eab308',
    blue: '#3b82f6',
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
    onSendInvite,
    onQuickMatch,
    matchType = '4P',
    gameMode = 'classic',
    entryFee = 0,
}: TeamUpMatchPanelProps) => {
    const { playSelect, playClick, playDiceLand } = useSoundEffects();
    const [view, setView] = useState<'console' | 'roster' | 'join'>('console');
    const [roomCode, setRoomCode] = useState('');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const { profile, address, displayName } = useCurrentUser();
    const { friends: friendsData, isBooting: isLoadingFriends } = useGameData();
    const isReady = lobbyState ? canStartMatch(lobbyState) : false;

    // Data Mapping
    const hostSlot = lobbyState?.slots[0];
    const roomCodeValue = lobbyState?.roomCode || currentRoomId || '';
    const totalSeats = lobbyState?.slots.length ?? (matchType === '1v1' ? 2 : 4);
    const guestSlots: (LobbySlot | null)[] = lobbyState
        ? lobbyState.slots.filter(s => s.role !== 'host')
        : Array.from({ length: matchType === '1v1' ? 1 : 3 }, () => null);
    const joinedCount = lobbyState
        ? lobbyState.slots.filter(s => s.status === 'joined').length
        : 1;

    const hostName = hostSlot?.playerName || displayName || 'You';
    const hostAvatar = hostSlot?.playerAvatar || profile?.avatar_url || null;
    const isSelfHost = hostSlot?.playerId
        ? !!address && hostSlot.playerId.toLowerCase() === address.toLowerCase()
        : true;

    const modeLabel = (lobbyState?.gameMode ?? gameMode) === 'power' ? 'Power' : 'Classic';
    const fee = lobbyState?.entryFee ?? entryFee;
    const feeLabel = fee > 0 ? fee.toLocaleString() : 'Free';

    const copyText = async (text: string, key: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            /* clipboard unavailable — still show feedback */
        }
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(cur => (cur === key ? null : cur)), 1500);
    };

    const inviteLinkFor = (seat?: number) => {
        if (typeof window === 'undefined' || !roomCodeValue) return '';
        return `${window.location.origin}${window.location.pathname}?room=${roomCodeValue}${seat !== undefined ? `&seat=${seat}` : ''}`;
    };

    // First tap on an empty seat hosts the room (wires up the dead onHost),
    // so invite links have a code to share.
    const ensureRoom = () => {
        if (!roomCodeValue) onHost();
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
                        className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                    >
                        {/* Authentic Subdued Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        <div className="w-full flex justify-between items-center p-8 relative z-10">
                            <div>
                                <h3 className="text-white font-black italic text-3xl tracking-tighter uppercase">Team Up</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className={`w-1.5 h-1.5 rounded-full ${isLobbyConnected ? 'bg-cyan-500 animate-pulse' : 'bg-white/20'}`} />
                                    <span className={`text-[9px] font-black tracking-[0.2em] uppercase ${isLobbyConnected ? 'text-cyan-500' : 'text-white/30'}`}>
                                        {isLobbyConnected ? 'Online' : 'Offline'}
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                            >
                                <FiX className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Room Info */}
                        <div className="px-8 mb-4 relative z-10 flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black tracking-[0.3em] text-white/30 uppercase">
                                    {joinedCount} of {totalSeats} Players
                                </span>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); playSelect(); if (roomCodeValue) copyText(inviteLinkFor(), 'room'); }}
                                disabled={!roomCodeValue}
                                className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-[10px] font-black tracking-[0.1em] text-white/60 uppercase hover:text-white transition-colors disabled:opacity-40"
                            >
                                {copiedKey === 'room' ? 'Link Copied!' : `Room: ${roomCodeValue || '——'}`}
                            </button>
                        </div>

                        {/* Core Context View */}
                        <div className="flex-1 w-full flex flex-col overflow-hidden relative z-10 min-h-0">
                            {view === 'console' && (
                                <div className="flex-1 min-h-0 flex flex-col gap-3 animate-in fade-in duration-200 px-8">
                                    {/* Host Card */}
                                    <div className="flex items-center gap-4 p-4 rounded-[1.75rem] bg-white/5 border border-amber-500/30 backdrop-blur-lg relative shrink-0">
                                        <div className="absolute top-3 right-4">
                                            <span className="text-[9px] text-amber-500 font-black tracking-[0.2em] uppercase">Host</span>
                                        </div>
                                        <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
                                            <DashedRadarRing color="#f59e0b" />
                                            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-amber-500/50 bg-slate-800 relative z-10">
                                                {hostAvatar ? (
                                                    <img src={hostAvatar} alt="host" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-2xl font-black text-white/30 uppercase">
                                                        {hostName?.[0] || 'H'}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-lg font-black text-white italic truncate uppercase tracking-tight">
                                                {hostName}
                                            </span>
                                            {isSelfHost && (
                                                <span className="text-[9px] font-black text-cyan-400 tracking-[0.2em] uppercase mt-0.5">You</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Guest Seats */}
                                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-2 pr-0.5 pb-1">
                                        {guestSlots.map((slot, i) => {
                                            const filled = !!slot && slot.status === 'joined';
                                            const seatNo = slot ? slot.slotIndex + 1 : i + 2;
                                            const seatKey = `seat-${i}`;
                                            return (
                                                <div
                                                    key={seatKey}
                                                    className={`flex items-center gap-3 p-3 rounded-2xl backdrop-blur-lg transition-all ${filled
                                                        ? 'bg-white/5 border border-cyan-500/30'
                                                        : 'bg-white/[0.02] border border-dashed border-white/15'
                                                        }`}
                                                >
                                                    <div className={`w-12 h-12 rounded-full overflow-hidden shrink-0 flex items-center justify-center ${filled ? 'border-2 border-white/20 bg-slate-800' : 'border border-white/10 bg-white/5'}`}>
                                                        {filled && slot?.playerAvatar ? (
                                                            <img src={slot.playerAvatar} alt="player" className="w-full h-full object-cover" />
                                                        ) : filled ? (
                                                            <span className="text-lg font-black text-white/30 uppercase">
                                                                {slot?.playerName?.[0] || 'P'}
                                                            </span>
                                                        ) : (
                                                            <PlusIcon className="w-5 h-5 text-white/20" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0 flex flex-col">
                                                        <span className={`text-sm font-black truncate uppercase italic tracking-tight ${filled ? 'text-white' : 'text-white/40'}`}>
                                                            {filled ? slot?.playerName : `Open Seat`}
                                                        </span>
                                                        <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-white/30 flex items-center gap-1.5">
                                                            {slot?.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLOR_DOT[slot.color] || '#fff' }} />}
                                                            {slot?.status === 'invited' ? 'Invite Sent…' : filled ? `Player ${seatNo} • Joined` : `Player ${seatNo}`}
                                                        </span>
                                                    </div>
                                                    {!filled && (
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                onClick={() => { playSelect(); ensureRoom(); setView('roster'); }}
                                                                className="px-3.5 py-2 bg-cyan-500/15 border border-cyan-500/30 rounded-xl text-[10px] font-black text-cyan-300 uppercase tracking-wider hover:bg-cyan-500 hover:text-slate-950 transition-all"
                                                            >
                                                                Invite
                                                            </button>
                                                            <button
                                                                onClick={() => { playSelect(); ensureRoom(); if (roomCodeValue) copyText(inviteLinkFor(slot?.slotIndex ?? i + 1), seatKey); }}
                                                                title={roomCodeValue ? 'Copy invite link for this seat' : 'Host a room first'}
                                                                className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-cyan-300 hover:border-cyan-500/40 transition-all"
                                                            >
                                                                {copiedKey === seatKey ? (
                                                                    <CheckIcon className="w-4 h-4 text-emerald-400" />
                                                                ) : (
                                                                    <LinkIcon className="w-4 h-4" />
                                                                )}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Join with Code */}
                                    <button onClick={() => { playSelect(); setView('join'); }} className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-cyan-400 transition-colors self-center shrink-0">
                                        Join with Code
                                    </button>

                                    {/* Hybrid Quick Match Trigger (host only — guests wait) */}
                                    {isHost && lobbyState && !isReady && (
                                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center shrink-0">
                                            <button onClick={(e) => { e.stopPropagation(); playSelect(); onQuickMatch(); }} className="text-[10px] font-black text-cyan-400/60 uppercase tracking-[0.2em] hover:text-cyan-400 transition-colors py-2 px-4 rounded-full border border-cyan-400/20 hover:border-cyan-400/50 bg-cyan-400/5">
                                                Fill Remaining with Quick Match
                                            </button>
                                        </motion.div>
                                    )}
                                </div>
                            )}

                            {view === 'roster' && (
                                <div className="flex-1 min-h-0 flex flex-col p-6 rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-lg overflow-hidden animate-in slide-in-from-right-4 duration-200 mx-8">
                                    <div className="flex justify-between items-center mb-4">
                                        <span className="text-[10px] font-black text-cyan-400 tracking-[0.2em] uppercase">Invite Friends</span>
                                        <button onClick={() => { playClick(); setView('console'); }} className="text-[9px] text-white/40 hover:text-white uppercase font-black flex items-center gap-2">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3"><path d="M19 12H5M12 19l-7-7 7-7"></path></svg>
                                            Back
                                        </button>
                                    </div>
                                    {roomCodeValue && (
                                        <button
                                            onClick={() => copyText(inviteLinkFor(), 'roster-link')}
                                            className="mb-4 flex items-center justify-between px-4 py-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 hover:bg-cyan-500/20 transition-all"
                                        >
                                            <span className="text-[10px] font-black text-cyan-300 uppercase tracking-widest truncate">
                                                {inviteLinkFor()}
                                            </span>
                                            {copiedKey === 'roster-link' ? (
                                                <CheckIcon className="w-4 h-4 text-emerald-400 shrink-0 ml-2" />
                                            ) : (
                                                <LinkIcon className="w-4 h-4 text-cyan-300 shrink-0 ml-2" />
                                            )}
                                        </button>
                                    )}
                                    <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-3 no-scrollbar pb-4">
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
                                                        <button onClick={() => handleInvite(f)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black text-white/60 uppercase hover:bg-cyan-500 hover:text-slate-950 transition-all">Invite</button>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="h-full flex flex-col items-center justify-center opacity-30">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-center px-4">No friends found</span>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            )}

                            {view === 'join' && (
                                <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-12 bg-white/5 mx-8 rounded-[2.5rem] border border-white/10 animate-in zoom-in-95 duration-200 overflow-y-auto no-scrollbar">
                                    <div className="text-center mb-10">
                                        <h4 className="text-2xl font-black italic text-white uppercase tracking-tighter mb-2">Join Game</h4>
                                        <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Enter room code</p>
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
                                                Join Game
                                            </button>
                                            <button onClick={() => setView('console')} className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-white">
                                                Back
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="w-full mt-4 space-y-4 px-8 relative z-10 shrink-0">
                            <div className="bg-slate-900/60 border border-white/10 px-6 py-2 rounded-full flex items-center justify-between">
                                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Mode: <span className="text-white">{modeLabel}</span></span>
                                <div className="w-1 h-3 bg-white/10 rounded-full" />
                                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Entry Fee: <span className="text-amber-400">{feeLabel}</span></span>
                            </div>

                            <button
                                onClick={() => {
                                    if (isHost && isReady) {
                                        playDiceLand();
                                        if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
                                        onStartMatch();
                                    }
                                }}
                                disabled={!isHost || !isReady}
                                className={`w-full py-5 rounded-[2rem] font-black italic tracking-widest text-lg uppercase transition-all duration-300 relative overflow-hidden border active:scale-95
                                    ${isHost && isReady
                                        ? 'bg-white text-slate-950 shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)]'
                                        : 'bg-white/5 text-white/10 border-white/5 cursor-not-allowed'
                                    }
                                `}
                            >
                                {!isHost ? 'Waiting for Host…' : isReady ? 'Start Game' : 'Waiting for Players…'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
