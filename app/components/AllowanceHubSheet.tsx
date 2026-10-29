"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { formatUnits, parseUnits } from "viem";
import {
    useTokenAllowance,
    CHIPS_ALLOWANCE_PRESETS,
    USDC_ALLOWANCE_PRESETS,
    type AllowanceTokenType,
} from "@/hooks/useChipsAllowance";
import { shortHex } from "@/lib/chips";
import Button from "./Button";
import { ThinkingOrb } from "./ThinkingOrb";

export default function AllowanceHubSheet() {
    const [selectedToken, setSelectedToken] = useState<AllowanceTokenType>("chips");

    const chipsState = useTokenAllowance("chips");
    const usdcState = useTokenAllowance("usdc");

    const currentHook = selectedToken === "chips" ? chipsState : usdcState;
    const {
        spender,
        allowance,
        allowanceHuman,
        isUnlimited,
        approve,
        revoke,
        isPending,
        mode,
        readError,
        symbol,
        decimals,
        targetName,
    } = currentHook;

    const hasActiveAllowance = allowance > BigInt(0);
    const anyAllowanceActive = chipsState.allowance > BigInt(0) || usdcState.allowance > BigInt(0);

    const activePreset = useMemo<number | "custom" | null>(() => {
        if (!hasActiveAllowance) return null;
        if (isUnlimited) return Infinity;

        if (selectedToken === "chips") {
            for (const preset of CHIPS_ALLOWANCE_PRESETS) {
                if (!preset.isUnlimited && allowance === preset.amount) {
                    return preset.chips;
                }
            }
            if (allowance > BigInt(100_000) * BigInt(10 ** 18) && allowance <= BigInt(1_000_000) * BigInt(10 ** 18)) {
                return 1_000_000;
            }
            if (allowance > BigInt(10_000) * BigInt(10 ** 18) && allowance <= BigInt(100_000) * BigInt(10 ** 18)) {
                return 100_000;
            }
            if (allowance <= BigInt(10_000) * BigInt(10 ** 18)) {
                return 10_000;
            }
        } else {
            for (const preset of USDC_ALLOWANCE_PRESETS) {
                if (!preset.isUnlimited && allowance === preset.amount) {
                    return preset.value;
                }
            }
            if (allowance > BigInt(20) * BigInt(10 ** 6) && allowance <= BigInt(50) * BigInt(10 ** 6)) {
                return 50;
            }
            if (allowance > BigInt(5) * BigInt(10 ** 6) && allowance <= BigInt(20) * BigInt(10 ** 6)) {
                return 20;
            }
            if (allowance <= BigInt(5) * BigInt(10 ** 6)) {
                return 5;
            }
        }

        return "custom";
    }, [hasActiveAllowance, isUnlimited, allowance, selectedToken]);

    const defaultPreset = selectedToken === "chips" ? 100_000 : 20;
    const [selectedPreset, setSelectedPreset] = useState<number | "custom">(defaultPreset);
    const [customAmount, setCustomAmount] = useState<string>("");
    const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);
    const userInteractedRef = useRef(false);

    // Sync selectedPreset to activePreset or default whenever token changes or on-chain allowance loads
    useEffect(() => {
        if (userInteractedRef.current) return;
        if (activePreset !== null) {
            setSelectedPreset(activePreset);
            if (activePreset === "custom") {
                setCustomAmount(formatUnits(allowance, decimals));
            }
        } else {
            setSelectedPreset(defaultPreset);
        }
    }, [activePreset, allowance, decimals, defaultPreset, selectedToken]);

    const handleTokenSwitch = (token: AllowanceTokenType) => {
        userInteractedRef.current = false;
        setSelectedToken(token);
        setStatusMsg(null);
    };

    const handleApplyAllowance = async () => {
        try {
            setStatusMsg(null);
            let targetAmount: bigint;

            if (selectedPreset === "custom") {
                const parsed = Number(customAmount);
                if (!parsed || parsed <= 0) {
                    setStatusMsg({ text: `Please enter a valid ${symbol} amount`, type: "err" });
                    return;
                }
                targetAmount = parseUnits(customAmount, decimals);
            } else if (selectedPreset === Infinity) {
                targetAmount = (BigInt(1) << BigInt(256)) - BigInt(1);
            } else {
                targetAmount = parseUnits(String(selectedPreset), decimals);
            }

            await approve(targetAmount);
            userInteractedRef.current = false;
            setStatusMsg({ text: `${symbol} allowance updated successfully!`, type: "ok" });
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
            userInteractedRef.current = false;
            setStatusMsg({ text: `${symbol} allowance revoked to 0.`, type: "ok" });
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            if (!raw.includes("rejected") && !raw.includes("cancelled")) {
                setStatusMsg({ text: raw.slice(0, 120), type: "err" });
            }
        }
    };

    const handleRevokeAll = async () => {
        try {
            setStatusMsg(null);
            if (chipsState.allowance > BigInt(0)) {
                await chipsState.revoke();
            }
            if (usdcState.allowance > BigInt(0)) {
                await usdcState.revoke();
            }
            userInteractedRef.current = false;
            setStatusMsg({ text: "All token allowances revoked to 0.", type: "ok" });
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            if (!raw.includes("rejected") && !raw.includes("cancelled")) {
                setStatusMsg({ text: raw.slice(0, 120), type: "err" });
            }
        }
    };

    const isChips = selectedToken === "chips";

    return (
        <div className="cb-screen space-y-3.5">
            {/* Top Subtitle Banner */}
            <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/20 p-3 text-left">
                <p className="text-ludo-xs font-mono text-cyan-200/90 leading-relaxed">
                    Set a pre-approved budget so you can enter games instantly with 1 click, skipping repetitive wallet confirmation popups.
                </p>
            </div>

            {/* Token Selector Tabs (CHIPS & USDC only; ETH skipped) */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-white/[0.04] border border-white/10 gap-1">
                <button
                    type="button"
                    onClick={() => handleTokenSwitch("chips")}
                    className={`py-2 px-3 rounded-lg text-ludo-xs font-mono font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 ${
                        isChips
                            ? "bg-cyan-500 text-black shadow-[0_0_12px_rgba(0,229,255,0.4)]"
                            : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>CHIPS (Ranked)</span>
                    {chipsState.allowance > BigInt(0) && (
                        <span className={`w-1.5 h-1.5 rounded-full ${isChips ? "bg-black" : "bg-cyan-400"}`} />
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => handleTokenSwitch("usdc")}
                    className={`py-2 px-3 rounded-lg text-ludo-xs font-mono font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 ${
                        !isChips
                            ? "bg-cyan-500 text-black shadow-[0_0_12px_rgba(0,229,255,0.4)]"
                            : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                >
                    <span>USDC (Marketplace)</span>
                    {usdcState.allowance > BigInt(0) && (
                        <span className={`w-1.5 h-1.5 rounded-full ${!isChips ? "bg-black" : "bg-cyan-400"}`} />
                    )}
                </button>
            </div>

            {/* Approved Contract Section */}
            <section className="cb-section">
                <div className="cb-section-head flex items-center justify-between">
                    <span>Approved Contract</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-ludo-xs font-mono font-bold bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
                        <svg
                            viewBox="0 0 24 24"
                            className="w-3 h-3 text-cyan-400"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <path d="m9 12 2 2 4-4" />
                        </svg>
                        <span>Verified Game Engine</span>
                    </span>
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
                                    {targetName}
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

                    {/* Non-crypto friendly notice */}
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5 text-ludo-xs font-mono text-white/60 leading-relaxed text-left flex items-start gap-2">
                        <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_6px_rgba(0,229,255,0.8)]" />
                        <span>
                            {mode === "ingame"
                                ? "In-game CDP Wallet: Approvals are handled smoothly in the background. You can adjust your budget anytime."
                                : "External Wallet: Pre-approving a budget lets you play or purchase with 1 click without waiting for approval popups before every match."}
                        </span>
                    </div>
                </div>
            </section>

            {/* Allowance Presets Section */}
            <section className="cb-section space-y-2">
                <div className="cb-section-head">
                    <span>Allowance Presets</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    {isChips
                        ? CHIPS_ALLOWANCE_PRESETS.map((preset) => {
                              const isSelected = selectedPreset === preset.chips;
                              const isCurrentActive = activePreset === preset.chips;
                              const isDefault = preset.chips === 100_000 && !hasActiveAllowance;

                              return (
                                  <button
                                      key={preset.label}
                                      type="button"
                                      onClick={() => {
                                          userInteractedRef.current = true;
                                          setSelectedPreset(preset.chips);
                                      }}
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
                                              {preset.chips === Infinity
                                                  ? "Unlimited"
                                                  : preset.chips >= 1_000_000
                                                  ? `${preset.chips / 1_000_000}M CHIPS`
                                                  : `${preset.chips / 1_000}k CHIPS`}
                                          </span>
                                          {isCurrentActive ? (
                                              <span className="text-ludo-xs font-mono font-bold text-cyan-400 bg-cyan-500/15 px-1.5 py-0.5 rounded border border-cyan-500/40 uppercase">
                                                  Active
                                              </span>
                                          ) : isDefault ? (
                                              <span className="text-ludo-xs font-mono font-bold text-white/50 bg-white/5 px-1.5 py-0.5 rounded border border-white/10 uppercase">
                                                  Recommended
                                              </span>
                                          ) : null}
                                      </div>
                                      <span className="text-ludo-xs text-white/40 mt-1 leading-tight">
                                          {preset.hint}
                                      </span>
                                  </button>
                              );
                          })
                        : USDC_ALLOWANCE_PRESETS.map((preset) => {
                              const isSelected = selectedPreset === preset.value;
                              const isCurrentActive = activePreset === preset.value;
                              const isDefault = preset.value === 20 && !hasActiveAllowance;

                              return (
                                  <button
                                      key={preset.label}
                                      type="button"
                                      onClick={() => {
                                          userInteractedRef.current = true;
                                          setSelectedPreset(preset.value);
                                      }}
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
                                              {preset.value === Infinity ? "Unlimited" : `$${preset.value} USDC`}
                                          </span>
                                          {isCurrentActive ? (
                                              <span className="text-ludo-xs font-mono font-bold text-cyan-400 bg-cyan-500/15 px-1.5 py-0.5 rounded border border-cyan-500/40 uppercase">
                                                  Active
                                              </span>
                                          ) : isDefault ? (
                                              <span className="text-ludo-xs font-mono font-bold text-white/50 bg-white/5 px-1.5 py-0.5 rounded border border-white/10 uppercase">
                                                  Recommended
                                              </span>
                                          ) : null}
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
                        onClick={() => {
                            userInteractedRef.current = true;
                            setSelectedPreset("custom");
                        }}
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
                                    step={isChips ? "1000" : "1"}
                                    placeholder={isChips ? "e.g. 50000" : "e.g. 15"}
                                    value={customAmount}
                                    onChange={(e) => setCustomAmount(e.target.value)}
                                    className="w-24 px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-ludo-xs font-mono outline-none focus:border-cyan-400"
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="text-ludo-xs font-mono text-cyan-400 font-bold">{symbol}</span>
                            </div>
                        )}
                    </button>
                </div>
            </section>

            {/* Clear, Friendly Revoke Explanation Box */}
            <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 text-left space-y-1.5">
                <div className="flex items-center gap-1.5 text-ludo-xs font-bold text-white/80">
                    <svg
                        viewBox="0 0 24 24"
                        className="w-3.5 h-3.5 text-cyan-400 shrink-0"
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
                <p className="text-ludo-xs text-white/50 leading-relaxed">
                    Revoking resets your pre-approved budget back to 0. Your funds are never touched and stay completely safe in your wallet—you will simply be prompted by your wallet to approve each transaction individually.
                </p>
            </div>

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
                                    ? isChips
                                        ? `${customAmount} CHIPS`
                                        : `$${customAmount} USDC`
                                    : "Custom"
                                : selectedPreset === Infinity
                                ? "Unlimited"
                                : isChips
                                ? selectedPreset >= 1_000_000
                                    ? `${selectedPreset / 1_000_000}M CHIPS`
                                    : `${selectedPreset / 1_000}k CHIPS`
                                : `$${selectedPreset} USDC`
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
                        Revoke {symbol} Allowance (Set to 0)
                    </Button>
                )}

                {anyAllowanceActive && (
                    <div className="flex justify-center pt-0.5">
                        <button
                            type="button"
                            disabled={isPending}
                            onClick={handleRevokeAll}
                            className="text-ludo-xs font-mono text-rose-400/70 hover:text-rose-300 underline uppercase tracking-wider py-1 transition-colors"
                        >
                            Revoke All Token Allowances
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
