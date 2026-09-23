"use client";

import { useEffect, useRef, useCallback } from 'react';
import type { GameState } from '@/lib/types';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
import { resyncMatch, shouldPauseLocalOrchestration } from '@/lib/netcode/resync';

interface UseMatchStatesProps {
    matchId: string | undefined;
    enabled: boolean;
    /** Apply a higher-seq server state. */
    onServerState: (state: GameState, seq: number, allowEqual?: boolean) => void;
    /** Latest known server seq (for comparison). */
    getSeq: () => number;
    refreshState: (matchId: string) => Promise<{ ok: boolean; seq?: number; state?: GameState; code?: string }>;
    onStatus?: (status: MatchConnectionStatus) => void;
}

/**
 * P4 + N2: `match_states` display authority via the single `resyncMatch` path.
 * Timers/AFK/bots stay paused while status is reconnecting/syncing (ENGINE_LOGIC section 12).
 */
export function useMatchStates({ matchId, enabled, onServerState, getSeq, refreshState, onStatus }: UseMatchStatesProps) {
    const onServerStateRef = useRef(onServerState);
    const getSeqRef = useRef(getSeq);
    onServerStateRef.current = onServerState;
    getSeqRef.current = getSeq;
    const refreshStateRef = useRef(refreshState);
    const onStatusRef = useRef(onStatus);
    refreshStateRef.current = refreshState;
    onStatusRef.current = onStatus;

    const runResync = useCallback(async (id: string, allowEqual = true) => {
        await resyncMatch({
            matchId: id,
            currentSeq: getSeqRef.current(),
            fetchSnapshot: (mid) => refreshStateRef.current(mid),
            apply: (state, seq, allowEq) => onServerStateRef.current(state, seq, allowEq),
            allowEqual,
            onStatus: (status) => onStatusRef.current?.(status),
        });
    }, []);

    useEffect(() => {
        if (!enabled || !matchId || matchId === 'local') return;
        let active = true;

        const guard = (fn: () => Promise<void>) => async () => {
            if (!active || shouldPauseLocalOrchestration('ended')) return;
            await fn();
        };

        const refresh = guard(async () => {
            await runResync(matchId, true);
        });
        void refresh();

        // No postgres_changes subscription on match_states: the table has no
        // anon SELECT grant under default-deny, so realtime rows never arrive;
        // polling via refreshState (GET /api/match/state) is the sync path.
        const handleOnline = () => {
            void runResync(matchId, true);
        };
        window.addEventListener('online', handleOnline);

        return () => {
            active = false;
            window.removeEventListener('online', handleOnline);
        };
    }, [matchId, enabled, runResync]);
}
