'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChainId } from 'wagmi';
import { useAppSession } from '@/hooks/useAppSession';
import { UnsyncedMatchesPanel } from './UnsyncedMatchesPanel';
import type { MatchHistoryRecord } from '@/app/api/matches/history/route';
import {
    LuTrophy,
    LuSwords,
    LuClock,
    LuCircleCheck,
    LuChevronDown,
    LuChevronUp,
    LuExternalLink,
    LuShieldAlert,
    LuRefreshCw,
    LuUsers,
    LuSparkles,
    LuBot,
} from 'react-icons/lu';

type HistoryFilter = 'all' | 'classic' | 'power' | 'paid' | 'unsynced';

const FILTERS: { id: HistoryFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'classic', label: 'Classic' },
    { id: 'power', label: 'Power' },
    { id: 'paid', label: 'Paid' },
    { id: 'unsynced', label: 'Unsynced' },
];

function formatRelativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms) || ms < 0) return 'Just now';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDuration(sec: number | null): string | null {
    if (!sec || sec <= 0) return null;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
}

function shortAddr(addr: string): string {
    if (!addr || addr.length < 10) return addr || 'Unknown';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatModeLabel(mode: string, shape: string, isPvp: boolean): string {
    const m = (mode || 'classic').toLowerCase();
    if (!isPvp || m === 'ai' || m === 'offline') return 'VS AI • SOLO';
    const modeName = m === 'power' ? 'POWER' : m === 'snakes' ? 'SNAKES' : 'CLASSIC';
    const shapeLabel = (shape || '1v1').toUpperCase();
    return `${modeName} • ${shapeLabel}`;
}

export function MatchHistoryTab({
    address,
    isGuest,
}: {
    address: string | null | undefined;
    isGuest: boolean;
}) {
    const { ensureAppSession } = useAppSession();
    const chainId = useChainId();
    const [matches, setMatches] = useState<MatchHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<HistoryFilter>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const fetchHistory = useCallback(async () => {
        if (!address || isGuest) {
            setMatches([]);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const sessionId = await ensureAppSession({ context: 'missions' });
            if (!sessionId) {
                setMatches([]);
                return;
            }
            const res = await fetch(
                `/api/matches/history?wallet=${encodeURIComponent(address)}`,
                {
                    headers: {
                        Authorization: `Bearer ${sessionId}`,
                        'x-session-id': sessionId,
                    },
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'Could not load match history');
            }
            setMatches(Array.isArray(data?.matches) ? data.matches : []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to load match history');
        } finally {
            setIsLoading(false);
        }
    }, [address, isGuest, ensureAppSession]);

    useEffect(() => {
        void fetchHistory();
    }, [fetchHistory]);

    useEffect(() => {
        const onSynced = () => {
            void fetchHistory();
        };
        window.addEventListener('ludo-matches-synced', onSynced);
        return () => window.removeEventListener('ludo-matches-synced', onSynced);
    }, [fetchHistory]);

    const filteredMatches = useMemo(() => {
        return matches.filter((m) => {
            if (filter === 'all') return true;
            if (filter === 'classic') return m.gameMode.toLowerCase() === 'classic';
            if (filter === 'power') return m.gameMode.toLowerCase() === 'power';
            if (filter === 'paid') return m.isPaidPool;
            if (filter === 'unsynced') return !m.onchainSynced;
            return true;
        });
    }, [matches, filter]);

    const summary = useMemo(() => {
        const total = filteredMatches.length;
        const wins = filteredMatches.filter((m) => m.won).length;
        const losses = total - wins;
        const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
        const captures = filteredMatches.reduce((acc, m) => acc + (m.captures || 0), 0);
        const netRxp = filteredMatches.reduce((acc, m) => acc + (m.rxpDelta || 0), 0);
        return { total, wins, losses, winRate, captures, netRxp };
    }, [filteredMatches]);

    const explorerBase =
        chainId === 8453 ? 'https://basescan.org/tx/' : 'https://sepolia.basescan.org/tx/';

    if (isGuest || !address) {
        return (
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-6 flex flex-col items-center justify-center text-center gap-2 my-2">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30">
                    <LuShieldAlert className="w-6 h-6" />
                </div>
                <div className="text-sm font-black uppercase tracking-wider text-white">
                    Combat Record Locked
                </div>
                <p className="text-ludo-xs font-bold text-white/40 max-w-[240px]">
                    Connect a wallet to record battle telemetry, track match history, and sync free matches on-chain.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 pb-3">
            {/* 1. On-Chain Sync Command Center (Relocated from MissionPanel) */}
            <UnsyncedMatchesPanel onSynced={fetchHistory} />

            {/* 2. CODM Tactical Combat Summary Ribbon */}
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-ludo-xs font-mono font-black uppercase tracking-[0.18em] text-white/60">
                        Combat Telemetry
                    </span>
                    <button
                        type="button"
                        onClick={() => void fetchHistory()}
                        disabled={isLoading}
                        aria-label="Refresh match history"
                        className="text-ludo-xs font-mono font-bold text-cyan-300 hover:text-white flex items-center gap-1 transition-colors uppercase tracking-wider disabled:opacity-40"
                    >
                        <LuRefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                    <div className="rounded-xl bg-black/40 border border-white/5 p-2 flex flex-col items-center justify-center">
                        <span className="text-sm font-black text-white tabular-nums">
                            {summary.total}
                        </span>
                        <span className="text-ludo-xs font-black uppercase tracking-wider text-white/35 mt-0.5">
                            Battles
                        </span>
                    </div>
                    <div className="rounded-xl bg-black/40 border border-white/5 p-2 flex flex-col items-center justify-center">
                        <span className="text-sm font-black text-cyan-400 tabular-nums">
                            {summary.winRate}%
                        </span>
                        <span className="text-ludo-xs font-black uppercase tracking-wider text-white/35 mt-0.5">
                            {summary.wins}W-{summary.losses}L
                        </span>
                    </div>
                    <div className="rounded-xl bg-black/40 border border-white/5 p-2 flex flex-col items-center justify-center">
                        <span className="text-sm font-black text-amber-400 tabular-nums">
                            {summary.captures}
                        </span>
                        <span className="text-ludo-xs font-black uppercase tracking-wider text-white/35 mt-0.5">
                            Captures
                        </span>
                    </div>
                    <div className="rounded-xl bg-black/40 border border-white/5 p-2 flex flex-col items-center justify-center">
                        <span
                            className={`text-sm font-black tabular-nums ${
                                summary.netRxp >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                        >
                            {summary.netRxp > 0 ? `+${summary.netRxp}` : summary.netRxp}
                        </span>
                        <span className="text-ludo-xs font-black uppercase tracking-wider text-white/35 mt-0.5">
                            Net RXP
                        </span>
                    </div>
                </div>
            </div>

            {/* 3. Filter Pills Bar */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                {FILTERS.map((f) => {
                    const active = filter === f.id;
                    const countBadge =
                        f.id === 'unsynced'
                            ? matches.filter((m) => !m.onchainSynced).length
                            : null;
                    return (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => setFilter(f.id)}
                            className={`px-3 py-1.5 rounded-xl text-ludo-xs font-black uppercase tracking-[0.15em] shrink-0 transition-all flex items-center gap-1.5 ${
                                active
                                    ? 'bg-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]'
                                    : 'bg-white/[0.04] border border-white/10 text-white/40 hover:text-white/70'
                            }`}
                        >
                            <span>{f.label}</span>
                            {countBadge !== null && countBadge > 0 && (
                                <span className="px-1.5 py-0.2 rounded-md bg-amber-400/20 text-amber-300 font-mono tabular-nums">
                                    {countBadge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* 4. Error Banner */}
            {error && (
                <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3 text-ludo-xs font-bold text-red-400">
                    {error}
                </div>
            )}

            {/* 5. CODM Match Log Cards */}
            {isLoading && matches.length === 0 ? (
                <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="h-20 rounded-2xl bg-white/[0.04] border border-white/10 animate-pulse"
                        />
                    ))}
                </div>
            ) : filteredMatches.length === 0 ? (
                <div className="rounded-2xl bg-white/[0.04] border border-dashed border-white/10 py-10 px-4 flex flex-col items-center justify-center text-center gap-1.5">
                    <LuTrophy className="w-6 h-6 text-white/25 mb-1" />
                    <div className="text-xs font-black uppercase tracking-wider text-white/70">
                        No Combat Logs Found
                    </div>
                    <div className="text-ludo-xs font-bold text-white/35 max-w-[220px]">
                        {filter === 'all'
                            ? 'Complete your first match to populate your battle log.'
                            : `No matches match the "${filter.toUpperCase()}" filter.`}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {filteredMatches.map((m) => {
                        const isExpanded = expandedId === m.matchId;
                        const durationText = formatDuration(m.durationSec);
                        const modeLabel = formatModeLabel(m.gameMode, m.matchShape, m.isPvp);

                        return (
                            <div
                                key={m.matchId}
                                className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden transition-all"
                            >
                                {/* Main Tactical Card Row */}
                                <button
                                    type="button"
                                    onClick={() =>
                                        setExpandedId((prev) => (prev === m.matchId ? null : m.matchId))
                                    }
                                    className="w-full text-left flex items-stretch hover:bg-white/5 transition-colors"
                                >
                                    {/* Left CODM Status Bar */}
                                    <div
                                        className={`w-1.5 shrink-0 ${
                                            m.won ? 'bg-emerald-400' : 'bg-red-400'
                                        }`}
                                    />

                                    <div className="flex-1 min-w-0 p-3 flex flex-col gap-2">
                                        {/* Top Row: Outcome + Mode Badge | RXP + On-Chain Status */}
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span
                                                    className={`text-xs font-black uppercase tracking-[0.16em] shrink-0 ${
                                                        m.won ? 'text-emerald-400' : 'text-red-400'
                                                    }`}
                                                >
                                                    {m.won ? 'VICTORY' : 'DEFEAT'}
                                                </span>
                                                <span className="w-1 h-1 rounded-full bg-white/25 shrink-0" />
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/40 border border-white/10 text-ludo-xs font-mono font-black text-white/80 uppercase tracking-wider truncate">
                                                    {!m.isPvp ? (
                                                        <LuBot className="w-3 h-3 text-cyan-400 shrink-0" />
                                                    ) : m.gameMode === 'power' ? (
                                                        <LuSparkles className="w-3 h-3 text-amber-400 shrink-0" />
                                                    ) : (
                                                        <LuUsers className="w-3 h-3 text-cyan-400 shrink-0" />
                                                    )}
                                                    {modeLabel}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <span
                                                    className={`text-ludo-xs font-mono font-black tabular-nums ${
                                                        m.rxpDelta >= 0
                                                            ? 'text-emerald-400'
                                                            : 'text-red-400'
                                                    }`}
                                                >
                                                    {m.rxpDelta > 0 ? `+${m.rxpDelta}` : m.rxpDelta} RXP
                                                </span>

                                                {m.onchainSynced ? (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/40 text-ludo-xs font-mono font-black text-cyan-300 uppercase">
                                                        <LuCircleCheck className="w-3 h-3 shrink-0" />
                                                        {m.isPaidPool ? 'Settled' : 'Synced'}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/40 border border-white/10 text-ludo-xs font-mono font-black text-amber-400 uppercase">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                                                        Unsynced
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Bottom Row: Combat Telemetry Metrics */}
                                        <div className="flex items-center justify-between gap-2 text-ludo-xs font-mono text-white/60">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1 font-bold text-white/80">
                                                    <LuSwords className="w-3 h-3 text-amber-400 shrink-0" />
                                                    {m.captures} {m.captures === 1 ? 'Capture' : 'Captures'}
                                                </span>

                                                <span className="text-white/40">•</span>

                                                {m.isPaidPool ? (
                                                    <span className="font-black text-cyan-300 uppercase">
                                                        {m.poolPrizeFund
                                                            ? `${m.poolPrizeFund} CHIPS Pot`
                                                            : 'Paid Pool'}
                                                    </span>
                                                ) : (
                                                    <span className="text-white/50 uppercase">
                                                        Free Play
                                                    </span>
                                                )}

                                                {durationText && (
                                                    <>
                                                        <span className="text-white/40">•</span>
                                                        <span className="inline-flex items-center gap-1 text-white/50">
                                                            <LuClock className="w-3 h-3 shrink-0" />
                                                            {durationText}
                                                        </span>
                                                    </>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0 text-white/40">
                                                <span className="tabular-nums">
                                                    {formatRelativeTime(m.createdAt)}
                                                </span>
                                                {isExpanded ? (
                                                    <LuChevronUp className="w-3.5 h-3.5 text-white/60" />
                                                ) : (
                                                    <LuChevronDown className="w-3.5 h-3.5 text-white/40" />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>

                                {/* Expanded CODM Post-Match Scoreboard Drawer */}
                                <AnimatePresence>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="border-t border-white/10 bg-black/40 px-3.5 py-3 flex flex-col gap-2.5"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-ludo-xs font-mono font-black uppercase tracking-[0.16em] text-white/50">
                                                    Squad &amp; Combatants ({m.participants.length})
                                                </span>
                                                <span className="text-ludo-xs font-mono font-bold text-cyan-300">
                                                    +{m.lxpDelta} XP Earned
                                                </span>
                                            </div>

                                            {/* Participant Scoreboard List */}
                                            <div className="flex flex-col gap-1.5">
                                                {m.participants.map((p) => (
                                                    <div
                                                        key={p.wallet}
                                                        className="rounded-xl bg-white/[0.04] border border-white/10 px-2.5 py-1.5 flex items-center justify-between gap-2"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shrink-0 text-ludo-xs font-black text-cyan-300 uppercase">
                                                                {(p.username?.[0] || p.wallet[2] || 'P').toUpperCase()}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-ludo-xs font-bold text-white truncate">
                                                                        {p.username || shortAddr(p.wallet)}
                                                                    </span>
                                                                    {p.isMe && (
                                                                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-ludo-xs font-mono font-black uppercase">
                                                                            You
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {p.rankTier && (
                                                                    <div className="text-ludo-xs font-bold text-white/40 uppercase tracking-wider">
                                                                        {p.rankTier}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            {p.isWinner ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-ludo-xs font-mono font-black text-amber-400 uppercase">
                                                                    <LuTrophy className="w-3 h-3 shrink-0" />
                                                                    Winner
                                                                </span>
                                                            ) : (
                                                                <span className="text-ludo-xs font-mono font-bold text-white/35 uppercase">
                                                                    Defeated
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Match Telemetry Footer */}
                                            <div className="pt-1 border-t border-white/5 flex items-center justify-between gap-2 flex-wrap text-ludo-xs font-mono text-white/40">
                                                <div className="flex items-center gap-2">
                                                    <span>ID: {m.matchId.slice(0, 10)}…</span>
                                                    {m.roomCode && <span>• Room #{m.roomCode}</span>}
                                                </div>

                                                {m.syncTxHash ? (
                                                    <a
                                                        href={`${explorerBase}${m.syncTxHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-cyan-300 hover:text-white font-bold uppercase tracking-wider transition-colors"
                                                    >
                                                        <span>BaseScan TX</span>
                                                        <LuExternalLink className="w-3 h-3" />
                                                    </a>
                                                ) : (
                                                    <span className="text-amber-400 font-bold uppercase">
                                                        Pending On-Chain Sync
                                                    </span>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
