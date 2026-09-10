"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useMemo, ReactNode, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { Peer, DataConnection } from 'peerjs';
import { decryptAnyMessage, exportPublicKeyJwk, getOrCreateIdentityKey } from '@/lib/encryption';
import type { Json } from '@/types/database.types';

// --- TYPES ---

export interface UserProfile {
    wallet_address: string;
    username: string | null;
    avatar_url: string | null;
    total_wins: number | null;
    last_played_at: string | null;
    status?: string | null;
    lxp?: number | null;
    rxp?: number | null;
    rank_tier?: string | null;
    coins?: number | null;
    peer_id?: string | null;
    ecdh_pubkey?: Json | null;
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
    deleted_by_sender: boolean | null;
    deleted_by_receiver: boolean | null;
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

    // Session Inbox (ephemeral, per device + wallet)
    /** ids read this session — visible until you leave, vanished after */
    markThreadSeen: (friendId: string) => void;
    /** thread has anything you haven't seen (sender is friend, not vanished, not seen) */
    threadHasUnread: (friendId: string) => boolean;
    /** unread THREAD count for badges (people, not pings) */
    unreadThreadCount: number;
}

const GameDataContext = createContext<GameDataContextType | undefined>(undefined);

// --- HELPER CONVERSIONS ---
import { getProgression } from '@/lib/progression';

// --- HOOKS ---
import { useDataBoot } from './useDataBoot';
import { useDataSync } from './useDataSync';
import { usePeerChat } from './usePeerChat';
import { useDataActions } from './useDataActions';

