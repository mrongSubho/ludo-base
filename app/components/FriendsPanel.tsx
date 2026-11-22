'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { PanelTabs, TabCount } from './PanelTabs';
import { ChatIcon, SquadLinkIcon } from './icons';
import { GamePanelShell } from './GamePanelShell';
import { HudSectionLabel } from './HudPrimitives';
import { PilotAvatar } from './PilotAvatar';
import { shortHex } from '@/lib/chips';
import { useGameData } from '@/hooks/GameDataContext';
import { useAppSession } from '@/hooks/useAppSession';
import { ThinkingOrb } from './ThinkingOrb';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { Chip } from './Chip';
import { useToast } from './Toast';

interface FriendsPanelProps {
    onClose: () => void;
    onDM?: (friendId: string) => void;
    onOpenProfile?: (address: string) => void;
    onSpectate?: (roomCode: string) => void;
}

type MainTab = 'social' | 'global' | 'requests';
type RequestTab = 'incoming' | 'sent';

interface Friend {
    wallet_address: string;
    username: string;
    avatar_url: string | null;
    displayName: string;
    status: 'Online' | 'In Match' | 'Offline';
    last_played_at?: string | null;
    current_room_code?: string | null;
}

interface Request {
    id: string;
    wallet_address: string;
    name: string;
    avatar: string | null;
    time: string;
}

interface PokeRecord {
    id?: string;
    sender_id: string;
}

interface DirectoryRowInput {
    wallet_address: string;
    username?: string | null;
    avatar_url?: string | null;
    status?: 'Online' | 'In Match' | 'Offline';
    last_played_at?: string | null;
    current_room_code?: string | null;
}

const SpectateIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const PokeIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
        <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
);

const AcceptIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const RejectIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const SearchIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0 text-ink-faint">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
);

const STATUS_BEAM: Record<Friend['status'], string> = {
    Online: 'bg-positive',
    'In Match': 'bg-warn',
    Offline: 'bg-line-strong',
};

const STATUS_TEXT: Record<Friend['status'], string> = {
    Online: 'text-positive',
    'In Match': 'text-warn',
    Offline: 'text-ink-faint',
};

const STATUS_DOT: Record<Friend['status'], string> = {
    Online: 'hud-status-breath bg-positive',
    'In Match': 'hud-status-breath bg-warn',
    Offline: 'bg-ink-faint',
};

