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
    rank_tier?: string | null;
    coins?: number | null;
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

    // --- DECRYPTION HELPER ---
    const decryptStoredContent = useCallback(async (content: string, otherId: string) => {
        if (!address) return content;
        try {
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
