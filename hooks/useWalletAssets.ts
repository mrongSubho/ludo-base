"use client";

/**
 * R0/R1 — wallet asset balances (SMART_WALLET_PLANNING).
 * CHIPS is **unpriced** — excluded from USD total (H2).
 */

import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits, type Address } from "viem";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { chipsAddress, CHIPS_ERC20_ABI, formatChips } from "@/lib/chips";

export type TokenBalance = {
    key: "eth" | "chips" | "usdc";
    label: string;
    raw: bigint;
    formatted: string;
    decimals: number;
    /** Unpriced tokens never enter USD totals. */
    unpriced?: boolean;
};

/** USDC on Base (well-known). Override via env if needed. */
const USDC_BASE = (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;

export function useWalletAssets() {
    const player = usePlayerSigner();
    const client = usePublicClient();
    const [eth, setEth] = useState<bigint | null>(null);
    const [chips, setChips] = useState<bigint | null>(null);
    const [usdc, setUsdc] = useState<bigint | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const address = player.address as Address | undefined;

    const refresh = useCallback(async () => {
        if (!address || !client) return;
        setLoading(true);
        setError(null);
        try {
            const chipsAddr = chipsAddress();
            const [native, usdcBal, chipsBal] = await Promise.all([
                client.getBalance({ address }),
                client
                    .readContract({
                        address: USDC_BASE,
                        abi: CHIPS_ERC20_ABI,
                        functionName: "balanceOf",
                        args: [address],
                    })
                    .catch(() => BigInt(0)) as Promise<bigint>,
                chipsAddr
                    ? (client
                          .readContract({
                              address: chipsAddr,
                              abi: CHIPS_ERC20_ABI,
                              functionName: "balanceOf",
                              args: [address],
                          })
                          .catch(() => BigInt(0)) as Promise<bigint>)
                    : Promise.resolve(BigInt(0)),
            ]);
            setEth(native);
            setUsdc(usdcBal);
            setChips(chipsBal);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [address, client]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const tokens: TokenBalance[] = [
        {
            key: "eth",
            label: "ETH",
            raw: eth ?? BigInt(0),
            formatted: formatUnits(eth ?? BigInt(0), 18),
            decimals: 18,
        },
        {
            key: "usdc",
            label: "USDC",
            raw: usdc ?? BigInt(0),
            formatted: formatUnits(usdc ?? BigInt(0), 6),
            decimals: 6,
        },
        {
            key: "chips",
            label: "CHIPS",
            raw: chips ?? BigInt(0),
            formatted: formatChips(chips ?? BigInt(0)),
            decimals: 18,
            unpriced: true,
        },
    ];

    return { address, tokens, eth, chips, usdc, loading, error, refresh, needsReconnect: player.needsReconnect };
}
