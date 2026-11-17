"use client";

import React, { useState } from "react";
import { useClaimAll } from "@/hooks/useChipsPool";
import { useLegacyClaim } from "@/hooks/useMerkleClaim";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClanClaims } from "@/hooks/useClanClaims";
import { useArenaVault } from "@/hooks/useArenaVault";
import { shortHex } from "@/lib/chips";
import Button from "./Button";
import Chip from "./Chip";
import { ThinkingOrb } from "./ThinkingOrb";

const VAULT_TOPUP_PRESETS = [
    { label: "500", value: 500 },
    { label: "1K", value: 1_000 },
    { label: "10K", value: 10_000 },
    { label: "100K", value: 100_000 },
    { label: "500K", value: 500_000 },
] as const;

export default function ClaimHubSheet({
    claimablePoolIds,
}: {
    claimablePoolIds?: `0x${string}`[];
}) {
    const bal = useChipsBalance();
    const { claimMany, isPending: claimingPools, error: poolClaimError, configured: poolClaimConfigured } =
        useClaimAll();
    const legacy = useLegacyClaim();
    const clanClaims = useClanClaims();
    const vault = useArenaVault();

    const [vaultMode, setVaultMode] = useState<"none" | "topup" | "withdraw">("none");
    const [vaultInput, setVaultInput] = useState<string>("10000");
    const [statusNote, setStatusNote] = useState<string | null>(null);
    const [vaultErr, setVaultErr] = useState<string | null>(null);

    const poolCount = claimablePoolIds?.length || 0;
    const hasPoolPrizes = poolCount > 0;
    const hasClanClaims = clanClaims.claims.length > 0;
    const hasArenaClaims = vault.claims.length > 0;

    const handleVaultSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const amt = Math.floor(Number(vaultInput));
        if (!Number.isFinite(amt) || amt <= 0) {
            setVaultErr("Enter a valid CHIPS amount greater than 0");
            return;
        }
        setVaultErr(null);
        setStatusNote(null);
        try {
            if (vaultMode === "topup") {
                await vault.topUpVault(amt);
                setStatusNote(`Topped up ${amt.toLocaleString()} CHIPS into your Match Vault.`);
            } else if (vaultMode === "withdraw") {
                if (amt > vault.availableChips) {
                    setVaultErr(`Max available to withdraw is ${vault.availableChips.toLocaleString()} CHIPS`);
                    return;
                }
                await vault.withdrawFromVault(amt);
                setStatusNote(`Withdrew ${amt.toLocaleString()} CHIPS to your wallet.`);
            }
            setVaultMode("none");
            await bal.refresh();
        } catch (err) {
            setVaultErr(err instanceof Error ? err.message : "Vault operation failed");
        }
    };

    const handleClaimArenaRewards = async () => {
        setVaultErr(null);
        setStatusNote(null);
        try {
            await vault.claimVaultClaims();
            await bal.refresh();
            setStatusNote("Match prizes claimed directly to your wallet!");
        } catch (err) {
            setVaultErr(err instanceof Error ? err.message : "Claim failed");
        }
    };

    const handleRollPrize = async (claimId: string, amount: number) => {
        setVaultErr(null);
        setStatusNote(null);
        try {
            await vault.rollPrizeToVault(claimId);
            setStatusNote(`Moved ${amount.toLocaleString()} CHIPS into your Match Vault (0 gas)!`);
        } catch (err) {
            setVaultErr(err instanceof Error ? err.message : "Move failed");
        }
    };

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
                    Unified Match Vault &amp; Claim Hub: keep reusable CHIPS ready for 0-gas Quick Match &amp; TeamUp entry, or pull-claim winnings &amp; balances to your wallet anytime.
                </span>
            </div>

            {/* 1. Arena Match Vault (Reusable Balance + Top Up / Withdraw) */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Arena Match Vault</span>
                    <Chip size="sm" type="status" status={vault.availableChips > 0 ? "ok" : "off"}>
                        {vault.availableChips.toLocaleString()} CHIPS
                    </Chip>
                </div>
                <div className="cb-card p-3.5 space-y-3 text-left">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                                <svg
                                    viewBox="0 0 24 24"
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-ludo-sm font-bold text-white leading-tight">
                                    {vault.availableChips.toLocaleString()} CHIPS Ready
                                </span>
                                <span className="text-ludo-xs font-mono text-white/45 truncate">
                                    {vault.reservedChips > 0
                                        ? `${vault.reservedChips.toLocaleString()} CHIPS locked in active match`
                                        : "Carries over across cancelled searches & rooms"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            variant={vaultMode === "topup" ? "primary" : "secondary"}
                            size="sm"
                            disabled={vault.isActing}
                            onClick={() => {
                                setVaultErr(null);
                                setVaultMode(vaultMode === "topup" ? "none" : "topup");
                                setVaultInput("10000");
                            }}
                            className="uppercase tracking-wider font-black text-ludo-xs"
                        >
                            + Top Up Vault
                        </Button>
                        <Button
                            variant={vaultMode === "withdraw" ? "primary" : "secondary"}
                            size="sm"
                            disabled={vault.isActing || vault.availableChips <= 0}
                            onClick={() => {
                                setVaultErr(null);
                                setVaultMode(vaultMode === "withdraw" ? "none" : "withdraw");
                                setVaultInput(String(vault.availableChips));
                            }}
                            className="uppercase tracking-wider font-black text-ludo-xs"
                        >
                            Withdraw
                        </Button>
                    </div>

                    {vaultMode !== "none" && (
                        <form onSubmit={handleVaultSubmit} className="pt-2 border-t border-white/10 space-y-2.5">
                            {vaultMode === "topup" && (
                                <div className="flex flex-wrap gap-1.5">
                                    {VAULT_TOPUP_PRESETS.map((p) => (
                                        <button
                                            key={p.value}
                                            type="button"
                                            onClick={() => setVaultInput(String(p.value))}
                                            className={`px-2.5 py-1 rounded-lg text-ludo-xs font-mono font-bold border transition-colors ${
                                                Number(vaultInput) === p.value
                                                    ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                                                    : "bg-white/5 border-white/10 text-white/70 hover:text-white"
                                            }`}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={vaultInput}
                                    onChange={(e) => setVaultInput(e.target.value)}
                                    placeholder="CHIPS amount"
                                    className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
                                />
                                {vaultMode === "withdraw" && (
                                    <button
                                        type="button"
                                        onClick={() => setVaultInput(String(vault.availableChips))}
                                        className="px-2.5 py-2 rounded-xl bg-white/5 border border-white/10 text-cyan-300 font-mono text-xs font-bold"
                                    >
                                        MAX
                                    </button>
                                )}
                                <Button
                                    type="submit"
                                    variant="primary"
                                    size="sm"
                                    disabled={vault.isActing}
                                >
                                    {vault.isActing
                                        ? "Wallet…"
                                        : vaultMode === "topup"
                                          ? "Deposit"
                                          : "Claim Out"}
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            </section>

            {/* 2. Match Prizes & Pull Claims (ArenaVault.sol) */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Match Prizes &amp; Withdrawals</span>
                    <Chip size="sm" type="status" status={hasArenaClaims ? "ok" : "off"}>
                        {hasArenaClaims ? `${vault.totalClaimableChips.toLocaleString()} Ready` : "0 Ready"}
                    </Chip>
                </div>
                <div className="cb-card p-3.5 space-y-3 text-left">
                    {!hasArenaClaims ? (
                        <div className="text-ludo-xs font-mono text-white/40">
                            Win Quick Matches or TeamUp battles — 95% net pots deliver here ready to claim to your wallet or roll into your Match Vault.
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                {vault.claims.map((c) => (
                                    <div
                                        key={c.id}
                                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/5"
                                    >
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-ludo-xs font-bold text-white uppercase">
                                                {c.claim_type === "match_prize"
                                                    ? "Match Victory Prize"
                                                    : c.claim_type === "vault_withdraw"
                                                      ? "Vault Withdrawal"
                                                      : "Match Refund"}
                                            </span>
                                            <span className="text-ludo-xs font-mono text-emerald-400 font-bold">
                                                +{c.amount.toLocaleString()} CHIPS
                                            </span>
                                        </div>
                                        {c.claim_type === "match_prize" && (
                                            <button
                                                type="button"
                                                disabled={vault.isActing}
                                                onClick={() => void handleRollPrize(c.id, c.amount)}
                                                className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-mono text-[11px] font-bold shrink-0"
                                            >
                                                Keep in Vault (0 Gas)
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <Button
                                variant="primary"
                                size="md"
                                fullWidth
                                disabled={vault.isActing}
                                onClick={() => void handleClaimArenaRewards()}
                                className="uppercase tracking-widest font-black text-ludo-xs"
                            >
                                {vault.isActing ? (
                                    <div className="flex items-center gap-2">
                                        <ThinkingOrb state="solving" size={20} />
                                        <span>Claiming to Wallet…</span>
                                    </div>
                                ) : (
                                    `Claim All to Wallet (${vault.totalClaimableChips.toLocaleString()} CHIPS)`
                                )}
                            </Button>
                        </>
                    )}
                </div>
            </section>

            {/* 3. Legacy MatchPool Claims (when present) */}
            {hasPoolPrizes && (
                <section className="cb-section">
                    <div className="cb-section-head">
                        <span>MatchPool Claims</span>
                        <Chip size="sm">{`${poolCount} Ready`}</Chip>
                    </div>
                    <div className="cb-card p-3.5 space-y-3 text-left">
                        <Button
                            variant="secondary"
                            size="md"
                            fullWidth
                            disabled={claimingPools || !poolClaimConfigured}
                            onClick={handleClaimPools}
                            className="uppercase tracking-widest font-black text-ludo-xs"
                        >
                            {claimingPools ? "Claiming Pools…" : `Claim ${poolCount} Legacy Pool${poolCount === 1 ? "" : "s"}`}
                        </Button>
                    </div>
                </section>
            )}

            {/* 4. Clan War Rewards & Refunds (100% Pull Claims - D16) */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Clan War Rewards &amp; Refunds</span>
                    <Chip size="sm" type="status" status={hasClanClaims ? "ok" : "off"}>
                        {hasClanClaims ? `${clanClaims.claims.length} Available` : "0 Ready"}
                    </Chip>
                </div>
                <div className="cb-card p-3.5 space-y-3 text-left">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                ⚔️
                            </div>
                            <div className="flex flex-col">
                                <span className="text-ludo-sm font-bold text-white leading-tight">
                                    War Pot Distribution &amp; Escrow Returns
                                </span>
                                <span className="text-ludo-xs font-mono text-white/40">
                                    {hasClanClaims
                                        ? `${clanClaims.totalClaimableChips} CHIPS ready for pull-claim`
                                        : "Direct non-custodial claims from ClanClaim.sol"}
                                </span>
                            </div>
                        </div>
                        {hasClanClaims && (
                            <span className="text-ludo-sm font-mono font-bold text-emerald-400">
                                {clanClaims.totalClaimableChips} CHIPS
                            </span>
                        )}
                    </div>

                    <Button
                        variant="primary"
                        size="md"
                        fullWidth
                        disabled={!hasClanClaims || clanClaims.isClaimingAll}
                        onClick={() => void clanClaims.claimAll()}
                        className="uppercase tracking-widest font-black text-ludo-xs"
                    >
                        {clanClaims.isClaimingAll ? (
                            <div className="flex items-center gap-2">
                                <ThinkingOrb state="solving" size={20} />
                                <span>Claiming Clan Rewards…</span>
                            </div>
                        ) : hasClanClaims ? (
                            `Claim All (${clanClaims.totalClaimableChips} CHIPS)`
                        ) : (
                            "No Clan Claims Pending"
                        )}
                    </Button>
                </div>
            </section>

            {/* 5. Legacy Snapshot Conversion */}
            {legacy.entry && (
                <section className="cb-section">
                    <div className="cb-section-head">
                        <span>Genesis Snapshot</span>
                        <Chip size="sm">{legacy.claimed ? "Claimed" : "Available"}</Chip>
                    </div>
                    <div className="cb-card p-3.5 space-y-3 text-left">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="text-ludo-sm font-bold text-white leading-tight">
                                    Legacy Coin Conversion
                                </span>
                                <span className="text-ludo-xs font-mono text-white/40">
                                    {shortHex(legacy.entry.wallet)} · 100:1 ratio
                                </span>
                            </div>
                            <span className="text-ludo-sm font-mono font-bold text-cyan-300">
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
                                {legacy.claiming ? "Claiming Legacy…" : `Claim ${legacy.humanAmount}`}
                            </Button>
                        )}
                    </div>
                </section>
            )}

            {/* Error or Status message */}
            {(statusNote || vaultErr || vault.error || poolClaimError || legacy.error) && (
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-ludo-xs font-mono text-white/70 text-left">
                    {vaultErr || vault.error || statusNote || poolClaimError || legacy.error}
                </div>
            )}
        </div>
    );
}
