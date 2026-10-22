/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { supabase } from '@/lib/supabase';
import { useAccount, useChainId, useSignTypedData } from 'wagmi';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import { useGameData } from '@/hooks/GameDataContext';
import { useLobbyManager } from '@/hooks/useLobbyManager';
import { useSupabaseRelay } from '@/hooks/useSupabaseRelay';
import { useProvablyFairDice } from '@/hooks/useProvablyFairDice';
import { useGamePresence } from '@/hooks/useGamePresence';
import { useBettingController } from '@/hooks/useBettingController';
import { useSignedResolveBet } from '@/hooks/useSignedResolveBet';
import { useMoveAuth, clearAllMoveSessions } from '@/hooks/useMoveAuth';
import { useAppSession } from '@/hooks/useAppSession';
import { useMatchStates } from '@/hooks/useMatchStates';
import { sanitizeGameStateForWire } from '@/lib/wireSanitize';
import { createPeerInstance } from '@/lib/peerFactory';
import { RoomClient } from '@/lib/netcode/roomClient';
import { INITIAL_GAME_STATE as ENGINE_INIT, calculateNextPosition } from '@/lib/gameLogic';
import {
    GameState,
    PlayerColor,
    GameActionType,
    LobbyState,
    LobbySlot,
    InvitePayload,
    LobbyActionType,
    BetType,
    GameIntentType,
    GameIntentPayloads,
    GameIntent,
    GameActionPayload,
} from '@/lib/types';
import { createGameIntent, isGameIntent } from '@/lib/gameProtocol';
import { createDedupStore, rememberIntent, type DedupStore } from '@/lib/netcode/dedup';
import { shouldApplyGameAction } from '@/lib/netcode/authorityGate';
import {
    classifyAbandon,
    recordAbandonAttempt,
    abandonGraceRemainingMs,
    ABANDON_GRACE_MS,
    type AbandonOutcome,
} from '@/lib/netcode/abandon';
import { bumpNet, resetNetCounters } from '@/lib/netcode/counters';
import { track } from '@/lib/telemetry';
import { createMatchFsm, type MatchFsmEvent, type MatchPhase } from '@/lib/matchFsm';
import { ActiveBettingWindow } from './useSpectatorSync';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
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
    /** SEC-12: the third arg declares the lobby's join door. */
    hostGame: (roomId?: string, expectedValidationToken?: string, joinPolicy?: 'matchmaking' | 'invite' | 'open') => void;
    joinGame: (roomId: string, token?: string, desiredSeat?: number) => void;
    initQuickLobby: (roomCode: string, matchType: '1v1' | '2v2' | '4P', gameMode?: 'classic' | 'power', entryFee?: number) => void;
    hostQuickLobby: (matchType: '1v1' | '2v2' | '4P', gameMode?: 'classic' | 'power', entryFee?: number) => string;
    sendIntent: <T extends GameIntentType>(type: T, payload: GameIntentPayloads[T]) => void;
    broadcastAction: <T extends GameActionType>(type: T, payload?: GameActionPayload<T>, fullState?: GameState) => void;
    broadcastLobbyAction: (type: LobbyActionType, payload?: Record<string, unknown>) => void;
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
    createProvisionalSession: (
        authorizationKey: string,
        roomCode?: string,
        opts?: { context?: import('@/hooks/useAuthPrompt').AuthPromptContext; title?: string; statusText?: string }
    ) => Promise<{ ok: boolean; provisionalId?: string; error?: string }>;
    bindProvisionalSession: (provisionalId: string, matchId: string, roomCode?: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
    myAddress: string | undefined;
    updateGameState: (state: Partial<GameState>) => void;
    participants: Record<string, { address: string; username?: string; avatar_url?: string; color?: PlayerColor; lxp?: number; rxp?: number }>;
    /** Oldest unprocessed guest intent (head of the FIFO queue). */
    lastIntent: GameIntent | null;
    /** NET-04: the full FIFO queue — `lastIntent` is its head. */
    intentQueue: readonly GameIntent[];
    /** NET-04: drop the QUEUE HEAD only. Never clears a whole queue. */
    clearIntent: () => void;
    /**
     * NET-07: abandon classification. `classifyAndRecordAbandon` is the single
     * entry point for the disconnect path — it stamps nothing itself, it
     * reads the disconnect clock below and records the outcome for the audit
     * trail (no funds move while ABANDON_BURN_SPLIT_ENABLED is false).
     */
    recordDisconnect: (wallet: string | undefined) => void;
    clearDisconnect: (wallet: string | undefined) => void;
    classifyAndRecordAbandon: (params: {
        accusedSeat: string;
        hasEdgeSig: boolean;
        hasHostSig: boolean;
        matchEnded?: boolean;
    }) => AbandonOutcome;
    /** Remaining grace for a disconnected seat, or null if connected. */
    abandonGraceFor: (wallet: string | undefined) => number | null;
    leaveGame: () => void;
    validationToken?: string;
    /** Host join secret for invite links (`?s=`). Null when not hosting. */
    roomSecret: string | null;
    /** Hybrid public fill: guests arrive via matchmaking tokens — drop the room-secret gate. */
    allowOpenJoins: () => void;
    /** Host-only: step entry fee down one preset (never raises). Guests get LOBBY_SYNC. */
    lowerEntryFee: () => void;
    activeBetWindow: ActiveBettingWindow | null;
    startBettingWindow: (betType: BetType) => Promise<string>;
    /** P4: monotonic match_states.seq known to this client. */
    serverSeq: number;
    /**
     * NET-02: the seq REF of record (same value as `serverSeq`, but a ref so
     * writers and readers never race React's render timing). Networked actions
     * read `serverSeqRef.current` for `expectedSeq`; `applyServerState` owns
     * the write. Exposed so useGameEngine holds no second copy.
     */
    serverSeqRef: React.MutableRefObject<number>;
    /** Apply a server-authoritative state (Edge / match_states). */
    applyServerState: (state: GameState, seq: number, allowEqual?: boolean) => void;
    /** True after a snapshot has been applied since the latest reconnect. */
    hasAuthoritativeSnapshot: boolean;
    matchConnectionStatus: MatchConnectionStatus;
    /** E5 match lifecycle phase (lobby→seating→live→resyncing→ended). */
    matchPhase: MatchPhase;
    /** Illegal FSM transitions observed (should stay 0 in healthy matches). */
    matchFsmIllegal: number;
    /**
     * TU-4: is the MatchRoom Durable Object the authority for this match?
     *
     * This is a TRANSPORT fact, not a build-time preference. It becomes true only
     * when a `/api/room/:matchId/ws` socket is open and has reported `connected`,
     * and it drops back to false the moment that socket closes. While it is false
     * the P2P host is the authority and guests use intents — the degraded path, not
     * the intended one.
     */
    roomAuthority: boolean;
    /** Send an intent to the room. Rejects when no room socket is open. */
    sendRoomIntent: (kind: string, payload?: unknown) => Promise<{ ok: boolean; data?: unknown }>;
    /** Connect to the match room DO. */
    connectRoom: (matchId: string, seedPayload?: unknown) => void;
}

const TeamUpContext = createContext<TeamUpContextType | undefined>(undefined);

/**
 * TU-1: verbs that advance match rules state. Only honoured on the PeerJS
 * transport — the Supabase Realtime topic is a public broadcast channel, so a
 * `seq` number or a `sender` string arriving on it proves nothing about origin.
 */
const STATE_VERBS = new Set(['START_GAME', 'ROLL_DICE', 'MOVE_TOKEN', 'TURN_SWITCH', 'ENGINE_STATE', 'POWER_HAND']);

const TeamUpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [roomId, setRoomId] = useState('');
    const [currentRoomCode, setCurrentRoomCode] = useState<string | null>(null);
    const [connections, setConnections] = useState<Map<string, DataConnection>>(new Map());
    const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
    const [isLobbyConnected, setIsLobbyConnected] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
    const [validationToken, setValidationToken] = useState<string | undefined>(undefined);

    const { address: wagmiAddress } = useAccount();
    const chainId = useChainId();
    const player = usePlayerSigner();
    const myAddress = player.address ?? wagmiAddress;
    const { signTypedDataAsync } = useSignTypedData();
    const { sessionId: appSessionId, ensureAppSession, peekAppSession } = useAppSession();
    const { myProfile } = useGameData();
    const moveAuth = useMoveAuth({
        myAddress,
        signMessageAsync: player.signMessageAsync,
        signTypedDataAsync: player.signTypedDataAsync,
        chainId,
    });
    const createProvisionalSession = useCallback((
        authorizationKey: string,
        roomCode?: string,
        opts?: { context?: import('@/hooks/useAuthPrompt').AuthPromptContext; title?: string; statusText?: string }
    ) => moveAuth.createProvisionalSession({ authorizationKey, roomCode, ...opts }), [moveAuth]);
    const bindProvisionalSession = useCallback((provisionalId: string, matchId: string, roomCode?: string) =>
        moveAuth.bindProvisionalSession({ provisionalId, matchId, roomCode }), [moveAuth]);
    // NET-04: intents queue. The single-slot version dropped every intent
    // that arrived while the host was busy, so a fast guest's second roll or
    // move vanished with no ACK and no retry.
    const [intentQueue, setIntentQueue] = useState<GameIntent[]>([]);
    // Matchmaking validation token the host will require from guests (if set).
    const expectedValidationTokenRef = useRef<string | null>(null);
    // Host-only join secret for invite lobbies (not on the matchmaking path).
    // Embedded in invite links as `s=` and passed to joinGame as the token.
    const [roomSecret, setRoomSecret] = useState<string | null>(null);
    /** P4: highest match_states.seq this client has applied. */
    const serverSeqRef = useRef(0);
    const [serverSeq, setServerSeq] = useState(0);
    const [matchConnectionStatus, setMatchConnectionStatus] = useState<MatchConnectionStatus>('offline');
    const [hasAuthoritativeSnapshot, setHasAuthoritativeSnapshot] = useState(false);
    // Mirror for readers that must not re-subscribe when the flag flips
    // (the resync effect below reads it inside a callback).
    const hasAuthoritativeSnapshotRef = useRef(false);
    hasAuthoritativeSnapshotRef.current = hasAuthoritativeSnapshot;

    // E5 — single match lifecycle machine (illegal transitions are metered).
    const fsmRef = useRef(createMatchFsm('idle'));
    const [matchPhase, setMatchPhase] = useState<MatchPhase>(fsmRef.current.phase);
    const [matchFsmIllegal, setMatchFsmIllegal] = useState(0);
    const sendMatchEvent = useCallback((event: MatchFsmEvent) => {
        const from = fsmRef.current.phase;
        const to = fsmRef.current.send(event);
        if (to !== from) setMatchPhase(to);
        setMatchFsmIllegal(fsmRef.current.illegalTransitions);
        if (fsmRef.current.illegalTransitions > 0 && to === from) {
            track('net_degraded', { reason: 'fsm_illegal', event: event.type, phase: from });
        }
    }, []);

    const applyServerState = useCallback((state: GameState, seq: number, allowEqual = false) => {
        if (!Number.isFinite(seq) || (allowEqual ? seq < serverSeqRef.current : seq <= serverSeqRef.current)) return;
        serverSeqRef.current = Math.max(serverSeqRef.current, seq);
        setServerSeq(seq);
        setHasAuthoritativeSnapshot(true);
        setGameState(prev => {
            // NET-24: the wire strips authority-only power-tile types, so a
            // wholesale spread would destroy the HOST's own tile knowledge
            // (pickup logic needs `type`). Re-attach local types for tiles
            // that are still on the board at the same cell; tiles the server
            // respawned elsewhere correctly arrive typeless.
            const localTypes = new Map(
                (prev.powerTiles || []).map(t => [`${t.r},${t.c}`, (t as { type?: unknown }).type]),
            );
            const powerTiles = (state.powerTiles || []).map(t => {
                const type = localTypes.get(`${t.r},${t.c}`);
                return type === undefined ? t : { ...t, type };
            });

            // PW-2 fix: The wire strips opponent power types so opponent hands are masked on broadcast.
            // On a broadcast without viewerColor, state.playerPowers arrives with type: undefined.
            // Re-attach local power types from prev.playerPowers so the player's own hand is preserved.
            const playerPowers = { ...(state.playerPowers || prev.playerPowers) } as Record<PlayerColor, any[]>;
            if (prev.playerPowers) {
                for (const [color, items] of Object.entries(prev.playerPowers) as [PlayerColor, any[]][]) {
                    const serverItems = playerPowers[color];
                    if (!serverItems || !items) continue;
                    playerPowers[color] = serverItems.map((sItem: any, idx: number) => {
                        if (sItem.type !== undefined && sItem.type !== 'masked') return sItem;
                        const localMatch = items.find((l: any) => l.expiresAt === sItem.expiresAt && l.type !== undefined && l.type !== 'masked')
                            || (items[idx]?.type !== undefined && items[idx]?.type !== 'masked' ? items[idx] : undefined);
                        return localMatch ? { ...sItem, type: localMatch.type } : sItem;
                    });
                }
            }

            return {
                ...prev,
                ...state,
                powerTiles: powerTiles as GameState['powerTiles'],
                playerPowers: playerPowers as GameState['playerPowers'],
                lastUpdate: Date.now(),
            };
        });
        if (state.status === 'finished' || state.winner) {
            setMatchConnectionStatus('ended');
            sendMatchEvent({ type: 'FINISH' });
        } else if (state.isStarted) {
            sendMatchEvent({ type: 'START' });
            // RESYNC_APPLIED is only legal from resyncing — do not spam illegal events.
            if (fsmRef.current.phase === 'resyncing') {
                sendMatchEvent({ type: 'RESYNC_APPLIED' });
            }
        }
    }, [sendMatchEvent]);

    // ── MatchRoom transport (TU-4) ─────────────────────────────────────────────
    //
    // The server authority is already built: `src/room/MatchRoom.ts` is bound as
    // `MATCH_ROOM`, handles REQUEST_ROLL / REQUEST_MOVE / REQUEST_POWER in-process,
    // and commits atomically through `match_commit_action`. What was missing is a
    // consumer — `lib/netcode/roomClient.ts` existed with no caller, so the flag
    // that gated server authority was hardcoded false.
    //
    // Authority is now derived from the socket. Nothing here runs unless a room
    // actually opens, so a deployment without the DO behaves exactly as before and
    // a deployment with it stops using the host as the authority on its own.
    const roomClientRef = useRef<RoomClient | null>(null);
    const [roomAuthority, setRoomAuthority] = useState(false);
    /**
     * TU-4: the board the host owns at the moment the room becomes reachable. A
     * Durable Object starts empty, so the host must write its seed or the room has
     * nothing to resolve against. Held until the socket reports `connected`.
     */
    const pendingRoomSeedRef = useRef<unknown>(null);

    const teardownRoom = useCallback(() => {
        roomClientRef.current?.disconnect();
        roomClientRef.current = null;
        pendingRoomSeedRef.current = null;
        setRoomAuthority(false);
    }, []);

    const connectRoom = useCallback((matchId: string, seedPayload?: unknown) => {
        if (!matchId || matchId === 'local') return;
        if (roomClientRef.current) return;
        pendingRoomSeedRef.current = seedPayload ?? null;

        const doConnect = async () => {
            let ticket: string | undefined;
            try {
                const sid = appSessionId || peekAppSession();
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (sid) headers['authorization'] = `Bearer ${sid}`;
                const res = await fetch('/api/auth/match', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ matchId, as: 'match' }),
                });
                if (res.ok) {
                    const data = await res.json();
                    ticket = data.ticket;
                }
            } catch (e) {
                console.warn('[Room] Could not pre-fetch match ticket:', e);
            }

            try {
                const client = new RoomClient({
                    matchId,
                    ticket,
                    onState: (state, seq) => {
                        // The room's fan-out is the authority stream; seq-gate it like any
                        // other snapshot so a late frame cannot rewind the board.
                        applyServerState(state, seq);
                    },
                    onStatusChange: (status) => {
                        const connected = status === 'connected';
                        setRoomAuthority(connected);
                        // The host seeds on connect; guests skip this — the room already
                        // holds the board and the fan-out above brings them level.
                        if (connected && isHost && pendingRoomSeedRef.current) {
                            void client
                                .seedState(pendingRoomSeedRef.current)
                                .catch((err) => console.warn('🏟️ [Room] seed failed:', err));
                            pendingRoomSeedRef.current = null;
                        }
                    },
                    onRejected: (err) => {
                        console.warn('🏟️ [Room] intent rejected:', err.code, err.error);
                    },
                    onError: (err) => console.warn('🏟️ [Room] transport error:', err),
                });
                roomClientRef.current = client;
                client.connect();
            } catch (err) {
                // No WebSocket runtime / no room URL: stay on the host-authority path.
                console.warn('🏟️ [Room] unavailable, host remains the authority:', err);
                setRoomAuthority(false);
            }
        };

        void doConnect();
    }, [applyServerState, isHost, appSessionId]);

    const sendRoomIntent = useCallback(async (kind: string, payload?: unknown) => {
        const client = roomClientRef.current;
        if (!client) return { ok: false, data: { code: 'NO_ROOM' } };
        try {
            return await client.sendIntent(kind, payload ?? {});
        } catch (err) {
            return { ok: false, data: { code: 'ROOM_INTENT_FAILED', error: (err as Error).message } };
        }
    }, []);

    // P4: clients render match_states (postgres realtime + initial pull)
    useMatchStates({
        matchId: gameState.matchId,
        enabled: isLobbyConnected,
        onServerState: applyServerState,
        getSeq: () => serverSeqRef.current,
        refreshState: async (matchId) => {
            // PW-1/R3: read the snapshot through our own session-aware route, not the
            // orphaned edge `move-auth get`. That endpoint is unauthenticated and
            // returns `match_states.state` verbatim — `pickPersistedState` keeps
            // `playerPowers` WITH types, so it handed every opponent's hand to any
            // caller holding a matchId. `/api/match/state` resolves the viewer from
            // the session and redacts everyone else's hand.
            try {
                const res = await fetch(`/api/match/state?matchId=${encodeURIComponent(matchId)}`, {
                    signal: AbortSignal.timeout(8000),
                });
                if (!res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
                    return {
                        ok: false,
                        code: body.code || `HTTP_${res.status}`,
                        error: body.error,
                    };
                }
                const body = (await res.json()) as { seq?: number; state?: GameState };
                if (!body.state || !Number.isFinite(Number(body.seq))) {
                    return { ok: false, code: 'MALFORMED_SNAPSHOT' };
                }
                return { ok: true, seq: Number(body.seq), state: body.state };
            } catch (err) {
                return { ok: false, code: 'TRANSPORT', error: (err as Error).message };
            }
        },
        onStatus: setMatchConnectionStatus,
        // NET-05: a client that already holds a snapshot must not be paused by
        // a flap. Read through a ref-free state read — the effect re-runs when
        // the value flips, which is exactly when the gate should change.
        hasAuthoritativeSnapshot: () => hasAuthoritativeSnapshotRef.current,
    });

    useEffect(() => {
        if (matchConnectionStatus === 'reconnecting' || matchConnectionStatus === 'syncing') {
            setHasAuthoritativeSnapshot(false);
            sendMatchEvent({ type: 'RESYNC_NEEDED' });
        }
        if (matchConnectionStatus === 'connected' && fsmRef.current.phase === 'resyncing') {
            sendMatchEvent({ type: 'RESYNC_APPLIED' });
        }
        if (matchConnectionStatus === 'ended') {
            sendMatchEvent({ type: 'FINISH' });
        }
    }, [matchConnectionStatus, sendMatchEvent]);

    const gameStateRef = useRef(gameState);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);


    const peerRef = useRef<Peer | null>(null);
    // Dedup guest intents delivered on both PeerJS and Supabase.
    // N4 — TTL + LRU-bounded (was an unbounded Set).
    const processedIntentIds = useRef(createDedupStore({ max: 512, ttlMs: 10 * 60 * 1000 }));
    // Requested seat from an invite link (?seat=N). Consumed by the next
    // SYNC_PROFILE send, then cleared — retries reuse it until first send.
    const desiredSeatRef = useRef<number | undefined>(undefined);

    const destroyPeer = useCallback(() => {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        // NET-07: a peer teardown is a disconnect — stamp it, or an abandon
        // classified afterwards looks like it was never disconnected.
        recordDisconnect(myAddress);
        connectionsRef.current.forEach(c => c.close());
        connectionsRef.current.clear();
        setConnections(new Map());
        // Never leave ONLINE latched after teardown — hostGame/joinGame
        // only set this true again on a live PeerJS bind.
        setIsLobbyConnected(false);
    }, []);

    const broadcastToAll = useCallback((data: unknown) => {
        connectionsRef.current.forEach((conn) => {
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
        processGameAction: (data: Record<string, unknown>) => processGameAction(data),
    });

    // 2.5. Presence Manager (AFK Failsafe Baton Pass)
    // NET-21: production netcode metering. Presence sync is the match-path
    // heartbeat; a change of elected compute host is an authority switch and
    // drives a real HOST_ELECT through the match FSM (phase-gated — lobby
    // elections must not pollute the illegal-transition metric).
    const onPresenceNetEvent = useCallback((e: { type: 'heartbeat' } | { type: 'authority-switch'; prev: string | null; next: string }) => {
        if (e.type === 'heartbeat') {
            bumpNet('net_heartbeat_ok');
            return;
        }
        bumpNet('net_authority_switch');
        // P6: HOST_ELECT retired — server room authority owns the clock and lifecycle
    }, []);
    const { isComputeHost, activePlayers } = useGamePresence(currentRoomCode, myAddress, onPresenceNetEvent);

    // 3. Broadcast Helpers
    //
    // NET-06: gated on `isHost` ALONE. The election in useGamePresence is
    // client-clock ordered (joinedAt), so a compute host has not been proven
    // the legitimate failover — letting it push room state would hand a
    // guest the ability to rewrite every other client's board. "Until then"
    // from the checklist: a compute host still orchestrates AI/AFK locally
    // (that is what useGameEngine's isAuthority gate is for) but does not
    // broadcast, and the host-claim handshake is required before it may.
    const broadcastAction = useCallback(<T extends GameActionType>(type: T, payload?: GameActionPayload<T>, fullState?: GameState) => {
        if (!isHost) return;
        
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
            const startPayload = payload as GameActionPayload<'START_GAME'>;
            const matchId = String(startPayload.matchId || gameStateRef.current.matchId || crypto.randomUUID());
            // TU-4: the room becomes the authority as soon as it answers. The host
            // also seeds it, because a Durable Object starts with an empty board.
            connectRoom(matchId, startPayload.initialBoardConfig ? {
                ...INITIAL_GAME_STATE,
                matchId,
                playerCount: startPayload.playerCount || '4P',
                isStarted: true,
                status: 'playing' as const,
                initialBoardConfig: startPayload.initialBoardConfig,
                powerTileSeed: gameStateRef.current.powerTileSeed,
                powerTiles: gameStateRef.current.powerTiles || [],
                playerPowers: gameStateRef.current.playerPowers,
                lastUpdate: Date.now(),
            } : undefined);

            setGameState((prev: GameState) => ({
                ...prev,
                isStarted: true,
                matchId,
                playerCount: startPayload.playerCount || prev.playerCount,
                initialBoardConfig: startPayload.initialBoardConfig
            }));
            // NET-27: counters reset per match so the receipt's net section
            // describes this match, not the session.
            resetNetCounters();
            sendMatchEvent({ type: 'ALL_SEATED' });
            sendMatchEvent({ type: 'START' });

            // Seed server-authoritative match_states (v2 move validation)
            if (myAddress && startPayload.initialBoardConfig) {
                const seats: Record<string, { kind: 'human' | 'bot' | 'afk'; wallet?: string }> = {};
                (startPayload.initialBoardConfig.players as { color: string; isAi?: boolean; walletAddress?: string }[] || [])
                    .forEach(p => {
                        seats[p.color] = p.isAi
                            ? { kind: 'bot' }
                            : { kind: 'human', wallet: p.walletAddress };
                    });
                const initialState = {
                    ...ENGINE_INIT,
                    matchId,
                    playerCount: startPayload.playerCount || '4P',
                    currentPlayer: startPayload.initialBoardConfig.players?.[0]?.color || 'green',
                    isStarted: true,
                    status: 'playing' as const,
                    powerTiles: gameStateRef.current.powerTiles || [],
                    // ENG-11: commit the host's respawn seed so the Edge
                    // authority and every guest spawn identical tiles.
                    powerTileSeed: gameStateRef.current.powerTileSeed
                        ?? ((Math.random() * 0x100000000) >>> 0),
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
                    colorCorner: startPayload.initialBoardConfig.colorCorner,
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
                    setMatchConnectionStatus('offline');
                    try {
                        const provisionalKey = `room:${currentRoomCode || roomId || ''}`;
                        const provisionalId = sessionStorage.getItem(`ludo-provisional:${provisionalKey}`);
                        const sess = provisionalId
                            ? await moveAuth.bindProvisionalSession({
                                provisionalId,
                                matchId,
                                roomCode: currentRoomCode || roomId || '',
                            })
                            : await moveAuth.createMatchSession({
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
                    void Promise.resolve(appSessionId || peekAppSession()).then(sessionId => sessionId ? fetch('/api/presence', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ walletAddress: myAddress, sessionId, status: 'In Match', currentRoomCode })
                    }) : null);
                    
                    // Activity writes are authenticated and deduplicated server-side.
                    void Promise.resolve(appSessionId || peekAppSession()).then(sessionId => sessionId ? fetch('/api/social/moderation', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            walletAddress: myAddress, sessionId, action: 'activity',
                            target: currentRoomCode || roomId, requestId: `match-join:${currentRoomCode || roomId}`,
                        }),
                    }) : null).catch(err => console.warn('Activity write failed', err));
                }

                setTimeout(() => {
                    broadcastToAll({ type: 'LOBBY_SYNC', lobbyState: newLobby });
                    relayViaSupabase('lobby-action', { type: 'LOBBY_SYNC', lobbyState: newLobby }, lobbyStateRef);
                }, 50);
                return newLobby;
            });
        }

        // Always include matchId so guests + host share one Edge match.
        // NET-03: a stateful broadcast from the authority carries the
        // `match_states` provenance and the seq it was taken at, so guests
        // apply the FULL state through the seq-gated path instead of replaying
        // partial MOVE_TOKEN/TURN_SWITCH hints. Lobby-level broadcasts (no
        // fullState) are unaffected.
        const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        const actionData = {
            type,
            ...payloadRecord,
            matchId: payloadRecord.matchId || gameStateRef.current.matchId,
            source: fullState ? 'match_states' : undefined,
            seq: fullState ? serverSeqRef.current : undefined,
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
        relayViaSupabase('game-action', actionData, lobbyStateRef);

        // PW-2/PW-3: power inventory is PER-SEAT private state, so it cannot ride a
        // shared payload. The host knows every seat's hand; each guest may only see
        // its own. PeerJS gives us one DataConnection per guest, so send a targeted
        // hand instead of widening the broadcast (which would leak every opponent's
        // powers to every viewer — the original PW-2 finding).
        if (fullState?.playerPowers) {
            for (const [peerId, conn] of connectionsRef.current) {
                const slot = lobbyStateRef.current?.slots?.find(s => s.peerId === peerId);
                const color = slot?.color;
                if (!color) continue;
                const hand = fullState.playerPowers[color];
                if (!hand) continue;
                try {
                    conn.send({ type: 'POWER_HAND', color, hand, matchId: actionData.matchId });
                } catch {
                    // Peer closed mid-send — the next ENGINE_STATE retries.
                }
            }
        }
    }, [isHost, broadcastToAll, relayViaSupabase, setGameState, setLobbyState, lobbyStateRef, gameStateRef, myAddress, currentRoomCode, connectRoom]);

    const broadcastLobbyAction = useCallback((type: LobbyActionType, payload: Record<string, unknown> = {}) => {
        if (!isHost) return;
        const actionData = { type, lobbyState: lobbyStateRef.current, ...payload };
        broadcastToAll(actionData);
        relayViaSupabase('lobby-action', actionData, lobbyStateRef);
    }, [isHost, broadcastToAll, relayViaSupabase, lobbyStateRef]);

    // 4. Betting Window Controller (extracted)
    const { activeBetWindow, startBettingWindow } = useBettingController({
        isHost,
        matchId: gameState.matchId,
        broadcastAction,
    });

    // 5. Provably Fair Dice
    // 5. Provably Fair Dice + signed bet resolution
    const resolveBet = useSignedResolveBet({
        isHost,
        myAddress,
        signMessageAsync: (args) => player.signMessageAsync(args),
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
        broadcastAction,
        broadcastToAll,
        resolveBet,
    });

    // 6. Game Engine Action Processor
    /** NET-04: watch one intent's ACK; resend the identical intentId on a lapse. */
    const MAX_INTENT_RETRIES = 2;
    const INTENT_ACK_TIMEOUT_MS = 2500;
    const intentQueueRef = useRef<GameIntent[]>([]);
    intentQueueRef.current = intentQueue;
    const unsentIntentRef = useRef<GameIntent | null>(null);
    const pendingIntentAcks = useRef<Map<string, number>>(new Map());
    const intentAckTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    /**
     * NET-15: every retry-ladder timeout id lands here. Retries were fire-and-forget,
     * so leaving a room (or the ladder's own room changing under it) left a pending
     * timer that fired against a torn-down board and re-seated a guest into a room
     * we had already left. `scheduleRetry` registers; `clearRetryLadders` aborts.
     */
    const retryLadderTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
    const scheduleRetry = useCallback((fn: () => void, delayMs: number) => {
        const id = setTimeout(() => {
            retryLadderTimers.current.delete(id);
            fn();
        }, delayMs);
        retryLadderTimers.current.add(id);
        return id;
    }, []);
    const clearRetryLadders = useCallback(() => {
        retryLadderTimers.current.forEach(id => clearTimeout(id));
        retryLadderTimers.current.clear();
    }, []);

    // NET-08: the dedup stores are keyed by an id space that belongs to a
    // room, not a session. Joining a new room with a resident store drops
    // every action as a "duplicate" of the previous room's, so the stores and
    // the pending-intent watches reset whenever the room code changes.
    const roomKeyRef = useRef<string | null>(null);
    useEffect(() => {
        const room = currentRoomCode || lobbyState?.roomCode || null;
        if (roomKeyRef.current === room) return;
        roomKeyRef.current = room;
        if (room === null) return;
        processedActionIds.current.clear();
        processedIntentIds.current.clear();
        clearAllMoveSessions();
        intentAckTimers.current.forEach(t => clearTimeout(t));
        intentAckTimers.current.clear();
        clearRetryLadders();
        pendingIntentAcks.current.clear();
        unsentIntentRef.current = null;
        setIntentQueue([]);
    }, [currentRoomCode, lobbyState?.roomCode, clearRetryLadders]);
    const resendIntent = useRef<(action: GameIntent) => void>(() => {});
    const scheduleIntentAckWatch = useCallback((intentId: string) => {
        if (intentAckTimers.current.has(intentId)) return;
        const timer = setTimeout(() => {
            intentAckTimers.current.delete(intentId);
            const tries = (pendingIntentAcks.current.get(intentId) ?? 0) + 1;
            if (tries > MAX_INTENT_RETRIES) {
                pendingIntentAcks.current.delete(intentId);
                return;
            }
            pendingIntentAcks.current.set(intentId, tries);
            const fresh = unsentIntentRef.current?.intentId === intentId ? unsentIntentRef.current : null;
            if (fresh) resendIntent.current(fresh);
            // Watch again — a second lapse fails the same way, then gives up.
            const next = setTimeout(() => {
                intentAckTimers.current.delete(intentId);
                pendingIntentAcks.current.delete(intentId);
            }, INTENT_ACK_TIMEOUT_MS);
            intentAckTimers.current.set(intentId, next);
        }, INTENT_ACK_TIMEOUT_MS);
        intentAckTimers.current.set(intentId, timer);
    }, []);

    /** NET-04: ACK tells the guest its intent reached the authority. */
    const sendIntentAck = useCallback((intentId: string | undefined, status: 'accepted' | 'stale' = 'accepted') => {
        if (!intentId) return;
        const ack = { type: 'GAME_INTENT_ACK', payload: { intentId, status } };
        connectionsRef.current.forEach(conn => { if (conn.open) conn.send(ack); });
        if (isLobbyConnected) {
            relayViaSupabase('game-action', ack, lobbyStateRef);
        }
    }, [isLobbyConnected, relayViaSupabase]);

    /**
     * TU-1 (round 2): every inbound action now carries the TRANSPORT it arrived on.
     *
     * The Supabase Realtime topic `game-room-<roomCode>` is a public broadcast
     * channel: anyone who learns the room code can subscribe AND publish, and
     * `seq` is a number the publisher chooses — so a seq gate authenticates
     * ordering, not origin. A `sender` string is a payload field, so comparing
     * it to the host's public wallet address proves nothing.
     *
     * The one property the relay cannot forge is which socket the bytes came
     * from. State-bearing verbs are therefore only honoured on the PeerJS
     * transport, whose data connections are point-to-point to a peer id the
     * room owns. The relay keeps the traffic it is actually good for: intents
     * (which the host re-validates), lobby formation, chat, emotes and acks.
     *
     * Trade-off, deliberate and documented: a guest that cannot establish a
     * PeerJS connection is read-only for match state until the authenticated
     * `/api/room/:id/ws` transport (already built, see `src/worker.ts`) is
     * wired to the client. Integrity over availability on a public topic.
     */
    const processGameAction = useCallback((data: Record<string, unknown>, via: 'peer' | 'relay' = 'relay') => {
        const type = typeof data.type === 'string' ? data.type : '';
        const actionId = typeof data.actionId === 'string' ? data.actionId : undefined;
        const stateOverride = data.stateOverride;
        if (actionId && processedActionIds.current.has(actionId)) return;
        if (actionId) processedActionIds.current.add(actionId);

        if (STATE_VERBS.has(type) && via !== 'peer') {
            bumpNet('net_schema_drop');
            track('schema_drop', { via: 'relay', kind: type, reason: 'state_verb_on_public_topic' });
            console.warn('🛰️ [TU-1] Dropping state verb received on the public relay:', type);
            return;
        }

        // Phase 6 hygiene: log the type + id only, never the full payload.
        // The old line printed `data` verbatim — every action AND its full
        // payload (seats, wallets, state) into every console, including
        // production until compiler.removeConsole strips it.
        console.log('🕹️ Processing action:', type, actionId ?? '(no id)', `via=${via}`);

        // NET-03: only the authority (host or compute host) may drive a
        // networked match's rules state. Guests' boards follow the seq-gated
        // `stateOverride` path below, which is the same authority source
        // move-auth persists.
        // NET-03, via the same gate (kept as a readable local for the
        // three verb branches below).
        const isMatchAuthority = isHost || isComputeHost;

        // G5 — preset emote float (lightweight; not a DM)
        if (type === 'EMOTE') {
            const payload = (data.payload ?? data.action ?? data) as Record<string, unknown>;
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('ludo-emote', { detail: payload }));
            }
            return;
        }

        // In-match lobby chat (seat bubbles; not a DM)
        if (type === 'CHAT') {
            const payload = (data.payload ?? data.action ?? data) as Record<string, unknown>;
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('ludo-chat', { detail: payload }));
            }
            return;
        }

        // 📬 Guest intent via Supabase (dual-path with PeerJS GAME_ACTION)
        if (type === 'GAME_INTENT' && isHost) {
            const action = data.action;
            if (!isGameIntent(action)) {
                bumpNet('net_schema_drop');
                track('schema_drop', { via: 'supabase', kind: 'GAME_INTENT' });
                return;
            }
            // NET-09: identical identity rule on both transports.
            const intentId = action.intentId || actionId;
            if (rememberIntent(processedIntentIds.current, intentId) !== 'new') {
                return;
            }
            console.log('📬 [Host] Intent via Supabase:', action?.type);
            setIntentQueue(q => [...q, action]);
            sendIntentAck(action.intentId);
            return;
        }

        // NET-04: the host ACKed this intent — no retry needed.
        if (type === 'GAME_INTENT_ACK' && !isHost) {
            const acked = (data.payload as { intentId?: string } | undefined)?.intentId;
            if (acked) {
                pendingIntentAcks.current.delete(acked);
                const t = intentAckTimers.current.get(acked);
                if (t) {
                    clearTimeout(t);
                    intentAckTimers.current.delete(acked);
                }
            }
            return;
        }

        // 🏟️ Lobby sync (guest applies host state; host ignores echoes)
        if (type === 'LOBBY_SYNC' && (data as any).lobbyState && !isHost) {
            console.log('🏟️ [Guest] Applying lobby sync');
            setLobbyState((data as any).lobbyState);
            setIsLobbyConnected(true);
            return;
        }

        // 🌟 Networked match snapshots are authoritative only when they are
        // explicitly emitted by move-auth. Peer/host state broadcasts remain
        // transport hints and must not advance a guest's rules state. The
        // decision is `shouldApplyGameAction` (lib/netcode/authorityGate.ts)
        // so `test:netcode` executes it instead of mounting this provider.
        const gate = shouldApplyGameAction({
            type,
            isHost,
            isComputeHost,
            source: data.source,
            hasOverride: stateOverride !== undefined && stateOverride !== null,
            seq: data.seq,
            knownSeq: serverSeqRef.current,
        });
        if (gate.apply && gate.via === 'snapshot') {
            applyServerState(stateOverride as GameState, data.seq as number);
        } else if (stateOverride && !isHost) {
            console.log('🌟 [P4] Ignoring host override:', gate.via);
        }

        if (type === 'START_GAME') {
            // TU-1: Host initiates match locally; host NEVER accepts external START_GAME from the network.
            if (isHost) {
                console.warn('⚠️ [Host] Dropping external START_GAME broadcast');
                return;
            }
            // Guest: reject mid-match re-seeding if already playing
            if (gameStateRef.current.isStarted && gameStateRef.current.status === 'playing') {
                console.warn('⚠️ [Guest] Dropping mid-match START_GAME re-seed attempt');
                return;
            }
            // Guest: only accept START_GAME originating from the recorded room host
            const knownHost = (lobbyStateRef.current?.hostId || lobbyStateRef.current?.slots?.[0]?.playerId || '').toLowerCase();
            const sender = String(data.sender || '').toLowerCase();
            if (!sender || !knownHost || sender !== knownHost) {
                console.warn('⚠️ [Guest] Dropping unauthorized START_GAME from non-host:', data.sender);
                return;
            }

            setGameState(prev => ({
                ...prev,
                isStarted: true,
                isBotMatch: data.isBotMatch === true,
                playerCount: data.playerCount === '1v1' || data.playerCount === '2v2' || data.playerCount === '4P' ? data.playerCount : prev.playerCount,
                initialBoardConfig: data.initialBoardConfig as GameState['initialBoardConfig'],
                matchId: typeof data.matchId === 'string' ? data.matchId : prev.matchId,
                lastUpdate: Date.now()
            }));

            // TU-4: a guest joins the same room transport, so both seats read the
            // authority stream instead of one of them trusting the host's broadcast.
            if (!isHost && typeof data.matchId === 'string') {
                connectRoom(data.matchId);
            }

            // ☁️ Host: Register live match details + bind host for signed settlement
            if (isHost) {
                const matchId = typeof data.matchId === 'string'
                    ? data.matchId
                    : gameStateRef.current.matchId;
                if (matchId) {
                    void Promise.resolve(appSessionId || peekAppSession()).then(sessionId => sessionId ? fetch('/api/live-matches/window', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ matchId, hostAddress: myAddress, sessionId, status: 'register' })
                    }) : null);
                }
            }
        } else if (type === 'ROLL_DICE') {
            // TU-1: Authorities generate rolls or consume server state; never accept external ROLL_DICE broadcasts
            if (isMatchAuthority) {
                console.warn('⚠️ [Host] Dropping external ROLL_DICE broadcast from:', data.sender);
                return;
            }
            // Guests only apply if sent by the known host/authority
            const knownHost = (lobbyStateRef.current?.hostId || lobbyStateRef.current?.slots?.[0]?.playerId || '').toLowerCase();
            const sender = String(data.sender || '').toLowerCase();
            if (!sender || !knownHost || sender !== knownHost) {
                return;
            }
            setGameState((prev: GameState) => ({
                ...prev,
                diceValue: typeof data.value === 'number' ? data.value : prev.diceValue,
                isRolling: data.isRolling === true,
                gamePhase: data.gamePhase === 'moving' || data.gamePhase === 'landing' || data.gamePhase === 'rolling' ? data.gamePhase : prev.gamePhase,
                lastAction: { type: 'ROLL_DICE', payload: data }
            }));
        } else if (type === 'MOVE_TOKEN') {
            // TU-1: Host is the move authority and executes moves via intents; never accept external MOVE_TOKEN
            if (isMatchAuthority) {
                console.warn('⚠️ [Host] Dropping external MOVE_TOKEN broadcast from:', data.sender);
                return;
            }
            // Guests only accept move broadcasts originating from the host/authority
            const knownHost = (lobbyStateRef.current?.hostId || lobbyStateRef.current?.slots?.[0]?.playerId || '').toLowerCase();
            const sender = String(data.sender || '').toLowerCase();
            if (!sender || !knownHost || sender !== knownHost) {
                return;
            }

            const payload = (data.payload && typeof data.payload === 'object' ? data.payload : data) as Record<string, unknown>;
            const color = payload.color as PlayerColor;
            const tokenIndex = Number(payload.tokenIndex);
            const targetPosition = Number(payload.targetPosition);

            // TU-1: Verify that targetPosition matches calculateNextPosition math (no arbitrary coordinate overrides)
            const currentPos = gameStateRef.current.positions?.[color]?.[tokenIndex];
            const diceValue = gameStateRef.current.diceValue || Number(payload.diceValue || 0);
            const colorCorner = gameStateRef.current.initialBoardConfig?.colorCorner;
            if (Number.isFinite(currentPos) && diceValue > 0 && colorCorner) {
                const expectedPos = calculateNextPosition(currentPos, diceValue, color, colorCorner);
                if (expectedPos !== targetPosition) {
                    console.warn('⚠️ [TU-1] Illegal MOVE_TOKEN position leap rejected:', { currentPos, diceValue, targetPosition, expectedPos });
                    return;
                }
            }

            setGameState(prev => {
                const newPos = { ...prev.positions };
                newPos[color as PlayerColor] = [...newPos[color as PlayerColor]];
                newPos[color as PlayerColor][tokenIndex] = targetPosition;
                return { ...prev, positions: newPos, lastUpdate: Date.now(), lastAction: { type: 'MOVE_TOKEN', payload } };
            });
        } else if (type === 'POWER_HAND') {
            // PW-3: the host sends each guest ONLY that guest's own hand, over that
            // guest's own DataConnection. Accept a hand only for a colour this client
            // actually owns — otherwise a mis-addressed message would let a seat
            // overwrite someone else's inventory on its own board.
            const color = data.color as PlayerColor;
            const hand = data.hand;
            if (!color || !Array.isArray(hand)) return;
            const myColor = lobbyStateRef.current?.slots?.find(
                s => s.playerId?.toLowerCase() === myAddress?.toLowerCase(),
            )?.color;
            if (myColor && color !== myColor) return;
            setGameState(prev => ({
                ...prev,
                playerPowers: { ...prev.playerPowers, [color]: hand as GameState['playerPowers'][PlayerColor] },
                lastUpdate: Date.now(),
            }));
        } else if (type === 'TURN_SWITCH') {
            // TU-1: Authority generates turn switches; never accept external broadcasts
            if (isMatchAuthority) {
                console.warn('⚠️ [Host] Dropping external TURN_SWITCH broadcast from:', data.sender);
                return;
            }
            const knownHost = (lobbyStateRef.current?.hostId || lobbyStateRef.current?.slots?.[0]?.playerId || '').toLowerCase();
            const sender = String(data.sender || '').toLowerCase();
            if (!sender || !knownHost || sender !== knownHost) {
                return;
            }

            const nextPlayer = (data.nextPlayer || data.currentPlayer) as PlayerColor;
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
            handleCommitReceived(String(data.sender || ''), String(data.hash || ''), lobbyStateRef);
        } else if (type === 'DICE_REVEAL') {
            handleRevealReceived(String(data.sender || ''), String(data.nonce || ''), lobbyStateRef);
        }
    }, [processedActionIds, processedIntentIds, handleCommitReceived, handleRevealReceived, setGameState, setLobbyState, setIsLobbyConnected, isHost, isComputeHost, myAddress, currentRoomCode, roomId, applyServerState, connectRoom]);

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
        if (data.type === 'LOBBY_SYNC' && data.lobbyState && !isHost) {
            setLobbyState(data.lobbyState);
        } else if (data.type === 'START_GAME') {
            // TU-1: PeerJS is the only transport allowed to carry state verbs.
            processGameAction(data, 'peer');
        } else if (data.type === 'GAME_ACTION') {
            if (isHost) {
                // NET-09: run the SAME parser on this transport. The PeerJS
                // path used to trust `data.action` verbatim, so a malformed
                // intent (or one naming a dice face) reached the host's
                // handler unchallenged — exactly what the Supabase path
                // rejects before the host ever sees it.
                if (!isGameIntent(data.action)) {
                    bumpNet('net_schema_drop');
                    track('schema_drop', { via: 'peerjs', kind: 'GAME_ACTION' });
                    return;
                }
                // The id is intentId when present, else the actionId — the two
                // transports must agree on identity for dedup to hold.
                const intentId = data.action.intentId || (data.actionId as string | undefined);
                const verdict = rememberIntent(processedIntentIds.current, intentId);
                if (verdict !== 'new') return;
                console.log('📬 [Host] Received Intent (PeerJS):', data.action);
                setIntentQueue(q => [...q, data.action]);
                sendIntentAck(data.action.intentId);
            }
        } else if (data.type === 'DICE_COMMIT' || data.type === 'DICE_REVEAL') {
            processGameAction(data, 'peer');
        }
    }, [processGameAction, isHost, setLobbyState]);

    /**
     * SEC-12: declare which door this lobby admits.
     *
     *   'matchmaking'  the queue paired the guests, so the credential is the
     *                  queue's validation_token and friendship is NOT required —
     *                  quick match legitimately pairs strangers.
     *   'invite'       the server mints a room secret; a guest needs that secret
     *                  AND to be an accepted friend of the host.
     *   'open'         casual open-join by room code, session only.
     *
     * Defaults to 'matchmaking' when a queue token is present and 'open'
     * otherwise, which is exactly the behaviour before this change.
     */
    const declareLobbyPolicy = useCallback(async (
        code: string,
        policy: 'matchmaking' | 'invite' | 'open',
        validationToken?: string,
    ) => {
        if (!myAddress) return;
        const sessionId = await ensureAppSession({ context: 'teamup' });
        if (!sessionId) return;
        // MM-14: this row is not just a door — during `forming` it is the ONLY
        // record that lets the host prove it is the host. Policy verification
        // falls back to `lobby_join_policies.host_address`, so until this lands
        // the host's own REST poll 403s on every request and the guest is never
        // seated. Measured live: the row took 5.06s to appear while the guest's
        // join landed at 3.18s, so every poll in that window failed.
        //
        // So retry, and say so loudly. A single dropped POST used to be silent.
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await fetch('/api/lobby/policy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        roomCode: code,
                        joinPolicy: policy,
                        validationToken,
                        walletAddress: myAddress,
                        sessionId,
                    }),
                });
                if (res.ok) {
                    const data = await res.json().catch(() => ({}));
                    // For an invite room the server mints the secret; adopt it so
                    // `inviteLinkFor` can put `?s=` on the link it shares.
                    if (data?.roomSecret) setRoomSecret(String(data.roomSecret));
                    return;
                }
                console.warn(`📡 [Lobby] door declaration attempt ${attempt}/3 failed: HTTP ${res.status}`);
            } catch (err) {
                console.warn(`📡 [Lobby] door declaration attempt ${attempt}/3 threw:`, err);
            }
            if (attempt < 3) await new Promise(r => setTimeout(r, 400));
        }
        console.error('❌ [Lobby] could not declare the door — the REST join fallback is degraded (relay still works)');
    }, [myAddress, ensureAppSession]);

    const hostGame = useCallback((
        forcedRoomId?: string,
        expectedValidationToken?: string,
        joinPolicy?: 'matchmaking' | 'invite' | 'open',
    ) => {
        destroyPeer();
        setIsHost(true);
        fsmRef.current.reset();
        sendMatchEvent({ type: 'OPEN_LOBBY' });
        // Invite lobbies are open-join by room code (casual UX).
        // Only matchmaking passes a validation token to lock the room.
        if (expectedValidationToken) {
            expectedValidationTokenRef.current = expectedValidationToken.trim().toLowerCase();
            setRoomSecret(expectedValidationToken.trim().toLowerCase());
        } else {
            expectedValidationTokenRef.current = null;
            setRoomSecret(null);
        }
        const code = forcedRoomId || Math.random().toString(36).substring(2, 8).toUpperCase();
        const door = joinPolicy || (expectedValidationToken ? 'matchmaking' : 'open');
        void declareLobbyPolicy(code, door, expectedValidationToken);
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

        // live_matches requires match_id (PK) — written on START_GAME / Go live,
        // not at hostGame time when we only have a room code.
    }, [destroyPeer, setIsHost, myAddress, setRoomId, setCurrentRoomCode, setIsLobbyConnected, peerRef, lobbyStateRef, setConnections, gameStateRef, handleGuestData, setRelayRoom, sendMatchEvent]);

    const joinGame = useCallback((targetRoomId: string, token?: string, desiredSeat?: number) => {
        destroyPeer();
        setIsHost(false);
        fsmRef.current.reset();
        sendMatchEvent({ type: 'OPEN_LOBBY' });
        setValidationToken(token);
        setCurrentRoomCode(targetRoomId);
        // Sync ref immediately so relay hits the right channel this tick.
        setRelayRoom(targetRoomId);
        desiredSeatRef.current = Number.isInteger(desiredSeat) ? desiredSeat : undefined;

        if (myAddress) {
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
                        coins: typeof myProfile?.coins === 'number' ? myProfile.coins : undefined,
                    });
                    desiredSeatRef.current = undefined;
                });
                conn.on('data', (d: unknown) => handleGuestData(d as Parameters<typeof handleGuestData>[0], conn as unknown as DataConnection));
                conn.on('close', () => {
                    console.warn('🚪 [Guest] Connection closed by host');
                    // NET-07: stamp the disconnect so a later abandon
                    // classification has a real grace clock.
                    recordDisconnect(myAddress);
                    clearRetryLadders();
                    setIsLobbyConnected(false);
                });
                conn.on('error', () => {
                    if (att < 5) scheduleRetry(() => connect(att + 1), 1500 * att);
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
    }, [destroyPeer, setIsHost, setValidationToken, setCurrentRoomCode, peerRef, myAddress, myProfile, setConnections, setIsLobbyConnected, handleGuestData, relayViaSupabase, lobbyStateRef, setRelayRoom, sendMatchEvent]);

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
            playerCoins: typeof myProfile?.coins === 'number' ? myProfile.coins : null,
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
        relayViaSupabase('lobby-action', payload, lobbyStateRef);
    }, [myAddress, myProfile, setLobbyState, lobbyStateRef, broadcastToAll, relayViaSupabase]);

    // One-call room hosting for manual lobbies (Team Up panel, invites):
    // generates a code, spins up PeerJS hosting, AND creates lobby state.
    // Returns the room code synchronously so invite links work immediately.
    const hostQuickLobby = useCallback((matchType: '1v1' | '2v2' | '4P', gameMode: 'classic' | 'power' = 'classic', entryFee: number = 0) => {
        const code = generateRoomCode();
        // SEC-17: the key includes the wallet, so two wallets that happen to
        // collide on a room code get separate provisional grants rather than
        // overwriting each other.
        void createProvisionalSession(`room:${code}:${(myAddress || '').toLowerCase()}`, code, {
            context: 'teamup',
            title: 'HOSTING PARTY SESSION',
            statusText: 'Authorizing multiplayer room in your wallet...',
        }).then(result => {
            if (!result.ok) console.warn('🔑 [TeamUp] pre-match authorization failed:', result.error);
        });
        hostGame(code);
        initQuickLobby(code, matchType, gameMode, entryFee);
        return code;
    }, [hostGame, initQuickLobby, createProvisionalSession, myAddress]);

    /** Public-pool fill: matchmaking already paired guests — do not require room secret. */
    const allowOpenJoins = useCallback(() => {
        expectedValidationTokenRef.current = null;
        setRoomSecret(null);
    }, []);

    /**
     * Host-only: step the lobby entry fee DOWN to the next preset (or Free).
     * Never raises. Guests see a short overlay via LOBBY_SYNC fee drop.
     */
    const lowerEntryFee = useCallback(() => {
        if (!isHost) return;
        const cur = lobbyStateRef.current;
        if (!cur) return;
        const presets = [1_000_000, 100_000, 10_000, 1_000, 0];
        const next = presets.find(p => p < cur.entryFee);
        if (next === undefined || next >= cur.entryFee) return;
        const lobby = { ...cur, entryFee: next };
        setLobbyState(lobby);
        lobbyStateRef.current = lobby;
        broadcastLobbyAction('LOBBY_SYNC', { lobbyState: lobby });
    }, [isHost, setLobbyState, lobbyStateRef, broadcastLobbyAction]);

    const leaveGame = useCallback(() => {
        destroyPeer();
        // TU-4: drop the room socket so a stale authority cannot outlive the match.
        teardownRoom();
        setIsHost(false);
        setIsLobbyConnected(false);
        setRoomId('');
        setConnections(new Map());
        // REA-22: force a fresh identity on reset. INITIAL_GAME_STATE is a
        // shared module object — spreading it reuses nested arrays by
        // reference, so a previous match's positions could leak into the next
        // match's "initial" state. Structured-clone the arrays that move.
        setGameState({
            ...INITIAL_GAME_STATE,
            positions: Object.fromEntries(
                Object.entries(INITIAL_GAME_STATE.positions).map(([c, ps]) => [c, [...(ps as number[])]]),
            ) as GameState['positions'],
            winners: [],
            lastUpdate: Date.now(),
        });
        setLobbyState(null);
        setParticipants({});
        expectedValidationTokenRef.current = null;
        setRoomSecret(null);
        setValidationToken(undefined);
        serverSeqRef.current = 0;
        setServerSeq(0);
        // NET-08: clear all three dedup stores here and on room change, or a
        // second match in one session inherits the previous match's id space
        // and drops every action as a "duplicate". Also drops the move-session
        // map (keyed by matchId) so a stale grant cannot act on a new match.
        processedActionIds.current.clear();
        processedIntentIds.current.clear();
        clearAllMoveSessions();
        intentAckTimers.current.forEach(t => clearTimeout(t));
        intentAckTimers.current.clear();
        clearRetryLadders();
        pendingIntentAcks.current.clear();
        unsentIntentRef.current = null;
        setIntentQueue([]);

        if (myAddress) {
            void Promise.resolve(appSessionId || peekAppSession()).then(sessionId => sessionId ? fetch('/api/presence', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: myAddress, sessionId, status: 'Online' })
            }) : null);
        }
    }, [destroyPeer, teardownRoom, setIsHost, setIsLobbyConnected, setRoomId, setConnections, setGameState, setLobbyState, setParticipants, myAddress, clearRetryLadders]);

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
            const sessionId = await ensureAppSession().catch(() => null);
            if (!sessionId) {
                console.warn('startQuickMatch requires an active session');
                return;
            }
            const res = await fetch('/api/matchmaking/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId: myAddress.toLowerCase(),
                    sessionId,
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
                const matchId = String(data.match_id || '');
                connectRoom(matchId);
                // Deterministic host pick from participants roster, matching useMatchmaking
                const players = ((data.participants || []) as string[]).map(p => String(p).toLowerCase());
                const sorted = [...new Set(players)].sort();
                let h = 0;
                for (let i = 0; i < matchId.length; i++) h = (h * 31 + matchId.charCodeAt(i)) >>> 0;
                const weAreHost = sorted.length > 0 ? sorted[h % sorted.length] === myAddress.toLowerCase() : false;
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
    }, [myAddress, ensureAppSession, hostGame, joinGame, initQuickLobby]);
    const updateGameState = useCallback((s: Partial<GameState>) => setGameState(p => ({ ...p, ...s, lastUpdate: Date.now() })), [setGameState]);
    
    /**
     * NET-07: the abandon path.
     *
     * `lib/netcode/abandon.ts` was fully implemented and had ZERO call sites —
     * its grace window, dual-sign classification and refund/burn policy were
     * unobservable. Disconnect timestamps are recorded here and
     * `classifyAndRecordAbandon` is the single entry point a caller uses to
     * produce an AbandonOutcome. No funds move: ABANDON_BURN_SPLIT_ENABLED is
     * false, so this is classification + evidence only (which is the artifact
     * the settlement path will later need).
     */
    const disconnectSinceRef = useRef<Map<string, number>>(new Map());
    const recordDisconnect = useCallback((wallet: string | undefined) => {
        if (!wallet) return;
        disconnectSinceRef.current.set(String(wallet).toLowerCase(), Date.now());
    }, []);
    const clearDisconnect = useCallback((wallet: string | undefined) => {
        if (!wallet) return;
        disconnectSinceRef.current.delete(String(wallet).toLowerCase());
    }, []);
    const classifyAndRecordAbandon = useCallback((params: {
        accusedSeat: string;
        hasEdgeSig: boolean;
        hasHostSig: boolean;
        matchEnded?: boolean;
    }): AbandonOutcome => {
        const seat = String(params.accusedSeat || '').toLowerCase();
        const since = disconnectSinceRef.current.get(seat);
        const sinceMs = since === undefined ? ABANDON_GRACE_MS + 1 : Date.now() - since;
        const outcome = classifyAbandon({
            hasEdgeSig: params.hasEdgeSig,
            hasHostSig: params.hasHostSig,
            sinceDisconnectMs: sinceMs,
            matchEnded: params.matchEnded,
        });
        recordAbandonAttempt(outcome, gameStateRef.current.matchId);
        return outcome;
    }, []);
    /** Remaining grace for a disconnected seat (UI countdown). */
    const abandonGraceFor = useCallback((wallet: string | undefined): number | null => {
        if (!wallet) return null;
        const since = disconnectSinceRef.current.get(String(wallet).toLowerCase());
        if (since === undefined) return null;
        return abandonGraceRemainingMs(Date.now() - since);
    }, []);

    /**
     * Guest → host intent. Dual-path: PeerJS when open, always also via
     * Supabase broadcast so NAT/firewall drops on PeerJS don't mute the guest.
     * Both paths share `intentId` so the host applies each intent once.
     */
    const sendIntent = useCallback(<T extends GameIntentType>(type: T, payload: GameIntentPayloads[T]) => {
        if (!isLobbyConnected || isHost || isComputeHost) return;
        const intentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const action = createGameIntent(type, payload, myAddress, intentId);
        // NET-04: a guest that never sees an ACK retries the SAME intentId
        // (bounded), so a dropped PeerJS send is recovered instead of leaving
        // the guest believing it acted. The host's `rememberIntent` dedups it.
        pendingIntentAcks.current.set(intentId, 0);
        unsentIntentRef.current = action;
        scheduleIntentAckWatch(intentId);

        const send = (intent: GameIntent) => {
            const conn = Array.from(connections.values())[0];
            if (conn && conn.open) {
                conn.send({ type: 'GAME_ACTION', action: intent });
            }
            // Cloud path — primary when PeerJS is blocked
            relayViaSupabase('game-action', { type: 'GAME_INTENT', action: intent }, lobbyStateRef);
        };
        resendIntent.current = send;
        send(action);
    }, [isLobbyConnected, isHost, isComputeHost, connections, myAddress, relayViaSupabase, lobbyStateRef, declareLobbyPolicy]);

    // NET-04: dropping the head is the only safe clear. Clearing the whole
    // queue on a path that declined to act (bad payload, no committed face)
    // silently discarded intents the guest would otherwise retry.
    const clearIntent = useCallback(() => setIntentQueue(q => q.slice(1)), []);


    const value = useMemo(() => ({
        roomId, connection: connections.values().next().value || null, connections, isLobbyConnected, isHost, isComputeHost, activePlayers, gameState, lobbyState,
        pendingInvite, hostGame, joinGame, initQuickLobby, hostQuickLobby, sendIntent, broadcastAction, broadcastLobbyAction,
        swapPlayers, kickPlayer, sendInvite, acceptInvite, rejectInvite, startQuickMatch, myAddress, updateGameState,
        participants, intentQueue, lastIntent: intentQueue[0] ?? null, clearIntent, sendIntentAck, leaveGame, validationToken,
        recordDisconnect, clearDisconnect, classifyAndRecordAbandon, abandonGraceFor,
        roomSecret, allowOpenJoins, lowerEntryFee, serverSeq, serverSeqRef, applyServerState, matchConnectionStatus, hasAuthoritativeSnapshot,
        matchPhase, matchFsmIllegal, roomAuthority, sendRoomIntent, connectRoom,
        activeBetWindow, startBettingWindow, createProvisionalSession, bindProvisionalSession
    }), [
        roomId, connections, isLobbyConnected, isHost, isComputeHost, activePlayers, gameState, lobbyState, pendingInvite, hostGame, joinGame, initQuickLobby, hostQuickLobby,
        sendIntent, broadcastAction, broadcastLobbyAction, swapPlayers, kickPlayer, sendInvite, acceptInvite, rejectInvite,
        startQuickMatch, myAddress, updateGameState, participants, intentQueue, clearIntent, sendIntentAck, leaveGame, validationToken,
        recordDisconnect, clearDisconnect, classifyAndRecordAbandon, abandonGraceFor,
        roomSecret, allowOpenJoins, lowerEntryFee, serverSeq, serverSeqRef, applyServerState, matchConnectionStatus, hasAuthoritativeSnapshot, matchPhase, matchFsmIllegal,
        roomAuthority, sendRoomIntent, connectRoom,
        activeBetWindow, startBettingWindow, createProvisionalSession, bindProvisionalSession
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
