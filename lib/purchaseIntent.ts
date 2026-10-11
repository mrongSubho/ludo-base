/**
 * Canonical purchase-intent message for the CHIPS marketplace rail.
 *
 * The buyer wallet-signs (personal_sign) this text per purchase; the route
 * rebuilds it from server-owned prices and verifies with
 * `verifyPersonalSign` before debiting escrow. Replay of a captured intent is
 * harmless by construction: the RPC is idempotent on `requestId`, so a replay
 * returns the original balance instead of debiting twice. Freshness is bounded
 * by `isFreshIssuedAt` (lib/matchProof.ts, 10 min).
 */
export const PURCHASE_INTENT_PREFIX = 'Ludo Base purchase';

/** Build the canonical payload signed before a CHIPS marketplace purchase. */
export function buildPurchaseIntentMessage(params: {
    buyer: string;
    itemIds: string[];
    /** Whole CHIPS, server-owned. */
    totalChips: number;
    requestId: string;
    issuedAt: string;
}): string {
    const items = [...params.itemIds].map(String).sort();
    return [
        PURCHASE_INTENT_PREFIX,
        'Spend escrowed CHIPS on cosmetics — nothing else moves.',
        `buyer: ${params.buyer.toLowerCase()}`,
        `items: ${items.join(',')}`,
        `total: ${params.totalChips} CHIPS`,
        `request: ${params.requestId}`,
        `issued: ${params.issuedAt}`,
    ].join('\n');
}
