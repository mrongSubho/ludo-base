"use client";

/**
 * Unified wallet activity (SMART_WALLET_PLANNING §5).
 * Local user-initiated rows + on-chain ERC-20 Transfer logs (Base Sepolia)
 * + receipt polling so Pending → Confirmed / Failed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppSession } from "./useAppSession";
import {
    createPublicClient,
    http,
    parseAbiItem,
    type Address,
    type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { chipsAddress } from "@/lib/chips";

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
const ERC20_TRANSFER = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

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
            JSON.stringify(items.slice(0, 80)),
        );
    } catch {
        /* best-effort */
    }
}

export function recordWalletActivity(address: string, item: WalletActivityItem) {
    const list = readLocal(address);
    writeLocal(address, [item, ...list.filter((x) => x.id !== item.id)]);
}

export function updateWalletActivity(address: string, id: string, patch: Partial<WalletActivityItem>) {
    const list = readLocal(address).map((i) => (i.id === id ? { ...i, ...patch } : i));
    writeLocal(address, list);
}

function client() {
    return createPublicClient({ chain: baseSepolia, transport: http() });
}

function fmtToken(raw: bigint, decimals: number): string {
    const s = raw.toString();
    if (decimals === 0) return s;
    const padded = s.padStart(decimals + 1, "0");
    const whole = padded.slice(0, -decimals);
    const frac = padded.slice(-decimals).replace(/0+$/, "");
    return frac ? `${whole}.${frac.slice(0, 6)}` : whole;
}

export function useWalletActivity() {
    const player = usePlayerSigner();
    const { peekAppSession } = useAppSession();
    const [items, setItems] = useState<WalletActivityItem[]>([]);
    const [loading, setLoading] = useState(false);
    const pollRef = useRef<number | null>(null);

    const address = player.address as Address | undefined;

    const refresh = useCallback(async () => {
        if (!address) return;
        setLoading(true);
        try {
            const local = readLocal(address);
            const chainRows: WalletActivityItem[] = [];

            // ERC-20 Transfer logs (CHIPS + USDC) — last ~7d on Sepolia
            try {
                const c = client();
                const latest = await c.getBlockNumber();
                const window = BigInt(50000);
                const fromBlock = latest > window ? latest - window : BigInt(0);
                const tokens: {
                    key: WalletActivityItem["token"];
                    addr: Address;
                    decimals: number;
                }[] = [
                    {
                        key: "CHIPS",
                        addr: (chipsAddress() || "0x") as Address,
                        decimals: 18,
                    },
                    { key: "USDC", addr: USDC_BASE_SEPOLIA, decimals: 6 },
                ];
                for (const t of tokens) {
                    if (!/^0x[a-fA-F0-9]{40}$/.test(t.addr)) continue;
                    const [outLogs, inLogs] = await Promise.all([
                        c.getLogs({
                            address: t.addr,
                            event: ERC20_TRANSFER,
                            args: { from: address },
                            fromBlock,
                            toBlock: latest,
                        }),
                        c.getLogs({
                            address: t.addr,
                            event: ERC20_TRANSFER,
                            args: { to: address },
                            fromBlock,
                            toBlock: latest,
                        }),
                    ]);
                    for (const log of [...outLogs, ...inLogs]) {
                        const args = log.args as {
                            from?: string;
                            to?: string;
                            value?: bigint;
                        };
                        const isIn = (args.to || "").toLowerCase() === address.toLowerCase();
                        const other = isIn ? args.from : args.to;
                        const value = args.value ?? BigInt(0);
                        chainRows.push({
                            id: `${log.transactionHash}-${log.logIndex ?? 0}`,
                            kind: isIn ? "receive" : "send",
                            status: "confirmed",
                            token: t.key,
                            amount: fmtToken(value, t.decimals),
                            counterparty: other || "—",
                            hash: log.transactionHash,
                            at: Date.now(),
                        });
                    }
                }
            } catch {
                /* RPC / logs unavailable */
            }

            // Poll local pending hashes → confirmed / failed
            const c = client();
            const pending = local.filter((i) => i.status === "pending" && i.hash);
            await Promise.all(
                pending.map(async (i) => {
                    try {
                        const receipt = await c.getTransactionReceipt({
                            hash: i.hash as Hex,
                        });
                        const ok = receipt.status === "success";
                        updateWalletActivity(address, i.id, {
                            status: ok ? "confirmed" : "failed",
                        });
                    } catch {
                        /* still pending or dropped */
                    }
                }),
            );

            // Etherscan / BaseScan (server) — native ETH + token history
            let explorerRows: WalletActivityItem[] = [];
            try {
                // SEC-23: the route now needs a session for this wallet.
                const sid = peekAppSession();
                const res = await fetch(
                    `/api/activity?wallet=${encodeURIComponent(address)}`
                    + (sid ? `&walletAddress=${encodeURIComponent(address)}&sessionId=${encodeURIComponent(sid)}` : ''),
                );
                const data = await res.json().catch(() => ({}));
                if (Array.isArray(data?.items)) explorerRows = data.items as WalletActivityItem[];
            } catch {
                /* optional */
            }

            const localAfter = readLocal(address);
            const merged = [...localAfter, ...chainRows, ...explorerRows].sort((a, b) => b.at - a.at);
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
        pollRef.current = window.setInterval(() => void refresh(), 45_000);
        return () => {
            if (pollRef.current) window.clearInterval(pollRef.current);
        };
    }, [refresh]);

    const groups = useMemo(() => {
        return {
            pending: items.filter((i) => i.status === "pending"),
            confirmed: items.filter((i) => i.status === "confirmed"),
            failed: items.filter((i) => i.status === "failed"),
            sent: items.filter((i) => i.kind === "send"),
            received: items.filter((i) => i.kind === "receive"),
            game: items.filter((i) => i.kind === "game"),
        };
    }, [items]);

    return {
        items,
        groups,
        loading,
        refresh,
        address,
        needsReconnect: player.needsReconnect,
        explorerBase: "https://sepolia.basescan.org",
    };
}
