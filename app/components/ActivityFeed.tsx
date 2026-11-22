"use client";

// Home of the live panels (rendered inside the Live Arena card):
// - LiveChatPanel: session-only global/local shoutbox
// - LiveMatchSearchesPanel: joinable matchmaking pool + recent arena activity

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { describeSendFailure } from '@/lib/sendErrors';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { GamePanelShell } from './GamePanelShell';
import { PanelChildTabs } from './PanelTabs';
import { TacticalChatComposer, TacticalMessageBubble } from './TacticalChat';
import { encodeChatDraft, type ChatDraftEmote } from '@/lib/emotes';
import { usePreferences } from '@/hooks/usePreferences';
import { prefersReducedMotion } from '@/lib/motion';
import { HudSectionLabel } from './HudPrimitives';
import { CloseReticleIcon, WarningHexIcon } from './icons';

interface ActivityMetadata {
    tournament_title?: string;
    amount?: number | string;
    room_code?: string;
    level?: number | string;
    trophy_name?: string;
}

interface Activity {
    id: string;
    actor_id: string;
    type: 'win' | 'join_tournament' | 'level_up' | 'big_bet' | 'trophy';
    metadata: ActivityMetadata;
    created_at: string;
    actor?: {
        username: string;
        avatar_url: string;
    };
}

interface RoomRow {
    room_code?: string | null;
    content?: string | null;
    username?: string | null;
    avatar_url?: string | null;
    created_at?: string | null;
    room_open?: boolean | null;
    country?: string | null;
    sender_id?: string | null;
}

interface QueueRow {
    player_id?: string | null;
    status?: string | null;
    game_mode?: string | null;
    match_type?: string | null;
    wager?: number | string | null;
    created_at?: string | null;
    room_code?: string | null;
}

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
    roomCode: string | null;
}

const SEATS_NEEDED: Record<string, number> = { '1v1': 1, '2v2': 3, '4P': 3 };

interface LiveRoom {
    key: string;
    roomCode: string;
    content: string;
    hostName: string;
    avatar: string | null;
    createdAt: number;
    open: boolean;
    country?: string;
    senderId?: string;
}

type CScope = 'global' | 'local';

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

const SectionLabel = HudSectionLabel;

