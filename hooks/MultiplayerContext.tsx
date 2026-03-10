"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { useAccount } from 'wagmi';
import { handleThreeSixes, getNextPlayer } from '@/lib/gameLogic';

// --- Types ---
export type GameActionType = 'ROLL_DICE' | 'MOVE_TOKEN' | 'SYNC_STATE' | 'TURN_SWITCH' | 'SYNC_PROFILE' | 'START_GAME';
export type GameIntentType = 'REQUEST_ROLL' | 'REQUEST_MOVE';

export type PlayerColor = 'green' | 'red' | 'yellow' | 'blue';
export type PowerType = 'shield' | 'boost' | 'bomb' | 'warp';

export interface GameState {
    positions: {
        green: number[];
        red: number[];
        yellow: number[];
        blue: number[];
    };
    currentPlayer: 'green' | 'red' | 'yellow' | 'blue';
    diceValue: number | null;
    gamePhase: 'rolling' | 'moving';
    status: 'waiting' | 'playing' | 'finished';
    winner: string | null;
    winners: string[];
    captureMessage: string | null;
    timeLeft: number;
    strikes: Record<PlayerColor, number>;
    powerTiles: { r: number, c: number }[];
    playerPowers: Record<PlayerColor, PowerType | null>;
    activeTraps: { r: number, c: number, owner: PlayerColor }[];
    activeShields: { color: PlayerColor, tokenIdx: number }[];
    consecutiveSixes: number;
    isStarted: boolean;
    lastUpdate: number;
    playerCount: '1v1' | '4P' | '2v2';
    lastAction?: { type: GameActionType, payload: any };
    initialBoardConfig?: {
        players: any[];
        colorCorner: any;
    };
}

interface MultiplayerContextType {
    roomId: string;
    connection: DataConnection | null;
    isLobbyConnected: boolean;
    isHost: boolean;
    gameState: GameState;
    hostGame: () => void;
    joinGame: (targetRoomId: string) => void;
    sendIntent: (type: GameIntentType, payload?: any) => void;
    // Actions only the host should call directly
    broadcastAction: (type: GameActionType, payload?: any) => void;
    myAddress?: string;
    updateGameState: (newState: Partial<GameState>) => void;
    participants: Record<string, { username: string; avatar_url: string }>;
}

const MultiplayerContext = createContext<MultiplayerContextType | undefined>(undefined);

const generateShortId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const INITIAL_GAME_STATE: GameState = {
    positions: {
        green: [-1, -1, -1, -1],
        red: [-1, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1],
    },
    currentPlayer: 'green',
    diceValue: null,
    gamePhase: 'rolling',
    status: 'waiting',
    winner: null,
    winners: [],
    captureMessage: null,
    timeLeft: 15,
    strikes: { green: 0, red: 0, yellow: 0, blue: 0 },
    powerTiles: [],
    playerPowers: { green: null, red: null, yellow: null, blue: null },
    activeTraps: [],
    activeShields: [],
    consecutiveSixes: 0,
    isStarted: false,
    lastUpdate: Date.now(),
    playerCount: '4P'
};

