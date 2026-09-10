"use client";

import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { UserProfile, MessageData } from './GameDataContext';
import { encryptForPeer, exportPublicKeyJwk, getOrCreateIdentityKey } from '@/lib/encryption';
import { DataConnection, Peer } from 'peerjs';

interface ActionProps {
    address: string | undefined;
    peer: Peer | null;
    connections: Record<string, DataConnection>;
    profilesMap: Record<string, UserProfile>;
    setMessages: React.Dispatch<React.SetStateAction<MessageData[]>>;
    setMyProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
    setRawConversations: React.Dispatch<React.SetStateAction<any[]>>;
    setupConnectionListeners: (conn: DataConnection) => void;
}

/** Ensure our static ECDH pubkey is on the players row. */
async function publishMyEcdhPubkey(walletAddress: string): Promise<void> {
    try {
        await getOrCreateIdentityKey(walletAddress);
        const jwk = await exportPublicKeyJwk(walletAddress);
        await supabase.from('players')
            .upsert({ wallet_address: walletAddress.toLowerCase(), ecdh_pubkey: jwk }, { onConflict: 'wallet_address' });
    } catch (err) {
        console.warn('Failed to publish ECDH pubkey', err);
    }
}

/** Fetch recipient static ECDH pubkey (cache in profilesMap not required). */
async function fetchPeerEcdhPubkey(peerId: string): Promise<JsonWebKey | null> {
    const { data } = await supabase
        .from('players')
        .select('ecdh_pubkey')
        .ilike('wallet_address', peerId)
        .maybeSingle();
    const pk = data?.ecdh_pubkey as JsonWebKey | null | undefined;
    return pk && typeof pk === 'object' && (pk as JsonWebKey).kty ? (pk as JsonWebKey) : null;
}

export const useDataActions = ({
    address,
    peer,
    connections,
    profilesMap,
    setMessages,
    setMyProfile,
    setRawConversations,
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
                lxp: 0,
                rxp: 0,
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
            await publishMyEcdhPubkey(lowerAddr);
            let peerJwk = await fetchPeerEcdhPubkey(targetId);
            if (!peerJwk) {
                // One short poll — recipient may be mid-boot publishing their key.
                await new Promise(r => setTimeout(r, 1200));
                peerJwk = await fetchPeerEcdhPubkey(targetId);
            }
            if (!peerJwk) {
                // Fail closed (no plaintext). Message stays retryable.
                setMessages(prev => prev.map(m => m.id === tempId
                    ? { ...m, send_status: 'failed', content: content }
                    : m));
                console.warn('Recipient has no ECDH pubkey yet — cannot seal DM', targetId);
                return;
            }

            const encrypted = await encryptForPeer(lowerAddr, peerJwk, content);

            // Ensure both ends exist or the messages FK rejects the insert.
            try {
                await supabase.from('players').upsert([
                    { wallet_address: lowerAddr },
                    { wallet_address: targetId },
                ], { onConflict: 'wallet_address', ignoreDuplicates: true });
            } catch {
                /* pre-registration is best-effort */
            }

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
            console.error('sendMessage failed', err);
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, send_status: 'failed' } : m));
        }
    }, [address, peer, connections, profilesMap, setMessages, setupConnectionListeners]);

    const markChatAsRead = useCallback(async (senderId: string) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        const friendLower = senderId.toLowerCase();

        setMessages(prev => prev.map(m => {
            if (m.sender_id.toLowerCase() === friendLower && m.receiver_id.toLowerCase() === lowerAddr && !m.is_read) {
                return { ...m, is_read: true };
            }
            return m;
        }));

        setRawConversations(prev => prev.map(c => {
            const a = (c.user_a || '').toLowerCase();
            const b = (c.user_b || '').toLowerCase();
            const involves = (a === lowerAddr && b === friendLower) || (b === lowerAddr && a === friendLower);
            if (!involves) return c;
            return { ...c, unread_count_a: 0, unread_count_b: 0 };
        }));

        try {
            const { error } = await supabase.rpc('mark_conversation_read', { me: lowerAddr, friend: friendLower });
            if (error) throw error;
        } catch (e) {
            console.warn('mark_conversation_read RPC failed, falling back to direct update', e);
            supabase.from('messages').update({ is_read: true }).ilike('sender_id', senderId).ilike('receiver_id', lowerAddr).eq('is_read', false);
        }
    }, [address, setMessages, setRawConversations]);

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
