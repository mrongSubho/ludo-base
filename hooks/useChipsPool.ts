"use client";

import { useCallback, useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseUnits } from "viem";
import {
    CHIPS_ERC20_ABI,
    MATCH_POOL_ABI,
    chipsAddress,
    isChipsConfigured,
    matchPoolAddress,
} from "@/lib/chips";

/**
 * Paid-pool join: approve CHIPS -> joinPool (EIP-5792 batch preferred later).
 * Builder-code dataSuffix is applied globally in Providers.tsx.
 */
export function usePoolJoin(poolId: `0x${string}` | null | undefined, entryFeeHuman: string) {
    const { address } = useAccount();
    const chips = chipsAddress();
    const pool = matchPoolAddress();
    const configured = isChipsConfigured() && Boolean(poolId);
    const { writeContractAsync, isPending } = useWriteContract();
    const [step, setStep] = useState<"idle" | "approve" | "join" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    const join = useCallback(async () => {
        if (!address || !chips || !pool || !poolId) {
            setError("Wallet or CHIPS pool not configured");
            setStep("error");
            return;
        }
        setError(null);
        try {
            const amount = parseUnits(entryFeeHuman || "0", 18);
            setStep("approve");
            await writeContractAsync({
                address: chips,
                abi: CHIPS_ERC20_ABI,
                functionName: "approve",
                args: [pool, amount],
            });
            setStep("join");
            await writeContractAsync({
                address: pool,
                abi: MATCH_POOL_ABI,
                functionName: "joinPool",
                args: [poolId],
            });
            setStep("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Join failed");
            setStep("error");
        }
    }, [address, chips, pool, poolId, entryFeeHuman, writeContractAsync]);

    return { join, step, isPending, error, configured };
}

/** Post-match prize claim (pull). */
export function usePoolClaim(poolId: `0x${string}` | null | undefined) {
    const { address } = useAccount();
    const pool = matchPoolAddress();
    const configured = isChipsConfigured() && Boolean(poolId);
    const { writeContractAsync, isPending } = useWriteContract();
    const [error, setError] = useState<string | null>(null);

    const { data: claimable, refetch: refetchClaimable } = useReadContract({
        address: pool,
        abi: MATCH_POOL_ABI,
        functionName: "claimable",
        args: address && poolId ? [poolId, address] : undefined,
        query: { enabled: Boolean(address && pool && poolId) },
    });

    const claim = useCallback(async () => {
        if (!pool || !poolId) return;
        setError(null);
        try {
            await writeContractAsync({
                address: pool,
                abi: MATCH_POOL_ABI,
                functionName: "claimMatch",
                args: [poolId],
            });
            void refetchClaimable();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Claim failed");
        }
    }, [pool, poolId, writeContractAsync, refetchClaimable]);

    return { claim, claimable, isPending, error, configured };
}

/** Cancel/timeout refund pull. */
export function usePoolRefund(poolId: `0x${string}` | null | undefined) {
    const pool = matchPoolAddress();
    const configured = isChipsConfigured() && Boolean(poolId);
    const { writeContractAsync, isPending } = useWriteContract();
    const [error, setError] = useState<string | null>(null);
    const refund = useCallback(async () => {
        if (!pool || !poolId) return;
        setError(null);
        try {
            await writeContractAsync({
                address: pool,
                abi: MATCH_POOL_ABI,
                functionName: "refundJoin",
                args: [poolId],
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Refund failed");
        }
    }, [pool, poolId, writeContractAsync]);
    return { refund, isPending, error, configured };
}
