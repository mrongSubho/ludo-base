'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChatIcon } from './icons';

import { useGameData, Conversation } from '@/hooks/GameDataContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { supabase } from '@/lib/supabase';
import { useNotifications } from '@/hooks/useNotifications';
import { PanelTabs, TabCount } from './PanelTabs';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as the other synced panels: this panel always renders on the shared
// dark-glass sandwich shell, so content uses only white-ink + white-opacity
// surfaces + cyan/status accents. No font-family is set (inherits the active
// theme's display font). Spacing inside `.ludo-messages-scope` is re-asserted
// in globals.css (the global unlayered reset zeroes Tailwind utilities).

interface MessagesPanelProps {
    onClose: () => void;
    initialChatId?: string | null;
    onOpenProfile?: (address: string) => void;
}

const AtTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <ChatIcon className="w-4 h-4 text-cyan-300" />
    </div>
);

const BellTile = () => (
    <div className="w-7 h-7 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(251,191,36,0.25)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-amber-300">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.7 21a2 2 0 0 1-3.4 0"></path>
        </svg>
    </div>
);

const SearchIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0 text-white/35">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
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

// Avatar image only for real URLs — numeric/brand keys have no file and 404.
const resolveAvatar = (avatar: string | null | undefined) =>
    avatar && (/^https?:\/\//.test(avatar) || avatar.startsWith('/')) ? avatar : null;

const Avatar = ({ url, name, box = 'w-11 h-11', dot }: {
    url?: string | null; name: string; box?: string;
    dot?: 'Online' | 'In Match' | 'Offline' | null;
}) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => { setFailed(false); }, [url]);
    const showImg = !!url && !failed;
    return (
        <div className={`${box} rounded-full overflow-hidden bg-cyan-900/50 shrink-0 relative`}>
            {showImg ? (
                <img
                    src={url as string}
                    alt=""
                    aria-hidden
                    onError={() => setFailed(true)}
                    className="w-full h-full object-cover"
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-white/40 font-black text-base">
                    {(name?.[0] || 'L').toUpperCase()}
                </div>
            )}
            {dot && (
                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#14151f]
                    ${dot === 'Online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.9)] animate-pulse' : dot === 'In Match' ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.9)] animate-pulse' : 'bg-white/25'}`}
                />
            )}
        </div>
    );
};

