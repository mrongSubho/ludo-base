"use client";

import React, { useMemo } from "react";
import { useChainId, useReadContract, useAccount } from "wagmi";
import { CHIPS_ERC20_ABI, chipsAddress, matchPoolAddress, formatChips, shortHex } from "@/lib/chips";
import { parseChainId, viemChainFor } from "@/lib/chains";
import { useIsDaybreak } from "./GamePanelShell";

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-2.5 mb-2">
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] cw-muted font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
    </div>
);

function MetricRow({
    label,
    value,
    hint,
    tint = "bg-cyan-500/15 cw-accent",
    icon,
    last = false,
}: {
    label: string;
    value: string;
    hint?: string;
    tint?: string;
    icon?: React.ReactNode;
    last?: boolean;
}) {
    return (
        <div className={`flex items-center justify-between gap-3 p-3.5 ${last ? "" : "border-b border-white/5"}`}>
            <div className="flex items-center gap-3 min-w-0">
                {icon != null && (
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
                        {icon}
                    </div>
                )}
                <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-bold cw-ink truncate">{label}</span>
                    {hint && (
                        <span className="text-[10px] font-bold cw-faint truncate font-mono">{hint}</span>
                    )}
                </div>
            </div>
            <span className="text-[15px] font-black tabular-nums cw-ink shrink-0">{value}</span>
        </div>
    );
}

/** Burn / supply explorer — Settings-panel layout (section labels + divided cards). */
export function BurnFeed() {
    const daybreak = useIsDaybreak();
    const ink = daybreak ? "#0A0B0D" : "#F5F7FA";
    const muted = daybreak ? "rgba(10,11,13,0.55)" : "rgba(245,247,250,0.5)";
    const cardBg = daybreak ? "#FFFFFF" : "rgba(255,255,255,0.05)";
    const cardBorder = daybreak ? "rgba(10,11,13,0.10)" : "rgba(255,255,255,0.10)";
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
        chainId: 84532,
        query: { enabled: Boolean(chips) },
    });

    const { data: myBal } = useReadContract({
        address: chips,
        abi: CHIPS_ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        chainId: 84532,
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
        chainId: 84532,
        query: { enabled: Boolean(pool) },
    });

    const burned = burnInputs?.[0];
    const fees = burnInputs?.[1];

    const explorer = useMemo(() => {
        if (chainId === 8453) return "https://basescan.org";
        return "https://sepolia.basescan.org";
    }, [chainId]);

    return (
        <div className="flex flex-col gap-4" style={{ color: ink }}>
            <section>
                <SectionLabel>Supply</SectionLabel>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                    <MetricRow
                        icon={<span className="cw-accent text-sm">Σ</span>}
                        label="Total supply"
                        value={totalSupply != null ? formatChips(totalSupply as bigint) : "—"}
                        hint="B20 CHIPS"
                    />
                    <MetricRow
                        icon={<span className="cw-accent text-sm">◎</span>}
                        label="Your balance"
                        value={myBal != null ? formatChips(myBal as bigint) : "—"}
                        hint={address ? shortHex(address) : "not connected"}
                        last
                    />
                </div>
            </section>

            <section>
                <SectionLabel>Sinks</SectionLabel>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                    <MetricRow
                        tint="bg-rose-500/15 text-rose-300"
                        icon={<span className="text-sm">↓</span>}
                        label="Burned (MatchPool)"
                        value={burned != null ? formatChips(burned) : "—"}
                        hint="memo match:burn · market:burn"
                    />
                    <MetricRow
                        tint="bg-amber-500/15 text-amber-300"
                        icon={<span className="text-sm">⇄</span>}
                        label="Protocol fees routed"
                        value={fees != null ? formatChips(fees) : "—"}
                        hint="memo match:fee"
                        last
                    />
                </div>
            </section>

            <section>
                <SectionLabel>Contracts</SectionLabel>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                    <MetricRow
                        icon={<span className="cw-accent text-sm">◆</span>}
                        label="Token"
                        value={shortHex(chips)}
                        hint={`${explorer}/token/${chips ?? ""}`}
                    />
                    <MetricRow
                        icon={<span className="cw-accent text-sm">◆</span>}
                        label="MatchPool"
                        value={shortHex(pool)}
                        hint={`${explorer}/address/${pool ?? ""}`}
                        last
                    />
                </div>
            </section>

            {!chips && (
                <p className="text-[11px] font-bold text-amber-300/90 px-1">
                    Set NEXT_PUBLIC_CHIPS_ADDRESS to load live data.
                </p>
            )}

            <p className="text-[10px] font-bold cw-faint leading-relaxed px-1">
                Burn tags: match:burn · market:burn · forge:burn · vanity:burn · pass:burn ·
                tour:forfeit · match:abandon · boost:burn · treasury:bb. Live events land in
                chips_events via the indexer worker.
            </p>
        </div>
    );
}

export default BurnFeed;
