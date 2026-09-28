"use client";

/**
 * W4 — in-game CHIPS path: CDP `sendUserOperation` + ERC-8021 `dataSuffix`.
 * SMART_WALLET_PLANNING §7 · CHIPS_PLANNING §8.7.
 * External mode keeps wagmi `useSendCalls` / `writeContract` in useChipsPool.
 */

import { useCallback } from "react";
import { useSendUserOperation } from "@coinbase/cdp-hooks";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { DATA_SUFFIX } from "@/lib/builderCode";

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
            return sendUserOperation({
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
            } as Parameters<typeof sendUserOperation>[0]);
        },
        [player.mode, player.address, sendUserOperation, defaultChainId],
    );

    return {
        sendCalls,
        isInGame: player.mode === "ingame",
        smartAccount: player.address,
        status,
        data,
        error,
    };
}
