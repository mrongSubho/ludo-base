"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMatchmaking } from '@/hooks/useMatchmaking';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { TeamUpWrapper } from './TeamUp/TeamUpWrapper';

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
        startSearch, 
        cancelSearch, 
        startHybridSearch
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

    // Start matchmaking on mount
    // Auto-start game once P2P is connected and all slots are full
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
                                        <div className="relative w-64 h-64 flex items-center justify-center">
                                            <DashedRadarRing color={status === 'error' || status === 'timeout' ? "#ef4444" : "#22d3ee"} />
                                            
                                            {/* Pulsing Dots / Center Icon */}
                                            <div className="relative z-10 w-20 h-20 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                                                <motion.div
                                                    animate={{ 
                                                        scale: [1, 1.2, 1],
                                                        opacity: [0.5, 1, 0.5]
                                                    }}
                                                    transition={{ duration: 2, repeat: Infinity }}
                                                    className="text-4xl"
                                                >
                                                    🎲
                                                </motion.div>
                                            </div>

                                            {/* Status Text overlay */}
                                            <div className="absolute top-[80%] flex flex-col items-center gap-1">
                                                <span className={`text-[10px] uppercase font-black tracking-[0.3em] ${(status === 'error' || status === 'timeout') ? 'text-red-400' : 'text-cyan-400'} animate-pulse`}>
                                                    {status === 'error' ? 'Link Fault detected' : 
                                                     status === 'timeout' ? 'Search Timed Out' : 
                                                     status === 'expanding' ? 'Expanding Search' : 
                                                     'Scanning the Arena'}
                                                </span>
                                                <span className="text-white/20 text-[8px] uppercase font-bold tracking-widest text-center max-w-[200px]">
                                                    {status === 'error' ? 'Retrying Connection...' : 
                                                     status === 'timeout' ? 'Please try again later' :
                                                     'Searching for Rival...'}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </TeamUpWrapper>

                            {/* Expansion Options Popup */}
                            {showExpansionOptions && (
                                <div
                                    className="absolute inset-x-6 top-1/2 -translate-y-1/2 z-[150] bg-[#1c1c1c] border border-cyan-500/30 rounded-3xl p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col gap-4 pointer-events-auto"
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="text-lg font-bold text-white italic tracking-tight">Expand Search?</h3>
                                            <p className="text-[10px] text-white/40 uppercase font-black tracking-widest mt-1">Increase match success rate</p>
                                        </div>
                                        <button onClick={() => setShowExpansionOptions(false)} className="text-white/20 hover:text-white transition-colors">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 gap-2 mt-2">
                                        <button 
                                            onClick={() => handleExpandWager(20)}
                                            className="w-full py-3 px-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold text-xs hover:bg-cyan-500/20 transition-all flex justify-between items-center"
                                        >
                                            <span>Wager Range +/- 20%</span>
                                            <span className="text-[9px] opacity-60">Fast</span>
                                        </button>
                                        <button 
                                            onClick={() => handleExpandWager(50)}
                                            className="w-full py-3 px-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold text-xs hover:bg-cyan-500/20 transition-all flex justify-between items-center"
                                        >
                                            <span>Wager Range +/- 50%</span>
                                            <span className="text-[9px] opacity-60">Faster</span>
                                        </button>
                                        <button 
                                            onClick={() => handleExpandWager('any')}
                                            className="w-full py-3 px-4 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-xs hover:bg-white/10 transition-all flex justify-between items-center"
                                        >
                                            <span>Match Any Lower Fee</span>
                                            <span className="text-[9px] opacity-40">Instant</span>
                                        </button>
                                    </div>
                                    
                                    <p className="text-[9px] text-white/20 text-center italic">Original criteria search continues in background if ignored.</p>
                                </div>
                            )}

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
                                className="absolute inset-0 z-[200] bg-black bg-no-repeat bg-cover flex flex-col items-center justify-center"
                                style={{
                                    background: 'var(--ludo-bg-cosmic)',
                                    backgroundColor: '#1c1c1c'
                                }}
                            >
                                {/* Cosmic Orbs for Reveal */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] cosmic-orb opacity-30 animate-pulse-slow" />

                                <div className="relative z-10 flex flex-col items-center gap-12" style={{ pointerEvents: 'auto' }}>
                                    <div
                                        className="text-6xl md:text-8xl font-black italic text-white tracking-tighter uppercase drop-shadow-[0_0_50px_rgba(255,255,255,0.3)]"
                                    >
                                        Match!
                                    </div>

                                    <div className="flex items-center gap-8 md:gap-16">
                                        {/* Player 1 */}
                                        <div
                                            className="flex flex-col items-center gap-4"
                                        >
                                            <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-white/10 border-2 border-cyan-400/50 flex items-center justify-center p-2 relative">
                                                <div className="w-full h-full rounded-2xl overflow-hidden bg-gradient-to-br from-cyan-500/40 to-blue-600/40" />
                                                <div className="absolute -inset-1 border border-cyan-400/30 rounded-[28px] animate-pulse" />
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <span className="text-lg md:text-xl font-black text-white italic tracking-tight">{finalName}</span>
                                                <span className="text-[10px] font-black text-cyan-400 tracking-widest uppercase opacity-60">You</span>
                                            </div>
                                        </div>

                                        {/* VS Badge */}
                                        <div
                                            className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white text-black flex items-center justify-center text-2xl md:text-3xl font-black italic shadow-[0_0_40px_white]"
                                        >
                                            VS
                                        </div>

                                        {/* Opponent */}
                                        <div
                                            className="flex flex-col items-center gap-4"
                                        >
                                            <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-white/10 border-2 border-purple-400/50 flex items-center justify-center p-2 relative overflow-hidden group">
                                                <div className="w-full h-full rounded-2xl overflow-hidden bg-gradient-to-br from-purple-500/40 to-pink-600/40 relative">
                                                    <div
                                                        className="absolute inset-0 bg-white/10 animate-pulse"
                                                    />
                                                </div>

                                                <svg
                                                    className="absolute w-12 h-12 md:w-16 md:h-16 text-white/20"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                >
                                                    <rect x="3" y="8" width="18" height="10" rx="2" />
                                                    <circle cx="12" cy="4" r="2" />
                                                    <path d="M12 6v2" />
                                                    <line x1="8" y1="13" x2="8.01" y2="13" strokeWidth="3" />
                                                    <line x1="16" y1="13" x2="16.01" y2="13" strokeWidth="3" />
                                                </svg>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <h3 className="text-lg md:text-xl font-black text-white italic tracking-tighter neon-glow-cyan text-center">
                                                    Rival
                                                </h3>
                                                <div className="mt-1 bg-amber-500/20 px-3 py-0.5 rounded-full border border-amber-500/50">
                                                    <span className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">Lv. ?</span>
                                                </div>
                                            </div>
                                        </div>
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
