"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelTabs, PanelChildTabs } from './PanelTabs';

interface Activity {
    id: string;
    actor_id: string;
    type: 'win' | 'join_tournament' | 'level_up' | 'big_bet' | 'trophy';
    metadata: any;
    created_at: string;
    actor?: {
        username: string;
        avatar_url: string;
    };
}

// Open matchmaking pool: real waiters you can join right now.
interface LiveSearch {
    key: string;
    playerId: string;
    hostName: string;
    avatar: string | null;
    gameMode: string;
    matchType: string;
    wager: number;
    createdAt: number;
    started: boolean;
}

// Opponents still needed per match type.
const SEATS_NEEDED: Record<string, number> = { '1v1': 1, '2v2': 3, '4P': 3 };

type BTab = 'matches' | 'chat';
type CScope = 'global' | 'local';

// ─── Live Chat: global shoutbox, last 20 per scope ──────────────────────────
interface ChatMsg {
    id: string;
    sender_id: string;
    username: string | null;
    avatar_url: string | null;
    content: string;
    country: string;
    created_at: string;
}

const MODE_TINT: Record<string, string> = {
    classic: 'bg-cyan-500/15 text-cyan-300',
    power: 'bg-amber-500/15 text-amber-300',
};

const ModeGlyph = ({ mode }: { mode: string }) => (
    mode === 'power' ? (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
    ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>
    )
);

const ageLabel = (ts: number) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
};

// Section label: pill + gradient rule (marketplace vocabulary)
const SectionLabel = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="mt-1 mb-1 flex items-center gap-2.5">
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
        {right}
    </div>
);

const BroadcastTile = () => (
    <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)] shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    </div>
);

interface Activity {
    id: string;
    actor_id: string;
    type: 'win' | 'join_tournament' | 'level_up' | 'big_bet' | 'trophy';
    metadata: any;
    created_at: string;
    actor?: {
        username: string;
        avatar_url: string;
    };
}

