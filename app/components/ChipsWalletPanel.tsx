"use client";

import React, { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useIsDaybreak } from "./GamePanelShell";
import { useClaimAll } from "@/hooks/useChipsPool";
import { chipsAddress, shortHex } from "@/lib/chips";

// re-export hook from shell if needed — use local import of useIsDaybreak
// (GamePanelShell already exports useIsDaybreak)

interface ChipsWalletPanelProps {
    isOpen: boolean;
    onClose: () => void;
    claimablePoolIds?: `0x${string}`[];
    onFeed?: () => void;
}

/**
 * Coinbase Wallet sheet — brand bar, hero balance, account, circular actions.
 * Not a game sandwich panel. Theme-aware via useIsDaybreak (inline paint).
 */
export function ChipsWalletPanel({ isOpen, onClose, claimablePoolIds, onFeed }: ChipsWalletPanelProps) {
    const daybreak = useIsDaybreak();
    const bal = useChipsBalance();
    const { claimMany, isPending: claiming, error: claimError, configured: claimConfigured } =
        useClaimAll();
    const [copied, setCopied] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const copyAddress = useCallback(async () => {
        if (!bal.address) return;
        try {
            await navigator.clipboard.writeText(bal.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {
            setNote("Clipboard blocked");
        }
    }, [bal.address]);

    const onClaimAll = useCallback(async () => {
        if (!claimablePoolIds?.length) {
            setNote("No settled prize in this session");
            return;
        }
        setNote(null);
        await claimMany(claimablePoolIds);
        await bal.refresh();
    }, [claimablePoolIds, claimMany, bal]);

    const claimReady = Boolean(claimablePoolIds?.length);

    // Coinbase Wallet palette
    // Coinbase Wallet: porcelain day sheet / deep-navy night sheet
    const c = daybreak
        ? {
              sheet: "#FFFFFF",
              ink: "#0A0B0D",
              muted: "#5B616E",
              line: "rgba(10,11,13,0.08)",
              chip: "#F5F7FA",
              blue: "#0052FF",
              blueSoft: "rgba(0,82,255,0.12)",
              shadow: "0 24px 80px rgba(0,0,0,0.28)",
              warnBg: "#FFF7E6",
              warnInk: "#8A5A00",
              okBg: "#E8F5E9",
              okInk: "#1B5E20",
              primaryInk: "#FFFFFF",
              overlay: "rgba(10,11,13,0.5)",
          }
        : {
              sheet: "#0C0F16",
              ink: "#F5F7FA",
              muted: "#9AA3B2",
              line: "rgba(255,255,255,0.10)",
              chip: "#161B24",
              blue: "#3B82F6",
              blueSoft: "rgba(59,130,246,0.16)",
              shadow: "0 24px 80px rgba(0,0,0,0.65)",
              warnBg: "rgba(251,191,36,0.12)",
              warnInk: "#FDE68A",
              okBg: "rgba(52,211,153,0.12)",
              okInk: "#6EE7B7",
              primaryInk: "#FFFFFF",
              overlay: "rgba(0,0,0,0.62)",
          };

    if (typeof document === "undefined") return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <div
                    className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-3 sm:p-6"
                    style={{ background: c.overlay }}
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 28, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 380,
                            background: c.sheet,
                            color: c.ink,
                            borderRadius: 24,
                            boxShadow: c.shadow,
                            overflow: "hidden",
                            fontFamily:
                                '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
                        }}
                    >
                        {/* Brand bar */}
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "18px 20px 8px",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div
                                    style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: 999,
                                        background: c.blue,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="8" fill="#fff" />
                                    </svg>
                                </div>
                                <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.02 }}>
                                    Wallet
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close wallet"
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 999,
                                    border: "none",
                                    background: c.chip,
                                    color: c.muted,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                    <path d="M6 6l12 12M18 6 6 18" />
                                </svg>
                            </button>
                        </div>

                        {/* Hero balance */}
                        <div style={{ padding: "4px 24px 8px", textAlign: "center" }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: c.muted }}>
                                Total balance
                            </div>
                            <div
                                style={{
                                    marginTop: 6,
                                    fontSize: 44,
                                    lineHeight: 1.05,
                                    fontWeight: 700,
                                    letterSpacing: -0.03,
                                    color: c.ink,
                                }}
                            >
                                {bal.configured ? bal.human : "—"}
                            </div>
                            <div
                                style={{
                                    display: "inline-block",
                                    marginTop: 8,
                                    padding: "4px 12px",
                                    borderRadius: 999,
                                    background: c.blueSoft,
                                    color: c.blue,
                                    fontSize: 12,
                                    fontWeight: 700,
                                }}
                            >
                                CHIPS
                            </div>
                        </div>

                        {/* Account */}
                        <div style={{ margin: "16px 16px 0" }}>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    padding: "12px 14px",
                                    borderRadius: 16,
                                    background: c.chip,
                                }}
                            >
                                <div
                                    style={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: 12,
                                        flexShrink: 0,
                                        background:
                                            "linear-gradient(135deg, #0052FF 0%, #6B8CFF 55%, #A8C0FF 100%)",
                                    }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize: 15,
                                            fontWeight: 700,
                                            color: c.ink,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {bal.address ? shortHex(bal.address) : "Not connected"}
                                    </div>
                                    <div style={{ marginTop: 2, fontSize: 12, color: c.muted }}>
                                        {copied ? "Copied to clipboard" : "Tap copy for full address"}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={copyAddress}
                                    disabled={!bal.address}
                                    style={{
                                        border: "none",
                                        cursor: "pointer",
                                        padding: "8px 14px",
                                        borderRadius: 10,
                                        background: c.sheet,
                                        color: c.blue,
                                        fontSize: 13,
                                        fontWeight: 700,
                                        boxShadow: `0 0 0 1px ${c.line}`,
                                    }}
                                >
                                    Copy
                                </button>
                            </div>
                        </div>

                        {/* Network + token */}
                        <div
                            style={{
                                margin: "12px 16px 0",
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                fontSize: 12,
                                color: c.muted,
                            }}
                        >
                            <span
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 999,
                                    background: c.blue,
                                }}
                            />
                            Base Sepolia
                            {chipsAddress() ? ` · ${shortHex(chipsAddress() ?? "")}` : ""}
                        </div>

                        {bal.chainMismatch && (
                            <div
                                style={{
                                    margin: "12px 16px 0",
                                    padding: "12px 14px",
                                    borderRadius: 12,
                                    background: c.warnBg,
                                    color: c.warnInk,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    fontSize: 13,
                                }}
                            >
                                <span>Wrong network — switch to Base Sepolia</span>
                                <button
                                    type="button"
                                    onClick={() => bal.switchToChipsChain()}
                                    disabled={bal.switching}
                                    style={{
                                        border: "none",
                                        cursor: "pointer",
                                        padding: "8px 12px",
                                        borderRadius: 10,
                                        background: c.blue,
                                        color: c.primaryInk,
                                        fontSize: 12,
                                        fontWeight: 700,
                                    }}
                                >
                                    {bal.switching ? "…" : "Switch"}
                                </button>
                            </div>
                        )}

                        {/* Actions — circular Coinbase tiles */}
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, 1fr)",
                                gap: 12,
                                padding: "18px 16px 8px",
                            }}
                        >
                            <ActionButton
                                label={bal.refreshing ? "Sync" : "Refresh"}
                                icon={
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                        <path d="M21 12a9 9 0 1 1-2.6-6.4" />
                                        <path d="M21 3v6h-6" />
                                    </svg>
                                }
                                disabled={bal.refreshing}
                                onClick={() => void bal.refresh()}
                                c={c}
                            />
                            <ActionButton
                                label={claiming ? "Claiming" : "Claim"}
                                primary
                                disabled={claiming || !claimConfigured || !claimReady}
                                title={
                                    claimReady
                                        ? "Claim settled match prizes"
                                        : "No settled prize in this session"
                                }
                                onClick={() => void onClaimAll()}
                                c={c}
                                icon={
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 3v12" />
                                        <path d="m7 10 5 5 5-5" />
                                        <path d="M5 21h14" />
                                    </svg>
                                }
                            />
                            <ActionButton
                                label="Feed"
                                onClick={() => {
                                    onClose();
                                    onFeed?.();
                                }}
                                c={c}
                                icon={
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                        <path d="M4 6h16M4 12h10M4 18h16" />
                                    </svg>
                                }
                            />
                        </div>

                        {/* Status */}
                        <div
                            style={{
                                margin: "8px 16px 20px",
                                padding: "12px 14px",
                                borderRadius: 14,
                                background: c.chip,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                            }}
                        >
                            <div style={{ fontSize: 12, lineHeight: 1.45, color: c.muted }}>
                                Prizes settle on-chain. Claim unlocks after the match dispute
                                window.
                            </div>
                            <span
                                style={{
                                    flexShrink: 0,
                                    padding: "5px 10px",
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    background: claimReady ? c.okBg : c.chip,
                                    color: claimReady ? c.okInk : c.muted,
                                }}
                            >
                                {claimReady ? "Prize ready" : "Idle"}
                            </span>
                        </div>

                        {!bal.configured && (
                            <div
                                style={{
                                    margin: "0 16px 16px",
                                    padding: "12px 14px",
                                    borderRadius: 12,
                                    background: c.warnBg,
                                    color: c.warnInk,
                                    fontSize: 12,
                                    lineHeight: 1.45,
                                }}
                            >
                                Wallet env missing — restart npm run dev with
                                NEXT_PUBLIC_CHIPS_ADDRESS.
                            </div>
                        )}

                        {(note || claimError || bal.error) && (
                            <div
                                style={{
                                    margin: "0 16px 16px",
                                    fontSize: 12,
                                    color: "#B3261E",
                                }}
                            >
                                {note || claimError || bal.error}
                            </div>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body,
    );
}

function ActionButton({
    icon,
    label,
    primary,
    disabled,
    onClick,
    title,
    c,
}: {
    icon: React.ReactNode;
    label: string;
    primary?: boolean;
    disabled?: boolean;
    onClick: () => void;
    title?: string;
    c: { chip: string; blue: string; blueSoft: string; ink: string; sheet: string; line: string; primaryInk: string };
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "16px 8px 14px",
                borderRadius: 16,
                border: "none",
                cursor: disabled ? "not-allowed" : "pointer",
                background: c.chip,
                color: primary ? c.blue : c.ink,
                opacity: disabled ? 0.45 : 1,
            }}
        >
            <span
                style={{
                    width: 48,
                    height: 48,
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: primary ? c.blue : c.blueSoft,
                    color: primary ? c.primaryInk : c.blue,
                }}
            >
                {icon}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.02 }}>{label}</span>
        </button>
    );
}

export default ChipsWalletPanel;
