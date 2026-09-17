"use client";

import { useCallback, useState } from 'react';
import { BetType, BetWindowPayload, BetWindowClosedPayload, GameActionType, GameState } from '@/lib/types';
import { ActiveBettingWindow } from './useSpectatorSync';
import { useAccount } from 'wagmi';
import { useAppSession } from './useAppSession';

export const BET_WINDOW_MS = 3000;

interface UseBettingControllerProps {
    isHost: boolean;
    matchId: string | undefined;
    broadcastAction: (type: GameActionType, payload?: unknown, fullState?: GameState) => void;
}

/**
 * Host-side betting window: OPEN → 3s → CLOSED, mirrored to live_matches.
 * Settlement still requires a host-signed resolve-bet after CLOSED.
 */
export function useBettingController({ isHost, matchId, broadcastAction }: UseBettingControllerProps) {
    const { address } = useAccount();
    const { ensureAppSession } = useAppSession();
    const [activeBetWindow, setActiveBetWindow] = useState<ActiveBettingWindow | null>(null);

    const startBettingWindow = useCallback(async (betType: BetType): Promise<string> => {
        if (!isHost) return new Date().toISOString();

        const windowId = crypto.randomUUID();
        const expiresAt = Date.now() + BET_WINDOW_MS;

        const openPayload: BetWindowPayload = { windowId, betType, expiresAt, matchId };
        broadcastAction('BET_WINDOW_OPEN', openPayload);
        setActiveBetWindow({ windowId, betType, expiresAt, windowClosedAt: null });

        if (matchId) {
            const sessionId = await ensureAppSession();
            if (sessionId && address) void fetch('/api/live-matches/window', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matchId, betType, status: 'open', hostAddress: address, sessionId })
            });
        }

        await new Promise(resolve => setTimeout(resolve, BET_WINDOW_MS));

        const windowClosedAt = new Date().toISOString();
        const closePayload: BetWindowClosedPayload = { windowId, windowClosedAt };
        broadcastAction('BET_WINDOW_CLOSED', closePayload);
        setActiveBetWindow(prev => prev?.windowId === windowId ? { ...prev, windowClosedAt } : prev);

        if (matchId) {
            const sessionId = await ensureAppSession();
            if (sessionId && address) void fetch('/api/live-matches/window', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matchId, betType, status: 'closed', hostAddress: address, sessionId })
            });
        }

        return windowClosedAt;
    }, [isHost, matchId, broadcastAction, address, ensureAppSession]);

    return { activeBetWindow, startBettingWindow };
}