export const GameDataProvider = ({ children }: { children: ReactNode }) => {
    const { address } = useAccount();
    
    // 1. Data Boot / Hydration Hook
    const {
        isBooting,
        isBootComplete,
        myProfile,
        leaderboard,
        friends,
        messages,
        rawConversations,
        profilesMap,
        setMyProfile,
        setLeaderboard,
        setFriends,
        setMessages,
        setRawConversations,
        setProfilesMap,
        bootSequence
    } = useDataBoot(address);

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [totalUnreadCount, setTotalUnreadCount] = useState(0);

    // ─── Session Inbox ──────────────────────────────────────────────
    // Vanish holds client-side so no DB state can break it: message ids you
    // open this session persist to a per-wallet ledger (interval + page hide
    // + unmount); ids in a prior session's ledger are hidden everywhere.
    // Session = provider mount for this wallet (resets on switch).
    const sessionStartRef = useRef<string>(new Date().toISOString());
    const readThisSessionRef = useRef<Set<string>>(new Set());
    const [vanishedIds, setVanishedIds] = useState<Set<string>>(new Set());
    const [, setSessionTick] = useState(0);

    const vanishedKey = address ? `dm_vanished_${address.toLowerCase()}` : null;

    const loadVanished = useCallback((): Set<string> => {
        if (!vanishedKey) return new Set();
        try {
            const raw = localStorage.getItem(vanishedKey);
            const arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
        } catch {
            return new Set();
        }
    }, [vanishedKey]);

    // Fresh session per wallet: reset clock + ledger, reload vanished.
    useEffect(() => {
        sessionStartRef.current = new Date().toISOString();
        readThisSessionRef.current = new Set();
        setVanishedIds(loadVanished());
    }, [address, loadVanished]);

    // Persist read ids as vanished (interval + hide + unmount).
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
        window.addEventListener('pagehide', persist);
        window.addEventListener('beforeunload', persist);
        return () => {
            clearInterval(timer);
            window.removeEventListener('pagehide', persist);
            window.removeEventListener('beforeunload', persist);
            persist();
        };
    }, [vanishedKey]);

    const isThreadMessage = useCallback((_m: MessageData, _friendLower: string, _meLower: string) => {
        void _m; void _friendLower; void _meLower;
        return false;
    }, []);

    // Opening a thread marks everything currently in it as seen this session.
    const markThreadSeen = useCallback((friendId: string) => {
        if (!address) return;
        const me = address.toLowerCase();
        const friend = friendId.toLowerCase();
        let changed = false;
        setMessages(prev => {
            for (const m of prev) {
                const s = m.sender_id.toLowerCase();
                const r = m.receiver_id.toLowerCase();
                if (((s === me && r === friend) || (s === friend && r === me)) && !readThisSessionRef.current.has(m.id)) {
                    readThisSessionRef.current.add(m.id);
                    changed = true;
                }
            }
            if (changed) setSessionTick(t => t + 1);
            return prev;
        });
    }, [address, setMessages]);

    const isMessageVisible = useCallback((m: MessageData) => {
        if (!address) return true;
        const me = address.toLowerCase();
        if (vanishedIds.has(m.id)) return false;
        if (m.sender_id.toLowerCase() === me && m.deleted_by_sender) return false;
        if (m.receiver_id.toLowerCase() === me && m.deleted_by_receiver) return false;
        if (readThisSessionRef.current.has(m.id)) return true;
        if (!m.is_read) return true;
        return new Date(m.created_at).getTime() >= new Date(sessionStartRef.current).getTime();
    }, [address, vanishedIds]);

    // A thread is unread when the FRIEND has anything you haven't seen:
    // not vanished, not seen this session, and not DB-read.
    const threadHasUnread = useCallback((friendId: string) => {
        if (!address) return false;
        const me = address.toLowerCase();
        const friend = friendId.toLowerCase();
        return messages.some(m =>
            m.sender_id.toLowerCase() === friend &&
            m.receiver_id.toLowerCase() === me &&
            !m.is_read &&
            !vanishedIds.has(m.id) &&
            !readThisSessionRef.current.has(m.id)
        );
    }, [address, messages, vanishedIds]);

    const unreadThreadCount = useMemo(() => {
        if (!address) return 0;
        const me = address.toLowerCase();
        const senders = new Set<string>();
        for (const m of messages) {
            if (
                m.receiver_id.toLowerCase() === me &&
                !m.is_read &&
                !vanishedIds.has(m.id) &&
                !readThisSessionRef.current.has(m.id) &&
                !m.deleted_by_receiver
            ) {
                senders.add(m.sender_id.toLowerCase());
            }
        }
        return senders.size;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address, messages, vanishedIds]);

    // --- DECRYPTION HELPER ---
    const decryptStoredContent = useCallback(async (content: string, otherId: string) => {
        if (!address) return content;
        try {
            // Sealed box (v1 ECDH) or legacy wallet-hash body
            if (content.startsWith('{')) {
                return await decryptAnyMessage(address.toLowerCase(), content, otherId.toLowerCase());
            }
            return content;
        } catch (e) {
            console.warn("Decryption failed for message content", e);
            return "[Encrypted Message]";
        }
    }, [address]);

    // Publish static ECDH pubkey once we have an identity so friends can seal DMs to us.
    useEffect(() => {
        if (!address) return;
        let cancelled = false;
        (async () => {
            try {
                await getOrCreateIdentityKey(address.toLowerCase());
                const jwk = await exportPublicKeyJwk(address.toLowerCase());
                if (cancelled) return;
                await supabase.from('players').upsert(
                    { wallet_address: address.toLowerCase(), ecdh_pubkey: jwk as unknown as Json },
                    { onConflict: 'wallet_address' }
                );
            } catch (err) {
                console.warn('ECDH pubkey publish failed', err);
            }
        })();
        return () => { cancelled = true; };
    }, [address]);

    // Initial Core Payload (Boot Sequence)
    useEffect(() => {
        if (address) bootSequence(decryptStoredContent);
    }, [address, bootSequence, decryptStoredContent]);

    // 2. Realtime Sync Hook
    useDataSync({
        address,
        isBootComplete,
        setMyProfile,
        setLeaderboard,
        setFriends,
        setMessages,
        setRawConversations,
        setProfilesMap,
        decryptStoredContent
    });

    // 3. PeerJS Lifecycle Hook
    const { isP2PActive, peer, connections, setupConnectionListeners } = usePeerChat({
        address,
        setMessages,
        setMyProfile
    });

    // 4. Data Actions Hook
    const {
        updateMyProfileOptimistic,
        sendMessage,
        markChatAsRead,
        deleteMessageLocal
    } = useDataActions({
        address,
        peer,
        connections,
        profilesMap,
        setMessages,
        setMyProfile,
        setRawConversations,
        setupConnectionListeners
    });

    // --- CONVERSATION TRANSFORMATION ---
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
                    name: (profile?.username && !profile.username.startsWith('0x')) ? profile.username : `User ${otherId.slice(-4).toUpperCase()}`,
                    avatar: profile?.avatar_url || '1',
                    lastMessage: decryptedLastMsg,
                    time: timeStr,
                    unread: unreadCount > 0,
                    status: (profile?.status || 'Offline') as 'Online' | 'Offline' | 'In Match',
                    timestamp: date.getTime()
                };
            }));

            setConversations(transformed);

            // Badge counts PEOPLE (unread threads), not messages — one friend
            // pinging six times still shows 1.
            const total = rawConversations.filter((c) => {
                const isA = c.user_a.toLowerCase() === lowerAddr;
                return (isA ? c.unread_count_a : c.unread_count_b) > 0;
            }).length;
            setTotalUnreadCount(total);
        };

        transformConvos();
    }, [rawConversations, address, profilesMap, decryptStoredContent]);

    // Session boundary: signing out (or switching wallets) wipes the
    // previous identity's chats, threads, and badges instantly. Boot
    // repopulates for the new wallet right after — nothing stale survives.
    const prevAddressRef = useRef<string | undefined>(undefined);
    const prevAddressInit = useRef(false);
    useEffect(() => {
        const cur = address?.toLowerCase();
        if (!prevAddressInit.current) {
            prevAddressInit.current = true;
            prevAddressRef.current = cur;
            return;
        }
        if (prevAddressRef.current !== cur) {
            prevAddressRef.current = cur;
            setMessages([]);
            setRawConversations([]);
            setTotalUnreadCount(0);
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
        markThreadSeen,
        threadHasUnread,
        unreadThreadCount,
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
