"use client";

import { useCallback, useMemo } from "react";
import { useAccount, useSignMessage, useSignTypedData } from "wagmi";
import type { WalletSigner } from "@/lib/walletSigner";

/**
 * Default (wagmi) implementation of `WalletSigner`.
 * Phase 1 adds a CDP impl of the same interface behind the connect flag;
 * identity-bearing call sites keep taking `signMessageAsync` / `signTypedDataAsync`.
 *
 * Parent-identity rule: `address` is the connected account the caller binds
 * into `wallet_address`. When CDP multi-account lands, resolve the parent
 * smart account here (`evmSmartAccountObjects[0]`), never a sub.
 */
export function useWalletSigner(): WalletSigner {
    const { address } = useAccount();
    const { signMessageAsync: wagmiSignMessage } = useSignMessage();
    const { signTypedDataAsync: wagmiSignTypedData } = useSignTypedData();

    const signMessageAsync = useCallback(
        async (args: { account: `0x${string}`; message: string }) => {
            return wagmiSignMessage(args);
        },
        [wagmiSignMessage],
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
            return wagmiSignTypedData({
                account: args.account,
                domain: args.domain as Parameters<typeof wagmiSignTypedData>[0]["domain"],
                types: args.types,
                primaryType: args.primaryType,
                message: args.message,
            } as Parameters<typeof wagmiSignTypedData>[0]);
        },
        [wagmiSignTypedData],
    );

    return useMemo(
        () => ({ address, signMessageAsync, signTypedDataAsync }),
        [address, signMessageAsync, signTypedDataAsync],
    );
}
