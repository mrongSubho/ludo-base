"use client";

import React, { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GamePanelShell } from "./GamePanelShell";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClaimAll } from "@/hooks/useChipsPool";
import { chipsAddress, shortHex } from "@/lib/chips";

interface ChipsWalletPanelProps {
    isOpen: boolean;
    onClose: () => void;
    claimablePoolIds?: `0x${string}`[];
    onFeed?: () => void;
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-2.5 mb-2">
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
    </div>
);

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

function ActionTile({
    icon,
    label,
    primary,
    disabled,
    onClick,
    title,
}: {
    icon: React.ReactNode;
    label: string;
    primary?: boolean;
    disabled?: boolean;
    onClick: () => void;
    title?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`flex flex-col items-center gap-2 py-4 rounded-xl transition-all ${
                primary
                    ? "bg-cyan-500/20 border border-cyan-400/50 text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-45 disabled:hover:bg-cyan-500/20"
                    : "bg-white/[0.04] border border-white/10 text-white/85 hover:bg-white/[0.08] disabled:opacity-50"
            }`}
        >
            <span
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    primary
                        ? "bg-cyan-400/30 text-cyan-50 shadow-[0_0_16px_rgba(34,211,238,0.35)]"
                        : "bg-white/10 text-cyan-200"
                }`}
            >
                {icon}
            </span>
            <span className="text-[11px] font-black uppercase tracking-[0.12em]">{label}</span>
        </button>
    );
}

/** In-game CHIPS wallet — GamePanelShell + Settings-style sections. */
export function ChipsWalletPanel({ isOpen, onClose, claimablePoolIds, onFeed }: ChipsWalletPanelProps) {
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
                        scopeClass="ludo-wallet-scope"
                        maxWClass="max-w-[420px]"
                        hideOrbs
                        title={
                            <>
                                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                                CHIPS Wallet
                            </>
                        }
                        subtitle={
                            <>
                                <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase">
                                    Pull-based prizes
                                </span>
                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                <span className="text-[11px] font-black text-white/50 tracking-wide uppercase">
                                    Base Sepolia
                                </span>
                            </>
                        }
                        onClose={onClose}
                    >
                        {/* Balance */}
                        <section>
                            <SectionLabel>Balance</SectionLabel>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                                <div className="text-[10px] font-black uppercase tracking-widest text-white/35">
                                    Total balance
                                </div>
                                <div className="mt-1 flex items-baseline gap-2">
                                    <span className="text-[36px] leading-none font-black text-white tabular-nums">
                                        {bal.configured ? bal.human : "—"}
                                    </span>
                                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-300">
                                        CHIPS
                                    </span>
                                </div>
                            </div>
                        </section>

                        {/* Account */}
                        <section>
                            <SectionLabel>Account</SectionLabel>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                                <div className="flex items-center gap-3 p-3.5">
                                    <div
                                        className="w-9 h-9 rounded-xl flex-shrink-0"
                                        style={{
                                            background:
                                                "linear-gradient(135deg, #0052FF 0%, #6B8CFF 55%, #A8C0FF 100%)",
                                        }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-bold text-white truncate">
                                            {bal.address ? shortHex(bal.address) : "Not connected"}
                                        </div>
                                        <div className="text-[10px] font-bold text-white/35 truncate">
                                            {copied ? "Copied to clipboard" : "Tap copy for full address"}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={copyAddress}
                                        disabled={!bal.address}
                                        className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-white/85 text-[10px] font-black uppercase tracking-wider ring-1 ring-white/10 disabled:opacity-40 shrink-0"
                                    >
                                        Copy
                                    </button>
                                </div>
                                <div className="flex items-center justify-between gap-3 p-3.5">
                                    <div className="min-w-0">
                                        <div className="text-[13px] font-bold text-white">Token</div>
                                        <div className="text-[10px] font-bold text-white/35 font-mono truncate">
                                            {chipsAddress() ? shortHex(chipsAddress() ?? "") : "—"}
                                        </div>
                                    </div>
                                    <span className="text-[12px] font-black tabular-nums text-white/80 shrink-0">
                                        B20
                                    </span>
                                </div>
                            </div>
                        </section>

                        {bal.chainMismatch && (
                            <section>
                                <SectionLabel>Network</SectionLabel>
                                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3.5 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-[13px] font-bold text-amber-100">
                                            Wrong network
                                        </div>
                                        <div className="text-[10px] font-bold text-amber-100/70">
                                            CHIPS reads Base Sepolia
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => bal.switchToChipsChain()}
                                        disabled={bal.switching}
                                        className="px-3 py-2 rounded-xl bg-amber-300/20 text-amber-50 font-black uppercase text-[10px] tracking-wider shrink-0"
                                    >
                                        {bal.switching ? "Switching" : "Switch"}
                                    </button>
                                </div>
                            </section>
                        )}

                        {!bal.configured ? (
                            <section>
                                <SectionLabel>Setup</SectionLabel>
                                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3.5 text-[12px] font-medium text-amber-100">
                                    Wallet env missing — restart <code className="font-bold">npm run dev</code>{" "}
                                    with NEXT_PUBLIC_CHIPS_ADDRESS and NEXT_PUBLIC_MATCH_POOL_ADDRESS.
                                </div>
                            </section>
                        ) : (
                            <>
                                <section>
                                    <SectionLabel>Actions</SectionLabel>
                                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 grid grid-cols-3 gap-3">
                                        <ActionTile
                                            icon={<IconRefresh />}
                                            label={bal.refreshing ? "Sync" : "Refresh"}
                                            disabled={bal.refreshing}
                                            onClick={() => void bal.refresh()}
                                        />
                                        <ActionTile
                                            icon={<IconClaim />}
                                            label={claiming ? "Claiming" : "Claim"}
                                            primary
                                            disabled={claiming || !claimConfigured || !claimReady}
                                            title={
                                                claimReady
                                                    ? "Claim settled match prizes"
                                                    : "No settled prize in this session"
                                            }
                                            onClick={() => void onClaimAll()}
                                        />
                                        <ActionTile
                                            icon={<IconFeed />}
                                            label="Feed"
                                            onClick={() => {
                                                onClose();
                                                onFeed?.();
                                            }}
                                        />
                                    </div>
                                </section>

                                <section>
                                    <SectionLabel>Status</SectionLabel>
                                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                                        <div className="flex items-start justify-between gap-3 p-3.5">
                                            <div className="min-w-0">
                                                <div className="text-[13px] font-bold text-white">
                                                    Prize settlement
                                                </div>
                                                <div className="text-[10px] font-bold text-white/35 leading-relaxed mt-0.5">
                                                    Claim unlocks after the match dispute window.
                                                    Offline games earn no CHIPS.
                                                </div>
                                            </div>
                                            <span
                                                className={`shrink-0 text-[10px] font-black uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border ${
                                                    claimReady
                                                        ? "border-emerald-400/50 text-emerald-200 bg-emerald-400/10"
                                                        : "border-white/15 text-white/45 bg-white/5"
                                                }`}
                                            >
                                                {claimReady ? "Prize ready" : "Idle"}
                                            </span>
                                        </div>
                                    </div>
                                </section>

                                {(note || claimError || bal.error) && (
                                    <div className="text-[11px] font-bold text-red-300/90 px-1">
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
