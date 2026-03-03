"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { useAccount } from 'wagmi';

interface MultiplayerContextType {
    roomId: string;
    connection: DataConnection | null;
    isLobbyConnected: boolean;
    isHost: boolean;
    lastRoll: number | null;
    incomingAction: any;
    hostGame: () => void;
    joinGame: (targetRoomId: string) => void;
    rollDice: () => void;
    sendAction: (type: string, payload?: any) => void;
    myAddress?: string;
}

const MultiplayerContext = createContext<MultiplayerContextType | undefined>(undefined);

const generateShortId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

export const MultiplayerProvider = ({ children }: { children: ReactNode }) => {
    const [roomId, setRoomId] = useState<string>('');
    const [connection, setConnection] = useState<DataConnection | null>(null);
    const [isLobbyConnected, setIsLobbyConnected] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [lastRoll, setLastRoll] = useState<number | null>(null);
    const [incomingAction, setIncomingAction] = useState<any>(null);
    const { address: myAddress } = useAccount();
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
        if (peerRef.current) peerRef.current.destroy();

        setIsHost(true);
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

            conn.on('open', () => {
                console.log('🔗 Connection open to guest');
                if (myAddress) {
                    conn.send({ type: 'SYNC_PROFILE', address: myAddress });
                }
            });

            conn.on('data', (data: any) => {
                console.log('📩 Received data:', data);
                if (data.type === 'ROLL_DICE') {
                    setLastRoll(data.value);
                }
                setIncomingAction(data);
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
        if (peerRef.current) peerRef.current.destroy();

        setIsHost(false);
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', (id) => {
            console.log('🎲 Joiner Peer opened with ID:', id);
            const conn = peer.connect(targetRoomId);

            conn.on('open', () => {
                console.log('✅ Connected to host:', targetRoomId);
                setConnection(conn);
                setIsLobbyConnected(true);
                if (myAddress) {
                    conn.send({ type: 'SYNC_PROFILE', address: myAddress });
                }
            });

            conn.on('data', (data: any) => {
                console.log('📩 Received data:', data);
                if (data.type === 'ROLL_DICE') {
                    setLastRoll(data.value);
                }
                setIncomingAction(data);
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

    return (
        <MultiplayerContext.Provider value={{
            roomId,
            connection,
            isLobbyConnected,
            isHost,
            lastRoll,
            incomingAction,
            myAddress,
            hostGame,
            joinGame,
            rollDice,
            sendAction
        }}>
            {children}
        </MultiplayerContext.Provider>
    );
};

export const useMultiplayerContext = () => {
    const context = useContext(MultiplayerContext);
    if (!context) {
        throw new Error('useMultiplayerContext must be used within a MultiplayerProvider');
    }
    return context;
};
