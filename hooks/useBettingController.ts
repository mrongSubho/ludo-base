"use client";

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BetType, BetWindowPayload, BetWindowClosedPayload, GameActionType, GameState } from '@/lib/types';
import { ActiveBettingWindow } from './useSpectatorSync';

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
    const [activeBetWindow, setActiveBetWindow] = useState<ActiveBettingWindow | null>(null);

    const startBettingWindow = useCallback(async (betType: BetType): Promise<string> => {
        if (!isHost) return new Date().toISOString();

        const windowId = crypto.randomUUID();
        const expiresAt = Date.now() + BET_WINDOW_MS;

        const openPayload: BetWindowPayload = { windowId, betType, expiresAt, matchId };
        broadcastAction('BET_WINDOW_OPEN', openPayload);
        setActiveBetWindow({ windowId, betType, expiresAt, windowClosedAt: null });

        if (matchId) {
            supabase.from('live_matches')
                .update({
                    bet_window_status: 'open',
                    current_bet_type: betType,
                    window_opened_at: new Date().toISOString()
                })
                .eq('match_id', matchId)
                .then();
        }

        await new Promise(resolve => setTimeout(resolve, BET_WINDOW_MS));

        const windowClosedAt = new Date().toISOString();
        const closePayload: BetWindowClosedPayload = { windowId, windowClosedAt };
        broadcastAction('BET_WINDOW_CLOSED', closePayload);
        setActiveBetWindow(prev => prev?.windowId === windowId ? { ...prev, windowClosedAt } : prev);

        if (matchId) {
            supabase.from('live_matches')
                .update({
                    bet_window_status: 'closed',
                    window_closed_at: windowClosedAt
                })
                .eq('match_id', matchId)
                .then();
        }

        return windowClosedAt;
    }, [isHost, matchId, broadcastAction]);

    return { activeBetWindow, startBettingWindow };
}
