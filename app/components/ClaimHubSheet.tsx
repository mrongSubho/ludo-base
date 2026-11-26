"use client";

import React, { useState } from "react";
import { useAccount } from "wagmi";
import { useClaimAll } from "@/hooks/useChipsPool";
import { useLegacyClaim, useSeasonClaim } from "@/hooks/useMerkleClaim";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClanClaims } from "@/hooks/useClanClaims";
import { useArenaVault } from "@/hooks/useArenaVault";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useComplianceConsent } from "@/hooks/useComplianceConsent";
import { shortHex } from "@/lib/chips";
import Button from "./Button";
import Chip from "./Chip";
import ComplianceGateModal from "./ComplianceGateModal";
import { ThinkingOrb } from "./ThinkingOrb";
import { getSoundEngine } from "@/lib/audio/SoundEngine";

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
    const { address: wagmiAddress } = useAccount();
    const player = usePlayerSigner();
    const compliance = useComplianceConsent(player.address ?? wagmiAddress);
    const bal = useChipsBalance();
    const { claimMany, isPending: claimingPools, error: poolClaimError, configured: poolClaimConfigured } =
        useClaimAll();
    const legacy = useLegacyClaim();
    const season = useSeasonClaim("1");
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
                const compliant = await compliance.ensureCompliance();
                if (!compliant) {
                    setVaultErr("Age 18+ and Terms confirmation is required before Match Vault deposits.");
                    return;
                }
                await vault.topUpVault(amt);
                getSoundEngine().play("coin_chink");
                setStatusNote(`Topped up ${amt.toLocaleString()} CHIPS into your Match Vault.`);
            } else if (vaultMode === "withdraw") {
                if (amt > vault.availableChips) {
                    getSoundEngine().play("ui_error");
                    setVaultErr(`Max available to withdraw is ${vault.availableChips.toLocaleString()} CHIPS`);
                    return;
                }
                await vault.withdrawFromVault(amt);
                getSoundEngine().play("claim_reward_burst");
                setStatusNote(`Withdrew ${amt.toLocaleString()} CHIPS to your wallet.`);
            }
            setVaultMode("none");
            await bal.refresh();
        } catch (err) {
            getSoundEngine().play("ui_error");
            setVaultErr(err instanceof Error ? err.message : "Vault operation failed");
        }
    };

    const handleClaimArenaRewards = async () => {
        setVaultErr(null);
        setStatusNote(null);
        try {
            await vault.claimVaultClaims();
            await bal.refresh();
            getSoundEngine().play("claim_reward_burst");
            setStatusNote("Match prizes claimed directly to your wallet!");
        } catch (err) {
            getSoundEngine().play("ui_error");
            setVaultErr(err instanceof Error ? err.message : "Claim failed");
        }
    };

    const handleRollPrize = async (claimId: string, amount: number) => {
        setVaultErr(null);
        setStatusNote(null);
        try {
            await vault.rollPrizeToVault(claimId);
            getSoundEngine().play("coin_chink");
            setStatusNote(`Moved ${amount.toLocaleString()} CHIPS into your Match Vault (0 gas)!`);
        } catch (err) {
            getSoundEngine().play("ui_error");
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
        getSoundEngine().play("claim_reward_burst");
        setStatusNote("Pool winnings claimed successfully!");
    };

    return (
        <div className="cb-screen space-y-4">
            {/* Header intro note */}
            <div className="p-3 rounded-2xl bg-surface-recessed border border-line-soft text-ludo-xs font-mono text-ink-muted leading-relaxed text-left flex items-start gap-2">
                <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-accent shrink-0 shadow-[0_0_6px_color-mix(in_srgb,var(--accent)_65%,transparent)]" />
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
                            <div className="w-9 h-9 rounded-xl bg-accent-soft border border-accent/30 flex items-center justify-center text-accent shrink-0">
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
                                <span className="text-ludo-sm font-bold text-ink-strong leading-tight">
                                    {vault.availableChips.toLocaleString()} CHIPS Ready
                                </span>
                                <span className="text-ludo-xs font-mono text-ink-faint truncate">
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
                            className="uppercase tracking-wider font-bold label-chrome text-ludo-xs"
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
                            className="uppercase tracking-wider font-bold label-chrome text-ludo-xs"
                        >
                            Withdraw
                        </Button>
                    </div>

                    {vaultMode !== "none" && (
                        <form onSubmit={handleVaultSubmit} className="pt-2 border-t border-line-soft space-y-2.5">
                            {vaultMode === "topup" && (
                                <div className="flex flex-wrap gap-1.5">
                                    {VAULT_TOPUP_PRESETS.map((p) => (
                                        <button
                                            key={p.value}
                                            type="button"
                                            onClick={() => setVaultInput(String(p.value))}
                                            className={`px-2.5 py-1 rounded-lg text-ludo-xs font-mono font-bold border transition-colors ${
                                                Number(vaultInput) === p.value
                                                    ? "bg-accent-soft border-accent text-accent"
                                                    : "bg-surface-recessed border-line-soft text-ink-muted hover:text-ink-strong"
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
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-surface-panel border border-line-soft text-ink-strong font-mono text-xs focus:outline-none focus:border-accent"
                                />
                                {vaultMode === "withdraw" && (
                                    <button
                                        type="button"
                                        onClick={() => setVaultInput(String(vault.availableChips))}
                                        className="px-2.5 py-2 rounded-xl bg-surface-recessed border border-line-soft text-accent font-mono text-xs font-bold"
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
                        <div className="text-ludo-xs font-mono text-ink-faint">
                            Win Quick Matches or TeamUp battles — 95% net pots deliver here ready to claim to your wallet or roll into your Match Vault.
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2 max-h-40 overflow-y-auto no-scrollbar pr-1">
                                {vault.claims.map((c) => (
                                    <div
                                        key={c.id}
                                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-recessed border border-line-soft"
                                    >
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-ludo-xs font-bold text-ink-strong uppercase">
                                                {c.claim_type === "match_prize"
                                                    ? "Match / Bet Victory Prize"
                                                    : c.claim_type === "vault_withdraw"
                                                      ? "Vault Withdrawal"
                                                      : "Match / Bet Refund"}
                                            </span>
                                            <span className="text-ludo-xs font-mono text-positive font-bold">
                                                +{c.amount.toLocaleString()} CHIPS
                                            </span>
                                        </div>
                                        {(c.claim_type === "match_prize" || c.claim_type === "match_refund") && (
                                            <button
                                                type="button"
                                                disabled={vault.isActing}
                                                onClick={() => void handleRollPrize(c.id, c.amount)}
                                                className="px-2.5 py-1.5 rounded-lg bg-accent-soft hover:bg-accent/20 border border-accent/30 text-accent font-mono text-ludo-xs font-bold shrink-0"
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
                                className="uppercase tracking-widest font-bold label-chrome text-ludo-xs"
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
                            className="uppercase tracking-widest font-bold label-chrome text-ludo-xs"
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
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-center text-accent shrink-0">
                                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-ludo-sm font-bold text-ink-strong leading-tight truncate">
                                    War Pot Distribution &amp; Escrow Returns
                                </span>
                                <span className="text-ludo-xs font-mono text-ink-faint truncate">
                                    {hasClanClaims
                                        ? `${clanClaims.totalClaimableChips.toLocaleString()} CHIPS ready for pull-claim`
                                        : "Direct non-custodial claims from ClanClaim.sol"}
                                </span>
                            </div>
                        </div>
                        {hasClanClaims && (
                            <span className="text-ludo-sm font-mono font-bold text-positive shrink-0">
                                {clanClaims.totalClaimableChips.toLocaleString()} CHIPS
                            </span>
                        )}
                    </div>

                    {hasClanClaims && (
                        <div className="space-y-2 max-h-40 overflow-y-auto no-scrollbar pr-1">
                            {clanClaims.claims.map((c) => {
                                const labelMap: Record<string, string> = {
                                    war_principal: "War Principal Return",
                                    war_merit_wp: "War Merit Payout (WP)",
                                    war_gov_share: "Governance Split Share",
                                    war_refund: "War Stake Refund",
                                    weekly_vault: "Weekly Vault Reward",
                                    treasury_grant: "Clan Treasury Grant",
                                };
                                const isClaimingThis = clanClaims.claimingId === c.id;
                                return (
                                    <div
                                        key={c.id}
                                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-recessed border border-line-soft"
                                    >
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-ludo-xs font-bold text-ink-strong truncate">
                                                {labelMap[c.claim_type] || c.claim_type}
                                                {c.clan?.tag ? ` · [${c.clan.tag}]` : ""}
                                            </span>
                                            <span className="text-ludo-xs font-mono text-positive font-bold">
                                                +{Number(c.amount).toLocaleString()} CHIPS
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={clanClaims.isClaimingAll || Boolean(clanClaims.claimingId)}
                                            onClick={() =>
                                                void clanClaims
                                                    .claimSingle(c)
                                                    .then(() => getSoundEngine().play("claim_reward_burst"))
                                                    .catch(() => getSoundEngine().play("ui_error"))
                                            }
                                            className="px-2.5 py-1.5 rounded-lg bg-positive/15 hover:bg-positive/25 border border-positive/30 text-positive font-mono text-ludo-xs font-bold shrink-0"
                                        >
                                            {isClaimingThis ? "Claiming…" : "Claim"}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <Button
                        variant="primary"
                        size="md"
                        fullWidth
                        disabled={!hasClanClaims || clanClaims.isClaimingAll || Boolean(clanClaims.claimingId)}
                        onClick={() =>
                            void clanClaims
                                .claimAll()
                                .then(() => getSoundEngine().play("claim_reward_burst"))
                                .catch(() => getSoundEngine().play("ui_error"))
                        }
                        className="uppercase tracking-widest font-bold label-chrome text-ludo-xs"
                    >
                        {clanClaims.isClaimingAll ? (
                            <div className="flex items-center gap-2">
                                <ThinkingOrb state="solving" size={20} />
                                <span>Claiming Clan Rewards…</span>
                            </div>
                        ) : hasClanClaims ? (
                            `Claim All (${clanClaims.totalClaimableChips.toLocaleString()} CHIPS)`
                        ) : (
                            "No Clan Claims Pending"
                        )}
                    </Button>
                </div>
            </section>

            {/* 4B. Season Rewards Merkle Claim (Epoch 1) */}
            {season.entry && (
                <section className="cb-section">
                    <div className="cb-section-head">
                        <span>Season 1 Rewards</span>
                        <Chip size="sm">{season.claimed ? "Claimed" : "Available"}</Chip>
                    </div>
                    <div className="cb-card p-3.5 space-y-3 text-left">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="text-ludo-sm font-bold text-ink-strong leading-tight">
                                    Epoch 1 Leaderboard Allocation
                                </span>
                                <span className="text-ludo-xs font-mono text-ink-faint">
                                    {shortHex(season.entry.wallet)} · Merkle verified
                                </span>
                            </div>
                            <span className="text-ludo-sm font-mono font-bold text-accent">
                                {season.humanAmount}
                            </span>
                        </div>

                        {!season.claimed && (
                            <Button
                                variant="secondary"
                                size="md"
                                fullWidth
                                disabled={!season.canClaim || season.claiming}
                                onClick={() =>
                                    void season
                                        .claim()
                                        .then(() => getSoundEngine().play("claim_reward_burst"))
                                        .catch(() => getSoundEngine().play("ui_error"))
                                }
                                className="uppercase tracking-widest font-bold label-chrome text-ludo-xs"
                            >
                                {season.claiming ? "Claiming Season…" : `Claim ${season.humanAmount}`}
                            </Button>
                        )}
                    </div>
                </section>
            )}

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
                                <span className="text-ludo-sm font-bold text-ink-strong leading-tight">
                                    Legacy Coin Conversion
                                </span>
                                <span className="text-ludo-xs font-mono text-ink-faint">
                                    {shortHex(legacy.entry.wallet)} · 100:1 ratio
                                </span>
                            </div>
                            <span className="text-ludo-sm font-mono font-bold text-accent">
                                {legacy.humanAmount}
                            </span>
                        </div>

                        {!legacy.claimed && (
                            <Button
                                variant="secondary"
                                size="md"
                                fullWidth
                                disabled={!legacy.canClaim || legacy.claiming}
                                onClick={() =>
                                    void legacy
                                        .claim()
                                        .then(() => getSoundEngine().play("claim_reward_burst"))
                                        .catch(() => getSoundEngine().play("ui_error"))
                                }
                                className="uppercase tracking-widest font-bold label-chrome text-ludo-xs"
                            >
                                {legacy.claiming ? "Claiming Legacy…" : `Claim ${legacy.humanAmount}`}
                            </Button>
                        )}
                    </div>
                </section>
            )}

            {/* Error or Status message */}
            {(statusNote || vaultErr || vault.error || clanClaims.error || poolClaimError || legacy.error || season.error) && (
                <div className="p-2.5 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs font-mono text-ink-muted text-left">
                    {vaultErr || vault.error || clanClaims.error || statusNote || poolClaimError || legacy.error || season.error}
                </div>
            )}

            <ComplianceGateModal
                open={compliance.modalOpen}
                status={compliance.status}
                isSubmitting={compliance.isSubmitting}
                error={compliance.error}
                onSubmit={compliance.submitConsent}
                onClose={compliance.closeModal}
                contextLabel="Match Vault Deposit"
            />
        </div>
    );
}