export default function MessagesPanel({ onClose, initialChatId, onOpenProfile }: MessagesPanelProps) {
    const { address, profile: myProfile } = useCurrentUser();
    // Guests read threads free; sending needs a wallet (wall, not a failure).
    const { guard } = useGuestWall();
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const { messages, conversations, sendMessage, markChatAsRead, markThreadSeen, isP2PActive, deleteMessageLocal } = useGameData();
    const markAsRead = markChatAsRead;
    const [inputValue, setInputValue] = useState('');
    const [cooldownTime, setCooldownTime] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [notifTab, setNotifTab] = useState<'notifications' | 'messages'>('notifications');

    // ── Notifications inbox (shared hook — same counts as the header dot) ───
    // Celebrations stay local (read-only, never badged).
    interface InboxCongrats { id: string; actor_id: string; name: string; avatar: string | null; time: string; }
    const {
        requests, pokes, notifCount,
        markSeenRequest, markSeenPoke,
        acceptRequest, declineRequest, pokeBack: pokeBackAction,
    } = useNotifications();
    const [congrats, setCongrats] = useState<InboxCongrats[]>([]);
    const [pokingId, setPokingId] = useState<string | null>(null);

    const timeAgo = (iso: string | null) => {
        if (!iso) return 'Just now';
        const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    };
    const displayNameOf = (username: string | null | undefined, wallet: string) =>
        (username && !username.startsWith('0x')) ? username : `User ${wallet.slice(-4).toUpperCase()}`;

    useEffect(() => {
        if (!address) return;
        const me = address.toLowerCase();
        let cancelled = false;
        (async () => {
            try {
                const { data: celData } = await (supabase as any)
                    .from('activities')
                    .select('id,actor_id,created_at,actor:players(username,avatar_url)')
                    .eq('type', 'congratulate')
                    .filter('metadata->>target_id', 'eq', me)
                    .order('created_at', { ascending: false })
                    .limit(10);
                if (!cancelled) {
                    setCongrats((celData || []).map((c: any) => ({
                        id: c.id,
                        actor_id: c.actor_id,
                        name: displayNameOf(c.actor?.username, c.actor_id || ''),
                        avatar: c.actor?.avatar_url || null,
                        time: timeAgo(c.created_at),
                    })));
                }
            } catch {
                /* celebrations are best-effort */
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    const pokeBack = async (friendId: string) => {
        if (pokingId) return;
        setPokingId(friendId);
        try {
            const ok = await pokeBackAction(friendId);
            if (!ok) alert('Failed to poke back');
        } catch (err) {
            console.error('Poke back error:', err);
        } finally {
            setPokingId(null);
        }
    };
    const openDM = (id: string) => {
        setSelectedChatId(id);
        setNotifTab('messages');
    };

    const activeChat = conversations.find(c => c.id.toLowerCase() === selectedChatId?.toLowerCase()) || (selectedChatId ? {
        id: selectedChatId,
        name: `User ${selectedChatId.slice(-4).toUpperCase()}`,
        avatar: '1',
        lastMessage: '',
        time: 'Just now',
        unread: false,
        status: 'Offline',
        timestamp: Date.now()
    } as Conversation : null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const lastAddressRef = useRef<string | undefined>(address);

    // Resolve the other side's profile on thread open — conversations only
    // carry profiles for known chats, so new threads would show a generic
    // "User XXXX" + broken avatar without this.
    const [contactProfile, setContactProfile] = useState<{ username: string | null; avatar_url: string | null } | null>(null);
    useEffect(() => {
        if (!selectedChatId) {
            setContactProfile(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const { data } = await supabase
                    .from('players')
                    .select('username, avatar_url')
                    .ilike('wallet_address', selectedChatId)
                    .single();
                if (!cancelled && data) setContactProfile(data);
            } catch {
                /* keep fallback identity */
            }
        })();
        return () => { cancelled = true; };
    }, [selectedChatId]);

    const threadName = (contactProfile?.username && !contactProfile.username.startsWith('0x'))
        ? contactProfile.username
        : activeChat?.name;
    const threadAvatar = contactProfile?.avatar_url || activeChat?.avatar;

    // Cooldown Timer
    useEffect(() => {
        if (!address) return;
        // Load initial cooldown from localStorage scoped to user
        const storedCooldownEnd = localStorage.getItem(`chat_cooldown_end_${address.toLowerCase()}`);
        if (storedCooldownEnd) {
            const end = parseInt(storedCooldownEnd);
            const now = Date.now();
            if (end > now) {
                setCooldownTime(Math.ceil((end - now) / 1000));
            }
        }
    }, [address]);

    useEffect(() => {
        if (cooldownTime > 0) {
            const timer = setTimeout(() => setCooldownTime(c => c - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [cooldownTime]);

    // Auto-select initial chat if provided
    useEffect(() => {
        if (initialChatId) {
            setSelectedChatId(initialChatId);
            setNotifTab('messages');
        }
    }, [initialChatId]);

    // Reset selection if account changes
    useEffect(() => {
        if (address && lastAddressRef.current && address.toLowerCase() !== lastAddressRef.current.toLowerCase()) {
            setSelectedChatId(null);
            setInputValue('');
        }
        lastAddressRef.current = address;
    }, [address]);

    // Mark as read when opening a chat: durable DB mark + session-seen
    // (feeds the vanish ledger so read threads stay gone next session).
    useEffect(() => {
        if (selectedChatId && activeChat?.unread) {
            markAsRead(selectedChatId);
            markThreadSeen(selectedChatId);
        }
    }, [selectedChatId, activeChat?.unread]);

    // ── Client-side vanish ledger ──────────────────────────────────────
    // Server flags are best-effort (migration/RLS dependent). This ledger
    // makes vanish hold regardless: messages read this session stay visible
    // until you leave; on persist they join the vanished set and are gone
    // on every future return. Unread is never added — it always survives.
    const vanishedKey = address ? `dm_vanished_${address.toLowerCase()}` : null;
    const [vanishedIds, setVanishedIds] = useState<Set<string>>(new Set());
    const readThisSessionRef = useRef<Set<string>>(new Set());

    // Reload the vanish ledger whenever the identity resolves/changes.
    useEffect(() => {
        if (!vanishedKey) {
            setVanishedIds(new Set());
            return;
        }
        try {
            const raw = localStorage.getItem(vanishedKey);
            const arr = raw ? JSON.parse(raw) : [];
            setVanishedIds(new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []));
        } catch {
            setVanishedIds(new Set());
        }
    }, [vanishedKey]);

    // Whatever is read while this session lives stays visible this session…
    useEffect(() => {
        if (!selectedChatId || !address) return;
        const me = address.toLowerCase();
        const friend = selectedChatId.toLowerCase();
        let changed = false;
        for (const m of messages) {
            const s = m.sender_id.toLowerCase();
            const r = m.receiver_id.toLowerCase();
            if ((s === me && r === friend) || (s === friend && r === me)) {
                if (m.is_read && !readThisSessionRef.current.has(m.id)) {
                    readThisSessionRef.current.add(m.id);
                    changed = true;
                }
            }
        }
        if (changed) setVanishedIds(prev => new Set(prev)); // re-render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, selectedChatId, address]);

    // …and is persisted as vanished on interval, page hide, and unmount.
    useEffect(() => {
        if (!vanishedKey) return;
        const persist = () => {
            if (readThisSessionRef.current.size === 0) return;
            try {
                const raw = localStorage.getItem(vanishedKey);
                const arr = raw ? JSON.parse(raw) : [];
                const merged = [...(Array.isArray(arr) ? arr : []), ...readThisSessionRef.current];
                localStorage.setItem(vanishedKey, JSON.stringify([...new Set(merged)].slice(-500)));
            } catch {
                /* storage unavailable */
            }
        };
        const timer = setInterval(persist, 15000);
        window.addEventListener('beforeunload', persist);
        return () => {
            clearInterval(timer);
            window.removeEventListener('beforeunload', persist);
            persist();
        };
    }, [vanishedKey]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [selectedChatId, messages]);

    const handleSendMessage = async () => {
        if (!inputValue.trim() || !selectedChatId || !address || cooldownTime > 0) return;
        if (!guard('dm')) return; // guests get the upgrade wall; input preserved
        const textToSent = inputValue.slice(0, 140); // Hard limit safety
        setInputValue(''); // Clear aggressively so it feels responsive

        const newCooldown = 10;
        setCooldownTime(newCooldown); // Start 10 second slow-mode
        localStorage.setItem(`chat_cooldown_end_${address.toLowerCase()}`, (Date.now() + newCooldown * 1000).toString());

        await sendMessage(selectedChatId, textToSent);
    };

    // Tap a failed bubble to retry: drop the dead local copy and send fresh.
    const retrySend = async (msg: (typeof messages)[number]) => {
        if (!guard('dm')) return;
        if (cooldownTime > 0 || !selectedChatId) return;
        await deleteMessageLocal(msg);
        const newCooldown = 10;
        setCooldownTime(newCooldown);
        if (address) {
            localStorage.setItem(`chat_cooldown_end_${address.toLowerCase()}`, (Date.now() + newCooldown * 1000).toString());
        }
        await sendMessage(msg.receiver_id, msg.content);
    };

    const q = searchQuery.trim().toLowerCase();
    const visibleChats = q
        ? conversations.filter(c => c.name.toLowerCase().includes(q))
        : conversations;
    const unreadCount = conversations.filter(c => c.unread).length;

    // ── Session Inbox: read messages vanish across sessions ────────────
    // Session start is mount time. On arrival we soft-delete (own side only)
    // our read messages older than this session — unread survive until opened.
    const sessionStartRef = useRef<string>(new Date().toISOString());
    useEffect(() => {
        if (!address) return;
        const me = address.toLowerCase();
        const cutoff = sessionStartRef.current;
        (async () => {
            try {
                await supabase.from('messages').update({ deleted_by_sender: true })
                    .eq('sender_id', me).eq('is_read', true).lt('created_at', cutoff);
                await supabase.from('messages').update({ deleted_by_receiver: true })
                    .eq('receiver_id', me).eq('is_read', true).lt('created_at', cutoff);
            } catch {
                /* best-effort; display rules below enforce the same view */
            }
        })();
    }, [address]);

    const isVisibleThisSession = (m: (typeof messages)[number]) => {
        const me = (address || '').toLowerCase();
        // Vanished in a prior session: gone for good on this device.
        if (vanishedIds.has(m.id)) return false;
        // Belt-and-suspenders with the boot filter: never show own-flagged rows.
        if (m.sender_id.toLowerCase() === me && m.deleted_by_sender) return false;
        if (m.receiver_id.toLowerCase() === me && m.deleted_by_receiver) return false;
        // Read earlier this session stays visible until you leave.
        if (readThisSessionRef.current.has(m.id)) return true;
        // Session rule: this session's messages + anything still unread.
        if (!m.is_read) return true;
        return new Date(m.created_at).getTime() >= new Date(sessionStartRef.current).getTime();
    };

    const threadMessages = activeChat ? (() => {
        const inThread = messages.filter(m => {
            const sender = m.sender_id.toLowerCase();
            const receiver = m.receiver_id.toLowerCase();
            const me = address?.toLowerCase();
            const friend = selectedChatId!.toLowerCase();

            // Strict pairwise check: (me -> friend) OR (friend -> me)
            if (!((sender === me && receiver === friend) || (sender === friend && receiver === me))) return false;
            return isVisibleThisSession(m);
        });
        // Cap 20 with unread exempt: unread always survive, newest read fill up.
        const unread = inThread.filter(m => !m.is_read);
        const read = inThread.filter(m => m.is_read);
        const kept = [...read.slice(-Math.max(0, 20 - unread.length)), ...unread];
        return kept.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    })() : [];

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={onClose}
            />

            {/* Main Panel */}
            {/* Ghost Centering Container */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        /* Unified global panel layout: top-64, bottom-80 sandwich */
                        className="ludo-messages-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
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
                                {selectedChatId && activeChat ? (
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                                        <button
                                            onClick={() => setSelectedChatId(null)}
                                            aria-label="Back to chats"
                                            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/5 text-white/50 hover:text-white hover:bg-white/10 transition-all shrink-0"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"></polyline></svg>
                                        </button>
                                        <button
                                            onClick={() => onOpenProfile?.(activeChat.id)}
                                            aria-label={`Open ${threadName} profile`}
                                            className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 hover:scale-105 transition-transform"
                                        >
                                            <Avatar url={resolveAvatar(threadAvatar)} name={threadName || 'User'} box="w-9 h-9" dot={activeChat.status as any} />
                                        </button>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-white font-black text-base truncate leading-tight">{threadName}</span>
                                            <span className="flex items-center gap-1.5">
                                                <span className={`text-[10px] font-black uppercase tracking-widest ${activeChat.status === 'Online' ? 'text-green-400' : activeChat.status === 'In Match' ? 'text-orange-400' : 'text-white/40'}`}>
                                                    {activeChat.status}
                                                </span>
                                                {isP2PActive && activeChat.status === 'Online' && (
                                                    <span className="flex items-center gap-1 bg-cyan-500/15 px-1.5 py-px rounded-full border border-cyan-500/30">
                                                        <span className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse" />
                                                        <span className="text-[8px] font-black text-cyan-300 tracking-widest uppercase">P2P</span>
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                        <AtTile />
                                        Messages
                                    </h2>
                                )}
                                <button
                                    onClick={onClose}
                                    aria-label="Close messages"
                                    className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                            {!selectedChatId && notifTab === 'messages' && (
                                <div className="flex items-center gap-2 px-0.5">
                                    <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                        {conversations.length} chat{conversations.length === 1 ? '' : 's'}
                                    </span>
                                    {unreadCount > 0 && (
                                        <>
                                            <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-[11px] font-black text-cyan-300 tabular-nums">
                                                {unreadCount} unread
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}
                            {!selectedChatId && notifTab === 'notifications' && (
                                <div className="flex items-center gap-2 px-0.5">
                                    <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                        {notifCount} new
                                    </span>
                                    {notifCount > 0 && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Tabs (list mode only) */}
                        {!selectedChatId && (
                            <div className="px-5 pt-3 relative z-10">
                                <PanelTabs
                                    value={notifTab}
                                    onPick={setNotifTab}
                                    options={[
                                        { value: 'notifications', label: 'Notifications', badge: notifCount > 0 ? <TabCount active={notifTab === 'notifications'}>{notifCount}</TabCount> : undefined },
                                        { value: 'messages', label: 'Messages', badge: unreadCount > 0 ? <TabCount active={notifTab === 'messages'}>{unreadCount}</TabCount> : undefined },
                                    ]}
                                />
                            </div>
                        )}

                        {/* Content */}
                        <div className="flex-1 min-h-0 overflow-hidden relative z-10 flex flex-col">
                            {!selectedChatId ? (notifTab === 'notifications' ? (
                                /* ── Notifications inbox ── */
                                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2">
                                    {requests.length > 0 && (
                                        <>
                                            <SectionLabel>{requests.length} request{requests.length === 1 ? '' : 's'}</SectionLabel>
                                            <div className="flex flex-col gap-2 pb-2">
                                                {requests.map((r) => (
                                                    <div key={r.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10">
                                                        <button
                                                            onClick={() => { markSeenRequest(r.id); onOpenProfile?.(r.wallet_address); }}
                                                            aria-label={`Open ${r.name} profile`}
                                                            className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 hover:scale-105 transition-transform"
                                                        >
                                                            <Avatar url={resolveAvatar(r.avatar)} name={r.name} box="w-11 h-11" />
                                                        </button>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-white truncate text-[13px]">{r.name}</div>
                                                            <div className="text-[10px] text-white/35 font-bold mt-0.5">Wants to be friends · {r.time}</div>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                onClick={() => acceptRequest(r.id)}
                                                                aria-label={`Accept ${r.name}`}
                                                                className="px-2 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-[10px] font-black uppercase hover:bg-cyan-500 hover:text-slate-950 active:scale-95 transition-all"
                                                            >
                                                                Accept
                                                            </button>
                                                            <button
                                                                onClick={() => declineRequest(r.id)}
                                                                aria-label={`Decline ${r.name}`}
                                                                className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50 text-[10px] font-black uppercase hover:text-white active:scale-95 transition-all"
                                                            >
                                                                Skip
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    {pokes.length > 0 && (
                                        <>
                                            <SectionLabel>{pokes.length} poke{pokes.length === 1 ? '' : 's'}</SectionLabel>
                                            <div className="flex flex-col gap-2 pb-2">
                                                {pokes.map((p) => (
                                                    <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10">
                                                        <button
                                                            onClick={() => { markSeenPoke(p.sender_id); onOpenProfile?.(p.sender_id); }}
                                                            aria-label={`Open ${p.name} profile`}
                                                            className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 hover:scale-105 transition-transform"
                                                        >
                                                            <Avatar url={resolveAvatar(p.avatar)} name={p.name} box="w-11 h-11" />
                                                        </button>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-white truncate text-[13px]">{p.name}</div>
                                                            <div className="text-[10px] text-white/35 font-bold mt-0.5">Poked you · {p.time}</div>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                onClick={() => pokeBack(p.sender_id)}
                                                                disabled={pokingId === p.sender_id}
                                                                className="px-2 py-1 rounded-lg bg-yellow-500/15 border border-yellow-500/40 text-yellow-300 text-[10px] font-black uppercase hover:bg-yellow-500 hover:text-black active:scale-95 transition-all disabled:opacity-50"
                                                            >
                                                                {pokingId === p.sender_id ? '…' : 'Poke back'}
                                                            </button>
                                                            <button
                                                                onClick={() => { markSeenPoke(p.sender_id); openDM(p.sender_id); }}
                                                                aria-label={`Message ${p.name}`}
                                                                className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50 text-[10px] font-black uppercase hover:text-white active:scale-95 transition-all"
                                                            >
                                                                DM
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    {congrats.length > 0 && (
                                        <>
                                            <SectionLabel>Celebrations</SectionLabel>
                                            <div className="flex flex-col gap-2 pb-2">
                                                {congrats.map((c) => (
                                                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10">
                                                        <button
                                                            onClick={() => onOpenProfile?.(c.actor_id)}
                                                            aria-label={`Open ${c.name} profile`}
                                                            className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 hover:scale-105 transition-transform"
                                                        >
                                                            <Avatar url={resolveAvatar(c.avatar)} name={c.name} box="w-11 h-11" />
                                                        </button>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-white truncate text-[13px]">{c.name}</div>
                                                            <div className="text-[10px] text-white/35 font-bold mt-0.5">Celebrated you · {c.time}</div>
                                                        </div>
                                                        <button
                                                            onClick={() => openDM(c.actor_id)}
                                                            aria-label={`Thank ${c.name}`}
                                                            className="shrink-0 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50 text-[10px] font-black uppercase hover:text-white active:scale-95 transition-all"
                                                        >
                                                            Thanks
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    {notifCount === 0 && congrats.length === 0 && (
                                        <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                                                <BellTile />
                                            </div>
                                            <h3 className="text-white font-black text-sm mb-1">All caught up</h3>
                                            <p className="text-white/40 text-xs max-w-[220px]">Requests, pokes, and celebrations land here.</p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div className="px-5 pt-3">
                                        <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl pl-2.5 pr-1.5 h-10 focus-within:border-cyan-500/60 transition-colors overflow-hidden">
                                            <SearchIcon />
                                            <input
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                placeholder="Search"
                                                className="flex-1 min-w-0 bg-transparent border-0 p-0 text-[11px] font-bold text-white placeholder:text-white/25 focus:outline-none focus:ring-0"
                                            />
                                            {searchQuery && (
                                                <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="w-2.5 h-2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {/* Chat List */}
                                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2">
                                        <SectionLabel>
                                            {visibleChats.length} chat{visibleChats.length === 1 ? '' : 's'}
                                        </SectionLabel>
                                        {visibleChats.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                                <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                                                    <ChatIcon className="w-7 h-7" />
                                                </div>
                                                <h3 className="text-white font-black text-sm mb-1">
                                                    {q ? 'No chats match' : 'No messages yet'}
                                                </h3>
                                                <p className="text-white/40 text-xs max-w-[220px]">
                                                    {q ? 'Try a different search.' : 'Say hi from a friend profile to start a thread.'}
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-2 pb-2">
                                                {visibleChats.map((chat) => (
                                                    <div
                                                        key={chat.id}
                                                        onClick={() => setSelectedChatId(chat.id)}
                                                        className="group relative rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden cursor-pointer transition-all hover:border-white/25 hover:bg-white/[0.07] active:scale-[0.99]"
                                                    >
                                                        {chat.unread && (
                                                            <div className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
                                                        )}
                                                        <div className="flex items-center gap-3 p-3">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onOpenProfile?.(chat.id); }}
                                                                aria-label={`Open ${chat.name} profile`}
                                                                className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 hover:scale-105 transition-transform"
                                                            >
                                                                <Avatar url={resolveAvatar(chat.avatar)} name={chat.name} box="w-11 h-11" dot={chat.status as any} />
                                                            </button>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="font-bold text-white truncate text-[13px]">{chat.name}</span>
                                                                    <span className="text-[10px] text-white/35 shrink-0 font-bold">{chat.time}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2 mt-0.5">
                                                                    <p className={`text-xs truncate ${chat.unread ? 'text-white font-bold' : 'text-white/45'}`}>
                                                                        {chat.lastMessage || '—'}
                                                                    </p>
                                                                    {chat.unread && (
                                                                        <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] shrink-0" />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )) : (
                                /* Chat Detail */
                                <div className="flex flex-col flex-1 min-h-0">
                                    <div
                                        ref={scrollRef}
                                        className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-2"
                                    >
                                        <div className="flex flex-col gap-2.5 pb-2">
                                            {threadMessages.map((msg) => {
                                                const isMe = msg.sender_id.toLowerCase() === address?.toLowerCase();
                                                const timeString = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                                const otherAvatar = resolveAvatar(threadAvatar);
                                                const otherName = threadName || 'User';
                                                const myName = (myProfile?.username && !myProfile.username.startsWith('0x'))
                                                    ? myProfile.username
                                                    : (address ? `User ${address.slice(-4).toUpperCase()}` : 'Guest');
                                                return (
                                                    <div
                                                        key={msg.id}
                                                        className={`flex w-full gap-2 items-end ${isMe ? 'flex-row-reverse' : ''}`}
                                                    >
                                                        <button
                                                            onClick={() => onOpenProfile?.(isMe ? (address || '') : selectedChatId!)}
                                                            aria-label={isMe ? 'Open your profile' : `Open ${otherName} profile`}
                                                            className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 hover:scale-105 transition-transform"
                                                        >
                                                            <Avatar
                                                                url={isMe ? resolveAvatar(myProfile?.avatar_url) : otherAvatar}
                                                                name={isMe ? myName : otherName}
                                                                box="w-7 h-7"
                                                            />
                                                        </button>
                                                        <div
                                                            className={`max-w-[75%] flex flex-col ${isMe ? 'items-end' : 'items-start'} ${msg.send_status === 'sending' ? 'opacity-50' : ''}`}
                                                        >
                                                            <div className={`text-[10px] font-bold px-1 mb-0.5 ${isMe ? 'text-white/30 text-right' : 'text-white/30 text-left'}`}>
                                                                {msg.send_status === 'sending' ? 'Sending...' : isMe ? `${myName} · ${timeString}` : `${otherName} · ${timeString}`}
                                                            </div>
                                                            {msg.send_status === 'failed' && isMe ? (
                                                                <button
                                                                    onClick={() => retrySend(msg)}
                                                                    className={`w-fit min-w-12 max-w-full py-3 px-4 rounded-2xl text-[14px] leading-relaxed break-words [overflow-wrap:anywhere] text-left shadow-sm bg-red-600 text-white rounded-tr-md hover:bg-red-500 active:scale-[0.98] transition-all`}
                                                                >
                                                                    {msg.content}
                                                                </button>
                                                            ) : (
                                                                <div className={`w-fit min-w-12 max-w-full py-3 px-4 rounded-2xl text-[14px] leading-relaxed break-words [overflow-wrap:anywhere] shadow-sm ${isMe
                                                                    ? 'bg-cyan-700 text-white rounded-tr-md'
                                                                    : 'bg-white/10 text-white/90 rounded-tl-md border border-white/5'
                                                                    }`}>
                                                                    {msg.content}
                                                                </div>
                                                            )}
                                                            {msg.send_status === 'failed' && (
                                                                <button onClick={() => isMe && retrySend(msg)} className="text-[10px] text-red-400 mt-1 px-1 font-bold hover:text-red-300 transition-colors">Failed to send · tap to retry</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Input Area */}
                                    <div className="px-5 pt-2 pb-3">
                                        <div className="flex gap-1.5 relative">
                                            <input
                                                type="text"
                                                value={inputValue}
                                                maxLength={140}
                                                onChange={(e) => setInputValue(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                                disabled={cooldownTime > 0}
                                                placeholder={cooldownTime > 0 ? `Wait ${cooldownTime}s...` : "Type a message..."}
                                                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl pl-3 pr-12 py-2.5 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-600/50 transition-colors disabled:opacity-50"
                                            />
                                            <div className={`absolute right-[52px] top-1/2 -translate-y-1/2 text-[10px] pointer-events-none transition-colors ${inputValue.length >= 130 ? 'text-red-400 font-bold' : 'text-white/20'
                                                }`}>
                                                {inputValue.length}/140
                                            </div>
                                            <button
                                                onClick={handleSendMessage}
                                                disabled={!inputValue.trim() || cooldownTime > 0}
                                                aria-label="Send message"
                                                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-cyan-700 text-white disabled:opacity-50 disabled:bg-white/10 transition-all hover:bg-cyan-600 relative overflow-hidden"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                                                    <line x1="22" y1="2" x2="11" y2="13"></line>
                                                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                                </svg>
                                                {cooldownTime > 0 && (
                                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-xs font-bold text-white backdrop-blur-sm">
                                                        {cooldownTime}s
                                                    </div>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