const MultiplayerProvider = ({ children }: { children: ReactNode }) => {
    const [roomId, setRoomId] = useState('');
    const [connection, setConnection] = useState<DataConnection | null>(null);
    const [isLobbyConnected, setIsLobbyConnected] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
    const [participants, setParticipants] = useState<Record<string, { username: string; avatar_url: string }>>({});
    const { address: myAddress } = useAccount();

    const peerRef = useRef<Peer | null>(null);
    const heartbeatTimerRef = useRef<any>(null);

    const broadcastAction = (type: GameActionType, payload?: any) => {
        if (!isHost || !connection || !connection.open) return;

        // Update local state if it's a state-changing action
        if (type === 'START_GAME') {
            setGameState(prev => ({
                ...prev,
                isStarted: true,
                playerCount: payload.playerCount || prev.playerCount,
                initialBoardConfig: payload.initialBoardConfig
            }));
        }

        connection.send({
            type,
            ...payload,
            gameState: type === 'SYNC_STATE' ? gameState : { ...gameState, lastAction: { type, payload } }
        });
    };

    const sendIntent = (type: GameIntentType, payload?: any) => {
        if (isHost) {
            // If host, process directly
            if (type === 'REQUEST_ROLL') {
                const roll = Math.floor(Math.random() * 6) + 1;
                setGameState(prev => ({ ...prev, diceValue: roll, gamePhase: 'moving' }));
                broadcastAction('ROLL_DICE', { value: roll });
            }
        } else if (connection && connection.open) {
            connection.send({ type, payload });
        }
    };

    const updateGameState = (newState: Partial<GameState>) => {
        setGameState(prev => ({
            ...prev,
            ...newState,
            lastUpdate: Date.now()
        }));
    };

    // --- Peer Setup ---

    const hostGame = () => {
        if (peerRef.current) peerRef.current.destroy();

        setIsHost(true);
        const customRoomId = generateShortId();
        const peer = new Peer(customRoomId);
        peerRef.current = peer;

        peer.on('open', (id) => {
            console.log('🎲 Host Peer opened:', id);
            setRoomId(id);
        });

        peer.on('connection', (conn) => {
            console.log('🔗 Lobby connection:', conn.peer);
            setConnection(conn);
            setIsLobbyConnected(true);

            conn.on('open', () => {
                if (myAddress) {
                    conn.send({ type: 'SYNC_PROFILE', address: myAddress });
                }
                // Initial sync
                conn.send({ type: 'SYNC_STATE', gameState });
            });

            conn.on('data', (data: any) => {
                console.log('📩 Host received data:', data.type, data);

                // Host handles Intents from Guest
                if (data.type === 'REQUEST_ROLL') {
                    const roll = Math.floor(Math.random() * 6) + 1;
                    const { isThreeSixes, nextSixes } = handleThreeSixes(gameState.consecutiveSixes, roll);
                    const activeColors = gameState.initialBoardConfig?.players.map((p: any) => p.color as PlayerColor);

                    if (isThreeSixes) {
                        const nextPlayer = getNextPlayer(
                            gameState.currentPlayer,
                            gameState.playerCount,
                            activeColors,
                            gameState.initialBoardConfig?.colorCorner
                        );
                        const updated = {
                            ...gameState,
                            diceValue: roll,
                            consecutiveSixes: 0,
                            gamePhase: 'rolling' as const,
                            currentPlayer: nextPlayer,
                            captureMessage: 'Three 6s! Turn passed.'
                        };
                        setGameState(updated);
                        broadcastAction('ROLL_DICE', { value: roll });
                        broadcastAction('TURN_SWITCH', { nextPlayer });
                    } else {
                        const updated = { ...gameState, diceValue: roll, consecutiveSixes: nextSixes };
                        setGameState(updated);
                        broadcastAction('ROLL_DICE', { value: roll });
                    }
                }
                else if (data.type === 'REQUEST_MOVE') {
                    // Phase 2 will handle logic, for now we just acknowledge
                    broadcastAction('MOVE_TOKEN', data.payload);
                } else if (data.type === 'SYNC_PROFILE') {
                    console.log('👤 Syncing profile for:', data.address);
                    setParticipants(prev => ({
                        ...prev,
                        [data.address.toLowerCase()]: {
                            username: data.username || 'Guest',
                            avatar_url: data.avatar_url || ''
                        }
                    }));
                    // Send host profile back to guest
                    if (myAddress) {
                        conn.send({
                            type: 'SYNC_PROFILE',
                            address: myAddress,
                            username: 'Host', // In real app, fetch from Supabase
                            avatar_url: ''
                        });
                    }
                }
            });

            conn.on('close', () => {
                console.log('❌ Connection closed');
                setIsLobbyConnected(false);
                setConnection(null);
            });

            // Heartbeat system: Host broadcasts full state every 5 seconds
            const heartbeat = setInterval(() => {
                if (isHost && conn.open) {
                    conn.send({ type: 'SYNC_STATE', gameState });
                }
            }, 5000);

            return () => clearInterval(heartbeat);
        });
    };

    const joinGame = (targetRoomId: string) => {
        if (!targetRoomId) return;
        if (peerRef.current) peerRef.current.destroy();

        setIsHost(false);
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', (id) => {
            console.log('🎲 Guest Peer opened:', id);
            const conn = peer.connect(targetRoomId);

            conn.on('open', () => {
                setConnection(conn);
                setIsLobbyConnected(true);
                if (myAddress) {
                    conn.send({ type: 'SYNC_PROFILE', address: myAddress });
                }
            });

            conn.on('data', (data: any) => {
                console.log('📩 Guest received data:', data.type, data);

                // Guest handles Actions from Host
                if (data.type === 'SYNC_STATE') {
                    setGameState(data.gameState);
                } else if (data.type === 'ROLL_DICE') {
                    setGameState(prev => ({
                        ...prev,
                        diceValue: data.value,
                        gamePhase: 'moving',
                        lastAction: { type: 'ROLL_DICE', payload: data }
                    }));
                } else if (data.type === 'START_GAME') {
                    setGameState(prev => ({
                        ...prev,
                        isStarted: true,
                        playerCount: data.playerCount || prev.playerCount,
                        initialBoardConfig: data.initialBoardConfig,
                        lastAction: { type: 'START_GAME', payload: data }
                    }));
                } else if (data.type === 'SYNC_PROFILE') {
                    setParticipants(prev => ({
                        ...prev,
                        [data.address.toLowerCase()]: {
                            username: data.username || 'Opponent',
                            avatar_url: data.avatar_url || ''
                        }
                    }));
                } else if (data.type === 'MOVE_TOKEN') {
                    const payload = data.payload || data;
                    const { color, tokenIndex, targetPosition } = payload;
                    setGameState(prev => {
                        if (!color || tokenIndex === undefined) return prev;
                        const newPos = { ...prev.positions };
                        newPos[color as PlayerColor] = [...newPos[color as PlayerColor]];
                        newPos[color as PlayerColor][tokenIndex] = targetPosition;
                        return {
                            ...prev,
                            positions: newPos,
                            lastUpdate: Date.now(),
                            lastAction: { type: 'MOVE_TOKEN', payload }
                        };
                    });
                }
            });

            conn.on('close', () => {
                setIsLobbyConnected(false);
                setConnection(null);
            });
        });
    };

    // --- Heartbeat Logic ---
    useEffect(() => {
        if (isHost && isLobbyConnected) {
            heartbeatTimerRef.current = setInterval(() => {
                console.log('💓 Heartbeat: Syncing state...');
                broadcastAction('SYNC_STATE', { gameState });
            }, 5000);
        } else {
            if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        }
        return () => {
            if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        };
    }, [isHost, isLobbyConnected, gameState]);

    useEffect(() => {
        return () => {
            if (peerRef.current) peerRef.current.destroy();
        };
    }, []);

    return (
        <MultiplayerContext.Provider value={{
            roomId,
            connection,
            isLobbyConnected,
            isHost,
            gameState,
            hostGame,
            joinGame,
            sendIntent,
            broadcastAction,
            myAddress,
            updateGameState,
            participants
        }}>
            {children}
        </MultiplayerContext.Provider>
    );
};

export { MultiplayerProvider };

export const useMultiplayerContext = () => {
    const context = useContext(MultiplayerContext);
    if (!context) {
        throw new Error('useMultiplayerContext must be used within a MultiplayerProvider');
    }
    return context;
};
