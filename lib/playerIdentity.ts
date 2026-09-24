/**
 * Option A identity (SMART_WALLET_PLAN §1.1): player id is the **Base Account**
 * from Sign in with Base / SIWE — never a CDP email-OTP embedded wallet and
 * never an owner EOA or sub-account.
 */

export type SiweAuthLike = {
    type?: string;
    address?: string | null;
};

export type AuthMethodsLike = {
    siwe?: SiweAuthLike | null;
};

export type CdpUserLike = {
    authenticationMethods?: AuthMethodsLike | null;
    evmAccountObjects?: Array<{ address: string }> | null;
    evmSmartAccountObjects?: Array<{ address: string }> | null;
};

export type PlayerIdentity = {
    /** Canonical `wallet_address` — Base Account (Option A). */
    address: string | undefined;
    /** True when id comes from siwe:base / Sign in with Ethereum. */
    isBaseAccount: boolean;
    /** CDP embedded smart account (email OTP) — display-only diagnostic. */
    cdpSmartAccount: string | undefined;
    /** CDP owner EOA — never use as wallet_address. */
    cdpOwnerEoa: string | undefined;
};

/**
 * Resolve the sole player id. Option A: SIWE/Base Account wins.
 * CDP embedded accounts are recorded for diagnostics only and must not be
 * written to `wallet_address` when a SIWE address exists.
 */
export function resolvePlayerIdentity(user: CdpUserLike | null | undefined): PlayerIdentity {
    const siwe = user?.authenticationMethods?.siwe?.address;
    const cdpSmartAccount = user?.evmSmartAccountObjects?.[0]?.address;
    const cdpOwnerEoa = user?.evmAccountObjects?.[0]?.address;

    if (siwe) {
        return {
            address: siwe.toLowerCase(),
            isBaseAccount: true,
            cdpSmartAccount,
            cdpOwnerEoa,
        };
    }

    // Email/OTP-only session: CDP embedded wallet. Not Base-app parity.
    // Callers must treat this as provisional until siwe:base is linked.
    return {
        address: cdpSmartAccount?.toLowerCase(),
        isBaseAccount: false,
        cdpSmartAccount,
        cdpOwnerEoa,
    };
}
