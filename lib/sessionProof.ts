/**
 * Auth session proofs:
 * - A: EIP-712 match session (one sign per match → moves/powers without popups)
 * - B: SIWE app session (chat / profile / settings — not match moves)
 * - C: Smart wallets sign the same EIP-712 grant once (no extra path required)
 */

export const SESSION_TTL_MS = 30 * 60 * 1000;
export const APP_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const LUDO_SESSION_DOMAIN = {
    name: 'Ludo Base',
    version: '1',
    chainId: 8453,
    verifyingContract: '0x0000000000000000000000000000000000000000',
} as const;

export const LUDO_SESSION_TYPES = {
    LudoMatchSession: [
        { name: 'wallet', type: 'address' },
        { name: 'matchId', type: 'string' },
        { name: 'roomCode', type: 'string' },
        { name: 'expiresAt', type: 'uint256' },
        { name: 'nonce', type: 'string' },
    ],
} as const;

export interface MatchSessionTypedMessage {
    wallet: `0x${string}`;
    matchId: string;
    roomCode: string;
    expiresAt: bigint;
    nonce: string;
}

export interface MatchSessionPayload {
    wallet: string;
    matchId: string;
    roomCode: string;
    expiresAt: number;
    nonce: string;
}

export function buildMatchSessionPayload(params: {
    wallet: string;
    matchId: string;
    roomCode: string;
    ttlMs?: number;
}): MatchSessionPayload {
    return {
        wallet: params.wallet.toLowerCase(),
        matchId: params.matchId,
        roomCode: params.roomCode,
        expiresAt: Date.now() + (params.ttlMs ?? SESSION_TTL_MS),
        nonce: crypto.randomUUID(),
    };
}

/** SIWE-style app session for chat / profile / settings (not match moves). */
export function buildSiweMessage(params: {
    domain: string;
    address: string;
    issuedAt: string;
    expirationTime: string;
    nonce: string;
}): string {
    return [
        `${params.domain} wants you to sign in with your Ethereum account:`,
        params.address,
        '',
        'Sign in to Ludo Base (profile, chat, settings).',
        'This does not authorize match moves or payouts.',
        '',
        `URI: https://${params.domain}`,
        `Version: 1`,
        `Chain ID: 8453`,
        `Nonce: ${params.nonce}`,
        `Issued At: ${params.issuedAt}`,
        `Expiration Time: ${params.expirationTime}`,
    ].join('\n');
}
