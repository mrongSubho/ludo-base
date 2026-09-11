"use client";

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { GameState } from '@/lib/types';
import { stripPowerTypesForWire } from '@/lib/engine';

interface UseMatchStatesProps {
    matchId: string | undefined;
    enabled: boolean;
    /** Apply a higher-seq server state. */
    onServerState: (state: GameState, seq: number) => void;
    /** Latest known server seq (for comparison). */
    getSeq: () => number;
}

/**
 * P4: subscribe to `match_states` and apply rows with increasing `seq`.
 * Display authority is the server row — not host ENGINE_STATE broadcasts.
 */
export function useMatchStates({ matchId, enabled, onServerState, getSeq }: UseMatchStatesProps) {
    const onServerStateRef = useRef(onServerState);
    const getSeqRef = useRef(getSeq);
    onServerStateRef.current = onServerState;
    getSeqRef.current = getSeq;

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

        // Initial pull
        void supabase
            .from('match_states')
            .select('seq, state')
            .eq('match_id', matchId)
            .maybeSingle()
            .then(({ data }) => {
                if (data) applyRow(data as { seq?: number; state?: unknown });
            }, () => { /* optional */ });

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
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [matchId, enabled]);
}
