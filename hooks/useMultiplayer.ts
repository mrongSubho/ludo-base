"use client";

import { useState, useEffect, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';

export function useMultiplayer() {
    const [roomId, setRoomId] = useState<string>('');
    const [connection, setConnection] = useState<DataConnection | null>(null);
    const [isLobbyConnected, setIsLobbyConnected] = useState(false);
    const peerRef = useRef<Peer | null>(null);

    const hostGame = () => {
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', (id) => {
            console.log('🎲 Peer opened with ID:', id);
            setRoomId(id);
        });

        peer.on('connection', (conn) => {
            console.log('🔗 Incoming connection from:', conn.peer);
            setConnection(conn);
            setIsLobbyConnected(true);

            conn.on('data', (data) => {
                console.log('📩 Received data:', data);
            });

            conn.on('close', () => {
                console.log('❌ Connection closed');
                setIsLobbyConnected(false);
                setConnection(null);
            });
        });

        peer.on('error', (err) => {
            console.error('❌ Peer error:', err);
        });
    };

    const joinGame = (targetRoomId: string) => {
        if (!targetRoomId) return;

        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', (id) => {
            console.log('🎲 Joiner Peer opened with ID:', id);
            const conn = peer.connect(targetRoomId);

            conn.on('open', () => {
                console.log('✅ Connected to host:', targetRoomId);
                setConnection(conn);
                setIsLobbyConnected(true);
            });

            conn.on('data', (data) => {
                console.log('📩 Received data:', data);
            });

            conn.on('close', () => {
                console.log('❌ Connection closed');
                setIsLobbyConnected(false);
                setConnection(null);
            });
        });

        peer.on('error', (err) => {
            console.error('❌ Peer error:', err);
        });
    };

    useEffect(() => {
        return () => {
            if (peerRef.current) {
                peerRef.current.destroy();
            }
        };
    }, []);

    return {
        roomId,
        connection,
        isLobbyConnected,
        hostGame,
        joinGame
    };
}
