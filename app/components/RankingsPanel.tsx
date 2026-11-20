'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useGameData, type LeaderboardEntry } from '@/hooks/GameDataContext';
import { ThinkingOrb } from './ThinkingOrb';
import { useAppSession } from '@/hooks/useAppSession';
import { supabase } from '@/lib/supabase';
import { LuTrophy, LuTrendingUp, LuUsers, LuSearch, LuChevronRight, LuX } from 'react-icons/lu';
import { PanelTabs } from './PanelTabs';
import { GamePanelShell } from './GamePanelShell';
import { HudSectionLabel } from './HudPrimitives';
import { PilotAvatar } from './PilotAvatar';
import { ApexRankIcon } from './icons';
import RankTierIcon from './RankTierIcon';

interface RankingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenProfile: (address: string) => void;
}

const TIER_BEAM: Record<string, string> = {
    'Arena Master': 'bg-warn',
    Diamond: 'bg-accent',
    Platinum: 'bg-accent/70',
    Gold: 'bg-warn/85',
    Silver: 'bg-ink-muted',
    Bronze: 'bg-warn/55',
};

const TIER_TEXT_TONE: Record<string, string> = {
    'Arena Master': 'text-warn',
    Diamond: 'text-accent',
    Platinum: 'text-accent',
    Gold: 'text-warn',
    Silver: 'text-ink-muted',
    Bronze: 'text-ink-faint',
};

const MEDAL = ['#facc15', '#cbd5e1', '#d97706'] as const;

type FriendRowInput = string | { address?: string; wallet_address?: string };

