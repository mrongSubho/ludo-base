"use client";

/**
 * R1 — ERC-20 send (USDC / CHIPS). SMART_WALLET_PLANNING §3.2.
 * CHIPS stays Base-only (structurally). External: wagmi writeContract;
 * In-game: CDP UserOp with dataSuffix.
 */

import { useCallback, useState } from "react";
import { useWriteContract } from "wagmi";
import { encodeFunctionData, isAddress, parseUnits, type Address } from "viem";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import { CHIPS_ERC20_ABI, chipsAddress } from "@/lib/chips";

export type SendTokenKey = "usdc" | "chips";

const USDC_BASE = (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;

function tokenMeta(key: SendTokenKey) {
    if (key === "usdc") return { address: USDC_BASE, decimals: 6, label: "USDC" };
    const chips = chipsAddress();
    if (!chips) return null;
    return { address: chips, decimals: 18, label: "CHIPS" };
}

export function useSendToken() {
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const { writeContractAsync } = useWriteContract();
    const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    const send = useCallback(
        async (params: { token: SendTokenKey; to: string; amount: string }) => {
            const meta = tokenMeta(params.token);
            if (!meta) {
                setError("Token not configured");
                setStatus("error");
                return null;
            }
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
                const amount = parseUnits(params.amount || "0", meta.decimals);
                if (amount <= BigInt(0)) throw new Error("Amount must be greater than 0");
                const data = encodeFunctionData({
                    abi: CHIPS_ERC20_ABI,
                    functionName: "transfer",
                    args: [to as Address, amount],
                });
                if (player.mode === "ingame" && cdpUserOp.isInGame) {
                    const res = await cdpUserOp.sendCalls([{ to: meta.address, data }]);
                    setTxHash(res.userOperationHash);
                } else {
                    const hash = await writeContractAsync({
                        address: meta.address,
                        abi: CHIPS_ERC20_ABI,
                        functionName: "transfer",
                        args: [to as Address, amount],
                    });
                    setTxHash(hash as string);
                }
                setStatus("success");
                return txHash;
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setStatus("error");
                return null;
            }
        },
        [player.address, player.mode, cdpUserOp, writeContractAsync, txHash],
    );

    const reset = useCallback(() => {
        setStatus("idle");
        setError(null);
        setTxHash(null);
    }, []);

    return { send, status, error, txHash, reset, mode: player.mode, needsReconnect: player.needsReconnect };
}
