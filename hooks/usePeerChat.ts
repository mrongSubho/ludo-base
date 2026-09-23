/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Peer, DataConnection } from 'peerjs';
import { UserProfile, MessageData } from './GameDataContext';
import { decryptAnyMessage } from '@/lib/encryption';
import { useAppSession } from './useAppSession';

interface PeerChatProps {
    address: string | undefined;
    setMessages: (fn: (prev: MessageData[]) => MessageData[]) => void;
    setMyProfile: (fn: (prev: UserProfile | null) => UserProfile | null) => void;
}

export const usePeerChat = ({ address, setMessages, setMyProfile }: PeerChatProps) => {
    const [isP2PActive, setIsP2PActive] = useState(false);
    const [peer, setPeer] = useState<Peer | null>(null);
    const [connections, setConnections] = useState<Record<string, DataConnection>>({});
    const { ensureAppSession } = useAppSession();

    const setupConnectionListeners = (conn: DataConnection) => {
        conn.on('open', () => {
            setConnections(prev => ({ ...prev, [conn.peer]: conn }));
        });

        conn.on('data', async (data: any) => {
            console.log("📩 [P2P] Received data:", data);
            if (data.type === 'encrypted-message' && address) {
                try {
                    const senderWallet: string = (data.metadata?.sender_id || '').toLowerCase();
                    if (!senderWallet) throw new Error('missing sender_id');
                    const plainText = await decryptAnyMessage(
                        address.toLowerCase(),
                        typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload),
                        senderWallet
                    );

                    const newMsg: MessageData = {
                        ...data.metadata,
                        content: plainText,
                        is_read: false,
                        created_at: new Date().toISOString(),
                        deleted_by_sender: false,
                        deleted_by_receiver: false,
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
        if (!address || typeof window === 'undefined') return;
        
        const lowerAddr = address.toLowerCase();
        let currentPeer: Peer | null = null;
        let isDestroyed = false;
        let retryTimeout: NodeJS.Timeout;

        const initPeer = () => {
            if (isDestroyed) return;
            
            const uniqueId = `${lowerAddr}-${Math.random().toString(36).substring(2, 7)}`;
            console.log("📡 [P2P] Initializing Peer with Unique ID:", uniqueId);
            
            currentPeer = new Peer(uniqueId, { debug: 1 });

            currentPeer.on('open', (id) => {
                if (isDestroyed) {
                    currentPeer?.destroy();
                    return;
                }
                console.log("✅ [P2P] Connection opened with ID:", id);
                setIsP2PActive(true);
                
                void ensureAppSession().then(sessionId => sessionId ? fetch('/api/presence', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletAddress: lowerAddr, sessionId, status: 'Online', peerId: id })
                }) : null);
                
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
                if (err.type === 'unavailable-id') {
                    currentPeer?.destroy();
                    retryTimeout = setTimeout(initPeer, 2000);
                } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
                    currentPeer?.destroy();
                    retryTimeout = setTimeout(initPeer, 5000);
                }
            });

            setPeer(currentPeer);
        };

        const initialDelay = setTimeout(initPeer, 500);

        return () => {
            isDestroyed = true;
            clearTimeout(initialDelay);
            clearTimeout(retryTimeout);
            if (currentPeer) {
                currentPeer.destroy();
                void ensureAppSession().then(sessionId => sessionId ? fetch('/api/presence', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletAddress: lowerAddr, sessionId, status: 'Offline', peerId: null })
                }) : null);
            }
            setPeer(null);
            setIsP2PActive(false);
        };
    }, [address, ensureAppSession]);

    return {
        isP2PActive,
        peer,
        connections,
        setupConnectionListeners
    };
};
