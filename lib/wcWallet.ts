"use client";

/**
 * W5 — Ludo as WalletConnect **wallet** (DUAL_PATH_WALLET_PLAN §5.7).
 * Pair with wc: URI from a third-party dapp; approve session + requests
 * (no auto-approve). Sign via usePlayerSigner (player / CDP smart).
 */

import { WalletKit } from "@reown/walletkit";
import { Core } from "@walletconnect/core";

export const WC_WALLET_METADATA = {
    name: "Ludo Base",
    description: "Ludo Base — The Onchain Arena",
    url: typeof window !== "undefined" ? window.location.origin : "https://ludo-base.vercel.app",
    icons: [typeof window !== "undefined" ? `${window.location.origin}/ludo-base-logo.svg` : ""],
};

/** Base / Base Sepolia only for v1 */
export const WC_ALLOWED_CHAINS = ["eip155:8453", "eip155:84532"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kitPromise: Promise<any> | null = null;

export function getWalletConnectProjectId(): string {
    return process.env.NEXT_PUBLIC_WC_PROJECT_ID || "";
}

/** WalletKit instance (typed loosely — SDK ships mixed ICore versions). */
export async function getWalletKit(): Promise<any> {
    if (!kitPromise) {
        const projectId = getWalletConnectProjectId();
        if (!projectId) {
            throw new Error("NEXT_PUBLIC_WC_PROJECT_ID is not set");
        }
        kitPromise = (async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const core = new (Core as any)({ projectId });
            return WalletKit.init({
                core,
                metadata: WC_WALLET_METADATA,
            });
        })();
    }
    return kitPromise;
}

export type PendingProposal = {
    id: number;
    proposerName: string;
    proposerUrl: string;
    requiredChains: string[];
    optionalChains: string[];
    requiredMethods: string[];
    optionalMethods: string[];
};

export type PendingRequest = {
    id: number;
    topic: string;
    method: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any;
    chainId: string;
    peerName: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function summarizeProposal(proposal: any): PendingProposal {
    const { id, params } = proposal;
    const proposer = params?.proposer?.metadata ?? {};
    const required = params?.requiredNamespaces ?? {};
    const optional = params?.optionalNamespaces ?? {};
    const requiredChains = Object.values(required).flatMap((n: any) => (n as any)?.chains ?? []);
    const optionalChains = Object.values(optional).flatMap((n: any) => (n as any)?.chains ?? []);
    const requiredMethods = Object.values(required).flatMap((n: any) => (n as any)?.methods ?? []);
    const optionalMethods = Object.values(optional).flatMap((n: any) => (n as any)?.methods ?? []);
    return {
        id,
        proposerName: proposer.name || "Unknown dapp",
        proposerUrl: proposer.url || "",
        requiredChains: [...new Set(requiredChains as string[])],
        optionalChains: [...new Set(optionalChains as string[])],
        requiredMethods: [...new Set(requiredMethods as string[])],
        optionalMethods: [...new Set(optionalMethods as string[])],
    };
}

/** Build approve args: only Base chains + our accounts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildApproveSession(proposal: any, accounts: string[]) {
    const { id, params } = proposal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const required = (params?.requiredNamespaces?.eip155 ?? {}) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optional = (params?.optionalNamespaces?.eip155 ?? {}) as any;

    const chainCandidates = [...((required.chains as string[]) ?? []), ...((optional.chains as string[]) ?? [])].filter(
        (c) => WC_ALLOWED_CHAINS.includes(c),
    );
    const chains = chainCandidates.length ? [...new Set(chainCandidates)] : [...WC_ALLOWED_CHAINS];

    const methods = [
        ...((required.methods as string[]) ?? []),
        ...((optional.methods as string[]) ?? []),
        "personal_sign",
        "eth_signTypedData_v4",
    ].filter((m, i, a) => a.indexOf(m) === i);

    const events = [
        ...((required.events as string[]) ?? []),
        ...((optional.events as string[]) ?? []),
        "accountsChanged",
        "chainChanged",
    ].filter((e, i, a) => a.indexOf(e) === i);

    return {
        id,
        namespaces: {
            eip155: {
                chains,
                methods,
                events,
                accounts: chains.flatMap((c: string) => accounts.map((a) => `${c}:${a}`)),
            },
        },
    };
}

export function isAllowedChain(chainId: string | undefined): boolean {
    if (!chainId) return true;
    return WC_ALLOWED_CHAINS.includes(chainId) || WC_ALLOWED_CHAINS.some((c) => chainId.startsWith(c));
}
