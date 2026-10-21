"use client";

import { useEffect, useRef, useCallback } from 'react';
import type { GameState } from '@/lib/types';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
import { resyncMatch, shouldPauseLocalOrchestration } from '@/lib/netcode/resync';
import { reconnectDelayMs } from '@/lib/netcode/counters';
import { bumpNet } from '@/lib/netcode/counters';
import { track } from '@/lib/telemetry';

interface UseMatchStatesProps {
    matchId: string | undefined;
    enabled: boolean;
    /** Apply a higher-seq server state. */
    onServerState: (state: GameState, seq: number, allowEqual?: boolean) => void;
    /** Latest known server seq (for comparison). */
    getSeq: () => number;
    refreshState: (matchId: string) => Promise<{ ok: boolean; seq?: number; state?: GameState; code?: string }>;
    onStatus?: (status: MatchConnectionStatus) => void;
    /**
     * NET-05: does this client already hold an authoritative snapshot?
     * When true, a failed fetch must NOT pause orchestration — a host that
     * already knows the board keeps playing while the endpoint is flapping.
     */
    hasAuthoritativeSnapshot?: () => boolean;
    /**
     * SA-4: steady-state reconciliation interval. 0 disables the periodic poll
     * (tests / offline). The poll is seq-gated, so a no-op repeat costs one GET.
     */
    pollMs?: number;
}

/** NET-05: bounded backoff ladder for failed snapshot fetches. */
const MAX_SNAPSHOT_RETRIES = 8;

/**
 * P4 + N2: `match_states` display authority via the single `resyncMatch` path.
 * Timers/AFK/bots stay paused while status is reconnecting/syncing (ENGINE_LOGIC section 12).
 */
export function useMatchStates({ matchId, enabled, onServerState, getSeq, refreshState, onStatus, hasAuthoritativeSnapshot, pollMs = 6000 }: UseMatchStatesProps) {
    const onServerStateRef = useRef(onServerState);
    const getSeqRef = useRef(getSeq);
    onServerStateRef.current = onServerState;
    getSeqRef.current = getSeq;
    const refreshStateRef = useRef(refreshState);
    const onStatusRef = useRef(onStatus);
    refreshStateRef.current = refreshState;
    onStatusRef.current = onStatus;

    const runResync = useCallback(async (id: string, allowEqual = true) => {
        return resyncMatch({
            matchId: id,
            currentSeq: getSeqRef.current(),
            fetchSnapshot: (mid) => refreshStateRef.current(mid),
            apply: (state, seq, allowEq) => onServerStateRef.current(state, seq, allowEq),
            allowEqual,
            onStatus: (status) => {
                // NET-05: decouple "cannot reach the snapshot" from "must not
                // act". A client holding an authoritative snapshot (the host of
                // record) keeps orchestrating while the snapshot endpoint is
                // unreachable — the flap is reported, not acted on.
                if (status === 'reconnecting' && hasSnapshotRef.current?.()) {
                    bumpNet('net_heartbeat_timeout');
                    track('net_degraded', { matchId: id, reason: 'snapshot_unreachable', holds: true });
                    return;
                }
                onStatusRef.current?.(status);
            },
        });
    }, []);

    const hasSnapshotRef = useRef(hasAuthoritativeSnapshot);
    hasSnapshotRef.current = hasAuthoritativeSnapshot;

    useEffect(() => {
        if (!enabled || !matchId || matchId === 'local') return;
        let active = true;
        let attempt = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            if (!active) return;
            if (shouldPauseLocalOrchestration('ended')) return;
            // First poll of this match is the initial pull: allowEqual, so a
            // fresh tab renders even when the seq is unchanged.
            const r = await runResync(matchId, attempt === 0);
            if (!active) return;
            if (r.status === 'error') {
                // MATCH_NOT_FOUND is terminal — no ladder for a match that is
                // gone (resyncMatch already reported 'ended').
                if (r.code === 'MATCH_NOT_FOUND') return;
                if (attempt < MAX_SNAPSHOT_RETRIES) {
                    const delay = reconnectDelayMs(attempt);
                    attempt += 1;
                    timer = setTimeout(poll, delay);
                }
                return;
            }
            // Applied or a stale-but-successful fetch: steady state again.
            attempt = 0;
            // SA-4: steady-state reconciliation. Before this, the hook polled once
            // on mount and then only on error/online — so a host whose broadcast
            // was lost (relay flap, dropped peer message) left every guest on a
            // stale board indefinitely. The poll is seq-gated (allowEqual=false),
            // so a repeat that has nothing new applies nothing.
            if (active && pollMs > 0) timer = setTimeout(poll, pollMs);
        };

        void poll();

        // A 'online' event means the device recovered — resync immediately and
        // restart the ladder from the top.
        const handleOnline = () => {
            if (!active) return;
            if (timer) clearTimeout(timer);
            attempt = 0;
            void poll();
        };
        window.addEventListener('online', handleOnline);

        return () => {
            active = false;
            if (timer) clearTimeout(timer);
            window.removeEventListener('online', handleOnline);
        };
    }, [matchId, enabled, runResync, pollMs]);
}
