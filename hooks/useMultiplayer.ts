"use client";

import { useState, useEffect, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';

const generateShortId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

export function useMultiplayer() {
    const [roomId, setRoomId] = useState<string>('');
    const [connection, setConnection] = useState<DataConnection | null>(null);
    const [isLobbyConnected, setIsLobbyConnected] = useState(false);
    const [lastRoll, setLastRoll] = useState<number | null>(null);
    const peerRef = useRef<Peer | null>(null);

    const sendAction = (type: string, payload?: any) => {
        if (connection && connection.open) {
            connection.send({ type, ...payload });
        }
    };

    const rollDice = () => {
        const roll = Math.floor(Math.random() * 6) + 1;
        setLastRoll(roll);
        sendAction('ROLL_DICE', { value: roll });
    };

    const hostGame = () => {
        const customRoomId = generateShortId();
        const peer = new Peer(customRoomId);
        peerRef.current = peer;

        peer.on('open', (id) => {
            console.log('🎲 Peer opened with ID:', id);
            setRoomId(id);
        });

        peer.on('connection', (conn) => {
            console.log('🔗 Incoming connection from:', conn.peer);
            setConnection(conn);
            setIsLobbyConnected(true);

            conn.on('data', (data: any) => {
                console.log('📩 Received data:', data);
                if (data.type === 'ROLL_DICE') {
                    setLastRoll(data.value);
                }
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

            conn.on('data', (data: any) => {
                console.log('📩 Received data:', data);
                if (data.type === 'ROLL_DICE') {
                    setLastRoll(data.value);
                }
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
        lastRoll,
        hostGame,
        joinGame,
        rollDice
    };
}
