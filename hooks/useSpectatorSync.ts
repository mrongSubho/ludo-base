"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GameState, BetWindowPayload, BetWindowClosedPayload } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════════════
// useSpectatorSync — Spectator-side state synchronization
//
// HOW IT WORKS:
//   Spectators subscribe to the existing `game-room-${roomCode}` Supabase
//   Realtime Broadcast channel in LISTEN-ONLY mode (no P2P connection).
//   All game action events are applied to local state identically to
//   how players receive them — so Board.tsx renders the live match.
//
// BETTING WINDOW EVENTS:
//   BET_WINDOW_OPEN  → sets active window, starts countdown display
//   BET_WINDOW_CLOSED → records windowClosedAt for bet submission
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
}

const EMPTY_STATE: SpectatorSyncState = {
    gameState: null,
    isConnected: false,
    activeBetWindow: null,
};

export function useSpectatorSync(roomCode: string | null) {
    const [state, setState] = useState<SpectatorSyncState>(EMPTY_STATE);
    const stateRef = useRef<SpectatorSyncState>(EMPTY_STATE);

    const updateState = useCallback((patch: Partial<SpectatorSyncState>) => {
        const next = { ...stateRef.current, ...patch };
        stateRef.current = next;
        setState(next);
    }, []);

    useEffect(() => {
        if (!roomCode) return;

        console.log(`👁️ [Spectator] Subscribing to game-room-${roomCode}`);

        const channel = supabase
            .channel(`game-room-${roomCode}`)
            .on('broadcast', { event: 'game-action' }, ({ payload }) => {
                const { type, gameState, ...rest } = payload;

                switch (type) {
                    // ── Full state sync (heartbeat or on-join) ──
                    case 'SYNC_STATE':
                        if (gameState) {
                            updateState({ gameState, isConnected: true });
                        }
                        break;

                    // ── Dice roll — update dice value ──
                    case 'ROLL_DICE':
                    case 'DICE_REVEAL':
                        if (stateRef.current.gameState) {
                            updateState({
                                gameState: {
                                    ...stateRef.current.gameState,
                                    diceValue: rest.diceValue ?? rest.value ?? null,
                                    lastAction: { type, payload: rest },
                                },
                            });
                        }
                        break;

                    // ── Token move — update positions ──
                    case 'MOVE_TOKEN':
                        if (stateRef.current.gameState && rest.positions) {
                            updateState({
                                gameState: {
                                    ...stateRef.current.gameState,
                                    positions: rest.positions,
                                    captureMessage: rest.captureMessage ?? null,
                                    lastAction: { type, payload: rest },
                                },
                            });
                        }
                        break;

                    // ── Turn switch ──
                    case 'TURN_SWITCH':
                        if (stateRef.current.gameState) {
                            updateState({
                                gameState: {
                                    ...stateRef.current.gameState,
                                    currentPlayer: rest.currentPlayer ?? stateRef.current.gameState.currentPlayer,
                                    gamePhase: 'rolling',
                                    diceValue: null,
                                    lastAction: { type, payload: rest },
                                },
                            });
                        }
                        break;

                    // ── Game starts ──
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
                        }
                        break;

                    // ─────────────────────────────────────────────────────
                    // BETTING WINDOW PROTOCOL
                    // ─────────────────────────────────────────────────────

                    case 'BET_WINDOW_OPEN': {
                        const p = rest as BetWindowPayload;
                        updateState({
                            activeBetWindow: {
                                windowId: p.windowId,
                                betType: p.betType,
                                expiresAt: p.expiresAt,
                                windowClosedAt: null,
                            },
                        });
                        console.log(`🎰 [Spectator] Bet window OPEN: ${p.betType} (${p.windowId})`);
                        break;
                    }

                    case 'BET_WINDOW_CLOSED': {
                        const p = rest as BetWindowClosedPayload;
                        if (stateRef.current.activeBetWindow?.windowId === p.windowId) {
                            updateState({
                                activeBetWindow: {
                                    ...stateRef.current.activeBetWindow!,
                                    windowClosedAt: p.windowClosedAt,
                                },
                            });
                        }
                        console.log(`🔒 [Spectator] Bet window CLOSED at ${p.windowClosedAt}`);
                        break;
                    }

                    default:
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
            console.log(`🚪 [Spectator] Leaving game-room-${roomCode}`);
            supabase.removeChannel(channel);
            setState(EMPTY_STATE);
            stateRef.current = EMPTY_STATE;
        };
    }, [roomCode, updateState]);

    return state;
}
