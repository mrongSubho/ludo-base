"use client";

import { useCallback, useMemo, useRef } from "react";
import { createBaseAccountSDK, type ProviderInterface } from "@base-org/account";
import { stringToHex } from "viem";
import type { WalletSigner } from "@/lib/walletSigner";

/**
 * Base Account signer (Option A) — signs as the user's Base Account via
 * `@base-org/account` (same keys as Base app / keys.coinbase.com).
 *
 * Popup branding: `appName` + `appLogoUrl` are shown in the keys.coinbase.com
 * popup on wallet_connect and every later request (sign / approve).
 * `signInWithBase` MUST be called from a click handler with no await first
 * (browsers block popups outside a user gesture).
 */

const APP_NAME = "Ludo Base";

function appLogoUrl(): string | null {
    if (typeof window === "undefined") return null;
    return `${window.location.origin}/ludo-base-logo.svg`;
}

let sdkSingleton: ReturnType<typeof createBaseAccountSDK> | null = null;

function getProvider(): ProviderInterface {
    if (!sdkSingleton) {
        sdkSingleton = createBaseAccountSDK({
            appName: APP_NAME,
            appLogoUrl: appLogoUrl(),
        });
    }
    return sdkSingleton.getProvider();
}

/** Prefetch SIWE nonce on load so the click handler can open the popup immediately. */
let prefetchedNonce: string | null = null;
export function prefetchSiweNonce(): void {
    if (prefetchedNonce || typeof window === "undefined") return;
    prefetchedNonce = window.crypto.randomUUID().replace(/-/g, "");
}
function takeNonce(): string {
    if (!prefetchedNonce) {
        prefetchedNonce =
            typeof window !== "undefined"
                ? window.crypto.randomUUID().replace(/-/g, "")
                : Math.random().toString(36).slice(2);
    }
    const n = prefetchedNonce;
    prefetchedNonce = null;
    // Warm the next one for the next connect
    prefetchSiweNonce();
    return n;
}

export type BaseConnectResult = {
    address: `0x${string}`;
    /** Base wallet_connect SIWE (EIP-4361 from keys.coinbase.com). */
    siwe: { message: string; signature: string } | null;
};

/**
 * Sign in with Base — `wallet_connect` + signInWithEthereum.
 * Opens keys.coinbase.com immediately (call from onClick, no await first).
 * Popup shows APP_NAME + logo.
 */
export async function signInWithBase(): Promise<BaseConnectResult> {
    const provider = getProvider();
    const nonce = takeNonce();
    const raw = (await provider.request({
        method: "wallet_connect",
        params: [
            {
                version: "1",
                capabilities: {
                    signInWithEthereum: {
                        nonce,
                        chainId: "0x2105", // Base mainnet
                    },
                },
            },
        ],
    })) as {
        accounts?: Array<{
            address?: string;
            capabilities?: {
                signInWithEthereum?: { message?: string; signature?: string };
            };
        }>;
    };
    const account = raw?.accounts?.[0];
    const address = account?.address as `0x${string}` | undefined;
    if (!address) throw new Error("wallet_connect returned no address");
    const siweCap = account?.capabilities?.signInWithEthereum;
    return {
        address,
        siwe: siweCap?.signature && siweCap.message
            ? { message: siweCap.message, signature: siweCap.signature }
            : null,
    };
}

/** Fallback connect without SIWE capability (still branded popup). */
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
    signInWithBase: () => Promise<BaseConnectResult>;
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

    const signIn = useCallback(async () => {
        const result = await signInWithBase();
        addressRef.current = result.address;
        connectedRef.current = true;
        return result;
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
            const messageHex = stringToHex(args.message);
            const signature = (await provider.request({
                method: "personal_sign",
                params: [messageHex, args.account],
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
            signInWithBase: signIn,
            signMessageAsync,
            signTypedDataAsync,
        }),
        [connect, signIn, signMessageAsync, signTypedDataAsync],
    );
}
