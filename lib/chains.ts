/**
 * Dual-chain source of truth (Base mainnet + Base Sepolia).
 *
 * App runs on **Base Sepolia only** (84532) until mainnet launch.
 * Mainnet (8453) stays in the type for a future cutover but is **not**
 * accepted until then. Every signature path (SIWE, match session, move/power,
 * settle, vouchers) validates `chainId` against this allowlist.
 *
 * RPC discipline (Base skill): production reads go through a dedicated
 * provider proxied by backend env vars — never public endpoints in prod,
 * never API keys client-side. `http()` with no URL (public endpoint) is
 * dev/test fallback only.
 */
import { base, baseSepolia } from 'viem/chains';

/** Chain IDs wallet signatures are accepted on. No others, ever. */
export const SUPPORTED_CHAIN_IDS = [84532] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** Default / only signing chain until mainnet launch (Base Sepolia). */
export const DEFAULT_CHAIN_ID: SupportedChainId = 84532;

/** Strict allowlist check. Accepts numbers and numeric strings; rejects all else. */
export function parseChainId(input: unknown): SupportedChainId | null {
    const n =
        typeof input === 'number'
            ? input
            : typeof input === 'string' && input.trim() !== ''
              ? Number(input.trim())
              : NaN;
    if (n === 84532) return n;
    return null;
}

export function isSupportedChainId(id: unknown): id is SupportedChainId {
    return parseChainId(id) !== null;
}

/** viem chain object for a supported chain id (for public clients). */
export function viemChainFor(chainId: SupportedChainId) {
    return chainId === 84532 ? baseSepolia : base;
}

/**
 * Backend RPC URL for signature verification on a chain.
 * 8453 → SIWE_VERIFY_RPC_URL · 84532 → SIWE_VERIFY_RPC_URL_SEPOLIA.
 * Empty string = fall back to public endpoint (dev/test only).
 */
export function verifyRpcUrl(chainId: SupportedChainId): string {
    if (typeof process === 'undefined' || !process.env) return '';
    const v =
        chainId === 84532
            ? process.env.SIWE_VERIFY_RPC_URL_SEPOLIA
            : process.env.SIWE_VERIFY_RPC_URL;
    return (v || '').trim();
}

/**
 * Extract the `Chain ID: N` line from a SIWE-style personal-sign message.
 * Returns null when the message carries no chain line (legacy match-action
 * messages are bound by match/session DB rows + TTL instead).
 */
export function extractMessageChainId(message: string): number | null {
    const m = /Chain ID:\s*(\d+)/.exec(message);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isSafeInteger(n) ? n : null;
}
