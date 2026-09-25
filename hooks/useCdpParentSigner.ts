"use client";

import { useCallback, useMemo } from "react";
import {
    useCurrentUser,
    useSignEvmMessage,
    useSignEvmTypedData,
} from "@coinbase/cdp-hooks";
import { toViemAccount } from "@coinbase/cdp-core";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { createPublicClient, http, type Address, type TypedDataDefinition } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { WalletSigner } from "@/lib/walletSigner";

/**
 * CDP parent-signer (Phase 0a). Identity = parent Smart Account (§1.1).
 *
 * Spike findings (2026-09-24):
 * 1. `signEvmMessage` / `signEvmTypedData` reject the smart address
 *    ("EVM account not found") — `evmAccount` must be an EOA.
 * 2. A raw owner-EOA personal_sign claimed as the smart account 401s
 *    `signer-mismatch` — counterfactual CBSW needs an ERC-6492 wrap.
 *
 * Path: `toCoinbaseSmartAccount` (viem, same as scripts/siwe-matrix.ts case c)
 * signs a replay-safe typed hash as the owner EOA via CDP, wraps as
 * SignatureWrapper, then 6492 (factory createAccount). Server
 * `lib/walletVerify.ts` accepts that via the universal validator.
 */
function chainFor(chainId: number) {
    return chainId === base.id ? base : baseSepolia;
}

async function parentSmartAccount(params: {
    parent: Address;
    ownerEoa: Address;
    chainId: number;
}) {
    const chain = chainFor(params.chainId);
    const client = createPublicClient({ chain, transport: http() });
    const owner = toViemAccount(params.ownerEoa);
    // CDP factory = 0xba5ed110… → viem `version: "1.1"` (NOT "1").
    // Pin the CDP-issued parent address; do not trust local derivation alone.
    return toCoinbaseSmartAccount({
        client,
        owners: [owner],
        version: "1.1",
        address: params.parent,
    });
}

export function useCdpParentSigner(defaultChainId = 84532): WalletSigner & {
    ownerEoa: string | undefined;
    signWithEoa: string | undefined;
    isSignedIn: boolean;
} {
    const { currentUser } = useCurrentUser();
    // Fallback signers are created in the helper below.

    const smart = currentUser?.evmSmartAccountObjects?.[0]?.address as Address | undefined;
    const ownerEoa = currentUser?.evmAccountObjects?.[0]?.address as Address | undefined;
    const address = smart as `0x${string}` | undefined;
    const signWithEoa = ownerEoa as `0x${string}` | undefined;

    const signMessageAsync = useCallback(
        async (args: { account: `0x${string}`; message: string }) => {
            if (!address || !ownerEoa) throw new Error("useCdpParentSigner: no parent/owner");
            if (args.account.toLowerCase() !== address.toLowerCase()) {
                throw new Error("useCdpParentSigner: refusing non-parent account");
            }
            const account = await parentSmartAccount({
                parent: address as Address,
                ownerEoa,
                chainId: defaultChainId,
            });
            const signature = await account.signMessage({ message: args.message });
            return signature as string;
        },
        [address, ownerEoa, defaultChainId],
    );

    const signTypedDataAsync = useCallback(
        async (args: {
            account: `0x${string}`;
            domain: { name: string; version: string; chainId: number };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            types: any;
            primaryType: string;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: any;
        }) => {
            if (!address || !ownerEoa) throw new Error("useCdpParentSigner: no parent/owner");
            if (args.account.toLowerCase() !== address.toLowerCase()) {
                throw new Error("useCdpParentSigner: refusing non-parent account");
            }
            const account = await parentSmartAccount({
                parent: address as Address,
                ownerEoa,
                chainId: args.domain.chainId || defaultChainId,
            });
            const signature = await account.signTypedData({
                domain: args.domain,
                types: args.types,
                primaryType: args.primaryType,
                message: args.message,
            } as TypedDataDefinition);
            return signature as string;
        },
        [address, ownerEoa, defaultChainId],
    );

    return useMemo(
        () => ({
            address,
            ownerEoa: ownerEoa as string | undefined,
            signWithEoa: signWithEoa as string | undefined,
            isSignedIn: Boolean(currentUser),
            signMessageAsync,
            signTypedDataAsync,
        }),
        [address, ownerEoa, signWithEoa, currentUser, signMessageAsync, signTypedDataAsync],
    );
}

/** Exposed for spike diagnostics if the wrap path needs a raw owner fallback. */
export function useCdpRawOwnerSigners() {
    const { signEvmMessage } = useSignEvmMessage();
    const { signEvmTypedData } = useSignEvmTypedData();
    return { signEvmMessage, signEvmTypedData };
}
