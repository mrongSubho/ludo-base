/**
 * Marketplace prices in whole CHIPS — the single source of truth, imported by
 * BOTH the server route (`app/api/marketplace/purchase/route.ts`, which
 * charges) and the client panel (which builds the signed purchase intent).
 * Sharing the table makes a client/server total mismatch structurally
 * impossible: the message the buyer signs always prices what the server
 * charges. Product-tunable here; rarity bands live in the panel.
 */
export const MARKETPLACE_PRICES: Record<string, number> = {
    'theme-daybreak': 500, 'dice-midnight': 300, 'dice-gold': 800,
    'tokens-orb': 300, s1: 180, s2: 300, s3: 2000, s4: 100, s5: 240, s6: 60,
};

/** Whole-CHIPS total for SKUs, or null when any SKU is unknown. */
export function marketplaceTotalChips(ids: string[]): number | null {
    let total = 0;
    for (const id of ids) {
        const price = MARKETPLACE_PRICES[id];
        if (price === undefined) return null;
        total += price;
    }
    return total;
}
