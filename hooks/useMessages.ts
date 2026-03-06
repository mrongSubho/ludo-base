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

export function useMessages(currentUserAddress: string | undefined | null) {
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [profiles, setProfiles] = useState<Record<string, { username: string, avatar: string }>>({});
    const [isLoading, setIsLoading] = useState(false);

    // Filter helper to determine if a message should be visible to the current user
    const isVisibleToMe = useCallback((msg: MessageData, myAddr: string) => {
        const lowerAddr = myAddr.toLowerCase();
        if (msg.sender_id.toLowerCase() === lowerAddr && msg.deleted_by_sender) return false;
        if (msg.receiver_id.toLowerCase() === lowerAddr && msg.deleted_by_receiver) return false;
        return true;
    }, []);

    // Fetch initial messages when user address is known
    useEffect(() => {
        if (!currentUserAddress) return;

        const currentAddrLower = currentUserAddress.toLowerCase();

        const fetchMessages = async () => {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .or(`sender_id.ilike.${currentAddrLower},receiver_id.ilike.${currentAddrLower}`)
                .order('created_at', { ascending: false }) // newest first for limit
                .limit(30);

            if (error) {
                console.error("Error fetching messages:", error);
            } else if (data) {
                // Reverse to get chronological order, then filter out deleted ones
                const visible = data.reverse().filter(m => isVisibleToMe(m, currentAddrLower));
                setMessages(visible);
            }
            setIsLoading(false);
        };

        fetchMessages();

        // Subscribe to real-time incoming or outgoing messages
        const channel = supabase
            .channel(`messages-realtime-${currentAddrLower}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => {
                    const newMsg = payload.new as MessageData;
                    if (
                        newMsg.sender_id.toLowerCase() === currentAddrLower ||
                        newMsg.receiver_id.toLowerCase() === currentAddrLower
                    ) {
                        setMessages((prev) => {
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            if (!isVisibleToMe(newMsg, currentAddrLower)) return prev;
                            const newArr = [...prev, newMsg];
                            if (newArr.length > 50) return newArr.slice(newArr.length - 50);
                            return newArr;
                        });
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'messages' },
                (payload) => {
                    const updatedMsg = payload.new as MessageData;
                    if (
                        updatedMsg.sender_id.toLowerCase() === currentAddrLower ||
                        updatedMsg.receiver_id.toLowerCase() === currentAddrLower
                    ) {
                        setMessages((prev) => {
                            if (!isVisibleToMe(updatedMsg, currentAddrLower)) {
                                return prev.filter(m => m.id !== updatedMsg.id);
                            }
                            return prev.map(m => m.id === updatedMsg.id ? updatedMsg : m);
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [currentUserAddress, isVisibleToMe]);

    // Derive conversations from messages
    useEffect(() => {
        if (!currentUserAddress) return;
        const currentAddrLower = currentUserAddress.toLowerCase();

        const convoMap = new Map<string, { lastMsg: MessageData, unreadCount: number }>();

        // Sort messages to find the truly last one
        const sortedMsgs = [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        sortedMsgs.forEach(msg => {
            const isMeSender = msg.sender_id.toLowerCase() === currentAddrLower;
            const otherUser = isMeSender ? msg.receiver_id : msg.sender_id;
            const otherUserLower = otherUser.toLowerCase();

            const current = convoMap.get(otherUserLower);
            convoMap.set(otherUserLower, {
                lastMsg: msg,
                unreadCount: (!isMeSender && !msg.is_read) ? (current?.unreadCount || 0) + 1 : (current?.unreadCount || 0)
            });
        });

        // Convert map to Conversation array
        const derivedConvos: Conversation[] = Array.from(convoMap.entries()).map(([otherId, data]) => {
            const date = new Date(data.lastMsg.created_at);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHrs = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHrs / 24);

            let timeStr = 'Just now';
            if (diffDays > 0) timeStr = `${diffDays}d ago`;
            else if (diffHrs > 0) timeStr = `${diffHrs}h ago`;
            else if (diffMins > 0) timeStr = `${diffMins}m ago`;

            const profile = profiles[otherId.toLowerCase()];

            return {
                id: otherId,
                name: profile?.username || `User ${otherId.substring(0, 6)}`,
                avatar: profile?.avatar || '1',
                lastMessage: data.lastMsg.content,
                time: timeStr,
                unread: data.unreadCount > 0,
                status: 'Offline', // placeholder
                timestamp: date.getTime()
            };
        });

        derivedConvos.sort((a, b) => b.timestamp - a.timestamp);
        setConversations(derivedConvos);
    }, [messages, currentUserAddress, profiles]);

    // Separate Profile Fetcher
    useEffect(() => {
        const otherPartyIds = Array.from(new Set(messages.map(m => {
            const currentAddrLower = currentUserAddress?.toLowerCase();
            return m.sender_id.toLowerCase() === currentAddrLower ? m.receiver_id.toLowerCase() : m.sender_id.toLowerCase();
        })));

        const missingIds = otherPartyIds.filter(id => !profiles[id]);
        if (missingIds.length > 0) {
            const fetchProfiles = async () => {
                const { data } = await supabase
                    .from('players')
                    .select('wallet_address, username, avatar_url')
                    .in('wallet_address', missingIds);

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
    }, [messages, currentUserAddress, profiles]);

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

        // Mark messages where senderId equals the other person, and receiver is me
        const { error } = await supabase
            .from('messages')
            .update({ is_read: true })
            .ilike('sender_id', senderId)
            .ilike('receiver_id', currentUserAddress)
            .eq('is_read', false);

        if (error) {
            console.error("Error marking messages as read:", error);
            return;
        }

        // Optimistically update local state to reflect read
        setMessages(prev => prev.map(m => {
            if (m.sender_id.toLowerCase() === senderId.toLowerCase() &&
                m.receiver_id.toLowerCase() === currentUserAddress.toLowerCase() &&
                !m.is_read) {
                return { ...m, is_read: true };
            }
            return m;
        }));
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
