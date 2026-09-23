"use client";

import { useCallback, useState } from "react";
import { useAccount, useChainId, useSignTypedData, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";
import {
    buildSettleTypedData,
    payoutPlanHash,
    type PayoutEntry,
} from "@/lib/chipsSettle";
import { MATCH_POOL_ABI, isChipsConfigured, matchPoolAddress } from "@/lib/chips";
import { parseChainId, type SupportedChainId } from "@/lib/chains";
import { useAppSession } from "@/hooks/useAppSession";

/**
 * Post-match settle: Edge co-sign via API → host signTypedData → settlePool.
 * Mode B: hostSig empty after effective settleBy (Edge-only).
 */
export function useSettlePool() {
    const { address } = useAccount();
    const chainIdRaw = useChainId();
    const { signTypedDataAsync } = useSignTypedData();
    const { writeContractAsync, isPending } = useWriteContract();
    const { ensureAppSession } = useAppSession();
    const [step, setStep] = useState<"idle" | "propose" | "sign" | "submit" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);
    const [lastTx, setLastTx] = useState<Hex | null>(null);

    const configured = isChipsConfigured();

    const settle = useCallback(
        async (args: {
            poolId: Hex;
            plan: PayoutEntry[];
            authority: Address;
            participants?: Address[];
            winnerAddresses?: Address[];
            nonce?: bigint;
            deadline?: bigint;
            matchId?: string;
            roomCode?: string;
            /** After effective settleBy — Edge-only Mode B. */
            modeB?: boolean;
        }) => {
            const pool = matchPoolAddress();
            if (!address || !pool || !configured) {
                setError("Wallet or MatchPool not configured");
                setStep("error");
                return null;
            }
            setError(null);
            try {
                const chainId = (parseChainId(chainIdRaw) ?? 84532) as SupportedChainId;
                const sessionId = await ensureAppSession();
                if (!sessionId) {
                    setError("Sign in to settle");
                    setStep("error");
                    return null;
                }

                setStep("propose");
                const nonce = args.nonce ?? BigInt(1);
                const deadline =
                    args.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);

                const res = await fetch("/api/chips/settle/propose", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        walletAddress: address,
                        sessionId,
                        chainId,
                        poolId: args.poolId,
                        authority: args.authority,
                        participants: args.participants ?? args.plan.map((p) => p.addr),
                        winnerAddresses: args.winnerAddresses ?? args.plan.map((p) => p.addr),
                        payoutPlan: args.plan.map((p) => ({
                            addr: p.addr,
                            amount: p.amount.toString(),
                        })),
                        nonce: nonce.toString(),
                        deadline: deadline.toString(),
                        mode: args.modeB ? "edge-only" : "dual",
                    }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data?.error || "settle propose failed");
                }

                const edgeSig = data.edgeSig as Hex;
                const planHash = (data.planHash ?? payoutPlanHash(args.plan)) as Hex;
                const n = BigInt(data.nonce ?? nonce);
                const dl = BigInt(data.deadline ?? deadline);
                const authority = (data.authority ?? args.authority) as Address;

                setStep("sign");
                // Mode B: host signature unused by contract — skip wallet pop when possible.
                let hostSig: Hex = "0x";
                if (!args.modeB) {
                    const typed = buildSettleTypedData({
                        poolId: args.poolId,
                        planHash,
                        nonce: n,
                        deadline: dl,
                        authority,
                        matchPool: pool,
                        chainId,
                    });
                    hostSig = await signTypedDataAsync({
                        domain: typed.domain,
                        types: typed.types,
                        primaryType: typed.primaryType,
                        message: typed.message,
                    });
                }

                setStep("submit");
                const tx = await writeContractAsync({
                    address: pool,
                    abi: MATCH_POOL_ABI,
                    functionName: "settlePool",
                    args: [
                        args.poolId,
                        args.plan.map((p) => ({ addr: p.addr, amount: p.amount })),
                        dl,
                        n,
                        hostSig,
                        edgeSig,
                    ],
                });
                setLastTx(tx);
                setStep("done");
                return tx;
            } catch (e) {
                setError(e instanceof Error ? e.message : "Settle failed");
                setStep("error");
                return null;
            }
        },
        [
            address,
            configured,
            ensureAppSession,
            chainIdRaw,
            signTypedDataAsync,
            writeContractAsync,
        ],
    );

    return { settle, step, isPending, error, lastTx, configured };
}

export default useSettlePool;
