"use client";

import React, { useState } from "react";
import { useTokenAllowance } from "@/hooks/useChipsAllowance";
import { shortHex } from "@/lib/chips";
import Button from "./Button";
import { ThinkingOrb } from "./ThinkingOrb";

interface RevokeAllowanceSheetProps {
    onBack?: () => void;
}

export default function RevokeAllowanceSheet({ onBack }: RevokeAllowanceSheetProps) {
    const chipsState = useTokenAllowance("chips");
    const usdcState = useTokenAllowance("usdc");

    const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);
    const [revokingToken, setRevokingToken] = useState<"chips" | "usdc" | "all" | null>(null);

    const hasChipsAllowance = chipsState.allowance > BigInt(0);
    const hasUsdcAllowance = usdcState.allowance > BigInt(0);
    const anyAllowanceActive = hasChipsAllowance || hasUsdcAllowance;
    const isPending = chipsState.isPending || usdcState.isPending || revokingToken !== null;

    const handleRevokeSingle = async (token: "chips" | "usdc") => {
        try {
            setStatusMsg(null);
            setRevokingToken(token);
            const hook = token === "chips" ? chipsState : usdcState;
            await hook.revoke();
            setStatusMsg({ text: `${hook.symbol} allowance revoked to 0.`, type: "ok" });
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            if (!raw.includes("rejected") && !raw.includes("cancelled")) {
                setStatusMsg({ text: raw.slice(0, 120), type: "err" });
            }
        } finally {
            setRevokingToken(null);
        }
    };

    const handleRevokeAll = async () => {
        try {
            setStatusMsg(null);
            setRevokingToken("all");
            if (hasChipsAllowance) {
                await chipsState.revoke();
            }
            if (hasUsdcAllowance) {
                await usdcState.revoke();
            }
            setStatusMsg({ text: "All token allowances revoked to 0.", type: "ok" });
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            if (!raw.includes("rejected") && !raw.includes("cancelled")) {
                setStatusMsg({ text: raw.slice(0, 120), type: "err" });
            }
        } finally {
            setRevokingToken(null);
        }
    };

    return (
        <div className="cb-screen space-y-3.5">
            {/* What is Revoking Educational Callout */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 text-left space-y-2">
                <div className="flex items-center gap-1.5 text-ludo-xs font-bold text-white/90">
                    <svg
                        viewBox="0 0 24 24"
                        className="w-4 h-4 text-cyan-400 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4" />
                        <path d="M12 8h.01" />
                    </svg>
                    <span>What is Revoking?</span>
                </div>
                <p className="text-ludo-xs text-white/60 leading-relaxed">
                    Revoking resets your pre-approved budget back to 0. Your funds are never touched and stay completely safe in your wallet—you will simply be prompted by your wallet to approve each transaction individually.
                </p>
            </div>

            {/* Active Budgets Section */}
            <section className="cb-section space-y-2">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-ludo-xs font-mono font-bold tracking-wider uppercase text-white/60">
                        Active Budgets
                    </span>
                    <span className="text-ludo-xs font-mono text-white/40">
                        {anyAllowanceActive ? "Budgets Active" : "No Active Budgets"}
                    </span>
                </div>

                {/* CHIPS Spender Card */}
                <div className="cb-card p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                                <svg
                                    viewBox="0 0 24 24"
                                    className="w-3.5 h-3.5"
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
                                    Ranked Matches (CHIPS)
                                </span>
                                <span className="text-ludo-xs font-mono text-white/40">
                                    {chipsState.spender ? shortHex(chipsState.spender) : "Not Configured"}
                                </span>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end">
                            <span className="text-ludo-xs font-mono text-white/40 uppercase tracking-wider">
                                Current
                            </span>
                            <span className={`text-ludo-sm font-mono font-bold ${hasChipsAllowance ? "text-cyan-300" : "text-white/40"}`}>
                                {chipsState.allowanceHuman}
                            </span>
                        </div>
                    </div>

                    <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        disabled={isPending || !hasChipsAllowance}
                        onClick={() => handleRevokeSingle("chips")}
                        className="text-rose-400 hover:text-rose-300 border-rose-500/30 hover:border-rose-500/50 uppercase tracking-widest text-ludo-xs font-bold disabled:opacity-40"
                    >
                        {revokingToken === "chips" ? (
                            <div className="flex items-center gap-1.5">
                                <ThinkingOrb state="solving" size={20} />
                                <span>Revoking CHIPS…</span>
                            </div>
                        ) : hasChipsAllowance ? (
                            "Revoke CHIPS Allowance (Set to 0)"
                        ) : (
                            "CHIPS Allowance is 0"
                        )}
                    </Button>
                </div>

                {/* USDC Spender Card */}
                <div className="cb-card p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                                <svg
                                    viewBox="0 0 24 24"
                                    className="w-3.5 h-3.5"
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
                                    Marketplace Items (USDC)
                                </span>
                                <span className="text-ludo-xs font-mono text-white/40">
                                    {usdcState.spender ? shortHex(usdcState.spender) : "Not Configured"}
                                </span>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end">
                            <span className="text-ludo-xs font-mono text-white/40 uppercase tracking-wider">
                                Current
                            </span>
                            <span className={`text-ludo-sm font-mono font-bold ${hasUsdcAllowance ? "text-cyan-300" : "text-white/40"}`}>
                                {usdcState.allowanceHuman}
                            </span>
                        </div>
                    </div>

                    <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        disabled={isPending || !hasUsdcAllowance}
                        onClick={() => handleRevokeSingle("usdc")}
                        className="text-rose-400 hover:text-rose-300 border-rose-500/30 hover:border-rose-500/50 uppercase tracking-widest text-ludo-xs font-bold disabled:opacity-40"
                    >
                        {revokingToken === "usdc" ? (
                            <div className="flex items-center gap-1.5">
                                <ThinkingOrb state="solving" size={20} />
                                <span>Revoking USDC…</span>
                            </div>
                        ) : hasUsdcAllowance ? (
                            "Revoke USDC Allowance (Set to 0)"
                        ) : (
                            "USDC Allowance is 0"
                        )}
                    </Button>
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

            {/* Global Actions */}
            <div className="pt-2 flex flex-col gap-2">
                {anyAllowanceActive && (
                    <Button
                        variant="primary"
                        size="md"
                        fullWidth
                        disabled={isPending}
                        onClick={handleRevokeAll}
                        className="!bg-rose-500 !hover:bg-rose-400 !text-white uppercase tracking-widest font-black"
                    >
                        {revokingToken === "all" ? (
                            <div className="flex items-center gap-2">
                                <ThinkingOrb state="solving" size={20} />
                                <span>Revoking All Allowances…</span>
                            </div>
                        ) : (
                            "Revoke All Allowances (Reset to 0)"
                        )}
                    </Button>
                )}

                {onBack && (
                    <Button
                        variant="secondary"
                        size="md"
                        fullWidth
                        disabled={isPending}
                        onClick={onBack}
                        className="uppercase tracking-widest text-ludo-xs font-bold"
                    >
                        Back to Token Allowances
                    </Button>
                )}
            </div>
        </div>
    );
}
