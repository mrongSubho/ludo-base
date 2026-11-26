import { BASE_MAINNET_RPC_FALLBACKS, BASE_SEPOLIA_RPC_FALLBACKS } from './rpcTransport';

export type FeatureFlagKey =
    | 'paidPools'
    | 'spectatorBetting'
    | 'clanWars'
    | 'welcomeGrant'
    | 'arenaVaultDeposits'
    | 'quickMode'
    | 'freeBotBackfill';

export interface ConfigBuckets {
    1001: {
        tiers: number[];
        minWagerChips: number;
        maxWagerChips: number;
    };
    1002: {
        matchSettleSec: number;
        claimChallengeSec: number;
        turnClockMs: number;
        bettingWindowMs: number;
    };
    1003: {
        maxRakeBps: number;
        spectatorPoolFeeBps: number;
        clanWarGovBps: number;
    };
    1004: Record<FeatureFlagKey, boolean>;
    1005: {
        rpcUrls: {
            baseSepolia: string[];
            baseMainnet: string[];
        };
        blockedCountries: string[];
        euDmaCountries: string[];
        tosVersion: string;
        privacyVersion: string;
    };
}

export interface SignedConfigEnvelope {
    version: number;
    issuedAt: string;
    buckets: ConfigBuckets;
    alg: 'ECDSA-P256-SHA256';
    keyId: string;
    signature: string;
}

export const BLOCKED_COUNTRIES_DEFAULT: readonly string[] = ['KP', 'IR', 'SY', 'CU'];

export const EU_DMA_COUNTRIES: readonly string[] = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
];