export const LiveChatPanel = ({ onOpenProfile, onJoin }: { onOpenProfile?: (address: string) => void; onJoin?: () => void }) => {
    const { address } = useAccount();
    const { address: identityAddress } = useCurrentUser();
    const { guard } = useGuestWall();
    const { peekAppSession, ensureAppSession } = useAppSession();
    const me = (address || '').toLowerCase();

    const [cscope, setCscope] = useState<CScope>('global');

    const [msgs, setMsgs] = useState<{ global: ChatMsg[]; local: ChatMsg[] }>({ global: [], local: [] });
    const visibleMsgs = msgs[cscope];
    const [input, setInput] = useState('');
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [inputEmotes, setInputEmotes] = useState<ChatDraftEmote[]>([]);
    const [cooldown, setCooldown] = useState(0);
    const [sendError, setSendError] = useState<string | null>(null);
    const [country, setCountry] = useState('XX');
    const chatScrollRef = useRef<HTMLDivElement>(null);

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
            void supabase.removeChannel(channel);
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
        const text = encodeChatDraft(input.trim(), inputEmotes).slice(0, 140);
        if (!text || cooldown > 0) return;
        if (!guard('dm')) return;
        const wallet = (identityAddress || '').toLowerCase();
        if (!wallet) return;
        setInput('');
        setInputEmotes([]);
        setCooldown(10);
        try {
            const sid = peekAppSession() ?? (await ensureAppSession());
            const res = await fetch('/api/live-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(sid ? { Authorization: `Bearer ${sid}`, 'x-session-id': sid } : {}),
                },
                body: JSON.stringify({ wallet, content: text, sessionId: sid ?? undefined }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                if (res.status === 429 && err.waitLeft) setCooldown(err.waitLeft);
                const { message } = await describeSendFailure(res);
                setSendError(message);
            } else {
                setSendError(null);
            }
        } catch {
            setSendError("Can't reach the game server. Check your connection and try again.");
        }
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="px-5 pt-2">
                <PanelChildTabs
                    ariaLabel="Chat scope"
                    value={cscope}
                    onPick={setCscope}
                    options={[
                        { value: 'global', label: 'global' },
                        {
                            value: 'local', label: 'local',
                            pill: (
                                <span className={`px-1.5 py-0.5 rounded-md text-ludo-xs font-mono ${cscope === 'local' ? 'bg-accent-soft text-accent' : 'bg-surface-recessed text-ink-faint'}`}>
                                    {country}
                                </span>
                            ),
                        },
                    ]}
                />
            </div>

            <div className="flex-1 min-h-0 mx-5 mb-3 mt-2 flex flex-col justify-between rounded-2xl bg-surface-recessed border border-line-soft p-3.5">
                <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar pr-1">
                    {visibleMsgs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                            <h3 className="text-ink-strong font-extrabold text-sm mb-1">Dead air</h3>
                            <p className="text-ink-muted text-xs max-w-[220px]">
                                {cscope === 'local' ? `No shouts from ${country} yet — be the first.` : 'No shouts yet — be the first.'}
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2.5 pb-1">
                            {visibleMsgs.map((m) => {
                                const mine = m.sender_id.toLowerCase() === me;
                                const isRoom = !!m.room_code;
                                const roomOpen = m.room_open !== false;
                                const joinable = isRoom && roomOpen && !mine;
                                const joinRoom = () => {
                                    if (!m.room_code) return;
                                    window.dispatchEvent(new CustomEvent('join_party', {
                                        detail: { roomCode: m.room_code },
                                    }));
                                    onJoin?.();
                                };
                                return (
                                    <TacticalMessageBubble
                                        key={m.id}
                                        isMine={mine}
                                        sender={mine ? 'You' : m.username || 'User'}
                                        meta={new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        content={m.content || '…'}
                                        dimmed={isRoom && !roomOpen}
                                        avatar={
                                            <button
                                                type="button"
                                                onClick={() => !mine && onOpenProfile?.(m.sender_id)}
                                                aria-label={mine ? 'Your avatar' : `Open ${m.username || 'user'} profile`}
                                                disabled={mine}
                                                className="w-8 h-8 rounded-full overflow-hidden bg-accent-soft border border-line-soft shrink-0 flex items-center justify-center disabled:cursor-default enabled:hover:scale-105 enabled:hover:ring-2 enabled:hover:ring-accent/60 transition-all"
                                            >
                                                {m.avatar_url ? (
                                                    <img loading="lazy" decoding="async" src={m.avatar_url} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" width={96} height={96} />
                                                ) : (
                                                    <span className="text-ink-muted font-extrabold text-xs pointer-events-none">{(m.username?.[0] || 'U').toUpperCase()}</span>
                                                )}
                                            </button>
                                        }
                                        joinAction={joinable ? {
                                            title: `Join room ${m.room_code}`,
                                            onClick: joinRoom,
                                        } : undefined}
                                        belowBubble={isRoom && !roomOpen ? (
                                            <span className="ml-2 px-1.5 py-0.5 rounded-md bg-surface-recessed text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-ink-muted align-middle">
                                                Over
                                            </span>
                                        ) : undefined}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                {sendError && (
                    <div
                        role="alert"
                        className="mt-2 flex items-start gap-2 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-ludo-sm leading-snug text-negative"
                    >
                        <WarningHexIcon className="icon-sm shrink-0 mt-0.5" />
                        <span className="flex-1">{sendError}</span>
                        <button
                            type="button"
                            onClick={() => setSendError(null)}
                            aria-label="Dismiss"
                            className="shrink-0 text-negative hover:opacity-80"
                        >
                            <CloseReticleIcon className="icon-sm" />
                        </button>
                    </div>
                )}

                <TacticalChatComposer
                    className="mt-3"
                    value={input}
                    emotes={inputEmotes}
                    emojiOpen={emojiOpen}
                    onValueChange={setInput}
                    onEmotesChange={setInputEmotes}
                    onEmojiToggle={() => setEmojiOpen((value) => !value)}
                    onEmojiClose={() => setEmojiOpen(false)}
                    onSend={sendChat}
                    placeholder="Transmit broadcast message..."
                    ariaLabel="Message"
                    maxLength={140}
                    maxEncodedLength={140}
                    cooldown={cooldown}
                    showCounter
                />
            </div>
        </div>
    );
};

export const LiveMatchSearchesPanel = ({ onJoin }: { onJoin?: () => void }) => {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [searches, setSearches] = useState<LiveSearch[]>([]);
    const [rooms, setRooms] = useState<LiveRoom[]>([]);
    const sessionStart = useRef(Date.now());
    useEffect(() => {
        const toRoom = (row: RoomRow | null | undefined): LiveRoom | null => {
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
                    .gt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
                    .order('created_at', { ascending: false })
                    .limit(20);
                if (error) throw error;
                const seen = new Map<string, LiveRoom>();
                for (const row of (data || []) as RoomRow[]) {
                    const r = toRoom(row);
                    if (r && !seen.has(r.roomCode) && r.createdAt >= sessionStart.current) seen.set(r.roomCode, r);
                }
                setRooms([...seen.values()]);
            } catch {
                /* pre-migration DB or offline */
            }
        })();
        const channel = supabase
            .channel('live-broadcast-rooms')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = toRoom(payload.new as RoomRow);
                if (!r) return;
                setRooms(prev => [r, ...prev.filter(x => x.roomCode !== r.roomCode)].slice(0, 20));
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = toRoom(payload.new as RoomRow);
                if (!r) return;
                setRooms(prev => r.open
                    ? [r, ...prev.filter(x => x.roomCode !== r.roomCode)].slice(0, 20)
                    : prev.filter(x => x.roomCode !== r.roomCode));
            })
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
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

    useEffect(() => {
        const channel = supabase
            .channel('live-broadcast-searches')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matchmaking_queue' }, async (payload) => {
                const row = payload.new as QueueRow | null;
                if (!row || row.status !== 'searching' || !row.player_id) return;
                if (row.player_id.toLowerCase() === me) return;
                if (row.player_id.toLowerCase().startsWith('guest_')) return;
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
                const row = payload.new as QueueRow | null;
                if (!row || row.status === 'searching') return;
                setSearches(prev => prev.map(s =>
                    s.playerId.toLowerCase() === (row.player_id || '').toLowerCase() && !s.started
                        ? { ...s, started: true }
                        : s,
                ));
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matchmaking_queue' }, (payload) => {
                const row = payload.old as QueueRow | null;
                if (!row?.player_id) return;
                setSearches(prev => prev.filter(s => s.playerId.toLowerCase() !== (row.player_id || '').toLowerCase()));
            })
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [me, resolveHost]);

    useEffect(() => {
        const fetchInitial = async () => {
            const response = await fetch('/api/activities');
            if (response.ok) setActivities(await response.json());
        };

        void fetchInitial();

        const refresh = window.setInterval(fetchInitial, 15000);
        return () => window.clearInterval(refresh);
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
        if (s.roomCode) {
            window.dispatchEvent(new CustomEvent('join_party', {
                detail: { roomCode: s.roomCode },
            }));
            onJoin?.();
            return;
        }
        window.dispatchEvent(new CustomEvent('join_pool', {
            detail: { entryFee: s.wager, mode: s.gameMode, matchType: s.matchType },
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
            o.playerId.toLowerCase() !== s.playerId.toLowerCase(),
        ).length;
        return `${Math.min(others, need)}/${need}`;
    };

    const totalWaiting = searches.filter(s => !s.started).length;
    const recentActivity = activities.slice(0, 3);

    return (
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2 space-y-3">
            {rooms.length > 0 && (
                <>
                    <SectionLabel>Open rooms · {rooms.length}</SectionLabel>
                    <div className="flex flex-col gap-2 pb-1">
                        {rooms.map((r) => (
                            <button
                                key={r.key}
                                onClick={() => {
                                    window.dispatchEvent(new CustomEvent('join_party', {
                                        detail: { roomCode: r.roomCode },
                                    }));
                                    onJoin?.();
                                }}
                                title={`Join ${r.hostName}'s room`}
                                className="room-join-row flex items-center gap-3 p-3 rounded-2xl border border-accent/40 bg-accent-soft/50 backdrop-blur-md transition-all text-left w-full hover:bg-accent-soft hover:border-accent/65 active:scale-[0.99] cursor-pointer"
                            >
                                <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-recessed border border-line-soft shrink-0 flex items-center justify-center">
                                    {r.avatar ? (
                                        <img loading="lazy" decoding="async" src={r.avatar} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" width={96} height={96} />
                                    ) : (
                                        <span className="text-ink-muted font-extrabold text-sm pointer-events-none">{r.hostName[0]?.toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col">
                                    <span className="text-ludo-md font-extrabold text-ink-strong truncate">{r.hostName}</span>
                                    <span className="text-ludo-xs font-bold text-ink-muted tabular-nums mt-0.5 truncate">
                                        {r.content}
                                    </span>
                                </div>
                                <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-accent text-accent-ink text-ludo-xs font-extrabold uppercase tracking-[0.15em] pointer-events-none">
                                    Join
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
            <SectionLabel>Live now{totalWaiting > 0 ? ` · ${totalWaiting} waiting` : ''}</SectionLabel>
            {searches.length > 0 ? (
                <div className="flex flex-col gap-2 pb-1">
                    {[...searches].reverse().map((s) => (
                        <div
                            key={s.key}
                            className={`flex items-center gap-3 p-3 rounded-2xl border backdrop-blur-md transition-colors ${s.started ? 'bg-surface-recessed border-line-soft opacity-70' : 'bg-surface-panel border-line-soft hover:border-accent/40'}`}
                        >
                            <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-recessed border border-line-soft shrink-0 flex items-center justify-center">
                                {s.avatar ? (
                                    <img loading="lazy" decoding="async" src={s.avatar} alt={s.hostName} className="w-full h-full object-cover" width={96} height={96} />
                                ) : (
                                    <span className="text-ink-muted font-extrabold text-sm">{s.hostName[0]?.toUpperCase()}</span>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col">
                                <span className="text-ludo-md font-extrabold text-ink-strong truncate">
                                    {s.hostName}
                                    {s.roomCode && (
                                        <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-warn/15 border border-warn/40 text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-warn align-middle">
                                            Party
                                        </span>
                                    )}
                                </span>
                                <span className="text-ludo-xs font-bold text-ink-muted tabular-nums mt-0.5 truncate">
                                    {s.matchType} · {s.gameMode} · {seatsFor(s)} · {s.wager === 0 ? 'Free' : `${s.wager.toLocaleString()}`}
                                </span>
                            </div>
                            {s.started ? (
                                <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-ink-faint">
                                    Started
                                </span>
                            ) : (
                                <button
                                    onClick={() => joinSearch(s)}
                                    className="shrink-0 px-4 py-2 rounded-xl bg-accent-soft border border-accent/40 text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-accent hover:bg-accent hover:text-accent-ink active:scale-95 transition-all"
                                >
                                    {s.roomCode ? 'Join Party' : 'Join'}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center text-center py-12 px-6">
                    <div className="w-16 h-16 rounded-3xl bg-surface-panel border border-line-soft flex items-center justify-center mb-4 text-ink-faint">
                        <ModeGlyph mode="classic" />
                    </div>
                    <h3 className="text-ink-strong font-extrabold text-sm mb-1">Quiet airwaves</h3>
                    <p className="text-ink-muted text-xs max-w-[220px]">Searches that start while you&apos;re here appear instantly.</p>
                </div>
            )}

            <SectionLabel>Recent arena</SectionLabel>
            {recentActivity.length > 0 ? (
                <div className="flex flex-col gap-2 pb-2">
                    {recentActivity.map((activity) => (
                        <div
                            key={activity.id}
                            className="flex items-center gap-3 p-3 bg-surface-panel border border-line-soft rounded-2xl backdrop-blur-md"
                        >
                            <div className="w-8 h-8 rounded-full border border-line-soft overflow-hidden bg-surface-recessed shrink-0">
                                <img
                                    src={activity.actor?.avatar_url || `https://avatar.vercel.sh/${activity.actor_id}`}
                                    alt="avatar"
                                    className="w-full h-full object-cover"
                                    width={96}
                                    height={96}
                                />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-ludo-md text-ink-strong truncate font-semibold">
                                    <span className="text-accent font-extrabold">
                                        {activity.actor?.username || activity.actor_id.slice(0, 6)}
                                    </span>
                                    {' '}{getActivityText(activity)}
                                </span>
                                <span className="text-ludo-xs text-ink-faint font-bold uppercase tracking-widest mt-0.5">
                                    {new Date(activity.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="py-5 text-center border-2 border-dashed border-line-soft rounded-3xl">
                    <span className="text-ludo-xs font-extrabold text-ink-faint uppercase tracking-[0.3em]">No broadcasts detected</span>
                </div>
            )}
        </div>
    );
};

export interface BroadcastData {
    chats: ChatMsg[];
    rooms: LiveRoom[];
    searches: LiveSearch[];
    activities: Activity[];
    country: string;
}

export function useBroadcastData(): BroadcastData {
    const { address } = useAccount();
    const me = (address || '').toLowerCase();
    const [country, setCountry] = useState('XX');
    const [chats, setChats] = useState<ChatMsg[]>([]);
    const [rooms, setRooms] = useState<LiveRoom[]>([]);
    const [searches, setSearches] = useState<LiveSearch[]>([]);
    const [activities, setActivities] = useState<Activity[]>([]);
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

    const toRoom = useCallback((row: RoomRow | null | undefined): LiveRoom | null => {
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
            senderId: (row.sender_id || '').toLowerCase() || undefined,
        };
    }, []);

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

    useEffect(() => {
        const channel = supabase
            .channel('unified-chat')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const m = payload.new as ChatMsg;
                setChats(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m].slice(-40)));
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
            void supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('live_chat')
                    .select('room_code, content, username, avatar_url, sender_id, room_open, country, created_at')
                    .not('room_code', 'is', null)
                    .eq('room_open', true)
                    .gt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
                    .order('created_at', { ascending: false })
                    .limit(20);
                if (error) throw error;
                const seen = new Map<string, LiveRoom>();
                const since = sessionStart.current;
                for (const row of (data || []) as RoomRow[]) {
                    const r = toRoom(row);
                    if (r && !seen.has(r.roomCode) && r.createdAt >= since) seen.set(r.roomCode, r);
                }
                setRooms([...seen.values()]);
            } catch {
                /* offline — searches still work */
            }
        })();
        const channel = supabase
            .channel('unified-rooms')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = toRoom(payload.new as RoomRow);
                if (!r) return;
                setRooms(prev => [r, ...prev.filter(x => x.roomCode !== r.roomCode)].slice(0, 20));
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = toRoom(payload.new as RoomRow);
                if (!r) return;
                setRooms(prev => [r, ...prev.filter(x => x.roomCode !== r.roomCode)].slice(0, 20));
            })
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [toRoom]);

    useEffect(() => {
        const channel = supabase
            .channel('unified-searches')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matchmaking_queue' }, async (payload) => {
                const row = payload.new as QueueRow | null;
                if (!row || row.status !== 'searching' || !row.player_id) return;
                if (row.player_id.toLowerCase() === me) return;
                if (row.player_id.toLowerCase().startsWith('guest_')) return;
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
                const row = payload.new as QueueRow | null;
                if (!row || row.status === 'searching') return;
                setSearches(prev => prev.map(s =>
                    s.playerId.toLowerCase() === (row.player_id || '').toLowerCase() && !s.started
                        ? { ...s, started: true }
                        : s,
                ));
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matchmaking_queue' }, (payload) => {
                const row = payload.old as QueueRow | null;
                if (!row?.player_id) return;
                setSearches(prev => prev.filter(s => s.playerId.toLowerCase() !== (row.player_id || '').toLowerCase()));
            })
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [me, resolveHost]);

    useEffect(() => {
        (async () => {
            try {
                const response = await fetch('/api/activities');
                if (response.ok) setActivities(await response.json());
            } catch {
                /* activities unavailable */
            }
        })();
        const refresh = window.setInterval(async () => {
            const response = await fetch('/api/activities');
            if (response.ok) setActivities(await response.json());
        }, 15000);
        return () => window.clearInterval(refresh);
    }, []);

    return { chats, rooms, searches, activities, country };
}

interface FeedItem {
    key: string;
    ts: number;
    kind: 'chat' | 'room' | 'search' | 'activity';
    msg?: ChatMsg;
    room?: LiveRoom;
    search?: LiveSearch;
    activity?: Activity;
}

export const UnifiedBroadcastFeed = ({ onOpenProfile, onJoin, data }: { onOpenProfile?: (address: string) => void; onJoin?: () => void; data: BroadcastData }) => {
    const { address } = useAccount();
    const { address: identityAddress } = useCurrentUser();
    const { guard } = useGuestWall();
    const { peekAppSession, ensureAppSession } = useAppSession();
    const me = (address || '').toLowerCase();
    const { chats, rooms, searches, activities, country } = data;

    const [matchesOnly, setMatchesOnly] = useState(false);
    const [localOnly, setLocalOnly] = useState(false);
    const [input, setInput] = useState('');
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [inputEmotes, setInputEmotes] = useState<ChatDraftEmote[]>([]);
    const [cooldown, setCooldown] = useState(0);
    const [sendError, setSendError] = useState<string | null>(null);
    const feedScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onOpenMatches = () => setMatchesOnly(true);
        window.addEventListener('open_live_matches', onOpenMatches);
        return () => window.removeEventListener('open_live_matches', onOpenMatches);
    }, []);

    useEffect(() => {
        if (cooldown > 0) {
            const t = setTimeout(() => setCooldown(c => c - 1), 1000);
            return () => clearTimeout(t);
        }
    }, [cooldown]);

    const sendChat = async () => {
        const text = encodeChatDraft(input.trim(), inputEmotes).slice(0, 140);
        if (!text || cooldown > 0) return;
        if (!guard('dm')) return;
        const wallet = (identityAddress || '').toLowerCase();
        if (!wallet) return;
        setInput('');
        setInputEmotes([]);
        setCooldown(10);
        try {
            const sid = peekAppSession() ?? (await ensureAppSession());
            const res = await fetch('/api/live-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(sid ? { Authorization: `Bearer ${sid}`, 'x-session-id': sid } : {}),
                },
                body: JSON.stringify({ wallet, content: text, sessionId: sid ?? undefined }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                if (res.status === 429 && err.waitLeft) setCooldown(err.waitLeft);
                const { message } = await describeSendFailure(res);
                setSendError(message);
            } else {
                setSendError(null);
            }
        } catch {
            setSendError("Can't reach the game server. Check your connection and try again.");
        }
    };

    const joinRoom = (roomCode: string) => {
        window.dispatchEvent(new CustomEvent('join_party', {
            detail: { roomCode },
        }));
        onJoin?.();
    };

    const joinSearch = (s: LiveSearch) => {
        if (s.roomCode) {
            joinRoom(s.roomCode);
            return;
        }
        window.dispatchEvent(new CustomEvent('join_pool', {
            detail: { entryFee: s.wager, mode: s.gameMode, matchType: s.matchType },
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
            if ((m as ChatMsg).room_code) continue;
            const mineMsg = (m.sender_id || '').toLowerCase() === meLower;
            if (matchesOnly) continue;
            if (localOnly && !mineMsg && (m.country || 'XX') !== country) continue;
            out.push({ key: `c-${m.id}`, ts: m.created_at ? new Date(m.created_at).getTime() : 0, kind: 'chat', msg: m });
        }
        for (const r of rooms) {
            if (r.senderId && r.senderId === meLower) continue;
            if (localOnly && (r.country || 'XX') !== country) continue;
            out.push({ key: `r-${r.key}`, ts: r.createdAt, kind: 'room', room: r });
        }
        for (const s of searches) {
            out.push({ key: `s-${s.key}`, ts: s.createdAt, kind: 'search', search: s });
        }
        if (matchesOnly) {
            for (const a of activities) {
                out.push({ key: `a-${a.id}`, ts: a.created_at ? new Date(a.created_at).getTime() : 0, kind: 'activity', activity: a });
            }
        }
        out.sort((x, y) => x.ts - y.ts);
        return out;
    }, [chats, rooms, searches, activities, matchesOnly, localOnly, country, me]);

    useEffect(() => {
        const el = feedScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [items.length]);

    const emptyHint = matchesOnly
        ? (localOnly ? 'No live matches nearby right now.' : 'Quiet airwaves — rooms and searches land here live.')
        : (localOnly ? `No shouts from ${country} yet — be the first.` : 'No shouts yet — be the first.');

    return (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Filters */}
            <div className="px-5 pt-3 flex items-center justify-end gap-1.5">
                <button
                    onClick={() => setLocalOnly(v => !v)}
                    aria-pressed={localOnly}
                    title={localOnly ? 'Show global feed' : 'Show only nearby'}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-ludo-xs font-extrabold uppercase tracking-widest transition-all border ${localOnly ? 'bg-positive/20 text-positive border-positive/40' : 'bg-surface-panel text-ink-muted border-line-soft hover:text-ink-strong'}`}
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${localOnly ? 'bg-positive animate-pulse' : 'bg-line-strong'}`} />
                    Local{country !== 'XX' ? ` · ${country}` : ''}
                </button>
                <button
                    onClick={() => setMatchesOnly(v => !v)}
                    aria-pressed={matchesOnly}
                    title={matchesOnly ? 'Show everything' : 'Show only matches'}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-ludo-xs font-extrabold uppercase tracking-widest transition-all border ${matchesOnly ? 'bg-accent-soft text-accent border-accent/45' : 'bg-surface-panel text-ink-muted border-line-soft hover:text-ink-strong'}`}
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${matchesOnly ? 'bg-accent animate-pulse' : 'bg-line-strong'}`} />
                    Matches
                </button>
            </div>

            {/* Chronological timeline */}
            <div ref={feedScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                        <div className="w-16 h-16 rounded-3xl bg-surface-panel border border-line-soft flex items-center justify-center mb-4 text-ink-faint">
                            <ModeGlyph mode="classic" />
                        </div>
                        <h3 className="text-ink-strong font-extrabold text-sm mb-1">Quiet airwaves</h3>
                        <p className="text-ink-muted text-xs max-w-[220px]">{emptyHint}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 pb-2">
                        {items.map((it) => {
                            if (it.kind === 'room' && it.room) {
                                const r = it.room;
                                if (!r.open) {
                                    return (
                                        <div
                                            key={it.key}
                                            className="flex items-center gap-3 p-3 rounded-2xl border border-line-soft bg-surface-recessed backdrop-blur-md opacity-60"
                                        >
                                            <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-panel border border-line-soft shrink-0 flex items-center justify-center">
                                                {r.avatar ? (
                                                    <img loading="lazy" decoding="async" src={r.avatar} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" width={96} height={96} />
                                                ) : (
                                                    <span className="text-ink-muted font-extrabold text-sm pointer-events-none">{r.hostName[0]?.toUpperCase()}</span>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col">
                                                <span className="text-ludo-md font-extrabold text-ink-strong truncate">{r.hostName}</span>
                                                <span className="text-ludo-xs font-bold text-ink-muted tabular-nums mt-0.5 truncate">
                                                    {r.content}
                                                </span>
                                            </div>
                                            <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-surface-panel border border-line-soft text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-ink-faint pointer-events-none">
                                                Over
                                            </span>
                                        </div>
                                    );
                                }
                                return (
                                    <button
                                        key={it.key}
                                        onClick={() => joinRoom(r.roomCode)}
                                        title={`Join ${r.hostName}'s room`}
                                        className="room-join-row flex items-center gap-3 p-3 rounded-2xl border border-accent/40 bg-accent-soft/50 backdrop-blur-md transition-all text-left w-full hover:bg-accent-soft hover:border-accent/65 active:scale-[0.99] cursor-pointer"
                                    >
                                        <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-recessed border border-line-soft shrink-0 flex items-center justify-center">
                                            {r.avatar ? (
                                                <img loading="lazy" decoding="async" src={r.avatar} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" width={96} height={96} />
                                            ) : (
                                                <span className="text-ink-muted font-extrabold text-sm pointer-events-none">{r.hostName[0]?.toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 flex flex-col">
                                            <span className="text-ludo-md font-extrabold text-ink-strong truncate">{r.hostName}</span>
                                            <span className="text-ludo-xs font-bold text-ink-muted tabular-nums mt-0.5 truncate">
                                                {r.content}
                                            </span>
                                        </div>
                                        <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-accent text-accent-ink text-ludo-xs font-extrabold uppercase tracking-[0.15em] pointer-events-none">
                                            Join
                                        </span>
                                    </button>
                                );
                            }
                            if (it.kind === 'search' && it.search) {
                                const s = it.search;
                                if (s.roomCode && !s.started) {
                                    return (
                                        <button
                                            key={it.key}
                                            onClick={() => joinSearch(s)}
                                            title={`Join ${s.hostName}'s party`}
                                            className="room-join-row flex items-center gap-3 p-3 rounded-2xl border border-accent/40 bg-accent-soft/50 backdrop-blur-md transition-all text-left w-full hover:bg-accent-soft hover:border-accent/65 active:scale-[0.99] cursor-pointer"
                                        >
                                            <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-recessed border border-line-soft shrink-0 flex items-center justify-center">
                                                {s.avatar ? (
                                                    <img loading="lazy" decoding="async" src={s.avatar} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" width={96} height={96} />
                                                ) : (
                                                    <span className="text-ink-muted font-extrabold text-sm pointer-events-none">{s.hostName[0]?.toUpperCase()}</span>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col">
                                                <span className="text-ludo-md font-extrabold text-ink-strong truncate">
                                                    {s.hostName}
                                                    <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-warn/15 border border-warn/40 text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-warn align-middle">
                                                        Party
                                                    </span>
                                                </span>
                                                <span className="text-ludo-xs font-bold text-ink-muted tabular-nums mt-0.5 truncate">
                                                    {s.matchType} · {s.gameMode} · {s.wager === 0 ? 'Free' : `${s.wager.toLocaleString()}`} · join
                                                </span>
                                            </div>
                                            <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-accent text-accent-ink text-ludo-xs font-extrabold uppercase tracking-[0.15em] pointer-events-none">
                                                Join
                                            </span>
                                        </button>
                                    );
                                }
                                return (
                                    <div
                                        key={it.key}
                                        className={`flex items-center gap-3 p-3 rounded-2xl border backdrop-blur-md transition-colors ${s.started ? 'bg-surface-recessed border-line-soft opacity-70' : 'bg-surface-panel border-line-soft hover:border-accent/40'}`}
                                    >
                                        <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-recessed border border-line-soft shrink-0 flex items-center justify-center">
                                            {s.avatar ? (
                                                <img loading="lazy" decoding="async" src={s.avatar} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" width={96} height={96} />
                                            ) : (
                                                <span className="text-ink-muted font-extrabold text-sm pointer-events-none">{s.hostName[0]?.toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 flex flex-col">
                                            <span className="text-ludo-md font-extrabold text-ink-strong truncate">{s.hostName}</span>
                                            <span className="text-ludo-xs font-bold text-ink-muted tabular-nums mt-0.5 truncate">
                                                {s.matchType} · {s.gameMode} · {s.wager === 0 ? 'Free' : `${s.wager.toLocaleString()}`}
                                            </span>
                                        </div>
                                        {s.started ? (
                                            <span className="shrink-0 px-2.5 py-1.5 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-ink-faint">
                                                Started
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => joinSearch(s)}
                                                className="shrink-0 px-4 py-2 rounded-xl bg-accent-soft border border-accent/40 text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-accent hover:bg-accent hover:text-accent-ink active:scale-95 transition-all"
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
                                        className="flex items-center gap-3 p-3 bg-surface-panel border border-line-soft rounded-2xl backdrop-blur-md"
                                    >
                                        <div className="w-8 h-8 rounded-full border border-line-soft overflow-hidden bg-surface-recessed shrink-0">
                                            <img
                                                src={activity.actor?.avatar_url || `https://avatar.vercel.sh/${activity.actor_id}`}
                                                alt="avatar"
                                                className="w-full h-full object-cover"
                                                width={96}
                                                height={96}
                                            />
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-ludo-md text-ink-strong truncate font-semibold">
                                                <span className="text-accent font-extrabold">
                                                    {activity.actor?.username || activity.actor_id.slice(0, 6)}
                                                </span>
                                                {' '}{activityText(activity)}
                                            </span>
                                            <span className="text-ludo-xs text-ink-faint font-bold uppercase tracking-widest mt-0.5">
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
                                <TacticalMessageBubble
                                    key={it.key}
                                    isMine={mine}
                                    sender={mine ? 'You' : m.username || 'User'}
                                    meta={new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    content={m.content || '…'}
                                    dimmed={mIsRoom && !mRoomOpen}
                                    avatar={
                                        <button
                                            type="button"
                                            onClick={() => !mine && onOpenProfile?.(m.sender_id)}
                                            aria-label={mine ? 'Your avatar' : `Open ${m.username || 'user'} profile`}
                                            disabled={mine}
                                            className="w-8 h-8 rounded-full overflow-hidden bg-accent-soft border border-line-soft shrink-0 flex items-center justify-center disabled:cursor-default enabled:hover:scale-105 enabled:hover:ring-2 enabled:hover:ring-accent/60 transition-all"
                                        >
                                            {m.avatar_url ? (
                                                <img loading="lazy" decoding="async" src={m.avatar_url} alt="" aria-hidden className="w-full h-full object-cover pointer-events-none" width={96} height={96} />
                                            ) : (
                                                <span className="text-ink-muted font-extrabold text-xs pointer-events-none">{(m.username?.[0] || 'U').toUpperCase()}</span>
                                            )}
                                        </button>
                                    }
                                    joinAction={joinable ? {
                                        title: m.room_code ? `Join room ${m.room_code}` : undefined,
                                        onClick: () => m.room_code && joinRoom(m.room_code),
                                    } : undefined}
                                    belowBubble={mIsRoom && !mRoomOpen ? (
                                        <span className="ml-2 px-1.5 py-0.5 rounded-md bg-surface-recessed text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-ink-muted align-middle">
                                            Over
                                        </span>
                                    ) : undefined}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            {sendError && (
                <div
                    role="alert"
                    className="mx-5 mb-1 flex items-start gap-2 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-ludo-sm leading-snug text-negative"
                >
                    <WarningHexIcon className="icon-sm shrink-0 mt-0.5" />
                    <span className="flex-1">{sendError}</span>
                    <button
                        type="button"
                        onClick={() => setSendError(null)}
                        aria-label="Dismiss"
                        className="shrink-0 text-negative hover:opacity-80"
                    >
                        <CloseReticleIcon className="icon-sm" />
                    </button>
                </div>
            )}

            <div className="px-5 pt-2 pb-3">
                <TacticalChatComposer
                    value={input}
                    emotes={inputEmotes}
                    emojiOpen={emojiOpen}
                    onValueChange={setInput}
                    onEmotesChange={setInputEmotes}
                    onEmojiToggle={() => setEmojiOpen((value) => !value)}
                    onEmojiClose={() => setEmojiOpen(false)}
                    onSend={sendChat}
                    placeholder="Transmit broadcast message..."
                    ariaLabel="Message"
                    maxLength={140}
                    maxEncodedLength={140}
                    cooldown={cooldown}
                    showCounter
                />
            </div>
        </div>
    );
};

function useJoinableCount() {
    const [count, setCount] = useState(0);
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const recompute = async () => {
            try {
                const res = await fetch('/api/live-arena/directory', { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled && typeof data?.stats?.openCount === 'number') {
                    setCount(data.stats.openCount);
                }
            } catch { /* keep last count */ }
        };
        const debounced = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(recompute, 1500);
        };
        void recompute();
        const pollId = window.setInterval(recompute, 10000);
        const ch = supabase.channel('live-count')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_chat' }, debounced)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, debounced)
            .subscribe();
        return () => {
            cancelled = true;
            window.clearInterval(pollId);
            if (timer) clearTimeout(timer);
            void supabase.removeChannel(ch);
        };
    }, []);
    return count;
}

export const LiveBroadcastCard = ({
    onOpenProfile,
    onOpenChange,
    onOpenArena,
    externalFeedData,
}: {
    onOpenProfile?: (address: string) => void;
    onOpenChange?: (open: boolean) => void;
    onOpenArena?: (tab?: 'arena' | 'comms') => void;
    externalFeedData?: BroadcastData;
}) => {
    const { preferences } = usePreferences();
    const is3077 = preferences.theme === '3077';
    const [isOpen, setIsOpen] = useState(false);
    const joinable = useJoinableCount();
    const internalFeedData = useBroadcastData();
    const feedData = externalFeedData ?? internalFeedData;
    const [latestRoom, setLatestRoom] = useState<{ roomCode: string; content: string } | null>(null);
    const [tickerIdx, setTickerIdx] = useState(0);
    const [tickerPaused, setTickerPaused] = useState(false);
    const { address: cardAddr } = useAccount();
    const cardMe = (cardAddr || '').toLowerCase();
    const latestRef = useRef<{ roomCode: string; content: string } | null>(null);
    const setRoom = (r: { roomCode: string; content: string } | null) => {
        latestRef.current = r;
        setLatestRoom(r);
    };
    const roomSessionStart = useRef(Date.now());
    useEffect(() => {
        onOpenChange?.(isOpen);
    }, [isOpen, onOpenChange]);
    useEffect(() => {
        const pick = (row: RoomRow | null | undefined) => {
            if (!row?.room_code || row.room_open === false) return null;
            if ((row.sender_id || '').toLowerCase() === cardMe) return null;
            if (!row.created_at || new Date(row.created_at).getTime() < roomSessionStart.current) return null;
            return { roomCode: row.room_code, content: row.content || '' };
        };
        const fetchLatest = async () => {
            try {
                const { data, error } = await supabase
                    .from('live_chat')
                    .select('room_code, content, room_open, created_at')
                    .not('room_code', 'is', null)
                    .eq('room_open', true)
                    .gt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
                    .order('created_at', { ascending: false })
                    .limit(5);
                if (error) throw error;
                for (const row of (data || []) as RoomRow[]) {
                    const r = pick(row);
                    if (r) { setRoom(r); return; }
                }
                setRoom(null);
            } catch { /* ON AIR fallback stands */ }
        };
        void fetchLatest();
        const ch = supabase
            .channel('live-latest-room')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat' }, (payload) => {
                const r = pick(payload.new as RoomRow);
                if (r) setRoom(r);
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_chat' }, (payload) => {
                const row = payload.new as RoomRow | null;
                if (!row?.room_code) return;
                if (row.room_open === false) {
                    if (latestRef.current?.roomCode === row.room_code) {
                        setRoom(null);
                        void fetchLatest();
                    }
                    return;
                }
                const r = pick(row);
                if (r) setRoom(r);
            })
            .subscribe();
        return () => {
            void supabase.removeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!is3077 || tickerPaused || prefersReducedMotion()) return;
        const id = window.setInterval(() => setTickerIdx((v) => (v + 1) % 2), 6000);
        return () => window.clearInterval(id);
    }, [is3077, tickerPaused]);

    const tickerItems = is3077
        ? [
              {
                  key: latestRoom ? `room-${latestRoom.roomCode}` : 'arena-live',
                  dotColor: latestRoom ? 'var(--sig-ok)' : 'var(--sig-info)',
                  label: latestRoom ? latestRoom.content : 'ON AIR · LIVE ARENA FEED',
                  roomCode: latestRoom?.roomCode ?? null,
              },
              {
                  key: `joinable-${joinable}`,
                  dotColor: joinable > 0 ? 'var(--sig-ok)' : 'var(--sig-info)',
                  label: `${joinable} JOINABLE ${joinable === 1 ? 'ROOM' : 'ROOMS'}`,
                  roomCode: null,
              },
          ]
        : [];
    const activeTicker = tickerItems[tickerIdx % Math.max(1, tickerItems.length)];

    return (
        <>
            <div className="ludo-ticker-scope w-full flex justify-center pointer-events-none">
                {is3077 ? (
                    <div
                        className="broadcast-tier pointer-events-auto h-[48px] w-full max-w-[480px] rounded-xl flex items-center justify-between px-4 relative overflow-hidden cursor-pointer border"
                        style={{ borderColor: 'var(--line-soft)', background: 'var(--surface-2)' }}
                        onClick={() => (onOpenArena ? onOpenArena('arena') : setIsOpen(true))}
                        onMouseEnter={() => setTickerPaused(true)}
                        onMouseLeave={() => setTickerPaused(false)}
                        onFocus={() => setTickerPaused(true)}
                        onBlur={() => setTickerPaused(false)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (onOpenArena) onOpenArena('arena');
                                else setIsOpen(true);
                            }
                        }}
                        aria-label="Open live arena & broadcast"
                    >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span
                                className="ticker-status-dot w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: 'var(--accent)' }}
                                aria-hidden
                            />
                            <span
                                key={activeTicker?.key}
                                className="ticker-crossfade-3077 font-mono text-xs font-medium uppercase tracking-wider truncate"
                                style={{ color: 'var(--accent-bright)' }}
                            >
                                {activeTicker?.label}
                            </span>
                        </div>
                        <div
                            className="flex items-center gap-2 shrink-0 pl-3 border-l"
                            style={{ borderColor: 'rgba(var(--accent-rgb), 0.25)' }}
                        >
                            <span className="font-mono text-xs font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
                                {joinable}
                            </span>
                            <span className="font-mono text-ludo-xs uppercase tracking-wider" style={{ color: 'var(--accent)', opacity: 0.85 }}>
                                Live
                            </span>
                        </div>
                    </div>
                ) : (
                    <div
                        className="broadcast-tier pointer-events-auto h-[64px] w-full max-w-[480px] rounded-2xl flex items-center justify-between px-5 relative overflow-hidden transition-all group cursor-pointer border border-line-soft bg-surface-panel backdrop-blur-3xl hover:border-accent/50 hover:shadow-[0_0_24px_color-mix(in_srgb,var(--accent)_16%,transparent)] active:scale-[0.98]"
                        onClick={() => (onOpenArena ? onOpenArena('arena') : setIsOpen(true))}
                        role="button"
                        aria-label="Open live arena & broadcast"
                    >
                        <div className="flex items-center gap-3 relative z-10 min-w-0 flex-1">
                            <div className="w-10 h-10 rounded-xl border border-accent/35 bg-accent-soft flex items-center justify-center overflow-hidden relative shrink-0">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-accent relative z-10">
                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                    <circle cx="12" cy="12" r="3" />
                                </svg>
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-ludo-xs font-extrabold text-ink-muted uppercase tracking-[0.26em]">Live Broadcast</span>
                                {latestRoom ? (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            window.dispatchEvent(new CustomEvent('join_party', {
                                                detail: { roomCode: latestRoom.roomCode },
                                            }));
                                        }}
                                        title={`Join ${latestRoom.roomCode}`}
                                        className="flex items-center gap-2 mt-0.5 rounded-md hover:opacity-80 active:scale-95 transition-all text-left min-w-0"
                                    >
                                        <div className="h-1.5 w-1.5 rounded-full bg-positive animate-pulse shrink-0" />
                                        <span className="text-ludo-sm font-extrabold text-accent uppercase tracking-wider leading-none truncate underline underline-offset-2">
                                            {latestRoom.content}
                                        </span>
                                    </button>
                                ) : (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (onOpenArena) {
                                                onOpenArena('comms');
                                            } else {
                                                window.dispatchEvent(new CustomEvent('open_live_matches'));
                                                setIsOpen(true);
                                            }
                                        }}
                                        title="Open live comms"
                                        className="flex items-center gap-2 mt-0.5 rounded-md hover:opacity-80 active:scale-95 transition-all text-left"
                                    >
                                        <div className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                                        <span className="text-ludo-sm font-extrabold text-accent uppercase tracking-widest leading-none underline underline-offset-2">
                                            On air
                                        </span>
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-3 relative z-10 ml-3 shrink-0">
                            <div className="h-6 w-[1px] bg-line-soft" />
                            <div className="flex flex-col items-end justify-center h-full" title="Rooms and searches you can join right now">
                                <span className="text-ludo-lg font-extrabold text-accent tabular-nums leading-tight">
                                    {joinable}
                                </span>
                                <span className="text-ludo-xs font-extrabold text-ink-faint uppercase tracking-[0.18em] leading-tight">Joinable</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {!onOpenArena && isOpen && (
                <GamePanelShell
                    scopeClass="ludo-broadcast-scope"
                    kicker="// LIVE COMMS"
                    title="Live Broadcast"
                    onClose={() => setIsOpen(false)}
                    hideOrbs
                >
                    <div className="flex-1 min-h-0 overflow-hidden relative z-10 flex flex-col">
                        <UnifiedBroadcastFeed onOpenProfile={onOpenProfile} onJoin={() => setIsOpen(false)} data={feedData} />
                    </div>
                </GamePanelShell>
            )}
        </>
    );
};
