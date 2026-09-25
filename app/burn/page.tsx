"use client";

import React, { useMemo } from "react";
import { useChainId, useReadContract, useAccount } from "wagmi";
import { CHIPS_ERC20_ABI, chipsAddress, matchPoolAddress, formatChips, shortHex } from "@/lib/chips";
import { parseChainId, viemChainFor } from "@/lib/chains";

/** Simple explorer + burn / supply dashboard (checklist: explorer + burn dashboard). */
export default function BurnDashboardPage() {
    const chainIdRaw = useChainId();
    const chainId = parseChainId(chainIdRaw) ?? 84532;
    const chain = viemChainFor(chainId);
    const { address } = useAccount();
    const chips = chipsAddress();
    const pool = matchPoolAddress();

    const { data: totalSupply } = useReadContract({
        address: chips,
        abi: CHIPS_ERC20_ABI,
        functionName: "totalSupply",
        query: { enabled: Boolean(chips) },
    });

    const { data: myBal } = useReadContract({
        address: chips,
        abi: CHIPS_ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        query: { enabled: Boolean(chips && address) },
    });

    const { data: burnInputs } = useReadContract({
        address: pool,
        abi: [
            {
                type: "function",
                name: "burnRatioInputs",
                stateMutability: "view",
                inputs: [],
                outputs: [
                    { name: "burned", type: "uint256" },
                    { name: "fees", type: "uint256" },
                ],
            },
        ],
        functionName: "burnRatioInputs",
        query: { enabled: Boolean(pool) },
    });

    const burned = burnInputs?.[0];
    const fees = burnInputs?.[1];

    const explorer = useMemo(() => {
        if (chainId === 8453) return "https://basescan.org";
        return "https://sepolia.basescan.org";
    }, [chainId]);

    return (
        <main className="min-h-screen bg-[#0a0b12] text-white p-6 max-w-2xl mx-auto">
            <h1 className="text-xl font-black uppercase tracking-widest mb-1">CHIPS · Burn & Explorer</h1>
            <p className="text-xs text-white/40 mb-6 font-mono">
                chain {chainId} · {chain.name}
            </p>

            {!chips && (
                <p className="text-sm text-amber-300">Set NEXT_PUBLIC_CHIPS_ADDRESS to load live data.</p>
            )}

            <div className="grid gap-3">
                <Card label="Total supply" value={totalSupply != null ? formatChips(totalSupply as bigint) : "—"} />
                <Card label="Your balance" value={myBal != null ? formatChips(myBal as bigint) : "—"} />
                <Card
                    label="Burned (MatchPool cumulative)"
                    value={burned != null ? formatChips(burned) : "—"}
                    hint="bytes32 memos: match:burn, market:burn, …"
                />
                <Card label="Protocol fees routed" value={fees != null ? formatChips(fees) : "—"} hint="memo match:fee" />
                <Card label="Token" value={shortHex(chips)} hint={`${explorer}/token/${chips ?? ""}`} />
                <Card label="MatchPool" value={shortHex(pool)} hint={`${explorer}/address/${pool ?? ""}`} />
            </div>

            <p className="mt-8 text-[11px] text-white/35 leading-relaxed">
                Burn tags (pre-images of memo bytes32): match:burn · market:burn · forge:burn · vanity:burn ·
                pass:burn · tour:forfeit · match:abandon · boost:burn · treasury:bb. Indexer joins Memo via
                (txHash, logIndex − 1). See docs/ops/CHIPS_WATCHER_RUNBOOK.md.
            </p>
            <p className="mt-3 text-[11px] text-white/35 leading-relaxed">
                Live events: run <code>scripts/chips-indexer-worker.ts</code> to upsert logs into{' '}
                <code>chips_events</code> (Supabase). Then this page can list recent burns from the cache.
            </p>
        </main>
    );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
            <div className="text-lg font-black tabular-nums mt-1">{value}</div>
            {hint && <div className="text-[10px] text-white/30 font-mono mt-1 break-all">{hint}</div>}
        </div>
    );
}