export default function RankingsPanel({ isOpen, onClose, onOpenProfile }: RankingsPanelProps) {
    const { peekAppSession } = useAppSession();
    const { address } = useAccount();
    const { leaderboard: players, isBooting } = useGameData();
    const [activeFilter, setActiveFilter] = useState<'global' | 'friends'>('global');
    const [searchQuery, setSearchQuery] = useState('');
    const [friendWallets, setFriendWallets] = useState<string[]>([]);
    const [friendsLoading, setFriendsLoading] = useState(false);
    const [prizepool, setPrizepool] = useState<number | null>(null);

    // Live prizepool: sum of upcoming tournaments (hidden when zero/none)
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            try {
                const { data } = await supabase
                    .from('tournaments')
                    .select('prize_pool')
                    .eq('status', 'upcoming');
                const sum = (data || []).reduce(
                    (s: number, t: { prize_pool?: number | null }) => s + (Number(t.prize_pool) || 0),
                    0,
                );
                if (!cancelled) setPrizepool(sum > 0 ? sum : null);
            } catch {
                if (!cancelled) setPrizepool(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    // Live friends list for the FRIENDS tab
    useEffect(() => {
        if (!isOpen || !address || activeFilter !== 'friends') return;
        let cancelled = false;
        setFriendsLoading(true);
        (async () => {
            try {
                const sid = peekAppSession();
                const res = await fetch(
                    `/api/friends?wallet=${encodeURIComponent(address)}&walletAddress=${encodeURIComponent(address)}`,
                    sid
                        ? {
                              headers: {
                                  Authorization: `Bearer ${sid}`,
                                  'x-session-id': sid,
                              },
                          }
                        : undefined,
                );
                if (!res.ok) throw new Error('friends fetch failed');
                const data = await res.json();
                const follows = ((data.onchainFriends as FriendRowInput[] | undefined) || [])
                    .map((f) => (typeof f === 'string' ? f : f.address || f.wallet_address || '').toLowerCase())
                    .filter(Boolean);
                const accepted = ((data.acceptedFriends as FriendRowInput[] | undefined) || [])
                    .map((a) => (typeof a === 'string' ? a : a.wallet_address || a.address || '').toLowerCase())
                    .filter(Boolean);
                if (!cancelled) setFriendWallets([...new Set([address.toLowerCase(), ...follows, ...accepted])]);
            } catch {
                if (!cancelled) setFriendWallets([address.toLowerCase()]);
            } finally {
                if (!cancelled) setFriendsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen, address, activeFilter, peekAppSession]);

    if (!isOpen) return null;

    const basePlayers =
        activeFilter === 'friends'
            ? players.filter((p) => friendWallets.includes(p.wallet_address.toLowerCase()))
            : players;

    const q = searchQuery.trim().toLowerCase();
    const filteredPlayers = q
        ? basePlayers.filter(
              (p) =>
                  p.username?.toLowerCase().includes(q) || p.wallet_address.toLowerCase().includes(q),
          )
        : basePlayers;

    const rankOf = (wallet: string) =>
        basePlayers.findIndex((p) => p.wallet_address.toLowerCase() === wallet.toLowerCase()) + 1;

    const showPodium = !q && activeFilter === 'global' && basePlayers.length >= 3;
    const podium = basePlayers.slice(0, 3);
    const tablePlayers = showPodium ? filteredPlayers.slice(3) : filteredPlayers;
    const myRank = address ? rankOf(address) || null : null;
    const myEntry = address
        ? basePlayers.find((p) => p.wallet_address.toLowerCase() === address.toLowerCase())
        : undefined;

    // Live season countdown (quarters match YYYYQ)
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const quarterEnd = new Date(now.getFullYear(), quarter * 3 + 3, 0);
    const daysLeft = Math.max(0, Math.ceil((quarterEnd.getTime() - now.getTime()) / 86400000));
    const seasonId = now.getFullYear() * 10 + (quarter + 1);

    const formatPos = (rank: number) => String(rank).padStart(2, '0');

    const renderStandingsRow = (p: LeaderboardEntry, rank: number) => {
        const isMe = p.wallet_address.toLowerCase() === address?.toLowerCase();
        const tier = p.rank_tier || 'Bronze';
        const beam = TIER_BEAM[tier] ?? TIER_BEAM.Bronze;
        const tierColor = TIER_TEXT_TONE[tier] ?? 'text-ink-faint';
        const displayName =
            p.username && !p.username.startsWith('0x')
                ? p.username
                : `${p.wallet_address.slice(0, 6)}…${p.wallet_address.slice(-3)}`;

        return (
            <button
                key={p.wallet_address}
                type="button"
                onClick={() => onOpenProfile(p.wallet_address)}
                className={`group relative w-full grid grid-cols-[30px_minmax(0,1fr)_36px_62px] items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${
                    isMe
                        ? 'bg-accent-soft hover:bg-accent-soft/80'
                        : 'odd:bg-transparent even:bg-surface-panel/40 hover:bg-surface-hover'
                }`}
            >
                <span
                    className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full ${beam}`}
                    aria-hidden="true"
                />

                {/* POS */}
                <span
                    className={`font-mono text-ludo-sm font-bold tabular-nums pl-0.5 ${
                        isMe ? 'text-accent' : 'text-ink-faint'
                    }`}
                >
                    {formatPos(rank)}
                </span>

                {/* PILOT */}
                <div className="flex items-center gap-2 min-w-0">
                    <PilotAvatar
                        avatarUrl={p.avatar_url}
                        name={displayName}
                        size="xs"
                        tier={tier}
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-ludo-md font-bold text-ink-strong truncate leading-tight">
                                {displayName}
                            </span>
                            {isMe && (
                                <span className="shrink-0 bg-accent text-accent-ink text-ludo-xs font-extrabold px-1.5 py-0.5 rounded-sm uppercase tracking-wider leading-none">
                                    You
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 leading-none">
                            <RankTierIcon tier={tier} className="w-3 h-3 shrink-0" />
                            <span className={`text-ludo-xs font-bold uppercase tracking-wider truncate ${tierColor}`}>
                                {tier} {p.subRank}
                            </span>
                            <span className="text-ludo-xs font-mono text-ink-faint shrink-0">
                                · Lv.{p.level || 1}
                            </span>
                        </div>
                    </div>
                </div>

                {/* WINS */}
                <span className="text-right font-mono text-ludo-xs font-bold text-ink-muted tabular-nums">
                    {p.total_wins ?? 0}
                </span>

                {/* PTS */}
                <div className="flex items-center justify-end gap-1">
                    <span
                        className={`font-mono text-ludo-md font-extrabold tabular-nums leading-none ${
                            isMe ? 'text-accent' : 'text-ink-strong'
                        }`}
                    >
                        {(p.rxp || 1200).toLocaleString()}
                    </span>
                    <LuChevronRight className="w-3.5 h-3.5 shrink-0 text-ink-faint group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                </div>
            </button>
        );
    };

    return (
        <GamePanelShell
            scopeClass="ludo-rankings-scope"
            kicker="// SEASON STANDINGS"
            hideOrbs
            onClose={onClose}
            title={
                <span className="flex items-center gap-2">
                    <span className="hud-chamfer-sm w-7 h-7 rounded-xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                        <ApexRankIcon className="w-4 h-4" active />
                    </span>
                    <span>Ranking</span>
                </span>
            }
            subtitle={
                <span className="flex items-center gap-2 px-0.5 text-ludo-xs font-mono uppercase tracking-[0.14em]">
                    <span className="inline-flex items-center gap-1 text-accent font-bold">
                        <LuTrendingUp className="w-3 h-3" />
                        <span>
                            S{seasonId} · {daysLeft}d left
                        </span>
                    </span>
                    {prizepool !== null && (
                        <>
                            <span className="text-ink-faint" aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-recessed border border-line-soft text-ink-strong font-bold tabular-nums">
                                <span className="w-1.5 h-1.5 rounded-full bg-warn" />
                                ${prizepool.toLocaleString()}
                            </span>
                        </>
                    )}
                </span>
            }
        >
            {/* Scope Tabs + Slim Search */}
            <div className="flex flex-col gap-2">
                <PanelTabs
                    value={activeFilter}
                    onPick={setActiveFilter}
                    options={[
                        { value: 'global', label: 'Global', icon: <LuUsers className="w-3.5 h-3.5" /> },
                        { value: 'friends', label: 'Friends', icon: <LuTrophy className="w-3.5 h-3.5" /> },
                    ]}
                />

                <div className="search-shell flex items-center gap-2 bg-surface-recessed border border-line-soft rounded-xl px-2.5 h-8 focus-within:border-accent transition-colors overflow-hidden">
                    <LuSearch className="w-3.5 h-3.5 shrink-0 text-ink-faint" />
                    <input
                        type="text"
                        placeholder="Filter callsign or 0x address…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        className="flex-1 min-w-0 bg-transparent border-0 p-0 text-ludo-sm font-bold text-ink-strong placeholder:text-ink-faint focus:outline-none"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            aria-label="Clear search"
                            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-surface-hover text-ink-muted hover:text-ink-strong"
                        >
                            <LuX className="w-2.5 h-2.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Compact Sports Championship Podium (#2 | #1 | #3) */}
            {showPodium && (
                <div className="grid grid-cols-3 gap-1.5 items-end">
                    {[podium[1], podium[0], podium[2]].map((p, si) => {
                        if (!p) return <div key={si} />;
                        const rank = si === 1 ? 1 : si === 0 ? 2 : 3;
                        const isMe = p.wallet_address.toLowerCase() === address?.toLowerCase();
                        const lead = rank === 1;
                        const displayName =
                            p.username && !p.username.startsWith('0x')
                                ? p.username
                                : `${p.wallet_address.slice(0, 6)}…`;
                        return (
                            <button
                                key={p.wallet_address}
                                type="button"
                                onClick={() => onOpenProfile(p.wallet_address)}
                                className={`relative rounded-xl border bg-surface-recessed hover:bg-surface-hover transition-colors flex flex-col items-center overflow-hidden px-1.5 ${
                                    lead ? 'pt-2.5 pb-2 border-line-strong' : 'pt-2 pb-1.5 border-line-soft'
                                } ${isMe ? 'ring-1 ring-accent' : ''}`}
                            >
                                <div
                                    className="absolute top-0 inset-x-3 h-[2px] rounded-b-full"
                                    style={{ background: MEDAL[rank - 1] }}
                                />
                                <div className="flex items-center gap-1 mb-1">
                                    {lead && <LuTrophy className="w-3 h-3" style={{ color: MEDAL[0] }} />}
                                    <span
                                        className="font-mono text-ludo-xs font-extrabold tabular-nums"
                                        style={{ color: MEDAL[rank - 1] }}
                                    >
                                        #{formatPos(rank)}
                                    </span>
                                </div>
                                <PilotAvatar
                                    avatarUrl={p.avatar_url}
                                    name={displayName}
                                    size={lead ? 'sm' : 'xs'}
                                    tier={p.rank_tier}
                                />
                                <span className="mt-1 text-ludo-xs font-bold text-ink-strong truncate w-full text-center leading-tight">
                                    {displayName}
                                </span>
                                <span className="text-ludo-xs font-mono font-bold text-ink-muted tabular-nums leading-tight">
                                    {(p.rxp || 1200).toLocaleString()} pts
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Sports Standings League Table */}
            <div className="flex flex-col gap-1.5">
                <HudSectionLabel
                    right={
                        <span className="text-ludo-xs font-mono text-ink-faint tabular-nums">
                            {filteredPlayers.length} Pilots
                        </span>
                    }
                >
                    {showPodium ? 'League Standings' : 'Classification'}
                </HudSectionLabel>

                {isBooting || (activeFilter === 'friends' && friendsLoading) ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 rounded-2xl border border-line-soft bg-surface-recessed">
                        <ThinkingOrb state="working" size={32} />
                        <span className="text-ludo-xs font-mono font-bold text-ink-faint uppercase tracking-[0.24em]">
                            Syncing Standings…
                        </span>
                    </div>
                ) : filteredPlayers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center rounded-2xl border border-line-soft bg-surface-recessed">
                        <LuUsers className="w-7 h-7 text-ink-faint" />
                        <span className="text-ludo-sm font-bold text-ink-muted uppercase tracking-widest">
                            {activeFilter === 'friends' ? 'No friends ranked yet' : 'No pilots found'}
                        </span>
                        <span className="text-ludo-xs text-ink-faint">
                            {activeFilter === 'friends'
                                ? 'Add friends to compare season standings'
                                : 'Try a different search filter'}
                        </span>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-line-soft bg-surface-recessed overflow-hidden divide-y divide-line-soft">
                        {/* Table Column Header */}
                        <div className="grid grid-cols-[30px_minmax(0,1fr)_36px_62px] items-center gap-2 px-3 py-1.5 bg-surface-panel/90 text-ludo-xs font-mono font-bold uppercase tracking-[0.16em] text-ink-faint">
                            <span>Pos</span>
                            <span>Pilot</span>
                            <span className="text-right">W</span>
                            <span className="text-right pr-4">Pts</span>
                        </div>

                        {tablePlayers.map((p) => renderStandingsRow(p, rankOf(p.wallet_address)))}
                    </div>
                )}
            </div>

            {/* Pinned Broadcast Ticker: Your Standing */}
            {myEntry && myRank !== null && (
                <button
                    type="button"
                    onClick={() => address && onOpenProfile(address)}
                    className="w-full rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 grid grid-cols-[30px_minmax(0,1fr)_36px_62px] items-center gap-2 text-left hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer"
                >
                    <span className="font-mono text-ludo-sm font-extrabold text-accent tabular-nums">
                        #{formatPos(myRank)}
                    </span>
                    <div className="flex items-center gap-2 min-w-0">
                        <PilotAvatar
                            avatarUrl={myEntry.avatar_url}
                            name={myEntry.username || 'You'}
                            size="xs"
                            tier={myEntry.rank_tier}
                        />
                        <div className="min-w-0">
                            <div className="text-ludo-xs font-mono font-bold uppercase tracking-[0.14em] text-accent leading-none">
                                Your Standing
                            </div>
                            <div className="text-ludo-xs font-bold text-ink-strong truncate mt-0.5 leading-none">
                                {myEntry.rank_tier || 'Bronze'} {myEntry.subRank || ''}
                            </div>
                        </div>
                    </div>
                    <span className="text-right font-mono text-ludo-xs font-bold text-ink-muted tabular-nums">
                        {myEntry.total_wins ?? 0}
                    </span>
                    <div className="flex items-center justify-end gap-1">
                        <span className="font-mono text-ludo-md font-extrabold text-ink-strong tabular-nums">
                            {(myEntry.rxp || 1200).toLocaleString()}
                        </span>
                        <LuChevronRight className="w-3.5 h-3.5 text-accent shrink-0" />
                    </div>
                </button>
            )}
        </GamePanelShell>
    );
}
