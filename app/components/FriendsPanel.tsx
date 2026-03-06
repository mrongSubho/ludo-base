import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface FriendsPanelProps {
    onClose: () => void;
    onDM?: (friendId: string) => void;
    onOpenProfile?: (address: string) => void;
}

type MainTab = 'game' | 'onchain' | 'requests';
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
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M12 2.001c-5.523 0-10 4.145-10 9.259 0 2.914 1.451 5.515 3.738 7.379V22l4.133-2.27c.666.185 1.367.283 2.083.283 5.523 0 10-4.145 10-9.259 0-5.114-4.477-9.259-10-9.259Zm1.161 12.333L10.324 11.2l-5.508 3.133 6.059-6.433 2.837 3.133 5.508-3.133-6.059 6.434Z" />
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

    const [activeMainTab, setActiveMainTab] = useState<MainTab>('game');
    const [activeRequestTab, setActiveRequestTab] = useState<RequestTab>('incoming');

    const [gameFriends, setGameFriends] = useState<Friend[]>([]);
    const [onchainFriends, setOnchainFriends] = useState<Friend[]>([]);
    const [pendingIncoming, setPendingIncoming] = useState<Request[]>([]);
    const [pendingOutgoing, setPendingOutgoing] = useState<Request[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchFriends = React.useCallback(async () => {
        if (!connectedAddress) return;
        setIsLoading(true);
        try {
            // 1. Fetch Farcaster Social Graph if FID is available
            if (userFid) {
                const res = await fetch(`/api/friends?fid=${userFid}`);
                const data = await res.json();
                if (data.friends) {
                    const formatted = data.friends.map((friend: any) => ({
                        ...friend,
                        displayName: (friend.username && !friend.username.startsWith('0x')) ? friend.username : "Guest " + friend.wallet_address.slice(-6).toUpperCase(),
                        status: 'Online'
                    }));
                    setGameFriends(formatted);
                }
            }

            // 2. Fetch live friendships from Supabase (Onchain Friends)
            const currentAddrLower = connectedAddress.toLowerCase();
            const { data, error } = await supabase
                .from('friendships')
                .select(`
                    status,
                    user_address,
                    friend_address,
                    requester:players!friendships_user_address_fkey(wallet_address, username, avatar_url, total_wins),
                    receiver:players!friendships_friend_address_fkey(wallet_address, username, avatar_url, total_wins)
                `)
                .eq('status', 'accepted')
                .or(`user_address.eq.${currentAddrLower},friend_address.eq.${currentAddrLower}`);

            if (error) throw error;

            if (data) {
                const formatted = data.map((item: any) => {
                    const isRequester = item.user_address.toLowerCase() === connectedAddress.toLowerCase();
                    const p = isRequester ? item.receiver : item.requester;
                    const displayName = (p.username && !p.username.startsWith('0x')) ? p.username : "Guest " + p.wallet_address.slice(-6).toUpperCase();
                    return {
                        ...p,
                        displayName,
                        status: p.status || 'Offline'
                    };
                });
                setOnchainFriends(formatted);
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

        } catch (err) {
            console.error('Error fetching friends:', err);
        } finally {
            setIsLoading(false);
        }
    }, [connectedAddress, userFid]);

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

                    setGameFriends(prev => updateList(prev));
                    setOnchainFriends(prev => updateList(prev));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [connectedAddress, userFid, fetchFriends]);

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

    // Renders the list items for Game/Base Friends
    const renderFriendList = (friends: Friend[]) => {
        if (friends.length === 0) {
            return <div className="text-center text-white/50 py-8 text-sm">No friends here yet.</div>;
        }

        return friends.map((friend) => (
            <div key={friend.wallet_address} className="flex items-center justify-between p-3 mb-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => onOpenProfile?.(friend.wallet_address)}
                        className="relative w-12 h-12 rounded-full overflow-hidden bg-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500/50 hover:scale-105 transition-transform"
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

                <button
                    onClick={() => onDM?.(friend.wallet_address)}
                    className="w-10 h-10 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center hover:bg-purple-600 hover:text-white transition-all shadow-sm"
                >
                    <DMIcon />
                </button>
            </div>
        ));
    };

    // Renders the list items for Requests (Incoming / Sent)
    const renderRequestList = (requests: Request[], isIncoming: boolean) => {
        if (requests.length === 0) {
            return <div className="text-center text-white/50 py-8 text-sm">No pending requests.</div>;
        }

        return requests.map((req) => (
            <div key={req.id} className="flex items-center justify-between p-3 mb-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <button onClick={() => onOpenProfile?.(req.wallet_address)} className="flex items-center gap-3 hover:opacity-80 transition-opacity focus:outline-none text-left">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-purple-900 border-2 border-transparent">
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
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                /* Unified global panel layout: top-64, bottom-80, bg-purple-6000 glass */
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[468px] bg-purple-600/20 backdrop-blur-xl border border-white/10 rounded-[32px] z-[110] flex flex-col shadow-2xl overflow-hidden"
            >
                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header & Main Tabs */}
                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mb-6 mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-purple-400">
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
                            className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'game' ? 'bg-purple-700 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
                            onClick={() => setActiveMainTab('game')}
                        >
                            Game Friends
                        </button>
                        <button
                            className={`flex-1 py-2 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'onchain' ? 'bg-purple-700 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
                            onClick={() => setActiveMainTab('onchain')}
                        >
                            Onchain Friends
                        </button>
                        <button
                            className={`flex-1 py-1 text-[13px] font-bold rounded-lg transition-all ${activeMainTab === 'requests' ? 'bg-purple-700 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
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

                        {activeMainTab === 'game' && (
                            <motion.div key="game" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="pb-safe-footer">
                                <div className="px-2 pb-2 text-[12px] font-bold text-white/40 uppercase tracking-wider">
                                    Game Friends ({onchainFriends.length})
                                </div>
                                {renderFriendList(onchainFriends)}
                            </motion.div>
                        )}

                        {activeMainTab === 'onchain' && (
                            <motion.div key="onchain" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="pb-safe-footer">
                                <div className="px-2 pb-2 text-[12px] font-bold text-white/40 uppercase tracking-wider">
                                    Onchain Friends ({gameFriends.length})
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
                                            <motion.div layoutId="reqTabUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 rounded-t-full" />
                                        )}
                                    </button>
                                    <button
                                        className={`pb-3 text-sm font-semibold transition-colors relative ${activeRequestTab === 'sent' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                                        onClick={() => setActiveRequestTab('sent')}
                                    >
                                        Sent ({pendingOutgoing.length})
                                        {activeRequestTab === 'sent' && (
                                            <motion.div layoutId="reqTabUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 rounded-t-full" />
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
        </>
    );
}
