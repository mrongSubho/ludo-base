/**
 * Dual-path identity (SMART_WALLET_PLANNING §3).
 *
 * - **External / Base Account:** `siwe:base` address is `wallet_address`.
 * - **In-game CDP:** the **parent Smart Account** is `wallet_address` (Mode B).
 *   Never the owner EOA and never a sub-account.
 * - No SIWE and no smart account → `address: undefined` (not a player id).
 */

export type CdpUserLike = {
    userId?: string;
    authenticationMethods?: {
        siwe?: { type?: string; address?: string } | undefined;
    };
    evmAccountObjects?: Array<{ address: string }> | undefined;
    evmSmartAccountObjects?: Array<{ address: string }> | undefined;
};

export type PlayerIdentity = {
    /** Sole `wallet_address` for this session (SIWE/Base or CDP smart). */
    address: string | undefined;
    /** True when id is the SIWE / Sign-in-with-Base address. */
    isBaseAccount: boolean;
    /** In-game smart (Mode B). Also `address` when there is no SIWE. */
    cdpSmartAccount: string | undefined;
    /** Diagnostic only — CDP owner EOA. Do not persist. */
    cdpOwnerEoa: string | undefined;
    userId: string | undefined;
};

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Resolve the only address allowed in `wallet_address`.
 * SIWE wins (external / Base Account). Otherwise the CDP parent smart
 * account is the in-game player id. Owner EOA is never the id.
 */
export function resolvePlayerIdentity(user: CdpUserLike | null | undefined): PlayerIdentity {
    const siwe = user?.authenticationMethods?.siwe?.address;
    const cdpSmartAccount = user?.evmSmartAccountObjects?.[0]?.address;
    const cdpOwnerEoa = user?.evmAccountObjects?.[0]?.address;
    const userId = user?.userId;

    if (siwe && ADDR_RE.test(siwe)) {
        return {
            address: siwe.toLowerCase(),
            isBaseAccount: true,
            cdpSmartAccount,
            cdpOwnerEoa,
            userId,
        };
    }

    // Mode B — in-game CDP Smart Account is the player id.
    if (cdpSmartAccount && ADDR_RE.test(cdpSmartAccount)) {
        return {
            address: cdpSmartAccount.toLowerCase(),
            isBaseAccount: false,
            cdpSmartAccount,
            cdpOwnerEoa,
            userId,
        };
    }

    return {
        address: undefined,
        isBaseAccount: false,
        cdpSmartAccount,
        cdpOwnerEoa,
        userId,
    };
}
