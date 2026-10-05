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
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";

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
    const { address: wagmiAddress } = useAccount();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const address = player.address ?? wagmiAddress;
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

            // In-game CDP: one UserOp batch + dataSuffix (W4).
            if (player.mode === "ingame" && cdpUserOp.isInGame) {
                setStep("approve");
                await cdpUserOp.sendCalls([
                    { to: chips, data: approveData },
                    { to: pool, data: joinData },
                ]);
                setBatched(true);
                setStep("done");
                return;
            }

            // External: EIP-5792 batch when available, else two txs.
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
    }, [address, chips, pool, poolId, entryFeeHuman, writeContractAsync, sendCallsAsync, player.mode, cdpUserOp]);

    return { join, step, isPending: isPending || batchPending, error, configured, batched };
}

/**
 * On-chain pool facts, read straight from MatchPool.
 *
 * ECO-02: the settlement UI used to *guess* the prize fund as
 * `wager * seats * 0.93` in IEEE-754 doubles and then `BigInt(...)`-ed the
 * result. At CHIPS scale that double is already quantised to ~256 wei, so the
 * reconstructed amount never matched the contract and `settlePool` reverted
 * SumMismatch. The fund must come from the chain.
 */
export interface PoolSummaryView {
    status: number;
    maxSeats: number;
    filledSeats: number;
    authority: `0x${string}` | undefined;
    entryFee: bigint;
    gross: bigint;
    /** Authoritative. Use this for any payout plan; never re-derive it. */
    prizeFund: bigint;
    hostBond: bigint;
    settleBy: bigint;
    claimUnlockAt: bigint | undefined;
}

export function usePoolSummary(poolId: `0x${string}` | null | undefined) {
    const pool = matchPoolAddress();
    const { data } = useReadContract({
        address: pool,
        abi: MATCH_POOL_ABI,
        functionName: "getPoolSummary",
        args: poolId ? [poolId] : undefined,
        query: { enabled: Boolean(pool && poolId) },
    });

    return useMemo<PoolSummaryView | null>(() => {
        if (!data) return null;
        // getPoolSummary: [status,maxSeats,filled,auth,entry,gross,prize,bond,settleBy,claimUnlockAt]
        const a = data as unknown as readonly unknown[];
        return {
            status: Number(a[0] ?? 0),
            maxSeats: Number(a[1] ?? 0),
            filledSeats: Number(a[2] ?? 0),
            authority: a[3] as `0x${string}` | undefined,
            entryFee: (a[4] as bigint) ?? BigInt(0),
            gross: (a[5] as bigint) ?? BigInt(0),
            prizeFund: (a[6] as bigint) ?? BigInt(0),
            hostBond: (a[7] as bigint) ?? BigInt(0),
            settleBy: (a[8] as bigint) ?? BigInt(0),
            claimUnlockAt: a[9] as bigint | undefined,
        };
    }, [data]);
}

/** Post-match prize claim (pull) with dispute countdown + gas/net. */
export function usePoolClaim(poolId: `0x${string}` | null | undefined) {
    const { address: wagmiAddress } = useAccount();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const address = player.address ?? wagmiAddress;
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
        args: address && poolId ? [poolId, address as `0x${string}`] : undefined,
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
                    account: address as `0x${string}`,
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
            const claimData = encodeFunctionData({
                abi: MATCH_POOL_ABI,
                functionName: "claimMatch",
                args: [poolId],
            });
            if (player.mode === "ingame" && cdpUserOp.isInGame) {
                await cdpUserOp.sendCalls([{ to: pool, data: claimData }]);
            } else {
                await writeContractAsync({
                    address: pool,
                    abi: MATCH_POOL_ABI,
                    functionName: "claimMatch",
                    args: [poolId],
                });
            }
            void refetchClaimable();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Claim failed");
        }
    }, [pool, poolId, writeContractAsync, refetchClaimable, player.mode, cdpUserOp]);

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
