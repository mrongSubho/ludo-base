"use client";

import React, { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GamePanelShell, useIsDaybreak } from "./GamePanelShell";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClaimAll } from "@/hooks/useChipsPool";
import { chipsAddress, shortHex } from "@/lib/chips";

interface ChipsWalletPanelProps {
    isOpen: boolean;
    onClose: () => void;
    claimablePoolIds?: `0x${string}`[];
    onFeed?: () => void;
}

function useWalletPaint() {
    const daybreak = useIsDaybreak();
    return {
        daybreak,
        ink: daybreak ? "#0A0B0D" : "#F5F7FA",
        muted: daybreak ? "rgba(10,11,13,0.62)" : "rgba(245,247,250,0.55)",
        faint: daybreak ? "rgba(10,11,13,0.45)" : "rgba(245,247,250,0.38)",
        accent: daybreak ? "#0E7490" : "#5CE1FF",
        cardBg: daybreak ? "#FFFFFF" : "rgba(255,255,255,0.06)",
        cardBorder: daybreak ? "rgba(10,11,13,0.10)" : "rgba(255,255,255,0.12)",
        btnBg: daybreak ? "#FFFFFF" : "rgba(255,255,255,0.08)",
        primaryBg: daybreak ? "rgba(14,116,144,0.12)" : "rgba(34,211,238,0.18)",
        primaryBorder: daybreak ? "rgba(14,116,144,0.4)" : "rgba(34,211,238,0.5)",
        primaryInk: daybreak ? "#0E7490" : "#E8FFFB",
    };
}

function SectionLabel({ children, paint }: { children: React.ReactNode; paint: ReturnType<typeof useWalletPaint> }) {
    return (
        <div className="flex items-center gap-2.5 mb-2">
            <span
                className="px-2 py-0.5 rounded-md text-[10px] font-black tracking-[0.18em] font-mono uppercase"
                style={{
                    background: paint.cardBg,
                    border: `1px solid ${paint.cardBorder}`,
                    color: paint.muted,
                }}
            >
                {children}
            </span>
            <div
                className="flex-1 h-px"
                style={{ background: `linear-gradient(to right, ${paint.cardBorder}, transparent)` }}
            />
        </div>
    );
}

function IconRefresh() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
        </svg>
    );
}

function IconClaim() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
        </svg>
    );
}

function IconFeed() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 6h16M4 12h10M4 18h16" />
        </svg>
    );
}

