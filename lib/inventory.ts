'use client';

// Player inventory: owned shop SKUs per wallet, persisted locally.
// Equipped state lives in existing prefs (ludo-theme, token-style) +
// the new dice-style pref — this module only tracks OWNERSHIP.

const BASE_OWNED = ['theme-retro', 'dice-classic', 'tokens-pawn'];

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
