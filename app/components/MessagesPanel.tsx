'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChatIcon, CloseReticleIcon } from './icons';
import { useGameData, Conversation } from '@/hooks/GameDataContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { supabase } from '@/lib/supabase';
import { useNotifications } from '@/hooks/useNotifications';
import { PanelTabs, TabCount } from './PanelTabs';
import { EmptyState } from './EmptyState';
import { TacticalChatComposer, TacticalMessageBubble } from './TacticalChat';
import { encodeChatDraft, type ChatDraftEmote } from '@/lib/emotes';
import { useToast } from './Toast';
import { ThinkingOrb } from './ThinkingOrb';
import { useConversationLive } from '@/hooks/useConversationLive';
import { HudCornerTicks, HudSectionLabel } from './HudPrimitives';
import { PilotAvatar } from './PilotAvatar';
import Button from './Button';

interface MessagesPanelProps {
    onClose: () => void;
    initialChatId?: string | null;
    onOpenProfile?: (address: string) => void;
}

const BellTile = () => (
    <div className="w-9 h-9 rounded-xl bg-warn/15 border border-warn/40 flex items-center justify-center text-warn">
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
        >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
    </div>
);

const SearchIcon = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="w-3.5 h-3.5 shrink-0 text-ink-faint"
    >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
);

const STATUS_DOT: Record<'Online' | 'In Match' | 'Offline', string> = {
    Online: 'bg-positive animate-pulse',
    'In Match': 'bg-warn animate-pulse',
    Offline: 'bg-ink-faint',
};