export function ChipsWalletPanel({ isOpen, onClose, claimablePoolIds, onFeed }: ChipsWalletPanelProps) {
    const paint = useWalletPaint();
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

    const tile = (primary?: boolean): React.CSSProperties => ({
        background: primary ? paint.primaryBg : paint.cardBg,
        border: `1px solid ${primary ? paint.primaryBorder : paint.cardBorder}`,
        color: primary ? paint.primaryInk : paint.ink,
        borderRadius: 12,
        opacity: 1,
    });

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.18 }}
                    className="fixed inset-0 z-[115] pointer-events-none"
                >
                    <GamePanelShell
                        scopeClass="chips-wallet-panel"
                        maxWidthPx={420}
                        hideOrbs
                        title={
                            <>
                                <span
                                    className="w-2.5 h-2.5 rounded-full"
                                    style={{ background: paint.accent, boxShadow: `0 0 10px ${paint.accent}` }}
                                />
                                <span style={{ color: paint.ink }}>CHIPS Wallet</span>
                            </>
                        }
                        subtitle={
                            <>
                                <span className="text-[11px] font-black tracking-wide uppercase" style={{ color: paint.accent }}>
                                    Pull-based prizes
                                </span>
                                <span className="w-0.5 h-0.5 rounded-full" style={{ background: paint.faint }} />
                                <span className="text-[11px] font-black tracking-wide uppercase" style={{ color: paint.muted }}>
                                    Base Sepolia
                                </span>
                            </>
                        }
                        onClose={onClose}
                    >
                        <section>
                            <SectionLabel paint={paint}>Balance</SectionLabel>
                            <div
                                className="rounded-2xl p-3.5"
                                style={{ background: paint.cardBg, border: `1px solid ${paint.cardBorder}` }}
                            >
                                <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: paint.muted }}>
                                    Total balance
                                </div>
                                <div className="mt-1 flex items-baseline gap-2">
                                    <span className="text-[36px] leading-none font-black tabular-nums" style={{ color: paint.ink }}>
                                        {bal.configured ? bal.human : "—"}
                                    </span>
                                    <span className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: paint.accent }}>
                                        CHIPS
                                    </span>
                                </div>
                            </div>
                        </section>

                        <section>
                            <SectionLabel paint={paint}>Account</SectionLabel>
                            <div
                                className="rounded-2xl overflow-hidden"
                                style={{ background: paint.cardBg, border: `1px solid ${paint.cardBorder}` }}
                            >
                                <div className="flex items-center gap-3 p-3.5" style={{ borderBottom: `1px solid ${paint.cardBorder}` }}>
                                    <div
                                        className="w-9 h-9 rounded-xl flex-shrink-0"
                                        style={{ background: "linear-gradient(135deg, #0052FF 0%, #6B8CFF 55%, #A8C0FF 100%)" }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-bold truncate" style={{ color: paint.ink }}>
                                            {bal.address ? shortHex(bal.address) : "Not connected"}
                                        </div>
                                        <div className="text-[10px] font-bold truncate" style={{ color: paint.faint }}>
                                            {copied ? "Copied to clipboard" : "Tap copy for full address"}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={copyAddress}
                                        disabled={!bal.address}
                                        className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider shrink-0"
                                        style={{
                                            background: paint.btnBg,
                                            color: paint.ink,
                                            border: `1px solid ${paint.cardBorder}`,
                                        }}
                                    >
                                        Copy
                                    </button>
                                </div>
                                <div className="flex items-center justify-between gap-3 p-3.5">
                                    <div className="min-w-0">
                                        <div className="text-[13px] font-bold" style={{ color: paint.ink }}>Token</div>
                                        <div className="text-[10px] font-bold font-mono truncate" style={{ color: paint.faint }}>
                                            {chipsAddress() ? shortHex(chipsAddress() ?? "") : "—"}
                                        </div>
                                    </div>
                                    <span className="text-[12px] font-black tabular-nums shrink-0" style={{ color: paint.ink }}>
                                        B20
                                    </span>
                                </div>
                            </div>
                        </section>

                        {bal.chainMismatch && (
                            <section>
                                <SectionLabel paint={paint}>Network</SectionLabel>
                                <div
                                    className="rounded-2xl p-3.5 flex items-center justify-between gap-3"
                                    style={{
                                        background: paint.daybreak ? "rgba(180,83,9,0.10)" : "rgba(251,191,36,0.12)",
                                        border: `1px solid ${paint.daybreak ? "rgba(180,83,9,0.35)" : "rgba(251,191,36,0.35)"}`,
                                    }}
                                >
                                    <div className="min-w-0">
                                        <div className="text-[13px] font-bold" style={{ color: paint.daybreak ? "#92400E" : "#FDE68A" }}>
                                            Wrong network
                                        </div>
                                        <div className="text-[10px] font-bold" style={{ color: paint.daybreak ? "rgba(146,64,14,0.8)" : "rgba(253,230,138,0.75)" }}>
                                            CHIPS reads Base Sepolia
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => bal.switchToChipsChain()}
                                        disabled={bal.switching}
                                        className="px-3 py-2 rounded-xl font-black uppercase text-[10px] tracking-wider shrink-0"
                                        style={{
                                            background: paint.daybreak ? "rgba(180,83,9,0.15)" : "rgba(251,191,36,0.2)",
                                            color: paint.daybreak ? "#92400E" : "#FEF3C7",
                                        }}
                                    >
                                        {bal.switching ? "Switching" : "Switch"}
                                    </button>
                                </div>
                            </section>
                        )}

                        {!bal.configured ? (
                            <section>
                                <SectionLabel paint={paint}>Setup</SectionLabel>
                                <div
                                    className="rounded-2xl p-3.5 text-[12px] font-medium"
                                    style={{
                                        background: paint.daybreak ? "rgba(180,83,9,0.10)" : "rgba(251,191,36,0.12)",
                                        border: `1px solid ${paint.daybreak ? "rgba(180,83,9,0.35)" : "rgba(251,191,36,0.35)"}`,
                                        color: paint.daybreak ? "#92400E" : "#FDE68A",
                                    }}
                                >
                                    Wallet env missing — restart <code className="font-bold">npm run dev</code> with
                                    NEXT_PUBLIC_CHIPS_ADDRESS and NEXT_PUBLIC_MATCH_POOL_ADDRESS.
                                </div>
                            </section>
                        ) : (
                            <>
                                <section>
                                    <SectionLabel paint={paint}>Actions</SectionLabel>
                                    <div
                                        className="rounded-2xl p-3 grid grid-cols-3 gap-3"
                                        style={{ background: paint.cardBg, border: `1px solid ${paint.cardBorder}` }}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => void bal.refresh()}
                                            disabled={bal.refreshing}
                                            className="flex flex-col items-center gap-2 py-4"
                                            style={{ ...tile(false), opacity: bal.refreshing ? 0.5 : 1 }}
                                        >
                                            <span
                                                className="w-10 h-10 rounded-full flex items-center justify-center"
                                                style={{ background: paint.btnBg, color: paint.accent }}
                                            >
                                                <IconRefresh />
                                            </span>
                                            <span className="text-[11px] font-black uppercase tracking-[0.12em]">
                                                {bal.refreshing ? "Sync" : "Refresh"}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void onClaimAll()}
                                            disabled={claiming || !claimConfigured || !claimReady}
                                            title={claimReady ? "Claim settled match prizes" : "No settled prize in this session"}
                                            className="flex flex-col items-center gap-2 py-4"
                                            style={{
                                                ...tile(true),
                                                opacity: claiming || !claimConfigured || !claimReady ? 0.45 : 1,
                                            }}
                                        >
                                            <span
                                                className="w-10 h-10 rounded-full flex items-center justify-center"
                                                style={{ background: paint.primaryBorder, color: paint.primaryInk }}
                                            >
                                                <IconClaim />
                                            </span>
                                            <span className="text-[11px] font-black uppercase tracking-[0.12em]">
                                                {claiming ? "Claiming" : "Claim"}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onClose();
                                                onFeed?.();
                                            }}
                                            className="flex flex-col items-center gap-2 py-4"
                                            style={tile(false)}
                                        >
                                            <span
                                                className="w-10 h-10 rounded-full flex items-center justify-center"
                                                style={{ background: paint.btnBg, color: paint.accent }}
                                            >
                                                <IconFeed />
                                            </span>
                                            <span className="text-[11px] font-black uppercase tracking-[0.12em]">Feed</span>
                                        </button>
                                    </div>
                                </section>

                                <section>
                                    <SectionLabel paint={paint}>Status</SectionLabel>
                                    <div
                                        className="rounded-2xl overflow-hidden"
                                        style={{ background: paint.cardBg, border: `1px solid ${paint.cardBorder}` }}
                                    >
                                        <div className="flex items-start justify-between gap-3 p-3.5">
                                            <div className="min-w-0">
                                                <div className="text-[13px] font-bold" style={{ color: paint.ink }}>
                                                    Prize settlement
                                                </div>
                                                <div className="text-[10px] font-bold leading-relaxed mt-0.5" style={{ color: paint.faint }}>
                                                    Claim unlocks after the match dispute window. Offline games earn no CHIPS.
                                                </div>
                                            </div>
                                            <span
                                                className="shrink-0 text-[10px] font-black uppercase tracking-[0.14em] px-2.5 py-1 rounded-full"
                                                style={{
                                                    background: claimReady
                                                        ? paint.daybreak ? "rgba(21,128,61,0.12)" : "rgba(52,211,153,0.12)"
                                                        : paint.btnBg,
                                                    border: `1px solid ${claimReady ? "#15803D" : paint.cardBorder}`,
                                                    color: claimReady ? (paint.daybreak ? "#15803D" : "#6EE7B7") : paint.muted,
                                                }}
                                            >
                                                {claimReady ? "Prize ready" : "Idle"}
                                            </span>
                                        </div>
                                    </div>
                                </section>

                                {(note || claimError || bal.error) && (
                                    <div className="text-[11px] font-bold px-1" style={{ color: "#F87171" }}>
                                        {note || claimError || bal.error}
                                    </div>
                                )}
                            </>
                        )}
                    </GamePanelShell>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default ChipsWalletPanel;
