"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GameState, BetWindowPayload, BetWindowClosedPayload } from '@/lib/types';
import { parseSpectatorBroadcast, parseBetWindowOpen, parseBetWindowClosed } from '@/lib/protocol';
import { resyncMatch } from '@/lib/netcode/resync';
import { RoomClient } from '@/lib/netcode/roomClient';
import { bumpNet } from '@/lib/netcode/counters';
import { track } from '@/lib/telemetry';

// ═══════════════════════════════════════════════════════════════════════
// useSpectatorSync — Spectator-side state synchronization (Wave 2 DO WS)
//
// Connects a read-only `RoomClient` (`as: 'spectator'`) directly to the
// authoritative MatchRoom Durable Object WebSocket once `matchId` resolves,
// while retaining `game-room-${roomCode}` for bet window events and a fallback
// `/api/match/state` poll strictly when the room WebSocket is not connected.
// ═══════════════════════════════════════════════════════════════════════

export interface ActiveBettingWindow {
    windowId: string;
    betType: string;
    expiresAt: number;
    openedAt?: number;
    windowClosedAt: string | null;   // null while open
}

interface SpectatorSyncState {
    matchId: string | null;
    gameState: GameState | null;
    isConnected: boolean;
    activeBetWindow: ActiveBettingWindow | null;
    /** Highest authoritative seq applied. */
    seq: number;
    getServerNow: () => number;
}

const EMPTY_STATE: SpectatorSyncState = {
    matchId: null,
    gameState: null,
    isConnected: false,
    activeBetWindow: null,
    seq: 0,
    getServerNow: () => Date.now(),
};

