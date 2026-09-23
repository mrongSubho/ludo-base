/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppSession } from './useAppSession';

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
    id: string; // The address of the OTHER person
    name: string; // fallback to address if name not found
    avatar: string; // fallback to generic
    lastMessage: string;
    time: string;
    unread: boolean;
    status: 'Online' | 'Offline' | 'In Match';
    timestamp: number; // for sorting
}

export function useMessages(currentUserAddress: string | undefined | null, selectedChatId?: string | null) {
    const { ensureAppSession } = useAppSession();
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [rawConversations, setRawConversations] = useState<any[]>([]);
    const [profiles, setProfiles] = useState<Record<string, { username: string, avatar: string, status: string }>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [totalUnreadCount, setTotalUnreadCount] = useState(0);

    // Filter helper to determine if a message should be visible to the current user
    const isVisibleToMe = useCallback((msg: MessageData, myAddr: string) => {
        const lowerAddr = myAddr.toLowerCase();
        if (msg.sender_id.toLowerCase() === lowerAddr && msg.deleted_by_sender) return false;
        if (msg.receiver_id.toLowerCase() === lowerAddr && msg.deleted_by_receiver) return false;
        return true;
    }, []);

    // Fetch initial messages and conversations
    useEffect(() => {
        if (!currentUserAddress) return;
        const currentAddrLower = currentUserAddress.toLowerCase();

        const fetchInitialData = async () => {
            setIsLoading(true);
            const sessionId = await ensureAppSession();
            if (sessionId) {
                const response = await fetch(`/api/messages?walletAddress=${encodeURIComponent(currentAddrLower)}&sessionId=${encodeURIComponent(sessionId)}`);
                if (response.ok) {
                    const data = await response.json();
                    setRawConversations(data.conversations || []);
                    if (data.messages) {
                        const visible = [...data.messages].reverse().filter((m: MessageData) => isVisibleToMe(m, currentAddrLower));
                        setMessages(visible);
                    }
                } else {
                    console.error('Messages API fetch failed:', response.status);
                }
            }
            setIsLoading(false);
        };

        fetchInitialData();
        const refresh = window.setInterval(fetchInitialData, 15000);
        return () => window.clearInterval(refresh);
    }, [currentUserAddress, isVisibleToMe, ensureAppSession]);

    // 5. Real-time Profile/Status Updates
    useEffect(() => {
        const profileChannel = supabase
            .channel('global-profile-status-sync')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'players' },
                (payload) => {
                    const updatedPlayer = payload.new;
                    const addr = updatedPlayer.wallet_address?.toLowerCase();
                    if (!addr) return;

                    setProfiles(prev => {
                        if (!prev[addr]) return prev; // Only track if we already have this profile

                        // Only update if status actually changed
                        if (prev[addr].status === updatedPlayer.status) return prev;

                        return {
                            ...prev,
                            [addr]: {
                                ...prev[addr],
                                status: updatedPlayer.status || 'Offline'
                            }
                        };
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(profileChannel);
        };
    }, []);

    // Transform raw DB conversations into UI format
    useEffect(() => {
        if (!currentUserAddress) return;
        const currentAddrLower = currentUserAddress.toLowerCase();

        const transformed = rawConversations.map(c => {
            const isA = c.user_a.toLowerCase() === currentAddrLower;
            const otherId = isA ? c.user_b : c.user_a;
            const profile = profiles[otherId.toLowerCase()];
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
                name: profile?.username || `User ${otherId.substring(0, 6)}`,
                avatar: profile?.avatar || '1',
                lastMessage: c.last_message_content,
                time: timeStr,
                unread: unreadCount > 0,
                status: (profile?.status || 'Offline') as 'Online' | 'Offline' | 'In Match',
                timestamp: date.getTime()
            };
        });

        setConversations(transformed);

        // Calculate total unread count
        const total = rawConversations.reduce((sum, c) => {
            const isA = c.user_a.toLowerCase() === currentAddrLower;
            return sum + (isA ? c.unread_count_a : c.unread_count_b);
        }, 0);
        setTotalUnreadCount(total);
    }, [rawConversations, currentUserAddress, profiles]);

    // Separate Profile Fetcher
    useEffect(() => {
        if (!currentUserAddress) return;

        // Get all unique IDs from messages
        const otherPartyIds: string[] = messages.map(m => {
            const currentAddrLower = currentUserAddress.toLowerCase();
            return m.sender_id.toLowerCase() === currentAddrLower ? m.receiver_id.toLowerCase() : m.sender_id.toLowerCase();
        });

        // Also include IDs from conversations
        rawConversations.forEach(c => {
            const currentAddrLower = currentUserAddress.toLowerCase();
            otherPartyIds.push(c.user_a.toLowerCase() === currentAddrLower ? c.user_b.toLowerCase() : c.user_a.toLowerCase());
        });

        // Add selectedChatId if it exists and is not already in profiles
        if (selectedChatId && !profiles[selectedChatId.toLowerCase()]) {
            otherPartyIds.push(selectedChatId.toLowerCase());
        }

        const uniqueIds = Array.from(new Set(otherPartyIds)).filter(id => !!id && !profiles[id]);

        if (uniqueIds.length > 0) {
            const fetchProfiles = async () => {
                const { data, error } = await supabase
                    .from('players')
                    // Baseline directory grant only (last_seen_at is server-only).
                    .select('wallet_address, username, avatar_url, status, last_played_at')
                    .in('wallet_address', uniqueIds);

                if (error) {
                    console.error("Error fetching profiles:", error.message);
                    return;
                }

                if (data) {
                    const now = new Date().getTime();
                    const driftLimit = 5 * 60 * 1000;

                    setProfiles(prev => {
                        const next = { ...prev };
                        data.forEach(p => {
                            const addr = p.wallet_address.toLowerCase();
                            let currentStatus = p.status || 'Offline';

                            // Self-Healing
                            if (currentStatus === 'Online' && p.last_played_at) {
                                const lastSeen = new Date(p.last_played_at).getTime();
                                if (now - lastSeen > driftLimit) {
                                    currentStatus = 'Offline';
                                }
                            }

                            next[addr] = {
                                username: (p.username && !p.username.startsWith('0x')) ? p.username : `User ${addr.substring(0, 6)}`,
                                avatar: p.avatar_url || '1',
                                status: currentStatus
                            };
                        });
                        return next;
                    });
                }
            };
            fetchProfiles();
        }
    }, [messages, rawConversations, currentUserAddress, profiles, selectedChatId]);

    const sendMessage = async (receiverId: string, content: string) => {
        if (!currentUserAddress) return;

        const tempId = 'temp-' + Date.now();
        const optimisticMsg: MessageData = {
            id: tempId,
            sender_id: currentUserAddress.toLowerCase(),
            receiver_id: receiverId.toLowerCase(),
            content: content,
            is_read: false,
            created_at: new Date().toISOString(),
            deleted_by_sender: false,
            deleted_by_receiver: false,
            send_status: 'sending'
        };

        // Optimistically add to UI
        setMessages(prev => [...prev, optimisticMsg]);

        const sessionId = await ensureAppSession();
        const response = sessionId ? await fetch('/api/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: currentUserAddress, sessionId, action: 'send', receiverId, content })
        }) : null;
        const data = response?.ok ? await response.json() : null;
        const error = !response || !response.ok;

        if (error) {
            console.error("CRITICAL: Error sending message");
            // Mark failed in UI
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, send_status: 'failed' } : m));
        } else if (data) {
            // Replace temporary message with successful database record
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, send_status: 'sent' } as MessageData : m));
        }
    };

    const markAsRead = async (senderId: string) => {
        if (!currentUserAddress) return;
        const currentAddrLower = currentUserAddress.toLowerCase();

        // 1. Optimistic update local messages
        setMessages(prev => {
            let changed = false;
            const next = prev.map(m => {
                if (m.sender_id.toLowerCase() === senderId.toLowerCase() &&
                    m.receiver_id.toLowerCase() === currentAddrLower &&
                    !m.is_read) {
                    changed = true;
                    return { ...m, is_read: true };
                }
                return m;
            });
            return changed ? next : prev;
        });

        // 2. Mark messages and recompute sidebar counters through the
        // authenticated server route.
        const sessionId = await ensureAppSession();
        if (sessionId) await fetch('/api/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: currentAddrLower, sessionId, action: 'read', receiverId: senderId })
        });
    };

    const deleteMessageLocal = async (msg: MessageData) => {
        if (!currentUserAddress) return;
        const currentAddrLower = currentUserAddress.toLowerCase();
        const _isMeSender = msg.sender_id.toLowerCase() === currentAddrLower;

        // Optimistically remove from UI
        setMessages(prev => prev.filter(m => m.id !== msg.id));

        const sessionId = await ensureAppSession();
        const response = sessionId && await fetch('/api/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: currentAddrLower, sessionId, action: 'delete', messageId: msg.id })
        });
        const error = !response || !response.ok;

        if (error) {
            console.error("Error deleting message:", error);
            // Revert on failure (could be added)
        }
    };

    return {
        messages,
        conversations,
        isLoading,
        totalUnreadCount,
        sendMessage,
        markAsRead,
        deleteMessageLocal
    };
}
