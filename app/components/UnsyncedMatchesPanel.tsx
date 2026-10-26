'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUnsyncedMatches } from '@/hooks/useUnsyncedMatches';
import { Button } from './Button';
import { useToast } from './Toast';
import {
    LuRefreshCw,
    LuChevronDown,
    LuChevronUp,
    LuTrophy,
    LuSwords,
    LuCircleCheck,
} from 'react-icons/lu';

export function UnsyncedMatchesPanel({
    targetWallet,
    onSynced,
}: {
    targetWallet?: string | null;
    onSynced?: () => void;
}) {
    const { matches, count, isLoading, isSyncing, syncOnChain, error } =
        useUnsyncedMatches(targetWallet);
    const [isExpanded, setIsExpanded] = useState(false);
    const toast = useToast();

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
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 hover:border-cyan-400/30 transition-all overflow-hidden">
            {/* Tap-to-Expand Collapsible Header Bar */}
            <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors cursor-pointer select-none"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    {count === 0 ? (
                        <LuCircleCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    )}
                    <span
                        className={`text-ludo-xs font-mono font-black uppercase tracking-[0.16em] truncate ${
                            count === 0 ? 'text-white/80' : 'text-amber-300'
                        }`}
                    >
                        {count === 0
                            ? 'All Matches Synced On-Chain'
                            : `${count} Unsynced Matches ready to sync`}
                    </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {count === 0 ? (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-400/40 text-ludo-xs font-mono font-black text-emerald-300 uppercase tracking-wider">
                            Synced
                        </span>
                    ) : (
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-ludo-xs font-mono font-black text-amber-300 uppercase tracking-wider animate-pulse">
                            Sync Queue ({count})
                        </span>
                    )}

                    {isExpanded ? (
                        <LuChevronUp className="w-4 h-4 text-white/60" />
                    ) : (
                        <LuChevronDown className="w-4 h-4 text-white/40" />
                    )}
                </div>
            </button>

            {/* Collapsible Content Drawer */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="border-t border-white/10 bg-black/40 px-3.5 py-3 flex flex-col gap-3"
                    >
                        {count === 0 ? (
                            <div className="py-2 flex flex-col items-center justify-center text-center gap-1.5">
                                <span className="text-ludo-xs font-mono font-bold text-white/70">
                                    All recent match activity is permanently verified and sealed on Base.
                                </span>
                                <span className="text-[11px] font-mono text-white/40">
                                    New free matches will queue here automatically for your next gas-minimized batch sync.
                                </span>
                            </div>
                        ) : (
                            <>
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
                                        {isSyncing
                                            ? 'Syncing On-Chain…'
                                            : `Sync ${count} ${count === 1 ? 'Match' : 'Matches'} On-Chain`}
                                    </span>
                                </Button>

                                {/* Detailed matches in queue */}
                                <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto no-scrollbar pt-1 border-t border-white/5">
                                    <span className="text-[10px] font-mono font-bold text-white/40 uppercase tracking-wider">
                                        Queue Breakdown
                                    </span>
                                    {matches.map((m) => (
                                        <div
                                            key={m.match_id}
                                            className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-1.5 flex items-center justify-between text-ludo-xs font-mono"
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span
                                                    className={`font-black uppercase text-[10px] px-1.5 py-0.2 rounded ${
                                                        m.won
                                                            ? 'bg-emerald-500/20 text-emerald-300'
                                                            : 'bg-red-500/20 text-red-300'
                                                    }`}
                                                >
                                                    {m.won ? 'VICTORY' : 'DEFEAT'}
                                                </span>
                                                <span className="text-white/60 truncate">
                                                    Match #{m.match_id.slice(0, 8)}…
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-white/40 shrink-0">
                                                <span>{m.captures} Captures</span>
                                                <span>•</span>
                                                <span>{m.is_pvp ? 'PVP' : 'AI'}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
