/**
 * N0 — ResyncRequest carries match-session proof.
 * Host/Edge must not resume a player from an unauthenticated snapshot pull
 * when a match session exists for that actor. Spectators may use the public
 * `GET /api/match/state` (world-readable board only).
 */

export interface ResyncRequest {
    action: 'resync';
    matchId: string;
    /** EIP-712 match session id (required for player resume). */
    sessionId: string;
    /** Wallet or guest actor — must match the session wallet. */
    actor: string;
    /** Last applied seq (informational; server returns current). */
    sinceSeq?: number;
}

export interface ResyncRequestResultOk {
    ok: true;
    request: ResyncRequest;
}

export interface ResyncRequestResultErr {
    ok: false;
    reason: string;
}

export type ResyncRequestResult = ResyncRequestResultOk | ResyncRequestResultErr;

export function buildResyncRequest(params: {
    matchId: string;
    sessionId: string | undefined;
    actor: string | undefined;
    sinceSeq?: number;
}): ResyncRequestResult {
    const matchId = (params.matchId || '').trim();
    const sessionId = (params.sessionId || '').trim();
    const actor = (params.actor || '').trim().toLowerCase();

    if (!matchId || matchId === 'local') {
        return { ok: false, reason: 'LOCAL_MATCH' };
    }
    if (!sessionId) {
        return { ok: false, reason: 'SESSION_REQUIRED' };
    }
    if (!actor) {
        return { ok: false, reason: 'ACTOR_REQUIRED' };
    }
    return {
        ok: true,
        request: {
            action: 'resync',
            matchId,
            sessionId,
            actor,
            sinceSeq: typeof params.sinceSeq === 'number' ? params.sinceSeq : undefined,
        },
    };
}

/** Shape check for an inbound Edge payload (parse-or-drop style). */
export function isResyncRequest(value: unknown): value is ResyncRequest {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<ResyncRequest>;
    return (
        v.action === 'resync' &&
        typeof v.matchId === 'string' && v.matchId.length > 0 &&
        typeof v.sessionId === 'string' && v.sessionId.length > 0 &&
        typeof v.actor === 'string' && v.actor.length > 0 &&
        (v.sinceSeq === undefined || typeof v.sinceSeq === 'number')
    );
}
