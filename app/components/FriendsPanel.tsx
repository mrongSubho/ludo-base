import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { HiOutlineAtSymbol } from "react-icons/hi";
import { useGameData } from '@/hooks/GameDataContext';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as marketplace/settings/rankings: this panel always renders on the
// shared dark-glass sandwich shell, so content uses only white-ink +
// white-opacity surfaces + cyan/status accents. No font-family is set
// (inherits the active theme's display font). Spacing inside
// `.ludo-friends-scope` is re-asserted in globals.css (the global unlayered
// reset zeroes Tailwind spacing utilities).

interface FriendsPanelProps {
    onClose: () => void;
    onDM?: (friendId: string) => void;
    onOpenProfile?: (address: string) => void;
    onSpectate?: (roomCode: string) => void;
}

type MainTab = 'social' | 'global' | 'requests';
type RequestTab = 'incoming' | 'sent';

// Define the mock friend interfaces
interface Friend {
    wallet_address: string;
    username: string;
    avatar_url: string;
    displayName: string;
    status: 'Online' | 'In Match' | 'Offline';
    last_played_at?: string | null;
    current_room_code?: string | null;
}

interface Request {
    id: string;
    wallet_address: string;
    name: string;
    avatar: string;
    time: string;
}

const SpectateIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);


// SVG Icons
const DMIcon = () => (
    <HiOutlineAtSymbol className="w-4 h-4" />
);

const PokeIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
        <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
);

const AcceptIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
);

const RejectIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
);

const SearchIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0 text-white/35">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
);

const UsersTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
    </div>
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

const STATUS_BEAM: Record<Friend['status'], string> = {
    Online: 'bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]',
    'In Match': 'bg-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.9)]',
    Offline: 'bg-white/20',
};

const STATUS_TEXT: Record<Friend['status'], string> = {
    Online: 'text-green-400',
    'In Match': 'text-orange-400',
    Offline: 'text-white/40',
};

