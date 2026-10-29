"use client";

import { useCallback, useState } from "react";
import { useAccount, useWriteContract, useChainId, usePublicClient, useSwitchChain } from "wagmi";
import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import { missionClaimAddress } from "@/lib/missionVoucher";
import { missionSystemAddress, missionIdBytes32, MISSION_SYSTEM_ABI } from "@/lib/missionSystem";
import { useAppSession } from "@/hooks/useAppSession";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import { showTxPrompt, updateAuthPromptStatus } from "@/hooks/useAuthPrompt";
import { formatWeb3Error } from "@/lib/web3Error";
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
    const { address: wagmiAddress } = useAccount();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const address = player.address ?? wagmiAddress;
    const chainIdRaw = useChainId();
    const { switchChainAsync } = useSwitchChain();
    const { writeContractAsync, isPending: isWritePending } = useWriteContract();
    const publicClient = usePublicClient();
    const { ensureAppSession } = useAppSession();
    const [step, setStep] = useState<"idle" | "voucher" | "claim" | "done" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    const isPending = isWritePending || cdpUserOp.status === "pending";

    const claim = useCallback(
        async (missionId: string) => {
            const sysAddr = missionSystemAddress();
            const claimAddr = missionClaimAddress();
            if (!address || (!sysAddr && !claimAddr)) {
                const msg = "Wallet or Mission contract not configured";
                setError(msg);
                setStep("error");
                throw new Error(msg);
            }
            setError(null);
            let hidePrompt: (() => void) | undefined;
            try {
                // If on-chain MissionSystem is active, pull claim directly from contract
                if (sysAddr) {
                    setStep("claim");
                    hidePrompt = showTxPrompt({
                        context: "mission-claim",
                        title: "CLAIM MISSION REWARD",
                        statusText: "Please approve the transaction in your wallet to claim your CHIPS reward directly on-chain.",
                    });
                    const midBytes32 = missionIdBytes32(missionId);
                    const callData = encodeFunctionData({
                        abi: MISSION_SYSTEM_ABI,
                        functionName: "claimMission",
                        args: [midBytes32],
                    });

                    let tx: string | undefined;
                    if (player.mode === "ingame" && cdpUserOp.isInGame) {
                        const res = await cdpUserOp.sendCalls([{ to: sysAddr, data: callData }]);
                        tx = res?.userOperationHash ?? "cdp-userop-submitted";
                    } else {
                        if (chainIdRaw && chainIdRaw !== 84532) {
                            try {
                                await switchChainAsync({ chainId: 84532 });
                            } catch (err) {
                                console.warn("[useMissionVoucher] Network switch before claim failed:", err);
                            }
                        }
                        const hash = await writeContractAsync({
                            address: sysAddr,
                            abi: MISSION_SYSTEM_ABI,
                            functionName: "claimMission",
                            args: [midBytes32],
                        });
                        tx = hash;
                        if (publicClient && hash) {
                            updateAuthPromptStatus("Transaction broadcast! Confirming reward on-chain...", "Confirming On-Chain");
                            await publicClient.waitForTransactionReceipt({ hash });
                        }
                    }
                    setStep("done");
                    return tx;
                }

                // Fallback: Voucher-based MissionClaim
                setStep("voucher");
                const sessionId = await ensureAppSession({ context: 'missions' });
                if (!sessionId) {
                    const msg = "Sign in to claim";
                    setError(msg);
                    setStep("error");
                    throw new Error(msg);
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
                hidePrompt = showTxPrompt({
                    context: "mission-claim",
                    title: "CLAIM MISSION REWARD",
                    statusText: "Please approve the claim transaction in your wallet to withdraw your voucher reward.",
                });
                const v = data.voucher;
                const callData = encodeFunctionData({
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

                let tx: string | undefined;
                if (player.mode === "ingame" && cdpUserOp.isInGame) {
                    const res = await cdpUserOp.sendCalls([{ to: claimAddr!, data: callData }]);
                    tx = res?.userOperationHash ?? "cdp-userop-submitted";
                } else {
                    if (chainIdRaw && chainIdRaw !== 84532) {
                        try {
                            await switchChainAsync({ chainId: 84532 });
                        } catch (err) {
                            console.warn("[useMissionVoucher] Network switch before voucher claim failed:", err);
                        }
                    }
                    const hash = await writeContractAsync({
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
                    tx = hash;
                    if (publicClient && hash) {
                        updateAuthPromptStatus("Transaction broadcast! Confirming voucher on-chain...", "Confirming On-Chain");
                        await publicClient.waitForTransactionReceipt({ hash });
                    }
                }
                setStep("done");
                return tx;
            } catch (e) {
                const formatted = formatWeb3Error(e);
                setError(formatted);
                setStep("error");
                throw new Error(formatted);
            } finally {
                hidePrompt?.();
            }
        },
        [address, chainIdRaw, ensureAppSession, writeContractAsync, publicClient, switchChainAsync, player.mode, cdpUserOp],
    );

    return { claim, step, isPending, error };
}