export const DEFAULT_CONFIG_BUCKETS: ConfigBuckets = {
    1001: {
        tiers: [0, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
        minWagerChips: 0,
        maxWagerChips: 50000,
    },
    1002: {
        matchSettleSec: 180,
        claimChallengeSec: 604800,
        turnClockMs: 15000,
        bettingWindowMs: 15000,
    },
    1003: {
        maxRakeBps: 500,
        spectatorPoolFeeBps: 500,
        clanWarGovBps: 2000,
    },
    1004: {
        paidPools: true,
        spectatorBetting: true,
        clanWars: true,
        welcomeGrant: true,
        arenaVaultDeposits: true,
        quickMode: true,
        freeBotBackfill: true,
    },
    1005: {
        rpcUrls: {
            baseSepolia: [...BASE_SEPOLIA_RPC_FALLBACKS],
            baseMainnet: [...BASE_MAINNET_RPC_FALLBACKS],
        },
        blockedCountries: [...BLOCKED_COUNTRIES_DEFAULT],
        euDmaCountries: [...EU_DMA_COUNTRIES],
        tosVersion: 'v1',
        privacyVersion: 'v1',
    },
};

function stableSortValue(val: unknown): unknown {
    if (Array.isArray(val)) return val.map(stableSortValue);
    if (val && typeof val === 'object') {
        const out: Record<string, unknown> = {};
        const rec = val as Record<string, unknown>;
        for (const k of Object.keys(rec).sort()) {
            out[k] = stableSortValue(rec[k]);
        }
        return out;
    }
    return val;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(input: string): Uint8Array {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

export function canonicalConfigBytes(payload: {
    version: number;
    issuedAt: string;
    buckets: ConfigBuckets;
}): Uint8Array {
    return new TextEncoder().encode(
        JSON.stringify({
            version: payload.version,
            issuedAt: payload.issuedAt,
            buckets: stableSortValue(payload.buckets),
        }),
    );
}

export async function signConfigEnvelope(
    buckets: ConfigBuckets,
    privateJwk: JsonWebKey,
    opts?: { version?: number; issuedAt?: string; keyId?: string },
): Promise<SignedConfigEnvelope> {
    const version = opts?.version ?? 1;
    const issuedAt = opts?.issuedAt ?? new Date().toISOString();
    const keyId = opts?.keyId ?? 'k1';
    const bytes = canonicalConfigBytes({ version, issuedAt, buckets });
    const key = await crypto.subtle.importKey(
        'jwk',
        privateJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    return {
        version,
        issuedAt,
        buckets,
        alg: 'ECDSA-P256-SHA256',
        keyId,
        signature: bytesToBase64Url(new Uint8Array(sig)),
    };
}

export async function verifyConfigEnvelope(
    envelope: SignedConfigEnvelope,
    pubKeyInput: string | JsonWebKey,
): Promise<boolean> {
    try {
        if (!envelope || typeof envelope !== 'object' || !envelope.signature || !envelope.buckets) {
            return false;
        }
        const jwk = typeof pubKeyInput === 'string' ? (JSON.parse(pubKeyInput) as JsonWebKey) : pubKeyInput;
        const key = await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify'],
        );
        const bytes = canonicalConfigBytes({
            version: envelope.version,
            issuedAt: envelope.issuedAt,
            buckets: envelope.buckets,
        });
        const sigBytes = base64UrlToBytes(envelope.signature);
        return await crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key,
            sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
    } catch {
        return false;
    }
}

export interface KvLike {
    get(key: string, type?: string): Promise<string | null>;
}

const CACHE_TTL_MS = 30_000;
let cachedEnvelope: SignedConfigEnvelope | null = null;
let cachedAt = 0;

function fallbackEnvelope(): SignedConfigEnvelope {
    return {
        version: 1,
        issuedAt: new Date(0).toISOString(),
        buckets: DEFAULT_CONFIG_BUCKETS,
        alg: 'ECDSA-P256-SHA256',
        keyId: 'default',
        signature: '',
    };
}

async function resolveCloudflareKv(): Promise<KvLike | null> {
    try {
        const mod = await import('@opennextjs/cloudflare');
        const ctx = await mod.getCloudflareContext({ async: true });
        const env = (ctx?.env ?? {}) as { CONFIG_KV?: KvLike };
        return env.CONFIG_KV ?? null;
    } catch {
        return null;
    }
}

export async function getServerConfigEnvelope(opts?: {
    kv?: KvLike | null;
    pubKeyRaw?: string;
    forceFresh?: boolean;
}): Promise<SignedConfigEnvelope> {
    const custom = Boolean(opts && (opts.kv !== undefined || opts.pubKeyRaw !== undefined || opts.forceFresh));
    if (!custom && cachedEnvelope && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedEnvelope;
    }

    let result: SignedConfigEnvelope = fallbackEnvelope();
    try {
        const kv = opts?.kv !== undefined ? opts.kv : await resolveCloudflareKv();
        const pubKeyRaw = opts?.pubKeyRaw ?? process.env.NEXT_PUBLIC_CONFIG_PUBKEY;
        if (kv) {
            const raw = await kv.get('config:v1', 'text');
            if (raw) {
                const parsed = JSON.parse(raw) as SignedConfigEnvelope;
                const valid = Boolean(pubKeyRaw) && (await verifyConfigEnvelope(parsed, pubKeyRaw as string));
                if (valid && parsed.buckets?.[1004] && parsed.buckets?.[1005]) {
                    result = parsed;
                } else {
                    console.warn('[configRegistry] Config KV signature invalid or pubkey missing; using safe defaults');
                }
            }
        }
    } catch (err) {
        console.warn('[configRegistry] Failed to load CONFIG_KV; using defaults:', (err as Error).message);
    }

    if (!custom) {
        cachedEnvelope = result;
        cachedAt = Date.now();
    }
    return result;
}

export async function getServerConfig(opts?: {
    kv?: KvLike | null;
    pubKeyRaw?: string;
    forceFresh?: boolean;
}): Promise<ConfigBuckets> {
    const env = await getServerConfigEnvelope(opts);
    return env.buckets;
}

export async function assertFeatureEnabled(
    flag: FeatureFlagKey,
    cfgOverride?: ConfigBuckets,
): Promise<{ ok: true } | { ok: false; status: 503; error: string }> {
    const cfg = cfgOverride ?? (await getServerConfig());
    const enabled = cfg?.[1004]?.[flag] !== false;
    if (!enabled) {
        return {
            ok: false,
            status: 503,
            error: `Feature "${flag}" is temporarily disabled for maintenance.`,
        };
    }
    return { ok: true };
}