export const ActivityFeed = () => {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [searches, setSearches] = useState<LiveSearch[]>([]);
    const { address } = useAccount();
    const { address: identityAddress } = useCurrentUser();
    const { guard } = useGuestWall();
    const me = (address || '').toLowerCase();
    const hostCache = useRef<Map<string, { name: string; avatar: string | null }>>(new Map());

    const [btab, setBtab] = useState<BTab>('chat');
    const [cscope, setCscope] = useState<CScope>('global');

    // ── Chat state ──
    const [msgs, setMsgs] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [cooldown, setCooldown] = useState(0);
    const [country, setCountry] = useState('XX');
    const [chatLoading, setChatLoading] = useState(false);
    const chatScrollRef = useRef<HTMLDivElement>(null);

    const resolveHost = useCallback(async (playerId: string) => {
        const key = playerId.toLowerCase();
        const cached = hostCache.current.get(key);
        if (cached) return cached;
        try {
            const { data } = await supabase
                .from('players')
                .select('username, avatar_url')
                .ilike('wallet_address', playerId)
                .single();
            const name = (data?.username && !data.username.startsWith('0x'))
                ? data.username
                : `User ${playerId.slice(0, 6).toUpperCase()}`;
            const entry = { name, avatar: data?.avatar_url || null };
            hostCache.current.set(key, entry);
            return entry;
        } catch {
            const entry = { name: `User ${playerId.slice(0, 6).toUpperCase()}`, avatar: null };
            hostCache.current.set(key, entry);
            return entry;
        }
    }, []);

    // ── Session feed: searches that START after arrival (no backfill),
    // capped at the last 10. Leaving `searching` flips a row to STARTED.
    useEffect(() => {
        const channel = supabase
            .channel('live-broadcast-searches')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matchmaking_queue' }, async (payload) => {
                const row: any = payload.new;
                if (!row || row.status !== 'searching') return;
                if ((row.player_id || '').toLowerCase() === me) return;
                if ((row.player_id || '').toLowerCase().startsWith('guest_')) return;
                const host = await resolveHost(row.player_id);
                const entry: LiveSearch = {
                    key: `${row.player_id}-${row.created_at || Date.now()}`,
                    playerId: row.player_id,
                    hostName: host.name,
                    avatar: host.avatar,
                    gameMode: row.game_mode || 'classic',
                    matchType: row.match_type || '4P',
                    wager: Number(row.wager) || 0,
                    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
                    started: false,
                };
                setSearches(prev => [...prev, entry].slice(-10));
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matchmaking_queue' }, (payload) => {
                const row: any = payload.new;
                if (!row || row.status === 'searching') return;
                setSearches(prev => prev.map(s =>
                    s.playerId.toLowerCase() === (row.player_id || '').toLowerCase() && !s.started
                        ? { ...s, started: true }
                        : s
                ));
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matchmaking_queue' }, (payload) => {
                const row: any = payload.old;
                if (!row?.player_id) return;
                setSearches(prev => prev.filter(s => s.playerId.toLowerCase() !== (row.player_id || '').toLowerCase()));
            })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [me, resolveHost]);

    useEffect(() => {
        const fetchInitial = async () => {
            const { data } = await (supabase.from('activities') as any)
                .select('*, actor:players(username, avatar_url)')
                .order('created_at', { ascending: false })
                .limit(6);
            if (data) setActivities(data as any);
        };

        fetchInitial();

        const channel = supabase
            .channel('public_activities')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities' }, async (payload) => {
                const { data } = await supabase
                    .from('players')
                    .select('username, avatar_url')
                    .eq('wallet_address', payload.new.actor_id)
                    .single();

                const newActivity = { ...payload.new, actor: data } as Activity;
                setActivities(prev => [newActivity, ...prev].slice(0, 6));
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const getActivityText = (activity: Activity) => {
        switch (activity.type) {
            case 'join_tournament': return `joined the ${activity.metadata.tournament_title || 'Arena'} tournament`;
            case 'win': return `won ${activity.metadata.amount} coins in #${activity.metadata.room_code}`;
            case 'level_up': return `reached Level ${activity.metadata.level}!`;
            case 'big_bet': return `placed a ${activity.metadata.amount} bet on #${activity.metadata.room_code}`;
            case 'trophy': return `earned the "${activity.metadata.trophy_name}" trophy!`;
            default: return 'is active in the Arena';
        }
    };

    const joinSearch = (s: LiveSearch) => {
        // Same handshake the pool ticker used: GameLobby tunes its settings
        // and opens QuickMatch search. Guest wall applies there.
        window.dispatchEvent(new CustomEvent('join_pool', {
            detail: { entryFee: s.wager, mode: s.gameMode, matchType: s.matchType }
        }));
    };

    const totalWaiting = searches.filter(s => !s.started).length;
    const recentActivity = activities.slice(0, 3);
    const [isOpen, setIsOpen] = useState(false);

    // ── Viewer country (edge IP geolocation) ──
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/geo');
                if (res.ok) {
                    const data = await res.json();
                    if (data.country) setCountry(data.country);
                }
            } catch {
                /* unknown — global only */
            }
        })();
    }, []);

    // ── Chat state + history per scope + live INSERTs (vanish beyond 20) ──
    useEffect(() => {
        if (btab !== 'chat') return;
        let cancelled = false;
        setChatLoading(true);
        (async () => {
            try {
                const q = cscope === 'local' && country !== 'XX'
                    ? `/api/live-chat?country=${country}&limit=20`
                    : '/api/live-chat?limit=20';
                const res = await fetch(q);
                if (res.ok && !cancelled) setMsgs(await res.json());
            } catch {
                /* feed stays as-is */
            } finally {
                if (!cancelled) setChatLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [btab, cscope, country]);

    useEffect(() => {
        if (btab !== 'chat') return;
        const channel = supabase
            .channel('live-broadcast-chat')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const m = payload.new as ChatMsg;
                if (cscope === 'local' && m.country !== country) return;
                setMsgs(prev => [...prev, m].slice(-20));
            })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [btab, cscope, country]);

    useEffect(() => {
        if (cooldown > 0) {
            const t = setTimeout(() => setCooldown(c => c - 1), 1000);
            return () => clearTimeout(t);
        }
    }, [cooldown]);

    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [msgs, btab]);

    const sendChat = async () => {
        const text = input.trim().slice(0, 140);
        if (!text || cooldown > 0) return;
        // Guests read free; posting needs a wallet.
        if (!guard('dm')) return;
        const wallet = (identityAddress || '').toLowerCase();
        if (!wallet) return;
        setInput('');
        setCooldown(10);
        try {
            const res = await fetch('/api/live-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet, content: text })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                if (res.status === 429 && err.waitLeft) setCooldown(err.waitLeft);
            }
        } catch {
            /* realtime will fill the gap on retry */
        }
    };

    const seatsFor = (s: LiveSearch) => {
        const need = SEATS_NEEDED[s.matchType] ?? 3;
        const others = searches.filter(o =>
            !o.started &&
            o.gameMode === s.gameMode &&
            o.matchType === s.matchType &&
            o.wager === s.wager &&
            o.playerId.toLowerCase() !== s.playerId.toLowerCase()
        ).length;
        return `${Math.min(others, need)}/${need}`;
    };

    return (
        <div className="w-full flex flex-col items-center gap-3">
            {/* ── Compact one-line bar (streaming-ticker language) ── */}
            <div className="ludo-ticker-scope w-full max-w-[320px] mx-auto mt-6 relative z-10">
                <div
                    onClick={() => setIsOpen(true)}
                    className="pointer-events-auto h-12 w-full rounded-2xl flex items-center gap-3 px-4 relative overflow-hidden transition-all cursor-pointer border border-cyan-500/20 bg-black/60 backdrop-blur-3xl hover:border-cyan-400/50 active:scale-[0.98]"
                >
                    <BroadcastTile />
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <span className="text-[11px] font-black text-white/80 uppercase tracking-[0.2em] leading-none">
                            Live Broadcast
                        </span>
                        <span className="text-[10px] font-bold text-cyan-500/70 tracking-wide mt-0.5 truncate">
                            {totalWaiting > 0 ? `${totalWaiting} match${totalWaiting === 1 ? '' : 'es'} live` : 'No matches live'}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Full broadcasting page ── */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[100] bg-black/40"
                            onClick={() => setIsOpen(false)}
                        />
                        <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                            <div className="w-full max-w-[500px] relative h-full">
                                <motion.div
                                    initial={{ opacity: 0, y: 24, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 24, scale: 0.98 }}
                                    transition={{ type: 'spring', damping: 24, stiffness: 300 }}
                                    className="ludo-broadcast-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                                    style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))', backdropFilter: 'blur(32px)' }}
                                >
                                    {/* Authentic Subdued Cosmic Orbs */}
                                    <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                    <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                    {/* Handle Bar */}
                                    <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                                        <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                    </div>

                                    {/* Header */}
                                    <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                                        <div className="flex items-center justify-between mb-1 mt-1">
                                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                                <BroadcastTile />
                                                Live Broadcast
                                            </h2>
                                            <button
                                                onClick={() => setIsOpen(false)}
                                                aria-label="Close live broadcast"
                                                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2 px-0.5">
                                            <span className={`w-1.5 h-1.5 rounded-full ${totalWaiting > 0 ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.9)] animate-pulse' : 'bg-white/25'}`} />
                                            <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                                {searches.length} recent
                                            </span>
                                        </div>
                                    </div>
                                    {/* Content */}
                                    <div className="flex-1 min-h-0 overflow-hidden relative z-10 flex flex-col">
                                        {/* Parent tabs */}
                                        <div className="px-5 pt-3">
                                            <PanelTabs
                                                value={btab}
                                                onPick={setBtab}
                                                options={[
                                                    { value: 'matches', label: 'Live Matches' },
                                                    { value: 'chat', label: 'Live Chat' },
                                                ]}
                                            />
                                        </div>
                                        {btab === 'matches' ? (
                                            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2">
                                        <SectionLabel>Live now</SectionLabel>
                                        {searches.length > 0 ? (
                                            <div className="flex flex-col gap-2 pb-2">
                                                {[...searches].reverse().map((s) => (
                                                    <div
                                                        key={s.key}
                                                        className={`flex items-center gap-3 p-3 rounded-2xl border backdrop-blur-md transition-colors ${s.started ? 'bg-white/[0.02] border-white/5 opacity-70' : 'bg-white/[0.04] border-white/10 hover:border-cyan-500/30'}`}
                                                    >
                                                        <div className="w-10 h-10 rounded-full overflow-hidden bg-cyan-900/50 shrink-0 flex items-center justify-center">
                                                            {s.avatar ? (
                                                                <img src={s.avatar} alt={s.hostName} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <span className="text-white/50 font-black text-sm">{s.hostName[0]?.toUpperCase()}</span>
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0 flex flex-col">
                                                            <span className="text-[13px] font-black text-white truncate">{s.hostName}</span>
                                                            <span className="text-[10px] font-bold text-white/40 tabular-nums mt-0.5 truncate">
                                                                {s.matchType} · {s.gameMode} · {seatsFor(s)} · {s.wager === 0 ? 'Free' : `${s.wager.toLocaleString()}`}
                                                            </span>
                                                        </div>
                                                        {s.started ? (
                                                            <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase tracking-[0.15em] text-white/40">
                                                                Started
                                                            </span>
                                                        ) : (
                                                            <button
                                                                onClick={() => { setIsOpen(false); joinSearch(s); }}
                                                                className="shrink-0 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-[10px] font-black uppercase tracking-[0.15em] text-cyan-300 hover:bg-cyan-400 hover:text-slate-950 hover:border-cyan-400 active:scale-95 transition-all"
                                                            >
                                                                Join
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                                <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                                                    <ModeGlyph mode="classic" />
                                                </div>
                                                <h3 className="text-white font-black text-sm mb-1">Quiet airwaves</h3>
                                                <p className="text-white/40 text-xs max-w-[220px]">Searches that start while you're here appear instantly.</p>
                                            </div>
                                        )}

                                        <SectionLabel>Recent arena</SectionLabel>
                                        {recentActivity.length > 0 ? (
                                            <div className="flex flex-col gap-2 pb-2">
                                                {recentActivity.map((activity) => (
                                                    <div
                                                        key={activity.id}
                                                        className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md"
                                                    >
                                                        <div className="w-8 h-8 rounded-full border border-white/20 overflow-hidden bg-white/10 shrink-0">
                                                            <img
                                                                src={activity.actor?.avatar_url || `https://avatar.vercel.sh/${activity.actor_id}`}
                                                                alt="avatar"
                                                                className="w-full h-full object-cover"
                                                            />
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-[13px] text-white/90 truncate font-semibold">
                                                                <span className="text-cyan-400 font-black">
                                                                    {activity.actor?.username || activity.actor_id.slice(0, 6)}
                                                                </span>
                                                                {' '}{getActivityText(activity)}
                                                            </span>
                                                            <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest mt-0.5">
                                                                {new Date(activity.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="py-5 text-center border-2 border-dashed border-white/10 rounded-3xl">
                                                <span className="text-[10px] font-black text-white/35 uppercase tracking-[0.3em]">No broadcasts detected</span>
                                            </div>
                                        )}
                                    </div>
                                        ) : (
                                            /* ── Live Chat ── */
                                            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                                                <div className="px-5 pt-2">
                                                    {/* Child tabs: Global / Local */}
                                                    <PanelChildTabs
                                                        ariaLabel="Chat scope"
                                                        value={cscope}
                                                        onPick={setCscope}
                                                        options={[
                                                            { value: 'global', label: 'global' },
                                                            {
                                                                value: 'local', label: 'local',
                                                                pill: (
                                                                    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono ${cscope === 'local' ? 'bg-cyan-400/20 text-cyan-200' : 'bg-white/5 text-white/30'}`}>
                                                                        {country}
                                                                    </span>
                                                                ),
                                                            },
                                                        ]}
                                                    />
                                                </div>

                                                <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-2 pb-2">
                                                    {chatLoading && msgs.length === 0 ? (
                                                        <div className="flex items-center justify-center py-16">
                                                            <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                                                        </div>
                                                    ) : msgs.length === 0 ? (
                                                        <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                                            <h3 className="text-white font-black text-sm mb-1">Dead air</h3>
                                                            <p className="text-white/40 text-xs max-w-[220px]">
                                                                {cscope === 'local' ? `No shouts from ${country} yet — be the first.` : 'No shouts yet — be the first.'}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col gap-2 pb-2">
                                                            {msgs.map((m) => {
                                                                const mine = m.sender_id.toLowerCase() === me;
                                                                return (
                                                                    <div key={m.id} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                                                                        <div className="w-8 h-8 rounded-full overflow-hidden bg-cyan-900/50 shrink-0 flex items-center justify-center">
                                                                            {m.avatar_url ? (
                                                                                <img src={m.avatar_url} alt={m.username || 'user'} className="w-full h-full object-cover" />
                                                                            ) : (
                                                                                <span className="text-white/50 font-black text-xs">{(m.username?.[0] || 'U').toUpperCase()}</span>
                                                                            )}
                                                                        </div>
                                                                        <div className={`flex flex-col max-w-[80%] ${mine ? 'items-end' : 'items-start'}`}>
                                                                            <span className="text-[10px] font-bold text-white/35 mb-0.5">
                                                                                {mine ? 'You' : m.username || 'User'} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                            </span>
                                                                            <div className={`py-2 px-3.5 rounded-2xl text-[13px] leading-snug ${mine ? 'bg-cyan-700 text-white rounded-tr-md' : 'bg-white/10 text-white/90 rounded-tl-md border border-white/5'}`}>
                                                                                {m.content}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Input */}
                                                <div className="px-5 pt-2 pb-3">
                                                    <div className="flex gap-1.5 relative">
                                                        <input
                                                            type="text"
                                                            value={input}
                                                            maxLength={140}
                                                            onChange={(e) => setInput(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                                                            disabled={cooldown > 0}
                                                            placeholder={cooldown > 0 ? `Wait ${cooldown}s...` : 'Shout to the arena...'}
                                                            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl pl-3 pr-12 py-2.5 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-600/50 transition-colors disabled:opacity-50"
                                                        />
                                                        <div className={`absolute right-[52px] top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${input.length >= 130 ? 'text-red-400 font-bold' : 'text-white/20'}`}>
                                                            {input.length}/140
                                                        </div>
                                                        <button
                                                            onClick={sendChat}
                                                            disabled={!input.trim() || cooldown > 0}
                                                            aria-label="Send shout"
                                                            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-cyan-700 text-white disabled:opacity-50 disabled:bg-white/10 transition-all hover:bg-cyan-600 relative overflow-hidden"
                                                        >
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                                                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                                            </svg>
                                                            {cooldown > 0 && (
                                                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-xs font-bold text-white backdrop-blur-sm">
                                                                    {cooldown}s
                                                                </div>
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            </div>
                        </div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};
