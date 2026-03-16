"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback, useMemo } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { useAccount } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { useGameData } from './GameDataContext';
import {
    PlayerColor,
    GameState,
    GameActionType,
    GameIntentType,
    LobbyState,
    LobbySlot,
    InvitePayload,
    LobbyActionType,
} from '@/lib/types';
import {
    handleThreeSixes,
    getNextPlayer,
    getTeammateColor,
    createLobbySlots,
    assignJoinerToSlot,
    removePlayerFromSlot,
    swapSlots as swapSlotsLogic,
    canStartMatch,
    generateRoomCode,
} from '@/lib/gameLogic';
import { generateRandomNonce, sha256 } from '@/lib/encryption';

// ---------- Context Type ----------

interface TeamUpContextType {
    roomId: string;
    connection: DataConnection | null;           // kept for backward compat (first guest)
    connections: Map<string, DataConnection>;    // all guest connections (keyed by peerId)
    isLobbyConnected: boolean;
    isHost: boolean;
    gameState: GameState;
    lobbyState: LobbyState | null;
    pendingInvite: InvitePayload | null;
    hostGame: (matchType: '1v1' | '2v2' | '4P', gameMode: 'classic' | 'power', entryFee: number, validationToken?: string, forcedRoomId?: string) => void;
    joinGame: (targetRoomId: string, validationToken?: string) => void;
    sendIntent: (type: GameIntentType, payload?: any) => void;
    broadcastAction: (type: GameActionType, payload?: any) => void;
    broadcastLobbyAction: (type: LobbyActionType, payload?: any) => void;
    swapPlayers: (indexA: number, indexB: number) => void;
    kickPlayer: (slotIndex: number) => void;
    sendInvite: (friendId: string, friendName?: string) => void;
    acceptInvite: () => void;
    rejectInvite: () => void;
    startQuickMatch: () => void;
    myAddress?: string;
    updateGameState: (newState: Partial<GameState>) => void;
    participants: Record<string, { username: string; avatar_url: string }>;
    lastIntent: { type: GameIntentType; payload?: any; timestamp: number } | null;
    clearIntent: () => void;
    leaveGame: () => void;
    validationToken?: string;
}

const TeamUpContext = createContext<TeamUpContextType | undefined>(undefined);

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
    afkStats: {
        green: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        yellow: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
    },
    idleWarning: null,
    participantPeers: {},
    isStarted: false,
    lastUpdate: Date.now(),
    playerCount: '4P'
};

// ---------- Provider ----------

