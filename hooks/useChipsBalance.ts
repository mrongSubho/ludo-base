"use client";

import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import {
    CHIPS_ERC20_ABI,
    chipsAddress,
    formatChips,
    isChipsConfigured,
    shortHex,
} from "@/lib/chips";

/** CHIPS B20 lives on Base Sepolia — pin reads even if the wallet is on mainnet. */
const CHIPS_CHAIN_ID = baseSepolia.id;

export function useChipsBalance() {
    const { address, isConnected, chainId } = useAccount();
    const token = chipsAddress();
    const enabled = Boolean(address) && Boolean(token);
    const chainMismatch = isConnected && chainId != null && chainId !== CHIPS_CHAIN_ID;
    const { switchChain, isPending: switching } = useSwitchChain();

    const { data, refetch, isFetching, error, dataUpdatedAt } = useReadContract({
        address: token,
        abi: CHIPS_ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        chainId: CHIPS_CHAIN_ID,
        query: {
            enabled,
            refetchInterval: 30_000,
            staleTime: 15_000,
            retry: 1,
        },
    });

    const balance = typeof data === "bigint" ? data : undefined;

    let friendlyError: string | null = null;
    if (error) {
        const raw = error instanceof Error ? error.message : String(error);
        friendlyError = raw.includes("reverted")
            ? "balanceOf call failed on-chain (check network / token)"
            : raw.slice(0, 160);
    }

    return {
        address,
        short: shortHex(address),
        token,
        balance,
        human: balance != null ? formatChips(balance) : isConnected ? "—" : "0",
        configured: isChipsConfigured(),
        isConnected,
        chainId,
        chipsChainId: CHIPS_CHAIN_ID,
        chainMismatch,
        switchToChipsChain: () => switchChain({ chainId: CHIPS_CHAIN_ID }),
        switching,
        refresh: () => refetch(),
        refreshing: isFetching,
        error: friendlyError,
        updatedAt: dataUpdatedAt,
    };
}

export default useChipsBalance;
