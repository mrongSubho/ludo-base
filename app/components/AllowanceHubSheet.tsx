"use client";

import React, { useState } from "react";
import { parseUnits } from "viem";
import { useChipsAllowance, ALLOWANCE_PRESETS } from "@/hooks/useChipsAllowance";
import { shortHex } from "@/lib/chips";
import Button from "./Button";
import Chip from "./Chip";
import { ThinkingOrb } from "./ThinkingOrb";

export default function AllowanceHubSheet() {
    const {
        spender,
        allowance,
        allowanceHuman,
        approve,
        revoke,
        isPending,
        mode,
        readError,
    } = useChipsAllowance();

    const [selectedPreset, setSelectedPreset] = useState<number | "custom">(500);
    const [customAmount, setCustomAmount] = useState<string>("");
    const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);

    const hasActiveAllowance = allowance > BigInt(0);

    const handleApplyAllowance = async () => {
        try {
            setStatusMsg(null);
            let targetAmount: bigint;

            if (selectedPreset === "custom") {
                const parsed = Number(customAmount);
                if (!parsed || parsed <= 0) {
                    setStatusMsg({ text: "Please enter a valid CHIPS amount", type: "err" });
                    return;
                }
                targetAmount = parseUnits(customAmount, 18);
            } else if (selectedPreset === Infinity) {
                targetAmount = (BigInt(1) << BigInt(256)) - BigInt(1);
            } else {
                targetAmount = parseUnits(String(selectedPreset), 18);
            }

            await approve(targetAmount);
            setStatusMsg({ text: "CHIPS allowance updated successfully!", type: "ok" });
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            if (!raw.includes("rejected") && !raw.includes("cancelled")) {
                setStatusMsg({ text: raw.slice(0, 120), type: "err" });
            }
        }
    };

    const handleRevoke = async () => {
        try {
            setStatusMsg(null);
            await revoke();
            setStatusMsg({ text: "Spender allowance revoked to 0.", type: "ok" });
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            if (!raw.includes("rejected") && !raw.includes("cancelled")) {
                setStatusMsg({ text: raw.slice(0, 120), type: "err" });
            }
        }
    };

    return (
        <div className="cb-screen space-y-4">
            {/* Spender Authorization Card */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Ranked Spender</span>
                    <Chip size="sm">{hasActiveAllowance ? "Authorized" : "Not Set"}</Chip>
                </div>
                <div className="cb-card p-3.5 space-y-3">
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
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                    <path d="m9 12 2 2 4-4" />
                                </svg>
                            </div>
                            <div className="flex flex-col text-left">
                                <span className="text-ludo-sm font-bold text-white leading-tight">
                                    MatchPool (Ranked)
                                </span>
                                <span className="text-ludo-xs font-mono text-white/40">
                                    {spender ? shortHex(spender) : "Not Configured"}
                                </span>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end">
                            <span className="text-ludo-xs font-mono text-white/40 uppercase tracking-wider">
                                Current Allowance
                            </span>
                            <span className="text-ludo-sm font-mono font-bold text-cyan-300">
                                {allowanceHuman}
                            </span>
                        </div>
                    </div>

                    {/* Mode Notice */}
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5 text-ludo-xs font-mono text-white/60 leading-relaxed text-left flex items-start gap-2">
                        <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_6px_rgba(0,229,255,0.8)]" />
                        <span>
                            {mode === "ingame"
                                ? "In-game CDP Smart Account: Multi-call UserOps batch approvals automatically. You can also pre-authorize budgets here."
                                : "External Wallet: Pre-authorizing allowance prevents signing approval transactions repeatedly before every match."}
                        </span>
                    </div>
                </div>
            </section>

            {/* Tactical Budget Selector */}
            <section className="cb-section space-y-2">
                <div className="cb-section-head">
                    <span>Pre-Authorize Match Budget</span>
                    <span className="text-ludo-xs font-mono text-white/40">Option A: Tactical</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    {ALLOWANCE_PRESETS.map((preset) => {
                        const isSelected = selectedPreset === preset.chips;
                        return (
                            <button
                                key={preset.label}
                                type="button"
                                onClick={() => setSelectedPreset(preset.chips)}
                                className={`flex flex-col items-start p-2.5 rounded-xl border transition-all text-left ${
                                    isSelected
                                        ? "bg-cyan-500/10 border-cyan-400 shadow-[0_0_12px_rgba(0,229,255,0.15)]"
                                        : "bg-white/[0.02] border-white/10 hover:border-white/20"
                                }`}
                            >
                                <div className="flex items-center justify-between w-full">
                                    <span
                                        className={`text-ludo-xs font-mono font-black uppercase ${
                                            isSelected ? "text-cyan-300" : "text-white/80"
                                        }`}
                                    >
                                        {preset.chips === Infinity ? "Unlimited" : `${preset.chips} CHIPS`}
                                    </span>
                                    {preset.recommended && (
                                        <span className="text-ludo-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30">
                                            Rec
                                        </span>
                                    )}
                                </div>
                                <span className="text-ludo-xs text-white/40 mt-1 leading-tight">
                                    {preset.hint}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Custom Amount Option */}
                <div className="pt-1">
                    <button
                        type="button"
                        onClick={() => setSelectedPreset("custom")}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all ${
                            selectedPreset === "custom"
                                ? "bg-cyan-500/10 border-cyan-400 shadow-[0_0_12px_rgba(0,229,255,0.15)]"
                                : "bg-white/[0.02] border-white/10 hover:border-white/20"
                        }`}
                    >
                        <span className="text-ludo-xs font-mono font-bold text-white/80 uppercase">
                            Custom Amount
                        </span>
                        {selectedPreset === "custom" && (
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="number"
                                    min="1"
                                    step="10"
                                    placeholder="e.g. 250"
                                    value={customAmount}
                                    onChange={(e) => setCustomAmount(e.target.value)}
                                    className="w-24 px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-ludo-xs font-mono outline-none focus:border-cyan-400"
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="text-ludo-xs font-mono text-cyan-400 font-bold">CHIPS</span>
                            </div>
                        )}
                    </button>
                </div>
            </section>

            {/* Status Message */}
            {statusMsg && (
                <div
                    className={`p-2.5 rounded-xl border text-ludo-xs font-mono text-left ${
                        statusMsg.type === "ok"
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                            : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                    }`}
                >
                    {statusMsg.text}
                </div>
            )}

            {readError && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-ludo-xs font-mono text-left">
                    Note: Failed to read allowance from RPC. Check connection.
                </div>
            )}

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col gap-2">
                <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    disabled={isPending}
                    onClick={handleApplyAllowance}
                    className="uppercase tracking-widest font-black"
                >
                    {isPending ? (
                        <div className="flex items-center gap-2">
                            <ThinkingOrb state="solving" size={20} />
                            <span>Updating Allowance…</span>
                        </div>
                    ) : (
                        `Set ${
                            selectedPreset === "custom"
                                ? customAmount
                                    ? `${customAmount} CHIPS`
                                    : "Custom"
                                : selectedPreset === Infinity
                                ? "Unlimited"
                                : `${selectedPreset} CHIPS`
                        } Allowance`
                    )}
                </Button>

                {hasActiveAllowance && (
                    <Button
                        variant="secondary"
                        size="md"
                        fullWidth
                        disabled={isPending}
                        onClick={handleRevoke}
                        className="text-rose-400 hover:text-rose-300 border-rose-500/30 hover:border-rose-500/50 uppercase tracking-widest text-ludo-xs font-bold"
                    >
                        Revoke Allowance (Set to 0)
                    </Button>
                )}
            </div>
        </div>
    );
}
