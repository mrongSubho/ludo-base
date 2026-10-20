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

    // P4: clients render match_states (postgres realtime + initial pull)
    useMatchStates({
        matchId: gameState.matchId,
        enabled: isLobbyConnected,
        onServerState: applyServerState,
        getSeq: () => serverSeqRef.current,
        refreshState: async (matchId) => {
            const result = await moveAuth.getMatchState(matchId);
            return result;
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
        joinGame: (id: string) => joinGame(id)
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
    }, [isHost, broadcastToAll, relayViaSupabase, setGameState, setLobbyState, lobbyStateRef, gameStateRef, myAddress, currentRoomCode]);

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

    // Seat a joiner (host authority). Shared by PeerJS SYNC_PROFILE and
    // Supabase JOIN_REQUEST so NAT/Brave guests can seat without P2P.
    const seatGuestPlayer = useCallback((payload: {
        address: string;
        username?: string;
        avatar_url?: string;
        desiredSeat?: number;
        validationToken?: string;
        peerId?: string;
        coins?: number | null;
    }) => {
        if (!isHost || !payload.address) return false;
        if (expectedValidationTokenRef.current) {
            const presented = typeof payload.validationToken === 'string'
                ? payload.validationToken.trim().toLowerCase()
                : '';
            const expected = expectedValidationTokenRef.current.trim().toLowerCase();
            if (presented !== expected) {
                console.warn('🚫 [Host] Rejected join — invalid validation token', payload.address);
                return false;
            }
        }
        sendMatchEvent({ type: 'GUEST_SEATED' });
        // TU-2: Never trust client-supplied coin claims from peer payloads.
        const coins: number | null = null;
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
                ? { ...s, status: 'joined' as const, playerId: payload.address, playerName: payload.username || `Player ${want + 1}`, playerAvatar: payload.avatar_url, peerId, playerCoins: coins }
                : { ...s });
        } else if (invitedIdx !== -1) {
            next = cur.slots.map((s, i) => i === invitedIdx
                ? { ...s, status: 'joined' as const, playerName: payload.username || s.playerName, playerAvatar: payload.avatar_url || s.playerAvatar, peerId, playerCoins: coins }
                : { ...s });
        } else {
            next = assignJoinerToSlot(cur.slots, cur.matchType, payload.address, payload.username || 'Player', payload.avatar_url || '', peerId);
            if (next) {
                const seat = next.findIndex(s => s.playerId?.toLowerCase() === addr && s.status === 'joined');
                if (seat !== -1) next[seat] = { ...next[seat], playerCoins: coins };
            }
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
    }, [isHost, setParticipants, setLobbyState, lobbyStateRef, broadcastLobbyAction, sendMatchEvent]);

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
        processedJoinRequestIds.current.clear();
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

    const processGameAction = useCallback((data: Record<string, unknown>) => {
        const type = typeof data.type === 'string' ? data.type : '';
        const actionId = typeof data.actionId === 'string' ? data.actionId : undefined;
        const stateOverride = data.stateOverride;
        if (actionId && processedActionIds.current.has(actionId)) return;
        if (actionId) processedActionIds.current.add(actionId);

        // Phase 6 hygiene: log the type + id only, never the full payload.
        // The old line printed `data` verbatim — every action AND its full
        // payload (seats, wallets, state) into every console, including
        // production until compiler.removeConsole strips it.
        console.log('🕹️ Processing action:', type, actionId ?? '(no id)');

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

        // 🪑 Guest seat request via Supabase (works without PeerJS)
        if (type === 'JOIN_REQUEST' && isHost) {
            const payload = {
                address: String(data.address || data.playerId || ''),
                username: data.username as string | undefined,
                avatar_url: data.avatar_url as string | undefined,
                desiredSeat: data.desiredSeat as number | undefined,
                validationToken: data.validationToken as string | undefined,
                coins: typeof data.coins === 'number' ? data.coins as number : undefined,
            };
            const seated = seatGuestPlayer(payload);
            if (!seated) {
                // Lobby may not exist yet (host still minting room) — retry briefly.
                let tries = 0;
                const retry = () => {
                    tries += 1;
                    if (seatGuestPlayer(payload)) return;
                    if (tries < 6) scheduleRetry(retry, 800);
                    else console.warn('🪑 [Host] Could not seat JOIN_REQUEST', payload.address);
                };
                scheduleRetry(retry, 400);
            }
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
    }, [processedActionIds, processedIntentIds, handleCommitReceived, handleRevealReceived, setGameState, setLobbyState, setIsLobbyConnected, isHost, isComputeHost, myAddress, currentRoomCode, roomId, applyServerState, seatGuestPlayer]);

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
                coins: typeof data.coins === 'number' ? data.coins : undefined,
            });
        } else if (data.type === 'LOBBY_SYNC' && data.lobbyState && !isHost) {
            setLobbyState(data.lobbyState);
        } else if (data.type === 'START_GAME') {
            processGameAction(data);
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
            processGameAction(data);
        }
    }, [processGameAction, seatGuestPlayer, isHost, setLobbyState]);

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
            const data = await res.json().catch(() => ({}));
            // For an invite room the server mints the secret; adopt it so
            // `inviteLinkFor` can put `?s=` on the link it shares.
            if (res.ok && data?.roomSecret) setRoomSecret(String(data.roomSecret));
        } catch { /* the room still works; the door stays open */ }
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
                validationToken: token ? String(token).trim().toLowerCase() : undefined,
                coins: typeof myProfile?.coins === 'number' ? myProfile.coins : undefined,
            };
            let attempts = 0;
            const sendJoin = () => {
                attempts += 1;
                relayViaSupabase('lobby-action', joinPayload, lobbyStateRef);
                // Host channel may come up after us — keep retrying through the 8s UI window.
                if (attempts < 8) scheduleRetry(sendJoin, 1200);
            };
            sendJoin();
            // REST third path — survives realtime + PeerJS both being blocked.
            // Host polls /api/lobby/join and seats via seatGuestPlayer.
            //
            // SEC-12: the session identifies us. `wallet` is no longer sent (the
            // route derives it) and `coins` is gone entirely — it was persisted
            // verbatim and shown to the host as a real balance. Resolved outside
            // the fetch call because this callback is synchronous.
            void ensureAppSession({ context: 'teamup' }).then(sessionId => fetch('/api/lobby/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomCode: targetRoomId,
                    walletAddress: myAddress,
                    sessionId,
                    username: myProfile?.username,
                    avatarUrl: myProfile?.avatar_url,
                    desiredSeat: desiredSeatRef.current,
                    secret: token,
                }),
                signal: AbortSignal.timeout(12000),
            })).catch(() => { /* host may not have REST yet */ });
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

    // Host polls REST join requests (works when realtime JOIN_REQUEST never lands).
    // NET-08: bounded store, not an unbounded Set.
    const processedJoinRequestIds = useRef<DedupStore>(createDedupStore({
        max: 1024,
        ttlMs: 60 * 60 * 1000,
    }));
    useEffect(() => {
        if (!isHost || !currentRoomCode || !lobbyState || lobbyState.status !== 'forming') return;
        const room = currentRoomCode;
        let cancelled = false;
        const poll = async () => {
            try {
                const session = appSessionId || await ensureAppSession({ context: 'teamup' });
                if (!session || !myAddress) return;
                const params = new URLSearchParams({ roomCode: room, hostAddress: myAddress, sessionId: session });
                const res = await fetch(`/api/lobby/join?${params}`, {
                    signal: AbortSignal.timeout(6000),
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                const requests: Array<{
                    id?: string;
                    wallet_address: string;
                    username?: string | null;
                    avatar_url?: string | null;
                    desired_seat?: number | null;
                }> = data?.requests || [];
                for (const req of requests) {
                    if (cancelled) return;
                    if (!req?.wallet_address) continue;
                    if (req.id && processedJoinRequestIds.current.has(req.id)) continue;
                    if (req.id) processedJoinRequestIds.current.add(req.id);
                    const seated = seatGuestPlayer({
                        address: req.wallet_address,
                        username: req.username || undefined,
                        avatar_url: req.avatar_url || undefined,
                        desiredSeat: Number.isInteger(req.desired_seat) ? (req.desired_seat as number) : undefined,
                    });
                    if (seated && req.id) {
                        void fetch('/api/lobby/join', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: req.id, hostAddress: myAddress, sessionId: session }),
                        }).catch(() => { /* cleanup only */ });
                    }
                }
            } catch { /* timeout / offline */ }
        };
        void poll();
        const iv = setInterval(() => { void poll(); }, 2000);
        return () => { cancelled = true; clearInterval(iv); };
    }, [isHost, currentRoomCode, lobbyState, seatGuestPlayer, appSessionId, ensureAppSession, myAddress]);

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
        processedJoinRequestIds.current.clear();
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
    }, [destroyPeer, setIsHost, setIsLobbyConnected, setRoomId, setConnections, setGameState, setLobbyState, setParticipants, myAddress, clearRetryLadders]);

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
        matchPhase, matchFsmIllegal,
        activeBetWindow, startBettingWindow, createProvisionalSession, bindProvisionalSession
    }), [
        roomId, connections, isLobbyConnected, isHost, isComputeHost, activePlayers, gameState, lobbyState, pendingInvite, hostGame, joinGame, initQuickLobby, hostQuickLobby,
        sendIntent, broadcastAction, broadcastLobbyAction, swapPlayers, kickPlayer, sendInvite, acceptInvite, rejectInvite,
        startQuickMatch, myAddress, updateGameState, participants, intentQueue, clearIntent, sendIntentAck, leaveGame, validationToken,
        recordDisconnect, clearDisconnect, classifyAndRecordAbandon, abandonGraceFor,
        roomSecret, allowOpenJoins, lowerEntryFee, serverSeq, serverSeqRef, applyServerState, matchConnectionStatus, hasAuthoritativeSnapshot, matchPhase, matchFsmIllegal,
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
