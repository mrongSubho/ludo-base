"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { supabase } from '@/lib/supabase';
import { useAccount, useSignMessage } from 'wagmi';
import { useGameData } from '@/hooks/GameDataContext';
import { useLobbyManager } from '@/hooks/useLobbyManager';
import { useSupabaseRelay } from '@/hooks/useSupabaseRelay';
import { useProvablyFairDice } from '@/hooks/useProvablyFairDice';
import { useGamePresence } from '@/hooks/useGamePresence';
import { buildBetResolveMessage } from '@/lib/matchProof';
import {
    GameState,
    PlayerColor,
    GameActionType,
    LobbyState,
    LobbySlot,
    InvitePayload,
    LobbyActionType,
    BetType,
    BetWindowPayload,
    BetWindowClosedPayload,
} from '@/lib/types';
import { ActiveBettingWindow } from './useSpectatorSync';
import {
    handleThreeSixes,
    getNextPlayer,
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
    activeBetWindow: ActiveBettingWindow | null;
    startBettingWindow: (betType: BetType) => Promise<string>;
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
    const [activeBetWindow, setActiveBetWindow] = useState<ActiveBettingWindow | null>(null);

    const { address: myAddress } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const { myProfile } = useGameData();
    const [lastIntent, setLastIntent] = useState<any | null>(null);
    // Matchmaking validation token the host will require from guests (if set).
    const expectedValidationTokenRef = useRef<string | null>(null);

    const gameStateRef = useRef(gameState);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

    const peerRef = useRef<Peer | null>(null);
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
        broadcastToAll
    });

    // 2. Supabase Relay (define relayViaSupabase early)
    const { relayViaSupabase, processedActionIds } = useSupabaseRelay({
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

            setGameState((prev: GameState) => ({
                ...prev,
                isStarted: true,
                playerCount: payload.playerCount || prev.playerCount,
                initialBoardConfig: payload.initialBoardConfig
            }));
            
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

        const actionData = {
            type,
            ...payload,
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

    // 4. Betting Window Controller
    const startBettingWindow = useCallback(async (betType: BetType): Promise<string> => {
        if (!isHost) return new Date().toISOString();
        
        const windowId = crypto.randomUUID();
        const expiresAt = Date.now() + 3000;
        
        const openPayload: BetWindowPayload = { windowId, betType, expiresAt, matchId: gameState.matchId };
        broadcastAction('BET_WINDOW_OPEN', openPayload);
        setActiveBetWindow({ windowId, betType, expiresAt, windowClosedAt: null });

        // ☁️ Sync to live_matches
        if (gameState.matchId) {
            supabase.from('live_matches')
                .update({ 
                    bet_window_status: 'open', 
                    current_bet_type: betType,
                    window_opened_at: new Date().toISOString() 
                })
                .eq('match_id', gameState.matchId)
                .then();
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

        const windowClosedAt = new Date().toISOString();
        const closePayload: BetWindowClosedPayload = { windowId, windowClosedAt };
        broadcastAction('BET_WINDOW_CLOSED', closePayload);
        setActiveBetWindow(prev => prev?.windowId === windowId ? { ...prev, windowClosedAt } : prev);
        
        // ☁️ Sync to live_matches
        if (gameState.matchId) {
            supabase.from('live_matches')
                .update({ 
                    bet_window_status: 'closed', 
                    window_closed_at: windowClosedAt 
                })
                .eq('match_id', gameState.matchId)
                .then();
        }

        return windowClosedAt;
    }, [isHost, gameState.matchId, broadcastAction]);

    // 5. Provably Fair Dice
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
        resolveBet: async (matchId: string, result: string, betType: string) => {
            if (!isHost || !myAddress) return;
            console.log('🎰 [Host] Triggering signed bet resolution:', { matchId, result, betType });
            try {
                const issuedAt = new Date().toISOString();
                const message = buildBetResolveMessage({
                    matchId,
                    result: String(result),
                    betType,
                    hostAddress: myAddress,
                    issuedAt,
                });
                const signature = await signMessageAsync({ account: myAddress as `0x${string}`, message });
                const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/resolve-bet`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
                    },
                    body: JSON.stringify({
                        matchId,
                        result: String(result),
                        betType,
                        hostAddress: myAddress,
                        message,
                        signature,
                        issuedAt,
                    })
                });
                const data = await res.json();
                if (!res.ok) console.error('🎰 [Host] resolve-bet rejected', data);
                else console.log('🎰 [Host] resolve-bet ok', data);
            } catch (err) {
                console.error('🎰 [Host] resolve-bet failed', err);
            }
        }
    });

    // 6. Game Engine Action Processor
    const processGameAction = useCallback((data: any) => {
        const { type, actionId, stateOverride } = data;
        if (actionId && processedActionIds.current.has(actionId)) return;
        if (actionId) processedActionIds.current.add(actionId);

        console.log('🕹️ Processing action:', type, data);

        // 🏟️ Lobby sync (guest applies host state; host ignores echoes)
        if (type === 'LOBBY_SYNC' && (data as any).lobbyState && !isHost) {
            console.log('🏟️ [Guest] Applying lobby sync');
            setLobbyState((data as any).lobbyState);
            return;
        }

        // 🌟 Authoritative State Override (If provided by Host)
        if (stateOverride && !isHost) {
            console.log('🌟 [Guest] Applying State Override');
            setGameState(prev => ({
                ...stateOverride,
                lastUpdate: Date.now(),
                lastAction: { type, payload: data }
            }));
            // If it's a state override, we may still want to trigger type-specific side effects
            // but we skip the manual state patches below.
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
    }, [processedActionIds, handleCommitReceived, handleRevealReceived, setGameState, setLobbyState, isHost, myAddress, currentRoomCode, roomId]);

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
            // Require the matchmaking validation token when the host has one.
            // Invite lobbies without a token keep open-join (documented gap).
            if (isHost && expectedValidationTokenRef.current) {
                const presented = typeof data.validationToken === 'string' ? data.validationToken : '';
                if (presented !== expectedValidationTokenRef.current) {
                    console.warn('🚫 [Host] Rejected join — invalid validation token', { peer: conn.peer });
                    try { conn.close(); } catch { /* already closed */ }
                    return;
                }
            }
            setParticipants(prev => ({
                ...prev,
                [data.address]: {
                    address: data.address,
                    username: data.username,
                    avatar_url: data.avatar_url,
                    color: prev[data.address]?.color
                }
            }));
            // Seat the joiner (host authority). Runs for host only; guests ignore.
            // Invitees already hold their seat as 'invited' — upgrade them to
            // 'joined' instead of bouncing off the already-seated guard.
            if (isHost && data.address) {
                const cur = lobbyStateRef.current;
                if (cur) {
                    const addr = data.address.toLowerCase();
                    const invitedIdx = cur.slots.findIndex(s => s.playerId?.toLowerCase() === addr && s.status !== 'joined');
                    let next: LobbySlot[] | null = null;
                    // Honored seat request (invite-link ?seat=N): an exactly
                    // empty seat wins over first-empty. Invited seats are
                    // never 'empty', so reservations can't be stolen this way;
                    // a taken/missing seat falls through to normal assignment.
                    const want = Number.isInteger(data.desiredSeat) ? (data.desiredSeat as number) : -1;
                    if (want >= 0 && want < cur.slots.length && cur.slots[want]?.status === 'empty') {
                        next = cur.slots.map((s, i) => i === want
                            ? { ...s, status: 'joined' as const, playerId: data.address, playerName: data.username || `Player ${want + 1}`, playerAvatar: data.avatar_url, peerId: conn.peer }
                            : { ...s });
                    } else if (invitedIdx !== -1) {
                        next = cur.slots.map((s, i) => i === invitedIdx
                            ? { ...s, status: 'joined' as const, playerName: data.username || s.playerName, playerAvatar: data.avatar_url || s.playerAvatar, peerId: conn.peer }
                            : { ...s });
                    } else {
                        next = assignJoinerToSlot(cur.slots, cur.matchType, data.address, data.username, data.avatar_url, conn.peer);
                    }
                    if (next) {
                        const lobby = { ...cur, slots: next };
                        setLobbyState(lobby);
                        lobbyStateRef.current = lobby;
                        broadcastLobbyAction('LOBBY_SYNC', { lobbyState: lobby });
                    }
                }
            }
        } else if (data.type === 'LOBBY_SYNC' && data.lobbyState && !isHost) {
            setLobbyState(data.lobbyState);
        } else if (data.type === 'START_GAME') {
            processGameAction(data);
        } else if (data.type === 'GAME_ACTION') {
            if (isHost) {
                console.log('📬 [Host] Received Intent:', data.action);
                setLastIntent(data.action);
            }
        } else if (data.type === 'DICE_COMMIT' || data.type === 'DICE_REVEAL') {
            processGameAction(data);
        }
    }, [processGameAction, setParticipants, isHost, setLobbyState, lobbyStateRef, broadcastLobbyAction]);

    const hostGame = useCallback((forcedRoomId?: string, expectedValidationToken?: string) => {
        destroyPeer();
        setIsHost(true);
        expectedValidationTokenRef.current = expectedValidationToken || null;
        const code = forcedRoomId || Math.random().toString(36).substring(2, 8).toUpperCase();
        setRoomId(code);
        setCurrentRoomCode(code);
        const peer = new Peer(code);
        peerRef.current = peer;

        peer.on('open', (id) => {
            console.log('📡 [Host] Peer opened with ID:', id);
            setIsLobbyConnected(true);
        });

        // ☁️ Register preliminary match node (bind host for signed bet settlement)
        // match_id will be updated once START_GAME is called
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
                    // We don't have the real match ID yet, but we'll update it later
                }
            });

        peer.on('connection', (conn) => {
            conn.on('open', () => {
                setConnections(prev => {
                    const next = new Map(prev);
                    next.set(conn.peer, conn);
                    connectionsRef.current = next;
                    return next;
                });
                conn.send({ type: 'SYNC_STATE', gameState: sanitizeGameStateForWire(gameStateRef.current) });
                if (lobbyStateRef.current) conn.send({ type: 'LOBBY_SYNC', lobbyState: lobbyStateRef.current });
            });
            conn.on('data', (d) => handleGuestData(d, conn));
        });
    }, [destroyPeer, setIsHost, setValidationToken, myAddress, setLobbyState, setRoomId, setCurrentRoomCode, setIsLobbyConnected, peerRef, lobbyStateRef, setConnections, gameStateRef, handleGuestData]);

    const joinGame = useCallback((targetRoomId: string, token?: string, desiredSeat?: number) => {
        destroyPeer();
        setIsHost(false);
        setValidationToken(token);
        setCurrentRoomCode(targetRoomId);
        desiredSeatRef.current = Number.isInteger(desiredSeat) ? desiredSeat : undefined;
        const peer = new Peer();
        peerRef.current = peer;

        const connect = (p: Peer, att: number) => {
            const conn = p.connect(targetRoomId);
            conn.on('open', () => {
                setConnections(new Map([[conn.peer, conn]]));
                setIsLobbyConnected(true);
                if (myAddress) conn.send({ type: 'SYNC_PROFILE', address: myAddress, username: myProfile?.username, avatar_url: myProfile?.avatar_url, validationToken: token, desiredSeat: desiredSeatRef.current ?? undefined });
                desiredSeatRef.current = undefined;
            });
            conn.on('data', (d) => handleGuestData(d, conn));
            // Bounded retries: each attempt carries slow ICE on mobile data,
            // so 3 tries then stop — the lobby layer reports unreachable.
            conn.on('error', () => { if (att < 3) setTimeout(() => connect(p, att + 1), 1500); });
        };
        peer.on('open', () => connect(peer, 1));
    }, [destroyPeer, setIsHost, setValidationToken, setCurrentRoomCode, peerRef, myAddress, myProfile, setConnections, setIsLobbyConnected, handleGuestData]);

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

    const leaveGame = useCallback(() => {
        destroyPeer();
        setIsHost(false);
        setIsLobbyConnected(false);
        setRoomId('');
        setConnections(new Map());
        setGameState(INITIAL_GAME_STATE);
        setLobbyState(null);
        setParticipants({});

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
    
    const sendIntent = useCallback((type: string, payload: any) => {
        if (!isLobbyConnected || isHost || isComputeHost) return;
        const conn = Array.from(connections.values())[0];
        if (conn && conn.open) {
            conn.send({ type: 'GAME_ACTION', action: { type, payload, sender: myAddress } });
        }
    }, [isLobbyConnected, isHost, connections, myAddress]);

    const clearIntent = useCallback(() => setLastIntent(null), []);

    const value = useMemo(() => ({
        roomId, connection: connections.values().next().value || null, connections, isLobbyConnected, isHost, isComputeHost, activePlayers, gameState, lobbyState,
        pendingInvite, hostGame, joinGame, initQuickLobby, hostQuickLobby, sendIntent, broadcastAction, broadcastLobbyAction,
        swapPlayers, kickPlayer, sendInvite, acceptInvite, rejectInvite, startQuickMatch, myAddress, updateGameState,
        participants, lastIntent, clearIntent, leaveGame, validationToken,
        activeBetWindow, startBettingWindow
    }), [
        roomId, connections, isLobbyConnected, isHost, isComputeHost, activePlayers, gameState, lobbyState, pendingInvite, hostGame, joinGame, initQuickLobby, hostQuickLobby,
        sendIntent, broadcastAction, broadcastLobbyAction, swapPlayers, kickPlayer, sendInvite, acceptInvite, rejectInvite,
        startQuickMatch, myAddress, updateGameState, participants, lastIntent, clearIntent, leaveGame, validationToken,
        activeBetWindow, startBettingWindow
    ]);

    return (
        <TeamUpContext.Provider value={value}>
            {children}
        </TeamUpContext.Provider>
    );
};

export { TeamUpProvider };

/**
 * Strip hidden power-tile types before any network send.
 * Guests/spectators must only see coordinates; types stay on the authority.
 */
function sanitizeGameStateForWire<T extends { powerTiles?: { r: number; c: number; type?: unknown }[] }>(state: T): T {
    if (!state?.powerTiles?.length) return state;
    return {
        ...state,
        powerTiles: state.powerTiles.map(t => ({ r: t.r, c: t.c })),
    };
}

export const useTeamUpContext = () => {
    const context = useContext(TeamUpContext);
    if (!context) {
        throw new Error('useTeamUpContext must be used within a TeamUpProvider');
    }
    return context;
};
