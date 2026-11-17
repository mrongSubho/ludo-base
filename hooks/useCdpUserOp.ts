"use client";

/**
 * W4 — in-game CHIPS path: CDP `sendUserOperation` + ERC-8021 `dataSuffix`.
 * SMART_WALLET_PLANNING §7 · CHIPS_PLANNING §8.7.
 * External mode keeps wagmi `useSendCalls` / `writeContract` in useChipsPool.
 */

import { useCallback } from "react";
import { getUserOperation } from "@coinbase/cdp-core";
import { useSendUserOperation } from "@coinbase/cdp-hooks";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { DATA_SUFFIX } from "@/lib/builderCode";
import { guardAsyncTransaction } from "@/lib/walletGuard";
import { updateAuthPromptStatus } from "@/hooks/useAuthPrompt";

export type UserOpCall = {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
};

function networkFor(chainId: number | undefined): "base" | "base-sepolia" {
    return chainId === 8453 ? "base" : "base-sepolia";
}

export function useCdpUserOp(defaultChainId = 84532) {
    const player = usePlayerSigner();
    const { sendUserOperation, status, data, error } = useSendUserOperation();

    const sendCalls = useCallback(
        async (calls: UserOpCall[], chainId = defaultChainId) => {
            if (player.mode !== "ingame" || !player.address) {
                throw new Error("useCdpUserOp: in-game CDP wallet required");
            }
            return guardAsyncTransaction(
                () =>
                    sendUserOperation({
                        evmSmartAccount: player.address as `0x${string}`,
                        network: networkFor(chainId),
                        calls: calls.map((c) => ({
                            to: c.to,
                            data: c.data ?? "0x",
                            value: c.value ?? BigInt(0),
                        })),
                        // ERC-8021 attribution — never send unattributed CHIPS txs
                        ...(DATA_SUFFIX ? { dataSuffix: DATA_SUFFIX } : {}),
                        useCdpPaymaster: true,
                    } as Parameters<typeof sendUserOperation>[0]),
                {
                    title: "IN-GAME TRANSACTION",
                    statusText: "Please approve the in-game action.",
                    explanationText: "Sponsored transaction via Coinbase paymaster.",
                },
            );
        },
        [player.mode, player.address, sendUserOperation, defaultChainId],
    );

    const sendCallsAndWait = useCallback(
        async (calls: UserOpCall[], chainId = defaultChainId, timeoutMs = 45_000): Promise<`0x${string}`> => {
            const res = await sendCalls(calls, chainId);
            const smartAccount = player.address as `0x${string}`;
            const network = networkFor(chainId);
            const deadline = Date.now() + timeoutMs;

            updateAuthPromptStatus("UserOp submitted! Waiting for on-chain confirmation...", "Confirming On-Chain");

            while (Date.now() < deadline) {
                const op = await getUserOperation({
                    userOperationHash: res.userOperationHash,
                    evmSmartAccount: smartAccount,
                    network,
                });

                if (op.status === "complete") {
                    if (!op.transactionHash) {
                        throw new Error("User operation completed without a transaction hash");
                    }
                    return op.transactionHash as `0x${string}`;
                }
                if (op.status === "failed") {
                    const revertMsg = op.receipts?.[0]?.revert?.message;
                    throw new Error(revertMsg || "In-game user operation failed on-chain");
                }
                if (op.status === "dropped") {
                    throw new Error("In-game user operation was dropped before confirmation");
                }

                await new Promise((r) => setTimeout(r, 1_500));
            }

            throw new Error("Timed out waiting for in-game transaction confirmation");
        },
        [sendCalls, player.address, defaultChainId],
    );

    return {
        sendCalls,
        sendCallsAndWait,
        isInGame: player.mode === "ingame",
        smartAccount: player.address,
        status,
        data,
        error,
    };
}
