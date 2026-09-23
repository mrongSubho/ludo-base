/**
 * E1 replay action log (JSONL). Append-only during a match; replayable into the
 * pure engine for CI golden matches and post-mortems (G1).
 */

import { hashGameState, stableStringify } from './hash';
import type { GameState } from '../types';

export type ReplayEventKind =
    | 'meta'
    | 'intent'
    | 'action'
    | 'roll'
    | 'resync'
    | 'phase'
    | 'end';

export interface ReplayEvent {
    /** ms epoch at append */
    t: number;
    /** match_states.seq when known, else monotonic local index */
    seq: number;
    kind: ReplayEventKind;
    actionId?: string;
    intentId?: string;
    actor?: string;
    /** small structured payload — no secrets */
    payload: unknown;
    /** digest after applying this event, when a state is available */
    hash?: string;
}

export interface ReplayLog {
    version: 1;
    matchId?: string;
    playerCount: '1v1' | '4P' | '2v2';
    startedAt: string;
    events: ReplayEvent[];
    finalHash?: string;
}

export function createReplayLog(params: {
    matchId?: string;
    playerCount: '1v1' | '4P' | '2v2';
    startedAt?: string;
}): ReplayLog {
    return {
        version: 1,
        matchId: params.matchId,
        playerCount: params.playerCount,
        startedAt: params.startedAt ?? new Date().toISOString(),
        events: [],
    };
}

export function appendReplayEvent(
    log: ReplayLog,
    event: Omit<ReplayEvent, 't'> & { t?: number },
    stateAfter?: GameState
): ReplayEvent {
    const full: ReplayEvent = {
        ...event,
        t: event.t ?? Date.now(),
        hash: event.hash ?? (stateAfter ? hashGameState(stateAfter) : undefined),
    };
    log.events.push(full);
    return full;
}

export function finalizeReplay(log: ReplayLog, finalState: GameState): ReplayLog {
    log.finalHash = hashGameState(finalState);
    appendReplayEvent(log, {
        seq: log.events.length + 1,
        kind: 'end',
        payload: { finalHash: log.finalHash },
        hash: log.finalHash,
    }, finalState);
    return log;
}

/** JSONL: one header line + one line per event. */
export function serializeReplay(log: ReplayLog): string {
    const header = {
        version: log.version,
        matchId: log.matchId,
        playerCount: log.playerCount,
        startedAt: log.startedAt,
        finalHash: log.finalHash,
    };
    const lines = [JSON.stringify(header)];
    for (const ev of log.events) lines.push(JSON.stringify(ev));
    return lines.join('\n') + '\n';
}

export function parseReplay(text: string): ReplayLog {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) throw new Error('empty replay');
    const header = JSON.parse(lines[0]) as ReplayLog;
    if (header.version !== 1) throw new Error(`unsupported replay version ${header.version}`);
    const events: ReplayEvent[] = [];
    for (let i = 1; i < lines.length; i++) {
        events.push(JSON.parse(lines[i]) as ReplayEvent);
    }
    return { ...header, events };
}

/** Compare a recomputed hash to the log's recorded end hash. */
export function verifyReplayEnd(log: ReplayLog, finalState: GameState): { ok: boolean; expected?: string; actual: string } {
    const actual = hashGameState(finalState);
    const expected = log.finalHash;
    return { ok: !expected || expected === actual, expected, actual };
}

export function replayFingerprint(log: ReplayLog): string {
    // Content fingerprint independent of wall-clock t fields
    const stripped = log.events.map(({ t: _t, ...rest }) => rest);
    return stableStringify({
        version: log.version,
        playerCount: log.playerCount,
        matchId: log.matchId ?? null,
        events: stripped,
        finalHash: log.finalHash ?? null,
    });
}
