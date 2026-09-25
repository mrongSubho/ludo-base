"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    useAccount,
    usePublicClient,
    useReadContract,
    useSendCalls,
    useWriteContract,
} from "wagmi";
import { encodeFunctionData, formatUnits, parseUnits, type Address, type Hex } from "viem";
import {
    CHIPS_ERC20_ABI,
    CLAIM_HUB_ABI,
    MATCH_POOL_ABI,
    claimHubAddress,
    chipsAddress,
    isChipsConfigured,
    matchPoolAddress,
} from "@/lib/chips";

function useClaimClock(claimUnlockAt: bigint | undefined) {
    const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
    useEffect(() => {
        const t = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
        return () => clearInterval(t);
    }, []);
    const unlock = claimUnlockAt ?? BigInt(0);
    const secondsLeft = unlock > now ? Number(unlock - now) : 0;
    const ready = claimUnlockAt != null && secondsLeft === 0;
    return { secondsLeft, ready, mmss: formatMmSs(secondsLeft) };
}

function formatMmSs(s: number) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Paid-pool join: EIP-5792 batch approve+join when available, else two txs.
 * Builder-code dataSuffix is applied globally in Providers.tsx.
 */
export function usePoolJoin(poolId: `0x${string}` | null | undefined, entryFeeHuman: string) {
    const { address } = useAccount();
    const chips = chipsAddress();
    const pool = matchPoolAddress();
    const configured = isChipsConfigured() && Boolean(poolId);
    const { writeContractAsync, isPending } = useWriteContract();
    const { sendCallsAsync, isPending: batchPending } = useSendCalls();
    const [step, setStep] = useState<"idle" | "approve" | "join" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);
    const [batched, setBatched] = useState(false);

    const join = useCallback(async () => {
        if (!address || !chips || !pool || !poolId) {
            setError("Wallet or CHIPS pool not configured");
            setStep("error");
            return;
        }
        setError(null);
        try {
            const amount = parseUnits(entryFeeHuman || "0", 18);
            const approveData = encodeFunctionData({
                abi: CHIPS_ERC20_ABI,
                functionName: "approve",
                args: [pool, amount],
            });
            const joinData = encodeFunctionData({
                abi: MATCH_POOL_ABI,
                functionName: "joinPool",
                args: [poolId],
            });

            // Primary: one EIP-5792 batch (smart wallets / capable EOAs).
            try {
                setStep("approve");
                await sendCallsAsync({
                    calls: [
                        { to: chips, data: approveData },
                        { to: pool, data: joinData },
                    ],
                });
                setBatched(true);
                setStep("done");
                return;
            } catch {
                setBatched(false);
            }

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
    }, [address, chips, pool, poolId, entryFeeHuman, writeContractAsync, sendCallsAsync]);

    return { join, step, isPending: isPending || batchPending, error, configured, batched };
}

/** Post-match prize claim (pull) with dispute countdown + gas/net. */
export function usePoolClaim(poolId: `0x${string}` | null | undefined) {
    const { address } = useAccount();
    const pool = matchPoolAddress();
    const client = usePublicClient();
    const configured = isChipsConfigured() && Boolean(poolId);
    const { writeContractAsync, isPending } = useWriteContract();
    const [error, setError] = useState<string | null>(null);
    const [gasEst, setGasEst] = useState<bigint | null>(null);

    const { data: claimable, refetch: refetchClaimable } = useReadContract({
        address: pool,
        abi: MATCH_POOL_ABI,
        functionName: "claimable",
        args: address && poolId ? [poolId, address] : undefined,
        query: { enabled: Boolean(address && pool && poolId) },
    });

    const { data: summary } = useReadContract({
        address: pool,
        abi: MATCH_POOL_ABI,
        functionName: "getPoolSummary",
        args: poolId ? [poolId] : undefined,
        query: { enabled: Boolean(pool && poolId) },
    });

    const claimUnlockAt = useMemo(() => {
        if (!summary) return undefined;
        // getPoolSummary: [status,maxSeats,filled,auth,entry,gross,prize,bond,settleBy,claimUnlockAt]
        const arr = summary as unknown as readonly unknown[];
        return arr[9] as bigint | undefined;
    }, [summary]);

    const { secondsLeft, ready, mmss } = useClaimClock(claimUnlockAt);

    // Gas estimate for claim (net = claimable - gas*price, display only).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!client || !pool || !poolId || !address || !ready) {
                setGasEst(null);
                return;
            }
            try {
                const gas = await client.estimateContractGas({
                    address: pool,
                    abi: MATCH_POOL_ABI,
                    functionName: "claimMatch",
                    args: [poolId],
                    account: address,
                });
                if (!cancelled) setGasEst(gas);
            } catch {
                if (!cancelled) setGasEst(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [client, pool, poolId, address, ready]);

    const gasCostWei = useMemo(() => {
        if (gasEst == null) return null;
        // ~ Base Sepolia fee display: gas * 0.01 gwei placeholder if no client fee
        return gasEst * BigInt(10_000_000); // 0.01 gwei * gas (display-only floor)
    }, [gasEst]);

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

    return {
        claim,
        claimable,
        isPending,
        error,
        configured,
        claimUnlockAt,
        secondsLeft,
        ready,
        mmss,
        gasEst,
        gasCostWei,
        gasEth: gasCostWei != null ? formatUnits(gasCostWei, 18) : null,
    };
}

/** Paginated claimAll via ClaimHub (MAX_CLAIM_REFS=25). */
export function useClaimAll() {
    const { address } = useAccount();
    const hub = claimHubAddress();
    const configured = isChipsConfigured() && Boolean(hub);
    const { writeContractAsync, isPending } = useWriteContract();
    const [error, setError] = useState<string | null>(null);

    const claimMany = useCallback(
        async (poolIds: Hex[]) => {
            if (!hub || !poolIds.length) return;
            setError(null);
            try {
                // Chunk to MAX_CLAIM_REFS
                const chunkSize = 25;
                for (let i = 0; i < poolIds.length; i += chunkSize) {
                    const chunk = poolIds.slice(i, i + chunkSize);
                    await writeContractAsync({
                        address: hub,
                        abi: CLAIM_HUB_ABI,
                        functionName: "claimMany",
                        args: [chunk],
                    });
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : "claimAll failed");
            }
        },
        [hub, writeContractAsync],
    );

    return { claimMany, isPending, error, configured, address };
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

/** Display helper: CHIPS wei -> human string. */
export function formatChipsWei(v: bigint | undefined | null) {
    if (v == null) return "—";
    return formatUnits(v, 18);
}

export type { Address };
