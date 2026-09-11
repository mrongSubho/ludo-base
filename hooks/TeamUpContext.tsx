"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { supabase } from '@/lib/supabase';
import { useAccount, useSignMessage, useSignTypedData } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';
import { useLobbyManager } from '@/hooks/useLobbyManager';
import { useSupabaseRelay } from '@/hooks/useSupabaseRelay';
import { useProvablyFairDice } from '@/hooks/useProvablyFairDice';
import { useGamePresence } from '@/hooks/useGamePresence';
import { useBettingController } from '@/hooks/useBettingController';
import { useSignedResolveBet } from '@/hooks/useSignedResolveBet';
import { useMoveAuth } from '@/hooks/useMoveAuth';
import { useMatchStates } from '@/hooks/useMatchStates';
import { sanitizeGameStateForWire } from '@/lib/wireSanitize';
import { createPeerInstance } from '@/lib/peerFactory';
import { INITIAL_GAME_STATE as ENGINE_INIT } from '@/lib/gameLogic';
import {
    GameState,
    PlayerColor,
    GameActionType,
    LobbyState,
    LobbySlot,
    InvitePayload,
    LobbyActionType,
    BetType,
} from '@/lib/types';
import { ActiveBettingWindow } from './useSpectatorSync';
import {
    createLobbySlots,
    assignJoinerToSlot,
    generateRoomCode,
    INITIAL_GAME_STATE
} from '@/lib/gameLogic';

// ─── types for the context ───

export interface TeamUpContextType {
    roomId: string;
    connection: DataConnection | null; // Primary connection (first one)
    connections: Map<string, DataConnection>; // All active connections
    isLobbyConnected: boolean;
    isHost: boolean; // P2P Host / Creator
    isComputeHost: boolean; // Dynamic AFK/Bot Executor
    activePlayers: string[]; // Active presence list
    gameState: GameState;
    lobbyState: LobbyState | null;
    pendingInvite: InvitePayload | null;
    hostGame: (roomId?: string, expectedValidationToken?: string) => void;
    joinGame: (roomId: string, token?: string, desiredSeat?: number) => void;
    initQuickLobby: (roomCode: string, matchType: '1v1' | '2v2' | '4P', gameMode?: 'classic' | 'power', entryFee?: number) => void;
    hostQuickLobby: (matchType: '1v1' | '2v2' | '4P', gameMode?: 'classic' | 'power', entryFee?: number) => string;
    sendIntent: (type: string, payload: any) => void;
    broadcastAction: (type: GameActionType, payload?: any, fullState?: any) => void;
    broadcastLobbyAction: (type: LobbyActionType, payload?: any) => void;
    swapPlayers: (fromIdx: number, toIdx: number) => void;
    kickPlayer: (slotIdx: number) => void;
    sendInvite: (friendId: string, friendName?: string, role?: 'teammate' | 'opponent') => void;
    acceptInvite: () => void;
    rejectInvite: () => void;
    startQuickMatch: (opts?: {
        gameMode?: 'classic' | 'power';
        matchType?: '1v1' | '2v2' | '4P';
        wager?: number;
    }) => Promise<void>;
    myAddress: string | undefined;
    updateGameState: (state: Partial<GameState>) => void;
    participants: Record<string, { address: string; username?: string; avatar_url?: string; color?: PlayerColor; lxp?: number; rxp?: number }>;
    lastIntent: any | null;
    clearIntent: () => void;
    leaveGame: () => void;
    validationToken?: string;
    /** Host join secret for invite links (`?s=`). Null when not hosting. */
    roomSecret: string | null;
    /** Hybrid public fill: guests arrive via matchmaking tokens — drop the room-secret gate. */
    allowOpenJoins: () => void;
    activeBetWindow: ActiveBettingWindow | null;
    startBettingWindow: (betType: BetType) => Promise<string>;
    /** P4: monotonic match_states.seq known to this client. */
    serverSeq: number;
    /** Apply a server-authoritative state (Edge / match_states). */
    applyServerState: (state: GameState, seq: number) => void;
}

const TeamUpContext = createContext<TeamUpContextType | undefined>(undefined);

const TeamUpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [roomId, setRoomId] = useState('');
    const [currentRoomCode, setCurrentRoomCode] = useState<string | null>(null);
    const [connections, setConnections] = useState<Map<string, DataConnection>>(new Map());
    const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
    const [isLobbyConnected, setIsLobbyConnected] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
    const [validationToken, setValidationToken] = useState<string | undefined>(undefined);

    const { address: myAddress } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const { signTypedDataAsync } = useSignTypedData();
    const { myProfile } = useGameData();
    const moveAuth = useMoveAuth({ myAddress, signMessageAsync, signTypedDataAsync });
    const [lastIntent, setLastIntent] = useState<any | null>(null);
    // Matchmaking validation token the host will require from guests (if set).
    const expectedValidationTokenRef = useRef<string | null>(null);
    // Host-only join secret for invite lobbies (not on the matchmaking path).
    // Embedded in invite links as `s=` and passed to joinGame as the token.
    const [roomSecret, setRoomSecret] = useState<string | null>(null);
    /** P4: highest match_states.seq this client has applied. */
    const serverSeqRef = useRef(0);
    const [serverSeq, setServerSeq] = useState(0);

    const applyServerState = useCallback((state: GameState, seq: number) => {
        if (!Number.isFinite(seq) || seq <= serverSeqRef.current) return;
        serverSeqRef.current = seq;
        setServerSeq(seq);
        setGameState(prev => ({
            ...prev,
            ...state,
            lastUpdate: Date.now(),
        }));
    }, []);

    // P4: clients render match_states (postgres realtime + initial pull)
    useMatchStates({
        matchId: gameState.matchId,
        enabled: isLobbyConnected,
        onServerState: applyServerState,
        getSeq: () => serverSeqRef.current,
    });

    const gameStateRef = useRef(gameState);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

    const peerRef = useRef<Peer | null>(null);
    // Dedup guest intents delivered on both PeerJS and Supabase.
    const processedIntentIds = useRef<Set<string>>(new Set());
    // Requested seat from an invite link (?seat=N). Consumed by the next
    // SYNC_PROFILE send, then cleared — retries reuse it until first send.
    const desiredSeatRef = useRef<number | undefined>(undefined);

    const destroyPeer = useCallback(() => {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        connectionsRef.current.forEach(c => c.close());
        connectionsRef.current.clear();
        setConnections(new Map());
        // Never leave ONLINE latched after teardown — hostGame/joinGame
        // only set this true again on a live PeerJS bind.
        setIsLobbyConnected(false);
    }, []);

    const broadcastToAll = useCallback((data: any) => {
        connectionsRef.current.forEach((conn: any) => {
            if (conn.open) conn.send(data);
        });
    }, [connectionsRef]);

    // 1. Lobby Manager
    const {
        lobbyState,
        setLobbyState,
        lobbyStateRef,
        pendingInvite,
        setPendingInvite,
        participants,
        setParticipants,
        swapPlayers,
        kickPlayer,
        sendInvite
    } = useLobbyManager({
        myAddress,
        myProfile,
        isHost,
        setIsHost,
        setRoomId,
        setCurrentRoomCode,
        setIsLobbyConnected,
        setGameState,
        peerRef,
        connectionsRef,
        broadcastToAll,
        getRoomSecret: () => expectedValidationTokenRef.current
    });

    // 2. Supabase Relay (define relayViaSupabase early)
    const { relayViaSupabase, setRelayRoom, processedActionIds } = useSupabaseRelay({
        myAddress,
        lobbyState,
        currentRoomCode,
        processGameAction: (data: any) => processGameAction(data),
        joinGame: (id: string) => joinGame(id)
    });

    // 2.5. Presence Manager (AFK Failsafe Baton Pass)
    const { isComputeHost, activePlayers } = useGamePresence(currentRoomCode, myAddress);

    // 3. Broadcast Helpers
    const broadcastAction = useCallback((type: GameActionType, payload?: any, fullState?: any) => {
        if (!isHost && !isComputeHost) return;
        
        // Only the original P2P Host handles START_GAME logic
        if (type === 'START_GAME' && isHost) {
            // 🚀 Escrow Pre-Warm logic for Zero-Trust RNG
            fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/roll-dice`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ isPreWarm: true })
            }).catch(err => console.error('Failed to pre-warm roll-dice function', err));

            // Always persist matchId on the host game state. /api/match/start
            // may fail; without an id every roll/move falls back to 'local'
            // and never hits move-auth.
            const matchId = String(payload.matchId || gameStateRef.current.matchId || crypto.randomUUID());

            setGameState((prev: GameState) => ({
                ...prev,
                isStarted: true,
                matchId,
                playerCount: payload.playerCount || prev.playerCount,
                initialBoardConfig: payload.initialBoardConfig
            }));

            // Seed server-authoritative match_states (v2 move validation)
            if (myAddress && payload.initialBoardConfig) {
                const seats: Record<string, { kind: 'human' | 'bot' | 'afk'; wallet?: string }> = {};
                (payload.initialBoardConfig.players as { color: string; isAi?: boolean; walletAddress?: string }[] || [])
                    .forEach(p => {
                        seats[p.color] = p.isAi
                            ? { kind: 'bot' }
                            : { kind: 'human', wallet: p.walletAddress };
                    });
                const initialState = {
                    ...ENGINE_INIT,
                    matchId,
                    playerCount: payload.playerCount || '4P',
                    currentPlayer: payload.initialBoardConfig.players?.[0]?.color || 'green',
                    isStarted: true,
                    status: 'playing' as const,
                    powerTiles: gameStateRef.current.powerTiles || [],
                    playerPowers: gameStateRef.current.playerPowers || ENGINE_INIT.playerPowers,
                    powerSpentThisTurn: false,
                    activeBoost: null,
                    activeShields: [],
                    activeTraps: [],
                    consecutiveSixes: 0,
                };
                moveAuth.seedMatch({
                    matchId,
                    roomCode: currentRoomCode || roomId || '',
                    colorCorner: payload.initialBoardConfig.colorCorner,
                    playerSeats: seats,
                    initialState,
                }).then(async (r) => {
                    if (!r.ok) {
                        console.error('🌱 [MoveAuth] seed failed', (r as { data?: unknown; error?: string }).data || (r as { error?: string }).error);
                        return;
                    }
                    console.log('🌱 [MoveAuth] seeded match_states', (r as { data?: { seq?: number } }).data?.seq);
                    serverSeqRef.current = 0;
                    setServerSeq(0);
                    try {
                        const sess = await moveAuth.createMatchSession({
                            matchId,
                            roomCode: currentRoomCode || roomId || '',
                        });
                        if (!sess.ok) console.error('🔑 [MoveAuth] session failed', sess.error);
                        else console.log('🔑 [MoveAuth] session ready', sess.sessionId);
                    } catch (err) {
                        console.error('🔑 [MoveAuth] session error', err);
                    }
                }).catch(err => console.error('🌱 [MoveAuth] seed error', err));
            }

            setLobbyState((prev: LobbyState | null) => {
                if (!prev) return prev;
                const newLobby = { ...prev, status: 'playing' as const };
                lobbyStateRef.current = newLobby;
                
                // ☁️ Update host status and room code in DB
                if (isHost && myAddress) {
                    supabase.from('players')
                        .update({ status: 'In Match', current_room_code: currentRoomCode })
                        .eq('wallet_address', myAddress)
                        .then();
                    
                    // Log to activities
                    (supabase as any).from('activities').insert({
                        actor_id: myAddress,
                        type: 'join_tournament', // General match join for now
                        metadata: { room_code: currentRoomCode }
                    }).then();
                }

                setTimeout(() => {
                    broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
                    relayViaSupabase('lobby-action', { type: 'LOBBY_SYNC', lobbyState: newLobby }, lobbyStateRef as any);
                }, 50);
                return newLobby;
            });
        }

        // Always include matchId so guests + host share one Edge match.
        const actionData = {
            type,
            ...payload,
            matchId: payload?.matchId || gameStateRef.current.matchId,
            stateOverride: fullState ? sanitizeGameStateForWire(fullState) : undefined,
            gameState: fullState
                ? sanitizeGameStateForWire(fullState)
                : type === 'SYNC_STATE'
                    ? sanitizeGameStateForWire(gameStateRef.current)
                    : sanitizeGameStateForWire({ ...gameStateRef.current, lastAction: { type, payload } })
        };

        // For Compute Host, broadcastToAll will only reach the P2P host (if still connected)
        // relayViaSupabase reaches everyone.
        broadcastToAll(actionData);
        relayViaSupabase('game-action', actionData, lobbyStateRef as any);
    }, [isHost, isComputeHost, broadcastToAll, relayViaSupabase, setGameState, setLobbyState, lobbyStateRef, gameStateRef, myAddress, currentRoomCode]);

    const broadcastLobbyAction = useCallback((type: LobbyActionType, payload?: any) => {
        if (!isHost) return;
        const actionData = { type, lobbyState: lobbyStateRef.current, ...payload };
        broadcastToAll(actionData);
        relayViaSupabase('lobby-action', actionData, lobbyStateRef as any);
    }, [isHost, broadcastToAll, relayViaSupabase, lobbyStateRef]);

    // 4. Betting Window Controller (extracted)
    const { activeBetWindow, startBettingWindow } = useBettingController({
        isHost,
        matchId: gameState.matchId,
        broadcastAction: broadcastAction as (type: GameActionType, payload?: unknown, fullState?: GameState) => void,
    });

    // 5. Provably Fair Dice
    // 5. Provably Fair Dice + signed bet resolution
    const resolveBet = useSignedResolveBet({
        isHost,
        myAddress,
        signMessageAsync: (args) => signMessageAsync(args),
    });

    const {
        initiateDiceRoll,
        handleCommitReceived,
        handleRevealReceived
    } = useProvablyFairDice({
        gameState,
        setGameState,
        isHost,
        myAddress,
        connection: connections.values().next().value || null,
        broadcastAction: (type: any, payload: any) => broadcastAction(type, payload),
        broadcastToAll,
        resolveBet,
    });

    // Seat a joiner (host authority). Shared by PeerJS SYNC_PROFILE and
    // Supabase JOIN_REQUEST so NAT/Brave guests can seat without P2P.
    const seatGuestPlayer = useCallback((payload: {
        address: string;
        username?: string;
        avatar_url?: string;
        desiredSeat?: number;
        validationToken?: string;
        peerId?: string;
    }) => {
        if (!isHost || !payload.address) return false;
        if (expectedValidationTokenRef.current) {
            const presented = typeof payload.validationToken === 'string' ? payload.validationToken : '';
            if (presented !== expectedValidationTokenRef.current) {
                console.warn('🚫 [Host] Rejected join — invalid validation token', payload.address);
                return false;
            }
        }
        setParticipants(prev => ({
            ...prev,
            [payload.address]: {
                address: payload.address,
                username: payload.username,
                avatar_url: payload.avatar_url,
                color: prev[payload.address]?.color
            }
        }));
        const cur = lobbyStateRef.current;
        if (!cur) return false;
        const addr = payload.address.toLowerCase();
        if (cur.slots.some(s => s.playerId?.toLowerCase() === addr && s.status === 'joined')) {
            return true;
        }
        const invitedIdx = cur.slots.findIndex(s => s.playerId?.toLowerCase() === addr && s.status !== 'joined');
        const peerId = payload.peerId || `supabase:${addr}`;
        let next: LobbySlot[] | null = null;
        const want = Number.isInteger(payload.desiredSeat) ? (payload.desiredSeat as number) : -1;
        if (want >= 0 && want < cur.slots.length && cur.slots[want]?.status === 'empty') {
            next = cur.slots.map((s, i) => i === want
                ? { ...s, status: 'joined' as const, playerId: payload.address, playerName: payload.username || `Player ${want + 1}`, playerAvatar: payload.avatar_url, peerId }
                : { ...s });
        } else if (invitedIdx !== -1) {
            next = cur.slots.map((s, i) => i === invitedIdx
                ? { ...s, status: 'joined' as const, playerName: payload.username || s.playerName, playerAvatar: payload.avatar_url || s.playerAvatar, peerId }
                : { ...s });
        } else {
            next = assignJoinerToSlot(cur.slots, cur.matchType, payload.address, payload.username || 'Player', payload.avatar_url || '', peerId);
        }
        if (!next) {
            console.warn('🚫 [Host] seatGuestPlayer: room full or already seated', payload.address);
            return false;
        }
        const lobby = { ...cur, slots: next };
        setLobbyState(lobby);
        lobbyStateRef.current = lobby;
        broadcastLobbyAction('LOBBY_SYNC', { lobbyState: lobby });
        console.log('✅ [Host] Seated guest via', payload.peerId ? 'PeerJS' : 'Supabase', payload.address);
        return true;
    }, [isHost, setParticipants, setLobbyState, lobbyStateRef, broadcastLobbyAction]);

    // 6. Game Engine Action Processor
    const processGameAction = useCallback((data: any) => {
        const { type, actionId, stateOverride } = data;
        if (actionId && processedActionIds.current.has(actionId)) return;
        if (actionId) processedActionIds.current.add(actionId);

        console.log('🕹️ Processing action:', type, data);

        // 📬 Guest intent via Supabase (dual-path with PeerJS GAME_ACTION)
        if (type === 'GAME_INTENT' && isHost) {
            const action = data.action;
            const intentId = action?.intentId || actionId;
            if (intentId && processedIntentIds.current.has(intentId)) return;
            if (intentId) processedIntentIds.current.add(intentId);
            console.log('📬 [Host] Intent via Supabase:', action?.type);
            setLastIntent(action);
            return;
        }

        // 🪑 Guest seat request via Supabase (works without PeerJS)
        if (type === 'JOIN_REQUEST' && isHost) {
            seatGuestPlayer({
                address: data.address || data.playerId,
                username: data.username,
                avatar_url: data.avatar_url,
                desiredSeat: data.desiredSeat,
                validationToken: data.validationToken,
            });
            return;
        }

        // 🏟️ Lobby sync (guest applies host state; host ignores echoes)
        if (type === 'LOBBY_SYNC' && (data as any).lobbyState && !isHost) {
            console.log('🏟️ [Guest] Applying lobby sync');
            setLobbyState((data as any).lobbyState);
            setIsLobbyConnected(true);
            return;
        }

        // 🌟 Host ENGINE_STATE: hint only when match_states is live (P4).
        // Apply only if payload.seq is strictly ahead of the server seq we know.
        if (stateOverride && !isHost) {
            const payloadSeq = typeof data.seq === 'number' ? data.seq : null;
            const known = serverSeqRef.current;
            if (payloadSeq !== null && payloadSeq > known) {
                applyServerState(stateOverride as GameState, payloadSeq);
            } else if (known === 0 && payloadSeq === null) {
                // Pre-seed / offline-style lobby: fall back to host hint
                setGameState(prev => ({
                    ...stateOverride,
                    lastUpdate: Date.now(),
                    lastAction: { type, payload: data }
                }));
            } else {
                console.log('🌟 [P4] Ignoring host override (server seq', known, '>= payload', payloadSeq, ')');
            }
        }

        if (type === 'START_GAME') {
            setGameState(prev => ({
                ...prev,
                isStarted: true,
                isBotMatch: data.isBotMatch || false,
                playerCount: data.playerCount || prev.playerCount,
                initialBoardConfig: data.initialBoardConfig,
                matchId: data.matchId,
                lastUpdate: Date.now()
            }));

            // ☁️ Host: Register live match details + bind host for signed settlement
            if (isHost) {
                const matchId = data.matchId || gameStateRef.current.matchId;
                if (matchId) {
                    supabase.from('live_matches')
                        .update({
                            match_id: matchId,
                            host_address: myAddress?.toLowerCase() || null,
                            spectator_count: 0,
                            bet_window_status: 'closed'
                        })
                        .eq('room_code', currentRoomCode || roomId)
                        .then();
                }
            }
        } else if (type === 'ROLL_DICE') {
            setGameState((prev: GameState) => ({
                ...prev,
                diceValue: data.value ?? prev.diceValue,
                isRolling: data.isRolling ?? false,
                gamePhase: data.gamePhase ?? prev.gamePhase,
                lastAction: { type: 'ROLL_DICE', payload: data }
            }));
        } else if (type === 'MOVE_TOKEN') {
            const payload = data.payload || data;
            const { color, tokenIndex, targetPosition } = payload;
            setGameState(prev => {
                const newPos = { ...prev.positions };
                newPos[color as PlayerColor] = [...newPos[color as PlayerColor]];
                newPos[color as PlayerColor][tokenIndex] = targetPosition;
                return { ...prev, positions: newPos, lastUpdate: Date.now(), lastAction: { type: 'MOVE_TOKEN', payload } };
            });
        } else if (type === 'TURN_SWITCH') {
            const nextPlayer = data.nextPlayer || data.currentPlayer;
            setGameState((prev: GameState) => ({
                ...prev,
                currentPlayer: nextPlayer,
                diceValue: null,
                isRolling: false,
                gamePhase: 'rolling',
                lastUpdate: Date.now(),
                lastAction: { type: 'TURN_SWITCH', payload: data }
            }));
        } else if (type === 'DICE_COMMIT') {
            handleCommitReceived(data.sender, data.hash, lobbyStateRef as any);
        } else if (type === 'DICE_REVEAL') {
            handleRevealReceived(data.sender, data.nonce, lobbyStateRef as any);
        }
    }, [processedActionIds, processedIntentIds, handleCommitReceived, handleRevealReceived, setGameState, setLobbyState, setIsLobbyConnected, isHost, myAddress, currentRoomCode, roomId, applyServerState, seatGuestPlayer]);

    // 🔄 Sync Profile to peers when local profile updates
    useEffect(() => {
        if (!isLobbyConnected || !myAddress || !myProfile) return;
        
        const payload = {
            type: 'SYNC_PROFILE',
            address: myAddress,
            username: myProfile.username,
            avatar_url: myProfile.avatar_url,
            validationToken
        };

        connections.forEach(conn => {
            if (conn.open) {
                console.log('📤 [TeamUp] Broadcasting updated profile to:', conn.peer);
                conn.send(payload);
            }
        });
    }, [myProfile, myAddress, connections, isLobbyConnected, validationToken]);

    const handleGuestData = useCallback((data: any, conn: DataConnection) => {
        if (data.type === 'SYNC_PROFILE') {
            seatGuestPlayer({
                address: data.address,
                username: data.username,
                avatar_url: data.avatar_url,
                desiredSeat: data.desiredSeat,
                validationToken: data.validationToken,
                peerId: conn.peer,
            });
        } else if (data.type === 'LOBBY_SYNC' && data.lobbyState && !isHost) {
            setLobbyState(data.lobbyState);
        } else if (data.type === 'START_GAME') {
            processGameAction(data);
        } else if (data.type === 'GAME_ACTION') {
            if (isHost) {
                const intentId = data.action?.intentId as string | undefined;
                if (intentId && processedIntentIds.current.has(intentId)) return;
                if (intentId) processedIntentIds.current.add(intentId);
                console.log('📬 [Host] Received Intent (PeerJS):', data.action);
                setLastIntent(data.action);
            }
        } else if (data.type === 'DICE_COMMIT' || data.type === 'DICE_REVEAL') {
            processGameAction(data);
        }
    }, [processGameAction, seatGuestPlayer, isHost, setLobbyState]);

    const hostGame = useCallback((forcedRoomId?: string, expectedValidationToken?: string) => {
        destroyPeer();
        setIsHost(true);
        // Prefer the matchmaking token; otherwise mint a room secret so
        // invite links are not open-join if the code leaks via live-chat.
        const joinSecret = expectedValidationToken || crypto.randomUUID();
        expectedValidationTokenRef.current = joinSecret;
        setRoomSecret(joinSecret);
        const code = forcedRoomId || Math.random().toString(36).substring(2, 8).toUpperCase();
        setRoomId(code);
        setCurrentRoomCode(code);
        setRelayRoom(code);
        setIsLobbyConnected(false);

        void (async () => {
            const peer = await createPeerInstance(code);
            peerRef.current = peer as unknown as Peer;

            peer.on('open', (id: unknown) => {
                console.log('📡 [Host] Peer opened with ID:', id);
                setIsLobbyConnected(true);
            });

            peer.on('disconnected', () => {
                console.warn('📡 [Host] Peer disconnected — reconnecting');
                if (!peer.destroyed) {
                    try { peer.reconnect(); } catch (e) { console.error(e); }
                }
            });

            peer.on('error', (err: unknown) => {
                const e = err as { type?: string; message?: string };
                console.error('📡 [Host] Peer error:', e?.type, e?.message);
                setIsLobbyConnected(false);
            });

            peer.on('connection', (conn: unknown) => {
                const c = conn as {
                    on: (ev: string, cb: (d?: unknown) => void) => void;
                    send: (d: unknown) => void;
                    peer: string;
                    close: () => void;
                };
                c.on('open', () => {
                    setConnections(prev => {
                        const next = new Map(prev);
                        next.set(c.peer, c as unknown as DataConnection);
                        connectionsRef.current = next;
                        return next;
                    });
                    c.send({ type: 'SYNC_STATE', gameState: sanitizeGameStateForWire(gameStateRef.current) });
                    if (lobbyStateRef.current) c.send({ type: 'LOBBY_SYNC', lobbyState: lobbyStateRef.current });
                });
                c.on('data', (d) => handleGuestData(d as Parameters<typeof handleGuestData>[0], c as unknown as DataConnection));
            });
        })();

        // ☁️ Register preliminary match node (bind host for signed bet settlement)
        supabase.from('live_matches')
            .upsert({
                room_code: code,
                host_address: myAddress?.toLowerCase() || null,
                bet_window_status: 'closed',
                created_at: new Date().toISOString()
            } as any, { onConflict: 'room_code' })
            .select()
            .then(res => {
                if (res.data?.[0]) {
                    // match_id updated on START_GAME
                }
            });
    }, [destroyPeer, setIsHost, myAddress, setRoomId, setCurrentRoomCode, setIsLobbyConnected, peerRef, lobbyStateRef, setConnections, gameStateRef, handleGuestData, setRelayRoom]);

    const joinGame = useCallback((targetRoomId: string, token?: string, desiredSeat?: number) => {
        destroyPeer();
        setIsHost(false);
        setValidationToken(token);
        setCurrentRoomCode(targetRoomId);
        // Sync ref immediately so JOIN_REQUEST hits the right channel this tick.
        setRelayRoom(targetRoomId);
        desiredSeatRef.current = Number.isInteger(desiredSeat) ? desiredSeat : undefined;

        // Dual-path seat: Supabase JOIN_REQUEST (works when PeerJS is blocked).
        // Retry a few times so the host channel subscription can come up.
        if (myAddress) {
            const joinPayload = {
                type: 'JOIN_REQUEST',
                address: myAddress,
                username: myProfile?.username,
                avatar_url: myProfile?.avatar_url,
                desiredSeat: desiredSeatRef.current,
                validationToken: token,
            };
            let attempts = 0;
            const sendJoin = () => {
                attempts += 1;
                relayViaSupabase('lobby-action', joinPayload, lobbyStateRef as any);
                if (attempts < 5) setTimeout(sendJoin, 1500);
            };
            sendJoin();
            // Treat lobby as connected once we can talk to the channel
            setIsLobbyConnected(true);
        }

        void (async () => {
            const peer = await createPeerInstance();
            peerRef.current = peer as unknown as Peer;

            const connect = (att: number) => {
                const conn = peer.connect(targetRoomId, { reliable: true });
                conn.on('open', () => {
                    setConnections(new Map([[conn.peer, conn as unknown as DataConnection]]));
                    setIsLobbyConnected(true);
                    if (myAddress) conn.send({
                        type: 'SYNC_PROFILE',
                        address: myAddress,
                        username: myProfile?.username,
                        avatar_url: myProfile?.avatar_url,
                        validationToken: token,
                        desiredSeat: desiredSeatRef.current ?? undefined,
                    });
                    desiredSeatRef.current = undefined;
                });
                conn.on('data', (d: unknown) => handleGuestData(d as Parameters<typeof handleGuestData>[0], conn as unknown as DataConnection));
                conn.on('close', () => {
                    console.warn('🚪 [Guest] Connection closed by host');
                    setIsLobbyConnected(false);
                });
                conn.on('error', () => {
                    if (att < 5) setTimeout(() => connect(att + 1), 1500 * att);
                });
            };

            peer.on('open', () => connect(1));
            peer.on('error', (err: unknown) => {
                const e = err as { type?: string; message?: string };
                console.error('🚪 [Guest] Peer error:', e?.type, e?.message);
            });
            peer.on('disconnected', () => {
                if (!peer.destroyed) {
                    try { peer.reconnect(); } catch { /* ignore */ }
                }
            });
        })();
    }, [destroyPeer, setIsHost, setValidationToken, setCurrentRoomCode, peerRef, myAddress, myProfile, setConnections, setIsLobbyConnected, handleGuestData, relayViaSupabase, lobbyStateRef, setRelayRoom]);

    // Seats self in slot 0 and publishes immediately so the guest sees a
    // forming lobby even before P2P connects. Bypasses broadcastLobbyAction's
    // isHost gate (setIsHost may not have flushed yet) by sending directly.
    const initQuickLobby = useCallback((roomCode: string, matchType: '1v1' | '2v2' | '4P', gameMode: 'classic' | 'power' = 'classic', entryFee: number = 0) => {
        const slots = createLobbySlots(matchType);
        slots[0] = {
            ...slots[0],
            status: 'joined',
            playerId: myAddress?.toLowerCase(),
            playerName: myProfile?.username ?? undefined,
            playerAvatar: myProfile?.avatar_url ?? undefined,
            peerId: roomCode,
        };
        const lobby: LobbyState = {
            roomCode,
            hostId: myAddress?.toLowerCase() || '',
            matchType,
            gameMode,
            entryFee,
            slots,
            status: 'forming',
            createdAt: Date.now(),
        };
        setLobbyState(lobby);
        lobbyStateRef.current = lobby;
        const payload = { type: 'LOBBY_SYNC', lobbyState: lobby };
        broadcastToAll(payload);
        relayViaSupabase('lobby-action', payload, lobbyStateRef as any);
    }, [myAddress, myProfile, setLobbyState, lobbyStateRef, broadcastToAll, relayViaSupabase]);

    // One-call room hosting for manual lobbies (Team Up panel, invites):
    // generates a code, spins up PeerJS hosting, AND creates lobby state.
    // Returns the room code synchronously so invite links work immediately.
    const hostQuickLobby = useCallback((matchType: '1v1' | '2v2' | '4P', gameMode: 'classic' | 'power' = 'classic', entryFee: number = 0) => {
        const code = generateRoomCode();
        hostGame(code);
        initQuickLobby(code, matchType, gameMode, entryFee);
        return code;
    }, [hostGame, initQuickLobby]);

    /** Public-pool fill: matchmaking already paired guests — do not require room secret. */
    const allowOpenJoins = useCallback(() => {
        expectedValidationTokenRef.current = null;
        setRoomSecret(null);
    }, []);

    const leaveGame = useCallback(() => {
        destroyPeer();
        setIsHost(false);
        setIsLobbyConnected(false);
        setRoomId('');
        setConnections(new Map());
        setGameState(INITIAL_GAME_STATE);
        setLobbyState(null);
        setParticipants({});
        expectedValidationTokenRef.current = null;
        setRoomSecret(null);
        setValidationToken(undefined);
        serverSeqRef.current = 0;
        setServerSeq(0);

        if (myAddress) {
            supabase.from('players')
                .update({ status: 'Online', current_room_code: null })
                .eq('wallet_address', myAddress)
                .then();
        }
    }, [destroyPeer, setIsHost, setIsLobbyConnected, setRoomId, setConnections, setGameState, setLobbyState, setParticipants, myAddress]);

    const acceptInvite = useCallback(() => { if (pendingInvite) { joinGame(pendingInvite.roomCode); setPendingInvite(null); } }, [pendingInvite, joinGame, setPendingInvite]);
    const rejectInvite = useCallback(() => setPendingInvite(null), [setPendingInvite]);
    /**
     * Public-pool quick match (non-hybrid). Hosts a room when we win the
     * pair race as host, otherwise joins the returned room as guest.
     * Hybrid party fill stays in QuickMatchPanel via useMatchmaking.
     */
    const startQuickMatch = useCallback(async (opts?: {
        gameMode?: 'classic' | 'power';
        matchType?: '1v1' | '2v2' | '4P';
        wager?: number;
    }) => {
        if (!myAddress) {
            console.warn('startQuickMatch requires a wallet');
            return;
        }
        const gameMode = opts?.gameMode ?? 'classic';
        const matchType = opts?.matchType ?? '1v1';
        const wager = opts?.wager ?? 0;
        try {
            const res = await fetch('/api/matchmaking/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId: myAddress.toLowerCase(),
                    gameMode,
                    matchType,
                    wager,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                console.error('startQuickMatch join failed', data);
                return;
            }
            if (data.status === 'matched' && data.room_code) {
                const token = data.validation_token as string | undefined;
                const weAreHost = data.host_id
                    ? String(data.host_id).toLowerCase() === myAddress.toLowerCase()
                    : false;
                if (weAreHost) {
                    hostGame(data.room_code, token);
                    initQuickLobby(data.room_code, matchType, gameMode, wager);
                } else {
                    joinGame(data.room_code, token);
                }
            } else {
                console.log('startQuickMatch queued', data);
            }
        } catch (err) {
            console.error('startQuickMatch failed', err);
        }
    }, [myAddress, hostGame, joinGame, initQuickLobby]);
    const updateGameState = useCallback((s: any) => setGameState(p => ({ ...p, ...s, lastUpdate: Date.now() })), [setGameState]);
    
    /**
     * Guest → host intent. Dual-path: PeerJS when open, always also via
     * Supabase broadcast so NAT/firewall drops on PeerJS don't mute the guest.
     * Both paths share `intentId` so the host applies each intent once.
     */
    const sendIntent = useCallback((type: string, payload: any) => {
        if (!isLobbyConnected || isHost || isComputeHost) return;
        const intentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const action = { type, payload, sender: myAddress, intentId };

        const conn = Array.from(connections.values())[0];
        if (conn && conn.open) {
            conn.send({ type: 'GAME_ACTION', action });
        }
        // Cloud path — primary when PeerJS is blocked
        relayViaSupabase('game-action', { type: 'GAME_INTENT', action }, lobbyStateRef);
    }, [isLobbyConnected, isHost, isComputeHost, connections, myAddress, relayViaSupabase, lobbyStateRef]);

    const clearIntent = useCallback(() => setLastIntent(null), []);

    const value = useMemo(() => ({
        roomId, connection: connections.values().next().value || null, connections, isLobbyConnected, isHost, isComputeHost, activePlayers, gameState, lobbyState,
        pendingInvite, hostGame, joinGame, initQuickLobby, hostQuickLobby, sendIntent, broadcastAction, broadcastLobbyAction,
        swapPlayers, kickPlayer, sendInvite, acceptInvite, rejectInvite, startQuickMatch, myAddress, updateGameState,
        participants, lastIntent, clearIntent, leaveGame, validationToken,
        roomSecret, allowOpenJoins, serverSeq, applyServerState,
        activeBetWindow, startBettingWindow
    }), [
        roomId, connections, isLobbyConnected, isHost, isComputeHost, activePlayers, gameState, lobbyState, pendingInvite, hostGame, joinGame, initQuickLobby, hostQuickLobby,
        sendIntent, broadcastAction, broadcastLobbyAction, swapPlayers, kickPlayer, sendInvite, acceptInvite, rejectInvite,
        startQuickMatch, myAddress, updateGameState, participants, lastIntent, clearIntent, leaveGame, validationToken,
        roomSecret, allowOpenJoins, serverSeq, applyServerState,
        activeBetWindow, startBettingWindow
    ]);

    return (
        <TeamUpContext.Provider value={value}>
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
