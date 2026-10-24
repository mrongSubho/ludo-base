/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
"use client";

import { useCallback } from 'react';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import { UserProfile, MessageData } from './GameDataContext';
import { encryptForPeer, exportPublicKeyJwk, getOrCreateIdentityKey, takeIdentityRegenerated } from '@/lib/encryption';
import { DataConnection, Peer } from 'peerjs';
import { buildEcdhMessage, ecdhKeyFingerprint } from '@/lib/matchProof';
import { useAppSession } from './useAppSession';
import { showAuthPrompt } from '@/hooks/useAuthPrompt';
import { supabase } from '@/lib/supabase';
import { SEND_ERROR_MESSAGE } from '@/lib/sendErrors';
import { saveOutboxMessage, removeOutboxMessage } from '@/lib/messageOutbox';

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
    isIngame = false,
): Promise<void> {
    let cleanupModal: (() => void) | undefined;
    try {
        await getOrCreateIdentityKey(walletAddress);
        const jwk = await exportPublicKeyJwk(walletAddress);
        const issuedAt = new Date().toISOString();
        const message = buildEcdhMessage(walletAddress, await ecdhKeyFingerprint(jwk), issuedAt);
        // Explicit account (matches the SIWE call): without it some
        // connectors resolve the active account ambiguously and reprompt.
        if (!isIngame) {
            cleanupModal = showAuthPrompt({
                context: 'messaging',
                title: 'ENCRYPTION SETUP REQUIRED',
                statusText: 'Please approve the one-time encryption registration in your wallet to enable end-to-end encrypted messaging.',
            });
        }
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
        } else {
            const errData = await res.json().catch(() => ({}));
            console.error('[ecdh] publish failed', res.status, errData);
        }
    } catch (err) {
        console.warn('Failed to publish ECDH pubkey', err);
    } finally {
        cleanupModal?.();
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
            `/api/profile/ecdh?wallet=${encodeURIComponent(peerId.toLowerCase())}&walletAddress=${encodeURIComponent(myAddress.toLowerCase())}`,
            {
                headers: {
                    'x-session-id': sessionId,
                    Authorization: `Bearer ${sessionId}`,
                },
            }
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
    const player = usePlayerSigner();
    const signMessageAsync = player.signMessageAsync;
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
        saveOutboxMessage(lowerAddr, optimisticMsg);

        const failMessage = (errorMsg: string) => {
            const failedItem: MessageData = { ...optimisticMsg, send_status: 'failed', send_error: errorMsg, content };
            setMessages(prev => prev.map(m => m.id === tempId ? failedItem : m));
            saveOutboxMessage(lowerAddr, failedItem);
        };

        try {
            const dmSession = await ensureAppSession();
            if (!dmSession) {
                failMessage(SEND_ERROR_MESSAGE.auth);
                return;
            }

            await getOrCreateIdentityKey(lowerAddr);
            // CRY-06: a regenerated identity no longer matches the
            // published key, so every future DM would be undecryptable.
            // Consume the flag loudly; the server-key mismatch compare
            // below republishes on this same Send, and a failed publish
            // fails the send with `send_status: 'failed'` UI state
            // instead of swallowing the rotation.
            if (takeIdentityRegenerated().includes(lowerAddr)) {
                console.warn('[ecdh] identity regenerated — republishing before send; pre-rotation DMs may be unreadable');
            }
            if (!ecdhAlreadyPublished(lowerAddr)) {
                const localJwk = await exportPublicKeyJwk(lowerAddr);
                const serverJwk = await fetchPeerEcdhPubkey(lowerAddr, dmSession, lowerAddr);
                const isMatch = serverJwk && serverJwk.x === localJwk.x && serverJwk.y === localJwk.y && serverJwk.crv === localJwk.crv;
                if (!isMatch) {
                    await publishMyEcdhPubkey(lowerAddr, signMessageAsync, player.mode === 'ingame');
                } else {
                    try {
                        localStorage.setItem(`ludo-ecdh-published-${lowerAddr}`, '1');
                    } catch { /* best-effort */ }
                }
            }

            let peerJwk = await fetchPeerEcdhPubkey(targetId, dmSession, lowerAddr);
            if (!peerJwk) {
                // One short poll — recipient may be mid-boot publishing their key.
                await new Promise(r => setTimeout(r, 1200));
                peerJwk = await fetchPeerEcdhPubkey(targetId, dmSession, lowerAddr);
            }
            if (!peerJwk) {
                // Fail closed (no plaintext). Message stays retryable with clear reason.
                const peerReason = "Recipient hasn't registered encryption keys yet. Ask them to open messages.";
                failMessage(peerReason);
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

            // Supabase Relay (carry session header per P0-11)
            const response = await fetch('/api/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-session-id': dmSession,
                    Authorization: `Bearer ${dmSession}`,
                },
                body: JSON.stringify({ walletAddress: lowerAddr, sessionId: dmSession, action: 'send', receiverId: targetId, content: JSON.stringify(encrypted) })
            });
            const data = response.ok ? await response.json() : null;
            // The server now always sends { error, code, detail }. Keep the
            // human sentence so the bubble can say WHY it failed, not just that
            // it did.
            const failure = response.ok
                ? null
                : await response.json().catch(() => null);
            const error = response.ok
                ? null
                : new Error(failure?.detail || failure?.error || (response.status === 401 ? SEND_ERROR_MESSAGE.auth : SEND_ERROR_MESSAGE.db_write));

            if (error && !p2pSent) {
                failMessage(error?.message || SEND_ERROR_MESSAGE.server);
            } else {
                removeOutboxMessage(lowerAddr, tempId);
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

                // Nudge recipient's inbox topic so their client refetches immediately
                try {
                    const ch = supabase.channel(`dm-inbox-${targetId.toLowerCase()}`);
                    ch.subscribe((status) => {
                        if (status === 'SUBSCRIBED') {
                            ch.send({
                                type: 'broadcast',
                                event: 'message',
                                payload: { from: lowerAddr, at: Date.now() },
                            }).finally(() => {
                                setTimeout(() => supabase.removeChannel(ch), 1000);
                            });
                        }
                    });
                } catch { /* best-effort */ }
            }

        } catch (err) {
            console.error('sendMessage failed', err);
            // The request never completed — that is a network/reachability failure,
            // not a server rejection, so say so rather than showing a generic one.
            const reason = err instanceof Error && err.message
                ? err.message
                : SEND_ERROR_MESSAGE.network;
            failMessage(reason);
        }
    }, [address, peer, connections, profilesMap, setMessages, setupConnectionListeners, ensureAppSession, signMessageAsync, player.mode]);

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
        const lowerAddr = address.toLowerCase();
        removeOutboxMessage(lowerAddr, msg.id);
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        const sessionId = await ensureAppSession();
        if (!sessionId) return;
        await fetch('/api/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: address, sessionId, action: 'delete', messageId: msg.id })
        });
    }, [address, setMessages, ensureAppSession]);

    /** Ensure this device's public key is registered on the server.
     * Checks if server already has the key; auto-publishes for in-game wallets
     * or on explicit action (force = true). */
    const ensureEcdhPublished = useCallback(async (force = false) => {
        if (!address) return;
        const lowerAddr = address.toLowerCase();
        const sid = peekAppSession();
        if (!sid) return;

        try {
            await getOrCreateIdentityKey(lowerAddr);
            const localJwk = await exportPublicKeyJwk(lowerAddr);

            if (!ecdhAlreadyPublished(lowerAddr)) {
                const serverJwk = await fetchPeerEcdhPubkey(lowerAddr, sid, lowerAddr);
                const isMatch = serverJwk && serverJwk.x === localJwk.x && serverJwk.y === localJwk.y && serverJwk.crv === localJwk.crv;
                if (isMatch) {
                    try {
                        localStorage.setItem(`ludo-ecdh-published-${lowerAddr}`, '1');
                    } catch { /* best-effort */ }
                    return;
                }
            }

            // In-game wallets have autoSign; explicit force (e.g. Activate Session) also publishes
            if (force || player.mode === 'ingame') {
                if (!ecdhAlreadyPublished(lowerAddr)) {
                    await publishMyEcdhPubkey(lowerAddr, signMessageAsync, player.mode === 'ingame');
                }
            }
        } catch (err) {
            console.warn('[ecdh] ensureEcdhPublished failed', err);
        }
    }, [address, peekAppSession, player.mode, signMessageAsync]);

    return {
        updateMyProfileOptimistic,
        sendMessage,
        markChatAsRead,
        deleteMessageLocal,
        ensureEcdhPublished
    };
};
