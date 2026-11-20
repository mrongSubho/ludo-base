'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChainId } from 'wagmi';
import { useAppSession } from '@/hooks/useAppSession';
import { UnsyncedMatchesPanel } from './UnsyncedMatchesPanel';
import PublicProfileModal from './PublicProfileModal';
import { PilotAvatar } from './PilotAvatar';
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
import { FiHome } from 'react-icons/fi';
import RankTierIcon from './RankTierIcon';

type HistoryFilter = 'all' | 'classic' | 'power' | 'ranked' | 'unsynced';

const FILTERS: { id: HistoryFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'classic', label: 'Classic' },
    { id: 'power', label: 'Power' },
    { id: 'ranked', label: 'Ranked Match' },
    { id: 'unsynced', label: 'Unsynced' },
];

function semanticTierText(tier?: string | null): string {
    const norm = (tier || '').toLowerCase();
    if (norm.includes('master') || norm.includes('gold')) return 'text-warn';
    if (norm.includes('diamond') || norm.includes('platinum')) return 'text-accent';
    return 'text-ink-muted';
}

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
    onOpenProfile,
}: {
    address: string | null | undefined;
    isGuest: boolean;
    onOpenProfile?: (address: string) => void;
}) {
    const { ensureAppSession } = useAppSession();
    const chainId = useChainId();
    const [matches, setMatches] = useState<MatchHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<HistoryFilter>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [selectedProfileAddress, setSelectedProfileAddress] = useState<string | null>(null);

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
                },
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
            if (filter === 'ranked') return m.isPaidPool;
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
            <div className="rounded-2xl bg-surface-recessed border border-line-soft p-6 flex flex-col items-center justify-center text-center gap-2 my-2">
                <div className="w-12 h-12 rounded-2xl bg-surface-panel border border-line-soft flex items-center justify-center text-ink-faint">
                    <LuShieldAlert className="w-6 h-6" />
                </div>
                <div className="text-ludo-md font-extrabold uppercase tracking-wider text-ink-strong">
                    Combat Record Locked
                </div>
                <p className="text-ludo-xs font-bold text-ink-faint max-w-[240px]">
                    Connect a wallet to record battle telemetry, track match history, and sync free matches on-chain.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 pb-3">
            {/* 1. On-Chain Sync Command Center */}
            <UnsyncedMatchesPanel targetWallet={address} onSynced={fetchHistory} />

            {/* 2. Tactical Combat Summary Ribbon */}
            <div className="rounded-2xl bg-surface-recessed border border-line-soft p-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-ludo-xs font-mono font-extrabold uppercase tracking-[0.18em] text-ink-muted">
                        Combat Telemetry
                    </span>
                    <button
                        type="button"
                        onClick={() => void fetchHistory()}
                        disabled={isLoading}
                        aria-label="Refresh match history"
                        className="text-ludo-xs font-mono font-bold text-accent hover:brightness-110 flex items-center gap-1 transition-colors uppercase tracking-wider disabled:opacity-40"
                    >
                        <LuRefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                    <div className="rounded-xl bg-surface-panel border border-line-soft p-2 flex flex-col items-center justify-center">
                        <span className="text-ludo-lg font-extrabold text-ink-strong tabular-nums leading-none">
                            {summary.total}
                        </span>
                        <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-faint mt-1">
                            Battles
                        </span>
                    </div>
                    <div className="rounded-xl bg-surface-panel border border-line-soft p-2 flex flex-col items-center justify-center">
                        <span className="text-ludo-lg font-extrabold text-accent tabular-nums leading-none">
                            {summary.winRate}%
                        </span>
                        <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-faint mt-1">
                            {summary.wins}W-{summary.losses}L
                        </span>
                    </div>
                    <div className="rounded-xl bg-surface-panel border border-line-soft p-2 flex flex-col items-center justify-center">
                        <span className="text-ludo-lg font-extrabold text-warn tabular-nums leading-none">
                            {summary.captures}
                        </span>
                        <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-faint mt-1">
                            Captures
                        </span>
                    </div>
                    <div className="rounded-xl bg-surface-panel border border-line-soft p-2 flex flex-col items-center justify-center">
                        <span
                            className={`text-ludo-lg font-extrabold tabular-nums leading-none ${
                                summary.netRxp >= 0 ? 'text-positive' : 'text-negative'
                            }`}
                        >
                            {summary.netRxp > 0 ? `+${summary.netRxp}` : summary.netRxp}
                        </span>
                        <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-faint mt-1">
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
                            className={`px-3 py-1.5 rounded-xl text-ludo-xs font-bold uppercase tracking-[0.14em] shrink-0 transition-colors flex items-center gap-1.5 border ${
                                active
                                    ? 'bg-accent-soft text-accent border-accent/45'
                                    : 'bg-surface-recessed border-line-soft text-ink-muted hover:text-ink-strong'
                            }`}
                        >
                            <span>{f.label}</span>
                            {countBadge !== null && countBadge > 0 && (
                                <span className="px-1.5 py-0.5 rounded-md bg-warn/20 text-warn font-mono tabular-nums">
                                    {countBadge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* 4. Error Banner */}
            {error && (
                <div className="rounded-xl bg-negative/10 border border-negative/30 p-3 text-ludo-xs font-bold text-negative">
                    {error}
                </div>
            )}

            {/* 5. Compact Match Log Table/Cards */}
            {isLoading && matches.length === 0 ? (
                <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="h-16 rounded-2xl bg-surface-recessed border border-line-soft animate-pulse"
                        />
                    ))}
                </div>
            ) : filteredMatches.length === 0 ? (
                <div className="rounded-2xl bg-surface-recessed border border-dashed border-line-soft py-10 px-4 flex flex-col items-center justify-center text-center gap-1.5">
                    <LuTrophy className="w-6 h-6 text-ink-faint mb-1" />
                    <div className="text-ludo-md font-extrabold uppercase tracking-wider text-ink-muted">
                        No Combat Logs Found
                    </div>
                    <div className="text-ludo-xs font-bold text-ink-faint max-w-[220px]">
                        {filter === 'all'
                            ? 'Complete your first match to populate your battle log.'
                            : `No matches match the "${filter === 'ranked' ? 'RANKED MATCH' : filter.toUpperCase()}" filter.`}
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
                                className="rounded-2xl bg-surface-recessed border border-line-soft overflow-hidden transition-colors"
                            >
                                {/* Main Tactical Card Row */}
                                <button
                                    type="button"
                                    onClick={() =>
                                        setExpandedId((prev) => (prev === m.matchId ? null : m.matchId))
                                    }
                                    className="w-full text-left flex items-stretch hover:bg-surface-hover transition-colors"
                                >
                                    {/* Left Outcome Bar */}
                                    <div
                                        className={`w-1.5 shrink-0 ${
                                            m.won ? 'bg-positive' : 'bg-negative'
                                        }`}
                                    />

                                    <div className="flex-1 min-w-0 p-2.5 flex flex-col gap-1.5">
                                        {/* Top Row */}
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span
                                                    className={`text-ludo-sm font-extrabold uppercase tracking-[0.14em] shrink-0 ${
                                                        m.won ? 'text-positive' : 'text-negative'
                                                    }`}
                                                >
                                                    {m.won ? 'VICTORY' : 'DEFEAT'}
                                                </span>
                                                <span className="w-1 h-1 rounded-full bg-ink-faint shrink-0" />
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-panel border border-line-soft text-ludo-xs font-mono font-bold text-ink-strong uppercase tracking-wider truncate">
                                                    {!m.isPvp ? (
                                                        <LuBot className="w-3 h-3 text-accent shrink-0" />
                                                    ) : m.gameMode === 'power' ? (
                                                        <LuSparkles className="w-3 h-3 text-warn shrink-0" />
                                                    ) : (
                                                        <LuUsers className="w-3 h-3 text-accent shrink-0" />
                                                    )}
                                                    {modeLabel}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <span
                                                    className={`text-ludo-xs font-mono font-extrabold tabular-nums ${
                                                        m.rxpDelta >= 0 ? 'text-positive' : 'text-negative'
                                                    }`}
                                                >
                                                    {m.rxpDelta > 0 ? `+${m.rxpDelta}` : m.rxpDelta} RXP
                                                </span>

                                                {m.onchainSynced ? (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent-soft border border-accent/35 text-ludo-xs font-mono font-bold text-accent uppercase">
                                                        <LuCircleCheck className="w-3 h-3 shrink-0" />
                                                        {m.isPaidPool ? 'Settled' : 'Synced'}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-panel border border-line-soft text-ludo-xs font-mono font-bold text-warn uppercase">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse shrink-0" />
                                                        Unsynced
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Bottom Telemetry Row */}
                                        <div className="flex items-center justify-between gap-2 text-ludo-xs font-mono text-ink-muted">
                                            <div className="flex items-center gap-2.5 flex-wrap">
                                                <span className="inline-flex items-center gap-1 font-bold text-ink-strong">
                                                    <LuSwords className="w-3 h-3 text-warn shrink-0" />
                                                    {m.captures} {m.captures === 1 ? 'Capture' : 'Captures'}
                                                </span>

                                                <span className="text-ink-faint">•</span>

                                                {m.isPaidPool ? (
                                                    <span className="font-bold text-accent uppercase">
                                                        {m.poolPrizeFund
                                                            ? `Ranked Match • ${m.poolPrizeFund} CHIPS`
                                                            : 'Ranked Match'}
                                                    </span>
                                                ) : (
                                                    <span className="text-ink-faint uppercase">
                                                        Free Play
                                                    </span>
                                                )}

                                                {durationText && (
                                                    <>
                                                        <span className="text-ink-faint">•</span>
                                                        <span className="inline-flex items-center gap-1 text-ink-faint">
                                                            <LuClock className="w-3 h-3 shrink-0" />
                                                            {durationText}
                                                        </span>
                                                    </>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0 text-ink-faint">
                                                <span className="tabular-nums">
                                                    {formatRelativeTime(m.createdAt)}
                                                </span>
                                                {isExpanded ? (
                                                    <LuChevronUp className="w-3.5 h-3.5 text-ink-muted" />
                                                ) : (
                                                    <LuChevronDown className="w-3.5 h-3.5 text-ink-faint" />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>

                                {/* Expanded Post-Match Scoreboard Drawer (compositor-only) */}
                                <AnimatePresence initial={false}>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -4 }}
                                            transition={{ duration: 0.16 }}
                                            className="border-t border-line-soft bg-surface-panel/80 px-3 py-2.5 flex flex-col gap-2"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-ludo-xs font-mono font-bold uppercase tracking-[0.16em] text-ink-muted">
                                                    Squad &amp; Combatants ({m.participants.length})
                                                </span>
                                                <span className="text-ludo-xs font-mono font-bold text-accent">
                                                    +{m.lxpDelta} XP Earned
                                                </span>
                                            </div>

                                            {/* Participant Scoreboard List */}
                                            <div className="flex flex-col gap-1.5">
                                                {m.participants.map((p) => {
                                                    const isClickable =
                                                        Boolean(p.wallet) && /^0x[a-f0-9]{40}$/i.test(p.wallet);
                                                    const combatantName = p.username || shortAddr(p.wallet);
                                                    return (
                                                        <div
                                                            key={p.wallet}
                                                            className="rounded-xl bg-surface-recessed border border-line-soft px-2.5 py-1.5 flex items-center justify-between gap-2"
                                                        >
                                                            <button
                                                                type="button"
                                                                disabled={!isClickable}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (isClickable) {
                                                                        if (onOpenProfile) {
                                                                            onOpenProfile(p.wallet);
                                                                        } else {
                                                                            setSelectedProfileAddress(p.wallet);
                                                                        }
                                                                    }
                                                                }}
                                                                className={`flex items-center gap-2 min-w-0 group text-left ${
                                                                    isClickable
                                                                        ? 'cursor-pointer hover:opacity-90'
                                                                        : 'cursor-default'
                                                                }`}
                                                                title={
                                                                    isClickable
                                                                        ? 'Inspect combatant profile'
                                                                        : undefined
                                                                }
                                                            >
                                                                <PilotAvatar
                                                                    avatarUrl={p.avatarUrl}
                                                                    name={combatantName}
                                                                    size="xs"
                                                                    tier={p.rankTier}
                                                                />
                                                                <div className="min-w-0">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span
                                                                            className={`text-ludo-xs font-bold text-ink-strong truncate transition-colors ${
                                                                                isClickable
                                                                                    ? 'group-hover:text-accent group-hover:underline'
                                                                                    : ''
                                                                            }`}
                                                                        >
                                                                            {combatantName}
                                                                        </span>
                                                                        {p.isMe && (
                                                                            <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent text-ludo-xs font-mono font-bold uppercase shrink-0">
                                                                                You
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {p.rankTier && (
                                                                        <div className="flex items-center gap-1 min-w-0 mt-0.5">
                                                                            <RankTierIcon
                                                                                tier={p.rankTier}
                                                                                className="w-3 h-3 shrink-0"
                                                                            />
                                                                            <span
                                                                                className={`text-ludo-xs font-mono font-bold tracking-tight uppercase truncate ${semanticTierText(
                                                                                    p.rankTier,
                                                                                )}`}
                                                                            >
                                                                                {p.rankTier}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </button>

                                                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                                                <div className="flex items-center gap-1 sm:gap-1.5 text-ludo-xs font-mono">
                                                                    <span
                                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-panel border border-line-soft font-bold text-positive"
                                                                        title="Tokens Home"
                                                                    >
                                                                        <FiHome className="w-3 h-3 text-positive shrink-0" />
                                                                        <span className="tabular-nums font-extrabold">
                                                                            {p.home ?? (p.isWinner ? 4 : 0)}/4
                                                                        </span>
                                                                    </span>
                                                                    <span
                                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-panel border border-line-soft font-bold text-warn"
                                                                        title="Captures / Kicks made"
                                                                    >
                                                                        <LuSwords className="w-3 h-3 text-warn shrink-0" />
                                                                        <span className="tabular-nums font-extrabold">
                                                                            {p.kicks}
                                                                        </span>
                                                                    </span>
                                                                    <span
                                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-panel border border-line-soft font-bold text-negative"
                                                                        title="Times token was captured / kicked"
                                                                    >
                                                                        <LuShieldAlert className="w-3 h-3 text-negative shrink-0" />
                                                                        <span className="tabular-nums font-extrabold">
                                                                            {p.gotKicked}
                                                                        </span>
                                                                    </span>
                                                                </div>

                                                                {p.isWinner ? (
                                                                    <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-md bg-warn/15 border border-warn/35 text-ludo-xs font-mono font-bold text-warn uppercase shrink-0">
                                                                        <LuTrophy className="w-3 h-3 shrink-0" />
                                                                        Winner
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-1.5 sm:px-2 py-0.5 text-ludo-xs font-mono font-bold text-ink-faint uppercase shrink-0">
                                                                        Defeated
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Match Telemetry Footer */}
                                            <div className="pt-1 border-t border-line-soft flex items-center justify-between gap-2 flex-wrap text-ludo-xs font-mono text-ink-faint">
                                                <div className="flex items-center gap-2">
                                                    <span>ID: {m.matchId.slice(0, 10)}…</span>
                                                    {m.roomCode && <span>• Room #{m.roomCode}</span>}
                                                </div>

                                                {m.syncTxHash ? (
                                                    <a
                                                        href={`${explorerBase}${m.syncTxHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-accent hover:brightness-110 font-bold uppercase tracking-wider transition-colors"
                                                    >
                                                        <span>BaseScan TX</span>
                                                        <LuExternalLink className="w-3 h-3" />
                                                    </a>
                                                ) : (
                                                    <span className="text-warn font-bold uppercase">
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

            {/* Local Public Profile Modal fallback */}
            <PublicProfileModal
                isOpen={Boolean(selectedProfileAddress)}
                userAddress={selectedProfileAddress}
                onClose={() => setSelectedProfileAddress(null)}
                onDM={(userId) => {
                    setSelectedProfileAddress(null);
                    window.dispatchEvent(
                        new CustomEvent('ludo-open-chat', { detail: { wallet: userId } }),
                    );
                }}
            />
        </div>
    );
}
