"use client";

import React, { useState } from "react";
import { useClaimAll } from "@/hooks/useChipsPool";
import { useLegacyClaim, useSeasonClaim } from "@/hooks/useMerkleClaim";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { shortHex } from "@/lib/chips";
import Button from "./Button";
import Chip from "./Chip";
import { ThinkingOrb } from "./ThinkingOrb";

export default function ClaimHubSheet({
    claimablePoolIds,
}: {
    claimablePoolIds?: `0x${string}`[];
}) {
    const bal = useChipsBalance();
    const { claimMany, isPending: claimingPools, error: poolClaimError, configured: poolClaimConfigured } =
        useClaimAll();
    const legacy = useLegacyClaim();
    const season = useSeasonClaim("1");

    const [statusNote, setStatusNote] = useState<string | null>(null);

    const poolCount = claimablePoolIds?.length || 0;
    const hasPoolPrizes = poolCount > 0;

    const handleClaimPools = async () => {
        if (!claimablePoolIds?.length) {
            setStatusNote("No settled pool prizes available to claim in this session.");
            return;
        }
        setStatusNote(null);
        await claimMany(claimablePoolIds);
        await bal.refresh();
        setStatusNote("Pool winnings claimed successfully!");
    };

    return (
        <div className="cb-screen space-y-4">
            {/* Header intro note */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 text-ludo-xs font-mono text-white/60 leading-relaxed text-left flex items-start gap-2">
                <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_6px_rgba(0,229,255,0.8)]" />
                <span>
                    Claim Hub consolidates all on-chain rewards: ranked match pool prize funds, season airdrops, and legacy snapshot allocations.
                </span>
            </div>

            {/* 1. Ranked Match Pools */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Ranked Match Pools</span>
                    <Chip size="sm">{hasPoolPrizes ? `${poolCount} Ready` : "0 Ready"}</Chip>
                </div>
                <div className="cb-card p-3.5 space-y-3 text-left">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                                <svg
                                    viewBox="0 0 24 24"
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                                    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                                    <path d="M4 22h16" />
                                    <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
                                    <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
                                    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                                </svg>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-ludo-sm font-bold text-white leading-tight">
                                    Settled Prize Funds
                                </span>
                                <span className="text-ludo-xs font-mono text-white/40">
                                    {hasPoolPrizes
                                        ? `${poolCount} match pool${poolCount === 1 ? "" : "s"} ready`
                                        : "Prizes unlock after dispute window"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <Button
                        variant="primary"
                        size="md"
                        fullWidth
                        disabled={claimingPools || !poolClaimConfigured || !hasPoolPrizes}
                        onClick={handleClaimPools}
                        className="uppercase tracking-widest font-black text-ludo-xs"
                    >
                        {claimingPools ? (
                            <div className="flex items-center gap-2">
                                <ThinkingOrb state="solving" size={20} />
                                <span>Claiming Pools…</span>
                            </div>
                        ) : hasPoolPrizes ? (
                            `Claim ${poolCount} Match Prize${poolCount === 1 ? "" : "s"}`
                        ) : (
                            "No Pools Pending Claim"
                        )}
                    </Button>
                </div>
            </section>

            {/* 2. Season Rewards (Merkle Claim) */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Season 1 Airdrop</span>
                    <Chip size="sm">{season.claimed ? "Claimed" : season.canClaim ? "Ready" : "Checking"}</Chip>
                </div>
                <div className="cb-card p-3.5 space-y-3 text-left">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                                <svg
                                    viewBox="0 0 24 24"
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                </svg>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-ludo-sm font-bold text-white leading-tight">
                                    Season Epoch 1
                                </span>
                                <span className="text-ludo-xs font-mono text-white/40">
                                    {season.entry
                                        ? `${season.humanAmount} allocation verified`
                                        : "No Season 1 allocation for this wallet"}
                                </span>
                            </div>
                        </div>
                        {season.entry && (
                            <span className="text-ludo-sm font-mono font-bold text-emerald-400">
                                {season.humanAmount}
                            </span>
                        )}
                    </div>

                    {season.entry && !season.claimed && (
                        <Button
                            variant="primary"
                            size="md"
                            fullWidth
                            disabled={!season.canClaim || season.claiming}
                            onClick={() => void season.claim()}
                            className="uppercase tracking-widest font-black text-ludo-xs"
                        >
                            {season.claiming ? (
                                <div className="flex items-center gap-2">
                                    <ThinkingOrb state="solving" size={20} />
                                    <span>Claiming Airdrop…</span>
                                </div>
                            ) : season.canClaim ? (
                                `Claim ${season.humanAmount}`
                            ) : (
                                "Airdrop Claim Locked"
                            )}
                        </Button>
                    )}
                </div>
            </section>

            {/* 3. Legacy Snapshot Conversion */}
            {legacy.entry && (
                <section className="cb-section">
                    <div className="cb-section-head">
                        <span>Genesis Snapshot</span>
                        <Chip size="sm">{legacy.claimed ? "Claimed" : "Available"}</Chip>
                    </div>
                    <div className="cb-card p-3.5 space-y-3 text-left">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                                    <svg
                                        viewBox="0 0 24 24"
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                        <line x1="12" y1="22.08" x2="12" y2="12" />
                                    </svg>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-ludo-sm font-bold text-white leading-tight">
                                        Legacy Coin Conversion
                                    </span>
                                    <span className="text-ludo-xs font-mono text-white/40">
                                        {shortHex(legacy.entry.wallet)} · 100:1 ratio
                                    </span>
                                </div>
                            </div>
                            <span className="text-ludo-sm font-mono font-bold text-purple-300">
                                {legacy.humanAmount}
                            </span>
                        </div>

                        {!legacy.claimed && (
                            <Button
                                variant="secondary"
                                size="md"
                                fullWidth
                                disabled={!legacy.canClaim || legacy.claiming}
                                onClick={() => void legacy.claim()}
                                className="uppercase tracking-widest font-black text-ludo-xs"
                            >
                                {legacy.claiming ? (
                                    <div className="flex items-center gap-2">
                                        <ThinkingOrb state="solving" size={20} />
                                        <span>Claiming Legacy…</span>
                                    </div>
                                ) : (
                                    `Claim ${legacy.humanAmount}`
                                )}
                            </Button>
                        )}
                    </div>
                </section>
            )}

            {/* Error or Status message */}
            {(statusNote || poolClaimError || season.error || legacy.error) && (
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-ludo-xs font-mono text-white/70 text-left">
                    {statusNote || poolClaimError || season.error || legacy.error}
                </div>
            )}
        </div>
    );
}
