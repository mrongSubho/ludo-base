"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { Hex } from "viem";
import {
    LEGACY_CLAIM_ABI,
    SEASON_CLAIM_ABI,
    formatChips,
    legacyClaimAddress,
    seasonClaimAddress,
} from "@/lib/chips";

export type LegacySnapshotEntry = {
    wallet: string;
    legacyCoins: string;
    amount: string;
    proof: Hex[];
};

export type LegacySnapshot = {
    chainId: number;
    claim: string;
    rate: number;
    root: string;
    publishedAt?: string;
    challengeEndsAt?: string;
    entries: LegacySnapshotEntry[];
};

export type SeasonLeafEntry = {
    wallet: string;
    amount: string;
    proof: Hex[];
};

export type SeasonLeaves = {
    chainId: number;
    claim: string;
    epoch: string;
    root: string;
    entries: SeasonLeafEntry[];
};

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

/** Legacy coins → CHIPS claim from hosted `legacy-snapshot.json`. */
export function useLegacyClaim() {
    const { address } = useAccount();
    const publicClient = usePublicClient();
    const { writeContractAsync, isPending } = useWriteContract();
    const [snapshot, setSnapshot] = useState<LegacySnapshot | null>(null);
    const [entry, setEntry] = useState<LegacySnapshotEntry | null>(null);
    const [claimed, setClaimed] = useState(false);
    const [rootLive, setRootLive] = useState<Hex | null>(null);
    const [status, setStatus] = useState<"idle" | "claiming" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const snap = await fetchJson<LegacySnapshot>("/legacy-snapshot.json");
            if (cancelled || !snap) return;
            setSnapshot(snap);
            if (address) {
                const hit = snap.entries.find(
                    (e) => e.wallet.toLowerCase() === address.toLowerCase(),
                );
                setEntry(hit ?? null);
            } else {
                setEntry(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [address]);

    useEffect(() => {
        const claim = legacyClaimAddress();
        if (!publicClient || !claim || !address) return;
        let cancelled = false;
        (async () => {
            try {
                const [done, root] = await Promise.all([
                    publicClient.readContract({
                        address: claim,
                        abi: LEGACY_CLAIM_ABI,
                        functionName: "claimed",
                        args: [address],
                    }),
                    publicClient.readContract({
                        address: claim,
                        abi: LEGACY_CLAIM_ABI,
                        functionName: "snapshotRoot",
                    }),
                ]);
                if (!cancelled) {
                    setClaimed(Boolean(done));
                    setRootLive(root as Hex);
                }
            } catch {
                /* root not set yet */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [publicClient, address]);

    const claim = useCallback(async () => {
        const contract = legacyClaimAddress();
        if (!contract || !entry || !address) {
            setError("No legacy allocation or wallet");
            setStatus("error");
            return;
        }
        setError(null);
        setStatus("claiming");
        try {
            await writeContractAsync({
                address: contract,
                abi: LEGACY_CLAIM_ABI,
                functionName: "claim",
                args: [BigInt(entry.amount), entry.proof],
            });
            setClaimed(true);
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "claim failed");
            setStatus("error");
        }
    }, [entry, address, writeContractAsync]);

    return {
        snapshot,
        entry,
        claimed,
        rootLive,
        claim,
        claiming: isPending || status === "claiming",
        status,
        error,
        canClaim: Boolean(entry) && !claimed && Boolean(rootLive),
        humanAmount: entry ? formatChips(BigInt(entry.amount)) : "0",
    };
}

/** Season merkle claim from hosted `/season-leaves.json` (epoch file). */
export function useSeasonClaim(epoch: string = "1") {
    const { address } = useAccount();
    const publicClient = usePublicClient();
    const { writeContractAsync, isPending } = useWriteContract();
    const [leaves, setLeaves] = useState<SeasonLeaves | null>(null);
    const [entry, setEntry] = useState<SeasonLeafEntry | null>(null);
    const [claimed, setClaimed] = useState(false);
    const [status, setStatus] = useState<"idle" | "claiming" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const data = await fetchJson<SeasonLeaves>(`/season-leaves-${epoch}.json`);
            if (cancelled) return;
            setLeaves(data);
            if (data && address) {
                const hit = data.entries.find(
                    (e) => e.wallet.toLowerCase() === address.toLowerCase(),
                );
                setEntry(hit ?? null);
            } else {
                setEntry(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [address, epoch]);

    useEffect(() => {
        const contract = seasonClaimAddress();
        if (!publicClient || !contract || !address) return;
        let cancelled = false;
        (async () => {
            try {
                const done = await publicClient.readContract({
                    address: contract,
                    abi: SEASON_CLAIM_ABI,
                    functionName: "claimed",
                    args: [BigInt(epoch), address],
                });
                if (!cancelled) setClaimed(Boolean(done));
            } catch {
                /* epoch not activated */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [publicClient, address, epoch]);

    const claim = useCallback(async () => {
        const contract = seasonClaimAddress();
        if (!contract || !entry || !address) {
            setError("No season allocation");
            setStatus("error");
            return;
        }
        setError(null);
        setStatus("claiming");
        try {
            await writeContractAsync({
                address: contract,
                abi: SEASON_CLAIM_ABI,
                functionName: "claim",
                args: [BigInt(epoch), BigInt(entry.amount), entry.proof],
            });
            setClaimed(true);
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "claim failed");
            setStatus("error");
        }
    }, [entry, address, epoch, writeContractAsync]);

    return {
        leaves,
        entry,
        claimed,
        claim,
        claiming: isPending || status === "claiming",
        status,
        error,
        canClaim: Boolean(entry) && !claimed,
        humanAmount: entry ? formatChips(BigInt(entry.amount)) : "0",
    };
}
