"use client";

/**
 * R0 — native ETH send (WALLET_PLAN §3.2).
 * Max branches by gas path (M): self-pay = balance − gas; paymaster smart = full.
 * External mode: wagmi sendTransaction. In-game: CDP UserOp (value transfer).
 */

import { useCallback, useState } from "react";
import { useSendTransaction } from "wagmi";
import { parseEther, isAddress, type Address } from "viem";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";

export function useSendNative() {
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
            try {
                const value = parseEther(params.amountEth || "0");
                if (value <= BigInt(0)) {
                    throw new Error("Amount must be greater than 0");
                }
                if (player.mode === "ingame" && cdpUserOp.isInGame) {
                    const res = await cdpUserOp.sendCalls([{ to: to as Address, value }]);
                    setTxHash(res.userOperationHash);
                } else {
                    const hash = await sendTransactionAsync({
                        account: player.address as `0x${string}`,
                        to: to as Address,
                        value,
                    });
                    setTxHash(hash);
                }
                setStatus("success");
                return txHash;
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setStatus("error");
                return null;
            }
        },
        [player.address, player.mode, cdpUserOp, sendTransactionAsync, txHash],
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
