'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUnsyncedMatches } from '@/hooks/useUnsyncedMatches';
import { formatWeb3Error } from '@/lib/web3Error';
import { Button } from './Button';
import { useToast } from './Toast';
import {
    LuRefreshCw,
    LuChevronDown,
    LuChevronUp,
    LuTrophy,
    LuSwords,
    LuCircleCheck,
    LuShieldAlert,
} from 'react-icons/lu';

export function UnsyncedMatchesPanel({
    targetWallet,
    onSynced,
}: {
    targetWallet?: string | null;
    onSynced?: () => void;
}) {
    const { matches, count, batchCount, isLoading, isSyncing, syncOnChain, error } =
        useUnsyncedMatches(targetWallet);
    const [isExpanded, setIsExpanded] = useState(false);
    const toast = useToast();

    const wins = matches.filter((m) => m.won).length;
    const totalCaptures = matches.reduce((acc, m) => acc + (m.captures || 0), 0);

    const handleSync = async () => {
        try {
            const res = await syncOnChain();
            if (res?.tx) {
                toast(`Successfully synced ${res.syncedCount} matches on Base!`, 'success');
                window.dispatchEvent(new CustomEvent('ludo-matches-synced'));
                onSynced?.();
            }
        } catch (err: unknown) {
            toast(formatWeb3Error(err), 'error');
        }
    };

    return (
        <div className="rounded-2xl bg-surface-recessed border border-line-soft hover:border-line-strong transition-colors overflow-hidden">
            {/* Tap-to-Expand Collapsible Header Bar */}
            <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-surface-hover transition-colors cursor-pointer select-none"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    {count === 0 ? (
                        <LuCircleCheck className="w-4 h-4 text-positive shrink-0" />
                    ) : (
                        <span className="w-2.5 h-2.5 rounded-full bg-warn animate-pulse shrink-0" />
                    )}
                    <span
                        className={`text-ludo-xs font-mono font-extrabold uppercase tracking-[0.16em] truncate ${
                            count === 0 ? 'text-ink-strong' : 'text-warn'
                        }`}
                    >
                        {count === 0
                            ? 'All Matches Synced On-Chain'
                            : `${count} Unsynced Matches ready to sync`}
                    </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {count === 0 ? (
                        <span className="px-2 py-0.5 rounded-md bg-positive/15 border border-positive/35 text-ludo-xs font-mono font-bold text-positive uppercase tracking-wider">
                            Synced
                        </span>
                    ) : (
                        <span className="px-2 py-0.5 rounded-md bg-warn/15 border border-warn/40 text-ludo-xs font-mono font-bold text-warn uppercase tracking-wider animate-pulse">
                            Sync Queue ({count})
                        </span>
                    )}

                    {isExpanded ? (
                        <LuChevronUp className="w-4 h-4 text-ink-muted" />
                    ) : (
                        <LuChevronDown className="w-4 h-4 text-ink-faint" />
                    )}
                </div>
            </button>

            {/* Collapsible Content Drawer (compositor-only opacity/transform) */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.16 }}
                        className="border-t border-line-soft bg-surface-panel/80 px-3.5 py-3 flex flex-col gap-3"
                    >
                        {count === 0 ? (
                            <div className="py-2 flex flex-col items-center justify-center text-center gap-1.5">
                                <span className="text-ludo-xs font-mono font-bold text-ink-strong">
                                    All recent match activity is permanently verified and sealed on Base.
                                </span>
                                <span className="text-ludo-xs font-mono text-ink-faint">
                                    New free matches will queue here automatically for your next gas-minimized batch sync.
                                </span>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-3 gap-1.5">
                                    <div className="rounded-xl bg-surface-recessed border border-line-soft px-2.5 py-1.5 flex items-center gap-1.5">
                                        <LuTrophy className="w-3.5 h-3.5 text-warn shrink-0" />
                                        <span className="text-ludo-xs font-mono font-extrabold text-ink-strong tabular-nums">
                                            {wins} {wins === 1 ? 'Win' : 'Wins'}
                                        </span>
                                    </div>
                                    <div className="rounded-xl bg-surface-recessed border border-line-soft px-2.5 py-1.5 flex items-center gap-1.5">
                                        <LuSwords className="w-3.5 h-3.5 text-negative shrink-0" />
                                        <span className="text-ludo-xs font-mono font-extrabold text-ink-strong tabular-nums">
                                            {totalCaptures} {totalCaptures === 1 ? 'Capture' : 'Captures'}
                                        </span>
                                    </div>
                                    <div className="rounded-xl bg-surface-recessed border border-line-soft px-2.5 py-1.5 flex items-center justify-center">
                                        <span className="text-ludo-xs font-mono font-extrabold text-accent tabular-nums uppercase">
                                            {count} Pending
                                        </span>
                                    </div>
                                </div>

                                <p className="text-ludo-xs text-ink-muted leading-relaxed">
                                    Batch-commit your off-chain free match history onto Base in gas-optimized batches (up to 10 matches per tx) to credit active Daily &amp; Weekly missions.
                                </p>

                                {error && (
                                    <div className="rounded-xl bg-negative/10 border border-negative/30 px-3 py-2 flex items-center gap-2 text-ludo-xs font-mono font-bold text-negative">
                                        <LuShieldAlert className="w-4 h-4 text-negative shrink-0" />
                                        <span className="leading-snug">{error}</span>
                                    </div>
                                )}

                                <Button
                                    onClick={handleSync}
                                    disabled={isSyncing || isLoading || count === 0}
                                    variant="primary"
                                    className="w-full h-9 text-ludo-xs font-extrabold tracking-[0.16em] uppercase rounded-xl"
                                >
                                    <span className="flex items-center justify-center gap-2">
                                        <LuRefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                                        {isSyncing
                                            ? 'Syncing On-Chain…'
                                            : count > batchCount
                                            ? `Sync Next ${batchCount} Matches On-Chain (${batchCount} of ${count})`
                                            : `Sync ${count} ${count === 1 ? 'Match' : 'Matches'} On-Chain`}
                                    </span>
                                </Button>

                                {/* Detailed matches in queue */}
                                <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto no-scrollbar pt-1 border-t border-line-soft">
                                    <span className="text-ludo-xs font-mono font-bold text-ink-faint uppercase tracking-wider">
                                        Queue Breakdown
                                    </span>
                                    {matches.map((m) => (
                                        <div
                                            key={m.match_id}
                                            className="rounded-lg bg-surface-recessed border border-line-soft px-2.5 py-1.5 flex items-center justify-between text-ludo-xs font-mono"
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span
                                                    className={`font-extrabold uppercase text-ludo-xs px-1.5 py-0.5 rounded ${
                                                        m.won
                                                            ? 'bg-positive/15 text-positive'
                                                            : 'bg-negative/15 text-negative'
                                                    }`}
                                                >
                                                    {m.won ? 'VICTORY' : 'DEFEAT'}
                                                </span>
                                                <span className="text-ink-muted truncate">
                                                    Match #{m.match_id.slice(0, 8)}…
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-ink-faint shrink-0">
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
