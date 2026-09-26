"use client";

import React, { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IoClose } from "react-icons/io5";
import Link from "next/link";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClaimAll } from "@/hooks/useChipsPool";
import { chipsAddress, shortHex } from "@/lib/chips";
import { TokenIcon } from "./HeaderNavPanel";

interface ChipsWalletPanelProps {
    isOpen: boolean;
    onClose: () => void;
    /** Settled pool ids known to the caller (MatchStats / session) for CLAIM. */
    claimablePoolIds?: `0x${string}`[];
}

/**
 * In-game CHIPS wallet (open from header pill).
 * Design: terminal-glass panel matching header pills — cyan border, uppercase
 * labels, hero balance, address copy, REFRESH / CLAIM / FEED.
 */
export function ChipsWalletPanel({ isOpen, onClose, claimablePoolIds }: ChipsWalletPanelProps) {
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
                <div
                    className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-3 sm:p-6"
                    style={{ background: "rgba(0,0,0,0.72)" }}
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 24, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        onClick={(e) => e.stopPropagation()}
                        className="ludo-wallet-scope w-full max-w-[380px] rounded-[22px] border border-cyan-500/40 bg-[#0a0e18]/95 shadow-[0_24px_80px_rgba(0,0,0,0.65)] overflow-hidden"
                    >
                        {/* Chrome bar */}
                        <div className="flex items-center justify-between px-5 pt-4 pb-2">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                                <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">
                                    CHIPS Wallet
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-white/55 hover:text-white hover:border-white/25 transition-colors"
                                aria-label="Close wallet"
                            >
                                <IoClose size={18} />
                            </button>
                        </div>

                        {/* Hero balance */}
                        <div className="px-5 pb-4">
                            <div className="rounded-[18px] border border-cyan-500/25 bg-gradient-to-b from-cyan-500/12 to-transparent px-4 py-5">
                                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/80">
                                    <span className="w-6 h-6 rounded-full border border-cyan-400/50 bg-cyan-400/10 flex items-center justify-center text-cyan-200">
                                        <TokenIcon />
                                    </span>
                                    Balance
                                </div>
                                <div className="mt-2 flex items-baseline gap-2">
                                    <span className="text-[40px] leading-none font-black text-white tabular-nums">
                                        {bal.configured ? bal.human : "—"}
                                    </span>
                                    <span className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300/90">
                                        CHIPS
                                    </span>
                                </div>
                                <div className="mt-3 flex items-center gap-2">
                                    <div className="flex-1 flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                                        <div className="min-w-0">
                                            <div className="text-[9px] uppercase tracking-[0.16em] text-white/40">
                                                Wallet
                                            </div>
                                            <div className="text-[12px] font-mono text-white/90 truncate">
                                                {copied ? "COPIED" : bal.address ? shortHex(bal.address) : "Not connected"}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={copyAddress}
                                            disabled={!bal.address}
                                            className="ml-2 px-2.5 py-1.5 rounded-lg border border-cyan-400/40 text-[10px] font-black uppercase tracking-wider text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-40"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-2 text-[9px] font-mono text-white/35">
                                    token {shortHex(chipsAddress() ?? "")} · Base Sepolia
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="px-5 pb-5">
                            {!bal.configured ? (
                                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-100/90">
                                    Wallet env missing — restart{" "}
                                    <code className="mx-1 font-bold">npm run dev</code>
                                    (NEXT_PUBLIC_CHIPS_ADDRESS · NEXT_PUBLIC_MATCH_POOL_ADDRESS)
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-3 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void bal.refresh()}
                                            disabled={bal.refreshing}
                                            className="rounded-[14px] border border-white/12 bg-white/[0.04] py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white/85 hover:border-cyan-400/50 hover:bg-cyan-500/10 disabled:opacity-50 transition-colors"
                                        >
                                            {bal.refreshing ? "Sync" : "Refresh"}
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
                                            className="rounded-[14px] border border-cyan-400/55 bg-cyan-500/18 py-3 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-40 transition-colors"
                                        >
                                            {claiming ? "Claiming" : "Claim"}
                                        </button>
                                        <Link
                                            href="/burn"
                                            onClick={onClose}
                                            className="rounded-[14px] border border-white/12 bg-white/[0.04] py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white/85 text-center hover:border-white/30 hover:bg-white/[0.08] transition-colors"
                                        >
                                            Feed
                                        </Link>
                                    </div>

                                    <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-white/8 bg-black/25 px-3 py-2.5">
                                        <div className="text-[10px] leading-relaxed text-white/50">
                                            Pull-based prizes. Claim unlocks after the match
                                            dispute window. Offline games earn no CHIPS.
                                        </div>
                                        <span
                                            className={`shrink-0 text-[9px] font-black uppercase tracking-[0.14em] px-2 py-1 rounded-md border ${
                                                claimReady
                                                    ? "border-emerald-400/50 text-emerald-200 bg-emerald-400/10"
                                                    : "border-white/12 text-white/45"
                                            }`}
                                        >
                                            {claimReady ? "Prize ready" : "Idle"}
                                        </span>
                                    </div>

                                    {(note || claimError || bal.error) && (
                                        <div className="mt-2.5 text-[11px] text-red-300/90">
                                            {note || claimError || bal.error}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

export default ChipsWalletPanel;
