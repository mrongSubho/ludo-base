"use client";

import { useAccount, useReadContract } from "wagmi";
import {
    CHIPS_ERC20_ABI,
    chipsAddress,
    formatChips,
    isChipsConfigured,
    shortHex,
} from "@/lib/chips";

/** Live CHIPS balance for the connected wallet (B20 / ERC-20 `balanceOf`). */
export function useChipsBalance() {
    const { address, isConnected } = useAccount();
    const token = chipsAddress();
    const enabled = Boolean(address) && Boolean(token);

    const { data, refetch, isFetching, error, dataUpdatedAt } = useReadContract({
        address: token,
        abi: CHIPS_ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        query: {
            enabled,
            refetchInterval: 30_000,
            staleTime: 15_000,
        },
    });

    const balance = typeof data === "bigint" ? data : undefined;

    return {
        address,
        short: shortHex(address),
        token,
        balance,
        human: formatChips(balance),
        configured: isChipsConfigured(),
        isConnected,
        refresh: () => refetch(),
        refreshing: isFetching,
        error: error instanceof Error ? error.message : null,
        updatedAt: dataUpdatedAt,
    };
}

export default useChipsBalance;