const AvatarWithDot = ({
    url,
    name,
    size = 'sm',
    dot,
}: {
    url?: string | null;
    name: string;
    size?: 'xs' | 'sm';
    dot?: string | null;
}) => {
    const status = dot === 'Online' || dot === 'In Match' || dot === 'Offline' ? dot : null;
    return (
        <div className="relative shrink-0">
            <PilotAvatar avatarUrl={url} name={name} size={size} />
            {status && (
                <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-panel ${STATUS_DOT[status]}`}
                />
            )}
        </div>
    );
};

interface RawActivityItem {
    id: string;
    actor_id: string;
    created_at: string | null;
    actor?: { username?: string | null; avatar_url?: string | null } | null;
}

export default function MessagesPanel({
    onClose,
    initialChatId,
    onOpenProfile,
}: MessagesPanelProps) {
    const { address, profile: myProfile, isGuest } = useCurrentUser();
    const { sessionId: appSessionId, ready: sessionReady, ensureAppSession } = useAppSession();
    const inboxLocked = !!address && sessionReady && !appSessionId;
    const { guard } = useGuestWall();
    const toast = useToast();

    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const {
        messages,
        conversations,
        sendMessage,
        markChatAsRead,
        markThreadSeen,
        isP2PActive,
        deleteMessageLocal,
        refreshMessages,
        ensureEcdhPublished,
    } = useGameData();
    const markAsRead = markChatAsRead;

    useEffect(() => {
        if (address && appSessionId) {
            void ensureEcdhPublished();
        }
    }, [address, appSessionId, ensureEcdhPublished]);

    const [inputValue, setInputValue] = useState('');
    const [inputEmotes, setInputEmotes] = useState<ChatDraftEmote[]>([]);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [cooldownTime, setCooldownTime] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [notifTab, setNotifTab] = useState<'notifications' | 'messages'>('notifications');

    interface InboxCongrats {
        id: string;
        actor_id: string;
        name: string;
        avatar: string | null;
        time: string;
    }
    const {
        requests,
        pokes,
        notifCount,
        markSeenRequest,
        markSeenPoke,
        acceptRequest,
        declineRequest,
        pokeBack: pokeBackAction,
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
        username && !username.startsWith('0x') ? username : `User ${wallet.slice(-4).toUpperCase()}`;

    useEffect(() => {
        if (!address) return;
        const me = address.toLowerCase();
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(`/api/activities?target=${encodeURIComponent(me)}`);
                const celData: RawActivityItem[] = response.ok ? await response.json() : [];
                if (!cancelled) {
                    setCongrats(
                        (celData || []).map((c) => ({
                            id: c.id,
                            actor_id: c.actor_id,
                            name: displayNameOf(c.actor?.username, c.actor_id || ''),
                            avatar: c.actor?.avatar_url || null,
                            time: timeAgo(c.created_at),
                        })),
                    );
                }
            } catch {
                /* best-effort */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [address]);

    const pokeBack = async (friendId: string) => {
        if (pokingId) return;
        setPokingId(friendId);
        try {
            const ok = await pokeBackAction(friendId);
            if (!ok) toast('Failed to poke back', 'error');
        } catch (err) {
            toast(err instanceof Error && err.message ? err.message : 'Failed to poke back', 'error');
        } finally {
            setPokingId(null);
        }
    };

    const openDM = (id: string) => {
        setSelectedChatId(id);
        setNotifTab('messages');
    };

    const activeChat =
        conversations.find((c) => c.id.toLowerCase() === selectedChatId?.toLowerCase()) ||
        (selectedChatId
            ? ({
                  id: selectedChatId,
                  name: `User ${selectedChatId.slice(-4).toUpperCase()}`,
                  avatar: '',
                  lastMessage: '',
                  time: 'Just now',
                  unread: false,
                  status: 'Offline',
                  timestamp: Date.now(),
              } as Conversation)
            : null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const lastAddressRef = useRef<string | undefined>(address);

    const [contactProfile, setContactProfile] = useState<{
        username: string | null;
        avatar_url: string | null;
    } | null>(null);

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
        return () => {
            cancelled = true;
        };
    }, [selectedChatId]);

    const threadName =
        contactProfile?.username && !contactProfile.username.startsWith('0x')
            ? contactProfile.username
            : activeChat?.name;
    const threadAvatar = contactProfile?.avatar_url || activeChat?.avatar;

    const { peerTyping, setTyping, notifyMessage, nudge } = useConversationLive(
        selectedChatId,
        address,
    );

    useEffect(() => {
        if (nudge > 0) void refreshMessages();
    }, [nudge, refreshMessages]);

    useEffect(() => {
        if (!address) return;
        const storedCooldownEnd = localStorage.getItem(`chat_cooldown_end_${address.toLowerCase()}`);
        if (storedCooldownEnd) {
            const end = parseInt(storedCooldownEnd, 10);
            const now = Date.now();
            if (end > now) setCooldownTime(Math.ceil((end - now) / 1000));
        }
    }, [address]);

    useEffect(() => {
        if (cooldownTime > 0) {
            const timer = setTimeout(() => setCooldownTime((c) => c - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [cooldownTime]);

    useEffect(() => {
        if (initialChatId) {
            setSelectedChatId(initialChatId);
            setNotifTab('messages');
        }
    }, [initialChatId]);

    useEffect(() => {
        if (
            address &&
            lastAddressRef.current &&
            address.toLowerCase() !== lastAddressRef.current.toLowerCase()
        ) {
            setSelectedChatId(null);
            setInputValue('');
        }
        lastAddressRef.current = address;
    }, [address]);

    useEffect(() => {
        if (selectedChatId) {
            markThreadSeen(selectedChatId);
            if (activeChat?.unread) markAsRead(selectedChatId);
        }
    }, [selectedChatId, activeChat?.unread, markAsRead, markThreadSeen]);

    const vanishedKey = address ? `dm_vanished_${address.toLowerCase()}` : null;
    const [vanishedIds, setVanishedIds] = useState<Set<string>>(new Set());
    const readThisSessionRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!vanishedKey) {
            setVanishedIds(new Set());
            return;
        }
        try {
            const raw = localStorage.getItem(vanishedKey);
            const arr = raw ? JSON.parse(raw) : [];
            setVanishedIds(
                new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []),
            );
        } catch {
            setVanishedIds(new Set());
        }
    }, [vanishedKey]);

    useEffect(() => {
        if (!selectedChatId || !address) return;
        const me = address.toLowerCase();
        const friend = selectedChatId.toLowerCase();
        let changed = false;
        for (const m of messages) {
            const s = m.sender_id.toLowerCase();
            const r = m.receiver_id.toLowerCase();
            if ((s === me && r === friend) || (s === friend && r === me)) {
                if (!readThisSessionRef.current.has(m.id)) {
                    readThisSessionRef.current.add(m.id);
                    changed = true;
                }
            }
        }
        if (changed) setVanishedIds((prev) => new Set(prev));
    }, [messages, selectedChatId, address]);

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
        if (!guard('dm')) return;
        const textToSent = encodeChatDraft(inputValue, inputEmotes).slice(0, 500);
        setInputValue('');
        setInputEmotes([]);

        const newCooldown = 10;
        setCooldownTime(newCooldown);
        localStorage.setItem(
            `chat_cooldown_end_${address.toLowerCase()}`,
            (Date.now() + newCooldown * 1000).toString(),
        );

        await sendMessage(selectedChatId, textToSent);
        setTyping(false);
        notifyMessage();
    };

    const retrySend = async (msg: (typeof messages)[number]) => {
        if (!guard('dm') || !selectedChatId) return;
        await deleteMessageLocal(msg);
        setCooldownTime(0);
        await sendMessage(msg.receiver_id, msg.content);
    };

    const q = searchQuery.trim().toLowerCase();
    const visibleChats = q
        ? conversations.filter((c) => c.name.toLowerCase().includes(q))
        : conversations;
    const unreadCount = conversations.filter((c) => c.unread).length;
    const sessionStartRef = useRef<string>(new Date().toISOString());

    const isVisibleThisSession = (m: (typeof messages)[number]) => {
        const me = (address || '').toLowerCase();
        if (vanishedIds.has(m.id)) return false;
        if (m.sender_id.toLowerCase() === me && m.deleted_by_sender) return false;
        if (m.receiver_id.toLowerCase() === me && m.deleted_by_receiver) return false;
        if (readThisSessionRef.current.has(m.id)) return true;
        if (new Date(m.created_at).getTime() >= new Date(sessionStartRef.current).getTime()) return true;
        return m.receiver_id.toLowerCase() === me && !m.is_read;
    };

    const threadMessages = activeChat
        ? (() => {
              const inThread = messages.filter((m) => {
                  const sender = m.sender_id.toLowerCase();
                  const receiver = m.receiver_id.toLowerCase();
                  const me = address?.toLowerCase();
                  const friend = selectedChatId!.toLowerCase();
                  if (!((sender === me && receiver === friend) || (sender === friend && receiver === me))) {
                      return false;
                  }
                  return isVisibleThisSession(m);
              });
              const unread = inThread.filter((m) => !m.is_read);
              const read = inThread.filter((m) => m.is_read);
              const kept = [...read.slice(-Math.max(0, 20 - unread.length)), ...unread];
              return kept.sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
              );
          })()
        : [];

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={onClose}
            />

            {/* Synchronized 3077 Panel Shell */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        className="panel-shell-3077 ludo-messages-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] rounded-[32px] flex flex-col overflow-hidden"
                        style={{
                            background: 'var(--panel-bg)',
                            border: '1px solid var(--panel-border)',
                            boxShadow: 'var(--panel-shadow)',
                            color: 'var(--ink-strong)',
                            backdropFilter: 'blur(32px)',
                            WebkitBackdropFilter: 'blur(32px)',
                        }}
                    >
                        <HudCornerTicks />

                        {/* Handle Bar */}
                        <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                            <div
                                className="panel-handle-bar w-12 h-1.5 rounded-full"
                                style={{ background: 'var(--line-strong)' }}
                            />
                        </div>

                        {/* Header */}
                        <div
                            className="px-5 pb-3 relative z-10"
                            style={{ borderBottom: '1px solid var(--line-soft)' }}
                        >
                            <div className="flex items-center justify-between mb-1 mt-1 gap-2">
                                {selectedChatId && activeChat ? (
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setSelectedChatId(null)}
                                            aria-label="Back to chats"
                                            className="bg-surface-recessed border border-line-soft shrink-0"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.4"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                className="w-4 h-4"
                                            >
                                                <polyline points="15 18 9 12 15 6" />
                                            </svg>
                                        </Button>
                                        <button
                                            type="button"
                                            onClick={() => onOpenProfile?.(activeChat.id)}
                                            aria-label={`Open ${threadName} profile`}
                                            className="shrink-0 rounded-full hover:scale-105 transition-transform"
                                        >
                                            <AvatarWithDot
                                                url={threadAvatar}
                                                name={threadName || 'User'}
                                                size="xs"
                                                dot={activeChat.status}
                                            />
                                        </button>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-ink-strong font-extrabold text-ludo-lg truncate leading-tight">
                                                {threadName}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                {peerTyping ? (
                                                    <span className="flex items-center gap-1.5">
                                                        <ThinkingOrb state="composing" size={20} />
                                                        <span className="text-ludo-xs font-mono font-bold uppercase tracking-widest text-accent">
                                                            typing…
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span
                                                        className={`text-ludo-xs font-mono font-bold uppercase tracking-widest ${
                                                            activeChat.status === 'Online'
                                                                ? 'text-positive'
                                                                : activeChat.status === 'In Match'
                                                                  ? 'text-warn'
                                                                  : 'text-ink-faint'
                                                        }`}
                                                    >
                                                        {activeChat.status}
                                                    </span>
                                                )}
                                                {isP2PActive && activeChat.status === 'Online' && (
                                                    <span className="flex items-center gap-1 bg-accent-soft px-1.5 py-0.5 rounded-full border border-accent/35">
                                                        <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
                                                        <span className="text-ludo-xs font-mono font-bold text-accent tracking-widest uppercase">
                                                            P2P
                                                        </span>
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="min-w-0 flex flex-col">
                                        <p className="text-ludo-xs font-mono uppercase tracking-[0.22em] text-accent mb-0.5">
                                            {'// ENCRYPTED COMMS'}
                                        </p>
                                        <h2 className="text-xl font-bold text-ink-strong flex items-center gap-2">
                                            <span className="w-7 h-7 rounded-xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                                                <ChatIcon className="w-4 h-4" active />
                                            </span>
                                            <span>Messages</span>
                                        </h2>
                                    </div>
                                )}

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onClose}
                                    aria-label="Close messages"
                                    className="panel-close-3077 bg-surface-recessed border border-line-soft shrink-0"
                                >
                                    <CloseReticleIcon className="icon-md" />
                                </Button>
                            </div>

                            {!selectedChatId && notifTab === 'messages' && (
                                <div className="flex items-center gap-2 px-0.5 text-ludo-xs font-mono uppercase tracking-[0.14em]">
                                    <span className="font-bold text-ink-muted tabular-nums">
                                        {conversations.length} chat{conversations.length === 1 ? '' : 's'}
                                    </span>
                                    {unreadCount > 0 && (
                                        <>
                                            <span className="text-ink-faint" aria-hidden="true">·</span>
                                            <span className="px-2 py-0.5 rounded-full bg-accent-soft border border-accent/35 font-bold text-accent tabular-nums">
                                                {unreadCount} unread
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}

                            {!selectedChatId && notifTab === 'notifications' && (
                                <div className="flex items-center gap-2 px-0.5 text-ludo-xs font-mono uppercase tracking-[0.14em]">
                                    <span className="font-bold text-ink-muted tabular-nums">
                                        {notifCount} new
                                    </span>
                                    {notifCount > 0 && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-negative animate-pulse" />
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
                                        {
                                            value: 'notifications',
                                            label: 'Notifications',
                                            badge:
                                                notifCount > 0 ? (
                                                    <TabCount active={notifTab === 'notifications'}>
                                                        {notifCount}
                                                    </TabCount>
                                                ) : undefined,
                                        },
                                        {
                                            value: 'messages',
                                            label: 'Messages',
                                            badge:
                                                unreadCount > 0 ? (
                                                    <TabCount active={notifTab === 'messages'}>
                                                        {unreadCount}
                                                    </TabCount>
                                                ) : undefined,
                                        },
                                    ]}
                                />
                            </div>
                        )}

                        {/* Body */}
                        <div className="flex-1 min-h-0 overflow-hidden relative z-10 flex flex-col">
                            {!selectedChatId ? (
                                notifTab === 'notifications' ? (
                                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-3 px-5 pb-3 flex flex-col gap-3">
                                        {requests.length > 0 && (
                                            <div className="flex flex-col gap-1.5">
                                                <HudSectionLabel>
                                                    {requests.length} request{requests.length === 1 ? '' : 's'}
                                                </HudSectionLabel>
                                                {requests.map((r) => (
                                                    <div
                                                        key={r.id}
                                                        className="flex items-center gap-2.5 p-2.5 rounded-xl bg-surface-recessed border border-line-soft"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                markSeenRequest(r.id);
                                                                onOpenProfile?.(r.wallet_address);
                                                            }}
                                                            aria-label={`Open ${r.name} profile`}
                                                            className="shrink-0 rounded-full hover:scale-105 transition-transform"
                                                        >
                                                            <AvatarWithDot url={r.avatar} name={r.name} />
                                                        </button>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-ink-strong truncate text-ludo-md leading-tight">
                                                                {r.name}
                                                            </div>
                                                            <div className="text-ludo-xs text-ink-faint font-mono font-bold mt-0.5">
                                                                Wants to be friends · {r.time}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => acceptRequest(r.id)}
                                                                aria-label={`Accept ${r.name}`}
                                                                className="px-2.5 py-1 rounded-lg bg-accent-soft border border-accent/40 text-accent text-ludo-xs font-bold uppercase hover:bg-accent hover:text-accent-ink active:scale-95 transition-colors"
                                                            >
                                                                Accept
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => declineRequest(r.id)}
                                                                aria-label={`Decline ${r.name}`}
                                                                className="px-2.5 py-1 rounded-lg bg-surface-panel border border-line-soft text-ink-muted text-ludo-xs font-bold uppercase hover:text-ink-strong active:scale-95 transition-colors"
                                                            >
                                                                Skip
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {pokes.length > 0 && (
                                            <div className="flex flex-col gap-1.5">
                                                <HudSectionLabel>
                                                    {pokes.length} poke{pokes.length === 1 ? '' : 's'}
                                                </HudSectionLabel>
                                                {pokes.map((p) => (
                                                    <div
                                                        key={p.id}
                                                        className="flex items-center gap-2.5 p-2.5 rounded-xl bg-surface-recessed border border-line-soft"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                markSeenPoke(p.sender_id);
                                                                onOpenProfile?.(p.sender_id);
                                                            }}
                                                            aria-label={`Open ${p.name} profile`}
                                                            className="shrink-0 rounded-full hover:scale-105 transition-transform"
                                                        >
                                                            <AvatarWithDot url={p.avatar} name={p.name} />
                                                        </button>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-ink-strong truncate text-ludo-md leading-tight">
                                                                {p.name}
                                                            </div>
                                                            <div className="text-ludo-xs text-ink-faint font-mono font-bold mt-0.5">
                                                                Poked you · {p.time}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => void pokeBack(p.sender_id)}
                                                                disabled={pokingId === p.sender_id}
                                                                className="px-2.5 py-1 rounded-lg bg-warn/15 border border-warn/40 text-warn text-ludo-xs font-bold uppercase hover:bg-warn hover:text-accent-ink active:scale-95 transition-colors disabled:opacity-50"
                                                            >
                                                                {pokingId === p.sender_id ? '…' : 'Poke back'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    markSeenPoke(p.sender_id);
                                                                    openDM(p.sender_id);
                                                                }}
                                                                aria-label={`Message ${p.name}`}
                                                                className="px-2.5 py-1 rounded-lg bg-surface-panel border border-line-soft text-ink-muted text-ludo-xs font-bold uppercase hover:text-ink-strong active:scale-95 transition-colors"
                                                            >
                                                                DM
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {congrats.length > 0 && (
                                            <div className="flex flex-col gap-1.5">
                                                <HudSectionLabel>Celebrations</HudSectionLabel>
                                                {congrats.map((c) => (
                                                    <div
                                                        key={c.id}
                                                        className="flex items-center gap-2.5 p-2.5 rounded-xl bg-surface-recessed border border-line-soft"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => onOpenProfile?.(c.actor_id)}
                                                            aria-label={`Open ${c.name} profile`}
                                                            className="shrink-0 rounded-full hover:scale-105 transition-transform"
                                                        >
                                                            <AvatarWithDot url={c.avatar} name={c.name} />
                                                        </button>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-ink-strong truncate text-ludo-md leading-tight">
                                                                {c.name}
                                                            </div>
                                                            <div className="text-ludo-xs text-ink-faint font-mono font-bold mt-0.5">
                                                                Celebrated you · {c.time}
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => openDM(c.actor_id)}
                                                            aria-label={`Thank ${c.name}`}
                                                            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface-panel border border-line-soft text-ink-muted text-ludo-xs font-bold uppercase hover:text-ink-strong active:scale-95 transition-colors"
                                                        >
                                                            Thanks
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {notifCount === 0 && congrats.length === 0 && (
                                            <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl border border-line-soft bg-surface-recessed">
                                                <div className="mb-3">
                                                    <BellTile />
                                                </div>
                                                <h3 className="text-ink-strong font-extrabold text-ludo-md mb-1">
                                                    All caught up
                                                </h3>
                                                <p className="text-ink-faint text-ludo-xs max-w-[220px]">
                                                    Requests, pokes, and celebrations land here.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <div className="px-5 pt-2.5">
                                            <div className="search-shell flex items-center gap-2 bg-surface-recessed border border-line-soft rounded-xl px-2.5 h-8 focus-within:border-accent transition-colors overflow-hidden">
                                                <SearchIcon />
                                                <input
                                                    type="text"
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    placeholder="Search threads…"
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
                                                        <CloseReticleIcon className="w-2.5 h-2.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2.5 px-5 pb-3 flex flex-col gap-2">
                                            <HudSectionLabel>
                                                {visibleChats.length} chat{visibleChats.length === 1 ? '' : 's'}
                                            </HudSectionLabel>

                                            {inboxLocked ? (
                                                <div className="my-2 p-5 rounded-2xl bg-accent-soft border border-accent/35 flex flex-col items-center text-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-surface-panel border border-accent/40 flex items-center justify-center text-accent">
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            className="w-5 h-5"
                                                        >
                                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                                        </svg>
                                                    </div>
                                                    <div className="flex flex-col gap-1 max-w-xs">
                                                        <span className="text-ink-strong font-bold text-ludo-md">
                                                            Session Inactive
                                                        </span>
                                                        <span className="text-ink-muted text-ludo-xs leading-relaxed">
                                                            Activate session to view conversations and send encrypted messages.
                                                        </span>
                                                    </div>
                                                    <Button
                                                        size="md"
                                                        variant="primary"
                                                        onClick={async () => {
                                                            const sid = await ensureAppSession({
                                                                context: 'messaging',
                                                                force: true,
                                                            });
                                                            if (sid) {
                                                                void ensureEcdhPublished(true);
                                                                refreshMessages();
                                                            }
                                                        }}
                                                        className="uppercase tracking-widest"
                                                    >
                                                        Activate Session
                                                    </Button>
                                                </div>
                                            ) : visibleChats.length === 0 ? (
                                                <EmptyState
                                                    title={
                                                        q
                                                            ? 'No chats match'
                                                            : isGuest
                                                              ? 'Connect wallet to message'
                                                              : 'No messages yet'
                                                    }
                                                    body={
                                                        q
                                                            ? 'Try a different search.'
                                                            : isGuest
                                                              ? 'Connect a wallet to start chatting with friends.'
                                                              : 'Say hi from a friend profile to start a thread.'
                                                    }
                                                />
                                            ) : (
                                                <div className="flex flex-col gap-1.5 pb-2">
                                                    {visibleChats.map((chat) => (
                                                        <div
                                                            key={chat.id}
                                                            onClick={() => setSelectedChatId(chat.id)}
                                                            className="group relative rounded-xl bg-surface-recessed border border-line-soft overflow-hidden cursor-pointer transition-colors hover:border-line-strong hover:bg-surface-hover active:scale-[0.99]"
                                                        >
                                                            {chat.unread && (
                                                                <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />
                                                            )}
                                                            <div className="flex items-center gap-2.5 p-2.5 pl-3">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onOpenProfile?.(chat.id);
                                                                    }}
                                                                    aria-label={`Open ${chat.name} profile`}
                                                                    className="shrink-0 rounded-full hover:scale-105 transition-transform"
                                                                >
                                                                    <AvatarWithDot
                                                                        url={chat.avatar}
                                                                        name={chat.name}
                                                                        dot={chat.status}
                                                                    />
                                                                </button>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="font-bold text-ink-strong truncate text-ludo-md leading-tight">
                                                                            {chat.name}
                                                                        </span>
                                                                        <span className="text-ludo-xs text-ink-faint shrink-0 font-mono font-bold">
                                                                            {chat.time}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-2 mt-0.5">
                                                                        <p
                                                                            className={`text-ludo-sm truncate ${
                                                                                chat.unread
                                                                                    ? 'text-ink-strong font-bold'
                                                                                    : 'text-ink-muted'
                                                                            }`}
                                                                        >
                                                                            {chat.lastMessage || '—'}
                                                                        </p>
                                                                        {chat.unread && (
                                                                            <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
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
                                )
                            ) : (
                                /* Chat Detail */
                                <div className="flex flex-col flex-1 min-h-0 px-4 pt-2 pb-3">
                                    <div className="flex-1 min-h-0 flex flex-col justify-between rounded-2xl bg-surface-recessed border border-line-soft p-3.5">
                                        <div
                                            ref={scrollRef}
                                            className="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-2.5 pr-1"
                                        >
                                            {threadMessages.map((msg) => {
                                                const isMe =
                                                    msg.sender_id.toLowerCase() === address?.toLowerCase();
                                                const timeString = new Date(msg.created_at).toLocaleTimeString(
                                                    [],
                                                    { hour: '2-digit', minute: '2-digit' },
                                                );
                                                const otherName = threadName || 'User';
                                                const myName =
                                                    myProfile?.username && !myProfile.username.startsWith('0x')
                                                        ? myProfile.username
                                                        : address
                                                          ? `User ${address.slice(-4).toUpperCase()}`
                                                          : 'Guest';
                                                return (
                                                    <TacticalMessageBubble
                                                        key={msg.id}
                                                        isMine={isMe}
                                                        sender={isMe ? myName : otherName}
                                                        meta={
                                                            msg.send_status === 'sending'
                                                                ? 'Sending…'
                                                                : timeString
                                                        }
                                                        content={msg.content}
                                                        sending={msg.send_status === 'sending'}
                                                        failed={msg.send_status === 'failed'}
                                                        failedError={msg.send_error}
                                                        onRetry={
                                                            isMe ? () => void retrySend(msg) : undefined
                                                        }
                                                        avatar={
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    onOpenProfile?.(
                                                                        isMe ? address || '' : selectedChatId!,
                                                                    )
                                                                }
                                                                aria-label={
                                                                    isMe
                                                                        ? 'Open your profile'
                                                                        : `Open ${otherName} profile`
                                                                }
                                                                className="shrink-0 rounded-full hover:scale-105 transition-transform"
                                                            >
                                                                <PilotAvatar
                                                                    avatarUrl={
                                                                        isMe ? myProfile?.avatar_url : threadAvatar
                                                                    }
                                                                    name={isMe ? myName : otherName}
                                                                    size="xs"
                                                                />
                                                            </button>
                                                        }
                                                    />
                                                );
                                            })}
                                        </div>

                                        <TacticalChatComposer
                                            className="mt-3"
                                            value={inputValue}
                                            emotes={inputEmotes}
                                            emojiOpen={emojiOpen}
                                            onValueChange={(next) => {
                                                setInputValue(next);
                                                setTyping(next.trim().length > 0);
                                            }}
                                            onEmotesChange={setInputEmotes}
                                            onEmojiToggle={() => setEmojiOpen((value) => !value)}
                                            onEmojiClose={() => setEmojiOpen(false)}
                                            onSend={() => void handleSendMessage()}
                                            placeholder="Transmit encrypted message..."
                                            ariaLabel="Message"
                                            maxLength={500}
                                            maxEncodedLength={500}
                                            cooldown={cooldownTime}
                                            showCounter
                                        />
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
