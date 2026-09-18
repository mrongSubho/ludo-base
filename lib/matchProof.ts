/**
 * Canonical signed payloads for privileged match APIs.
 * Clients wallet-sign these; the server recovers the address with viem.
 */

export const MATCH_RECORD_PREFIX = 'Ludo Base match record';
export const BET_RESOLVE_PREFIX = 'Ludo Base bet resolve';
export const MOVE_PREFIX = 'Ludo Base move';
export const PASS_PREFIX = 'Ludo Base pass';
export const SEED_PREFIX = 'Ludo Base seed';
export const POWER_PREFIX = 'Ludo Base power';
export const STREAM_PREFIX = 'Ludo Base stream';
export const ECDH_PREFIX = 'Ludo Base ecdh key';

/** Max age for a signed privileged request. */
export const PROOF_MAX_AGE_MS = 10 * 60 * 1000;

/** Build the canonical payload signed before recording a completed match. */
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
        'Record the result — wins are tallied offchain, nothing leaves your wallet.',
        `winner: ${params.winnerAddress ? params.winnerAddress.toLowerCase() : 'none'}`,
        `room: ${params.roomCode}`,
        `mode: ${params.gameMode}`,
        `players: ${parts.join(',')}`,
        `wager: ${params.wager}`,
        `match: ${params.matchId || 'local'}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

/** Build the host-signed payload used by the bet settlement endpoint. */
export function buildBetResolveMessage(params: {
    matchId: string;
    result: string;
    betType: string;
    hostAddress: string;
    issuedAt: string;
}): string {
    return [
        BET_RESOLVE_PREFIX,
        'Settle the bets for this match.',
        `match: ${params.matchId}`,
        `result: ${params.result}`,
        `type: ${params.betType}`,
        `host: ${params.hostAddress.toLowerCase()}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

/** Accept timestamps within the clock-skew window and proof freshness limit. */
export function isFreshIssuedAt(issuedAt: string, nowMs: number = Date.now()): boolean {
    const t = Date.parse(issuedAt);
    if (!Number.isFinite(t)) return false;
    const age = nowMs - t;
    return age >= -60_000 && age <= PROOF_MAX_AGE_MS;
}

/** Build the player-signed payload for a server-validated token move. */
export function buildMoveMessage(params: {
    matchId: string;
    actor: string;
    color: string;
    tokenIndex: number;
    rollId: string;
    expectedSeq: number;
    issuedAt: string;
}): string {
    return [
        MOVE_PREFIX,
        'Confirm your move — this only proves it is you.',
        `match: ${params.matchId}`,
        `actor: ${params.actor.toLowerCase()}`,
        `color: ${params.color}`,
        `token: ${params.tokenIndex}`,
        `roll: ${params.rollId}`,
        `seq: ${params.expectedSeq}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

/** Build the player-signed payload for passing an unplayable turn. */
export function buildPassMessage(params: {
    matchId: string;
    actor: string;
    rollId: string;
    expectedSeq: number;
    issuedAt: string;
}): string {
    return [
        PASS_PREFIX,
        'Confirm you skip this turn.',
        `match: ${params.matchId}`,
        `actor: ${params.actor.toLowerCase()}`,
        `roll: ${params.rollId}`,
        `seq: ${params.expectedSeq}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

/** Build the host-signed payload that seeds a server-authoritative match. */
export function buildSeedMessage(params: {
    matchId: string;
    hostAddress: string;
    roomCode: string;
    expectedSeq: number;
    issuedAt: string;
}): string {
    return [
        SEED_PREFIX,
        'Start this match — nothing leaves your wallet.',
        `match: ${params.matchId}`,
        `host: ${params.hostAddress.toLowerCase()}`,
        `room: ${params.roomCode}`,
        `seq: ${params.expectedSeq}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

/** Build the player-signed payload for a server-authorized power action. */
export function buildPowerMessage(params: {
    matchId: string;
    actor: string;
    color: string;
    power: string;
    tokenIndex: number | null;
    expectedSeq: number;
    issuedAt: string;
}): string {
    return [
        POWER_PREFIX,
        'Confirm your power play — this only proves it is you.',
        `match: ${params.matchId}`,
        `actor: ${params.actor.toLowerCase()}`,
        `color: ${params.color}`,
        `power: ${params.power}`,
        `token: ${params.tokenIndex === null ? 'none' : params.tokenIndex}`,
        `seq: ${params.expectedSeq}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

export function buildStreamMessage(params: {
    matchId: string; roomCode: string; hostAddress: string; enabled: boolean; issuedAt: string;
}): string {
    return [
        STREAM_PREFIX,
        'Turn match streaming on or off.',
        `match: ${params.matchId}`,
        `room: ${params.roomCode}`,
        `host: ${params.hostAddress.toLowerCase()}`,
        `enabled: ${params.enabled}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}

/** Canonical fingerprint of a P-256 JWK (fixed field order — browser and
 * Node must hash byte-identical text). Displayed in the wallet popup
 * instead of the raw key blob. */
export async function ecdhKeyFingerprint(publicKey: JsonWebKey): Promise<string> {
    const x = (publicKey as { x?: unknown }).x;
    const y = (publicKey as { y?: unknown }).y;
    if (typeof x !== 'string' || typeof y !== 'string' || !x || !y) {
        throw new Error('Invalid P-256 public key');
    }
    const canonical = JSON.stringify({ crv: 'P-256', kty: 'EC', x, y });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const bytes = new Uint8Array(digest);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildEcdhMessage(walletAddress: string, fingerprint: string, issuedAt: string): string {
    return [
        'Ludo Base message key',
        `wallet: ${walletAddress.toLowerCase()}`,
        '',
        'This registers your private chat key so friends can message you securely. It never moves tokens.',
        '',
        `fingerprint: ${fingerprint}`,
        `issued: ${issuedAt}`,
    ].join('\n');
}