const TeamUpProvider = ({ children }: { children: ReactNode }) => {
    const [roomId, setRoomId] = useState('');
    const [connections, setConnections] = useState<Map<string, DataConnection>>(new Map());
    const [isLobbyConnected, setIsLobbyConnected] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
    const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
    const lobbyStateRef = useRef<LobbyState | null>(null);

    // --- Provably Fair Dice State ---
    const [commitments, setCommitments] = useState<Record<string, string>>({});
    const [reveals, setReveals] = useState<Record<string, string>>({});
    const [myPendingNonce, setMyPendingNonce] = useState<string | null>(null);
    const [pendingInvite, setPendingInvite] = useState<InvitePayload | null>(null);
    const [participants, setParticipants] = useState<Record<string, { username: string; avatar_url: string }>>({});
    const [lastIntent, setLastIntent] = useState<{ type: GameIntentType; payload?: any; timestamp: number } | null>(null);
    const [validationToken, setValidationToken] = useState<string | undefined>(undefined);
    const { address: myAddress } = useAccount();
    const { myProfile } = useGameData();

    const peerRef = useRef<Peer | null>(null);
    const heartbeatTimerRef = useRef<any>(null);
    const connectionsRef = useRef(connections);
    const gameStateRef = useRef(gameState);

    // Keep refs in sync
    useEffect(() => { lobbyStateRef.current = lobbyState; }, [lobbyState]);
    useEffect(() => { connectionsRef.current = connections; }, [connections]);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

    // Legacy compat: first connection
    const connection = useMemo(() => {
        const iter = connections.values();
        const first = iter.next();
        return first.done ? null : first.value;
    }, [connections]);

    // ─── Broadcast Helpers ───

    const broadcastToAll = useCallback((data: any) => {
        connectionsRef.current.forEach((conn) => {
            if (conn.open) {
                conn.send(data);
            }
        });
    }, []);

    const broadcastAction = useCallback((type: GameActionType, payload?: any) => {
        if (!isHost) return;

        if (type === 'START_GAME') {
            setGameState(prev => ({
                ...prev,
                isStarted: true,
                playerCount: payload.playerCount || prev.playerCount,
                initialBoardConfig: payload.initialBoardConfig
            }));
        }

        broadcastToAll({
            type,
            ...payload,
            gameState: type === 'SYNC_STATE' ? gameState : { ...gameState, lastAction: { type, payload } }
        });
    }, [isHost, gameState, broadcastToAll]);

    const broadcastLobbyAction = useCallback((type: LobbyActionType, payload?: any) => {
        if (!isHost) return;
        broadcastToAll({ type, lobbyState: lobbyStateRef.current, ...payload });
    }, [isHost, broadcastToAll]);

    // ─── Provably Fair Dice Logic ───

    const initiateDiceRoll = useCallback(async () => {
        if (gameState.gamePhase !== 'rolling') return;
        
        const nonce = generateRandomNonce();
        const hash = await sha256(nonce);
        setMyPendingNonce(nonce);
        
        // Reset old fair-play state
        setCommitments({});
        setReveals({});

        if (isHost) {
            setCommitments(prev => ({ ...prev, [myAddress || 'host']: hash }));
            broadcastAction('DICE_COMMIT', { hash, sender: myAddress || 'host' });
        } else if (connection?.open) {
            connection.send({ type: 'DICE_COMMIT', payload: { hash, sender: myAddress } });
        }
    }, [gameState.gamePhase, isHost, myAddress, connection, broadcastAction]);

    const finalizeDiceRoll = useCallback(async (allReveals: Record<string, string>) => {
        if (!isHost) return;

        // Verify commitments
        const entries = Object.entries(allReveals);
        for (const [addr, nonce] of entries) {
            const expectedHash = commitments[addr];
            const actualHash = await sha256(nonce);
            if (actualHash !== expectedHash) {
                console.error(`🚨 CHEAT DETECTED! Player ${addr} sent mismatching nonce.`);
                return;
            }
        }

        // Combine nonces to derive roll
        const combined = entries.map(([_, n]) => n).sort().join(':');
        const rollHash = await sha256(combined);
        // Use last few characters of hash to get a number 1-6
        const roll = (parseInt(rollHash.substring(0, 8), 16) % 6) + 1;

        console.log("🎲 Fair Dice Result:", roll, "from", entries.length, "participants");

        setGameState(prev => {
            const { isThreeSixes, nextSixes } = handleThreeSixes(prev.consecutiveSixes, roll);
            const allColors = prev.initialBoardConfig?.players.map((p: any) => p.color as PlayerColor) || [];
            const activeColors = allColors.filter((color: PlayerColor) => {
                const hasTokens = prev.positions[color].some(p => p !== 57);
                if (prev.playerCount === '2v2') {
                    const teammate = getTeammateColor(color, prev.playerCount);
                    const teammateHasTokens = teammate ? prev.positions[teammate].some(p => p !== 57) : false;
                    return hasTokens || teammateHasTokens;
                }
                return hasTokens;
            });

            if (isThreeSixes) {
                const nextPlayer = getNextPlayer(prev.currentPlayer, prev.playerCount, activeColors, prev.initialBoardConfig?.colorCorner);
                const updated: GameState = {
                    ...prev,
                    diceValue: roll,
                    consecutiveSixes: 0,
                    gamePhase: 'rolling',
                    currentPlayer: nextPlayer,
                    captureMessage: 'Three 6s! Turn passed.'
                };
                setTimeout(() => {
                    broadcastToAll({ type: 'ROLL_DICE', value: roll, gameState: { ...updated, lastAction: { type: 'ROLL_DICE', payload: { value: roll } } } });
                    broadcastToAll({ type: 'TURN_SWITCH', nextPlayer, gameState: updated });
                }, 0);
                return updated;
            } else {
                const updated = { ...prev, diceValue: roll, consecutiveSixes: nextSixes, gamePhase: 'moving' as const };
                setTimeout(() => {
                    broadcastToAll({ type: 'ROLL_DICE', value: roll, gameState: { ...updated, lastAction: { type: 'ROLL_DICE', payload: { value: roll } } } });
                }, 0);
                return updated;
            }
        });
    }, [isHost, commitments, broadcastToAll]);

    // ─── Provably Fair Internal Handlers ───

    const handleCommitReceived = useCallback(async (sender: string, hash: string) => {
        setCommitments(prev => {
            const next = { ...prev, [sender.toLowerCase()]: hash };
            
            // If Host and all participants have committed, trigger Reveal Phase
            if (isHost && lobbyStateRef.current) {
                const joinedParticipants = lobbyStateRef.current.slots
                    .filter(s => s.status === 'joined')
                    .map(s => s.playerId?.toLowerCase())
                    .filter(Boolean) as string[];

                const allCommitted = joinedParticipants.every(p => next[p]);
                if (allCommitted) {
                    broadcastAction('DICE_REVEAL_SIGNAL');
                    // Host also reveals immediately
                    if (myPendingNonce) {
                        setReveals(r => ({ ...r, [myAddress?.toLowerCase() || 'host']: myPendingNonce }));
                        broadcastAction('DICE_REVEAL', { nonce: myPendingNonce, sender: myAddress || 'host' });
                    }
                }
            }
            return next;
        });
    }, [isHost, myPendingNonce, myAddress, broadcastAction]);

    const handleRevealReceived = useCallback(async (sender: string, nonce: string) => {
        setReveals(prev => {
            const next = { ...prev, [sender.toLowerCase()]: nonce };
            
            // If Host and all participants have revealed, finalize
            if (isHost && lobbyStateRef.current) {
                const joinedParticipants = lobbyStateRef.current.slots
                    .filter(s => s.status === 'joined')
                    .map(s => s.playerId?.toLowerCase())
                    .filter(Boolean) as string[];

                const allRevealed = joinedParticipants.every(p => next[p]);
                if (allRevealed) {
                    finalizeDiceRoll(next);
                }
            }
            return next;
        });
    }, [isHost, finalizeDiceRoll]);

    // ─── Intent System ───

    const sendIntent = useCallback((type: GameIntentType, payload?: any) => {
        if (isHost) {
            if (type === 'REQUEST_ROLL') {
                if (gameState.gamePhase !== 'rolling') return;
                initiateDiceRoll();
            }
        } else if (connection && connection.open) {
            if (type === 'REQUEST_ROLL' && gameState.gamePhase !== 'rolling') return;
            connection.send({ type, payload });
        }
    }, [isHost, connection, initiateDiceRoll, gameState.gamePhase]);

    const updateGameState = useCallback((newState: Partial<GameState>) => {
        setGameState(prev => ({
            ...prev,
            ...newState,
            isStarted: prev.isStarted || newState.isStarted || false,
            lastUpdate: Date.now()
        }));
    }, []);

    // ─── Guest Data Handler (extracted for reuse) ───

    const handleGuestData = useCallback((data: any, conn: DataConnection) => {
        console.log('📩 Host received data:', data.type, data);

        if (data.type === 'REQUEST_ROLL') {
            if (gameState.gamePhase !== 'rolling') return;
            initiateDiceRoll();
        } else if (data.type === 'DICE_COMMIT') {
            handleCommitReceived(data.payload.sender, data.payload.hash);
        } else if (data.type === 'DICE_REVEAL') {
            handleRevealReceived(data.payload.sender, data.payload.nonce);
        } else if (data.type === 'REQUEST_MOVE') {
            setLastIntent({ type: data.type, payload: data.payload, timestamp: Date.now() });
        } else if (data.type === 'SYNC_PROFILE') {
            console.log('👤 Syncing profile for:', data.address);
            setParticipants(prev => ({
                ...prev,
                [data.address.toLowerCase()]: {
                    username: data.username || 'Guest',
                    avatar_url: data.avatar_url || ''
                }
            }));
            if (myAddress) {
                conn.send({
                    type: 'SYNC_PROFILE',
                    address: myAddress,
                    username: myProfile?.username || 'Host',
                    avatar_url: myProfile?.avatar_url || '',
                    validationToken: validationToken // Include host's token if any
                });
            }

            // --- TOKEN VALIDATION ---
            if (data.validationToken) {
                console.log('🛡️ Verifying guest validation token...');
                // In a real production app, the host would check this token against the Edge Server
                // via a secure API call. For now we log it and trust the hybrid flow.
                setGameState(prev => ({
                    ...prev,
                    isVerified: true 
                }));
            }

            // --- PEER DISCOVERY FOR MIGRATION ---
            // Add guest peer to host's discovery map
            setGameState(prev => ({
                ...prev,
                participantPeers: {
                    ...prev.participantPeers,
                    [data.address.toLowerCase()]: conn.peer
                }
            }));

            // Broadcast updated peer map to ALL guests so they know each other
            setTimeout(() => {
                const updatedPeers = {
                    ...gameStateRef.current.participantPeers,
                    [data.address.toLowerCase()]: conn.peer,
                    [myAddress?.toLowerCase() || '']: peerRef.current?.id || ''
                };
                broadcastToAll({
                    type: 'SYNC_STATE',
                    gameState: {
                        ...gameStateRef.current,
                        participantPeers: updatedPeers
                    }
                });
            }, 200);
        }
    }, [broadcastToAll, myAddress, myProfile]);

    // ─── Host: Setup Peer & Accept Connections ───

    const hostGame = useCallback((matchType: '1v1' | '2v2' | '4P', gameMode: 'classic' | 'power', entryFee: number, token?: string, forcedRoomId?: string) => {
        if (peerRef.current) peerRef.current.destroy();

        setIsHost(true);
        setValidationToken(token);
        const customRoomId = forcedRoomId || generateRoomCode();
        const peer = new Peer(customRoomId);
        peerRef.current = peer;

        // Initialize lobby
        const slots = createLobbySlots(matchType);
        // Fill host slot
        slots[0] = {
            ...slots[0],
            playerId: myAddress?.toLowerCase(),
            playerName: 'Host',
            peerId: customRoomId,
        };

        const lobby: LobbyState = {
            roomCode: customRoomId,
            hostId: myAddress?.toLowerCase() || '',
            matchType,
            gameMode,
            entryFee,
            slots,
            status: 'forming',
            createdAt: Date.now(),
        };
        setLobbyState(lobby);

        peer.on('open', (id) => {
            console.log('🎲 Host Peer opened:', id);
            setRoomId(id);
        });

        peer.on('connection', (conn) => {
            console.log('🔗 Incoming connection from:', conn.peer);

            conn.on('open', () => {
                // Synchronously check capacity before accepting
                const currentLobby = lobbyStateRef.current;
                if (!currentLobby) {
                    conn.send({ type: 'LOBBY_JOIN', status: 'error', reason: 'No lobby' });
                    conn.close();
                    return;
                }

                const updatedSlots = assignJoinerToSlot(
                    currentLobby.slots,
                    currentLobby.matchType,
                    conn.peer, // Use peerId as temporary playerId until SYNC_PROFILE arrives
                    'Guest',
                    '',
                    conn.peer
                );

                if (!updatedSlots) {
                    // Room is full — reject the connection (race condition guard)
                    conn.send({ type: 'LOBBY_JOIN', status: 'error', reason: 'Room is full' });
                    conn.close();
                    return;
                }

                // Accept the connection
                const newLobby: LobbyState = {
                    ...currentLobby,
                    slots: updatedSlots,
                    status: canStartMatch({ ...currentLobby, slots: updatedSlots }) ? 'ready' : 'forming',
                };
                setLobbyState(newLobby);
                lobbyStateRef.current = newLobby; // Sync ref immediately

                // Add to connections map
                setConnections(prev => {
                    const next = new Map(prev);
                    next.set(conn.peer, conn);
                    return next;
                });
                setIsLobbyConnected(true);

                // Send profile & lobby state to new guest
                if (myAddress) {
                    conn.send({ type: 'SYNC_PROFILE', address: myAddress });
                }
                conn.send({ type: 'LOBBY_SYNC', lobbyState: newLobby });

                // Broadcast updated lobby to ALL existing connections
                connectionsRef.current.forEach((existingConn) => {
                    if (existingConn.open && existingConn.peer !== conn.peer) {
                        existingConn.send({ type: 'LOBBY_SYNC', lobbyState: newLobby });
                    }
                });

                // Also send SYNC_STATE
                conn.send({ type: 'SYNC_STATE', gameState });
            });

            conn.on('data', (data: any) => {
                handleGuestData(data, conn);
            });

            conn.on('close', () => {
                console.log('❌ Connection closed:', conn.peer);
                // Remove from connections
                setConnections(prev => {
                    const next = new Map(prev);
                    next.delete(conn.peer);
                    if (next.size === 0) setIsLobbyConnected(false);
                    return next;
                });

                // Remove from lobby
                setLobbyState(prev => {
                    if (!prev) return prev;
                    const updated = removePlayerFromSlot(prev.slots, conn.peer);
                    const newLobby: LobbyState = { ...prev, slots: updated, status: 'forming' };
                    lobbyStateRef.current = newLobby;
                    // Broadcast updated lobby
                    setTimeout(() => {
                        connectionsRef.current.forEach((c) => {
                            if (c.open) c.send({ type: 'LOBBY_SYNC', lobbyState: newLobby });
                        });
                    }, 0);
                    return newLobby;
                });
            });
        });
    }, [myAddress, gameState, handleGuestData]);

    const initiateMigration = useCallback(() => {
        console.log('🔄 Initiating Host Migration...');
        const state = gameStateRef.current;
        const lobby = lobbyStateRef.current;
        if (!lobby || !state.isStarted) return;

        // 1. Identify valid participants (those with peer IDs)
        // We look at the slots to determine the order of succession
        const sortedParticipants = lobby.slots
            .filter(s => s.status === 'joined' && s.playerId)
            .sort((a, b) => a.slotIndex - b.slotIndex);

        // Filter out the dead host (who was at index 0 usually)
        const currentHostId = lobby.hostId.toLowerCase();
        const survivors = sortedParticipants.filter(p => p.playerId?.toLowerCase() !== currentHostId);

        if (survivors.length === 0) {
            console.log('💀 No survivors for migration.');
            return;
        }

        const nextHost = survivors[0];
        const isMeNext = nextHost.playerId?.toLowerCase() === myAddress?.toLowerCase();

        if (isMeNext) {
            console.log('👑 I am the new Host! Re-hosting match...');
            setIsHost(true);
            const peer = new Peer(); 
            peerRef.current = peer;
            
            peer.on('open', (newId) => {
                setRoomId(newId);
                const currentLobby = lobbyStateRef.current;
                if (!currentLobby) return;

                const newLobby: LobbyState = {
                    ...currentLobby,
                    hostId: myAddress || '',
                    roomCode: newId,
                    status: 'starting'
                };
                setLobbyState(newLobby);
                
                // Re-hydrate game state with new host's peer ID in the map
                setGameState(prev => ({
                    ...prev,
                    participantPeers: {
                        ...prev.participantPeers,
                        [myAddress?.toLowerCase() || '']: newId
                    }
                }));

                // BROADCAST NEW HOST INFO VIA SUPABASE
                supabase
                    .channel(`migration-${lobby.roomCode}`)
                    .subscribe((status) => {
                        if (status === 'SUBSCRIBED') {
                            supabase.channel(`migration-${lobby.roomCode}`).send({
                                type: 'broadcast',
                                event: 'host-migrated',
                                payload: {
                                    oldRoomCode: lobby.roomCode,
                                    newRoomCode: newId,
                                    newHostAddress: myAddress
                                }
                            });
                        }
                    });
            });

            peer.on('connection', (newConn) => {
                newConn.on('open', () => {
                    setConnections(prev => new Map(prev).set(newConn.peer, newConn));
                    setIsLobbyConnected(true);
                    newConn.send({ type: 'SYNC_STATE', gameState: gameStateRef.current });
                });
                newConn.on('data', (d) => handleGuestData(d, newConn));
            });
        } else {
            console.log(`⏳ Waiting for ${nextHost.playerName} to re-host...`);
        }
    }, [myAddress, handleGuestData]);

    // ─── Guest: Join ───

    const joinGame = useCallback((targetRoomId: string, token?: string) => {
        if (!targetRoomId) return;
        if (peerRef.current) peerRef.current.destroy();

        setIsHost(false);
        setValidationToken(token);
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', (id) => {
            console.log('🎲 Guest Peer opened:', id);
            const conn = peer.connect(targetRoomId);

            conn.on('open', () => {
                setConnections(new Map([[conn.peer, conn]]));
                setIsLobbyConnected(true);
                if (myAddress) {
                    conn.send({
                        type: 'SYNC_PROFILE',
                        address: myAddress,
                        username: myProfile?.username || 'Guest',
                        avatar_url: myProfile?.avatar_url || '',
                        validationToken: token
                    });
                }

                conn.on('data', (data: any) => {
                    console.log('📩 Guest received message:', data.type);
                    if (data.type === 'START_GAME') {
                        console.log('🚀 GUEST: Received START_GAME!', data);
                        setGameState(prev => ({
                            ...prev,
                            isStarted: true,
                            playerCount: data.playerCount || prev.playerCount,
                            initialBoardConfig: data.initialBoardConfig,
                            lastAction: { type: 'START_GAME', payload: data },
                            lastUpdate: Date.now()
                        }));
                    } else if (data.type === 'DICE_COMMIT') {
                        // Host has committed, Guest also commits
                        (async () => {
                            const nonce = generateRandomNonce();
                            const hash = await sha256(nonce);
                            setMyPendingNonce(nonce);
                            setCommitments(prev => ({ 
                                ...prev, 
                                [data.sender.toLowerCase()]: data.hash, // Host's commit
                                [myAddress?.toLowerCase() || '']: hash // My commit
                            }));
                            conn.send({ type: 'DICE_COMMIT', payload: { hash, sender: myAddress } });
                        })();
                    } else if (data.type === 'DICE_REVEAL_SIGNAL') {
                        // Host says everyone has committed, now reveal
                        if (myPendingNonce) {
                            setReveals(prev => ({ ...prev, [myAddress?.toLowerCase() || '']: myPendingNonce }));
                            conn.send({ type: 'DICE_REVEAL', payload: { nonce: myPendingNonce, sender: myAddress } });
                        }
                    } else if (data.type === 'DICE_REVEAL') {
                        setReveals(prev => ({ ...prev, [data.sender.toLowerCase()]: data.nonce }));
                    } else if (data.type === 'LOBBY_SYNC') {
                        setLobbyState(data.lobbyState);
                    } else if (data.type === 'LOBBY_JOIN' && data.status === 'error') {
                        console.error('🚫 Join rejected:', data.reason);
                        setIsLobbyConnected(false);
                    } else if (data.type === 'SYNC_STATE') {
                        setGameState(prev => ({
                            ...data.gameState,
                            isStarted: prev.isStarted || data.gameState.isStarted
                        }));
                    } else if (data.type === 'ROLL_DICE') {
                        setGameState(prev => ({
                            ...prev,
                            diceValue: data.value,
                            gamePhase: 'moving',
                            lastAction: { type: 'ROLL_DICE', payload: data }
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
                console.log('📡 Host connection closed.');
                setIsLobbyConnected(false);
                setConnections(new Map());

                // HOST MIGRATION TRIGGER
                if (gameStateRef.current.isStarted && !gameStateRef.current.winner) {
                    initiateMigration();
                }
            });
            });
        });
    }, [myAddress, myProfile, initiateMigration]);

    // ─── Migration Signaling (Guest) ───
    useEffect(() => {
        if (!lobbyState || isHost) return;

        const channel = supabase
            .channel(`migration-${lobbyState.roomCode}`)
            .on('broadcast', { event: 'host-migrated' }, ({ payload }) => {
                console.log('🔄 MIGRATION SIGNAL RECEIVED:', payload);
                if (payload.newRoomCode) {
                    joinGame(payload.newRoomCode);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [lobbyState?.roomCode, isHost, joinGame]);

    // ─── Lobby Actions (Host-only) ───

    const swapPlayers = useCallback((indexA: number, indexB: number) => {
        if (!isHost || !lobbyState) return;
        const newSlots = swapSlotsLogic(lobbyState.slots, indexA, indexB);
        const newLobby = { ...lobbyState, slots: newSlots };
        setLobbyState(newLobby);
        lobbyStateRef.current = newLobby;
        broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
    }, [isHost, lobbyState, broadcastToAll]);

    const kickPlayer = useCallback((slotIndex: number) => {
        if (!isHost || !lobbyState) return;
        const slot = lobbyState.slots[slotIndex];
        if (!slot || slot.role === 'host' || slot.status !== 'joined') return;

        // Close the peer connection
        const peerId = slot.peerId;
        if (peerId) {
            const conn = connectionsRef.current.get(peerId);
            if (conn) conn.close();
        }

        const newSlots = removePlayerFromSlot(lobbyState.slots, slot.playerId || '');
        const newLobby: LobbyState = { ...lobbyState, slots: newSlots, status: 'forming' };
        setLobbyState(newLobby);
        lobbyStateRef.current = newLobby;
        broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
    }, [isHost, lobbyState, broadcastToAll]);

    // ─── Invite System (Supabase Realtime) ───

    // Listener for incoming invites
    useEffect(() => {
        if (!myAddress) return;
        const lowerAddr = myAddress.toLowerCase();

        const channel = supabase
            .channel(`invites-${lowerAddr}`)
            .on('broadcast', { event: 'game-invite' }, ({ payload }) => {
                console.log('🎁 Received game invite:', payload);
                setPendingInvite(payload as InvitePayload);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [myAddress]);

    const sendInvite = useCallback((friendId: string, friendName?: string) => {
        if (!lobbyState || !myAddress) return;
        const lowerFriendId = friendId.toLowerCase();

        // Mark the next empty slot as 'invited'
        setLobbyState(prev => {
            if (!prev) return prev;
            const emptyIdx = prev.slots.findIndex(s => s.status === 'empty');
            if (emptyIdx === -1) return prev;
            const newSlots = prev.slots.map((s, i) => {
                if (i === emptyIdx) return { ...s, status: 'invited' as const, playerId: friendId, playerName: friendName || 'Invited' };
                return s;
            });
            const newLobby = { ...prev, slots: newSlots };
            lobbyStateRef.current = newLobby;
            broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
            return newLobby;
        });

        // Supabase Realtime broadcast
        const invitePayload: InvitePayload = {
            roomCode: lobbyState.roomCode,
            hostName: myProfile?.username || 'Host',
            hostAvatar: myProfile?.avatar_url || '',
            matchType: lobbyState.matchType,
            gameMode: lobbyState.gameMode,
            entryFee: lobbyState.entryFee
        };

        supabase
            .channel(`invites-${lowerFriendId}`)
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    supabase
                        .channel(`invites-${lowerFriendId}`)
                        .send({
                            type: 'broadcast',
                            event: 'game-invite',
                            payload: invitePayload
                        })
                        .then(() => {
                            console.log(`📨 Invite sent to ${friendId} for room ${lobbyState.roomCode}`);
                        });
                }
            });
    }, [lobbyState, broadcastToAll, myAddress, myProfile]);

    const acceptInvite = useCallback(() => {
        if (!pendingInvite) return;
        joinGame(pendingInvite.roomCode);
        setPendingInvite(null);
    }, [pendingInvite, joinGame]);

    const rejectInvite = useCallback(() => {
        setPendingInvite(null);
    }, []);



    // ─── Quick Match (Hybrid) ───

    const startQuickMatch = useCallback(() => {
        if (!isHost || !lobbyState) return;
        setLobbyState(prev => {
            if (!prev) return prev;
            const newLobby = { ...prev, status: 'quickmatch' as const };
            lobbyStateRef.current = newLobby;
            broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
            return newLobby;
        });
        // TODO: Wire to useMatchmaking's startHybridSearch
        console.log('🔍 Quick Match started for lobby', lobbyState.roomCode);
    }, [isHost, lobbyState, broadcastToAll]);

    const leaveGame = useCallback(() => {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        setIsHost(false);
        setIsLobbyConnected(false);
        setRoomId('');
        setConnections(new Map());
        setGameState(INITIAL_GAME_STATE);
        setLobbyState(null);
        setParticipants({});
        console.log('🚪 Left game and cleaned up resources.');
    }, []);

    // ─── Heartbeat ───

    useEffect(() => {
        if (isHost && isLobbyConnected) {
            heartbeatTimerRef.current = setInterval(() => {
                console.log('💓 Heartbeat: Syncing state...');
                broadcastToAll({ type: 'SYNC_STATE', gameState: gameStateRef.current });
            }, 5000);
        } else {
            if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        }
        return () => {
            if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        };
    }, [isHost, isLobbyConnected, broadcastToAll]);

    // ─── Cleanup ───
    useEffect(() => {
        return () => {
            if (peerRef.current) peerRef.current.destroy();
        };
    }, []);

    // ─── Context Value ───

    const contextValue = useMemo(() => ({
        roomId,
        connection,
        connections,
        isLobbyConnected,
        isHost,
        gameState,
        lobbyState,
        pendingInvite,
        hostGame,
        joinGame,
        sendIntent,
        broadcastAction,
        broadcastLobbyAction,
        swapPlayers,
        kickPlayer,
        sendInvite,
        acceptInvite,
        rejectInvite,
        startQuickMatch,
        myAddress,
        updateGameState,
        participants,
        lastIntent,
        clearIntent: () => setLastIntent(null),
        leaveGame,
        validationToken
    }), [
        roomId, connection, connections, isLobbyConnected, isHost, gameState,
        lobbyState, pendingInvite,
        hostGame, joinGame, sendIntent, broadcastAction, broadcastLobbyAction,
        swapPlayers, kickPlayer, sendInvite, acceptInvite, rejectInvite, startQuickMatch,
        myAddress, updateGameState, participants, lastIntent, leaveGame, validationToken
    ]);

    return (
        <TeamUpContext.Provider value={contextValue}>
            {children}
        </TeamUpContext.Provider>
    );
};

export { TeamUpProvider };

export const useTeamUpContext = () => {
    const context = useContext(TeamUpContext);
    if (!context) {
        throw new Error('useTeamUpContext must be used within a TeamUpProvider');
    }
    return context;
};