export function useSpectatorSync(roomCode: string | null) {
    const [state, setState] = useState<SpectatorSyncState>(EMPTY_STATE);
    const stateRef = useRef<SpectatorSyncState>(EMPTY_STATE);
    const roomWsConnectedRef = useRef(false);
    const roomClientRef = useRef<RoomClient | null>(null);

    const updateState = useCallback((patch: Partial<SpectatorSyncState>) => {
        const next = { ...stateRef.current, ...patch };
        stateRef.current = next;
        setState(next);
    }, []);

    const dropSchema = useCallback((reason: string) => {
        bumpNet('net_schema_drop');
        track('schema_drop', { via: 'spectator', reason });
    }, []);

    useEffect(() => {
        if (!roomCode) return;

        console.log(`👁️ [Spectator] Subscribing to live room ${roomCode}`);
        let matchId: string | null = null;
        let cancelled = false;
        roomWsConnectedRef.current = false;

        const applySnapshot = (id: string, snap: GameState, seq: number, allowEqual = false) => {
            const hasSnap = Boolean(stateRef.current.gameState);
            if (hasSnap && (allowEqual ? seq < stateRef.current.seq : seq <= stateRef.current.seq)) {
                return;
            }
            const closedNow =
                (snap.winner || snap.abortReason) &&
                stateRef.current.activeBetWindow &&
                !stateRef.current.activeBetWindow.windowClosedAt
                    ? { ...stateRef.current.activeBetWindow, windowClosedAt: new Date().toISOString() }
                    : stateRef.current.activeBetWindow;
            updateState({
                matchId: id,
                gameState: { ...snap, lastUpdate: Date.now() },
                isConnected: true,
                seq: Math.max(stateRef.current.seq, seq),
                activeBetWindow: closedNow,
            });
        };

        const bootstrap = async () => {
            const { data } = await supabase
                .from('live_matches')
                .select('match_id, bet_window_status, current_bet_type, created_at')
                .eq('room_code', roomCode)
                .maybeSingle();
            if (cancelled) return;
            matchId = data?.match_id || null;
            if (!matchId) return;

            const openedAt = data?.created_at ? Date.parse(data.created_at) : Date.now();
            const safeOpenedAt = Number.isFinite(openedAt) ? openedAt : Date.now();
            const expiresAt = safeOpenedAt + 90_000;
            const isOpenNow = data?.bet_window_status === 'open' && Date.now() < expiresAt;

            updateState({
                matchId,
                activeBetWindow: {
                    windowId: `live-${matchId}`,
                    betType: data?.current_bet_type || 'winner',
                    expiresAt,
                    openedAt: safeOpenedAt,
                    windowClosedAt: isOpenNow ? null : new Date(expiresAt).toISOString(),
                },
            });

            // Connect read-only RoomClient (`as: 'spectator'`) to the MatchRoom DO.
            const liveMatchId = matchId;
            try {
                const client = new RoomClient({
                    matchId: liveMatchId,
                    as: 'spectator',
                    onState: (snap, seq, _lastIntentId, resync) => {
                        if (cancelled) return;
                        applySnapshot(liveMatchId, snap, seq, Boolean(resync) || !stateRef.current.gameState);
                    },
                    onStatusChange: (status) => {
                        if (cancelled) return;
                        const connected = status === 'connected';
                        roomWsConnectedRef.current = connected;
                        if (connected) {
                            updateState({
                                isConnected: true,
                                getServerNow: () => client.getServerNow(),
                            });
                        }
                    },
                    onError: () => {
                        roomWsConnectedRef.current = false;
                    },
                    onReconnectExhausted: () => {
                        roomWsConnectedRef.current = false;
                    },
                });
                roomClientRef.current = client;
                client.connect();
            } catch (err) {
                console.warn('👁️ [Spectator] RoomClient init warning:', err);
                roomWsConnectedRef.current = false;
            }

            // Initial HTTP snapshot pull for instant first render while WS connects.
            await resyncMatch({
                matchId: liveMatchId,
                currentSeq: stateRef.current.seq,
                allowEqual: true,
                fetchSnapshot: async (id) => {
                    const res = await fetch(`/api/match/state?matchId=${encodeURIComponent(id)}`);
                    if (res.status === 404) return { ok: false, code: 'MATCH_NOT_FOUND' };
                    if (!res.ok) return { ok: false, code: 'FETCH_FAIL' };
                    const body = (await res.json()) as { seq?: number; state?: GameState };
                    if (!body?.state || !Number.isFinite(Number(body.seq))) {
                        return { ok: false, code: 'BAD_SNAPSHOT' };
                    }
                    return { ok: true, seq: Number(body.seq), state: body.state };
                },
                apply: (snap, seq) => {
                    applySnapshot(liveMatchId, snap, seq, true);
                },
            });
        };
        void bootstrap();

        const channel = supabase
            .channel(`game-room-${roomCode}`)
            .on('broadcast', { event: 'game-action' }, ({ payload }) => {
                const parsed = parseSpectatorBroadcast(payload);
                if (!parsed.ok) {
                    dropSchema(parsed.reason);
                    return;
                }
                const { type, gameState, actionId } = parsed.value;
                const rest = (payload as Record<string, unknown>) || {};
                void actionId;

                if (type === 'BET_WINDOW_OPEN') {
                    const p = parseBetWindowOpen(rest);
                    if (!p.ok) {
                        dropSchema(p.reason);
                        return;
                    }
                    updateState({
                        activeBetWindow: {
                            windowId: p.value.windowId,
                            betType: p.value.betType,
                            expiresAt: p.value.expiresAt,
                            openedAt: Date.now(),
                            windowClosedAt: null,
                        },
                    });
                    console.log(`🎰 [Spectator] Bet window OPEN: ${p.value.betType} (${p.value.windowId})`);
                    return;
                }

                if (type === 'BET_WINDOW_CLOSED') {
                    const p = parseBetWindowClosed(rest);
                    if (!p.ok) {
                        dropSchema(p.reason);
                        return;
                    }
                    if (stateRef.current.activeBetWindow?.windowId === p.value.windowId) {
                        updateState({
                            activeBetWindow: {
                                ...stateRef.current.activeBetWindow!,
                                windowClosedAt: p.value.windowClosedAt,
                            },
                        });
                    }
                    console.log(`🔒 [Spectator] Bet window CLOSED at ${p.value.windowClosedAt}`);
                    return;
                }

                // When DO WebSocket is live, never let legacy room broadcasts overwrite seq-ordered board state.
                if (roomWsConnectedRef.current) return;

                switch (type) {
                    case 'SYNC_STATE':
                        if (gameState) {
                            updateState({ gameState: gameState as unknown as GameState, isConnected: true });
                            bumpNet('net_intent_ok');
                        }
                        break;

                    case 'ROLL_DICE':
                    case 'DICE_REVEAL': {
                        if (stateRef.current.gameState) {
                            const diceValue = (rest.diceValue ?? rest.value ?? null) as number | null;
                            updateState({
                                gameState: {
                                    ...stateRef.current.gameState,
                                    diceValue,
                                    lastAction: { type, payload: rest },
                                },
                            });
                            bumpNet('net_intent_ok');
                        }
                        break;
                    }

                    case 'MOVE_TOKEN': {
                        if (stateRef.current.gameState && rest.positions) {
                            updateState({
                                gameState: {
                                    ...stateRef.current.gameState,
                                    positions: rest.positions as GameState['positions'],
                                    captureMessage: (rest.captureMessage as string | null) ?? null,
                                    lastAction: { type, payload: rest },
                                },
                            });
                            bumpNet('net_intent_ok');
                        }
                        break;
                    }

                    case 'TURN_SWITCH': {
                        if (stateRef.current.gameState) {
                            updateState({
                                gameState: {
                                    ...stateRef.current.gameState,
                                    currentPlayer: (rest.currentPlayer as GameState['currentPlayer']) ?? stateRef.current.gameState.currentPlayer,
                                    gamePhase: 'rolling',
                                    diceValue: null,
                                    lastAction: { type, payload: rest },
                                },
                            });
                            bumpNet('net_intent_ok');
                        }
                        break;
                    }

                    case 'START_GAME':
                        if (stateRef.current.gameState) {
                            updateState({
                                gameState: {
                                    ...stateRef.current.gameState,
                                    isStarted: true,
                                    status: 'playing',
                                    lastAction: { type, payload: rest },
                                },
                            });
                            bumpNet('net_intent_ok');
                        }
                        break;

                    default:
                        dropSchema('unhandled');
                        break;
                }
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log(`✅ [Spectator] Connected to game-room-${roomCode}`);
                    updateState({ isConnected: true });
                }
            });

        // HTTP polling fallback only runs when DO WebSocket is disconnected.
        const poll = setInterval(() => {
            if (cancelled || !matchId || roomWsConnectedRef.current) return;
            const liveMatchId = matchId;
            void resyncMatch({
                matchId: liveMatchId,
                currentSeq: stateRef.current.seq,
                fetchSnapshot: async (id) => {
                    const res = await fetch(`/api/match/state?matchId=${encodeURIComponent(id)}`);
                    if (res.status === 404) return { ok: false, code: 'MATCH_NOT_FOUND' };
                    if (!res.ok) return { ok: false, code: 'FETCH_FAIL' };
                    const body = (await res.json()) as { seq?: number; state?: GameState };
                    if (!body?.state || !Number.isFinite(Number(body.seq))) {
                        return { ok: false, code: 'BAD_SNAPSHOT' };
                    }
                    return { ok: true, seq: Number(body.seq), state: body.state };
                },
                apply: (snap, seq) => {
                    applySnapshot(liveMatchId, snap, seq);
                },
            });
        }, 2500);

        return () => {
            cancelled = true;
            clearInterval(poll);
            roomWsConnectedRef.current = false;
            roomClientRef.current?.disconnect();
            roomClientRef.current = null;
            console.log(`🚪 [Spectator] Leaving game-room-${roomCode}`);
            supabase.removeChannel(channel);
            setState(EMPTY_STATE);
            stateRef.current = EMPTY_STATE;
        };
    }, [roomCode, updateState, dropSchema]);

    return state;
}

export type { BetWindowPayload, BetWindowClosedPayload };
