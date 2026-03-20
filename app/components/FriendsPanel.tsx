import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { BiMessageSquareEdit } from "react-icons/bi";
import { useGameData } from '@/hooks/GameDataContext';

interface FriendsPanelProps {
    onClose: () => void;
    onDM?: (friendId: string) => void;
    onOpenProfile?: (address: string) => void;
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
}

interface Request {
    id: string;
    wallet_address: string;
    name: string;
    avatar: string;
    time: string;
}


// SVG Icons
const DMIcon = () => (
    <BiMessageSquareEdit className="w-5 h-5" />
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-green-500">
        <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
);

const RejectIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-red-500">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
);


export default function FriendsPanel({ onClose, onDM, onOpenProfile }: FriendsPanelProps) {
    const { profile, address: connectedAddress } = useCurrentUser();
    const userFid = (profile as any)?.fid;

    const [activeMainTab, setActiveMainTab] = useState<MainTab>('social');
    const [activeRequestTab, setActiveRequestTab] = useState<RequestTab>('incoming');
    const { friends: globalFriends, isBooting: isLoadingGlobal } = useGameData();

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
    const [isLoading, setIsLoading] = useState(true);
    const [pokingId, setPokingId] = useState<string | null>(null);

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
        setIsLoading(true);
        try {
            // 2. Fetch live friendships from Supabase (Onchain Friends)
            const currentAddrLower = connectedAddress.toLowerCase();
            const { data, error } = await supabase
                .from('friendships')
                .select(`
                    status,
                    user_address,
                    friend_address,
                    requester:players!friendships_user_address_fkey(wallet_address, username, avatar_url, total_wins, status, last_played_at),
                    receiver:players!friendships_friend_address_fkey(wallet_address, username, avatar_url, total_wins, status, last_played_at)
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
    } finally {
        setIsLoading(false);
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
                            ? { ...f, status: updatedPlayer.status }
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

    // Renders the list items for Game/Base Friends
    const renderFriendList = (friends: Friend[]) => {
        if (friends.length === 0) {
            return <div className="text-center text-white/50 py-8 text-sm">No friends here yet.</div>;
        }

        return friends.map((friend) => {
            const hasIncomingPoke = incomingPokes.some(p => p.sender_id.toLowerCase() === friend.wallet_address.toLowerCase());
            const isPoking = pokingId === friend.wallet_address;

            return (
                <div key={friend.wallet_address} className="flex items-center justify-between p-3 mb-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => onOpenProfile?.(friend.wallet_address)}
                            className="relative w-12 h-12 rounded-full overflow-hidden bg-cyan-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 hover:scale-105 transition-transform"
                        >
                            <img
                                src={friend.avatar_url || '/default-avatar.png'}
                                alt={friend.displayName}
                                className="w-full h-full object-cover"
                            />
                            <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#1a1c29] 
                  ${friend.status === 'Online' ? 'bg-green-500' : friend.status === 'In Match' ? 'bg-orange-500' : 'bg-gray-500'}`}
                            />
                        </button>
                        <button
                            onClick={() => onOpenProfile?.(friend.wallet_address)}
                            className="flex flex-col text-left focus:outline-none hover:opacity-80 transition-opacity"
                        >
                            <span className="text-white font-medium text-[15px]">{friend.displayName}</span>
                            <span className={`text-[12px] font-medium 
                  ${friend.status === 'Online' ? 'text-green-400' : friend.status === 'In Match' ? 'text-orange-400' : 'text-white/40'}`}>
                                {friend.status}
                            </span>
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Poke Button */}
                        <button
                            onClick={() => handlePoke(friend.wallet_address)}
                            disabled={isPoking}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-sm
                                ${hasIncomingPoke 
                                    ? 'bg-yellow-500 text-black hover:bg-yellow-400 animate-pulse' 
                                    : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white border border-white/5'
                                }
                                ${isPoking ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                            title={hasIncomingPoke ? "Poke Back" : "Poke"}
                        >
                            {isPoking ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <PokeIcon />
                            )}
                        </button>

                        {/* DM Button */}
                        <button
                            onClick={() => onDM?.(friend.wallet_address)}
                            className="w-10 h-10 rounded-full bg-white/5 text-cyan-400 flex items-center justify-center hover:bg-cyan-600 hover:text-white transition-all shadow-sm"
                        >
                            <DMIcon />
                        </button>
                    </div>
                </div>
            );
        });
    };

    // Renders the list items for Requests (Incoming / Sent)
    const renderRequestList = (requests: Request[], isIncoming: boolean) => {
        if (requests.length === 0) {
            return <div className="text-center text-white/50 py-8 text-sm">No pending requests.</div>;
        }

        return requests.map((req) => (
            <div key={req.id} className="flex items-center justify-between p-3 mb-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <button onClick={() => onOpenProfile?.(req.wallet_address)} className="flex items-center gap-3 hover:opacity-80 transition-opacity focus:outline-none text-left">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-cyan-900 border-2 border-transparent">
                        <img src={req.avatar.startsWith('http') ? req.avatar : `/avatars/${req.avatar}.png`} alt={req.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-white font-medium text-[15px]">{req.name}</span>
                        <span className="text-[12px] text-white/40 font-medium">{req.time}</span>
                    </div>
                </button>

                {isIncoming ? (
                    <div className="flex items-center gap-2">
                        <button onClick={() => handleAcceptRequest(req.id)} className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center hover:bg-green-500 hover:text-white transition-all">
                            <AcceptIcon />
                        </button>
                        <button onClick={() => handleRejectCancelRequest(req.id, true)} className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all">
                            <RejectIcon />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <span className="text-[12px] text-white/50 pr-2">Pending</span>
                        <button onClick={() => handleRejectCancelRequest(req.id, false)} className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all">
                            <RejectIcon />
                        </button>
                    </div>
                )}
            </div>
        ));
    };


    return (
        <>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-transparent"
            />

            {/* Ghost Centering Container */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <motion.div
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: '100%', opacity: 0 }}
                        transition={{ type: 'spring', damping: 32, stiffness: 180, mass: 1 }}
                        /* Unified global panel layout: top-64, bottom-80 sandwich */
                        className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-y-auto pb-[40px]"
                        style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                    >
                {/* Authentic Subdued Cosmic Orbs */}
                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2">
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header & Main Tabs */}
                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mb-6 mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-cyan-400">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            Friends
                        </h2>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>

                    {/* Top-Level Segmented Control */}
                    <div className="flex bg-black/40 p-1 rounded-xl">
                        <button
                            className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'social' ? 'bg-cyan-700 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
                            onClick={() => setActiveMainTab('social')}
                        >
                            Social
                        </button>
                        <button
                            className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'global' ? 'bg-cyan-700 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
                            onClick={() => setActiveMainTab('global')}
                        >
                            Global
                        </button>
                        <button
                            className={`flex-1 py-1 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'requests' ? 'bg-cyan-700 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
                            onClick={() => setActiveMainTab('requests')}
                        >
                            <span className="flex items-center justify-center gap-1.5">
                                Requests
                                {pendingIncoming.length > 0 && (
                                    <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-md leading-none">
                                        {pendingIncoming.length > 9 ? '9+' : pendingIncoming.length}
                                    </span>
                                )}
                            </span>
                        </button>
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto px-panel-gutter py-4 custom-scrollbar">
                    <AnimatePresence mode="wait">

                        {activeMainTab === 'social' && (
                            <motion.div key="social" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="pb-safe-footer">
                                <div className="px-2 pb-2 text-[12px] font-bold text-white/40 uppercase tracking-wider">
                                    Social Friends ({onchainFriends.length})
                                </div>
                                {renderFriendList(onchainFriends)}
                            </motion.div>
                        )}

                        {activeMainTab === 'global' && (
                            <motion.div key="global" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="pb-safe-footer">
                                <div className="px-2 pb-2 text-[12px] font-bold text-white/40 uppercase tracking-wider">
                                    Global Players ({gameFriends.length})
                                </div>
                                {renderFriendList(gameFriends)}
                            </motion.div>
                        )}

                        {activeMainTab === 'requests' && (
                            <motion.div key="req" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="pb-safe-footer">

                                {/* Secondary Tab Switcher inside Requests */}
                                <div className="flex gap-4 mb-4 border-b border-white/5 px-2">
                                    <button
                                        className={`pb-3 text-sm font-semibold transition-colors relative ${activeRequestTab === 'incoming' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                                        onClick={() => setActiveRequestTab('incoming')}
                                    >
                                        Incoming ({pendingIncoming.length})
                                        {activeRequestTab === 'incoming' && (
                                            <motion.div layoutId="reqTabUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-600 rounded-t-full" />
                                        )}
                                    </button>
                                    <button
                                        className={`pb-3 text-sm font-semibold transition-colors relative ${activeRequestTab === 'sent' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                                        onClick={() => setActiveRequestTab('sent')}
                                    >
                                        Sent ({pendingOutgoing.length})
                                        {activeRequestTab === 'sent' && (
                                            <motion.div layoutId="reqTabUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-600 rounded-t-full" />
                                        )}
                                    </button>
                                </div>

                                <div className="mt-2">
                                    {activeRequestTab === 'incoming'
                                        ? renderRequestList(pendingIncoming, true)
                                        : renderRequestList(pendingOutgoing, false)
                                    }
                                </div>

                            </motion.div>
                        )}

                    </AnimatePresence>
                </div>

                    </motion.div>
                </div>
            </div>
        </>
    );
}
