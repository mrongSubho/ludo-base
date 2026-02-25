'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';

export type Message =
    | { type: 'STATE_UPDATE'; state: any }
    | { type: 'CHAT'; text: string; sender: string }
    | { type: 'JOIN_REQUEST'; name: string };

export const useMultiplayer = (onStateUpdate?: (state: any) => void) => {
    const [peerId, setPeerId] = useState<string>('');
    const [connection, setConnection] = useState<DataConnection | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [status, setStatus] = useState<'idle' | 'host' | 'guest'>('idle');
    const peerRef = useRef<Peer | null>(null);

    useEffect(() => {
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', (id) => {
            setPeerId(id);
        });

        // Handler for incoming connections (Hosting)
        peer.on('connection', (conn) => {
            setIsHost(true);
            setStatus('host');
            setConnection(conn);

            conn.on('data', (data: any) => {
                const msg = data as Message;
                if (msg.type === 'STATE_UPDATE') {
                    onStateUpdate?.(msg.state);
                }
            });

            conn.on('open', () => {
                console.log('Peer connected as guest');
            });
        });

        return () => {
            peer.destroy();
        };
    }, []); // onStateUpdate omitted to avoid re-init

    const connectToPeer = useCallback((targetId: string) => {
        if (!peerRef.current) return;

        const conn = peerRef.current.connect(targetId);
        setConnection(conn);
        setIsHost(false);
        setStatus('guest');

        conn.on('open', () => {
            console.log('Connected to host:', targetId);
        });

        conn.on('data', (data: any) => {
            const msg = data as Message;
            if (msg.type === 'STATE_UPDATE') {
                onStateUpdate?.(msg.state);
            }
        });
    }, [onStateUpdate]);

    const broadcastState = useCallback((state: any) => {
        if (connection && connection.open) {
            connection.send({ type: 'STATE_UPDATE', state });
        }
    }, [connection]);

    return {
        peerId,
        connection,
        isHost,
        status,
        connectToPeer,
        broadcastState
    };
};
