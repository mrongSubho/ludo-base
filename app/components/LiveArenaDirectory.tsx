"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiTv, FiX, FiEye, FiTrendingUp, FiDollarSign, FiZap } from 'react-icons/fi';
import { supabase } from '@/lib/supabase';
import { useSpectatorPresence } from '@/hooks/useSpectatorPresence';
import { useAccount } from 'wagmi';

// ─────────────────────────────────────────────────────────────
// LiveArenaDirectory — Browse & join live streaming matches
//
// Listens to `live_matches` table via Supabase Realtime for
// real-time updates. Uses useSpectatorPresence per-card to
// show live spectator counts. Matches the project's cosmic
// glassmorphism aesthetic.
// ─────────────────────────────────────────────────────────────

interface LiveMatch {
    match_id: string;
    room_code: string;
    bet_window_status: 'open' | 'closed' | 'resolving';
    spectator_count: number;
    current_bet_type: string | null;
    created_at: string;
    // from joined matches table
    game_mode?: string;
    total_bet_volume?: number;
    streaming_enabled?: boolean;
}

interface ArenaCardProps {
    match: LiveMatch;
    onWatch: (roomCode: string) => void;
}

const POT_TIERS = [
    { min: 0,      label: 'Casual',    color: '#64748b' },
    { min: 10000,  label: 'Heated',    color: '#f59e0b' },
    { min: 50000,  label: 'High Roller', color: '#f97316' },
    { min: 200000, label: 'ARENA',     color: '#ec4899' },
];

const getPotTier = (vol: number) => {
    return [...POT_TIERS].reverse().find(t => vol >= t.min) ?? POT_TIERS[0];
};

