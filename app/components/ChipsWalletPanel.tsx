"use client";

import React, { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IoClose } from "react-icons/io5";
import Link from "next/link";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClaimAll } from "@/hooks/useChipsPool";
import { chipsAddress, shortHex } from "@/lib/chips";

interface ChipsWalletPanelProps {
    isOpen: boolean;
    onClose: () => void;
    /** Optional settled pool ids for CLAIM. */
    claimablePoolIds?: `0x${string}`[];
}

/**
 * Wallet panel opened from the header CHIPS pill.
 * Balance · address · REFRESH / CLAIM / FEED — same actions as ChipsBalanceBar.
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
            setNote("clipboard blocked");
        }
    }, [bal.address]);

    const onClaimAll = useCallback(async () => {
        if (!claimablePoolIds?.length) {
            setNote("No claimable pool in this session");
            return;
        }
        setNote(null);
        await claimMany(claimablePoolIds);
        await bal.refresh();
    }, [claimablePoolIds, claimMany, bal]);

    return (
        <AnimatePresence>
            {isOpen && (
                <div
                    className="fixed inset-0 z-[400] flex items-center justify-center p-4"
                    style={{ background: "rgba(0,0,0,0.72)" }}
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 8 }}
                        transition={{ duration: 0.18 }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-sm rounded-2xl border border-cyan-500/35 bg-[#0b0f19] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200">
                                    CHIPS Wallet
                                </h2>
                                <p className="text-[10px] text-white/45 uppercase tracking-wider mt-0.5">
                                    Pull-based · match prizes on-chain
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-white/50 hover:text-white p-1"
                                aria-label="Close"
                            >
                                <IoClose size={20} />
                            </button>
                        </div>

                        {!bal.configured ? (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
                                CHIPS env not in client bundle — restart{" "}
                                <code>npm run dev</code> (NEXT_PUBLIC_CHIPS_ADDRESS +
                                NEXT_PUBLIC_MATCH_POOL_ADDRESS)
                            </div>
                        ) : (
                            <>
                                <div className="rounded-xl border border-white/10 bg-black/35 px-4 py-4 mb-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300/80">
                                        Balance
                                    </div>
                                    <div className="mt-1 text-3xl font-black text-white tabular-nums">
                                        {bal.human}
                                        <span className="ml-2 text-xs font-bold text-cyan-300/80">
                                            CHIPS
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={copyAddress}
                                        className="mt-3 w-full flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 hover:border-cyan-400/40"
                                    >
                                        <span className="text-[10px] uppercase text-white/45">
                                            Address
                                        </span>
                                        <span className="text-[11px] font-mono text-white/85">
                                            {copied ? "COPIED" : bal.short || "—"}
                                        </span>
                                    </button>
                                    <div className="mt-2 text-[9px] font-mono text-white/35">
                                        token {shortHex(chipsAddress() ?? "")}
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void bal.refresh()}
                                        disabled={bal.refreshing}
                                        className="rounded-lg border border-white/15 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white/80 hover:border-cyan-400/50 hover:text-cyan-100 disabled:opacity-50"
                                    >
                                        {bal.refreshing ? "SYNC" : "REFRESH"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void onClaimAll()}
                                        disabled={claiming || !claimConfigured || !claimablePoolIds?.length}
                                        title={
                                            claimablePoolIds?.length
                                                ? "Claim settled prizes"
                                                : "No settled prize in this session"
                                        }
                                        className="rounded-lg border border-cyan-400/50 bg-cyan-500/15 py-2.5 text-[11px] font-black uppercase tracking-wider text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-40"
                                    >
                                        {claiming ? "CLAIMING" : "CLAIM"}
                                    </button>
                                    <Link
                                        href="/burn"
                                        onClick={onClose}
                                        className="rounded-lg border border-white/15 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white/80 text-center hover:border-white/35 hover:text-white"
                                    >
                                        FEED
                                    </Link>
                                </div>

                                {(note || claimError || bal.error) && (
                                    <div className="mt-3 text-[11px] text-red-300/90">
                                        {note || claimError || bal.error}
                                    </div>
                                )}
                            </>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

export default ChipsWalletPanel;
