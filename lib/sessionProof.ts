/**
 * Auth session proofs:
 * - A: EIP-712 match session (one sign per match → moves/powers without popups)
 * - B: SIWE app session (chat / profile / settings — not match moves)
 * - C: Smart wallets sign the same EIP-712 grant once (no extra path required)
 */

import {
    DEFAULT_CHAIN_ID,
    parseChainId,
    type SupportedChainId,
} from './chains';

export const SESSION_TTL_MS = 30 * 60 * 1000;
export const APP_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * EIP-712 match-session domain for a supported chain.
 * Throws on any other chain id — callers must fail closed, never coerce.
 * Client and Edge must build byte-identical domains or verification fails.
 */
export function buildSessionDomain(chainId: number = DEFAULT_CHAIN_ID): {
    name: string;
    version: string;
    chainId: SupportedChainId;
} {
    const parsed = parseChainId(chainId);
    if (parsed === null) {
        throw new Error(`Unsupported signing chain: ${String(chainId)}`);
    }
    return { name: 'Ludo Base', version: '1', chainId: parsed };
}

export const LUDO_SESSION_DOMAIN = {
    name: 'Ludo Base',
    version: '1',
    chainId: 8453,
    // NOTE: no verifyingContract by design — there is no onchain verifier
    // contract, and a 0x0 placeholder renders as a scam signal in wallets
    // (Coinbase flags the Review screen). EIP-712 treats it as optional.
    // Changing this invalidates outstanding match sessions (30min TTL);
    // they fail closed and the user signs once more.
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

/** SIWE-style app session for chat / profile / settings (not match moves).
 * Short custom copy (not strict EIP-4361 prose) so wallets show plain text
 * instead of a wall of fields. Single source of truth — client and server
 * build the identical text, so restyle freely here only. Nonce stays: the
 * server requires it present and unique per session. */
export function buildSiweMessage(params: {
    domain: string;
    address: string;
    issuedAt: string;
    expirationTime: string;
    nonce: string;
    /** Signing chain. Defaults to mainnet (8453); Sepolia flows pass 84532. */
    chainId?: number;
}): string {
    const parsed = parseChainId(params.chainId ?? DEFAULT_CHAIN_ID);
    if (parsed === null) {
        throw new Error(`Unsupported signing chain: ${String(params.chainId)}`);
    }
    return [
        'You are signing in with your Base account:',
        params.address,
        '',
        'This signs you in for profile, chat and settings. Signing in never makes any transaction.',
        '',
        `URI: https://${params.domain}`,
        `Chain ID: ${parsed}`,
        `Nonce: ${params.nonce}`,
        `Issued At: ${params.issuedAt}`,
        `Expiration Time: ${params.expirationTime}`,
    ].join('\n');
}
