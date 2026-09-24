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
 *
 * Spike finding (2026-09-24): `signEvmMessage` / `signEvmTypedData` reject the
 * smart-account address with "EVM account not found" — `evmAccount` must be an
 * EOA from `evmAccountObjects`. We therefore **sign with the owner EOA** and
 * claim the **parent Smart Account** as the player id. Server verification
 * (`lib/walletVerify.ts`) must accept the owner signature via ERC-1271/6492
 * against the smart account (owner `isValidSignature`). If that verify fails,
 * the spike must wrap for 6492 — do not switch identity to the EOA.
 */
export function useCdpParentSigner(): WalletSigner & {
    ownerEoa: string | undefined;
    signWithEoa: string | undefined;
    isSignedIn: boolean;
} {
    const { currentUser } = useCurrentUser();
    const { signEvmMessage } = useSignEvmMessage();
    const { signEvmTypedData } = useSignEvmTypedData();

    const smart = currentUser?.evmSmartAccountObjects?.[0]?.address;
    const ownerEoa = currentUser?.evmAccountObjects?.[0]?.address;
    const address = smart as `0x${string}` | undefined;
    /** CDP can only sign as this EOA; identity remains `address` (smart). */
    const signWithEoa = (ownerEoa ?? smart) as `0x${string}` | undefined;

    const signMessageAsync = useCallback(
        async (args: { account: `0x${string}`; message: string }) => {
            if (!address || args.account.toLowerCase() !== address.toLowerCase()) {
                throw new Error("useCdpParentSigner: refusing non-parent account");
            }
            if (!signWithEoa) throw new Error("useCdpParentSigner: no EOA signer");
            const { signature } = await signEvmMessage({
                evmAccount: signWithEoa,
                message: args.message,
            });
            return signature as string;
        },
        [address, signWithEoa, signEvmMessage],
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
            if (!signWithEoa) throw new Error("useCdpParentSigner: no EOA signer");
            const { signature } = await signEvmTypedData({
                evmAccount: signWithEoa,
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
        [address, signWithEoa, signEvmTypedData],
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
