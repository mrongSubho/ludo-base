"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GameState, BetWindowPayload, BetWindowClosedPayload } from '@/lib/types';
import { parseSpectatorBroadcast, parseBetWindowOpen, parseBetWindowClosed } from '@/lib/protocol';
import { resyncMatch } from '@/lib/netcode/resync';
import { bumpNet } from '@/lib/netcode/counters';
import { track } from '@/lib/telemetry';

// ═══════════════════════════════════════════════════════════════════════
// useSpectatorSync — Spectator-side state synchronization (N6 parity)
//
// Listen-only on `game-room-${roomCode}` broadcast + snapshot via
// `resyncMatch` (public GET /api/match/state — world-readable board).
// Same schema parse-or-drop + net_* counters as the player path.
// ═══════════════════════════════════════════════════════════════════════

export interface ActiveBettingWindow {
    windowId: string;
    betType: string;
    expiresAt: number;
    windowClosedAt: string | null;   // null while open
}

interface SpectatorSyncState {
    gameState: GameState | null;
    isConnected: boolean;
    activeBetWindow: ActiveBettingWindow | null;
    /** Highest match_states.seq applied (N6). */
    seq: number;
}

const EMPTY_STATE: SpectatorSyncState = {
    gameState: null,
    isConnected: false,
    activeBetWindow: null,
    seq: 0,
};

export function useSpectatorSync(roomCode: string | null) {
    const [state, setState] = useState<SpectatorSyncState>(EMPTY_STATE);
    const stateRef = useRef<SpectatorSyncState>(EMPTY_STATE);

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

        const bootstrap = async () => {
            const { data } = await supabase.from('live_matches').select('match_id').eq('room_code', roomCode).maybeSingle();
            if (cancelled) return;
            matchId = data?.match_id || null;
            if (!matchId) return;

            // N6 — single resync path (public snapshot; no player session).
            await resyncMatch({
                matchId,
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
                    updateState({ gameState: snap, isConnected: true, seq });
                },
            });
        };
        void bootstrap();

        const channel = supabase
            .channel(`match-states-room-${roomCode}`)
            .on('broadcast', { event: 'game-action' }, ({ payload }) => {
                const parsed = parseSpectatorBroadcast(payload);
                if (!parsed.ok) {
                    dropSchema(parsed.reason);
                    return;
                }
                const { type, gameState, actionId } = parsed.value;
                const rest = (payload as Record<string, unknown>) || {};
                void actionId;

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

                    case 'BET_WINDOW_OPEN': {
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
                                windowClosedAt: null,
                            },
                        });
                        console.log(`🎰 [Spectator] Bet window OPEN: ${p.value.betType} (${p.value.windowId})`);
                        break;
                    }

                    case 'BET_WINDOW_CLOSED': {
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
                        break;
                    }

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

        return () => {
            cancelled = true;
            console.log(`🚪 [Spectator] Leaving game-room-${roomCode}`);
            supabase.removeChannel(channel);
            setState(EMPTY_STATE);
            stateRef.current = EMPTY_STATE;
        };
    }, [roomCode, updateState, dropSchema]);

    return state;
}

export type { BetWindowPayload, BetWindowClosedPayload };
