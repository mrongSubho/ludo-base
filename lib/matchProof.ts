/**
 * Canonical signed payloads for privileged match APIs.
 * Clients wallet-sign these; the server recovers the address with viem.
 */

export const MATCH_RECORD_PREFIX = 'Ludo Base match record';
export const BET_RESOLVE_PREFIX = 'Ludo Base bet resolve';

/** Max age for a signed privileged request. */
export const PROOF_MAX_AGE_MS = 10 * 60 * 1000;

export function buildMatchRecordMessage(params: {
    winnerAddress: string | null;
    roomCode: string;
    gameMode: string;
    participants: string[];
    wager: number;
    matchId?: string | null;
    issuedAt: string;
}): string {
    const parts = params.participants.map(p => p.toLowerCase()).sort();
    return [
        MATCH_RECORD_PREFIX,
        `winner: ${params.winnerAddress ? params.winnerAddress.toLowerCase() : 'none'}`,
        `room: ${params.roomCode}`,
        `mode: ${params.gameMode}`,
        `players: ${parts.join(',')}`,
        `wager: ${params.wager}`,
        `match: ${params.matchId || 'local'}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

export function buildBetResolveMessage(params: {
    matchId: string;
    result: string;
    betType: string;
    hostAddress: string;
    issuedAt: string;
}): string {
    return [
        BET_RESOLVE_PREFIX,
        `match: ${params.matchId}`,
        `result: ${params.result}`,
        `type: ${params.betType}`,
        `host: ${params.hostAddress.toLowerCase()}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

export function isFreshIssuedAt(issuedAt: string, nowMs: number = Date.now()): boolean {
    const t = Date.parse(issuedAt);
    if (!Number.isFinite(t)) return false;
    const age = nowMs - t;
    return age >= -60_000 && age <= PROOF_MAX_AGE_MS;
}
