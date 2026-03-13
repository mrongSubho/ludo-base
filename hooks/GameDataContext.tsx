"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { Peer, DataConnection } from 'peerjs';
import { encryptMessage, decryptMessage, deriveSharedKey } from '@/lib/encryption';

// --- TYPES ---

export interface UserProfile {
    wallet_address: string;
    username: string;
    avatar_url: string;
    total_wins: number;
    last_played_at: string;
    status?: string;
}

export interface LeaderboardEntry extends UserProfile {
    tier: 'Legendary' | 'Platinum' | 'Gold' | 'Silver' | 'Rookie';
    stage: 'I' | 'II' | 'III';
}

export interface Friend {
    wallet_address: string;
    username: string;
    avatar_url: string;
    status: string;
    last_seen_at?: string;
}

export interface MessageData {
    id: string;
    sender_id: string;
    receiver_id: string;
    content: string;
    is_read: boolean;
    created_at: string;
    deleted_by_sender: boolean;
    deleted_by_receiver: boolean;
    send_status?: 'sending' | 'failed' | 'sent';
}

export interface Conversation {
    id: string; 
    name: string; 
    avatar: string; 
    lastMessage: string;
    time: string;
    unread: boolean;
    status: 'Online' | 'Offline' | 'In Match';
    timestamp: number;
}

interface GameDataContextType {
    isBooting: boolean;
    isBootComplete: boolean;
    
    // Cached Data
    myProfile: UserProfile | null;
    leaderboard: LeaderboardEntry[];
    friends: { onchainFriends: Friend[], gameFriends: Friend[] };
    
    // Chat Data
    messages: MessageData[];
    conversations: Conversation[];
    totalUnreadCount: number;
    isP2PActive: boolean;

    // Actions
    updateMyProfileOptimistic: (updates: Partial<UserProfile>) => void;
    sendMessage: (receiverId: string, content: string) => Promise<void>;
    markChatAsRead: (senderId: string) => Promise<void>;
    deleteMessageLocal: (msg: MessageData) => Promise<void>;
}

const GameDataContext = createContext<GameDataContextType | undefined>(undefined);

// --- HELPER CONVERSIONS ---
const getTierFromWins = (wins: number) => {
    if (wins >= 100) return { tier: 'Legendary' as const, stage: wins >= 150 ? 'III' as const : (wins >= 125 ? 'II' as const : 'I' as const) };
    if (wins >= 50) return { tier: 'Platinum' as const, stage: wins >= 80 ? 'III' as const : (wins >= 65 ? 'II' as const : 'I' as const) };
    if (wins >= 20) return { tier: 'Gold' as const, stage: wins >= 40 ? 'III' as const : (wins >= 30 ? 'II' as const : 'I' as const) };
    if (wins >= 5) return { tier: 'Silver' as const, stage: wins >= 15 ? 'III' as const : (wins >= 10 ? 'II' as const : 'I' as const) };
    return { tier: 'Rookie' as const, stage: wins >= 3 ? 'III' as const : (wins >= 1 ? 'II' as const : 'I' as const) };
};

