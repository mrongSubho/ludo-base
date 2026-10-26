'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUnsyncedMatches } from '@/hooks/useUnsyncedMatches';
import { Button } from './Button';
import { useToast } from './Toast';
import { LuRefreshCw, LuChevronDown, LuChevronUp, LuTrophy, LuSwords, LuCircleCheck } from 'react-icons/lu';

export function UnsyncedMatchesPanel() {
    const { matches, count, isLoading, isSyncing, syncOnChain, error } = useUnsyncedMatches();
    const [isExpanded, setIsExpanded] = useState(false);
    const toast = useToast();

    if (count === 0 && !isLoading) {
        return (
            <div className="mb-4 px-3 py-2 rounded-xl bg-cyan-500/[0.05] border border-cyan-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <LuCircleCheck className="w-4 h-4 text-cyan-400" />
                    <span className="text-ludo-xs font-mono font-bold uppercase tracking-wider text-cyan-300/80">
                        All Free Matches Synced On-Chain
                    </span>
                </div>
            </div>
        );
    }

    const wins = matches.filter((m) => m.won).length;
    const totalCaptures = matches.reduce((acc, m) => acc + (m.captures || 0), 0);

    const handleSync = async () => {
        try {
            const tx = await syncOnChain();
            if (tx) {
                toast(`Successfully synced ${count} matches on-chain!`, 'success');
            }
        } catch (err: unknown) {
            toast(err instanceof Error ? err.message : 'Failed to sync on-chain', 'error');
        }
    };

    return (
        <div className="mb-4 rounded-xl bg-gradient-to-br from-cyan-950/40 via-black/40 to-black/60 border border-cyan-500/30 overflow-hidden shadow-[0_0_20px_rgba(34,211,238,0.1)]">
            <div className="p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                        <span className="text-ludo-xs font-mono font-black uppercase tracking-[0.16em] text-cyan-300">
                            Unsynced Match History ({count})
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsExpanded((prev) => !prev)}
                        className="text-ludo-xs font-mono text-cyan-400/70 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                    >
                        {isExpanded ? 'Hide' : 'View'}
                        {isExpanded ? <LuChevronUp className="w-3.5 h-3.5" /> : <LuChevronDown className="w-3.5 h-3.5" />}
                    </button>
                </div>

                <div className="flex items-center gap-4 text-ludo-xs font-mono text-white/70">
                    <div className="flex items-center gap-1.5">
                        <LuTrophy className="w-3.5 h-3.5 text-amber-400" />
                        <span>{wins} {wins === 1 ? 'Win' : 'Wins'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <LuSwords className="w-3.5 h-3.5 text-rose-400" />
                        <span>{totalCaptures} {totalCaptures === 1 ? 'Capture' : 'Captures'}</span>
                    </div>
                    <div className="text-white/40">
                        {count} Total {count === 1 ? 'Match' : 'Matches'}
                    </div>
                </div>

                <p className="text-ludo-xs text-white/50 leading-relaxed">
                    Sync your free match history on-chain in 1 transaction to update daily & weekly mission progress.
                </p>

                {error && (
                    <div className="text-ludo-xs text-rose-400 font-mono">
                        {error}
                    </div>
                )}

                <Button
                    onClick={handleSync}
                    disabled={isSyncing || isLoading || count === 0}
                    className="w-full h-8 text-ludo-xs font-black tracking-wider uppercase bg-cyan-500 hover:bg-cyan-400 text-black rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)]"
                >
                    <span className="flex items-center justify-center gap-2">
                        <LuRefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing On-Chain…' : `Sync ${count} ${count === 1 ? 'Match' : 'Matches'} On-Chain`}
                    </span>
                </Button>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="border-t border-cyan-500/20 bg-black/40 px-3 py-2 flex flex-col gap-1.5 max-h-48 overflow-y-auto"
                    >
                        {matches.map((m) => (
                            <div
                                key={m.match_id}
                                className="flex items-center justify-between text-ludo-xs font-mono py-1 border-b border-white/5 last:border-0"
                            >
                                <div className="flex items-center gap-2">
                                    <span className={m.won ? 'text-emerald-400 font-bold' : 'text-white/40'}>
                                        {m.won ? 'VICTORY' : 'DEFEAT'}
                                    </span>
                                    {m.captures > 0 && (
                                        <span className="text-white/60">
                                            • {m.captures} {m.captures === 1 ? 'capture' : 'captures'}
                                        </span>
                                    )}
                                    {m.is_pvp && (
                                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-300 text-[10px]">
                                            PvP
                                        </span>
                                    )}
                                </div>
                                <span className="text-white/35 text-[11px]">
                                    {new Date(m.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
