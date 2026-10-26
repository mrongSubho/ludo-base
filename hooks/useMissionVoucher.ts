"use client";

import { useCallback, useState } from "react";
import { useAccount, useWriteContract, useChainId } from "wagmi";
import type { Address, Hex } from "viem";
import { missionClaimAddress } from "@/lib/missionVoucher";
import { missionSystemAddress, missionIdBytes32, MISSION_SYSTEM_ABI } from "@/lib/missionSystem";
import { useAppSession } from "@/hooks/useAppSession";
import { parseChainId } from "@/lib/chains";

export const MISSION_CLAIM_ABI = [
    {
        type: "function",
        name: "claim",
        stateMutability: "nonpayable",
        inputs: [
            { name: "wallet", type: "address" },
            { name: "missionId", type: "bytes32" },
            { name: "amount", type: "uint256" },
            { name: "periodId", type: "bytes32" },
            { name: "deadline", type: "uint64" },
            { name: "nonce", type: "uint256" },
            { name: "sig", type: "bytes" },
        ],
        outputs: [],
    },
] as const;

/** Issue voucher from API then pull MissionClaim.claim on-chain. */
export function useMissionVoucherClaim() {
    const { address } = useAccount();
    const chainIdRaw = useChainId();
    const { writeContractAsync, isPending } = useWriteContract();
    const { ensureAppSession } = useAppSession();
    const [step, setStep] = useState<"idle" | "voucher" | "claim" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    const claim = useCallback(
        async (missionId: string) => {
            const sysAddr = missionSystemAddress();
            const claimAddr = missionClaimAddress();
            if (!address || (!sysAddr && !claimAddr)) {
                setError("Wallet or Mission contract not configured");
                setStep("error");
                return null;
            }
            setError(null);
            try {
                // If on-chain MissionSystem is active, pull claim directly from contract (user pays gas)
                if (sysAddr) {
                    setStep("claim");
                    const midBytes32 = missionIdBytes32(missionId);
                    const tx = await writeContractAsync({
                        address: sysAddr,
                        abi: MISSION_SYSTEM_ABI,
                        functionName: "claimMission",
                        args: [midBytes32],
                    });
                    setStep("done");
                    return tx;
                }

                // Fallback: Voucher-based MissionClaim
                setStep("voucher");
                const sessionId = await ensureAppSession({ context: 'missions' });
                if (!sessionId) {
                    setError("Sign in to claim");
                    setStep("error");
                    return null;
                }
                const chainId = parseChainId(chainIdRaw) ?? 84532;
                const res = await fetch("/api/missions/voucher", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        walletAddress: address,
                        sessionId,
                        missionId,
                        chainId,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || "voucher failed");

                setStep("claim");
                const v = data.voucher;
                const tx = await writeContractAsync({
                    address: claimAddr!,
                    abi: MISSION_CLAIM_ABI,
                    functionName: "claim",
                    args: [
                        v.wallet as Address,
                        v.missionId as Hex,
                        BigInt(v.amount),
                        v.periodId as Hex,
                        BigInt(v.deadline),
                        BigInt(v.nonce),
                        data.signature as Hex,
                    ],
                });
                setStep("done");
                return tx;
            } catch (e) {
                setError(e instanceof Error ? e.message : "Mission claim failed");
                setStep("error");
                return null;
            }
        },
        [address, chainIdRaw, ensureAppSession, writeContractAsync],
    );

    return { claim, step, isPending, error };
}
