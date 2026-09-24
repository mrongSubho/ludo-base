/**
 * Option A identity (SMART_WALLET_PLAN §1.1): player id is the **Base Account**
 * from Sign in with Base / SIWE — never a CDP email-OTP embedded wallet and
 * never an owner EOA or sub-account.
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
    /** Sole `wallet_address` — Base Account. Undefined until siwe:base. */
    address: string | undefined;
    /** True when id is the SIWE / Sign-in-with-Base address. */
    isBaseAccount: boolean;
    /** Diagnostic only — CDP embedded smart (email OTP). Do not persist. */
    cdpSmartAccount: string | undefined;
    /** Diagnostic only — CDP owner EOA. Do not persist. */
    cdpOwnerEoa: string | undefined;
    userId: string | undefined;
};

/**
 * Resolve the only address allowed in `wallet_address` (Option A).
 * Email/OTP-only sessions return `address: undefined` — not a player id.
 */
export function resolvePlayerIdentity(user: CdpUserLike | null | undefined): PlayerIdentity {
    const siwe = user?.authenticationMethods?.siwe?.address;
    const cdpSmartAccount = user?.evmSmartAccountObjects?.[0]?.address;
    const cdpOwnerEoa = user?.evmAccountObjects?.[0]?.address;
    const userId = user?.userId;

    if (siwe && /^0x[a-fA-F0-9]{40}$/.test(siwe)) {
        return {
            address: siwe.toLowerCase(),
            isBaseAccount: true,
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
