"use client";

import { useCallback, useMemo } from "react";
import {
    useCurrentUser,
    useSignEvmMessage,
    useSignEvmTypedData,
} from "@coinbase/cdp-hooks";
import type { WalletSigner } from "@/lib/walletSigner";

/**
 * CDP implementation of `WalletSigner` for the Phase 0a spike.
 * Must render under `CdpAuthProvider` (CDPHooksProvider).
 *
 * Identity (SMART_WALLET_PLAN §1.1): `address` is always the parent Smart
 * Account (`evmSmartAccountObjects[0]`). Never the owner EOA, never a sub.
 */
export function useCdpParentSigner(): WalletSigner & {
    ownerEoa: string | undefined;
    isSignedIn: boolean;
} {
    const { currentUser } = useCurrentUser();
    const { signEvmMessage } = useSignEvmMessage();
    const { signEvmTypedData } = useSignEvmTypedData();

    const smart = currentUser?.evmSmartAccountObjects?.[0]?.address;
    const ownerEoa = currentUser?.evmAccountObjects?.[0]?.address;
    const address = smart as `0x${string}` | undefined;

    const signMessageAsync = useCallback(
        async (args: { account: `0x${string}`; message: string }) => {
            // Parent identity only — refuse to sign as a non-parent account.
            if (!address || args.account.toLowerCase() !== address.toLowerCase()) {
                throw new Error("useCdpParentSigner: refusing non-parent account");
            }
            const { signature } = await signEvmMessage({
                evmAccount: address,
                message: args.message,
            });
            return signature as string;
        },
        [address, signEvmMessage],
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
            if (!address || args.account.toLowerCase() !== address.toLowerCase()) {
                throw new Error("useCdpParentSigner: refusing non-parent account");
            }
            const { signature } = await signEvmTypedData({
                evmAccount: address,
                typedData: {
                    domain: {
                        name: args.domain.name,
                        version: args.domain.version,
                        chainId: args.domain.chainId,
                    },
                    types: args.types,
                    primaryType: args.primaryType,
                    message: args.message,
                },
            });
            return signature as string;
        },
        [address, signEvmTypedData],
    );

    return useMemo(
        () => ({
            address,
            ownerEoa: ownerEoa as string | undefined,
            isSignedIn: Boolean(currentUser),
            signMessageAsync,
            signTypedDataAsync,
        }),
        [address, ownerEoa, currentUser, signMessageAsync, signTypedDataAsync],
    );
}
