/**
 * N2 — single resync path for match_states snapshots.
 * ENGINE_LOGIC.md section 12: pause timers until an authoritative snapshot is applied.
 */

import type { GameState } from '../types';
import type { MatchConnectionStatus } from '../matchProtocol';
import { stripPowerTypesForWire } from '../engine/core';
import { bumpNet } from './counters';
import { track } from '../telemetry';

export type SnapshotFetchResult = {
    ok: boolean;
    seq?: number;
    state?: GameState;
    code?: string;
};

export type SnapshotFetch = (matchId: string) => Promise<SnapshotFetchResult>;

export type ResyncResult =
    | { status: 'applied'; seq: number; state: GameState; skipped: boolean }
    | { status: 'stale'; seq: number }
    | { status: 'error'; code?: string; message?: string };

export type ResyncParams = {
    matchId: string;
    /** Highest seq this client has already applied. */
    currentSeq: number;
    fetchSnapshot: SnapshotFetch;
    /** Apply server-authoritative state. Must be idempotent for allowEqual. */
    apply: (state: GameState, seq: number, allowEqual?: boolean) => void;
    /**
     * Allow equal seq re-apply (initial pull / forced refresh).
     * Default false — only strictly higher seqs advance the client.
     */
    allowEqual?: boolean;
    onStatus?: (status: MatchConnectionStatus) => void;
};

/**
 * Fetch + apply a match_states snapshot. One code path for reconnect,
 * online events, host election, and explicit user "resync".
 */
export async function resyncMatch(params: ResyncParams): Promise<ResyncResult> {
    const { matchId, currentSeq, fetchSnapshot, apply, allowEqual = false, onStatus } = params;

    if (!matchId || matchId === 'local') {
        return { status: 'error', code: 'LOCAL_MATCH' };
    }

    onStatus?.('syncing');
    bumpNet('net_reconnect_attempt');

    let result: SnapshotFetchResult;
    try {
        result = await fetchSnapshot(matchId);
    } catch (err) {
        bumpNet('net_heartbeat_timeout');
        onStatus?.('reconnecting');
        track('net_degraded', { matchId, reason: 'fetch_throw' });
        return { status: 'error', code: 'FETCH_THROW', message: String(err) };
    }

    if (!result.ok) {
        bumpNet('net_heartbeat_timeout');
        if (result.code === 'MATCH_NOT_FOUND') {
            onStatus?.('ended');
            return { status: 'error', code: result.code };
        }
        onStatus?.('reconnecting');
        track('net_degraded', { matchId, reason: 'fetch_fail', code: result.code ?? 'unknown' });
        return { status: 'error', code: result.code, message: 'snapshot fetch failed' };
    }

    const seq = Number(result.seq ?? Number.NaN);
    const raw = result.state;
    if (!raw || !Number.isFinite(seq)) {
        bumpNet('net_heartbeat_timeout');
        onStatus?.('reconnecting');
        return { status: 'error', code: 'BAD_SNAPSHOT' };
    }

    const state = stripPowerTypesForWire(raw) as GameState;
    const higher = seq > currentSeq;
    const equalOk = allowEqual && seq >= currentSeq;

    if (!higher && !equalOk) {
        // Stale or equal when equal not allowed — still a successful fetch.
        bumpNet('net_reconnect_success');
        onStatus?.('connected');
        return { status: 'stale', seq };
    }

    if (higher && seq > currentSeq + 1) {
        bumpNet('net_seq_gap');
        track('net_degraded', { matchId, reason: 'seq_gap', seq, currentSeq });
    }

    try {
        apply(state, seq, allowEqual && seq === currentSeq);
    } catch (err) {
        bumpNet('net_heartbeat_timeout');
        onStatus?.('reconnecting');
        track('net_degraded', { matchId, reason: 'apply_throw' });
        return { status: 'error', code: 'APPLY_THROW', message: String(err) };
    }

    bumpNet('net_reconnect_success');
    bumpNet('net_resync_applied');
    track('resync_ok', { matchId, seq, skipped: !higher });
    onStatus?.(state.status === 'finished' || state.winner ? 'ended' : 'connected');

    return { status: 'applied', seq, state, skipped: !higher };
}

/** True while timers/AFK/bots must stay paused (no authoritative snapshot yet). */
export function shouldPauseLocalOrchestration(status: MatchConnectionStatus): boolean {
    return status === 'reconnecting' || status === 'syncing' || status === 'ended';
}
