'use client';

// Player inventory: owned shop SKUs per wallet, persisted locally and
// hydrated from `/api/marketplace/inventory`. Equipped state lives in
// preferences (ludo-theme, token-style, dice-style) — this tracks OWNERSHIP.

const BASE_OWNED = [
    'theme-3077',
    'theme-retro',
    'dice-classic',
    'tokens-orb',
    'tokens-pawn',
];

const keyFor = (wallet: string | null | undefined) =>
    `ludo-inventory-${(wallet || 'guest').toLowerCase()}`;

function readRaw(wallet: string | null | undefined): string[] {
    try {
        const raw = localStorage.getItem(keyFor(wallet));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

export function getOwned(wallet: string | null | undefined): string[] {
    return [...new Set([...BASE_OWNED, ...readRaw(wallet)])];
}

export function isOwned(wallet: string | null | undefined, sku: string): boolean {
    return getOwned(wallet).includes(sku);
}

export function addOwned(wallet: string | null | undefined, sku: string): string[] {
    const next = [...new Set([...getOwned(wallet), sku])];
    try {
        localStorage.setItem(keyFor(wallet), JSON.stringify(next));
    } catch {
        /* storage unavailable — ownership lives for this session only */
    }
    return next;
}

export function hydrateOwned(wallet: string | null | undefined, serverIds: readonly string[]): string[] {
    const cleanServer = serverIds.filter((s): s is string => typeof s === 'string' && s.length > 0);
    const next = [...new Set([...getOwned(wallet), ...cleanServer])];
    try {
        localStorage.setItem(keyFor(wallet), JSON.stringify(next));
    } catch {
        /* storage unavailable — ownership lives for this session only */
    }
    return next;
}
