"use client";

/**
 * Live wallet network label for UI (SMART_WALLET_PLANNING §5).
 * Phase 1 default is **Base Sepolia** (84532); mainnet is 8453.
 */

import { useChainId } from "wagmi";
import { parseChainId } from "@/lib/chains";

export type NetworkLabel = {
    chainId: number;
    /** Chip text: "Base Sepolia" | "Base Mainnet" | "Unknown" */
    label: string;
    /** Longer copy */
    long: string;
    isTestnet: boolean;
};

export function useNetworkLabel(): NetworkLabel {
    const raw = useChainId();
    const chainId = parseChainId(raw) ?? raw;

    if (chainId === 84532) {
        return { chainId: 84532, label: "Base Sepolia", long: "Base Sepolia testnet", isTestnet: true };
    }
    if (chainId === 8453) {
        return { chainId: 8453, label: "Base Mainnet", long: "Base mainnet", isTestnet: false };
    }
    return {
        chainId: typeof chainId === "number" ? chainId : 0,
        label: "Unknown",
        long: `Unknown network (${String(raw)})`,
        isTestnet: false,
    };
}
