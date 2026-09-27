/**
 * W3 — optional wallet linking (two signatures). DUAL_PATH_WALLET_PLAN §3.3.
 * Progression is NOT merged on link. CHIPS funds do not move.
 */

export const WALLET_LINK_PREFIX = "Ludo Base wallet link";

export function buildWalletLinkMessage(params: {
    primary: string;
    linked: string;
    issuedAt: string;
}): string {
    return [
        WALLET_LINK_PREFIX,
        "Link these addresses to one player profile. No funds move.",
        `primary: ${params.primary.toLowerCase()}`,
        `linked: ${params.linked.toLowerCase()}`,
        `issued: ${params.issuedAt}`,
    ].join("\n");
}

export type WalletLinkRecord = {
    primary_wallet: string;
    linked_wallet: string;
    link_type: string;
    created_at: string;
};
