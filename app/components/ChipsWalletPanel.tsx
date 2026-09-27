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

function IconRefresh() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
        </svg>
    );
}

function IconClaim() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
        </svg>
    );
}

function IconFeed() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 6h16M4 12h10M4 18h16" />
        </svg>
    );
}

/**
 * In-game CHIPS wallet — same GamePanelShell as Settings/Messages (bg + size).
 * Hero balance + account + REFRESH / CLAIM / FEED (Coinbase layout, game chrome).
 */
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
                        {/* Hero balance */}
                        <section className="rounded-[22px] border border-white/10 bg-white/5 px-5 py-6 text-center">
                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/50">
                                Total balance
                            </div>
                            <div className="mt-2 text-[42px] leading-none font-black text-white tabular-nums">
                                {bal.configured ? bal.human : "—"}
                            </div>
                            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-cyan-400/40 bg-cyan-500/15">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300" />
                                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-200">
                                    CHIPS
                                </span>
                            </div>
                        </section>

                        {/* Account row */}
                        <section className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-11 h-11 rounded-[14px] flex-shrink-0"
                                    style={{
                                        background:
                                            "linear-gradient(135deg, #0052FF 0%, #6B8CFF 55%, #A8C0FF 100%)",
                                    }}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-white truncate">
                                        {bal.address ? shortHex(bal.address) : "Not connected"}
                                    </div>
                                    <div className="text-[11px] text-white/45 mt-0.5">
                                        {copied ? "Copied to clipboard" : "Tap copy for full address"}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={copyAddress}
                                    disabled={!bal.address}
                                    className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/85 text-[11px] font-black uppercase tracking-wider ring-1 ring-white/10 disabled:opacity-40"
                                >
                                    Copy
                                </button>
                            </div>
                            <div className="mt-2.5 text-[10px] font-mono text-white/35 break-all">
                                token {shortHex(chipsAddress() ?? "")}
                            </div>
                        </section>

                        {bal.chainMismatch && (
                            <section className="rounded-[14px] border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[12px] text-amber-100 flex items-center justify-between gap-3">
                                <span>Wallet is on the wrong network.</span>
                                <button
                                    type="button"
                                    onClick={() => bal.switchToChipsChain()}
                                    disabled={bal.switching}
                                    className="px-3 py-1.5 rounded-lg bg-amber-300/20 text-amber-50 font-bold uppercase text-[10px] tracking-wider"
                                >
                                    {bal.switching ? "Switching" : "Switch"}
                                </button>
                            </section>
                        )}

                        {!bal.configured ? (
                            <section className="rounded-[14px] border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[12px] text-amber-100">
                                Wallet env missing — restart <code className="font-bold">npm run dev</code> with
                                NEXT_PUBLIC_CHIPS_ADDRESS and NEXT_PUBLIC_MATCH_POOL_ADDRESS.
                            </section>
                        ) : (
                            <>
                                {/* Actions */}
                                <section className="grid grid-cols-3 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => void bal.refresh()}
                                        disabled={bal.refreshing}
                                        className="flex flex-col items-center gap-2 rounded-[18px] border border-white/10 bg-white/5 py-4 text-white/85 hover:bg-white/10 disabled:opacity-50"
                                    >
                                        <span className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-cyan-200">
                                            <IconRefresh />
                                        </span>
                                        <span className="text-[11px] font-bold uppercase tracking-[0.12em]">
                                            {bal.refreshing ? "Sync" : "Refresh"}
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => void onClaimAll()}
                                        disabled={claiming || !claimConfigured || !claimReady}
                                        title={
                                            claimReady
                                                ? "Claim settled match prizes"
                                                : "No settled prize in this session"
                                        }
                                        className="flex flex-col items-center gap-2 rounded-[18px] border border-cyan-400/50 bg-cyan-500/20 py-4 text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-45 disabled:hover:bg-cyan-500/20"
                                    >
                                        <span className="w-11 h-11 rounded-full bg-cyan-400/30 flex items-center justify-center text-cyan-50 shadow-[0_0_16px_rgba(34,211,238,0.35)]">
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
                                        className="flex flex-col items-center gap-2 rounded-[18px] border border-white/10 bg-white/5 py-4 text-white/85 hover:bg-white/10"
                                    >
                                        <span className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-cyan-200">
                                            <IconFeed />
                                        </span>
                                        <span className="text-[11px] font-bold uppercase tracking-[0.12em]">
                                            Feed
                                        </span>
                                    </button>
                                </section>

                                <section className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="text-[12px] leading-relaxed text-white/50">
                                            Prizes settle on-chain. Claim unlocks after the match
                                            dispute window. Offline games earn no CHIPS.
                                        </p>
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
                                </section>

                                {(note || claimError || bal.error) && (
                                    <div className="text-[12px] text-red-300/90">{note || claimError || bal.error}</div>
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
