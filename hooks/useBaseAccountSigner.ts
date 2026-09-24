"use client";

import { useCallback, useMemo, useRef } from "react";
import { createBaseAccountSDK, type ProviderInterface } from "@base-org/account";
import type { WalletSigner } from "@/lib/walletSigner";

/**
 * Base Account signer (Option A) — signs as the user's Base Account via
 * `@base-org/account` (same keys as Base app / keys.coinbase.com).
 * Call `connect()` before signing; identity is the connected Base Account.
 */

let sdkSingleton: ReturnType<typeof createBaseAccountSDK> | null = null;

function getProvider(): ProviderInterface {
    if (!sdkSingleton) {
        sdkSingleton = createBaseAccountSDK({
            appName: "Ludo Base",
            appLogoUrl:
                typeof window !== "undefined"
                    ? `${window.location.origin}/favicon.ico`
                    : null,
        });
    }
    return sdkSingleton.getProvider();
}

/** Connect (or resume) the Base Account. Returns the Base Account address. */
export async function connectBaseAccount(): Promise<`0x${string}`> {
    const provider = getProvider();
    const accounts = (await provider.request({
        method: "eth_requestAccounts",
    })) as string[];
    const address = accounts?.[0];
    if (!address) throw new Error("Base Account connect returned no address");
    return address as `0x${string}`;
}

export function useBaseAccountSigner(): WalletSigner & {
    connect: () => Promise<`0x${string}`>;
    connected: boolean;
} {
    const addressRef = useRef<`0x${string}` | undefined>(undefined);
    const connectedRef = useRef(false);

    const connect = useCallback(async () => {
        const addr = await connectBaseAccount();
        addressRef.current = addr;
        connectedRef.current = true;
        return addr;
    }, []);

    const signMessageAsync = useCallback(
        async (args: { account: `0x${string}`; message: string }) => {
            const provider = getProvider();
            if (!addressRef.current) {
                throw new Error("useBaseAccountSigner: call connect() first");
            }
            if (args.account.toLowerCase() !== addressRef.current.toLowerCase()) {
                throw new Error("useBaseAccountSigner: refusing non-parent account");
            }
            const signature = (await provider.request({
                method: "personal_sign",
                params: [args.message, args.account],
            })) as string;
            return signature;
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
            const provider = getProvider();
            if (!addressRef.current) {
                throw new Error("useBaseAccountSigner: call connect() first");
            }
            if (args.account.toLowerCase() !== addressRef.current.toLowerCase()) {
                throw new Error("useBaseAccountSigner: refusing non-parent account");
            }
            const payload = {
                types: {
                    EIP712Domain: [
                        { name: "name", type: "string" },
                        { name: "version", type: "string" },
                        { name: "chainId", type: "uint256" },
                    ],
                    ...args.types,
                },
                primaryType: args.primaryType,
                domain: args.domain,
                message: args.message,
            };
            const signature = (await provider.request({
                method: "eth_signTypedData_v4",
                params: [args.account, JSON.stringify(payload)],
            })) as string;
            return signature;
        },
        [],
    );

    return useMemo(
        () => ({
            address: addressRef.current,
            connected: connectedRef.current,
            connect,
            signMessageAsync,
            signTypedDataAsync,
        }),
        [connect, signMessageAsync, signTypedDataAsync],
    );
}
