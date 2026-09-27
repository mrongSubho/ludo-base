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

/** Methods we never advertise or execute (wallet-drain / chain hijack). */
export const WC_DENIED_METHODS = new Set([
    "eth_sign",
    "eth_signTransaction",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "wallet_watchAsset",
    "wallet_registerOnboarding",
    "wallet_scanQRCode",
]);

/** Methods we may approve in a session (scoped by mode; extras filtered at request time). */
export const WC_BASE_METHODS = [
    "personal_sign",
    "eth_signTypedData_v4",
    "eth_signTypedData",
    "eth_sendTransaction",
    "wallet_sendCalls",
    "eth_accounts",
    "eth_chainId",
    "eth_getBalance",
    "eth_call",
    "eth_getCode",
    "eth_getTransactionReceipt",
    "eth_getTransactionByHash",
];

/** Build approve args: Base chains only; methods intersection + allowlist; no denied methods. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildApproveSession(proposal: any, accounts: string[], mode: "external" | "ingame" = "external") {
    const { id, params } = proposal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const required = (params?.requiredNamespaces?.eip155 ?? {}) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optional = (params?.optionalNamespaces?.eip155 ?? {}) as any;

    const chainCandidates = [
        ...(((required.chains as string[]) ?? [])),
        ...(((optional.chains as string[]) ?? [])),
    ].filter((c) => WC_ALLOWED_CHAINS.includes(c));
    const chains = chainCandidates.length ? [...new Set(chainCandidates)] : [...WC_ALLOWED_CHAINS];

    const requested = [
        ...(((required.methods as string[]) ?? [])),
        ...(((optional.methods as string[]) ?? [])),
    ];
    // Never grant more than we implement; never grant denied methods.
    const modeExtra = mode === "ingame" ? ["wallet_sendCalls"] : ["eth_sendTransaction", "wallet_sendCalls"];
    const methods = [...new Set([...WC_BASE_METHODS, ...modeExtra])]
        .filter((m) => (requested.length ? requested.includes(m) || WC_BASE_METHODS.includes(m) : true))
        .filter((m) => !WC_DENIED_METHODS.has(m));

    const events = [
        ...(((required.events as string[]) ?? [])),
        ...(((optional.events as string[]) ?? [])),
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

/** Fail closed: missing/unknown chain is never allowed. */
export function isAllowedChain(chainId: string | undefined): boolean {
    if (!chainId || typeof chainId !== "string") return false;
    return WC_ALLOWED_CHAINS.includes(chainId) || WC_ALLOWED_CHAINS.some((c) => chainId.startsWith(`${c}:`));
}

/**
 * personal_sign params vary: [message, address] or [address, message].
 * Detect address-shaped first arg and swap.
 */
export function parsePersonalSignParams(params: unknown): { message: string; account?: string } {
    const arr = Array.isArray(params) ? params : [];
    const a = arr[0] != null ? String(arr[0]) : "";
    const b = arr[1] != null ? String(arr[1]) : "";
    const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
    if (isAddr(a) && !isAddr(b)) return { account: a, message: b };
    return { message: a, account: isAddr(b) ? b : undefined };
}

/** Decode hex or utf8 personal_sign payload to a display string. */
export function decodeSignMessage(messageArg: string): string {
    if (!messageArg.startsWith("0x")) return messageArg;
    try {
        const hex = messageArg.slice(2);
        if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return messageArg;
        const bytes = hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16));
        return new TextDecoder().decode(Uint8Array.from(bytes));
    } catch {
        return messageArg;
    }
}

/** ERC-20 approve / increaseAllowance selector risk (drain pattern). */
export function isUnlimitedOrHighRiskCalldata(data: string | undefined): {
    unlimitedApprove: boolean;
    selector?: string;
} {
    if (!data || data === "0x" || data.length < 10) return { unlimitedApprove: false };
    const selector = data.slice(0, 10).toLowerCase();
    // approve(address,uint256) = 0x095ea7b3
    if (selector === "0x095ea7b3") {
        const amountHex = data.slice(10 + 64, 10 + 128);
        const unlimited =
            !amountHex ||
            /^0{48}f{16}$/i.test(amountHex) ||
            BigInt(`0x${amountHex}`) > BigInt("1000000") * BigInt(10) ** BigInt(18);
        return { unlimitedApprove: unlimited, selector };
    }
    return { unlimitedApprove: false, selector };
}
