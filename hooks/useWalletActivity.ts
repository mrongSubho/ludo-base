"use client";

/**
 * R1 — unified wallet activity (SMART_WALLET_PLANNING §3.3).
 * v1: local confirmed sends + viem native history when available + explorer link.
 * CHIPS game rows join from existing feeds later; do not invent fake prices.
 */

import { useCallback, useEffect, useState } from "react";
import { type Address } from "viem";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";

export type WalletActivityItem = {
    id: string;
    kind: "send" | "receive" | "game" | "app";
    status: "pending" | "confirmed" | "failed";
    token: "ETH" | "USDC" | "CHIPS";
    amount: string;
    counterparty: string;
    hash?: string;
    at: number;
};

const LS_KEY = "ludo-wallet-activity";

function readLocal(address: string): WalletActivityItem[] {
    try {
        const raw = localStorage.getItem(`${LS_KEY}:${address.toLowerCase()}`);
        return raw ? (JSON.parse(raw) as WalletActivityItem[]) : [];
    } catch {
        return [];
    }
}

function writeLocal(address: string, items: WalletActivityItem[]) {
    try {
        localStorage.setItem(
            `${LS_KEY}:${address.toLowerCase()}`,
            JSON.stringify(items.slice(0, 50)),
        );
    } catch {
        /* best-effort */
    }
}

export function recordWalletActivity(address: string, item: WalletActivityItem) {
    const list = readLocal(address);
    writeLocal(address, [item, ...list]);
}

export function useWalletActivity() {
    const player = usePlayerSigner();
    const [items, setItems] = useState<WalletActivityItem[]>([]);
    const [loading, setLoading] = useState(false);

    const address = player.address as Address | undefined;

    const refresh = useCallback(async () => {
        if (!address) return;
        setLoading(true);
        try {
            const local = readLocal(address);
            // On-chain history needs an indexer / explorer API (SMART_WALLET_PLANNING §3.3).
            // Until that lands, local confirms + BaseScan links are the source of truth.
            const merged = [...local].sort((a, b) => b.at - a.at);
            // de-dupe by hash/id
            const seen = new Set<string>();
            setItems(
                merged.filter((i) => {
                    const k = i.hash || i.id;
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                }),
            );
        } finally {
            setLoading(false);
        }
    }, [address]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        items,
        loading,
        refresh,
        address,
        needsReconnect: player.needsReconnect,
        explorerBase: "https://sepolia.basescan.org",
    };
}
