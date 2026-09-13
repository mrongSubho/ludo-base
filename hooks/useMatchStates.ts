"use client";

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { GameState } from '@/lib/types';
import { stripPowerTypesForWire } from '@/lib/engine';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';

interface UseMatchStatesProps {
    matchId: string | undefined;
    enabled: boolean;
    /** Apply a higher-seq server state. */
    onServerState: (state: GameState, seq: number) => void;
    /** Latest known server seq (for comparison). */
    getSeq: () => number;
    refreshState: (matchId: string) => Promise<{ ok: boolean; seq?: number; state?: GameState; code?: string }>;
    onStatus?: (status: MatchConnectionStatus) => void;
}

/**
 * P4: subscribe to `match_states` and apply rows with increasing `seq`.
 * Display authority is the server row — not host ENGINE_STATE broadcasts.
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

    useEffect(() => {
        if (!enabled || !matchId || matchId === 'local') return;

        const applyRow = (row: { seq?: number; state?: unknown }) => {
            const seq = Number(row?.seq ?? 0);
            const state = row?.state as GameState | undefined;
            if (!state || !Number.isFinite(seq)) return;
            if (seq <= getSeqRef.current()) return;
            // Types stay server-side; strip if a row still has them
            onServerStateRef.current(stripPowerTypesForWire(state) as GameState, seq);
        };

        const refresh = async () => {
            onStatusRef.current?.('syncing');
            const result = await refreshStateRef.current(matchId);
            if (result.ok && result.state && typeof result.seq === 'number') {
                applyRow({ seq: result.seq, state: result.state });
            }
            if (result.ok) onStatusRef.current?.('connected');
            else if (result.code === 'MATCH_NOT_FOUND') onStatusRef.current?.('ended');
            else onStatusRef.current?.('reconnecting');
        };
        void refresh();

        const channel = supabase
            .channel(`match-states-${matchId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'match_states', filter: `match_id=eq.${matchId}` },
                (payload) => {
                    const row = (payload.new || payload.old) as { seq?: number; state?: unknown };
                    if (row) applyRow(row);
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    void refresh();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    onStatusRef.current?.('reconnecting');
                }
            });

        const handleOnline = () => {
            void refresh();
        };
        window.addEventListener('online', handleOnline);

        return () => {
            window.removeEventListener('online', handleOnline);
            supabase.removeChannel(channel);
        };
    }, [matchId, enabled]);
}
