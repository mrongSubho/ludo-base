"use client";

import React, { useMemo } from "react";
import { useReadContract, useAccount } from "wagmi";
import { CHIPS_ERC20_ABI, chipsAddress, matchPoolAddress, formatChips, shortHex } from "@/lib/chips";

/**
 * Burn / supply explorer — dual-theme (daybreak porcelain / retro night).
 *
 * Paint used to come from `useIsDaybreak()` + a body.classList MutationObserver
 * feeding inline hex ternaries (UI_DESIGN_AUDIT P0-3) whose values had already
 * drifted from the CSS tokens. It is now a static table of custom-property
 * references: each theme block owns the resolved value, so the feed follows the
 * theme through the cascade — no JS branching, no second render, no observer.
 * The `color-mix(...)` entries are the 10-12% washes that used to be hardcoded
 * per theme; mixing from the semantic colour keeps them in lockstep with it.
 */
const BURN_PAINT = {
    ink: "var(--ink-strong)",
    muted: "var(--ink-muted)",
    faint: "var(--ink-faint)",
    card: "var(--surface-recessed)",
    line: "var(--line-soft)",
    blue: "var(--accent)",
    blueSoft: "var(--accent-soft)",
    red: "var(--negative)",
    redSoft: "color-mix(in srgb, var(--negative) 12%, transparent)",
    amber: "var(--warn)",
    amberSoft: "color-mix(in srgb, var(--warn) 12%, transparent)",
} as const;

type BurnPaint = typeof BURN_PAINT;

function SectionLabel({ children, p }: { children: React.ReactNode; p: BurnPaint }) {
    return (
        <div className="flex items-center gap-2.5 mb-2">
            <span
                className="px-2 py-0.5 rounded-md text-[10px] font-black tracking-[0.18em] font-mono uppercase"
                style={{ background: p.blueSoft, color: p.blue, border: `1px solid ${p.line}` }}
            >
                {children}
            </span>
            <div className="flex-1 h-px" style={{ background: p.line }} />
        </div>
    );
}

function MetricRow({
    label,
    value,
    hint,
    icon,
    iconBg,
    iconColor,
    p,
    last,
}: {
    label: string;
    value: string;
    hint?: string;
    icon?: React.ReactNode;
    iconBg?: string;
    iconColor?: string;
    p: BurnPaint;
    last?: boolean;
}) {
    return (
        <div
            className="flex items-center gap-3 p-3.5"
            style={{ borderBottom: last ? "none" : `1px solid ${p.line}` }}
        >
            {icon != null && (
                <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold"
                    style={{ background: iconBg ?? p.blueSoft, color: iconColor ?? p.blue }}
                >
                    {icon}
                </div>
            )}
            <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate" style={{ color: p.ink }}>
                    {label}
                </div>
                {hint && (
                    <div className="text-[10px] font-bold font-mono truncate mt-0.5" style={{ color: p.faint }}>
                        {hint}
                    </div>
                )}
            </div>
            <div
                className="text-[14px] font-black tabular-nums shrink-0 text-right"
                style={{ color: p.ink, maxWidth: "42%" }}
            >
                <span className="block truncate">{value}</span>
            </div>
        </div>
    );
}

function Card({ children, p }: { children: React.ReactNode; p: BurnPaint }) {
    return (
        <div
            className="rounded-2xl overflow-hidden"
            style={{ background: p.card, border: `1px solid ${p.line}` }}
        >
            {children}
        </div>
    );
}

/** Burn / supply explorer — dual-theme (daybreak porcelain / retro night). */
export function BurnFeed() {
    const p = BURN_PAINT;
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

    const explorer = useMemo(() => "https://sepolia.basescan.org", []);

    return (
        <div className="flex flex-col gap-4">
            <section>
                <SectionLabel p={p}>Supply</SectionLabel>
                <Card p={p}>
                    <MetricRow
                        p={p}
                        icon="Σ"
                        label="Total supply"
                        value={totalSupply != null ? formatChips(totalSupply as bigint) : "—"}
                        hint="B20 CHIPS"
                    />
                    <MetricRow
                        p={p}
                        last
                        icon="◎"
                        label="Your balance"
                        value={myBal != null ? formatChips(myBal as bigint) : "—"}
                        hint={address ? shortHex(address) : "not connected"}
                    />
                </Card>
            </section>

            <section>
                <SectionLabel p={p}>Sinks</SectionLabel>
                <Card p={p}>
                    <MetricRow
                        p={p}
                        icon="↓"
                        iconBg={p.redSoft}
                        iconColor={p.red}
                        label="Burned (MatchPool)"
                        value={burned != null ? formatChips(burned) : "—"}
                        hint="match:burn · market:burn"
                    />
                    <MetricRow
                        p={p}
                        last
                        icon="⇄"
                        iconBg={p.amberSoft}
                        iconColor={p.amber}
                        label="Protocol fees routed"
                        value={fees != null ? formatChips(fees) : "—"}
                        hint="match:fee"
                    />
                </Card>
            </section>

            <section>
                <SectionLabel p={p}>Contracts</SectionLabel>
                <Card p={p}>
                    <MetricRow
                        p={p}
                        icon="◆"
                        label="Token"
                        value={shortHex(chips)}
                        hint={`${explorer}/token/${chips ?? ""}`}
                    />
                    <MetricRow
                        p={p}
                        last
                        icon="◆"
                        label="MatchPool"
                        value={shortHex(pool)}
                        hint={`${explorer}/address/${pool ?? ""}`}
                    />
                </Card>
            </section>

            {!chips && (
                <p className="text-[11px] font-bold px-1" style={{ color: p.amber }}>
                    Set NEXT_PUBLIC_CHIPS_ADDRESS to load live data.
                </p>
            )}

            <p className="text-[10px] font-bold leading-relaxed px-1" style={{ color: p.faint }}>
                Burn tags: match:burn · market:burn · forge:burn · vanity:burn · pass:burn ·
                tour:forfeit · match:abandon · boost:burn · treasury:bb.
            </p>
        </div>
    );
}

export default BurnFeed;