const AvatarWithPresence = ({
    url,
    name,
    status,
}: {
    url?: string | null;
    name: string;
    status?: Friend['status'] | null;
}) => (
    <div className="relative shrink-0">
        <PilotAvatar avatarUrl={url} name={name} size="sm" />
        {status && (
            <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-panel ${STATUS_DOT[status]}`}
            />
        )}
    </div>
);

const ActionIconBtn = ({
    onClick,
    title,
    label,
    tone,
    children,
    disabled = false,
}: {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    title: string;
    label: string;
    tone: 'spectate' | 'accept' | 'reject';
    children: React.ReactNode;
    disabled?: boolean;
}) => {
    const tones: Record<typeof tone, string> = {
        spectate: 'bg-warn/15 text-warn border-warn/40 hover:bg-warn hover:text-accent-ink',
        accept: 'bg-positive/15 text-positive border-positive/35 hover:bg-positive hover:text-accent-ink',
        reject: 'bg-negative/10 text-negative border-negative/30 hover:bg-negative hover:text-accent-ink',
    };
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onClick(e);
            }}
            disabled={disabled}
            title={title}
            aria-label={label}
            className={`w-8 h-8 rounded-full border inline-flex items-center justify-center shrink-0 transition-all active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed ${tones[tone]}`}
        >
            {children}
        </button>
    );
};

export default function FriendsPanel({ onClose, onDM, onOpenProfile, onSpectate }: FriendsPanelProps) {
    const { ensureAppSession, peekAppSession, sessionId } = useAppSession();
    const { address: connectedAddress, isGuest } = useCurrentUser();
    const { guard } = useGuestWall();
    const toast = useToast();

    const [activeMainTab, setActiveMainTab] = useState<MainTab>('social');
    const [activeRequestTab, setActiveRequestTab] = useState<RequestTab>('incoming');
    const [searchQuery, setSearchQuery] = useState('');
    const { friends: globalFriends } = useGameData();
    const [directoryFriends, setDirectoryFriends] = useState<DirectoryRowInput[]>([]);
    const [acceptedDirectoryWallets, setAcceptedDirectoryWallets] = useState<string[]>([]);
    const [onchainFriends, setOnchainFriends] = useState<Friend[]>([]);
    const [pendingIncoming, setPendingIncoming] = useState<Request[]>([]);
    const [pendingOutgoing, setPendingOutgoing] = useState<Request[]>([]);
    const [incomingPokes, setIncomingPokes] = useState<PokeRecord[]>([]);
    const [pokingId, setPokingId] = useState<string | null>(null);
    const [pokedToday, setPokedToday] = useState<string[]>([]);
    const [addingWallet, setAddingWallet] = useState<string | null>(null);
    const [justSent, setJustSent] = useState<string[]>([]);
    const [onlineOnly, setOnlineOnly] = useState(false);
    const [activeOnly, setActiveOnly] = useState(false);

    const toFriend = React.useCallback((f: DirectoryRowInput): Friend => {
        let currentStatus: Friend['status'] = f.status || 'Offline';
        if (currentStatus === 'Online' && f.last_played_at) {
            if (Date.now() - new Date(f.last_played_at).getTime() > 5 * 60 * 1000) {
                currentStatus = 'Offline';
            }
        }
        return {
            wallet_address: f.wallet_address,
            username: f.username || '',
            avatar_url: f.avatar_url || null,
            last_played_at: f.last_played_at,
            current_room_code: f.current_room_code,
            displayName:
                f.username && !f.username.startsWith('0x')
                    ? f.username
                    : `User ${f.wallet_address.slice(-4).toUpperCase()}`,
            status: currentStatus,
        };
    }, []);

    // Merge directory players + Farcaster follows for Global discovery, deduped by wallet.
    const discoveryDirectory: Friend[] = React.useMemo(() => {
        const base = (directoryFriends.length > 0 ? directoryFriends : globalFriends.gameFriends) as DirectoryRowInput[];
        const extra = (globalFriends.onchainFriends || []) as DirectoryRowInput[];
        const seen = new Set<string>();
        const out: Friend[] = [];
        for (const raw of [...base, ...extra]) {
            const low = raw?.wallet_address?.toLowerCase();
            if (!low || seen.has(low)) continue;
            seen.add(low);
            out.push(toFriend(raw));
        }
        return out;
    }, [directoryFriends, globalFriends.gameFriends, globalFriends.onchainFriends, toFriend]);

    const acceptedFriendWallets = React.useMemo(() => {
        const set = new Set<string>();
        onchainFriends.forEach((f) => set.add(f.wallet_address.toLowerCase()));
        acceptedDirectoryWallets.forEach((w) => set.add(w.toLowerCase()));
        return set;
    }, [onchainFriends, acceptedDirectoryWallets]);

    const sortFriends = (list: Friend[]) =>
        [...list].sort((a, b) => {
            const rank = (f: Friend) => (f.status === 'In Match' ? 0 : f.status === 'Online' ? 1 : 2);
            const lastActive = (f: Friend) => (f.last_played_at ? new Date(f.last_played_at).getTime() : 0);
            return rank(a) - rank(b) || lastActive(b) - lastActive(a);
        });

    const isLive = (f: Friend) => f.status === 'Online' || f.status === 'In Match';
    const isActive30 = (f: Friend) => {
        if (isLive(f)) return true;
        if (!f.last_played_at) return false;
        return Date.now() - new Date(f.last_played_at).getTime() <= 30 * 86400000;
    };

    const q = searchQuery.trim().toLowerCase();
    const matches = (name: string, wallet: string) =>
        !q || name.toLowerCase().includes(q) || wallet.toLowerCase().includes(q);

    const onlineCount = onchainFriends.filter(isLive).length;
    const visibleSocial = sortFriends(
        onchainFriends.filter((f) => {
            if (onlineOnly && !isLive(f)) return false;
            if (activeOnly && !isActive30(f)) return false;
            return matches(f.displayName, f.wallet_address);
        }),
    );
    const selfLower = connectedAddress?.toLowerCase();
    const visibleGlobal = discoveryDirectory.filter((f) => {
        const low = f.wallet_address.toLowerCase();
        if (selfLower && low === selfLower) return false;
        if (acceptedFriendWallets.has(low)) return false;
        return matches(f.displayName, f.wallet_address);
    });
    const visibleIncoming = pendingIncoming.filter((r) => matches(r.name, r.wallet_address));
    const visibleOutgoing = pendingOutgoing.filter((r) => matches(r.name, r.wallet_address));

    const fetchPokes = React.useCallback(async () => {
        if (!connectedAddress) return;
        try {
            const sid = sessionId || peekAppSession();
            if (!sid) return;
            const res = await fetch(`/api/social/poke?wallet=${encodeURIComponent(connectedAddress)}`, {
                headers: {
                    Authorization: `Bearer ${sid}`,
                    'x-session-id': sid,
                },
            });
            if (res.ok) {
                const data = await res.json();
                setIncomingPokes(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Fetch pokes error:', err);
        }
    }, [connectedAddress, sessionId, peekAppSession]);

    const fetchFriends = React.useCallback(async () => {
        if (!connectedAddress) return;
        try {
            const currentAddrLower = connectedAddress.toLowerCase();
            const sid = sessionId || peekAppSession();
            if (!sid) return;
            const response = await fetch(`/api/friendships?walletAddress=${encodeURIComponent(currentAddrLower)}`, {
                headers: {
                    Authorization: `Bearer ${sid}`,
                    'x-session-id': sid,
                },
            });
            if (!response.ok) throw new Error(`Friendships API failed: ${response.status}`);
            const friendshipData = await response.json();
            const data = friendshipData.accepted || [];

            if (Array.isArray(data)) {
                const formatted: Friend[] = data.map((item: { user_address: string; requester: DirectoryRowInput; receiver: DirectoryRowInput }) => {
                    const isRequester = item.user_address.toLowerCase() === currentAddrLower;
                    return toFriend(isRequester ? item.receiver : item.requester);
                });

                setOnchainFriends(formatted);
            }

            const requestsData = [...(friendshipData.incoming || []), ...(friendshipData.outgoing || [])];
            const incoming: Request[] = [];
            const outgoing: Request[] = [];
            requestsData.forEach((req: { id: string; created_at: string; friend_address: string; requester?: DirectoryRowInput; receiver?: DirectoryRowInput }) => {
                const date = new Date(req.created_at);
                const timeStr = new Intl.DateTimeFormat('default', { month: 'short', day: 'numeric' }).format(date);

                if (req.friend_address.toLowerCase() === currentAddrLower) {
                    const p = req.requester;
                    if (!p?.wallet_address) return;
                    incoming.push({
                        id: req.id,
                        wallet_address: p.wallet_address,
                        name:
                            p.username && !p.username.startsWith('0x')
                                ? p.username
                                : `User ${p.wallet_address.slice(-4).toUpperCase()}`,
                        avatar: p.avatar_url || null,
                        time: timeStr,
                    });
                } else {
                    const p = req.receiver;
                    if (!p?.wallet_address) return;
                    outgoing.push({
                        id: req.id,
                        wallet_address: p.wallet_address,
                        name:
                            p.username && !p.username.startsWith('0x')
                                ? p.username
                                : `User ${p.wallet_address.slice(-4).toUpperCase()}`,
                        avatar: p.avatar_url || null,
                        time: timeStr,
                    });
                }
            });
            setPendingIncoming(incoming);
            setPendingOutgoing(outgoing);

            try {
                const friendsRes = await fetch(
                    `/api/friends?wallet=${encodeURIComponent(currentAddrLower)}&walletAddress=${encodeURIComponent(currentAddrLower)}`,
                    {
                        headers: {
                            Authorization: `Bearer ${sid}`,
                            'x-session-id': sid,
                        },
                    },
                );
                if (friendsRes.ok) {
                    const fData = await friendsRes.json();
                    if (Array.isArray(fData.gameFriends) && fData.gameFriends.length > 0) {
                        setDirectoryFriends(fData.gameFriends);
                    }
                    if (Array.isArray(fData.acceptedFriends)) {
                        setAcceptedDirectoryWallets(fData.acceptedFriends);
                    }
                }
            } catch (dErr) {
                console.warn('Directory refresh error:', dErr);
            }

            await fetchPokes();
        } catch (err) {
            console.error('Error fetching friends:', err);
        }
    }, [connectedAddress, fetchPokes, sessionId, peekAppSession, toFriend]);

    useEffect(() => {
        const initialAddr = connectedAddress || '0x0000000000000000000000000000000000000001';
        fetch(`/api/friends?wallet=${encodeURIComponent(initialAddr)}&walletAddress=${encodeURIComponent(initialAddr)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (Array.isArray(data?.gameFriends) && data.gameFriends.length > 0) {
                    setDirectoryFriends(data.gameFriends);
                }
            })
            .catch(() => {});

        void fetchFriends();
        const friendshipRefresh = window.setInterval(() => void fetchFriends(), 15000);

        const channel = supabase
            .channel('players-status-sync')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players' }, (payload) => {
                const updated = payload.new as { wallet_address: string; status: Friend['status']; current_room_code?: string | null };
                setOnchainFriends((prev) =>
                    prev.map((f) =>
                        f.wallet_address.toLowerCase() === updated.wallet_address.toLowerCase()
                            ? {
                                  ...f,
                                  status: updated.status,
                                  current_room_code: updated.current_room_code ?? f.current_room_code,
                              }
                            : f,
                    ),
                );
            })
            .subscribe();

        const pokeChannel = supabase
            .channel('pokes-sync')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'pokes', filter: `receiver_id=eq.${connectedAddress?.toLowerCase()}` },
                () => {
                    void fetchPokes();
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            supabase.removeChannel(pokeChannel);
            window.clearInterval(friendshipRefresh);
        };
    }, [connectedAddress, fetchFriends, fetchPokes, sessionId]);

    const handleAcceptRequest = async (id: string) => {
        try {
            const sid = await ensureAppSession({ context: 'social' });
            const response =
                sid &&
                (await fetch('/api/friendships', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletAddress: connectedAddress, sessionId: sid, action: 'accept', friendshipId: id }),
                }));
            if (response && response.ok) {
                setPendingIncoming((prev) => prev.filter((r) => r.id !== id));
                void fetchFriends();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleRejectCancelRequest = async (id: string, isIncoming: boolean) => {
        try {
            const sid = await ensureAppSession({ context: 'social' });
            const response =
                sid &&
                (await fetch('/api/friendships', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletAddress: connectedAddress, sessionId: sid, action: 'remove', friendshipId: id }),
                }));
            if (response && response.ok) {
                if (isIncoming) setPendingIncoming((prev) => prev.filter((r) => r.id !== id));
                else setPendingOutgoing((prev) => prev.filter((r) => r.id !== id));
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handlePoke = async (friendAddress: string) => {
        if (!connectedAddress || pokingId) return;
        if (!guard('poke')) return;
        const target = friendAddress.toLowerCase();
        setPokingId(target);
        try {
            const sid = await ensureAppSession({ context: 'social' });
            if (!sid) {
                toast('Activate your session to poke friends', 'error');
                return;
            }
            const response = await fetch('/api/social/poke', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sid}`,
                    'x-session-id': sid,
                },
                body: JSON.stringify({
                    sender: connectedAddress.toLowerCase(),
                    receiver: target,
                    walletAddress: connectedAddress.toLowerCase(),
                    sessionId: sid,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setPokedToday((prev) => (prev.includes(target) ? prev : [...prev, target]));
                toast(
                    data?.type === 'poke_back'
                        ? data?.reward
                            ? `Poked back! +${data.reward} CHIPS voucher`
                            : 'Poked back!'
                        : 'Poke sent!',
                    'success',
                );
                await fetchPokes();
                window.dispatchEvent(new CustomEvent('mission-update'));
                window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
            } else {
                const msg = String(data?.error || 'Failed to poke');
                if (/already/i.test(msg)) {
                    setPokedToday((prev) => (prev.includes(target) ? prev : [...prev, target]));
                }
                toast(msg, 'error');
            }
        } catch (err) {
            toast(err instanceof Error && err.message ? err.message : 'Failed to poke', 'error');
        } finally {
            setPokingId(null);
        }
    };

    const handleAddFriend = async (wallet: string) => {
        if (!connectedAddress || addingWallet) return;
        if (!guard('friend-add')) return;
        const target = wallet.toLowerCase();
        setAddingWallet(target);
        try {
            const sid = await ensureAppSession({ context: 'social' });
            if (!sid) {
                toast('Activate your session to add friends', 'error');
                return;
            }
            const response = await fetch('/api/friendships', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sid}`,
                    'x-session-id': sid,
                },
                body: JSON.stringify({ walletAddress: connectedAddress, sessionId: sid, action: 'request', target }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                if (data.status === 'accepted') {
                    toast('Friend added!', 'success');
                } else {
                    setJustSent((prev) => (prev.includes(target) ? prev : [...prev, target]));
                    toast('Friend request sent!', 'success');
                }
                void fetchFriends();
            } else {
                toast(data?.error || 'Failed to send request', 'error');
            }
        } catch (err: unknown) {
            toast(err instanceof Error ? err.message : 'Failed to send request', 'error');
        } finally {
            setAddingWallet(null);
        }
    };

    const renderFriendList = (friends: Friend[]) => {
        if (friends.length === 0) {
            return (
                <EmptyState
                    title="No friends here yet"
                    body="Add players from Global and they will show up here."
                />
            );
        }

        return (
            <div className="flex flex-col gap-2 pb-2">
                {friends.map((friend) => {
                    const low = friend.wallet_address.toLowerCase();
                    const hasIncomingPoke = incomingPokes.some((p) => p.sender_id.toLowerCase() === low);
                    const isPoking = pokingId === low;
                    const alreadyPoked = pokedToday.includes(low);
                    const canSpectate = friend.status === 'In Match' && Boolean(friend.current_room_code);

                    return (
                        <div
                            key={friend.wallet_address}
                            className={`group relative rounded-2xl bg-surface-recessed border overflow-hidden transition-colors ${
                                hasIncomingPoke
                                    ? 'border-accent/55 shadow-[0_0_16px_color-mix(in_srgb,var(--accent)_14%,transparent)]'
                                    : 'border-line-soft hover:border-accent/40 hover:bg-surface-hover'
                            }`}
                        >
                            <div
                                className={`absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full ${STATUS_BEAM[friend.status]}`}
                            />
                            <div className="flex items-center gap-2.5 p-3 pl-3.5">
                                <button
                                    type="button"
                                    onClick={() => onOpenProfile?.(friend.wallet_address)}
                                    aria-label={`Open ${friend.displayName} profile`}
                                    className="flex-1 min-w-0 flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-accent rounded-xl"
                                >
                                    <AvatarWithPresence
                                        url={friend.avatar_url}
                                        name={friend.displayName}
                                        status={friend.status}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-ink-strong font-bold truncate text-ludo-md leading-tight group-hover:text-accent transition-colors">
                                                {friend.displayName}
                                            </span>
                                            {hasIncomingPoke && (
                                                <span className="px-1.5 py-0.5 rounded-full bg-accent-soft border border-accent/35 text-accent text-ludo-xs font-mono font-bold uppercase tracking-wider shrink-0">
                                                    Poked you
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                            <span
                                                className={`text-ludo-xs font-mono font-bold uppercase tracking-[0.14em] shrink-0 ${STATUS_TEXT[friend.status]}`}
                                            >
                                                {friend.status}
                                            </span>
                                            <span className="text-ink-faint text-ludo-xs" aria-hidden="true">·</span>
                                            <span className="text-ludo-xs font-mono text-ink-faint truncate">
                                                {shortHex(friend.wallet_address)}
                                            </span>
                                        </div>
                                    </div>
                                </button>

                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => void handlePoke(friend.wallet_address)}
                                        disabled={isPoking || alreadyPoked}
                                        title={
                                            hasIncomingPoke
                                                ? 'Poke Back for voucher'
                                                : alreadyPoked
                                                  ? 'Already poked today'
                                                  : 'Poke friend'
                                        }
                                        aria-label={hasIncomingPoke ? 'Poke back' : 'Poke friend'}
                                        className={`h-8 px-2.5 rounded-full border font-mono text-ludo-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-all active:scale-95 shrink-0 ${
                                            hasIncomingPoke
                                                ? 'bg-accent text-accent-ink border-accent shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_35%,transparent)] hover:brightness-110'
                                                : alreadyPoked
                                                  ? 'bg-surface-panel text-ink-faint border-line-soft opacity-60 cursor-default'
                                                  : 'bg-accent-soft text-accent border-accent/40 hover:bg-accent hover:text-accent-ink'
                                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        {isPoking ? (
                                            <ThinkingOrb state="working" size={20} />
                                        ) : (
                                            <PokeIcon />
                                        )}
                                        <span>
                                            {hasIncomingPoke ? 'Back' : alreadyPoked ? 'Poked' : 'Poke'}
                                        </span>
                                    </button>

                                    {canSpectate && friend.current_room_code && (
                                        <ActionIconBtn
                                            onClick={() => onSpectate?.(friend.current_room_code!)}
                                            title="Spectate Match"
                                            label="Spectate match"
                                            tone="spectate"
                                        >
                                            <SpectateIcon />
                                        </ActionIconBtn>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => guard('dm', () => onDM?.(friend.wallet_address))}
                                        title="Direct Message"
                                        aria-label={`Message ${friend.displayName}`}
                                        className="h-8 px-2.5 rounded-full border bg-surface-panel text-accent border-accent/40 hover:bg-accent hover:text-accent-ink font-mono text-ludo-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-all active:scale-95 shrink-0"
                                    >
                                        <ChatIcon className="w-3.5 h-3.5" active />
                                        <span>DM</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderDirectoryList = (players: Friend[]) => {
        if (players.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl border border-line-soft bg-surface-recessed">
                    <div className="w-12 h-12 rounded-2xl bg-surface-panel border border-line-soft flex items-center justify-center mb-3 text-ink-faint">
                        <SearchIcon />
                    </div>
                    <h3 className="text-ink-strong font-extrabold text-ludo-md mb-1">No new pilots found</h3>
                    <p className="text-ink-faint text-ludo-xs max-w-[220px]">
                        Already-added friends stay in Social. Try a different search filter.
                    </p>
                </div>
            );
        }

        const incomingByWallet = new Map(
            pendingIncoming.map((r) => [r.wallet_address.toLowerCase(), r.id] as const),
        );
        const sentSet = new Set([
            ...pendingOutgoing.map((r) => r.wallet_address.toLowerCase()),
            ...justSent,
        ]);

        return (
            <div className="flex flex-col gap-2 pb-2">
                {players.map((p) => {
                    const low = p.wallet_address.toLowerCase();
                    const incomingId = incomingByWallet.get(low);
                    const pending = sentSet.has(low);
                    const isAdding = addingWallet === low;

                    return (
                        <div
                            key={p.wallet_address}
                            className="group relative rounded-2xl bg-surface-recessed border border-line-soft overflow-hidden transition-colors hover:border-accent/40 hover:bg-surface-hover"
                        >
                            <div
                                className={`absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full ${STATUS_BEAM[p.status]}`}
                            />
                            <div className="flex items-center gap-2.5 p-3 pl-3.5">
                                <button
                                    type="button"
                                    onClick={() => onOpenProfile?.(p.wallet_address)}
                                    aria-label={`Open ${p.displayName} profile`}
                                    className="flex-1 min-w-0 flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-accent rounded-xl"
                                >
                                    <AvatarWithPresence
                                        url={p.avatar_url}
                                        name={p.displayName}
                                        status={p.status}
                                    />
                                    <div className="flex-1 flex flex-col min-w-0">
                                        <span className="text-ink-strong font-bold text-ludo-md truncate leading-tight group-hover:text-accent transition-colors">
                                            {p.displayName}
                                        </span>
                                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                            <span
                                                className={`text-ludo-xs font-mono font-bold uppercase tracking-[0.14em] shrink-0 ${STATUS_TEXT[p.status]}`}
                                            >
                                                {p.status}
                                            </span>
                                            <span className="text-ink-faint text-ludo-xs" aria-hidden="true">·</span>
                                            <span className="text-ludo-xs font-mono text-ink-faint truncate">
                                                {shortHex(p.wallet_address)}
                                            </span>
                                        </div>
                                    </div>
                                </button>

                                {incomingId ? (
                                    <button
                                        type="button"
                                        onClick={() => void handleAcceptRequest(incomingId)}
                                        className="h-8 px-3 rounded-full bg-accent text-accent-ink font-mono text-ludo-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 hover:brightness-110 active:scale-95 transition-all shrink-0 shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_30%,transparent)]"
                                    >
                                        <AcceptIcon />
                                        <span>Accept</span>
                                    </button>
                                ) : pending ? (
                                    <span className="h-8 px-3 rounded-full bg-surface-panel text-ink-faint text-ludo-xs font-mono font-bold uppercase tracking-wider border border-line-soft inline-flex items-center shrink-0">
                                        Pending
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={isAdding}
                                        onClick={() => void handleAddFriend(p.wallet_address)}
                                        className="h-8 px-3 rounded-full bg-accent-soft text-accent border border-accent/45 hover:bg-accent hover:text-accent-ink font-mono text-ludo-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 active:scale-95 transition-all shrink-0 disabled:opacity-50"
                                    >
                                        {isAdding ? (
                                            <ThinkingOrb state="working" size={20} />
                                        ) : (
                                            <span>+ Add</span>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderRequestList = (requests: Request[], isIncoming: boolean) => {
        if (requests.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl border border-line-soft bg-surface-recessed">
                    <div className="w-12 h-12 rounded-2xl bg-surface-panel border border-line-soft flex items-center justify-center mb-3 text-ink-faint">
                        <SquadLinkIcon className="w-6 h-6" />
                    </div>
                    <h3 className="text-ink-strong font-extrabold text-ludo-md mb-1">No pending requests</h3>
                    <p className="text-ink-faint text-ludo-xs max-w-[220px]">
                        {isIncoming ? 'Nobody is waiting on you. Yet.' : 'Invites you send will wait here.'}
                    </p>
                </div>
            );
        }

        return (
            <div className="flex flex-col gap-2 pb-2">
                {requests.map((req) => (
                    <div
                        key={req.id}
                        className="group relative rounded-2xl bg-surface-recessed border border-line-soft overflow-hidden transition-colors hover:border-accent/40 hover:bg-surface-hover"
                    >
                        <div className="flex items-center gap-2.5 p-3">
                            <button
                                type="button"
                                onClick={() => onOpenProfile?.(req.wallet_address)}
                                aria-label={`Open ${req.name} profile`}
                                className="flex-1 min-w-0 flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-accent rounded-xl"
                            >
                                <AvatarWithPresence url={req.avatar} name={req.name} />
                                <div className="flex-1 flex flex-col min-w-0">
                                    <span className="text-ink-strong font-bold text-ludo-md truncate leading-tight group-hover:text-accent transition-colors">
                                        {req.name}
                                    </span>
                                    <span className="text-ludo-xs text-ink-faint font-mono font-bold uppercase tracking-widest mt-0.5">
                                        {req.time} · {shortHex(req.wallet_address)}
                                    </span>
                                </div>
                            </button>
                            {isIncoming ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <ActionIconBtn
                                        onClick={() => void handleAcceptRequest(req.id)}
                                        title="Accept"
                                        label="Accept request"
                                        tone="accept"
                                    >
                                        <AcceptIcon />
                                    </ActionIconBtn>
                                    <ActionIconBtn
                                        onClick={() => void handleRejectCancelRequest(req.id, true)}
                                        title="Decline"
                                        label="Decline request"
                                        tone="reject"
                                    >
                                        <RejectIcon />
                                    </ActionIconBtn>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-ludo-xs text-ink-faint font-mono font-bold uppercase tracking-widest pr-1">
                                        Pending
                                    </span>
                                    <ActionIconBtn
                                        onClick={() => void handleRejectCancelRequest(req.id, false)}
                                        title="Cancel"
                                        label="Cancel request"
                                        tone="reject"
                                    >
                                        <RejectIcon />
                                    </ActionIconBtn>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <GamePanelShell
            scopeClass="ludo-friends-scope"
            kicker="// SQUAD LINK"
            hideOrbs
            onClose={onClose}
            title={
                <span className="flex items-center gap-2">
                    <span className="hud-chamfer-sm w-7 h-7 rounded-xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                        <SquadLinkIcon className="w-4 h-4" active />
                    </span>
                    <span>Friends</span>
                </span>
            }
            subtitle={
                <span className="flex items-center gap-2 px-0.5 text-ludo-xs font-mono uppercase tracking-[0.14em]">
                    <span className="inline-flex items-center gap-1.5">
                        <span
                            className={`w-1.5 h-1.5 rounded-full ${
                                onlineCount > 0 ? 'hud-status-breath bg-positive' : 'bg-ink-faint'
                            }`}
                        />
                        <span className="font-bold text-ink-muted tabular-nums">
                            {onlineCount} online
                        </span>
                    </span>
                    {pendingIncoming.length > 0 && (
                        <>
                            <span className="text-ink-faint" aria-hidden="true">·</span>
                            <span className="px-2 py-0.5 rounded-full bg-negative/15 border border-negative/35 text-negative font-bold tabular-nums">
                                {pendingIncoming.length} request{pendingIncoming.length === 1 ? '' : 's'}
                            </span>
                        </>
                    )}
                </span>
            }
        >
            {/* Tabs + Slim Search */}
            <div className="flex flex-col gap-2">
                <PanelTabs
                    cols={3}
                    value={activeMainTab}
                    onPick={setActiveMainTab}
                    options={[
                        { value: 'social', label: 'Social' },
                        { value: 'global', label: 'Global' },
                        {
                            value: 'requests',
                            label: 'Requests',
                            badge:
                                pendingIncoming.length > 0 ? (
                                    <TabCount active={activeMainTab === 'requests'}>
                                        {pendingIncoming.length}
                                    </TabCount>
                                ) : undefined,
                        },
                    ]}
                />

                <div className="search-shell flex items-center gap-2 bg-surface-recessed border border-line-soft rounded-xl px-2.5 h-8 focus-within:border-accent transition-colors overflow-hidden">
                    <SearchIcon />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search pilots or 0x address…"
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
                            <RejectIcon />
                        </button>
                    )}
                </div>
            </div>

            {activeMainTab === 'social' && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <Chip size="sm" className="font-mono uppercase tracking-[0.16em]">
                            {visibleSocial.length} friends
                        </Chip>
                        <div className="flex-1 h-px bg-line-soft" />
                        <div className="flex items-center gap-1.5">
                            <Chip
                                type="filter"
                                size="sm"
                                active={onlineOnly}
                                onClick={() => setOnlineOnly((v) => !v)}
                                className="uppercase tracking-widest"
                                icon={
                                    <span
                                        className={`w-1.5 h-1.5 rounded-full ${
                                            onlineOnly ? 'bg-positive animate-pulse' : 'bg-ink-faint'
                                        }`}
                                    />
                                }
                            >
                                Online
                            </Chip>
                            <Chip
                                type="filter"
                                size="sm"
                                active={activeOnly}
                                onClick={() => setActiveOnly((v) => !v)}
                                className="uppercase tracking-widest"
                            >
                                Active
                            </Chip>
                        </div>
                    </div>

                    {!sessionId && !isGuest && connectedAddress && (
                        <div className="p-3 rounded-2xl bg-accent-soft border border-accent/35 flex items-center justify-between gap-3">
                            <div className="flex flex-col min-w-0">
                                <span className="text-ink-strong font-bold text-ludo-sm truncate">
                                    Session Inactive
                                </span>
                                <span className="text-ink-muted text-ludo-xs truncate">
                                    Activate session to sync your accepted friends
                                </span>
                            </div>
                            <Button
                                size="sm"
                                variant="primary"
                                onClick={async () => {
                                    await ensureAppSession({ context: 'social' });
                                    void fetchFriends();
                                }}
                                className="uppercase tracking-widest shrink-0"
                            >
                                Activate
                            </Button>
                        </div>
                    )}

                    {renderFriendList(visibleSocial)}
                </div>
            )}

            {activeMainTab === 'global' && (
                <div className="flex flex-col gap-2">
                    <HudSectionLabel>{visibleGlobal.length} players</HudSectionLabel>
                    {renderDirectoryList(visibleGlobal)}
                </div>
            )}

            {activeMainTab === 'requests' && (
                <div className="flex flex-col gap-2">
                    <PanelTabs
                        value={activeRequestTab}
                        onPick={setActiveRequestTab}
                        options={[
                            {
                                value: 'incoming',
                                label: 'Incoming',
                                badge: (
                                    <TabCount active={activeRequestTab === 'incoming'}>
                                        {pendingIncoming.length}
                                    </TabCount>
                                ),
                            },
                            {
                                value: 'sent',
                                label: 'Sent',
                                badge: (
                                    <TabCount active={activeRequestTab === 'sent'}>
                                        {pendingOutgoing.length}
                                    </TabCount>
                                ),
                            },
                        ]}
                    />

                    {!sessionId && !isGuest && connectedAddress && (
                        <div className="p-3 rounded-2xl bg-accent-soft border border-accent/35 flex items-center justify-between gap-3">
                            <div className="flex flex-col min-w-0">
                                <span className="text-ink-strong font-bold text-ludo-sm truncate">
                                    Session Inactive
                                </span>
                                <span className="text-ink-muted text-ludo-xs truncate">
                                    Activate session to view and accept requests
                                </span>
                            </div>
                            <Button
                                size="sm"
                                variant="primary"
                                onClick={async () => {
                                    await ensureAppSession({ context: 'social' });
                                    void fetchFriends();
                                }}
                                className="uppercase tracking-widest shrink-0"
                            >
                                Activate
                            </Button>
                        </div>
                    )}

                    {activeRequestTab === 'incoming'
                        ? renderRequestList(visibleIncoming, true)
                        : renderRequestList(visibleOutgoing, false)}
                </div>
            )}
        </GamePanelShell>
    );
}
