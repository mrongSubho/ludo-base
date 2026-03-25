"use client";

import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { UserProfile, MessageData } from './GameDataContext';
import { encryptMessage, deriveSharedKey } from '@/lib/encryption';
import { DataConnection, Peer } from 'peerjs';

interface ActionProps {
    address: string | undefined;
    peer: Peer | null;
    connections: Record<string, DataConnection>;
    profilesMap: Record<string, UserProfile>;
    setMessages: (fn: (prev: MessageData[]) => MessageData[]) => void;
    setMyProfile: (fn: (prev: UserProfile | null) => UserProfile | null) => void;
    setupConnectionListeners: (conn: DataConnection) => void;
}

export const useDataActions = ({
    address,
    peer,
    connections,
    profilesMap,
    setMessages,
    setMyProfile,
    setupConnectionListeners
}: ActionProps) => {

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

        supabase.from('players').upsert({ wallet_address: lowerAddr, ...updates }, { onConflict: 'wallet_address' });
    }, [address, setMyProfile]);

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
            const key = await deriveSharedKey(lowerAddr, targetId);
            const encrypted = await encryptMessage(content, key);

            // P2P Attempt
            let p2pSent = false;
            const targetProfile = profilesMap[targetId];
            const targetPeerId = targetProfile?.peer_id;
            let conn = targetPeerId ? connections[targetPeerId] : null;

            if (!conn && peer && targetPeerId) {
                conn = peer.connect(targetPeerId);
                setupConnectionListeners(conn);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (conn && conn.open) {
                conn.send({
                    type: 'encrypted-message',
                    payload: encrypted,
                    metadata: { id: tempId, sender_id: lowerAddr, receiver_id: targetId }
                });
                p2pSent = true;
            }

            // Supabase Relay
            const { data, error } = await supabase.from('messages').insert({
                sender_id: lowerAddr,
                receiver_id: targetId,
                content: JSON.stringify(encrypted)
            }).select().single();

            if (error && !p2pSent) {
                setMessages(prev => prev.map(m => m.id === tempId ? { ...m, send_status: 'failed' } : m));
            } else {
                setMessages(prev => prev.map(m => {
                    if (m.id === tempId) {
                        const merged = { ...(data || optimisticMsg) };
                        return { 
                            ...merged,
                            content: content, 
                            send_status: 'sent' as const,
                            deleted_by_sender: !!merged.deleted_by_sender,
                            deleted_by_receiver: !!merged.deleted_by_receiver
                        } as MessageData;
                    }
                    return m;
                }));
            }

        } catch (err) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, send_status: 'failed' } : m));
        }
    }, [address, peer, connections, profilesMap, setMessages, setupConnectionListeners]);

    const markChatAsRead = useCallback(async (senderId: string) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();

        setMessages(prev => prev.map(m => {
            if (m.sender_id.toLowerCase() === senderId.toLowerCase() && m.receiver_id.toLowerCase() === lowerAddr && !m.is_read) {
                return { ...m, is_read: true };
            }
            return m;
        }));

        supabase.rpc('mark_conversation_read', { me: lowerAddr, friend: senderId.toLowerCase() });
        supabase.from('messages').update({ is_read: true }).ilike('sender_id', senderId).ilike('receiver_id', lowerAddr).eq('is_read', false);
    }, [address, setMessages]);

    const deleteMessageLocal = useCallback(async (msg: MessageData) => {
        if (!address) return;
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        supabase.from('messages').update({ deleted_by_sender: true, deleted_by_receiver: true }).eq('id', msg.id);
    }, [address, setMessages]);

    return {
        updateMyProfileOptimistic,
        sendMessage,
        markChatAsRead,
        deleteMessageLocal
    };
};
