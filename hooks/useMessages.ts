import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

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
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [rawConversations, setRawConversations] = useState<any[]>([]);
    const [profiles, setProfiles] = useState<Record<string, { username: string, avatar: string }>>({});
    const [isLoading, setIsLoading] = useState(false);

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

            // 1. Fetch Conversations sidebar
            const { data: convoData, error: convoError } = await supabase
                .from('conversations')
                .select('*')
                .or(`user_a.eq.${currentAddrLower},user_b.eq.${currentAddrLower}`)
                .order('last_message_at', { ascending: false });

            if (convoError) {
                console.warn("Conversations table probably missing. Run db_optimize.sql:", convoError.message);
            } else if (convoData) {
                setRawConversations(convoData);
            }

            // 2. Fetch Recent Messages
            const { data: msgData, error: msgError } = await supabase
                .from('messages')
                .select('*')
                .or(`sender_id.ilike.${currentAddrLower},receiver_id.ilike.${currentAddrLower}`)
                .order('created_at', { ascending: false })
                .limit(30);

            if (msgError) {
                console.error("Error fetching messages:", msgError.message);
            } else if (msgData) {
                const visible = msgData.reverse().filter(m => isVisibleToMe(m, currentAddrLower));
                setMessages(visible);
            }
            setIsLoading(false);
        };

        fetchInitialData();

        // 3. Real-time Messages
        const msgChannel = supabase
            .channel(`messages-realtime-${currentAddrLower}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => {
                    const newMsg = payload.new as MessageData;
                    if (isVisibleToMe(newMsg, currentAddrLower)) {
                        setMessages((prev) => {
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            const newArr = [...prev, newMsg];
                            return newArr.slice(-50);
                        });
                    }
                }
            )
            .subscribe();

        // 4. Real-time Conversations (sidebar updates)
        const convoChannel = supabase
            .channel(`conversations-realtime-${currentAddrLower}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'conversations' },
                (payload) => {
                    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                        const newConvo = payload.new;
                        if (newConvo.user_a === currentAddrLower || newConvo.user_b === currentAddrLower) {
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

        return () => {
            supabase.removeChannel(msgChannel);
            supabase.removeChannel(convoChannel);
        };
    }, [currentUserAddress, isVisibleToMe]);

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
                status: 'Offline' as const,
                timestamp: date.getTime()
            };
        });

        setConversations(transformed);
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
                    .select('wallet_address, username, avatar_url')
                    .in('wallet_address', uniqueIds);

                if (error) {
                    console.error("Error fetching profiles:", error.message);
                    return;
                }

                if (data) {
                    setProfiles(prev => {
                        const next = { ...prev };
                        data.forEach(p => {
                            const addr = p.wallet_address.toLowerCase();
                            next[addr] = {
                                username: (p.username && !p.username.startsWith('0x')) ? p.username : `User ${addr.substring(0, 6)}`,
                                avatar: p.avatar_url || '1'
                            };
                        });
                        return next;
                    });
                }
            };
            fetchProfiles();
        }
    }, [messages, rawConversations, currentUserAddress, profiles]);

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

        const { data, error } = await supabase.from('messages').insert({
            sender_id: currentUserAddress.toLowerCase(),
            receiver_id: receiverId.toLowerCase(),
            content: content
        }).select().single();

        if (error) {
            console.error("Error sending message:", error);
            // Mark failed in UI
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, send_status: 'failed' } : m));
        } else if (data) {
            // Replace temporary message with successful database record
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, send_status: 'sent' } : m));
        }
    };

    const markAsRead = async (senderId: string) => {
        if (!currentUserAddress) return;
        const currentAddrLower = currentUserAddress.toLowerCase();

        // 1. Optimistic update local messages
        setMessages(prev => prev.map(m => {
            if (m.sender_id.toLowerCase() === senderId.toLowerCase() &&
                m.receiver_id.toLowerCase() === currentAddrLower &&
                !m.is_read) {
                return { ...m, is_read: true };
            }
            return m;
        }));

        // 2. Clear unread count in conversations table (for sidebar UI)
        try {
            await supabase.rpc('mark_conversation_read', {
                me: currentAddrLower,
                friend: senderId.toLowerCase()
            });
        } catch (e) {
            console.warn("RPC mark_conversation_read failed (table probably missing)");
        }

        // 3. Mark individual messages as read in DB
        await supabase
            .from('messages')
            .update({ is_read: true })
            .ilike('sender_id', senderId)
            .ilike('receiver_id', currentAddrLower)
            .eq('is_read', false);
    };

    const deleteMessageLocal = async (msg: MessageData) => {
        if (!currentUserAddress) return;
        const currentAddrLower = currentUserAddress.toLowerCase();
        const isMeSender = msg.sender_id.toLowerCase() === currentAddrLower;

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
            // Revert on failure (could be added)
        }
    };

    return {
        messages,
        conversations,
        isLoading,
        sendMessage,
        markAsRead,
        deleteMessageLocal
    };
}
