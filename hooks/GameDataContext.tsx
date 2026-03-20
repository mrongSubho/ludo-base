"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { Peer, DataConnection } from 'peerjs';
import { encryptMessage, decryptMessage, deriveSharedKey } from '@/lib/encryption';

// --- TYPES ---

export interface UserProfile {
    wallet_address: string;
    username: string | null;
    avatar_url: string | null;
    total_wins: number | null;
    last_played_at: string | null;
    status?: string | null;
    xp?: number | null;
    rating?: number | null;
    coins?: number | null;
    peer_id?: string | null;
}

export interface LeaderboardEntry extends UserProfile {
    tierName: string;
    subRank: string;
    level: number;
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
import { getProgression } from '@/lib/progression';

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

    const [isP2PActive, setIsP2PActive] = useState(false);
    const [peer, setPeer] = useState<Peer | null>(null);
    const [connections, setConnections] = useState<Record<string, DataConnection>>({});

    // --- DECRYPTION HELPER ---
    const decryptStoredContent = useCallback(async (content: string, otherId: string) => {
        if (!address) return content;
        try {
            // Check if content is likely an encrypted JSON string
            if (content.startsWith('{"iv":')) {
                const encryptedData = JSON.parse(content);
                const key = await deriveSharedKey(address.toLowerCase(), otherId.toLowerCase());
                return await decryptMessage(encryptedData, key);
            }
            return content;
        } catch (e) {
            console.warn("Decryption failed for message content", e);
            return "[Encrypted Message]";
        }
    }, [address]);

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
                    supabase.from('players').select('*').eq('wallet_address', lowerAddr).maybeSingle(),
                    
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
                    const formattedLeaders = leaderboardRes.data.map(p => {
                        const prog = getProgression(p.xp || 0, p.rating || 0);
                        return {
                            ...p,
                            tierName: prog.tier,
                            subRank: prog.subRank,
                            level: prog.level
                        };
                    });
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
                    const decryptedMessages = await Promise.all(msgRes.data.map(async (m: any) => {
                        const otherId = m.sender_id.toLowerCase() === lowerAddr ? m.receiver_id : m.sender_id;
                        return {
                            ...m,
                            content: await decryptStoredContent(m.content, otherId)
                        };
                    }));