export const GameDataProvider = ({ children }: { children: ReactNode }) => {
    const { address } = useAccount();
    
    const [isBooting, setIsBooting] = useState(false);
    const [isBootComplete, setIsBootComplete] = useState(false);
    
    const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [friends, setFriends] = useState<{ onchainFriends: Friend[], gameFriends: Friend[] }>({ onchainFriends: [], gameFriends: [] });
    
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [rawConversations, setRawConversations] = useState<any[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [profilesMap, setProfilesMap] = useState<Record<string, UserProfile>>({});
    const [totalUnreadCount, setTotalUnreadCount] = useState(0);

    // P2P State
    const [peer, setPeer] = useState<Peer | null>(null);
    const [connections, setConnections] = useState<Record<string, DataConnection>>({});
    const [isP2PActive, setIsP2PActive] = useState(false);

    // Initial Hydration from LocalStorage for ultra-fast UI
    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        
        try {
            const cachedProfile = localStorage.getItem(`cache_profile_${lowerAddr}`);
            if (cachedProfile) setMyProfile(JSON.parse(cachedProfile));

            const cachedLeaders = localStorage.getItem(`cache_leaderboard`);
            if (cachedLeaders) setLeaderboard(JSON.parse(cachedLeaders));
        } catch (e) {
            console.error("Local Cache Hydration Failed", e);
        }
    }, [address]);

    // Initial Core Payload (Boot Sequence)
    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        let isMounted = true;

        const bootSequence = async () => {
            setIsBooting(true);

            console.log("🚀 [GameData] Initiating Boot Sequence Payload...");
            try {
                // Execute a massive Promise.all to fetch EVERYTHING needed for the app
                const [
                    profileRes,
                    leaderboardRes,
                    friendsRes,
                    convoRes,
                    msgRes
                ] = await Promise.all([
                    // 1. Fetch My Profile
                    supabase.from('players').select('*').eq('wallet_address', lowerAddr).single(),
                    
                    // 2. Fetch Top 50 Leaderboard
                    supabase.from('players').select('*').order('total_wins', { ascending: false }).limit(50),
                    
                    // 3. Fetch Friends (Using the dual API)
                    fetch(`/api/friends?wallet=${lowerAddr}`).then(res => res.json()),
                    
                    // 4. Fetch Conversations Sidebar
                    supabase.from('conversations').select('*').or(`user_a.eq.${lowerAddr},user_b.eq.${lowerAddr}`).order('last_message_at', { ascending: false }),
                    
                    // 5. Fetch Last 30 Messages
                    supabase.from('messages').select('*').or(`sender_id.ilike.${lowerAddr},receiver_id.ilike.${lowerAddr}`).order('created_at', { ascending: false }).limit(30)
                ]);

                if (!isMounted) return;

                // Process Profile
                if (profileRes.data) {
                    setMyProfile(profileRes.data);
                    localStorage.setItem(`cache_profile_${lowerAddr}`, JSON.stringify(profileRes.data));
                }

                // Process Leaderboard
                if (leaderboardRes.data) {
                    const formattedLeaders = leaderboardRes.data.map(p => ({
                        ...p,
                        ...getTierFromWins(p.total_wins)
                    }));
                    setLeaderboard(formattedLeaders);
                    localStorage.setItem(`cache_leaderboard`, JSON.stringify(formattedLeaders));

                    // Add to Profiles Map for quick lookups
                    const pMap: Record<string, UserProfile> = {};
                    formattedLeaders.forEach(l => pMap[l.wallet_address] = l);
                    if (profileRes.data) pMap[lowerAddr] = profileRes.data;
                    
                    setProfilesMap(prev => ({ ...prev, ...pMap }));
                }

                // Process Friends (dual list from API)
                if (friendsRes) {
                    setFriends({
                        onchainFriends: friendsRes.onchainFriends || [],
                        gameFriends: friendsRes.gameFriends || []
                    });
                    
                    const fMap: Record<string, UserProfile> = {};
                    (friendsRes.gameFriends || []).forEach((f: any) => fMap[f.wallet_address] = f);
                    setProfilesMap(prev => ({ ...prev, ...fMap }));
                }

                // Process Conversations
                if (convoRes.data) {
                    setRawConversations(convoRes.data);
                }

                // Process Messages
                if (msgRes.data) {
                    const isVisibleToMe = (msg: MessageData, myAddr: string) => {
                        const low = myAddr.toLowerCase();
                        if (msg.sender_id.toLowerCase() === low && msg.deleted_by_sender) return false;
                        if (msg.receiver_id.toLowerCase() === low && msg.deleted_by_receiver) return false;
                        return true;
                    };
                    const visible = msgRes.data.reverse().filter(m => isVisibleToMe(m, lowerAddr));
                    setMessages(visible);
                }

                setIsBootComplete(true);
                console.log("✅ [GameData] Boot Sequence Complete");

            } catch (err) {
                console.error("❌ [GameData] Boot Sequence Failed:", err);
            } finally {
                if (isMounted) setIsBooting(false);
            }
        };

        bootSequence();

        return () => {
            isMounted = false;
        };
    }, [address]);

    // WebSocket Listeners for Synchronizing Data
    useEffect(() => {
        if (!address || !isBootComplete) return;
        const lowerAddr = address.toLowerCase();

        // 1. Messages Realtime
        const msgChannel = supabase
            .channel(`gamedata-messages-${lowerAddr}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => {
                    const newMsg = payload.new as MessageData;
                    const isVisibleToMe = (msg: MessageData, myAddr: string) => {
                        const low = myAddr.toLowerCase();
                        if (msg.sender_id.toLowerCase() === low && msg.deleted_by_sender) return false;
                        if (msg.receiver_id.toLowerCase() === low && msg.deleted_by_receiver) return false;
                        return true;
                    };

                    if (isVisibleToMe(newMsg, lowerAddr)) {
                        setMessages((prev) => {
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            return [...prev, newMsg].slice(-50);
                        });
                    }
                }
            )
            .subscribe();

        // 2. Conversations Realtime
        const convoChannel = supabase
            .channel(`gamedata-convos-${lowerAddr}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'conversations' },
                (payload) => {
                    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                        const newConvo = payload.new;
                        if (newConvo.user_a === lowerAddr || newConvo.user_b === lowerAddr) {
                            setRawConversations(prev => {
                                const filtered = prev.filter(c => c.id !== newConvo.id);
                                return [newConvo, ...filtered].sort((a, b) =>
                                    new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
                                );
                            });
                        }
                    }
                }
            )
            .subscribe();
            
        // 3. Leaderboard/Profile Realtime (Watch players table for changes)
        const playersChannel = supabase
            .channel('gamedata-players-sync')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'players' },
                (payload) => {
                    const updatedPlayer = payload.new as UserProfile;
                    const addr = updatedPlayer.wallet_address.toLowerCase();

                    // Update Profiles Map
                    setProfilesMap(prev => ({ ...prev, [addr]: updatedPlayer }));

                    // Update My Profile
                    if (addr === lowerAddr) {
                        setMyProfile(updatedPlayer);
                        localStorage.setItem(`cache_profile_${lowerAddr}`, JSON.stringify(updatedPlayer));
                    }

                    // Update Leaderboard entry if they are in the Top 50
                    setLeaderboard(prev => {
                        const idx = prev.findIndex(p => p.wallet_address === addr);
                        if (idx !== -1) {
                            const newArr = [...prev];
                            newArr[idx] = { ...updatedPlayer, ...getTierFromWins(updatedPlayer.total_wins) };
                            
                            // Re-sort in case wins changed
                            newArr.sort((a, b) => b.total_wins - a.total_wins);
                            localStorage.setItem(`cache_leaderboard`, JSON.stringify(newArr));
                            return newArr;
                        }
                        return prev;
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(convoChannel);
            supabase.removeChannel(playersChannel);
        };
    }, [address, isBootComplete]);

    // --- PEERJS LIFECYCLE ---
    useEffect(() => {
        if (!address || typeof window === 'undefined') return;
        
        const lowerAddr = address.toLowerCase();
        console.log("📡 [P2P] Initializing Peer with ID:", lowerAddr);
        
        const newPeer = new Peer(lowerAddr, {
            debug: 1 // 1 for errors, 2 for warnings, 3 for full
        });

        newPeer.on('open', (id) => {
            console.log("✅ [P2P] Connection opened with ID:", id);
            setIsP2PActive(true);
        });

        newPeer.on('connection', (conn) => {
            console.log("🤝 [P2P] Incoming connection from:", conn.peer);
            setupConnectionListeners(conn);
        });

        newPeer.on('error', (err) => {
            console.error("❌ [P2P] Peer Error:", err);
            if (err.type === 'unavailable-id') {
                // This happens if another tab is open with the same account
                console.warn("[P2P] Duplicate peer ID detected. Disabling P2P for this tab.");
            }
        });

        setPeer(newPeer);

        return () => {
            newPeer.destroy();
            setPeer(null);
            setIsP2PActive(false);
        };
    }, [address]);

    const setupConnectionListeners = (conn: DataConnection) => {
        conn.on('open', () => {
            setConnections(prev => ({ ...prev, [conn.peer]: conn }));
        });

        conn.on('data', async (data: any) => {
            console.log("📩 [P2P] Received data:", data);
            if (data.type === 'encrypted-message' && address) {
                try {
                    const key = await deriveSharedKey(address, conn.peer);
                    const plainText = await decryptMessage(data.payload, key);
                    
                    const newMsg: MessageData = {
                        ...data.metadata,
                        content: plainText,
                        is_read: false,
                        created_at: new Date().toISOString(),
                    };

                    setMessages(prev => {
                        if (prev.some(m => m.id === newMsg.id)) return prev;
                        return [...prev, newMsg].slice(-50);
                    });
                } catch (err) {
                    console.error("❌ [P2P] Decryption failed:", err);
                }
            }
        });

        conn.on('close', () => {
            setConnections(prev => {
                const next = { ...prev };
                delete next[conn.peer];
                return next;
            });
        });

        conn.on('error', (err) => {
            console.error(`❌ [P2P] Conn error with ${conn.peer}:`, err);
        });
    };

    // Transform Conversations to UI Format
    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        const transformed = rawConversations.map(c => {
            const isA = c.user_a.toLowerCase() === lowerAddr;
            const otherId = isA ? c.user_b : c.user_a;
            const profile = profilesMap[otherId.toLowerCase()];
            const unreadCount = isA ? c.unread_count_a : c.unread_count_b;

            const date = new Date(c.last_message_at);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHrs = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHrs / 24);

            let timeStr = 'Just now';
            if (diffDays > 0) timeStr = `${diffDays}d ago`;
            else if (diffHrs > 0) timeStr = `${diffHrs}h ago`;
            else if (diffMins > 0) timeStr = `${diffMins}m ago`;

            return {
                id: otherId,
                name: (profile?.username && !profile.username.startsWith('0x')) ? profile.username : `User ${otherId.substring(0, 6)}`,
                avatar: profile?.avatar_url || '1',
                lastMessage: c.last_message_content,
                time: timeStr,
                unread: unreadCount > 0,
                status: (profile?.status || 'Offline') as 'Online' | 'Offline' | 'In Match',
                timestamp: date.getTime()
            };
        });

        setConversations(transformed);

        const total = rawConversations.reduce((sum, c) => {
            const isA = c.user_a.toLowerCase() === lowerAddr;
            return sum + (isA ? c.unread_count_a : c.unread_count_b);
        }, 0);
        setTotalUnreadCount(total);
    }, [rawConversations, address, profilesMap]);


    // --- ACTIONS ---

    const updateMyProfileOptimistic = useCallback((updates: Partial<UserProfile>) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        setMyProfile(prev => {
            if (!prev) return prev;
            const merged = { ...prev, ...updates };
            localStorage.setItem(`cache_profile_${lowerAddr}`, JSON.stringify(merged));
            return merged;
        });

        // Background sync
        supabase.from('players').upsert({ wallet_address: lowerAddr, ...updates }, { onConflict: 'wallet_address' }).then(({ error }) => {
            if (error) console.error("Failed to sync profile change:", error);
        });
    }, [address]);

    const sendMessage = useCallback(async (receiverId: string, content: string) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        const targetId = receiverId.toLowerCase();

        const tempId = 'msg-' + Math.random().toString(36).substring(2, 11);
        const optimisticMsg: MessageData = {
            id: tempId,
            sender_id: lowerAddr,
            receiver_id: targetId,
            content: content,
            is_read: false,
            created_at: new Date().toISOString(),
            deleted_by_sender: false,
            deleted_by_receiver: false,
            send_status: 'sending'
        };

        setMessages(prev => [...prev, optimisticMsg]);

        try {
            // 1. Encrypt Message
            const key = await deriveSharedKey(lowerAddr, targetId);
            const encrypted = await encryptMessage(content, key);

            // 2. Try P2P first
            let p2pSent = false;
            let conn = connections[targetId];

            if (!conn && peer) {
                console.log("🔗 [P2P] Attempting to connect to:", targetId);
                conn = peer.connect(targetId);
                setupConnectionListeners(conn);
                // Wait a bit for connection
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (conn && conn.open) {
                conn.send({
                    type: 'encrypted-message',
                    payload: encrypted,
                    metadata: {
                        id: tempId,
                        sender_id: lowerAddr,
                        receiver_id: targetId
                    }
                });
                p2pSent = true;
                console.log("⚡ [P2P] Message sent directly!");
            }

            // 3. Fallback to Supabase (as encrypted relay)
            const { data, error } = await supabase.from('messages').insert({
                sender_id: lowerAddr,
                receiver_id: targetId,
                content: JSON.stringify(encrypted) // Store as JSON string in Supabase
            }).select().single();

            if (error && !p2pSent) {
                setMessages(prev => prev.map(m => m.id === tempId ? { ...m, send_status: 'failed' } : m));
            } else if (data || p2pSent) {
                setMessages(prev => prev.map(m => m.id === tempId ? { 
                    ...(data || optimisticMsg), 
                    content: content, // Keep original text in UI
                    send_status: 'sent' 
                } : m));
            }
        } catch (err) {
            console.error("❌ Send Error:", err);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, send_status: 'failed' } : m));
        }
    }, [address, peer, connections]);

    const markChatAsRead = useCallback(async (senderId: string) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        // Optimistic UI update
        setMessages(prev => {
            let changed = false;
            const next = prev.map(m => {
                if (m.sender_id.toLowerCase() === senderId.toLowerCase() &&
                    m.receiver_id.toLowerCase() === lowerAddr &&
                    !m.is_read) {
                    changed = true;
                    return { ...m, is_read: true };
                }
                return m;
            });
            return changed ? next : prev;
        });

        try {
            await supabase.rpc('mark_conversation_read', {
                me: lowerAddr,
                friend: senderId.toLowerCase()
            });
        } catch (e) {
            console.warn("RPC mark_conversation_read failed");
        }

        await supabase
            .from('messages')
            .update({ is_read: true })
            .ilike('sender_id', senderId)
            .ilike('receiver_id', lowerAddr)
            .eq('is_read', false);
    }, [address]);

    const deleteMessageLocal = useCallback(async (msg: MessageData) => {
        if (!address) return;

        // Optimistically remove from UI
        setMessages(prev => prev.filter(m => m.id !== msg.id));

        // Update database to delete for BOTH users immediately
        const updatePayload = {
            deleted_by_sender: true,
            deleted_by_receiver: true
        };

        const { error } = await supabase
            .from('messages')
            .update(updatePayload)
            .eq('id', msg.id);

        if (error) {
            console.error("Error deleting message:", error);
        }
    }, [address]);

    const value: GameDataContextType = {
        isBooting,
        isBootComplete,
        myProfile,
        leaderboard,
        friends,
        messages,
        conversations,
        totalUnreadCount,
        isP2PActive,
        updateMyProfileOptimistic,
        sendMessage,
        markChatAsRead,
        deleteMessageLocal
    };

    return (
        <GameDataContext.Provider value={value}>
            {children}
        </GameDataContext.Provider>
    );
};

export const useGameData = () => {
    const context = useContext(GameDataContext);
    if (context === undefined) {
        throw new Error('useGameData must be used within a GameDataProvider');
    }
    return context;
};
