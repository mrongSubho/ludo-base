'use client';

// Showcased vault relic: exactly one per wallet, persisted locally.
// (Mirrors lib/inventory.ts — ownership lives there, display choice here.)

const keyFor = (wallet: string | null | undefined) =>
    `ludo-showcase-${(wallet || 'guest').toLowerCase()}`;

export function getShowcased(wallet: string | null | undefined): string | null {
    try {
        const raw = localStorage.getItem(keyFor(wallet));
        return typeof raw === 'string' && raw.length > 0 ? raw : null;
    } catch {
        return null;
    }
}

export function setShowcased(wallet: string | null | undefined, sku: string | null): string | null {
    try {
        if (sku) localStorage.setItem(keyFor(wallet), sku);
        else localStorage.removeItem(keyFor(wallet));
    } catch {
        /* storage unavailable — showcase lives for this session only */
    }
    return sku;
}
