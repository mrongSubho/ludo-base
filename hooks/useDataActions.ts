/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
"use client";

import { useCallback } from 'react';
import { useSignMessage } from 'wagmi';
import { UserProfile, MessageData } from './GameDataContext';
import { encryptForPeer, exportPublicKeyJwk, getOrCreateIdentityKey } from '@/lib/encryption';
import { DataConnection, Peer } from 'peerjs';
import { buildEcdhMessage, ecdhKeyFingerprint } from '@/lib/matchProof';
import { useAppSession } from './useAppSession';

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

/** Ensure our static ECDH pubkey is on the players row.
 * Signs only from an explicit user action (Send). Never from panel open. */
async function publishMyEcdhPubkey(
    walletAddress: string,
    signMessageAsync: (args: { account: `0x${string}`; message: string }) => Promise<`0x${string}`>,
): Promise<void> {
    try {
        await getOrCreateIdentityKey(walletAddress);
        const jwk = await exportPublicKeyJwk(walletAddress);
        const issuedAt = new Date().toISOString();
        const message = buildEcdhMessage(walletAddress, await ecdhKeyFingerprint(jwk), issuedAt);
        // Explicit account (matches the SIWE call): without it some
        // connectors resolve the active account ambiguously and reprompt.
        const signature = await signMessageAsync({ account: walletAddress as `0x${string}`, message });
        const res = await fetch('/api/profile/ecdh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress, publicKey: jwk, issuedAt, message, signature }),
        });
        if (res.ok) {
            try {
                localStorage.setItem(`ludo-ecdh-published-${walletAddress.toLowerCase()}`, '1');
            } catch { /* best-effort */ }
        }
    } catch (err) {
        console.warn('Failed to publish ECDH pubkey', err);
    }
}

function ecdhAlreadyPublished(walletAddress: string): boolean {
    try {
        return localStorage.getItem(`ludo-ecdh-published-${walletAddress.toLowerCase()}`) === '1';
    } catch {
        return false;
    }
}

/** Fetch recipient static ECDH pubkey via the session-gated service route
 * (players.ecdh_pubkey is server-only under default-deny — anon reads go empty). */
async function fetchPeerEcdhPubkey(peerId: string, sessionId: string | null, myAddress: string): Promise<JsonWebKey | null> {
    if (!sessionId) return null;
    try {
        const res = await fetch(
            `/api/profile/ecdh?wallet=${encodeURIComponent(peerId.toLowerCase())}&walletAddress=${encodeURIComponent(myAddress.toLowerCase())}&sessionId=${encodeURIComponent(sessionId)}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        const pk = data?.publicKey as unknown as JsonWebKey | null | undefined;
        return pk && typeof pk === 'object' && (pk as JsonWebKey).kty ? (pk as JsonWebKey) : null;
    } catch {
        return null;
    }
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
    const { signMessageAsync } = useSignMessage();
    const { ensureAppSession, peekAppSession } = useAppSession();

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

        const persistedUpdates: Partial<UserProfile> = {};
        if (updates.username !== undefined) persistedUpdates.username = updates.username;
        if (updates.avatar_url !== undefined) persistedUpdates.avatar_url = updates.avatar_url;
        if (updates.peer_id !== undefined) persistedUpdates.peer_id = updates.peer_id;
        if (Object.keys(persistedUpdates).length > 0) {
            // Profile save — never open wallet from a background update.
            void Promise.resolve(peekAppSession()).then(sessionId => {
                if (!sessionId) return;
                return fetch('/api/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        walletAddress: lowerAddr,
                        sessionId,
                        username: persistedUpdates.username,
                        avatarUrl: persistedUpdates.avatar_url,
                        peerId: persistedUpdates.peer_id,
                    }),
                });
            });
        }
    }, [address, peekAppSession, setMyProfile]);

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
            // Session FIRST (at most one shared SIWE popup per intent), then
            // publish our ECDH key ONLY if the server lacks it. A doomed
            // sign (no session, or key already published) is skipped entirely
            // — no popup — and the send fails closed below as before.
            const dmSession = await ensureAppSession();
            if (dmSession) {
                await getOrCreateIdentityKey(lowerAddr);
                if (!ecdhAlreadyPublished(lowerAddr)) {
                    const localJwk = await exportPublicKeyJwk(lowerAddr);
                    const serverJwk = await fetchPeerEcdhPubkey(lowerAddr, dmSession, lowerAddr);
                    if (!serverJwk || JSON.stringify(serverJwk) !== JSON.stringify(localJwk)) {
                        await publishMyEcdhPubkey(lowerAddr, signMessageAsync);
                    }
                }
            }
            let peerJwk = await fetchPeerEcdhPubkey(targetId, dmSession, lowerAddr);
            if (!peerJwk) {
                // One short poll — recipient may be mid-boot publishing their key.
                await new Promise(r => setTimeout(r, 1200));
                peerJwk = await fetchPeerEcdhPubkey(targetId, dmSession, lowerAddr);
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
            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error('Sign-in required to send messages');
            const response = await fetch('/api/messages', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: lowerAddr, sessionId, action: 'send', receiverId: targetId, content: JSON.stringify(encrypted) })
            });
            const data = response.ok ? await response.json() : null;
            const error = response.ok ? null : new Error((await response.json()).error || 'Message send failed');

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
    }, [address, peer, connections, profilesMap, setMessages, setupConnectionListeners, ensureAppSession, signMessageAsync]);

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
            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error('Sign-in required');
            const response = await fetch('/api/messages', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: lowerAddr, sessionId, action: 'read', receiverId: friendLower })
            });
            if (!response.ok) throw new Error('Unable to mark messages read');
        } catch (e) {
            console.warn('mark messages read failed', e);
        }
    }, [address, setMessages, setRawConversations, ensureAppSession]);

    const deleteMessageLocal = useCallback(async (msg: MessageData) => {
        if (!address) return;
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        const sessionId = await ensureAppSession();
        if (!sessionId) return;
        await fetch('/api/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: address, sessionId, action: 'delete', messageId: msg.id })
        });
    }, [address, setMessages, ensureAppSession]);

    /** Never signs. DM open / boot use this only to warm caches if needed.
     * Actual ECDH publish happens on first Send (user gesture). */
    const ensureEcdhPublished = useCallback(async () => {
        /* no-op: open-panel must not popup. See sendMessage(). */
    }, []);

    return {
        updateMyProfileOptimistic,
        sendMessage,
        markChatAsRead,
        deleteMessageLocal,
        ensureEcdhPublished
    };
};
