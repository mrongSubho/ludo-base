"use client";

// Home of the live panels (rendered inside the Live Arena card):
// - LiveChatPanel: session-only global/local shoutbox
// - LiveMatchSearchesPanel: joinable matchmaking pool + recent arena activity

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelChildTabs } from './PanelTabs';

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
    // Party ticket room code (room_code IS NOT NULL on the ticket).
    // Null = solo pool waiter. Present = joinable party, direct link.
    roomCode: string | null;
}

// Opponents still needed per match type.
const SEATS_NEEDED: Record<string, number> = { '1v1': 1, '2v2': 3, '4P': 3 };

// Open party rooms announced from Live chat (backfilled + realtime).
interface LiveRoom {
    key: string;
    roomCode: string;
    content: string;
    hostName: string;
    avatar: string | null;
    createdAt: number;
    open: boolean;
    country?: string;
}

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
    room_code?: string | null;
    room_open?: boolean | null;
}

const ModeGlyph = ({ mode }: { mode: string }) => (
    mode === 'power' ? (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
    ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>
    )
);

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

export const LiveChatPanel = ({ onOpenProfile, onJoin }: { onOpenProfile?: (address: string) => void; onJoin?: () => void }) => {
    const { address } = useAccount();
    const { address: identityAddress } = useCurrentUser();
    const { guard } = useGuestWall();
    const me = (address || '').toLowerCase();

    const [cscope, setCscope] = useState<CScope>('global');

    // ── Chat state: buffered per scope (session-only) ──
    const [msgs, setMsgs] = useState<{ global: ChatMsg[]; local: ChatMsg[] }>({ global: [], local: [] });
    const visibleMsgs = msgs[cscope];
    const [input, setInput] = useState('');
    const [cooldown, setCooldown] = useState(0);
    const [country, setCountry] = useState('XX');
    const chatScrollRef = useRef<HTMLDivElement>(null);

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

    // ── Chat: session-only realtime, buffered PER SCOPE ────────────────
    // You see only shouts that arrive after you arrive; tab switches keep
    // each scope's session feed (global collects everything, local keeps
    // your country's). Everything vanishes when you leave the app.
    useEffect(() => {
        const channel = supabase
            .channel('live-broadcast-chat')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const m = payload.new as ChatMsg;
                setMsgs(prev => {
                    const next = { ...prev, global: [...prev.global, m].slice(-20) };
                    if (m.country === country) {
                        next.local = [...prev.local, m].slice(-20);
                    }
                    return next;
                });
            })
            // Room announces rewrite their row (seat fills, start/close):
            // merge in place so counts stay live without reposts.
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat' }, (payload) => {
                const m = payload.new as ChatMsg;
                setMsgs(prev => {
                    const merge = (list: ChatMsg[]) => {
                        if (!list.some(x => x.id === m.id)) return list;
                        return list.map(x => (x.id === m.id ? { ...x, ...m } : x));
                    };
                    return { ...prev, global: merge(prev.global), local: merge(prev.local) };
                });
            })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [country]);

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
    }, [msgs]);

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

    return (
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
                {visibleMsgs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                        <h3 className="text-white font-black text-sm mb-1">Dead air</h3>
                        <p className="text-white/40 text-xs max-w-[220px]">
                            {cscope === 'local' ? `No shouts from ${country} yet — be the first.` : 'No shouts yet — be the first.'}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 pb-2">
                        {visibleMsgs.map((m) => {
                            const mine = m.sender_id.toLowerCase() === me;
                            // Room announce: the WHOLE row is the link (no code
                            // shown, no separate button). Open rooms tap to join;
                            // started/closed rows read dimmed with a status chip.
                            const isRoom = !!m.room_code;
                            const roomOpen = m.room_open !== false;
                            const joinable = isRoom && roomOpen && !mine;
                            const joinRoom = () => {
                                if (!m.room_code) return;
                                window.dispatchEvent(new CustomEvent('join_party', {
                                    detail: { roomCode: m.room_code }
                                }));
                                onJoin?.();
                            };
                            return (
                                <div key={m.id} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                                    <button
                                        onClick={() => !mine && onOpenProfile?.(m.sender_id)}
                                        aria-label={mine ? 'Your avatar' : `Open ${m.username || 'user'} profile`}
                                        disabled={mine}
                                        className="w-8 h-8 rounded-full overflow-hidden bg-cyan-900/50 shrink-0 flex items-center justify-center disabled:cursor-default enabled:hover:scale-105 enabled:hover:ring-2 enabled:hover:ring-cyan-400/60 transition-all"
                                    >
                                        {m.avatar_url ? (
                                            <img loading="lazy" decoding="async" src={m.avatar_url} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" />
                                        ) : (
                                            <span className="text-white/50 font-black text-xs pointer-events-none">{(m.username?.[0] || 'U').toUpperCase()}</span>
                                        )}
                                    </button>
                                    <div className={`flex flex-col min-w-0 max-w-[80%] ${mine ? 'items-end' : 'items-start'}`}>
                                        <span className="text-[10px] font-bold text-white/35 mb-0.5" style={{ color: '#555555' }}>
                                            {mine ? 'You' : m.username || 'User'} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        {joinable ? (
                                            <button
                                                onClick={joinRoom}
                                                title={`Join room ${m.room_code}`}
                                                className="room-join-row py-2.5 px-4 rounded-2xl rounded-tl-md border border-cyan-500/40 bg-cyan-500/10 text-left text-[13px] leading-relaxed break-words [overflow-wrap:anywhere] text-white/90 hover:bg-cyan-500/20 hover:border-cyan-400/60 active:scale-[0.99] transition-all cursor-pointer w-full"
                                            >
                                                <span className="text-white/90">{m.content || '…'}</span>
                                                <span className="block mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">
                                                    Tap to join →
                                                </span>
                                            </button>
                                        ) : (
                                            <div className={`py-2.5 px-4 rounded-2xl text-[13px] leading-relaxed break-words [overflow-wrap:anywhere] ${mine ? 'chat-own bg-cyan-700 text-white rounded-tr-md shadow-lg' : 'bg-white/10 text-white/90 rounded-tl-md border border-white/5'} ${isRoom && !roomOpen ? 'opacity-60' : ''}`} style={mine ? { backgroundColor: '#171717', color: '#ffffff' } : undefined}>
                                                {m.content || '…'}
                                                {isRoom && !roomOpen && (
                                                    <span className="ml-2 px-1.5 py-0.5 rounded-md bg-white/10 text-[8px] font-black uppercase tracking-[0.15em] text-white/50 align-middle">
                                                        Over
                                                    </span>
                                                )}
                                            </div>
                                        )}
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
                        className="chat-send w-11 h-11 shrink-0 flex items-center justify-center rounded-full bg-cyan-700 text-white disabled:opacity-60 transition-all hover:bg-cyan-600 active:scale-95 relative overflow-hidden shadow-lg"
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
    );
};

export const LiveMatchSearchesPanel = ({ onJoin }: { onJoin?: () => void }) => {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [searches, setSearches] = useState<LiveSearch[]>([]);
    // Open party rooms (announced via Live chat): backfilled so late
    // arrivals see them, then kept live. Whole row joins — same handshake.
    const [rooms, setRooms] = useState<LiveRoom[]>([]);
    // Session-scoped discovery: rooms announced before this session stay
    // invisible; closing the app cleans the slate (nothing persists client-
    // side, and started rows are filtered server-side by room_open).
    const sessionStart = useRef(Date.now());
    useEffect(() => {
        const toRoom = (row: any): LiveRoom | null => {
            if (!row?.room_code) return null;
            return {
                key: `${row.room_code}`,
                roomCode: row.room_code,
                content: row.content || '',
                hostName: row.username || 'Host',
                avatar: row.avatar_url ?? null,
                createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
                open: row.room_open !== false,
                country: row.country || 'XX',
            };
        };
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('live_chat')
                    .select('room_code, content, username, avatar_url, sender_id, room_open, country, created_at')
                    .not('room_code', 'is', null)
                    .eq('room_open', true)
                    .order('created_at', { ascending: false })
                    .limit(20);
                if (error) throw error;
                const seen = new Map<string, LiveRoom>();
                for (const row of data || []) {
                    const r = toRoom(row);
                    // Session bound: pre-session history stays cleaned.
                    // (Upserts bump created_at, so live rooms re-surface.)
                    if (r && !seen.has(r.roomCode) && r.createdAt >= sessionStart.current) seen.set(r.roomCode, r);
                }
                setRooms([...seen.values()]);
            } catch {
                /* pre-migration DB or offline — searches still work */
            }
        })();
        const channel = supabase
            .channel('live-broadcast-rooms')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = toRoom(payload.new);
                if (!r) return;
                setRooms(prev => [r, ...prev.filter(x => x.roomCode !== r.roomCode)].slice(0, 20));
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = toRoom(payload.new);
                if (!r) return;
                setRooms(prev => r.open
                    ? [r, ...prev.filter(x => x.roomCode !== r.roomCode)].slice(0, 20)
                    : prev.filter(x => x.roomCode !== r.roomCode));
            })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, []);
    const { address } = useAccount();
    const me = (address || '').toLowerCase();
    const hostCache = useRef<Map<string, { name: string; avatar: string | null }>>(new Map());

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
                    roomCode: row.room_code ?? null,
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
        // Party ticket (room code present): direct join link — deterministic,
        // straight into the host's room. No matchmaking lottery.
        if (s.roomCode) {
            window.dispatchEvent(new CustomEvent('join_party', {
                detail: { roomCode: s.roomCode }
            }));
            onJoin?.();
            return;
        }
        // Same handshake the pool ticker used: GameLobby tunes its settings
        // and opens QuickMatch search. Guest wall applies there.
        window.dispatchEvent(new CustomEvent('join_pool', {
            detail: { entryFee: s.wager, mode: s.gameMode, matchType: s.matchType }
        }));
        onJoin?.();
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

    const totalWaiting = searches.filter(s => !s.started).length;
    const recentActivity = activities.slice(0, 3);

    return (
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2">
            {rooms.length > 0 && (
                <>
                    <SectionLabel>Open rooms · {rooms.length}</SectionLabel>
                    <div className="flex flex-col gap-2 pb-2">
                        {rooms.map((r) => (
                            <button
                                key={r.key}
                                onClick={() => {
                                    window.dispatchEvent(new CustomEvent('join_party', {
                                        detail: { roomCode: r.roomCode }
                                    }));
                                    onJoin?.();
                                }}
                                title={`Join ${r.hostName}'s room`}
                                className="room-join-row flex items-center gap-3 p-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 backdrop-blur-md transition-all text-left w-full hover:bg-cyan-500/20 hover:border-cyan-400/60 active:scale-[0.99] cursor-pointer"
                            >
                                <div className="w-10 h-10 rounded-full overflow-hidden bg-cyan-900/50 shrink-0 flex items-center justify-center">
                                    {r.avatar ? (
                                        <img loading="lazy" decoding="async" src={r.avatar} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" />
                                    ) : (
                                        <span className="text-white/50 font-black text-sm pointer-events-none">{r.hostName[0]?.toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col">
                                    <span className="text-[13px] font-black text-white truncate">{r.hostName}</span>
                                    <span className="text-[10px] font-bold text-white/40 tabular-nums mt-0.5 truncate">
                                        {r.content}
                                    </span>
                                </div>
                                <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-[9px] font-black uppercase tracking-[0.15em] text-cyan-300 pointer-events-none">
                                    Join
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
            <SectionLabel>Live now{totalWaiting > 0 ? ` · ${totalWaiting} waiting` : ''}</SectionLabel>
            {searches.length > 0 ? (
                <div className="flex flex-col gap-2 pb-2">
                    {[...searches].reverse().map((s) => (
                        <div
                            key={s.key}
                            className={`flex items-center gap-3 p-3 rounded-2xl border backdrop-blur-md transition-colors ${s.started ? 'bg-white/[0.02] border-white/5 opacity-70' : 'bg-white/[0.04] border-white/10 hover:border-cyan-500/30'}`}
                        >
                            <div className="w-10 h-10 rounded-full overflow-hidden bg-cyan-900/50 shrink-0 flex items-center justify-center">
                                {s.avatar ? (
                                    <img loading="lazy" decoding="async" src={s.avatar} alt={s.hostName} className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-white/50 font-black text-sm">{s.hostName[0]?.toUpperCase()}</span>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col">
                                <span className="text-[13px] font-black text-white truncate">
                                    {s.hostName}
                                    {s.roomCode && (
                                        <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-amber-400/15 border border-amber-400/40 text-[8px] font-black uppercase tracking-[0.15em] text-amber-300 align-middle">
                                            Party
                                        </span>
                                    )}
                                </span>
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
                                    onClick={() => joinSearch(s)}
                                    className="shrink-0 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-[10px] font-black uppercase tracking-[0.15em] text-cyan-300 hover:bg-cyan-400 hover:text-slate-950 hover:border-cyan-400 active:scale-95 transition-all"
                                >
                                    {s.roomCode ? 'Join Party' : 'Join'}
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
    );
};

// ─── Unified broadcast feed: ONE timeline, toggle-pill filters ────────────
// Chat shouts + open rooms + pool searches + arena activity merged
// newest-first. Two independent pills (friends-panel pattern): Local scopes
// chat and rooms by country; Matches hides plain chatter. Pool tickets carry
// no country — global pool by nature, always pass.
interface FeedItem {
    key: string;
    ts: number;
    kind: 'chat' | 'room' | 'search' | 'activity';
    msg?: ChatMsg;
    room?: LiveRoom;
    search?: LiveSearch;
    activity?: Activity;
}

export const UnifiedBroadcastFeed = ({ onOpenProfile, onJoin }: { onOpenProfile?: (address: string) => void; onJoin?: () => void }) => {
    const { address } = useAccount();
    const { address: identityAddress } = useCurrentUser();
    const { guard } = useGuestWall();
    const me = (address || '').toLowerCase();

    const [matchesOnly, setMatchesOnly] = useState(false);
    const [localOnly, setLocalOnly] = useState(false);
    const [country, setCountry] = useState('XX');
    const [chats, setChats] = useState<ChatMsg[]>([]);
    const [rooms, setRooms] = useState<LiveRoom[]>([]);
    const [searches, setSearches] = useState<LiveSearch[]>([]);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [input, setInput] = useState('');
    const [cooldown, setCooldown] = useState(0);
    const feedScrollRef = useRef<HTMLDivElement>(null);
    const hostCache = useRef<Map<string, { name: string; avatar: string | null }>>(new Map());
    const sessionStart = useRef(Date.now());

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

    const toRoom = useCallback((row: any): LiveRoom | null => {
        if (!row?.room_code) return null;
        return {
            key: `${row.room_code}`,
            roomCode: row.room_code,
            content: row.content || '',
            hostName: row.username || 'Host',
            avatar: row.avatar_url ?? null,
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
            open: row.room_open !== false,
            country: row.country || 'XX',
        };
    }, []);

    // Country for the Local filter.
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/geo');
                const data = await res.json();
                if (data.country) setCountry(data.country);
            } catch {
                /* unknown — global only */
            }
        })();
    }, []);

    // Chat: session feed (arrivals only), UPDATEs merge room rewrites.
    useEffect(() => {
        const channel = supabase
            .channel('unified-chat')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const m = payload.new as ChatMsg;
                setChats(prev => [...prev, m].slice(-40));
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat' }, (payload) => {
                const m = payload.new as ChatMsg;
                setChats(prev => {
                    if (!prev.some(x => x.id === m.id)) return prev;
                    return prev.map(x => (x.id === m.id ? { ...x, ...m } : x));
                });
            })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // Rooms: session-bounded backfill + live merge.
    useEffect(() => {
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('live_chat')
                    .select('room_code, content, username, avatar_url, sender_id, room_open, country, created_at')
                    .not('room_code', 'is', null)
                    .eq('room_open', true)
                    .order('created_at', { ascending: false })
                    .limit(20);
                if (error) throw error;
                const seen = new Map<string, LiveRoom>();
                const since = sessionStart.current;
                for (const row of data || []) {
                    const r = toRoom(row);
                    if (r && !seen.has(r.roomCode) && r.createdAt >= since) seen.set(r.roomCode, r);
                }
                setRooms([...seen.values()]);
            } catch {
                /* pre-migration — rooms section stays empty */
            }
        })();
        const channel = supabase
            .channel('unified-rooms')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = toRoom(payload.new);
                if (!r) return;
                setRooms(prev => [r, ...prev.filter(x => x.roomCode !== r.roomCode)].slice(0, 20));
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = toRoom(payload.new);
                if (!r) return;
                setRooms(prev => r.open
                    ? [r, ...prev.filter(x => x.roomCode !== r.roomCode)].slice(0, 20)
                    : prev.filter(x => x.roomCode !== r.roomCode));
            })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [toRoom]);

    // Searches: session feed, capped at 10.
    useEffect(() => {
        const channel = supabase
            .channel('unified-searches')
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
                    roomCode: row.room_code ?? null,
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Arena activity: recent backfill + live prepend, capped at 6.
    useEffect(() => {
        (async () => {
            try {
                const { data } = await (supabase.from('activities') as any)
                    .select('*, actor:players(username, avatar_url)')
                    .order('created_at', { ascending: false })
                    .limit(6);
                if (data) setActivities(data as any);
            } catch {
                /* activities unavailable */
            }
        })();
        const channel = supabase
            .channel('unified_activities')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities' }, async (payload) => {
                try {
                    const { data } = await supabase
                        .from('players')
                        .select('username, avatar_url')
                        .eq('wallet_address', payload.new.actor_id)
                        .single();
                    const newActivity = { ...payload.new, actor: data } as Activity;
                    setActivities(prev => [newActivity, ...prev].slice(0, 6));
                } catch {
                    /* skip actor-less activity */
                }
            })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        if (cooldown > 0) {
            const t = setTimeout(() => setCooldown(c => c - 1), 1000);
            return () => clearTimeout(t);
        }
    }, [cooldown]);

    const sendChat = async () => {
        const text = input.trim().slice(0, 140);
        if (!text || cooldown > 0) return;
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

    const joinRoom = (roomCode: string) => {
        window.dispatchEvent(new CustomEvent('join_party', {
            detail: { roomCode }
        }));
        onJoin?.();
    };

    const joinSearch = (s: LiveSearch) => {
        if (s.roomCode) {
            joinRoom(s.roomCode);
            return;
        }
        window.dispatchEvent(new CustomEvent('join_pool', {
            detail: { entryFee: s.wager, mode: s.gameMode, matchType: s.matchType }
        }));
        onJoin?.();
    };

    const activityText = (activity: Activity) => {
        switch (activity.type) {
            case 'join_tournament': return `joined the ${activity.metadata.tournament_title || 'Arena'} tournament`;
            case 'win': return `won ${activity.metadata.amount} coins in #${activity.metadata.room_code}`;
            case 'level_up': return `reached Level ${activity.metadata.level}!`;
            case 'big_bet': return `placed a ${activity.metadata.amount} bet on #${activity.metadata.room_code}`;
            case 'trophy': return `earned the "${activity.metadata.trophy_name}" trophy!`;
            default: return 'is active in the Arena';
        }
    };

    const items = useMemo(() => {
        const out: FeedItem[] = [];
        const meLower = me;
        for (const m of chats) {
            const mineMsg = (m.sender_id || '').toLowerCase() === meLower;
            if (matchesOnly && !m.room_code) continue;
            // Own shouts always pass Local — you're local to yourself,
            // regardless of what country the edge stamped (VPNs, routing).
            if (localOnly && !mineMsg && (m.country || 'XX') !== country) continue;
            out.push({ key: `c-${m.id}`, ts: m.created_at ? new Date(m.created_at).getTime() : 0, kind: 'chat', msg: m });
        }
        for (const r of rooms) {
            if (!r.open) continue;
            if (localOnly && (r.country || 'XX') !== country) continue;
            out.push({ key: `r-${r.key}`, ts: r.createdAt, kind: 'room', room: r });
        }
        for (const s of searches) {
            // Pool tickets carry no country — global pool by nature.
            out.push({ key: `s-${s.key}`, ts: s.createdAt, kind: 'search', search: s });
        }
        if (matchesOnly) {
            for (const a of activities) {
                out.push({ key: `a-${a.id}`, ts: a.created_at ? new Date(a.created_at).getTime() : 0, kind: 'activity', activity: a });
            }
        }
        // Chronological, oldest first — regular messaging order, latest lands
        // at the bottom above the input.
        out.sort((x, y) => x.ts - y.ts);
        return out;
    }, [chats, rooms, searches, activities, matchesOnly, localOnly, country, me]);

    // Stick to the latest message like any messenger.
    useEffect(() => {
        const el = feedScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [items.length]);

    const emptyHint = matchesOnly
        ? (localOnly ? 'No live matches nearby right now.' : 'Quiet airwaves — rooms and searches land here live.')
        : (localOnly ? `No shouts from ${country} yet — be the first.` : 'No shouts yet — be the first.');

    return (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Filters: two independent toggle pills (friends-panel pattern).
                No tabs, no segmented control — Local scopes, Matches hides
                plain chatter. Both off = the full firehose. */}
            <div className="px-5 pt-3 flex items-center justify-end gap-1.5">
                <button
                    onClick={() => setLocalOnly(v => !v)}
                    aria-pressed={localOnly}
                    title={localOnly ? 'Show global feed' : 'Show only nearby'}
                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all border ${localOnly ? 'bg-green-500/20 text-green-300 border-green-500/40' : 'bg-white/5 text-white/40 border-white/10 hover:text-white/70'}`}
                >
                    <span className={`w-1 h-1 rounded-full ${localOnly ? 'bg-green-400 animate-pulse' : 'bg-white/30'}`} />
                    Local{country !== 'XX' ? ` · ${country}` : ''}
                </button>
                <button
                    onClick={() => setMatchesOnly(v => !v)}
                    aria-pressed={matchesOnly}
                    title={matchesOnly ? 'Show everything' : 'Show only matches'}
                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all border ${matchesOnly ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-white/5 text-white/40 border-white/10 hover:text-white/70'}`}
                >
                    <span className={`w-1 h-1 rounded-full ${matchesOnly ? 'bg-cyan-300 animate-pulse' : 'bg-white/30'}`} />
                    Matches
                </button>
            </div>

            {/* One timeline, chronological — latest lands at the bottom */}
            <div ref={feedScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                        <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                            <ModeGlyph mode="classic" />
                        </div>
                        <h3 className="text-white font-black text-sm mb-1">Quiet airwaves</h3>
                        <p className="text-white/40 text-xs max-w-[220px]">{emptyHint}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 pb-2">
                        {items.map((it) => {
                            if (it.kind === 'room' && it.room) {
                                const r = it.room;
                                return (
                                    <button
                                        key={it.key}
                                        onClick={() => joinRoom(r.roomCode)}
                                        title={`Join ${r.hostName}'s room`}
                                        className="room-join-row flex items-center gap-3 p-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 backdrop-blur-md transition-all text-left w-full hover:bg-cyan-500/20 hover:border-cyan-400/60 active:scale-[0.99] cursor-pointer"
                                    >
                                        <div className="w-10 h-10 rounded-full overflow-hidden bg-cyan-900/50 shrink-0 flex items-center justify-center">
                                            {r.avatar ? (
                                                <img loading="lazy" decoding="async" src={r.avatar} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" />
                                            ) : (
                                                <span className="text-white/50 font-black text-sm pointer-events-none">{r.hostName[0]?.toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 flex flex-col">
                                            <span className="text-[13px] font-black text-white truncate">{r.hostName}</span>
                                            <span className="text-[10px] font-bold text-white/40 tabular-nums mt-0.5 truncate">
                                                {r.content}
                                            </span>
                                        </div>
                                        <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-[9px] font-black uppercase tracking-[0.15em] text-cyan-300 pointer-events-none">
                                            Join
                                        </span>
                                    </button>
                                );
                            }
                            if (it.kind === 'search' && it.search) {
                                const s = it.search;
                                return (
                                    <div
                                        key={it.key}
                                        className={`flex items-center gap-3 p-3 rounded-2xl border backdrop-blur-md transition-colors ${s.started ? 'bg-white/[0.02] border-white/5 opacity-70' : 'bg-white/[0.04] border-white/10 hover:border-cyan-500/30'}`}
                                    >
                                        <div className="w-10 h-10 rounded-full overflow-hidden bg-cyan-900/50 shrink-0 flex items-center justify-center">
                                            {s.avatar ? (
                                                <img loading="lazy" decoding="async" src={s.avatar} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" />
                                            ) : (
                                                <span className="text-white/50 font-black text-sm pointer-events-none">{s.hostName[0]?.toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 flex flex-col">
                                            <span className="text-[13px] font-black text-white truncate">{s.hostName}</span>
                                            <span className="text-[10px] font-bold text-white/40 tabular-nums mt-0.5 truncate">
                                                {s.matchType} · {s.gameMode} · {s.wager === 0 ? 'Free' : `${s.wager.toLocaleString()}`}
                                            </span>
                                        </div>
                                        {s.started ? (
                                            <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase tracking-[0.15em] text-white/40">
                                                Started
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => joinSearch(s)}
                                                className="shrink-0 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-[10px] font-black uppercase tracking-[0.15em] text-cyan-300 hover:bg-cyan-400 hover:text-slate-950 hover:border-cyan-400 active:scale-95 transition-all"
                                            >
                                                {s.roomCode ? 'Join Party' : 'Join'}
                                            </button>
                                        )}
                                    </div>
                                );
                            }
                            if (it.kind === 'activity' && it.activity) {
                                const activity = it.activity;
                                return (
                                    <div
                                        key={it.key}
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
                                                {' '}{activityText(activity)}
                                            </span>
                                            <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest mt-0.5">
                                                {new Date(activity.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                );
                            }
                            const m = it.msg!;
                            const mine = m.sender_id.toLowerCase() === me;
                            const mIsRoom = !!m.room_code;
                            const mRoomOpen = m.room_open !== false;
                            const joinable = mIsRoom && mRoomOpen && !mine;
                            return (
                                <div key={it.key} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                                    <button
                                        onClick={() => !mine && onOpenProfile?.(m.sender_id)}
                                        aria-label={mine ? 'Your avatar' : `Open ${m.username || 'user'} profile`}
                                        disabled={mine}
                                        className="w-8 h-8 rounded-full overflow-hidden bg-cyan-900/50 shrink-0 flex items-center justify-center disabled:cursor-default enabled:hover:scale-105 enabled:hover:ring-2 enabled:hover:ring-cyan-400/60 transition-all"
                                    >
                                        {m.avatar_url ? (
                                            <img loading="lazy" decoding="async" src={m.avatar_url} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" />
                                        ) : (
                                            <span className="text-white/50 font-black text-xs pointer-events-none">{(m.username?.[0] || 'U').toUpperCase()}</span>
                                        )}
                                    </button>
                                    <div className={`flex flex-col min-w-0 max-w-[80%] ${mine ? 'items-end' : 'items-start'}`}>
                                        <span className="text-[10px] font-bold text-white/35 mb-0.5" style={{ color: '#555555' }}>
                                            {mine ? 'You' : m.username || 'User'} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        {joinable ? (
                                            <button
                                                onClick={() => m.room_code && joinRoom(m.room_code)}
                                                title={m.room_code ? `Join room ${m.room_code}` : undefined}
                                                className="room-join-row py-2.5 px-4 rounded-2xl rounded-tl-md border border-cyan-500/40 bg-cyan-500/10 text-left text-[13px] leading-relaxed break-words [overflow-wrap:anywhere] text-white/90 hover:bg-cyan-500/20 hover:border-cyan-400/60 active:scale-[0.99] transition-all cursor-pointer w-full"
                                            >
                                                <span className="text-white/90">{m.content || '…'}</span>
                                                <span className="block mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">
                                                    Tap to join →
                                                </span>
                                            </button>
                                        ) : (
                                            <div className={`py-2.5 px-4 rounded-2xl text-[13px] leading-relaxed break-words [overflow-wrap:anywhere] ${mine ? 'chat-own bg-cyan-700 text-white rounded-tr-md shadow-lg' : 'bg-white/10 text-white/90 rounded-tl-md border border-white/5'} ${mIsRoom && !mRoomOpen ? 'opacity-60' : ''}`} style={mine ? { backgroundColor: '#171717', color: '#ffffff' } : undefined}>
                                                {m.content || '…'}
                                                {mIsRoom && !mRoomOpen && (
                                                    <span className="ml-2 px-1.5 py-0.5 rounded-md bg-white/10 text-[8px] font-black uppercase tracking-[0.15em] text-white/50 align-middle">
                                                        Over
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Input (always live — sending is orthogonal to filters) */}
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
    );
};
// Joinable count: searching tickets + open announced rooms (debounced).
function useJoinableCount() {
    const [count, setCount] = useState(0);
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const recompute = async () => {
            let tickets = 0;
            let rooms = 0;
            try {
                const q = await supabase.from('matchmaking_queue')
                    .select('player_id', { count: 'exact', head: true })
                    .eq('status', 'searching');
                tickets = q.count || 0;
            } catch { /* keep last */ }
            try {
                const r = await supabase.from('live_chat')
                    .select('room_code')
                    .not('room_code', 'is', null)
                    .eq('room_open', true)
                    .order('created_at', { ascending: false })
                    .limit(100);
                rooms = new Set((r.data || []).map(x => x.room_code)).size;
            } catch { /* pre-migration — tickets only */ }
            if (!cancelled) setCount(tickets + rooms);
        };
        const debounced = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(recompute, 2500);
        };
        recompute();
        const ch = supabase.channel('live-count')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'matchmaking_queue' }, debounced)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_chat' }, debounced)
            .subscribe();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            supabase.removeChannel(ch);
        };
    }, []);
    return count;
}
export const LiveBroadcastCard = ({ onOpenProfile }: { onOpenProfile?: (address: string) => void }) => {
    const [isOpen, setIsOpen] = useState(false);
    const joinable = useJoinableCount();
    // Latest open room: the ON AIR slot shows the freshest announce
    // (Classic · 2v2 · Free · 3/4 · join), tap-to-join, ticking live.
    // Session-bounded like the rooms tab — pre-session history stays out.
    const [latestRoom, setLatestRoom] = useState<{ roomCode: string; content: string } | null>(null);
    const latestRef = useRef<{ roomCode: string; content: string } | null>(null);
    const setRoom = (r: { roomCode: string; content: string } | null) => {
        latestRef.current = r;
        setLatestRoom(r);
    };
    const roomSessionStart = useRef(Date.now());
    useEffect(() => {
        const pick = (row: any) => {
            if (!row?.room_code || row.room_open === false) return null;
            if (!row.created_at || new Date(row.created_at).getTime() < roomSessionStart.current) return null;
            return { roomCode: row.room_code as string, content: (row.content as string) || '' };
        };
        const fetchLatest = async () => {
            try {
                const { data, error } = await supabase
                    .from('live_chat')
                    .select('room_code, content, room_open, created_at')
                    .not('room_code', 'is', null)
                    .eq('room_open', true)
                    .order('created_at', { ascending: false })
                    .limit(5);
                if (error) throw error;
                for (const row of data || []) {
                    const r = pick(row);
                    if (r) { setRoom(r); return; }
                }
                setRoom(null);
            } catch { /* pre-migration — ON AIR fallback stands */ }
        };
        fetchLatest();
        const ch = supabase
            .channel('live-latest-room')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = pick(payload.new);
                if (r) setRoom(r);
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat' }, (payload) => {
                const row: any = payload.new;
                if (!row?.room_code) return;
                if (row.room_open === false) {
                    // Headliner closed → fall back to next freshest.
                    if (latestRef.current?.roomCode === row.room_code) {
                        setRoom(null);
                        fetchLatest();
                    }
                    return;
                }
                const r = pick(row);
                if (r) setRoom(r);
            })
            .subscribe();
        return () => {
            supabase.removeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            <div className="ludo-ticker-scope w-full flex justify-center pointer-events-none">
                <div
                    className="broadcast-tier pointer-events-auto h-[64px] w-full max-w-[480px] rounded-2xl flex items-center justify-between px-5 relative overflow-hidden transition-all group cursor-pointer border border-cyan-500/20 bg-black/60 backdrop-blur-3xl hover:border-cyan-400/50 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)] active:scale-[0.98]"
                    onClick={() => setIsOpen(true)}
                    role="button"
                    aria-label="Open live broadcast"
                >
                    {/* Cyber grid bg */}
                    <div className="ticker-deco absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.8)_50%)] bg-[length:100%_4px] opacity-20 pointer-events-none" />
                    <div className="ticker-deco absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

                    <div className="flex items-center gap-3 relative z-10">
                        <div className="w-10 h-10 rounded-xl border border-cyan-500/30 bg-cyan-950/50 flex items-center justify-center overflow-hidden shadow-[inset_0_0_15px_rgba(34,211,238,0.2)] relative">
                            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(34,211,238,0.2)_50%,transparent_100%)] w-[200%] animate-[scan_2s_linear_infinite]" />
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300 relative z-10">
                                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-[9px] font-black text-cyan-500/70 uppercase tracking-[0.3em] drop-shadow-[0_0_5px_rgba(34,211,238,0.3)]">Live Broadcast</span>
                            {latestRoom ? (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        window.dispatchEvent(new CustomEvent('join_party', {
                                            detail: { roomCode: latestRoom.roomCode }
                                        }));
                                    }}
                                    title={`Join ${latestRoom.roomCode}`}
                                    className="flex items-center gap-2 mt-0.5 rounded-md hover:opacity-80 active:scale-95 transition-all text-left min-w-0"
                                >
                                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse shrink-0" />
                                    <span className="text-[11px] font-black text-cyan-300 uppercase tracking-wider leading-none truncate underline underline-offset-2 decoration-cyan-500/50">
                                        {latestRoom.content}
                                    </span>
                                </button>
                            ) : (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setBtab('matches'); setIsOpen(true); }}
                                    title="Open live matches"
                                    className="flex items-center gap-2 mt-0.5 rounded-md hover:opacity-80 active:scale-95 transition-all text-left"
                                >
                                    <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse" />
                                    <span className="text-[11px] font-black text-cyan-300 uppercase tracking-widest leading-none underline underline-offset-2 decoration-cyan-500/50">
                                        On air
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 relative z-10 ml-auto">
                        <div className="h-6 w-[1px] bg-cyan-500/20" />
                        <div className="flex flex-col items-end justify-center h-full" title="Rooms and searches you can join right now">
                            <span className="text-[14px] font-black text-cyan-300 tabular-nums leading-tight drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]">
                                {joinable}
                            </span>
                            <span className="text-[8px] font-black text-cyan-500/50 uppercase tracking-[0.2em] leading-tight">Joinable</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Full panel ── */}
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
                                                Live Broadcast
                                            </h2>
                                            <button
                                                onClick={() => setIsOpen(false)}
                                                aria-label="Close live broadcast"
                                                className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Content: one timeline (filters replace tabs) */}
                                    <div className="flex-1 min-h-0 overflow-hidden relative z-10 flex flex-col">
                                        <UnifiedBroadcastFeed onOpenProfile={onOpenProfile} onJoin={() => setIsOpen(false)} />
                                    </div>
                                </motion.div>
                            </div>
                        </div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
};