const Avatar = ({ url, name, box = 'w-11 h-11', ring = '', dot }: {
    url?: string | null; name: string; box?: string; ring?: string;
    dot?: 'Online' | 'In Match' | 'Offline' | null;
}) => (
    <div className={`${box} rounded-full overflow-hidden bg-cyan-900/50 shrink-0 relative ${ring}`}>
        {url ? (
            <img src={url} alt={name} className="w-full h-full object-cover" />
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

const IconBtn = ({ onClick, title, label, tone, children, disabled = false }: {
    onClick?: () => void; title: string; label: string;
    tone: 'ghost' | 'poke' | 'poke-back' | 'spectate' | 'dm' | 'accept' | 'reject';
    children: React.ReactNode; disabled?: boolean;
}) => {
    const tones: Record<string, string> = {
        ghost: 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white',
        poke: 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white',
        'poke-back': 'bg-yellow-500 text-black border-yellow-400 hover:bg-yellow-400 animate-pulse',
        spectate: 'bg-orange-500/15 text-orange-300 border-orange-500/40 hover:bg-orange-500 hover:text-white',
        dm: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25 hover:bg-cyan-600 hover:text-white',
        accept: 'bg-green-500/15 text-green-300 border-green-500/30 hover:bg-green-500 hover:text-white',
        reject: 'bg-red-500/10 text-red-400 border-red-500/25 hover:bg-red-500 hover:text-white',
    };
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            disabled={disabled}
            title={title}
            aria-label={label}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all border shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${tones[tone]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            {children}
        </button>
    );
};


export default function FriendsPanel({ onClose, onDM, onOpenProfile, onSpectate }: FriendsPanelProps) {
    const { profile, address: connectedAddress } = useCurrentUser();
    // Guests can browse the directory, but social writes hit the wall.
    const { guard } = useGuestWall();
    const userFid = (profile as any)?.fid;

    const [activeMainTab, setActiveMainTab] = useState<MainTab>('social');
    const [activeRequestTab, setActiveRequestTab] = useState<RequestTab>('incoming');
    const [searchQuery, setSearchQuery] = useState('');
    const { friends: globalFriends } = useGameData();

    // Use Context for game friends
    const gameFriends = globalFriends.gameFriends.map((f: any) => ({
        ...f,
        displayName: (f.username && !f.username.startsWith('0x')) ? f.username : "Guest " + f.wallet_address.slice(-6).toUpperCase(),
        status: f.status || 'Offline'
    }));

    const [onchainFriends, setOnchainFriends] = useState<Friend[]>([]);
    const [pendingIncoming, setPendingIncoming] = useState<Request[]>([]);
    const [pendingOutgoing, setPendingOutgoing] = useState<Request[]>([]);
    const [incomingPokes, setIncomingPokes] = useState<any[]>([]);
    const [pokingId, setPokingId] = useState<string | null>(null);
    const [justSent, setJustSent] = useState<string[]>([]);
    const [onlineOnly, setOnlineOnly] = useState(false);
    const [activeOnly, setActiveOnly] = useState(false);

    // Default order: in-match first, then online, then most recently active.
    // Friends with no activity timestamp sink to the bottom — never random.
    const sortFriends = (list: Friend[]) => [...list].sort((a, b) => {
        const rank = (f: Friend) => f.status === 'In Match' ? 0 : f.status === 'Online' ? 1 : 2;
        const lastActive = (f: Friend) => f.last_played_at ? new Date(f.last_played_at).getTime() : 0;
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
    const activeCount = onchainFriends.filter(isActive30).length;
    const visibleSocial = sortFriends(onchainFriends.filter(f => {
        if (onlineOnly && !isLive(f)) return false;
        if (activeOnly && !isActive30(f)) return false;
        return matches(f.displayName, f.wallet_address);
    }));
    const visibleGlobal = gameFriends.filter((f: any) => matches(f.displayName, f.wallet_address));
    const visibleIncoming = pendingIncoming.filter(r => matches(r.name, r.wallet_address));
    const visibleOutgoing = pendingOutgoing.filter(r => matches(r.name, r.wallet_address));

    const fetchPokes = React.useCallback(async () => {
        if (!connectedAddress) return;
        try {
            const res = await fetch(`/api/social/poke?wallet=${connectedAddress}`);
            if (res.ok) {
                const data = await res.json();
                setIncomingPokes(data);
            }
        } catch (err) {
            console.error('Fetch pokes error:', err);
        }
    }, [connectedAddress]);

    const fetchFriends = React.useCallback(async () => {
        if (!connectedAddress) return;
        try {
            // 2. Fetch live friendships from Supabase (Onchain Friends)
            const currentAddrLower = connectedAddress.toLowerCase();
            const { data, error } = await supabase
                .from('friendships')
                .select(`
                    status,
                    user_address,
                    friend_address,
                    requester:players!friendships_user_address_fkey(wallet_address, username, avatar_url, total_wins, status, last_played_at, current_room_code),
                    receiver:players!friendships_friend_address_fkey(wallet_address, username, avatar_url, total_wins, status, last_played_at, current_room_code)
                `)
                .eq('status', 'accepted')
                .or(`user_address.eq.${currentAddrLower},friend_address.eq.${currentAddrLower}`);

            if (error) throw error;

            if (data) {
                const formatted = data.map((item: any) => {
                    const isRequester = item.user_address.toLowerCase() === connectedAddress.toLowerCase();
                    const p = isRequester ? item.receiver : item.requester;
                    const displayName = (p.username && !p.username.startsWith('0x')) ? p.username : "Guest " + p.wallet_address.slice(-6).toUpperCase();

                    let currentStatus = p.status || 'Offline';
                    if (currentStatus === 'Online' && p.last_played_at) {
                        const now = new Date().getTime();
                        const lastSeen = new Date(p.last_played_at).getTime();
                        if (now - lastSeen > 5 * 60 * 1000) {
                            currentStatus = 'Offline';
                        }
                    }

                    return {
                        ...p,
                        displayName,
                        status: currentStatus
                    };
                });
                // Merge Supabase friends with Farcaster friends from Context
                setOnchainFriends(() => {
                    const fromContext = globalFriends.onchainFriends.map((f: any) => ({
                        ...f,
                        displayName: (f.username && !f.username.startsWith('0x')) ? f.username : "Guest " + f.wallet_address.slice(-6).toUpperCase(),
                        status: f.status || 'Offline'
                    }));

                    const merged = [...formatted];
                    fromContext.forEach((f) => {
                        if (!merged.some(m => m.wallet_address === f.wallet_address)) {
                            merged.push(f);
                        }
                    });

                    return merged;
                });
            }

            // 3. Fetch Pending Requests
            const { data: requestsData, error: reqError } = await supabase
                .from('friendships')
                .select(`
                    id,
                    status,
                    user_address,
                    friend_address,
                    created_at,
                    requester:players!friendships_user_address_fkey(wallet_address, username, avatar_url),
                    receiver:players!friendships_friend_address_fkey(wallet_address, username, avatar_url)
                `)
                .eq('status', 'pending')
                .or(`user_address.eq.${currentAddrLower},friend_address.eq.${currentAddrLower}`);

            if (reqError) throw reqError;

            if (requestsData) {
                const incoming: Request[] = [];
                const outgoing: Request[] = [];

                requestsData.forEach((req: any) => {
                    const date = new Date(req.created_at);
                    const timeStr = new Intl.DateTimeFormat('default', { month: 'short', day: 'numeric' }).format(date);

                    if (req.friend_address.toLowerCase() === currentAddrLower) {
                        // Incoming (Someone added us)
                        const p = req.requester;
                        incoming.push({
                            id: req.id,
                            wallet_address: p.wallet_address,
                            name: (p.username && !p.username.startsWith('0x')) ? p.username : "Guest " + p.wallet_address.slice(-6).toUpperCase(),
                            avatar: p.avatar_url || '1',
                            time: timeStr
                        });
                    } else {
                        // Outgoing (We added someone)
                        const p = req.receiver;
                        outgoing.push({
                            id: req.id,
                            wallet_address: p.wallet_address,
                            name: (p.username && !p.username.startsWith('0x')) ? p.username : "Guest " + p.wallet_address.slice(-6).toUpperCase(),
                            avatar: p.avatar_url || '1',
                            time: timeStr
                        });
                    }
                });

                setPendingIncoming(incoming);
                setPendingOutgoing(outgoing);
            }

            await fetchPokes();

        } catch (err) {
            console.error('Error fetching friends:', err);
        }
    }, [connectedAddress, userFid, fetchPokes]);

    useEffect(() => {
        fetchFriends();

        // 4. Real-time Status Updates
        const channel = supabase
            .channel('players-status-sync')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'players' },
                (payload) => {
                    const updatedPlayer = payload.new;
                    const updateList = (list: Friend[]) =>
                        list.map(f => f.wallet_address.toLowerCase() === updatedPlayer.wallet_address.toLowerCase()
                            ? {
                                ...f,
                                status: updatedPlayer.status,
                                current_room_code: (updatedPlayer as any).current_room_code ?? (f as any).current_room_code
                            }
                            : f
                        );

                    setOnchainFriends(prev => updateList(prev));
                }
            )
            .subscribe();

        // 5. Real-time Poke Updates
        const pokeChannel = supabase
            .channel('pokes-sync')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'pokes', filter: `receiver_id=eq.${connectedAddress?.toLowerCase()}` },
                () => {
                    fetchPokes();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            supabase.removeChannel(pokeChannel);
        };
    }, [connectedAddress, userFid, fetchFriends, fetchPokes]);

    const handleAcceptRequest = async (id: string) => {
        try {
            const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id);
            if (!error) {
                setPendingIncoming(prev => prev.filter(r => r.id !== id));
                // We could optimally refetch friends here, but the user will likely close the panel
                fetchFriends(); // quick refresh
            }
        } catch (err) { console.error(err); }
    };

    const handleRejectCancelRequest = async (id: string, isIncoming: boolean) => {
        try {
            const { error } = await supabase.from('friendships').delete().eq('id', id);
            if (!error) {
                if (isIncoming) setPendingIncoming(prev => prev.filter(r => r.id !== id));
                else setPendingOutgoing(prev => prev.filter(r => r.id !== id));
            }
        } catch (err) { console.error(err); }
    };

    const handlePoke = async (friendAddress: string) => {
        if (!connectedAddress || pokingId) return;
        if (!guard('poke')) return;
        setPokingId(friendAddress);
        try {
            const response = await fetch('/api/social/poke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: connectedAddress.toLowerCase(), receiver: friendAddress })
            });
            if (response.ok) {
                await fetchPokes();
                // Trigger mission update event if it was a poke-back
                window.dispatchEvent(new CustomEvent('mission-update'));
            } else {
                const err = await response.json();
                alert(err.error || 'Failed to poke');
            }
        } catch (err) {
            console.error('Poke error:', err);
        } finally {
            setPokingId(null);
        }
    };

    // Directory rows (GLOBAL tab): profile only + Add Friend. No poke/DM/spectate — those are friends-only.
    const handleAddFriend = async (wallet: string) => {
        if (!connectedAddress) return;
        if (!guard('friend-add')) return;
        const target = wallet.toLowerCase();
        try {
            await supabase.from('players').upsert([
                { wallet_address: connectedAddress.toLowerCase() },
                { wallet_address: target }
            ], { onConflict: 'wallet_address', ignoreDuplicates: true });
            const { error } = await supabase.from('friendships').upsert({
                user_address: connectedAddress.toLowerCase(),
                friend_address: target,
                status: 'pending'
            }, { onConflict: 'user_address,friend_address' });
            if (!error) setJustSent(prev => prev.includes(target) ? prev : [...prev, target]);
        } catch (err) {
            console.error('Add friend error:', err);
        }
    };

    // Renders the list items for Game/Base Friends
    const renderFriendList = (friends: Friend[]) => {
        if (friends.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                    <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    </div>
                    <h3 className="text-white font-black text-sm mb-1">No friends here yet</h3>
                    <p className="text-white/40 text-xs max-w-[220px]">Add players from Global and they will show up here.</p>
                </div>
            );
        }

        return (
            <div className="flex flex-col gap-2 pb-2">
                {friends.map((friend) => {
                    const hasIncomingPoke = incomingPokes.some(p => p.sender_id.toLowerCase() === friend.wallet_address.toLowerCase());
                    const isPoking = pokingId === friend.wallet_address;
                    const canSpectate = friend.status === 'In Match' && (friend as any).current_room_code;

                    return (
                        <div
                            key={friend.wallet_address}
                            onClick={() => onOpenProfile?.(friend.wallet_address)}
                            className="group relative rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden cursor-pointer transition-all hover:border-white/25 hover:bg-white/[0.07] active:scale-[0.99]"
                        >
                            <div className={`absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full ${STATUS_BEAM[friend.status]}`} />
                            <div className="flex items-center gap-3 p-3">
                                <Avatar url={friend.avatar_url} name={friend.displayName} box="w-11 h-11" dot={friend.status} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-white font-bold truncate text-[13px]">{friend.displayName}</div>
                                    <div className={`text-[10px] font-black uppercase tracking-widest ${STATUS_TEXT[friend.status]}`}>
                                        {friend.status}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <IconBtn
                                        onClick={() => handlePoke(friend.wallet_address)}
                                        disabled={isPoking}
                                        title={hasIncomingPoke ? 'Poke Back' : 'Poke'}
                                        label={hasIncomingPoke ? 'Poke back' : 'Poke friend'}
                                        tone={hasIncomingPoke ? 'poke-back' : 'poke'}
                                    >
                                        {isPoking ? (
                                            <div className="w-4 h-4 border-2 border-current opacity-40 border-t-current rounded-full animate-spin" />
                                        ) : (
                                            <PokeIcon />
                                        )}
                                    </IconBtn>
                                    {canSpectate && (
                                        <IconBtn
                                            onClick={() => onSpectate?.((friend as any).current_room_code)}
                                            title="Spectate Match"
                                            label="Spectate match"
                                            tone="spectate"
                                        >
                                            <SpectateIcon />
                                        </IconBtn>
                                    )}
                                    <IconBtn
                                        onClick={() => guard('dm', () => onDM?.(friend.wallet_address))}
                                        title="Message"
                                        label="Message friend"
                                        tone="dm"
                                    >
                                        <DMIcon />
                                    </IconBtn>
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
                <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                    <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
                    </div>
                    <h3 className="text-white font-black text-sm mb-1">No players found</h3>
                    <p className="text-white/40 text-xs max-w-[220px]">Try a different search.</p>
                </div>
            );
        }
        const friendSet = new Set(onchainFriends.map(f => f.wallet_address.toLowerCase()));
        const sentSet = new Set([...pendingOutgoing.map(r => r.wallet_address.toLowerCase()), ...justSent]);

        return (
            <div className="flex flex-col gap-2 pb-2">
                {players.map((p) => {
                    const low = p.wallet_address.toLowerCase();
                    const alreadyFriend = friendSet.has(low);
                    const pending = sentSet.has(low);
                    return (
                        <div
                            key={p.wallet_address}
                            className="relative rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden transition-all hover:border-white/25 hover:bg-white/[0.07]"
                        >
                            <div className="flex items-center gap-3 p-3">
                                <button
                                    onClick={() => onOpenProfile?.(p.wallet_address)}
                                    aria-label={`Open ${p.displayName} profile`}
                                    className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 hover:scale-105 transition-transform"
                                >
                                    <Avatar url={p.avatar_url} name={p.displayName} box="w-11 h-11" dot={p.status} />
                                </button>
                                <button
                                    onClick={() => onOpenProfile?.(p.wallet_address)}
                                    className="flex-1 flex flex-col min-w-0 text-left focus:outline-none"
                                >
                                    <span className="text-white font-bold text-[13px] truncate">{p.displayName}</span>
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${STATUS_TEXT[p.status]}`}>{p.status}</span>
                                </button>
                                {alreadyFriend ? (
                                    <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-black uppercase tracking-widest border border-green-500/25 shrink-0">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        Friends
                                    </span>
                                ) : pending ? (
                                    <span className="px-2.5 py-1.5 rounded-full bg-white/5 text-white/40 text-[10px] font-black uppercase tracking-widest border border-white/10 shrink-0">
                                        Pending
                                    </span>
                                ) : (
                                    <button
                                        onClick={() => handleAddFriend(p.wallet_address)}
                                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-cyan-500/15 text-cyan-200 text-[10px] font-black uppercase tracking-widest hover:bg-cyan-500/30 transition-all border border-cyan-500/40 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                                        Add
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    // Renders the list items for Requests (Incoming / Sent)
    const renderRequestList = (requests: Request[], isIncoming: boolean) => {
        if (requests.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                    <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/25">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 0 1-3.4 0"></path></svg>
                    </div>
                    <h3 className="text-white font-black text-sm mb-1">No pending requests</h3>
                    <p className="text-white/40 text-xs max-w-[220px]">
                        {isIncoming ? 'Nobody is waiting on you. Yet.' : 'Invites you send will wait here.'}
                    </p>
                </div>
            );
        }

        const resolveAvatar = (avatar: string | null | undefined) =>
            avatar && avatar.startsWith('http') ? avatar : null;

        return (
            <div className="flex flex-col gap-2 pb-2">
                {requests.map((req) => (
                    <div
                        key={req.id}
                        className="relative rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden transition-all hover:border-white/25 hover:bg-white/[0.07]"
                    >
                        <div className="flex items-center gap-3 p-3">
                            <button
                                onClick={() => onOpenProfile?.(req.wallet_address)}
                                aria-label={`Open ${req.name} profile`}
                                className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 hover:scale-105 transition-transform"
                            >
                                <Avatar url={resolveAvatar(req.avatar)} name={req.name} box="w-11 h-11" />
                            </button>
                            <div className="flex-1 flex flex-col min-w-0">
                                <span className="text-white font-bold text-[13px] truncate">{req.name}</span>
                                <span className="text-[10px] text-white/35 font-bold uppercase tracking-widest">{req.time}</span>
                            </div>
                            {isIncoming ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <IconBtn onClick={() => handleAcceptRequest(req.id)} title="Accept" label="Accept request" tone="accept">
                                        <AcceptIcon />
                                    </IconBtn>
                                    <IconBtn onClick={() => handleRejectCancelRequest(req.id, true)} title="Decline" label="Decline request" tone="reject">
                                        <RejectIcon />
                                    </IconBtn>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[10px] text-white/35 font-black uppercase tracking-widest pr-1">Pending</span>
                                    <IconBtn onClick={() => handleRejectCancelRequest(req.id, false)} title="Cancel" label="Cancel request" tone="reject">
                                        <RejectIcon />
                                    </IconBtn>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );
    };


    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={onClose}
            />

            {/* Panel Container */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        /* Unified global panel layout: top-64, bottom-80 sandwich */
                        className="ludo-friends-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
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
                                    <UsersTile />
                                    Friends
                                </h2>
                                <button
                                    onClick={onClose}
                                    aria-label="Close friends"
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                            <div className="flex items-center gap-2 px-0.5">
                                <span className="flex items-center gap-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full ${onlineCount > 0 ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.9)] animate-pulse' : 'bg-white/25'}`} />
                                    <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                        {onlineCount} online
                                    </span>
                                </span>
                                {pendingIncoming.length > 0 && (
                                    <>
                                        <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/40 text-[11px] font-black text-red-300 tabular-nums">
                                            {pendingIncoming.length} request{pendingIncoming.length === 1 ? '' : 's'}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Tabs + Search */}
                        <div className="px-5 pt-3 relative z-10">
                            <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-black/50 border border-white/10">
                                {(['social', 'global', 'requests'] as MainTab[]).map((tab) => {
                                    const active = activeMainTab === tab;
                                    return (
                                        <button
                                            key={tab}
                                            onClick={() => setActiveMainTab(tab)}
                                            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${active ? 'bg-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]' : 'text-white/35 hover:text-white/70'}`}
                                        >
                                            {tab}
                                            {tab === 'requests' && pendingIncoming.length > 0 && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl pl-2.5 pr-1.5 h-10 mt-2 focus-within:border-cyan-500/60 transition-colors overflow-hidden">
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

                        {/* Content Area */}
                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2 relative z-10">
                            {activeMainTab === 'social' && (
                                <div>
                                    <div className="mt-1 mb-1 flex items-center gap-2.5">
                                        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
                                            {visibleSocial.length} friends
                                        </span>
                                        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                onClick={() => setOnlineOnly(v => !v)}
                                                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all border ${onlineOnly ? 'bg-green-500/20 text-green-300 border-green-500/40' : 'bg-white/5 text-white/40 border-white/10 hover:text-white/70'}`}
                                            >
                                                <span className={`w-1 h-1 rounded-full ${onlineOnly ? 'bg-green-400 animate-pulse' : 'bg-white/30'}`} />
                                                Online
                                            </button>
                                            <button
                                                onClick={() => setActiveOnly(v => !v)}
                                                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all border ${activeOnly ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-white/5 text-white/40 border-white/10 hover:text-white/70'}`}
                                            >
                                                Active
                                            </button>
                                        </div>
                                    </div>
                                    {renderFriendList(visibleSocial)}
                                </div>
                            )}

                            {activeMainTab === 'global' && (
                                <div>
                                    <div className="mt-1 mb-1 flex items-center gap-2.5">
                                        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
                                            {visibleGlobal.length} players
                                        </span>
                                        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
                                    </div>
                                    {renderDirectoryList(visibleGlobal)}
                                </div>
                            )}

                            {activeMainTab === 'requests' && (
                                <div>
                                    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-black/50 border border-white/10 mt-1 mb-1">
                                        {(['incoming', 'sent'] as RequestTab[]).map((t) => {
                                            const n = t === 'incoming' ? pendingIncoming.length : pendingOutgoing.length;
                                            const active = activeRequestTab === t;
                                            return (
                                                <button
                                                    key={t}
                                                    onClick={() => setActiveRequestTab(t)}
                                                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${active ? 'bg-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]' : 'text-white/35 hover:text-white/70'}`}
                                                >
                                                    {t}
                                                    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono ${active ? 'bg-cyan-400/20 text-cyan-200' : 'bg-white/5 text-white/30'}`}>{n}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {activeRequestTab === 'incoming'
                                        ? renderRequestList(visibleIncoming, true)
                                        : renderRequestList(visibleOutgoing, false)
                                    }
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