function ArenaCard({ match, onWatch }: ArenaCardProps) {
    const tier = getPotTier(match.total_bet_volume ?? 0);
    const elapsed = Math.floor((Date.now() - new Date(match.created_at).getTime()) / 60000);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="group relative cursor-pointer mb-3"
            onClick={() => onWatch(match.room_code)}
            style={{ borderRadius: '20px' }}
        >
            {/* Glow on hover */}
            <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-[20px]"
                style={{ background: `radial-gradient(ellipse at center, ${tier.color}18 0%, transparent 70%)` }}
            />

            <div
                className="relative p-4 rounded-[20px] border border-white/5 bg-white/[0.025] flex items-center gap-4"
                style={{ backdropFilter: 'blur(16px)' }}
            >
                {/* Left: Mode Badge */}
                <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border"
                    style={{
                        background: `${tier.color}20`,
                        borderColor: `${tier.color}40`,
                        boxShadow: `0 0 20px ${tier.color}20`,
                    }}
                >
                    <FiTv className="w-5 h-5" style={{ color: tier.color }} />
                </div>

                {/* Center: Match Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-black italic text-white uppercase tracking-tight">
                            {match.game_mode?.toUpperCase() ?? 'CLASSIC'}
                        </span>
                        {/* Bet window open indicator */}
                        {match.bet_window_status === 'open' && (
                            <span
                                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
                                style={{ background: '#10b98120', color: '#10b981', border: '1px solid #10b98140' }}
                            >
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                Betting Live
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-3 mt-1">
                        {/* Pot */}
                        <span className="flex items-center gap-1 text-[10px] font-black" style={{ color: tier.color }}>
                            <FiDollarSign className="w-3 h-3" />
                            {(match.total_bet_volume ?? 0).toLocaleString()}
                            <span className="text-[9px] font-medium text-white/30 ml-0.5">{tier.label}</span>
                        </span>

                        <span className="text-white/10 text-xs">·</span>

                        {/* Spectators */}
                        <span className="flex items-center gap-1 text-[10px] font-medium text-white/40">
                            <FiEye className="w-3 h-3" />
                            {match.spectator_count > 999
                                ? `${(match.spectator_count / 1000).toFixed(1)}k`
                                : match.spectator_count}
                        </span>

                        <span className="text-white/10 text-xs">·</span>

                        <span className="text-[9px] font-medium text-white/25 uppercase">
                            {elapsed < 1 ? 'Just started' : `${elapsed}m live`}
                        </span>
                    </div>
                </div>

                {/* Right: Watch button */}
                <button
                    className="px-4 py-2 rounded-full text-[10px] font-black italic uppercase tracking-tighter transition-all hover:scale-105 active:scale-95 flex-shrink-0"
                    style={{
                        background: tier.color,
                        color: '#000',
                        boxShadow: `0 0 16px ${tier.color}60`,
                    }}
                >
                    Watch
                </button>
            </div>
        </motion.div>
    );
}

interface LiveArenaDirectoryProps {
    onWatchMatch?: (roomCode: string) => void;
}

export const LiveArenaDirectory = ({ onWatchMatch }: LiveArenaDirectoryProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
    const { address } = useAccount();

    const fetchMatches = useCallback(async () => {
        const { data } = await supabase
            .from('live_matches')
            .select(`
                match_id, room_code, bet_window_status, spectator_count,
                current_bet_type, created_at,
                matches!inner (game_mode, total_bet_volume, streaming_enabled)
            `)
            .order('spectator_count', { ascending: false })
            .limit(20);

        if (data) {
            const mapped: LiveMatch[] = data.map((row: any) => ({
                ...row,
                game_mode: row.matches?.game_mode,
                total_bet_volume: row.matches?.total_bet_volume ?? 0,
                streaming_enabled: row.matches?.streaming_enabled,
            }));
            setLiveMatches(mapped);
        }
    }, []);

    useEffect(() => {
        fetchMatches();

        // Live updates
        const channel = supabase
            .channel('live-arena-directory')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, () => {
                fetchMatches();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchMatches]);

    const handleWatch = useCallback((roomCode: string) => {
        setIsOpen(false);
        onWatchMatch?.(roomCode);
    }, [onWatchMatch]);

    return (
        <>
            {/* ── Ticker Trigger Button ── */}
            <div className="fixed bottom-[110px] left-0 right-0 flex justify-center pointer-events-none z-[60] px-4">
                <div
                    className="pointer-events-auto h-[64px] w-full max-w-[480px] rounded-2xl flex items-center justify-between px-5 relative overflow-hidden transition-all group cursor-pointer border border-cyan-500/20 bg-black/60 backdrop-blur-3xl hover:border-cyan-400/50 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)] active:scale-[0.98]"
                    onClick={() => setIsOpen(true)}
                >
                    {/* Cyber grid bg */}
                    <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.8)_50%)] bg-[length:100%_4px] opacity-20 pointer-events-none" />
                    <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

                    <div className="flex items-center gap-3 relative z-10">
                        <div className="w-10 h-10 rounded-xl border border-cyan-500/30 bg-cyan-950/50 flex items-center justify-center overflow-hidden shadow-[inset_0_0_15px_rgba(34,211,238,0.2)] relative">
                            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(34,211,238,0.2)_50%,transparent_100%)] w-[200%] animate-[scan_2s_linear_infinite]" />
                            <FiTv className="w-4 h-4 text-cyan-300 relative z-10" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black text-cyan-500/70 uppercase tracking-[0.3em] drop-shadow-[0_0_5px_rgba(34,211,238,0.3)]">MCP Stream Node</span>
                            <div className="flex items-center gap-2 mt-0.5">
                                <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse" />
                                <span className="text-[11px] font-black text-cyan-300 uppercase tracking-widest leading-none">
                                    {liveMatches.length > 0 ? `${liveMatches.length} Links Active` : 'No Links Active'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Scrolling match ticker */}
                    {liveMatches.length > 0 && (
                        <div className="flex-1 max-w-[240px] flex overflow-hidden ml-6 relative z-10">
                            {/* Fade edges */}
                            <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-black/60 to-transparent z-20 pointer-events-none" />
                            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-black/60 to-transparent z-20 pointer-events-none" />
                            
                            <div className="animate-marquee whitespace-nowrap flex gap-8 items-center">
                                {liveMatches.map((m, i) => (
                                    <span key={i} className="text-[10px] font-black text-white/80 uppercase tracking-widest flex items-center gap-2">
                                        <div className="w-1 h-1 bg-pink-500 animate-pulse rounded-full" />
                                        {m.game_mode?.substring(0,3).toUpperCase()}
                                        <span className="text-cyan-400">{(m.total_bet_volume ?? 0).toLocaleString()} VOL</span>
                                        <span className="text-white/30 font-bold ml-1 flex items-center gap-1">
                                            <FiEye className="w-2.5 h-2.5" />{m.spectator_count}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-3 relative z-10 ml-auto">
                        <div className="h-6 w-[1px] bg-cyan-500/20" />
                        <div className="flex flex-col items-end justify-center h-full">
                            <span className="text-[8px] font-black text-cyan-500/50 uppercase tracking-[0.2em] leading-tight">System</span>
                            <span className="text-[10px] font-black text-cyan-300 uppercase tracking-widest leading-tight">Access</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Full Panel ── */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[100] bg-black/40"
                            onClick={() => setIsOpen(false)}
                        />

                        <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                            <div className="w-full max-w-[500px] relative h-full">
                                <motion.div
                                    initial={{ opacity: 0, y: 24, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 24, scale: 0.98 }}
                                    transition={{ type: 'spring', damping: 24, stiffness: 300 }}
                                    className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-cyan-500/20 rounded-[32px] flex flex-col shadow-[0_0_50px_rgba(34,211,238,0.1)] overflow-hidden"
                                >
                                    {/* Immersive Stage Environment Background */}
                                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                                        {/* Stage Background */}
                                        <div className="absolute inset-0 bg-[#020205]" />
                                        <div className="absolute inset-0 bg-gradient-to-b from-blue-900/10 via-transparent to-black" />
                                        
                                        {/* Top Spotlights */}
                                        <div className="absolute -top-24 -left-20 w-[400px] h-[600px] bg-cyan-400/10 blur-[100px] rotate-45 transform-gpu" />
                                        <div className="absolute -top-24 -right-20 w-[400px] h-[600px] bg-pink-400/10 blur-[100px] -rotate-45 transform-gpu" />
                                        
                                        {/* Sharp Beam Lights */}
                                        <div className="absolute top-0 left-1/4 w-[1px] h-full bg-gradient-to-b from-cyan-400/40 to-transparent rotate-[15deg] blur-[2px]" />
                                        <div className="absolute top-0 right-1/4 w-[1px] h-full bg-gradient-to-b from-pink-400/40 to-transparent -rotate-[15deg] blur-[2px]" />

                                        {/* Audience Silhouettes at bottom */}
                                        <div className="absolute bottom-0 left-0 right-0 h-32 z-20">
                                            <div className="absolute bottom-0 left-0 right-0 h-16 bg-black" />
                                            <div className="absolute bottom-0 left-0 right-0 h-24 flex items-end justify-around px-4 opacity-80">
                                                {[...Array(12)].map((_, i) => (
                                                    <motion.div
                                                        key={i}
                                                        animate={{ y: [0, -2, 0] }}
                                                        transition={{ duration: 3 + i, repeat: Infinity, ease: "easeInOut" }}
                                                        className="w-8 h-12 bg-black rounded-t-full relative"
                                                        style={{ 
                                                            marginLeft: i % 2 === 0 ? '-10px' : '0px',
                                                            opacity: 0.6 + (i % 4) * 0.1
                                                        }}
                                                    >
                                                        {/* Rim light on heads */}
                                                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent rounded-full" />
                                                    </motion.div>
                                                ))}
                                            </div>
                                            <div className="absolute bottom-4 left-0 right-0 h-32 bg-gradient-to-t from-black via-black/80 to-transparent" />
                                        </div>

                                        {/* Laser Scanlines */}
                                        <div className="absolute inset-0 opacity-[0.05] bg-[linear-gradient(transparent_50%,rgba(0,0,0,1)_50%)] bg-[length:100%_4px]" />
                                    </div>

                                    <motion.div 
                                        style={{ 
                                            perspective: '1200px',
                                            transformStyle: 'preserve-3d'
                                        }}
                                        className="relative h-full w-full flex flex-col"
                                    >
                                        <motion.div
                                            style={{ 
                                                rotateX: 1,
                                                scale: 1.02,
                                                transformOrigin: 'top'
                                            }}
                                            className="flex-1 flex flex-col"
                                        >
                                            {/* Header */}
                                            <div className="w-full flex justify-between items-center p-8 relative z-10 border-b border-white/5 bg-white/[0.01]">
                                                <div>
                                                    <h3 className="text-transparent bg-clip-text bg-gradient-to-r from-white to-cyan-200 font-black italic text-3xl tracking-tighter uppercase drop-shadow-[0_0_15px_rgba(34,211,238,0.8)]">
                                                        Live Arena Node
                                                    </h3>
                                                    <div className="flex items-center gap-3 mt-1.5 text-cyan-400/60">
                                                        <span className="text-[10px] font-black tracking-[0.4em] uppercase">Status: Connected</span>
                                                        <div className="w-1 h-1 bg-cyan-400 animate-pulse rounded-full" />
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => setIsOpen(false)}
                                                    className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-500/50 hover:text-cyan-400 hover:bg-cyan-500/20 hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all"
                                                >
                                                    <FiX className="w-5 h-5" />
                                                </button>
                                            </div>

                                            {/* Stats bar */}
                                            <div className="px-8 py-3 flex items-center gap-6 relative z-10 bg-white/[0.01] border-b border-white/5">
                                                <div className="flex items-center gap-2">
                                                    <FiEye className="w-3.5 h-3.5 text-cyan-200/50" />
                                                    <span className="text-[10px] font-black text-cyan-200/50 uppercase tracking-widest">
                                                        {liveMatches.reduce((s, m) => s + m.spectator_count, 0).toLocaleString()} Linked
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <FiTrendingUp className="w-3.5 h-3.5 text-pink-400/60" />
                                                    <span className="text-[10px] font-black text-pink-400/60 uppercase tracking-widest">
                                                        {liveMatches.reduce((s, m) => s + (m.total_bet_volume ?? 0), 0).toLocaleString()} Total Value Locked
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Match list */}
                                            <div className="flex-1 overflow-y-auto px-8 pt-4 pb-8 relative z-10 custom-scrollbar">
                                                <AnimatePresence>
                                                    {liveMatches.length > 0 ? (
                                                        liveMatches.map(match => (
                                                            <ArenaCard
                                                                key={match.match_id}
                                                                match={match}
                                                                onWatch={handleWatch}
                                                            />
                                                        ))
                                                    ) : (
                                                        <motion.div
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            className="h-full flex flex-col items-center justify-center text-cyan-500/20 py-20 gap-4"
                                                        >
                                                            <div className="relative">
                                                                <FiTv className="w-16 h-16 opacity-30" />
                                                                <div className="absolute inset-0 border border-cyan-500/20 rounded-lg animate-[spin_4s_linear_infinite]" />
                                                            </div>
                                                            <div className="flex flex-col items-center gap-1">
                                                                <p className="text-[11px] font-black uppercase tracking-[0.4em] text-cyan-300 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">No Active Datastreams</p>
                                                                <p className="text-[9px] font-medium text-cyan-200/40 uppercase tracking-wider">Awaiting match initiation phase</p>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </motion.div>
                                    </motion.div>

                                    <div className="w-full p-6 bg-black/50 border-t border-cyan-500/10 text-center relative z-20 flex flex-col gap-1 items-center">
                                        <div className="w-1/3 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent mb-1" />
                                        <span className="text-[9px] font-black text-cyan-200/30 uppercase tracking-[0.4em]">
                                            MCP GambleFi Spectator Node · Secure Uplink
                                        </span>
                                    </div>
                                </motion.div>
                            </div>
                        </div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
};
