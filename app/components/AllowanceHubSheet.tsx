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
import { getSoundEngine } from "@/lib/audio/SoundEngine";

interface AllowanceHubSheetProps {
    onOpenRevoke?: () => void;
}

export default function AllowanceHubSheet({ onOpenRevoke }: AllowanceHubSheetProps) {
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
        isPending,
        readError,
        symbol,
        decimals,
        targetName,
    } = currentHook;

    const hasActiveAllowance = allowance > BigInt(0);

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
                    getSoundEngine().play("ui_error");
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
            getSoundEngine().play("allowance_approved");
            setStatusMsg({ text: `${symbol} allowance updated successfully!`, type: "ok" });
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            if (!raw.includes("rejected") && !raw.includes("cancelled")) {
                getSoundEngine().play("ui_error");
                setStatusMsg({ text: raw.slice(0, 120), type: "err" });
            } else {
                getSoundEngine().play("tx_rejected");
            }
        }
    };

    const isChips = selectedToken === "chips";

    return (
        <div className="cb-screen space-y-3.5">
            {/* Token Selector Tabs (CHIPS & USDC only; ETH skipped) */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-surface-recessed border border-line-soft gap-1">
                <button
                    type="button"
                    onClick={() => handleTokenSwitch("chips")}
                    className={`py-2 px-3 rounded-lg text-ludo-xs font-mono font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 ${
                        isChips
                            ? "bg-accent text-accent-ink shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_30%,transparent)]"
                            : "text-ink-muted hover:text-ink-strong hover:bg-surface-hover"
                    }`}
                >
                    <span>CHIPS (Ranked)</span>
                    {chipsState.allowance > BigInt(0) && (
                        <span className={`w-1.5 h-1.5 rounded-full ${isChips ? "bg-accent-ink" : "bg-accent"}`} />
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => handleTokenSwitch("usdc")}
                    className={`py-2 px-3 rounded-lg text-ludo-xs font-mono font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 ${
                        !isChips
                            ? "bg-accent text-accent-ink shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_30%,transparent)]"
                            : "text-ink-muted hover:text-ink-strong hover:bg-surface-hover"
                    }`}
                >
                    <span>USDC (Marketplace)</span>
                    {usdcState.allowance > BigInt(0) && (
                        <span className={`w-1.5 h-1.5 rounded-full ${!isChips ? "bg-accent-ink" : "bg-accent"}`} />
                    )}
                </button>
            </div>

            {/* Approved Contract Section */}
            <section className="cb-section">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-ludo-xs font-mono font-bold tracking-wider uppercase text-ink-muted">
                        Approved Contract
                    </span>
                    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-ludo-xs font-mono font-bold bg-accent-soft border border-accent/30 text-accent">
                        <svg
                            viewBox="0 0 24 24"
                            className="w-3 h-3 text-accent shrink-0"
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
                    </div>
                </div>
                <div className="cb-card p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-center text-accent">
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
                                <span className="text-ludo-sm font-bold text-ink-strong leading-tight">
                                    {targetName}
                                </span>
                                <span className="text-ludo-xs font-mono text-ink-faint">
                                    {spender ? shortHex(spender) : "Not Configured"}
                                </span>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end">
                            <span className="text-ludo-xs font-mono text-ink-faint uppercase tracking-wider">
                                Current Allowance
                            </span>
                            <span className="text-ludo-sm font-mono font-bold text-accent">
                                {allowanceHuman}
                            </span>
                        </div>
                    </div>

                    {/* Single clear message */}
                    <div className="rounded-xl bg-surface-recessed border border-line-soft p-2.5 text-ludo-xs font-mono text-ink-muted leading-relaxed text-left flex items-start gap-2">
                        <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-accent shrink-0 shadow-[0_0_6px_color-mix(in_srgb,var(--accent)_65%,transparent)]" />
                        <span>
                            Set a pre-approved budget so you can enter games instantly with 1 click, skipping repetitive wallet confirmation popups.
                        </span>
                    </div>
                </div>
            </section>

            {/* Allowance Presets Section */}
            <section className="cb-section space-y-2">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-ludo-xs font-mono font-bold tracking-wider uppercase text-ink-muted">
                        Allowance Presets
                    </span>
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
                                              ? "bg-accent-soft border-accent shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
                                              : "bg-surface-recessed border-line-soft hover:border-line-strong"
                                      }`}
                                  >
                                      <div className="flex items-center justify-between w-full">
                                          <span
                                              className={`text-ludo-xs font-mono font-bold label-chrome uppercase ${
                                                  isSelected ? "text-accent" : "text-ink-strong"
                                              }`}
                                          >
                                              {preset.chips === Infinity
                                                  ? "Unlimited"
                                                  : preset.chips >= 1_000_000
                                                  ? `${preset.chips / 1_000_000}M CHIPS`
                                                  : `${preset.chips / 1_000}k CHIPS`}
                                          </span>
                                          {isCurrentActive ? (
                                              <span className="text-ludo-xs font-mono font-bold text-accent bg-accent-soft px-1.5 py-0.5 rounded border border-accent/40 uppercase">
                                                  Active
                                              </span>
                                          ) : isDefault ? (
                                              <span className="text-ludo-xs font-mono font-bold text-ink-muted bg-surface-panel px-1.5 py-0.5 rounded border border-line-soft uppercase">
                                                  Recommended
                                              </span>
                                          ) : null}
                                      </div>
                                      <span className="text-ludo-xs text-ink-faint mt-1 leading-tight">
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
                                              ? "bg-accent-soft border-accent shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
                                              : "bg-surface-recessed border-line-soft hover:border-line-strong"
                                      }`}
                                  >
                                      <div className="flex items-center justify-between w-full">
                                          <span
                                              className={`text-ludo-xs font-mono font-bold label-chrome uppercase ${
                                                  isSelected ? "text-accent" : "text-ink-strong"
                                              }`}
                                          >
                                              {preset.value === Infinity ? "Unlimited" : `$${preset.value} USDC`}
                                          </span>
                                          {isCurrentActive ? (
                                              <span className="text-ludo-xs font-mono font-bold text-accent bg-accent-soft px-1.5 py-0.5 rounded border border-accent/40 uppercase">
                                                  Active
                                              </span>
                                          ) : isDefault ? (
                                              <span className="text-ludo-xs font-mono font-bold text-ink-muted bg-surface-panel px-1.5 py-0.5 rounded border border-line-soft uppercase">
                                                  Recommended
                                              </span>
                                          ) : null}
                                      </div>
                                      <span className="text-ludo-xs text-ink-faint mt-1 leading-tight">
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
                                ? "bg-accent-soft border-accent shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
                                : "bg-surface-recessed border-line-soft hover:border-line-strong"
                        }`}
                    >
                        <span className="text-ludo-xs font-mono font-bold text-ink-strong uppercase">
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
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    className="w-24 px-2 py-1 rounded bg-surface-panel border border-line-strong text-ink-strong text-ludo-xs font-mono outline-none focus:border-accent"
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="text-ludo-xs font-mono text-accent font-bold">{symbol}</span>
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
                            ? "bg-positive/10 border-positive/30 text-positive"
                            : "bg-negative/10 border-negative/30 text-negative"
                    }`}
                >
                    {statusMsg.text}
                </div>
            )}

            {readError && (
                <div className="p-2.5 rounded-xl bg-warn/10 border border-warn/30 text-warn text-ludo-xs font-mono text-left">
                    Note: Failed to read allowance from RPC. Check connection.
                </div>
            )}

            {/* Action Buttons: Set Allowance & Revoke Allowance */}
            <div className="pt-2 flex flex-col gap-2">
                <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    disabled={isPending}
                    onClick={handleApplyAllowance}
                    className="uppercase tracking-widest font-bold label-chrome"
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

                <Button
                    variant="secondary"
                    size="md"
                    fullWidth
                    disabled={isPending}
                    onClick={onOpenRevoke}
                    className="text-negative border-negative/30 hover:border-negative/60 uppercase tracking-widest text-ludo-xs font-bold"
                >
                    Revoke Allowance
                </Button>
            </div>
        </div>
    );
}
