'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUnsyncedMatches } from '@/hooks/useUnsyncedMatches';
import { Button } from './Button';
import { useToast } from './Toast';
import { LuRefreshCw, LuChevronDown, LuChevronUp, LuTrophy, LuSwords, LuCircleCheck } from 'react-icons/lu';

export function UnsyncedMatchesPanel({ onSynced }: { onSynced?: () => void }) {
    const { matches, count, isLoading, isSyncing, syncOnChain, error } = useUnsyncedMatches();
    const [isExpanded, setIsExpanded] = useState(false);
    const toast = useToast();

    if (count === 0 && !isLoading) {
        return (
            <div className="px-3.5 py-2.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <LuCircleCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-ludo-xs font-mono font-black uppercase tracking-[0.16em] text-white/70">
                        All Free Matches Verified On-Chain
                    </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/40 text-ludo-xs font-mono font-black text-cyan-300 uppercase tracking-wider">
                    Synced
                </span>
            </div>
        );
    }

    const wins = matches.filter((m) => m.won).length;
    const totalCaptures = matches.reduce((acc, m) => acc + (m.captures || 0), 0);

    const handleSync = async () => {
        try {
            const syncedCount = count;
            const tx = await syncOnChain();
            if (tx) {
                toast(`Successfully synced ${syncedCount} matches on-chain!`, 'success');
                window.dispatchEvent(new CustomEvent('ludo-matches-synced'));
                onSynced?.();
            }
        } catch (err: unknown) {
            toast(err instanceof Error ? err.message : 'Failed to sync on-chain', 'error');
        }
    };

    return (
        <div className="rounded-2xl bg-white/[0.04] border border-cyan-400/40 overflow-hidden">
            <div className="p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                        <span className="text-ludo-xs font-mono font-black uppercase tracking-[0.16em] text-cyan-300">
                            On-Chain Telemetry Queue ({count})
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsExpanded((prev) => !prev)}
                        className="text-ludo-xs font-mono font-bold text-white/60 hover:text-white flex items-center gap-1 transition-colors uppercase tracking-wider"
                    >
                        {isExpanded ? 'Hide Queue' : 'Inspect'}
                        {isExpanded ? <LuChevronUp className="w-3.5 h-3.5" /> : <LuChevronDown className="w-3.5 h-3.5" />}
                    </button>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                    <div className="rounded-xl bg-black/40 border border-white/5 px-2.5 py-1.5 flex items-center gap-1.5">
                        <LuTrophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="text-ludo-xs font-mono font-black text-white tabular-nums">
                            {wins} {wins === 1 ? 'Win' : 'Wins'}
                        </span>
                    </div>
                    <div className="rounded-xl bg-black/40 border border-white/5 px-2.5 py-1.5 flex items-center gap-1.5">
                        <LuSwords className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span className="text-ludo-xs font-mono font-black text-white tabular-nums">
                            {totalCaptures} {totalCaptures === 1 ? 'Capture' : 'Captures'}
                        </span>
                    </div>
                    <div className="rounded-xl bg-black/40 border border-white/5 px-2.5 py-1.5 flex items-center justify-center">
                        <span className="text-ludo-xs font-mono font-black text-cyan-300 tabular-nums uppercase">
                            {count} Pending
                        </span>
                    </div>
                </div>

                <p className="text-ludo-xs text-white/60 leading-relaxed">
                    Batch-commit your off-chain free match history onto Base in a single transaction to credit active Daily &amp; Weekly missions.
                </p>

                {error && (
                    <div className="text-ludo-xs text-red-400 font-mono font-bold">
                        {error}
                    </div>
                )}

                <Button
                    onClick={handleSync}
                    disabled={isSyncing || isLoading || count === 0}
                    variant="primary"
                    className="w-full h-9 text-ludo-xs font-black tracking-[0.16em] uppercase rounded-xl"
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
                        className="border-t border-white/10 bg-black/40 px-3.5 py-2 flex flex-col gap-1.5 max-h-44 overflow-y-auto no-scrollbar"
                    >
                        {matches.map((m) => (
                            <div
                                key={m.match_id}
                                className="flex items-center justify-between text-ludo-xs font-mono py-1 border-b border-white/5 last:border-0"
                            >
                                <div className="flex items-center gap-2">
                                    <span className={m.won ? 'text-emerald-400 font-black' : 'text-red-400 font-bold'}>
                                        {m.won ? 'VICTORY' : 'DEFEAT'}
                                    </span>
                                    {m.captures > 0 && (
                                        <span className="text-white/60">
                                            • {m.captures} {m.captures === 1 ? 'capture' : 'captures'}
                                        </span>
                                    )}
                                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 text-ludo-xs font-black uppercase">
                                        {m.is_pvp ? 'PvP' : 'AI'}
                                    </span>
                                </div>
                                <span className="text-white/40 tabular-nums">
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