                    const isVisibleToMe = (msg: MessageData, myAddr: string) => {
                        const low = myAddr.toLowerCase();
                        if (msg.sender_id.toLowerCase() === low && msg.deleted_by_sender) return false;
                        if (msg.receiver_id.toLowerCase() === low && msg.deleted_by_receiver) return false;
                        return true;
                    };
                    const visible = decryptedMessages.reverse().filter(m => isVisibleToMe(m, lowerAddr));
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
                async (payload) => {
                    const rawMsg = payload.new as MessageData;
                    const otherId = rawMsg.sender_id.toLowerCase() === lowerAddr ? rawMsg.receiver_id : rawMsg.sender_id;
                    const decryptedContent = await decryptStoredContent(rawMsg.content, otherId);
                    
                    const newMsg = { ...rawMsg, content: decryptedContent };
                    
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

                    // Update Leaderboard entry
                    setLeaderboard(prev => {
                        const idx = prev.findIndex(p => p.wallet_address === addr);
                        if (idx !== -1) {
                            const newArr = [...prev];
                            const prog = getProgression(updatedPlayer.xp || 0, updatedPlayer.rating || 0);
                            newArr[idx] = { 
                                ...updatedPlayer, 
                                tierName: prog.tier,
                                subRank: prog.subRank,
                                level: prog.level
                            };
                            
                            newArr.sort((a, b) => (b.total_wins || 0) - (a.total_wins || 0));
                            localStorage.setItem(`cache_leaderboard`, JSON.stringify(newArr));
                            return newArr;
                        }
                        return prev;
                    });
                }
            )
            .subscribe();

        // 4. Missions Realtime (Optional but helpful)
        const missionsChannel = supabase
            .channel(`gamedata-missions-${lowerAddr}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'player_missions', filter: `player_id=eq.${lowerAddr}` },
                (payload) => {
                    // We can emit an event or just let the MissionPanel refetch if needed.
                    // For now, simple revalidation is often enough, but Realtime is cooler.
                    window.dispatchEvent(new CustomEvent('mission-update'));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(convoChannel);
            supabase.removeChannel(playersChannel);
            supabase.removeChannel(missionsChannel);
        };
    }, [address, isBootComplete]);

    // --- PEERJS LIFECYCLE ---
    useEffect(() => {
        if (!address || typeof window === 'undefined') return;
        
        const lowerAddr = address.toLowerCase();
        let currentPeer: Peer | null = null;
        let isDestroyed = false;
        let retryTimeout: NodeJS.Timeout;

        const initPeer = () => {
            if (isDestroyed) return;
            
            // Generate a truly unique ID to avoid library-internal collisions on the PeerServer
            const uniqueId = `${lowerAddr}-${Math.random().toString(36).substring(2, 7)}`;
            console.log("📡 [P2P] Initializing Peer with Unique ID:", uniqueId);
            
            currentPeer = new Peer(uniqueId, {
                debug: 1
            });

            currentPeer.on('open', (id) => {
                if (isDestroyed) {
                    currentPeer?.destroy();
                    return;
                }
                console.log("✅ [P2P] Connection opened with ID:", id);
                setIsP2PActive(true);
                
                // Sync the unique Peer ID to Supabase so others can find us
                supabase.from('players')
                    .update({ peer_id: id, status: 'Online' })
                    .eq('wallet_address', lowerAddr)
                    .then(({ error }) => {
                        if (error) console.error("❌ [P2P] Failed to sync peer_id:", error);
                        else console.log("🔗 [P2P] Peer ID synced to database.");
                    });
                
                // Update local profile too
                setMyProfile(prev => prev ? { ...prev, peer_id: id, status: 'Online' } : prev);
            });

            currentPeer.on('connection', (conn) => {
                console.log("🤝 [P2P] Incoming connection from:", conn.peer);
                setupConnectionListeners(conn);
            });

            currentPeer.on('disconnected', () => {
                if (isDestroyed || currentPeer?.destroyed) return;
                console.warn("⚠️ [P2P] Peer disconnected. Attempting to reconnect...");
                setIsP2PActive(false);
                currentPeer?.reconnect();
            });

            currentPeer.on('error', (err) => {
                if (isDestroyed) return;
                
                // We handle 'unavailable-id' here just in case, though it should be impossible now
                if (err.type === 'unavailable-id') {
                    console.warn("⚠️ [P2P] ID collision detected. Regenerating in 2s...");
                    setIsP2PActive(false);
                    currentPeer?.destroy();
                    retryTimeout = setTimeout(initPeer, 2000);
                } else {
                    console.error("❌ [P2P] Peer Error:", err.message, "Type:", err.type);
                    setIsP2PActive(false);

                    if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                        console.warn(`⚠️ [P2P] Recovery attempt in 5s...`);
                        currentPeer?.destroy();
                        retryTimeout = setTimeout(initPeer, 5000);
                    }
                }
            });

            setPeer(currentPeer);
        };

        // Delay initial creation slightly for clean mount transitions
        const initialDelay = setTimeout(initPeer, 500);

        return () => {
            isDestroyed = true;
            clearTimeout(initialDelay);
            clearTimeout(retryTimeout);
            if (currentPeer) {
                currentPeer.destroy();
                // Clear the Peer ID from Supabase on unmount
                supabase.from('players').update({ peer_id: null, status: 'Offline' }).eq('wallet_address', lowerAddr);
            }
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
                        deleted_by_sender: false, // Ensure these fields are present
                        deleted_by_receiver: false, // Ensure these fields are present
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

    useEffect(() => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        const transformConvos = async () => {
            const transformed = await Promise.all(rawConversations.map(async (c) => {
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

                const decryptedLastMsg = await decryptStoredContent(c.last_message_content, otherId);

                return {
                    id: otherId,
                    name: (profile?.username && !profile.username.startsWith('0x')) ? profile.username : `User ${otherId.substring(0, 6)}`,
                    avatar: profile?.avatar_url || '1',
                    lastMessage: decryptedLastMsg,
                    time: timeStr,
                    unread: unreadCount > 0,
                    status: (profile?.status || 'Offline') as 'Online' | 'Offline' | 'In Match',
                    timestamp: date.getTime()
                };
            }));

            setConversations(transformed);

            const total = rawConversations.reduce((sum, c) => {
                const isA = c.user_a.toLowerCase() === lowerAddr;
                return sum + (isA ? c.unread_count_a : c.unread_count_b);
            }, 0);
            setTotalUnreadCount(total);
        };

        transformConvos();
    }, [rawConversations, address, profilesMap, decryptStoredContent]);


    // --- ACTIONS ---

    const updateMyProfileOptimistic = useCallback((updates: Partial<UserProfile>) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        setMyProfile(prev => {
            const base = prev || {
                wallet_address: lowerAddr,
                username: null,
                avatar_url: null,
                total_wins: 0,
                last_played_at: new Date().toISOString(),
                xp: 0,
                rating: 0,
                coins: 1000,
                peer_id: null
            };
            const merged = { ...base, ...updates };
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
            const targetProfile = profilesMap[targetId];
            const targetPeerId = targetProfile?.peer_id;
            
            let conn = targetPeerId ? connections[targetPeerId] : null;

            if (!conn && peer && targetPeerId) {
                console.log("🔗 [P2P] Attempting to connect to:", targetPeerId, `(Wallet: ${targetId})`);
                conn = peer.connect(targetPeerId);
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
                console.log("⚡ [P2P] Message sent directly via unique ID!");
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
