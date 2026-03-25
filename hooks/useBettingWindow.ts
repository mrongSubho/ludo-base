"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BetType, BetWindowClosedPayload, BetWindowPayload } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════════════
// useBettingWindow — Host-side Betting Window Manager
//
// HOW IT WORKS:
//   1. Host calls `openBettingWindow(betType)` just before initiating a
//      dice commit. This broadcasts BET_WINDOW_OPEN to the channel.
//   2. After WINDOW_DURATION_MS, it auto-broadcasts BET_WINDOW_CLOSED.
//   3. The callback `onWindowClosed(windowClosedAt)` is invoked so the
//      host can then proceed with the dice reveal protocol.
//
// FRONT-RUNNING PREVENTION:
//   BET_WINDOW_CLOSED is sent BEFORE the ROLL_DICE/DICE_REVEAL broadcast.
//   Edge Function validates: bet.created_at < bet.window_closed_at.
// ═══════════════════════════════════════════════════════════════════════

const WINDOW_DURATION_MS = 3000; // 3-second betting window

interface UseBettingWindowOptions {
    roomCode: string | null | undefined;
    isHost: boolean;
    matchId?: string;
    onWindowClosed?: (windowClosedAt: string, windowId: string) => void;
}

interface BettingWindowState {
    isOpen: boolean;
    windowId: string | null;
    expiresAt: number | null;
    betType: BetType | null;
    windowClosedAt: string | null;
    timeRemainingMs: number;
}

export function useBettingWindow({
    roomCode,
    isHost,
    matchId,
    onWindowClosed,
}: UseBettingWindowOptions) {
    const [windowState, setWindowState] = useState<BettingWindowState>({
        isOpen: false,
        windowId: null,
        expiresAt: null,
        betType: null,
        windowClosedAt: null,
        timeRemainingMs: 0,
    });

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const onWindowClosedRef = useRef(onWindowClosed);
    useEffect(() => { onWindowClosedRef.current = onWindowClosed; }, [onWindowClosed]);

    // ─── Relay a betting window event to the Supabase broadcast channel ───
    const broadcastWindowEvent = useCallback(async (
        event: 'BET_WINDOW_OPEN' | 'BET_WINDOW_CLOSED',
        payload: BetWindowPayload | BetWindowClosedPayload,
    ) => {
        if (!roomCode) return;
        await supabase
            .channel(`game-room-${roomCode}`)
            .send({ type: 'broadcast', event: 'game-action', payload: { type: event, ...payload } });
    }, [roomCode]);

    // ─── Close the window atomically ───
    const closeWindow = useCallback((windowId: string) => {
        const windowClosedAt = new Date().toISOString();

        if (timerRef.current) clearTimeout(timerRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);

        setWindowState(prev => ({
            ...prev,
            isOpen: false,
            windowClosedAt,
            timeRemainingMs: 0,
        }));

        broadcastWindowEvent('BET_WINDOW_CLOSED', { windowId, windowClosedAt });
        onWindowClosedRef.current?.(windowClosedAt, windowId);
    }, [broadcastWindowEvent]);

    // ─── Open a betting window (host only) ───
    const openBettingWindow = useCallback((betType: BetType) => {
        if (!isHost || !roomCode) return null;

        const windowId = crypto.randomUUID();
        const expiresAt = Date.now() + WINDOW_DURATION_MS;

        const payload: BetWindowPayload = { windowId, betType, expiresAt, matchId };
        broadcastWindowEvent('BET_WINDOW_OPEN', payload);

        setWindowState({
            isOpen: true,
            windowId,
            expiresAt,
            betType,
            windowClosedAt: null,
            timeRemainingMs: WINDOW_DURATION_MS,
        });

        // Countdown display (updates every 100ms)
        countdownRef.current = setInterval(() => {
            setWindowState(prev => ({
                ...prev,
                timeRemainingMs: Math.max(0, (prev.expiresAt ?? 0) - Date.now()),
            }));
        }, 100);

        // Auto-close after WINDOW_DURATION_MS
        timerRef.current = setTimeout(() => {
            if (countdownRef.current) clearInterval(countdownRef.current);
            closeWindow(windowId);
        }, WINDOW_DURATION_MS);

        return windowId;
    }, [isHost, roomCode, matchId, broadcastWindowEvent, closeWindow]);

    // Cleanup on unmount
    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);
    }, []);

    return {
        windowState,
        openBettingWindow,
        /** Force-close early (e.g., all players committed dice) */
        forceCloseWindow: () => {
            if (windowState.windowId) closeWindow(windowState.windowId);
        },
        WINDOW_DURATION_MS,
    };
}
