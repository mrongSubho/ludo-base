"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMatchmaking } from '@/hooks/useMatchmaking';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { TeamUpWrapper } from './TeamUp/TeamUpWrapper';
import { supabase } from '@/lib/supabase';

const PRO_TIPS = [
    "Safe zones protect you from capture!",
    "Capture opponents to get a bonus roll!",
    "Win to climb the global leaderboard!",
    "Use power-ups strategically to gain an edge.",
    "Rolling a 6 gives you an extra turn!",
    "Block your opponents to slow them down."
];

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

interface QuickMatchPanelProps {
    gameMode: 'classic' | 'power';
    matchType: '1v1' | '2v2' | '4P';
    wager: number;
    onStartGame: (isBotMatch?: boolean) => void;
    onCancel: () => void;
    isHybrid?: boolean;
    roomCode?: string;
    slotsNeeded?: number;
}

export const QuickMatchPanel = ({
    gameMode,
    matchType,
    wager,
    onStartGame,
    onCancel,
    isHybrid = false,
    roomCode,
    slotsNeeded = 1
}: QuickMatchPanelProps) => {
    const { address, profile, displayName: finalName } = useCurrentUser();
    const { 
        status, 
        searchTime, 
        ticketId,
        matchId: hookMatchId,
        roomCode: hookRoomCode,
        startSearch, 
        startHybridSearch, 
        cancelSearch 
    } = useMatchmaking({
        playerId: address || '',
        gameMode,
        matchType,
        wager,
        onMatchFound: (matchId: string, foundRoomCode: string, isMatchHost: boolean) => {
            console.log(`🎲 [Matchmaking] Match Found! MatchId: ${matchId}, Room: ${foundRoomCode}, Host: ${isMatchHost}`);
            if (isMatchHost) {
                hostGame(matchType, gameMode, wager, undefined, foundRoomCode);
            } else {
                joinGame(foundRoomCode);
            }
        }
    });

    const { 
        roomId, 
        hostGame, 
        joinGame, 
        isLobbyConnected, 
        isHost: p2pHost,
        lobbyState
    } = useTeamUpContext();
    const [tipIndex, setTipIndex] = useState(0);
    const [hasExpanded, setHasExpanded] = useState(false);
    const [showExpansionOptions, setShowExpansionOptions] = useState(false);
    const [wagerRange, setWagerRange] = useState<{ min: number; max?: number } | null>(null);
    const [opponentProfile, setOpponentProfile] = useState<{ username: string; avatar_url: string | null } | null>(null);
    const [isLoadingRival, setIsLoadingRival] = useState(false);

    // Show expansion options at 16s if not already expanded
    useEffect(() => {
        if (searchTime === 16 && !hasExpanded) {
            setShowExpansionOptions(true);
        }
    }, [searchTime, hasExpanded]);

    // Tip rotation
    useEffect(() => {
        const interval = setInterval(() => {
            setTipIndex((prev) => (prev + 1) % PRO_TIPS.length);
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (status === 'matched' && isLobbyConnected && p2pHost) {
            const joinedCount = lobbyState?.slots.filter(s => s.status === 'joined').length || 0;
            const targetCount = matchType === '1v1' ? 2 : (matchType === '2v2' ? 4 : 4);
            
            if (joinedCount >= targetCount) {
                console.log('🚀 [QuickMatch] P2P Mesh ready. Auto-starting game...');
                onStartGame(false);
            }
        }
    }, [status, isLobbyConnected, p2pHost, lobbyState, matchType, onStartGame]);

    // Use roomCode from hook preferentially (it updates dynamically during match)
    const activeRoomCode = hookRoomCode || roomCode;

    // Fetch Opponent Profile when matched
    useEffect(() => {
        if (status === 'matched' && activeRoomCode) {
            const fetchOpponentData = async () => {
                setIsLoadingRival(true);
                try {
                    // 1. Get match participants
                    const { data: match, error: matchError } = await supabase
                        .from('matches')
                        .select('participants')
                        .eq('room_code', activeRoomCode)
                        .maybeSingle();

                    if (matchError || !match || !match.participants) throw new Error('Match record not found or no participants');

                    // 2. Find opponent's address (case-insensitive find)
                    const normalizedMyAddress = address?.toLowerCase();
                    const opponentAddress = match.participants.find((p: string) => p.toLowerCase() !== normalizedMyAddress);

                    if (opponentAddress) {
                        // 3. Fetch opponent profile
                        const { data: player, error: playerError } = await supabase
                            .from('players')
                            .select('username, avatar_url')
                            .eq('wallet_address', opponentAddress.toLowerCase())
                            .maybeSingle();

                        if (player) {
                            setOpponentProfile({
                                username: player.username || 'Rival',
                                avatar_url: player.avatar_url
                            });
                        }
                    }
                } catch (err) {
                    console.error('❌ [QuickMatch] Error fetching rival data:', err);
                } finally {
                    setIsLoadingRival(false);
                }
            };
            fetchOpponentData();
        } else if (status !== 'matched') {
            setOpponentProfile(null);
        }
    }, [status, roomCode, address]);

    useEffect(() => {
        if (isHybrid && roomCode) {
            startHybridSearch(roomCode, slotsNeeded, matchType);
        } else {
            startSearch();
        }

        return () => {
            cancelSearch();
        };
    }, []);

    const handleBackToLobby = () => {
        cancelSearch();
        onCancel();
    };

    const handleForceBotMatch = () => {
        cancelSearch();
        onStartGame(true);
    };

    const handleCancelAndClose = () => {
        cancelSearch();
        onCancel();
    };

    const handleExpandWager = (percent: number | 'any') => {
        setHasExpanded(true);
        setShowExpansionOptions(false);
        
        let min = 0;
        let max: number | undefined = undefined;

        if (percent === 20) {
            min = Math.floor(wager * 0.8);
            max = Math.floor(wager * 1.2);
        } else if (percent === 50) {
            min = Math.floor(wager * 0.5);
            max = Math.floor(wager * 1.5);
        } else if (percent === 'any') {
            min = 0;
            max = wager; // Match with any lower fee
        }

        setWagerRange({ min, max });
        console.log(`📡 [Matchmaking] Expanding search range: ${min} - ${max || 'Infinity'}`);
        startSearch(min, max);
    };

    const handleRetry = () => {
        setHasExpanded(false);
        setWagerRange(null);
        startSearch();
    };

    const isSearching = status === 'searching' || status === 'expanding';

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={handleCancelAndClose}
            />

            {/* Clipped Container */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        /* Unified global panel layout: top-64, bottom-80 sandwich */
                        className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-y-auto pb-[40px]"
                        style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                    >
                        {/* Authentic Subdued Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        {/* Header / Title */}
                        <div className="w-full flex justify-center pt-4 pb-2">
                            <div className="w-12 h-1.5 bg-white/20 rounded-full cursor-pointer" onClick={handleCancelAndClose} />
                        </div>

                        <div className="px-panel-gutter pb-4 border-b border-white/10">
                            <div className="flex items-center justify-between mt-2">
                                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                    <span className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 2s-8 11.5-8 16c0 4.4 3.6 8 8 8s8-3.6 8-8c0-4.5-8-16-8-16z"></path></svg>
                                    </span>
                                    Quick Match
                                </h2>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] uppercase font-black tracking-widest text-white/40">Entry Fee</span>
                                    <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                                        <span>{wager}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Dynamic Matchmaking Content */}
                        <div className="flex-1 overflow-hidden flex flex-col items-center justify-center relative px-6">
                            <TeamUpWrapper
                                mode="quick"
                                entryFee={wager}
                            >
                                <div className="flex flex-col items-center justify-center w-full h-full min-h-[300px] relative">
                                    {/* Radar System Visual - Persistent while searching or error */}
                                    {status !== 'idle' && status !== 'matched' && (
                                        <div className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center">
                                            {/* 1. Outer Rotating Ring (Slow) */}
                                            <motion.div
                                                animate={{ rotate: 360 }}
                                                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                                                className="absolute inset-0 border-2 border-dashed border-cyan-500/20 rounded-full"
                                            />

                                            {/* 2. Middle Pulsing Sonar */}
                                            <motion.div
                                                animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.3, 0.1] }}
                                                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                                                className="absolute inset-10 border border-white/10 rounded-full"
                                            />

                                            {/* 3. Fast Counter-Rotating Dash Ring */}
                                            <motion.div
                                                animate={{ rotate: -360 }}
                                                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                                                className="absolute inset-16 border border-dotted border-cyan-400/40 rounded-full"
                                            />

                                            {/* 4. Scanner Sweep (Conic Gradient) */}
                                            <motion.div
                                                animate={{ rotate: 360 }}
                                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                                className="absolute inset-0 rounded-full"
                                                style={{
                                                    background: 'conic-gradient(from 0deg, transparent 70%, rgba(34, 211, 238, 0.2) 100%)'
                                                }}
                                            />

                                            {/* 5. Central Data Core (Timer) */}
                                            <div className="relative z-10 w-24 h-24 md:w-32 md:h-32 bg-white/5 rounded-full border border-white/10 flex flex-col items-center justify-center backdrop-blur-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] group overflow-hidden">
                                                {/* Inner Glow Surround */}
                                                <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 to-blue-500/10 opacity-50 group-hover:opacity-80 transition-opacity" />
                                                
                                                {/* Scanning Line Animation */}
                                                <motion.div 
                                                    animate={{ top: ['-10%', '110%'] }}
                                                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                                    className="absolute left-0 right-0 h-[1px] bg-cyan-400/30 z-20 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
                                                />

                                                <div className="relative z-30 flex flex-col items-center">
                                                    <span className="text-2xl md:text-3xl font-mono font-black text-cyan-400 tracking-tighter drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                                                        {searchTime}s
                                                    </span>
                                                    <span className="text-[8px] font-black text-white/30 tracking-[0.2em] uppercase mt-1">
                                                        Time
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Status Text overlay */}
                                            <div className="absolute top-[85%] flex flex-col items-center gap-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                                                    <span className={`text-[10px] uppercase font-black tracking-[0.3em] ${(status === 'error' || status === 'timeout') ? 'text-red-400' : 'text-cyan-400'}`}>
                                                        {status === 'error' ? 'FAULT DETECTED' : 
                                                         status === 'timeout' ? 'LINK TIMEOUT' : 
                                                         status === 'expanding' ? 'EXPANDING RANGE' : 
                                                         'SCANNING ARENA'}
                                                    </span>
                                                </div>
                                                <span className="text-white/20 text-[8px] uppercase font-bold tracking-widest text-center max-w-[200px] italic">
                                                    {status === 'error' ? 'Retrying Link...' : 
                                                     status === 'timeout' ? 'Connection Unstable' :
                                                     `TICKET: ${ticketId?.slice(0, 8) || 'INITIALIZING'}`}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </TeamUpWrapper>
                            {/* Smart Expansion Suggestion Dock */}
                            <AnimatePresence>
                                {showExpansionOptions && (
                                    <motion.div
                                        initial={{ y: 100, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        exit={{ y: 100, opacity: 0 }}
                                        className="absolute bottom-32 inset-x-4 z-[150] bg-[#1c1c1c]/80 backdrop-blur-2xl border border-cyan-500/20 rounded-2xl p-4 shadow-[0_-20px_40px_rgba(0,0,0,0.4)] flex flex-col gap-3 pointer-events-auto"
                                    >
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                                <h3 className="text-[10px] font-black text-white/80 uppercase tracking-[0.2em] italic">Match Optimizer</h3>
                                            </div>
                                            <button 
                                                onClick={() => setShowExpansionOptions(false)} 
                                                className="w-5 h-5 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/20 hover:text-white transition-all"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                            </button>
                                        </div>
                                        
                                        <div className="flex flex-wrap gap-2">
                                            <button 
                                                onClick={() => handleExpandWager(20)}
                                                className="flex-1 py-2 px-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all flex flex-col items-center justify-center gap-0.5 group"
                                            >
                                                <span className="text-[10px] font-black text-cyan-400">±20%</span>
                                                <span className="text-[7px] text-cyan-400/40 uppercase font-bold tracking-widest group-hover:text-cyan-400/60">Fast</span>
                                            </button>
                                            <button 
                                                onClick={() => handleExpandWager(50)}
                                                className="flex-1 py-2 px-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all flex flex-col items-center justify-center gap-0.5 group"
                                            >
                                                <span className="text-[10px] font-black text-cyan-400">±50%</span>
                                                <span className="text-[7px] text-cyan-400/40 uppercase font-bold tracking-widest group-hover:text-cyan-400/60">Faster</span>
                                            </button>
                                            <button 
                                                onClick={() => handleExpandWager('any')}
                                                className="flex-[1.2] py-2 px-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex flex-col items-center justify-center gap-0.5 group"
                                            >
                                                <span className="text-[10px] font-black text-white">MATCH ANY</span>
                                                <span className="text-[7px] text-white/20 uppercase font-bold tracking-widest group-hover:text-white/40">Instant</span>
                                            </button>
                                        </div>
                                        
                                        <p className="text-[8px] text-white/20 text-center font-bold tracking-tight px-2">
                                            Search density is low. Expand criteria to find players quicker.
                                        </p>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Timeout / Server Quiet Screen */}
                            {status === 'timeout' && (
                                <div
                                    className="absolute inset-0 z-[160] bg-[#0d0d0d]/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center pointer-events-auto"
                                >
                                    <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mb-6 border border-amber-500/20">
                                        <span className="text-3xl animate-pulse">📡</span>
                                    </div>
                                    
                                    <h3 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">
                                        Server is Quiet
                                    </h3>
                                    <p className="text-sm text-white/40 font-medium mb-8 max-w-[240px]">
                                        No players found matching your criteria. It's a bit lonely out here!
                                    </p>
                                    
                                    <div className="w-full flex flex-col gap-3">
                                        <button 
                                            onClick={() => startSearch()}
                                            className="w-full py-4 rounded-2xl bg-white text-black font-bold hover:scale-[1.02] transition-all active:scale-98"
                                        >
                                            Retry Search
                                        </button>
                                        
                                        <div className="p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/10 flex flex-col gap-3">
                                            <p className="text-[10px] text-cyan-400/60 font-medium uppercase tracking-widest leading-relaxed">
                                                Strongly advise practicing in <span className="text-cyan-400">Offline Mode</span> to sharpen your strategy and skills.
                                            </p>
                                            <button 
                                                onClick={handleForceBotMatch}
                                                className="w-full py-3 rounded-xl bg-cyan-500/20 text-cyan-400 font-bold text-xs hover:bg-cyan-500/30 transition-all"
                                            >
                                                Play with AI
                                            </button>
                                        </div>
                                        
                                        <button 
                                            onClick={handleBackToLobby}
                                            className="text-[10px] uppercase font-black tracking-widest text-white/20 hover:text-white/40 mt-2"
                                        >
                                            Back to Menu
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Tip Section */}
                            <div className="absolute bottom-8 left-0 right-0 px-8">
                                <div
                                    key={tipIndex}
                                    className="flex flex-col items-center gap-2"
                                >
                                    <span className="text-[10px] uppercase font-black tracking-[0.3em] text-cyan-400/60">Pro Tip</span>
                                    <p className="text-sm font-medium text-white/50 text-center max-w-[280px] leading-relaxed">
                                        {PRO_TIPS[tipIndex]}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Single Control Action */}
                        <div className="mt-auto px-panel-gutter pb-panel-gutter pt-4 border-t border-white/5 bg-black/20 backdrop-blur-sm relative z-10">
                            <button
                                onClick={handleBackToLobby}
                                className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-2 group"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-white/40 group-hover:text-white transition-colors"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                Cancel Search
                            </button>

                            <div className="text-center mt-3">
                                <button
                                    onClick={handleForceBotMatch}
                                    className="text-[10px] uppercase font-black tracking-widest text-white/20 hover:text-cyan-400/60 transition-colors"
                                >
                                    Play vs Bots Instead
                                </button>
                            </div>
                        </div>

                        {/* Search Reveal Overlay */}
                        {status === 'matched' && (
                            <div
                                className="absolute inset-0 z-[200] flex flex-col items-center justify-center p-6 text-center"
                                style={{
                                    background: 'var(--ludo-bg-cosmic)',
                                    backgroundColor: 'rgba(13,13,13,0.85)',
                                    backdropFilter: 'blur(40px)'
                                }}
                            >
                                {/* Cosmic Orbs for Reveal */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] cosmic-orb opacity-30 animate-pulse-slow pointer-events-none" />

                                {/* Close Button */}
                                <button
                                    onClick={handleCancelAndClose}
                                    className="absolute top-8 right-8 w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-all z-[210] pointer-events-auto"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>

                                <div className="relative z-10 flex flex-col items-center gap-10 w-full" style={{ pointerEvents: 'auto' }}>
                                    <div className="flex flex-col items-center gap-2">
                                        <div
                                            className="text-6xl md:text-8xl font-black italic text-white tracking-tighter uppercase drop-shadow-[0_0_50px_rgba(255,255,255,0.3)]"
                                        >
                                            Match!
                                        </div>
                                        <div className="px-5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center gap-3">
                                            <span className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.2em]">{matchType} Match</span>
                                            <div className="w-1 h-3 bg-white/10 rounded-full" />
                                            <span className="text-[10px] font-black text-white/60 uppercase tracking-[0.2em]">{gameMode} Mode</span>
                                            <div className="w-1 h-3 bg-white/10 rounded-full" />
                                            <div className="flex items-center gap-1">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                                                <span className="text-[10px] font-black text-amber-400 tracking-[0.1em]">{wager.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-around w-full max-w-md">
                                        {/* Player 1 (You) */}
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="relative">
                                                <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-white/10 border-2 border-cyan-400/50 flex items-center justify-center p-2">
                                                    <div className="w-full h-full rounded-2xl overflow-hidden bg-slate-800">
                                                        {profile?.avatar_url ? (
                                                            <img src={profile.avatar_url} alt="You" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full bg-gradient-to-br from-cyan-500/40 to-blue-600/40 flex items-center justify-center text-3xl font-black text-white/20">
                                                                {finalName?.[0] || 'U'}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="absolute -inset-1 border border-cyan-400/30 rounded-[28px] animate-pulse pointer-events-none" />
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <span className="text-lg md:text-xl font-black text-white italic tracking-tight">{finalName}</span>
                                                <span className="text-[10px] font-black text-cyan-400 tracking-widest uppercase opacity-60">You</span>
                                            </div>
                                        </div>

                                        {/* VS Badge */}
                                        <div className="flex flex-col items-center gap-4">
                                            <div
                                                className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white text-black flex items-center justify-center text-2xl md:text-3xl font-black italic shadow-[0_0_40px_white]"
                                            >
                                                VS
                                            </div>
                                        </div>

                                        {/* Opponent */}
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="relative">
                                                <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-white/10 border-2 border-purple-400/50 flex items-center justify-center p-2">
                                                    <div className="w-full h-full rounded-2xl overflow-hidden bg-slate-800 flex items-center justify-center">
                                                        {isLoadingRival ? (
                                                            <div className="w-8 h-8 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                                                        ) : opponentProfile?.avatar_url ? (
                                                            <img src={opponentProfile.avatar_url} alt="Rival" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full bg-gradient-to-br from-purple-500/40 to-pink-600/40 flex items-center justify-center">
                                                                <svg
                                                                    className="w-12 h-12 md:w-16 md:h-16 text-white/20"
                                                                    viewBox="0 0 24 24"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    strokeWidth="2"
                                                                >
                                                                    <rect x="3" y="8" width="18" height="10" rx="2" />
                                                                    <circle cx="12" cy="4" r="2" />
                                                                    <path d="M12 6v2" />
                                                                </svg>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                {!isLoadingRival && <div className="absolute -inset-1 border border-purple-400/30 rounded-[28px] animate-pulse pointer-events-none" />}
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <h3 className="text-lg md:text-xl font-black text-white italic tracking-tighter text-center">
                                                    {isLoadingRival ? 'Scanning...' : (opponentProfile?.username || 'Rival')}
                                                </h3>
                                                <div className="mt-1 bg-amber-500/10 px-3 py-0.5 rounded-full border border-amber-500/30">
                                                    <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest">Lv. ?</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Connection Status Subtext */}
                                    <div className="mt-4 flex flex-col items-center gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex gap-1.5">
                                                {[0, 1, 2].map(i => (
                                                    <motion.div
                                                        key={i}
                                                        animate={{ opacity: [0.2, 1, 0.2] }}
                                                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                                                        className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                                                    />
                                                ))}
                                            </div>
                                            <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Establishing P2P Secure Link</span>
                                        </div>

                                        <button
                                            onClick={handleCancelAndClose}
                                            className="px-8 py-3 rounded-full bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all text-[10px] font-black uppercase tracking-[0.2em]"
                                        >
                                            Cancel Match
                                        </button>
                                        
                                        <p className="max-w-[280px] text-[9px] text-white/20 italic leading-relaxed">
                                            Safe Exit: No coins will be lost before the game board loads. If the match fails to sync, you will be returned to the lobby.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};
