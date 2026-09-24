"use client";

import { useCallback, useMemo, useRef } from "react";
import { createBaseAccountSDK, type ProviderInterface } from "@base-org/account";
import type { WalletSigner } from "@/lib/walletSigner";

/**
 * Base Account (keys.coinbase.com / Base app) signer — Option A identity.
 * Signs personal_sign and EIP-712 as the user's Base Account via
 * `@base-org/account` (same address the Base app shows).
 *
 * Not the CDP embedded wallet. Parent = Base Account (SMART_WALLET_PLAN §1.1).
 */

let sdkSingleton: ReturnType<typeof createBaseAccountSDK> | null = null;

function baseProvider(): ProviderInterface {
    if (!sdkSingleton) {
        sdkSingleton = createBaseAccountSDK({
            appMetadata: {
                name: "Ludo Base",
                // logoUrl optional
            },
        });
    }
    return sdkSingleton.getProvider();
}

export function useBaseAccountSigner(): WalletSigner & {
    connect: () => Promise<string | undefined>;
    isBaseAccount: true;
} {
    const addressRef = useRef<string | undefined>(undefined);

    const connect = useCallback(async () => {
        const provider = baseProvider();
        const accounts = (await provider.request({
            method: "eth_requestAccounts",
        })) as string[];
        const addr = accounts?.[0]?.toLowerCase();
        addressRef.current = addr;
        return addr;
    }, []);

    const signMessageAsync = useCallback(
        async (args: { account: `0x${string}`; message: string }) => {
            const provider = baseProvider();
            const account = args.account.toLowerCase();
            if (addressRef.current && addressRef.current !== account) {
                throw new Error("useBaseAccountSigner: refusing non-parent account");
            }
            // personal_sign: [message, address]
            const sig = await provider.request({
                method: "personal_sign",
                params: [args.message, args.account],
            });
            return sig as string;
        },
        [],
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
            const provider = baseProvider();
            const account = args.account.toLowerCase();
            if (addressRef.current && addressRef.current !== account) {
                throw new Error("useBaseAccountSigner: refusing non-parent account");
            }
            const payload = {
                domain: args.domain,
                types: {
                    EIP712Domain: [
                        { name: "name", type: "string" },
                        { name: "version", type: "string" },
                        { name: "chainId", type: "uint256" },
                    ],
                    ...args.types,
                },
                primaryType: args.primaryType,
                message: args.message,
            };
            const sig = await provider.request({
                method: "eth_signTypedData_v4",
                params: [args.account, JSON.stringify(payload)],
            });
            return sig as string;
        },
        [],
    );

    return useMemo(
        () => ({
            address: addressRef.current,
            connect,
            isBaseAccount: true as const,
            signMessageAsync,
            signTypedDataAsync,
        }),
        [connect, signMessageAsync, signTypedDataAsync],
    );
}

/** Non-hook helper for one-shot connect + personal_sign (siwe:base manual flow). */
export async function connectBaseAccount(): Promise<{
    address: string;
    provider: ProviderInterface;
}> {
    const provider = baseProvider();
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts[0];
    if (!address) throw new Error("Base Account connect returned no address");
    return { address, provider };
}

export async function baseAccountSignMessage(
    provider: ProviderInterface,
    address: string,
    message: string,
): Promise<string> {
    const sig = await provider.request({
        method: "personal_sign",
        params: [message, address],
    });
    return sig as string;
}
