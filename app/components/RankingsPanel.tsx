'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';
import { supabase } from '@/lib/supabase';
import { LuTrophy, LuTrendingUp, LuUsers, LuSearch, LuChevronRight, LuX } from 'react-icons/lu';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as marketplace/settings: this panel always renders on the shared
// dark-glass sandwich shell, so content uses only white-ink + white-opacity
// surfaces + cyan/medal accents. No font-family is set (inherits the active
// theme's display font). Spacing inside `.ludo-rankings-scope` is re-asserted
// in globals.css (the global unlayered reset zeroes Tailwind utilities).

interface RankingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenProfile: (address: string) => void;
}

const TIER_BEAM: Record<string, string> = {
    'Arena Master': 'bg-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.9)]',
    Diamond: 'bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]',
    Platinum: 'bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.9)]',
    Gold: 'bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.9)]',
    Silver: 'bg-slate-300 shadow-[0_0_12px_rgba(203,213,225,0.9)]',
    Bronze: 'bg-amber-600 shadow-[0_0_12px_rgba(217,119,6,0.9)]',
};

const MEDAL = ['#facc15', '#e2e8f0', '#d97706'];

export default function RankingsPanel({ isOpen, onClose, onOpenProfile }: RankingsPanelProps) {
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
        (async () => {
            try {
                const { data } = await (supabase.from('tournaments') as any)
                    .select('prize_pool')
                    .eq('status', 'upcoming');
                const sum = (data || []).reduce((s: number, t: any) => s + (Number(t.prize_pool) || 0), 0);
                setPrizepool(sum > 0 ? sum : null);
            } catch {
                setPrizepool(null);
            }
        })();
    }, [isOpen]);

    // Live friends list for the FRIENDS tab (same source as the profile modal)
    useEffect(() => {
        if (!isOpen || !address || activeFilter !== 'friends') return;
        let cancelled = false;
        setFriendsLoading(true);
        (async () => {
            try {
                const res = await fetch(`/api/friends?wallet=${address}`);
                if (!res.ok) throw new Error('friends fetch failed');
                const data = await res.json();
                // Friendship evidence = Farcaster follows + accepted game friendships.
                // gameFriends is just recent active players (directory) — excluded.
                const follows = [...(data.onchainFriends || [])]
                    .map((f: any) => (f.address || f.wallet_address || '').toLowerCase())
                    .filter(Boolean);
                const accepted = (data.acceptedFriends || [])
                    .map((a: any) => (typeof a === 'string' ? a : a.wallet_address || a.address || '').toLowerCase())
                    .filter(Boolean);
                if (!cancelled) setFriendWallets([...new Set([address.toLowerCase(), ...follows, ...accepted])]);
            } catch {
                if (!cancelled) setFriendWallets([address.toLowerCase()]);
            } finally {
                if (!cancelled) setFriendsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, address, activeFilter]);

    const basePlayers = activeFilter === 'friends'
        ? players.filter(p => friendWallets.includes(p.wallet_address.toLowerCase()))
        : players;

    const q = searchQuery.trim().toLowerCase();
    const filteredPlayers = q
        ? basePlayers.filter(p =>
            p.username?.toLowerCase().includes(q) ||
            p.wallet_address.toLowerCase().includes(q)
        )
        : basePlayers;

    const rankOf = (wallet: string) =>
        basePlayers.findIndex(p => p.wallet_address.toLowerCase() === wallet.toLowerCase()) + 1;

    const showPodium = !q && activeFilter === 'global' && basePlayers.length >= 3;
    const podium = basePlayers.slice(0, 3);
    const tablePlayers = showPodium ? filteredPlayers.slice(3) : filteredPlayers;
    const myRank = address ? rankOf(address) || null : null;
    const myEntry = address ? basePlayers.find(p => p.wallet_address.toLowerCase() === address.toLowerCase()) : undefined;

    // Live season countdown (quarters match the DB season_id convention YYYYQ)
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const quarterEnd = new Date(now.getFullYear(), quarter * 3 + 3, 0);
    const daysLeft = Math.max(0, Math.ceil((quarterEnd.getTime() - now.getTime()) / 86400000));
    const seasonId = now.getFullYear() * 10 + (quarter + 1);

    const getTierColor = (tier: string) => {
        switch (tier) {
            case 'Arena Master': return 'text-orange-400';
            case 'Diamond': return 'text-cyan-300';
            case 'Platinum': return 'text-blue-400';
            case 'Gold': return 'text-yellow-400';
            case 'Silver': return 'text-slate-300';
            default: return 'text-amber-600';
        }
    };

    const avatar = (p: any, box: string, text: string) => (
        <div className={`${box} rounded-full border-2 border-white/10 overflow-hidden bg-cyan-900/50 flex-shrink-0`}>
            {p.avatar_url ? (
                <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
                <div className={`w-full h-full flex items-center justify-center text-white/30 font-black ${text}`}>{p.username?.[0]?.toUpperCase() || 'L'}</div>
            )}
        </div>
    );

    const row = (p: any, rank: number, i: number) => {
        const isMe = p.wallet_address.toLowerCase() === address?.toLowerCase();
        return (
            <motion.div
                key={p.wallet_address}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.04 }}
                onClick={() => onOpenProfile(p.wallet_address)}
                className={`group relative rounded-2xl bg-white/[0.04] border overflow-hidden cursor-pointer transition-all hover:bg-white/[0.07] active:scale-[0.99] ${isMe ? 'border-cyan-500/40 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.1)]' : 'border-white/10 hover:border-white/25'}`}
            >
                <div className={`absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full ${TIER_BEAM[p.rank_tier || 'Bronze'] ?? TIER_BEAM.Bronze}`} />
                <div className="flex items-center gap-3 p-3">
                    <div className="w-7 flex-shrink-0 text-center text-white/25 font-black italic text-base font-mono">#{rank}</div>
                    {avatar(p, 'w-10 h-10', 'text-sm')}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <h4 className="text-white font-bold truncate text-[13px]">{p.username || `${p.wallet_address.slice(0, 6)}...`}</h4>
                            {isMe && (
                                <span className="shrink-0 bg-cyan-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider">YOU</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] font-black uppercase tracking-widest ${getTierColor(p.rank_tier || 'Bronze')}`}>{p.rank_tier || 'Bronze'} {p.subRank}</span>
                            <span className="text-[9px] text-white/25 font-bold uppercase tracking-widest">Lv.{p.level}</span>
                        </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                        <div className="text-lg font-black text-white tracking-tighter leading-none font-mono">{p.rxp || 1200}</div>
                        <div className="text-[8px] text-white/30 font-black uppercase tracking-widest mt-0.5">ELO</div>
                    </div>
                    <LuChevronRight className="w-4 h-4 shrink-0 text-white/10 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
                </div>
            </motion.div>
        );
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                        onClick={onClose}
                    />

                    {/* Panel Container */}
                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            className="w-full max-w-[500px] relative h-full pointer-events-auto"
                        >
                            <div
                                className="ludo-rankings-scope absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                                style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13, 13, 13, 0.92))', backdropFilter: 'blur(32px)' }}
                            >
                                {/* Authentic Subdued Cosmic Orbs */}
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                {/* Drag Handle */}
                                <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                {/* Header */}
                                <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                                    <div className="flex items-center justify-between mb-1 mt-1">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
                                                <LuTrophy className="w-4 h-4 text-cyan-300" />
                                            </div>
                                            Rankings
                                        </h2>
                                        <button
                                            onClick={onClose}
                                            aria-label="Close rankings"
                                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                                        >
                                            <LuX className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2 px-0.5">
                                        <span className="flex items-center gap-1">
                                            <LuTrendingUp className="w-3 h-3 text-cyan-400" />
                                            <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase">
                                                S{seasonId} · {daysLeft}d left
                                            </span>
                                        </span>
                                        {prizepool !== null && (
                                            <>
                                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/40 border border-white/10">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
                                                    <span className="text-[11px] font-black text-white tabular-nums font-mono">${prizepool.toLocaleString()}</span>
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Filter + Search */}
                                <div className="px-5 pt-3 relative z-10">
                                    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-black/50 border border-white/10">
                                        {([
                                            { id: 'global', label: 'Global', icon: <LuUsers className="w-3.5 h-3.5" /> },
                                            { id: 'friends', label: 'Friends', icon: <LuTrophy className="w-3.5 h-3.5" /> },
                                        ] as const).map(f => (
                                            <button
                                                key={f.id}
                                                onClick={() => setActiveFilter(f.id)}
                                                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${activeFilter === f.id ? 'bg-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]' : 'text-white/35 hover:text-white/70'}`}
                                            >
                                                <span className={activeFilter === f.id ? 'text-cyan-300' : ''}>{f.icon}</span>
                                                {f.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl pl-2.5 pr-1.5 h-10 mt-2 focus-within:border-cyan-500/60 transition-colors overflow-hidden">
                                        <LuSearch className="w-3.5 h-3.5 shrink-0 text-white/35" />
                                        <input
                                            type="text"
                                            placeholder="Search players"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="flex-1 min-w-0 bg-transparent border-0 p-0 text-xs font-bold text-white placeholder:text-white/25 focus:outline-none focus:ring-0"
                                        />
                                        {searchQuery && (
                                            <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white">
                                                <LuX className="w-2.5 h-2.5" />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Podium */}
                                {showPodium && (
                                    <div className="px-5 pt-3 relative z-10">
                                        <div className="grid grid-cols-3 gap-2 items-end">
                                            {[podium[1], podium[0], podium[2]].map((p, si) => {
                                                if (!p) return <div key={si} />;
                                                const rank = si === 1 ? 1 : si === 0 ? 2 : 3;
                                                const isMe = p.wallet_address.toLowerCase() === address?.toLowerCase();
                                                const lead = rank === 1;
                                                return (
                                                    <button
                                                        key={p.wallet_address}
                                                        onClick={() => onOpenProfile(p.wallet_address)}
                                                        className={`relative rounded-2xl border bg-white/[0.04] hover:bg-white/[0.07] transition-all flex flex-col items-center overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${lead ? 'py-3 border-white/20' : 'py-2.5 border-white/10'} ${isMe ? '!border-cyan-500/50' : ''}`}
                                                    >
                                                        <div className="absolute top-0 inset-x-8 h-[2px] rounded-full" style={{ background: MEDAL[rank - 1], boxShadow: `0 0 12px ${MEDAL[rank - 1]}` }} />
                                                        {lead && <LuTrophy className="w-3.5 h-3.5 mb-1" style={{ color: MEDAL[0] }} />}
                                                        <div className={`${lead ? 'w-14 h-14' : 'w-11 h-11'} rounded-full overflow-hidden border-2 bg-cyan-900/50`} style={{ borderColor: `${MEDAL[rank - 1]}66` }}>
                                                            {p.avatar_url ? (
                                                                <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-white/30 font-black text-base">{p.username?.[0]?.toUpperCase() || 'L'}</div>
                                                            )}
                                                        </div>
                                                        <span className="mt-1.5 text-[10px] font-black text-white truncate w-full px-1 text-center">
                                                            {p.username || `${p.wallet_address.slice(0, 6)}...`}
                                                        </span>
                                                        <span className="text-[10px] font-black font-mono" style={{ color: MEDAL[rank - 1] }}>
                                                            #{rank} · {(p.rxp || 1200).toLocaleString()}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* List */}
                                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2 relative z-10">
                                    <div className="mt-1 mb-1 flex items-center gap-2.5">
                                        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono">
                                            {showPodium ? 'THE CHASE' : `${filteredPlayers.length} PLAYERS`}
                                        </span>
                                        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
                                    </div>
                                    {isBooting || (activeFilter === 'friends' && friendsLoading) ? (
                                        <div className="h-full flex flex-col items-center justify-center gap-4 py-16">
                                            <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
                                            <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Synching Tiers</span>
                                        </div>
                                    ) : filteredPlayers.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center gap-2 px-8 py-16 text-center">
                                            <LuUsers className="w-8 h-8 text-white/20" />
                                            <span className="text-xs font-black text-white/40 uppercase tracking-widest">
                                                {activeFilter === 'friends' ? 'No friends on the board yet' : 'No players found'}
                                            </span>
                                            <span className="text-[10px] text-white/25">
                                                {activeFilter === 'friends' ? 'Add friends to rank against them' : 'Try a different search'}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2 pb-2">
                                            {tablePlayers.map((p, i) => row(p, rankOf(p.wallet_address), i))}
                                        </div>
                                    )}
                                </div>

                                {/* Your rank (pinned set-bar) */}
                                {myEntry && myRank !== null && (
                                    <div className="px-5 pb-3 relative z-10">
                                        <button
                                            onClick={() => address && onOpenProfile(address)}
                                            className="w-full rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2.5 flex items-center gap-3 text-left hover:bg-cyan-500/15 active:scale-[0.99] transition-all"
                                        >
                                            {avatar(myEntry, 'w-9 h-9', 'text-xs')}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300/80">Your rank</div>
                                                <div className="text-xs font-black text-white truncate">
                                                    #{myRank} · <span className={getTierColor(myEntry.rank_tier || 'Bronze')}>{myEntry.rank_tier || 'Bronze'}</span>
                                                </div>
                                            </div>
                                            <div className="text-base font-black text-white font-mono">{(myEntry.rxp || 1200).toLocaleString()}</div>
                                            <LuChevronRight className="w-4 h-4 text-cyan-300/60" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}
