"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiTv, FiEye, FiDollarSign } from 'react-icons/fi';
import { supabase } from '@/lib/supabase';
import { useSpectatorPresence } from '@/hooks/useSpectatorPresence';
import { useAccount } from 'wagmi';

// ─────────────────────────────────────────────────────────────
// LiveArenaDirectory — Browse & join live streaming matches
//
// Listens to `live_matches` table via Supabase Realtime for
// real-time updates. Uses useSpectatorPresence per-card to
// show live spectator counts.
// ─────────────────────────────────────────────────────────────
//
// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as the other synced panels: the full panel renders on the shared
// dark-glass sandwich shell, so content uses only white-ink + white-opacity
// surfaces + cyan/status accents (pot-tier colors are data-driven and kept).
// No font-family is set (inherits the active theme's display font). Spacing
// inside `.ludo-livearena-scope` is re-asserted in globals.css (the global
// unlayered reset zeroes Tailwind utilities).

// Icon tile: cyan glow square shared with the other synced panels.
export const LiveTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <FiTv className="w-4 h-4 text-cyan-300" />
    </div>
);

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
            style={{ borderRadius: '16px' }}
        >
            {/* Glow on hover */}
            <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl"
                style={{ background: `radial-gradient(ellipse at center, ${tier.color}18 0%, transparent 70%)` }}
            />

            <div
                className="relative p-4 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center gap-4"
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
                        <span className="text-xs font-bold text-white uppercase tracking-wide">
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
                        {match.bet_window_status === 'resolving' && (
                            <span
                                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
                                style={{ background: '#f59e0b20', color: '#f59e0b', border: '1px solid #f59e0b40' }}
                            >
                                <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                                Settling
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
                    className="px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all hover:scale-105 active:scale-95 flex-shrink-0"
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

interface LiveArenaContentProps {
    onWatchMatch?: (roomCode: string) => void;
    onStats?: (live: number, watching: number, vol: number) => void;
}

export const LiveArenaContent = ({ onWatchMatch, onStats }: LiveArenaContentProps) => {
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
            // Sportsbook order: betting-open first, then volume, then newest.
            const rank: Record<string, number> = { open: 0, resolving: 1, closed: 2 };
            mapped.sort((a, b) =>
                (rank[a.bet_window_status] ?? 2) - (rank[b.bet_window_status] ?? 2) ||
                (b.total_bet_volume ?? 0) - (a.total_bet_volume ?? 0) ||
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
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
        onWatchMatch?.(roomCode);
    }, [onWatchMatch]);

    // Report header stats up (panel header owns title + counts).
    const watching = liveMatches.reduce((s, m) => s + m.spectator_count, 0);
    const vol = liveMatches.reduce((s, m) => s + (m.total_bet_volume ?? 0), 0);
    useEffect(() => {
        onStats?.(liveMatches.length, watching, vol);
    }, [liveMatches, watching, vol, onStats]);

    return (
        <div className="flex-1 min-h-0 flex flex-col relative z-10">
            {/* Inline in the Arena panel — the panel header owns title + stats,
                so this renders just the match list. */}
                                            {/* Match list */}
                                            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-10">
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
                                                            className="flex flex-col items-center justify-center text-center py-16 px-6 gap-2"
                                                        >
                                                            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-1 text-white/25">
                                                                <FiTv className="w-7 h-7" />
                                                            </div>
                                                            <p className="text-white font-black text-sm">No live matches</p>
                                                            <p className="text-white/40 text-xs max-w-[220px]">Awaiting match initiation phase</p>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>

                                    <div className="w-full px-5 py-3 bg-black/20 border-t border-white/10 text-center relative z-20 flex flex-col gap-1 items-center">
                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">
                                            Spectating is read-only • Wagers stay safe
                                        </span>
                                    </div>
        </div>
    );
};
