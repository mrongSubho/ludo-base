'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';
import { PanelTabs, PanelChildTabs } from './PanelTabs';
import { ThinkingOrb } from './ThinkingOrb';
import { GamePanelShell } from './GamePanelShell';
import { PilotAvatar } from './PilotAvatar';
import { ApexRankIcon } from './icons';
import RankTierIcon from './RankTierIcon';

const ITEMS_PER_PAGE = 20;

type LeaderboardTab = 'tier' | 'daily' | 'monthly';

interface StandingsEntry {
    id: string;
    name: string;
    avatar: string | null;
    wins: number;
    rxp: number;
    lastWin: number;
    isCurrentUser?: boolean;
    tierName: string;
    subRank: string;
    level: number;
}

interface LeaderboardProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenProfile: (address: string) => void;
}

export default function Leaderboard({ isOpen, onClose, onOpenProfile }: LeaderboardProps) {
    const { address } = useAccount();
    const { leaderboard: rawLeaders, isBooting: isLoading } = useGameData();

    const [activeTab, setActiveTab] = useState<LeaderboardTab>('tier');
    const [scope, setScope] = useState<'global' | 'friends'>('global');
    const [showQuarterInfo, setShowQuarterInfo] = useState(false);
    const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;
    const [currentPage, setCurrentPage] = useState(1);

    const leaders: StandingsEntry[] = rawLeaders.map((player) => ({
        id: player.wallet_address,
        name:
            player.username && !player.username.startsWith('0x')
                ? player.username
                : `User ${player.wallet_address.slice(-4).toUpperCase()}`,
        avatar: player.avatar_url,
        wins: player.total_wins || 0,
        rxp: player.rxp || 1200,
        lastWin: new Date(player.last_played_at || Date.now()).getTime(),
        isCurrentUser: address
            ? player.wallet_address.toLowerCase() === address.toLowerCase()
            : false,
        tierName: player.rank_tier || player.tierName || 'Bronze',
        subRank: player.subRank || '',
        level: player.level || 1,
    }));

    const paginatedLeaders = leaders.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE,
    );
    const totalPages = Math.ceil(leaders.length / ITEMS_PER_PAGE) || 1;

    useEffect(() => {
        if (!isOpen) setCurrentPage(1);
    }, [isOpen]);

    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, scope]);

    if (!isOpen) return null;

    return (
        <GamePanelShell
            scopeClass="ludo-leaderboard-scope"
            kicker="// MATCH STANDINGS"
            hideOrbs
            onClose={onClose}
            title={
                <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                        <ApexRankIcon className="w-4 h-4" active />
                    </span>
                    <span>Ranking</span>
                </span>
            }
            subtitle={
                <span className="flex items-center gap-2 text-ludo-xs font-mono uppercase tracking-[0.14em]">
                    <span className="text-ink-muted font-bold tabular-nums">
                        {leaders.length} ranked
                    </span>
                    <span className="text-ink-faint" aria-hidden="true">·</span>
                    <span className="text-accent font-bold">Q{currentQuarter} Season</span>
                </span>
            }
        >
            <div className="flex flex-col gap-2">
                <PanelTabs
                    value={scope}
                    onPick={setScope}
                    options={[
                        { value: 'global', label: 'Global' },
                        { value: 'friends', label: 'Friends' },
                    ]}
                />

                <div className="relative">
                    <PanelChildTabs
                        ariaLabel="Ranking period"
                        value={activeTab}
                        onPick={setActiveTab}
                        options={[
                            {
                                value: 'tier',
                                label: 'tier',
                                pill: (
                                    <span
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowQuarterInfo(!showQuarterInfo);
                                        }}
                                        className={`px-1.5 py-0.5 rounded-md text-ludo-xs font-mono cursor-pointer ${
                                            activeTab === 'tier'
                                                ? 'bg-accent-soft text-accent'
                                                : 'bg-surface-recessed text-ink-faint'
                                        }`}
                                    >
                                        Q{currentQuarter}
                                    </span>
                                ),
                            },
                            { value: 'daily', label: 'daily' },
                            { value: 'monthly', label: 'monthly' },
                        ]}
                    />

                    <AnimatePresence>
                        {showQuarterInfo && (
                            <motion.div
                                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 4, scale: 0.96 }}
                                className="mt-2 p-2.5 bg-surface-panel border border-line-strong rounded-xl text-ludo-xs text-ink-muted"
                            >
                                <span className="font-bold text-ink-strong">Quarterly Resets: </span>
                                Ranks reset every 3 months (Q1–Q4).
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-2xl border border-line-soft bg-surface-recessed">
                    <ThinkingOrb state="working" size={32} />
                    <p className="text-ink-faint text-ludo-xs font-mono font-bold uppercase tracking-widest">
                        Syncing Standings…
                    </p>
                </div>
            ) : leaders.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-12 px-5 rounded-2xl border border-line-soft bg-surface-recessed">
                    <h3 className="text-ink-strong font-bold text-ludo-md mb-1">The throne is empty</h3>
                    <p className="text-ink-faint text-ludo-xs max-w-[220px]">
                        No records found for this period.
                    </p>
                </div>
            ) : (
                <div className="rounded-2xl border border-line-soft bg-surface-recessed overflow-hidden divide-y divide-line-soft">
                    <div className="grid grid-cols-[30px_minmax(0,1fr)_36px_62px] items-center gap-2 px-3 py-1.5 bg-surface-panel/90 text-ludo-xs font-mono font-bold uppercase tracking-[0.16em] text-ink-faint">
                        <span>Pos</span>
                        <span>Pilot</span>
                        <span className="text-right">W</span>
                        <span className="text-right">{activeTab === 'tier' ? 'Pts' : 'Score'}</span>
                    </div>

                    {paginatedLeaders.map((entry, idx) => {
                        const isMe = entry.isCurrentUser;
                        const rank = (currentPage - 1) * ITEMS_PER_PAGE + idx + 1;
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                onClick={() => onOpenProfile(entry.id)}
                                className={`w-full grid grid-cols-[30px_minmax(0,1fr)_36px_62px] items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${
                                    isMe
                                        ? 'bg-accent-soft hover:bg-accent-soft/80'
                                        : 'odd:bg-transparent even:bg-surface-panel/40 hover:bg-surface-hover'
                                }`}
                            >
                                <span
                                    className={`font-mono text-ludo-sm font-bold tabular-nums ${
                                        rank <= 3 || isMe ? 'text-accent' : 'text-ink-faint'
                                    }`}
                                >
                                    {String(rank).padStart(2, '0')}
                                </span>

                                <div className="flex items-center gap-2 min-w-0">
                                    <PilotAvatar
                                        avatarUrl={entry.avatar}
                                        name={entry.name}
                                        size="xs"
                                        tier={entry.tierName}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-ludo-md font-bold text-ink-strong truncate leading-tight">
                                                {entry.name}
                                            </span>
                                            {isMe && (
                                                <span className="shrink-0 bg-accent text-accent-ink text-ludo-xs font-extrabold px-1.5 py-0.5 rounded-sm uppercase tracking-wider leading-none">
                                                    You
                                                </span>
                                            )}
                                        </div>
                                        {activeTab === 'tier' && (
                                            <div className="flex items-center gap-1 mt-0.5 leading-none">
                                                <RankTierIcon tier={entry.tierName} className="w-3 h-3 shrink-0" />
                                                <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-muted truncate">
                                                    {entry.tierName} {entry.subRank}
                                                </span>
                                                <span className="text-ludo-xs font-mono text-ink-faint">
                                                    · Lv.{entry.level}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <span className="text-right font-mono text-ludo-xs font-bold text-ink-muted tabular-nums">
                                    {entry.wins}
                                </span>

                                <span
                                    className={`text-right font-mono text-ludo-md font-extrabold tabular-nums ${
                                        isMe ? 'text-accent' : 'text-ink-strong'
                                    }`}
                                >
                                    {(activeTab === 'tier' ? entry.rxp : entry.wins).toLocaleString()}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1 text-ludo-xs font-mono text-ink-muted">
                    <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="px-2.5 py-1 rounded-lg bg-surface-recessed border border-line-soft disabled:opacity-40"
                    >
                        Prev
                    </button>
                    <span>
                        Page {currentPage} / {totalPages}
                    </span>
                    <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className="px-2.5 py-1 rounded-lg bg-surface-recessed border border-line-soft disabled:opacity-40"
                    >
                        Next
                    </button>
                </div>
            )}
        </GamePanelShell>
    );
}
