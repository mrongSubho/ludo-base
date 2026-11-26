import { fallback, http, type Transport } from 'viem';

function envUrl(...keys: string[]): string[] {
    const out: string[] = [];
    for (const k of keys) {
        const val = typeof process !== 'undefined' ? process.env?.[k] : undefined;
        if (val && typeof val === 'string' && /^https?:\/\//i.test(val.trim())) {
            out.push(val.trim());
        }
    }
    return out;
}

export const BASE_SEPOLIA_RPC_FALLBACKS: readonly string[] = [
    ...envUrl('NEXT_PUBLIC_MISSION_RPC_URL', 'BASE_SEPOLIA_RPC_URL', 'SEPOLIA_RPC'),
    'https://sepolia.base.org',
    'https://base-sepolia-rpc.publicnode.com',
].filter((url, idx, arr) => arr.indexOf(url) === idx);

export const BASE_MAINNET_RPC_FALLBACKS: readonly string[] = [
    ...envUrl('BASE_MAINNET_RPC_URL'),
    'https://mainnet.base.org',
    'https://base-rpc.publicnode.com',
].filter((url, idx, arr) => arr.indexOf(url) === idx);

/**
 * Multi-endpoint RPC transport (`rank: false`) preventing single-RPC stalls
 * or flaky public-endpoint failures on reads and preflight simulations.
 */
export function createFallbackRpcTransport(chainId: number = 84532): Transport {
    const urls = chainId === 8453 ? BASE_MAINNET_RPC_FALLBACKS : BASE_SEPOLIA_RPC_FALLBACKS;
    return fallback(
        urls.map((url) => http(url, { retryCount: 1, timeout: 8_000 })),
        { rank: false },
    );
}
