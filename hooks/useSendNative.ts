"use client";

/**
 * R0 — native ETH send (SMART_WALLET_PLANNING §3.2).
 * Max branches by gas path (M): self-pay = balance − gas; paymaster smart = full.
 * External mode: wagmi sendTransaction. In-game: CDP UserOp (value transfer).
 */

import { useCallback, useState } from "react";
import { useSendTransaction, useAccount, useSwitchChain } from "wagmi";
import { parseEther, isAddress, type Address } from "viem";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import { showTxPrompt, updateAuthPromptStatus } from "@/hooks/useAuthPrompt";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";

export function useSendNative() {
    const { chainId } = useAccount();
    const { switchChainAsync } = useSwitchChain();
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const { sendTransactionAsync } = useSendTransaction();
    const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    /**
     * @param maxSelfPay when true and mode is external, caller used balance−gas.
     *        In-game paymaster path may send full balance.
     */
    const send = useCallback(
        async (params: { to: string; amountEth: string }) => {
            const to = params.to.trim();
            if (!isAddress(to)) {
                setError("Invalid recipient address");
                setStatus("error");
                return null;
            }
            if (!player.address) {
                setError("No wallet — reconnect first");
                setStatus("error");
                return null;
            }
            setStatus("pending");
            setError(null);
            let hidePrompt: (() => void) | undefined;
            try {
                const value = parseEther(params.amountEth || "0");
                if (value <= BigInt(0)) {
                    throw new Error("Amount must be greater than 0");
                }
                hidePrompt = showTxPrompt({
                    context: "contract-call",
                    title: "SEND ETH",
                    statusText: `Please approve the transfer in your wallet to send ${params.amountEth} ETH to ${to.slice(0, 6)}...${to.slice(-4)}.`,
                    explanationText: `Native ETH transfer of ${params.amountEth} ETH on Base.`,
                });
                if (player.mode === "ingame" && cdpUserOp.isInGame) {
                    const res = await cdpUserOp.sendCalls([{ to: to as Address, value }]);
                    setTxHash(res.userOperationHash);
                } else {
                    if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                        try {
                            await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                        } catch (err) {
                            console.warn("[useSendNative] Network switch failed:", err);
                        }
                    }
                    const hash = await sendTransactionAsync({
                        account: player.address as `0x${string}`,
                        to: to as Address,
                        value,
                    });
                    setTxHash(hash);
                }
                updateAuthPromptStatus("Transfer broadcast! Confirming on-chain...", "Confirming On-Chain");
                setStatus("success");
                return txHash;
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setStatus("error");
                return null;
            } finally {
                hidePrompt?.();
            }
        },
        [player.address, player.mode, cdpUserOp, sendTransactionAsync, txHash, chainId, switchChainAsync],
    );

    /** Self-pay max for external EOA: leave ~0.0001 ETH gas buffer. */
    const maxSelfPay = useCallback((balanceWei: bigint, gasBufferEth = "0.0001") => {
        const buffer = parseEther(gasBufferEth);
        const max = balanceWei - buffer;
        return max > BigInt(0) ? max : BigInt(0);
    }, []);

    const reset = useCallback(() => {
        setStatus("idle");
        setError(null);
        setTxHash(null);
    }, []);

    return { send, status, error, txHash, maxSelfPay, reset, mode: player.mode, needsReconnect: player.needsReconnect };
}
