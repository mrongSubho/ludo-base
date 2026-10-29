"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, useWriteContract, useSwitchChain } from "wagmi";
import type { Hex } from "viem";
import { encodeFunctionData } from "viem";
import { missionSystemAddress, MISSION_SYSTEM_ABI } from "@/lib/missionSystem";
import { useAppSession } from "@/hooks/useAppSession";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import { showTxPrompt, updateAuthPromptStatus } from "@/hooks/useAuthPrompt";
import { parseChainId } from "@/lib/chains";
import { formatWeb3Error } from "@/lib/web3Error";

export interface UnsyncedMatchItem {
    match_id: string;
    player_id: string;
    won: boolean;
    is_pvp: boolean;
    captures: number;
    played_at: string;
}

export function useUnsyncedMatches(targetWallet?: string | null) {
    const { address: wagmiAddress } = useAccount();
    const { address: currentUserAddress } = useCurrentUser();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const address = targetWallet ?? player.address ?? wagmiAddress ?? currentUserAddress;
    const chainIdRaw = useChainId();
    const { switchChainAsync } = useSwitchChain();
    const { writeContractAsync } = useWriteContract();
    const { ensureAppSession } = useAppSession();

    const [matches, setMatches] = useState<UnsyncedMatchItem[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchUnsynced = useCallback(async () => {
        if (!address) {
            setMatches([]);
            setTotalCount(0);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const sessionId = await ensureAppSession({ context: 'missions' });
            if (!sessionId) {
                setMatches([]);
                setTotalCount(0);
                return;
            }
            const chainId = parseChainId(chainIdRaw) ?? 84532;
            const res = await fetch(
                `/api/matches/unsynced?walletAddress=${encodeURIComponent(address)}&chainId=${chainId}`,
                {
                    headers: {
                        Authorization: `Bearer ${sessionId}`,
                        'x-session-id': sessionId,
                    },
                },
            );
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData?.error || "Failed to fetch unsynced matches");
            }
            const data = await res.json();
            const fetchedMatches = data?.matches ?? [];
            setMatches(fetchedMatches);
            const total = typeof data?.totalCount === 'number' ? data.totalCount : fetchedMatches.length;
            setTotalCount(total);
        } catch (err: unknown) {
            console.error("[useUnsyncedMatches] fetch error:", err);
            setError(formatWeb3Error(err));
        } finally {
            setIsLoading(false);
        }
    }, [address, chainIdRaw, ensureAppSession]);

    useEffect(() => {
        void fetchUnsynced();
    }, [fetchUnsynced]);

    useEffect(() => {
        const handleUpdate = () => {
            void fetchUnsynced();
        };
        window.addEventListener("mission-update", handleUpdate);
        return () => window.removeEventListener("mission-update", handleUpdate);
    }, [fetchUnsynced]);

    const syncOnChain = useCallback(async () => {
        const sysAddr = missionSystemAddress();
        if (!address || !sysAddr) {
            const msg = "Wallet or MissionSystem contract not configured";
            setError(msg);
            return null;
        }
        setIsSyncing(true);
        setError(null);
        let hidePrompt: (() => void) | undefined;
        try {
            const sessionId = await ensureAppSession({ context: 'missions' });
            if (!sessionId) {
                throw new Error("Sign in to sync matches");
            }
            const chainId = parseChainId(chainIdRaw) ?? 84532;
            const res = await fetch(
                `/api/matches/unsynced?walletAddress=${encodeURIComponent(address)}&chainId=${chainId}`,
                {
                    headers: {
                        Authorization: `Bearer ${sessionId}`,
                        'x-session-id': sessionId,
                    },
                },
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to prepare match sync");

            const { attestations, signatures, matches: pendingMatches } = data;
            if (!attestations || attestations.length === 0) {
                await fetchUnsynced();
                return null;
            }

            hidePrompt = showTxPrompt({
                context: "sync-matches",
                title: "SYNC MATCHES ON-CHAIN",
                statusText: `Please approve the batch transaction in your wallet to record ${attestations.length} match${attestations.length === 1 ? '' : 'es'} onto the blockchain.`,
            });

            const syncArgs = [
                attestations.map((a: {
                    matchId: Hex;
                    player: `0x${string}`;
                    won: number;
                    isPvp: number;
                    captures: number;
                    playedAt: number;
                    deadline: number;
                }) => ({
                    matchId: a.matchId,
                    player: a.player,
                    won: a.won,
                    isPvp: a.isPvp,
                    captures: a.captures,
                    playedAt: BigInt(a.playedAt),
                    deadline: BigInt(a.deadline),
                })),
                signatures as Hex[],
            ] as const;

            let tx: string | undefined;
            if (player.mode === "ingame" && cdpUserOp.isInGame) {
                const callData = encodeFunctionData({
                    abi: MISSION_SYSTEM_ABI,
                    functionName: "syncFreeMatches",
                    args: syncArgs,
                });
                const res = await cdpUserOp.sendCalls([{ to: sysAddr, data: callData }]);
                tx = res?.userOperationHash ?? "cdp-userop-submitted";
            } else {
                if (chainIdRaw && chainIdRaw !== 84532) {
                    try {
                        await switchChainAsync({ chainId: 84532 });
                    } catch (err) {
                        console.warn("[useUnsyncedMatches] Network switch failed:", err);
                    }
                }
                tx = await writeContractAsync({
                    address: sysAddr,
                    abi: MISSION_SYSTEM_ABI,
                    functionName: "syncFreeMatches",
                    args: syncArgs,
                });
            }

            updateAuthPromptStatus("Batch submitted! Verifying matches on-chain...", "Confirming On-Chain");

            // Confirm synced batch with DB
            const matchIds = pendingMatches.map((m: { match_id: string }) => m.match_id);
            await fetch("/api/matches/sync-confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    walletAddress: address,
                    sessionId,
                    matchIds,
                    txHash: tx,
                }),
            }).catch((err) => console.error("sync-confirm network error:", err));

            await fetchUnsynced();
            window.dispatchEvent(new CustomEvent("mission-update"));
            window.dispatchEvent(new CustomEvent("ludo-profile-refresh"));
            window.dispatchEvent(new CustomEvent("ludo-matches-synced"));
            return { tx, syncedCount: matchIds.length };
        } catch (err: unknown) {
            console.error("[useUnsyncedMatches] sync failed:", err);
            const friendlyMsg = formatWeb3Error(err);
            setError(friendlyMsg);
            throw new Error(friendlyMsg);
        } finally {
            hidePrompt?.();
            setIsSyncing(false);
        }
    }, [address, chainIdRaw, ensureAppSession, fetchUnsynced, writeContractAsync, switchChainAsync, player.mode, cdpUserOp]);

    return {
        matches,
        count: totalCount,
        batchCount: matches.length,
        isLoading,
        isSyncing,
        error,
        fetchUnsynced,
        syncOnChain,
    };
}
