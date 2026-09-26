"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClaimAll } from "@/hooks/useChipsPool";
import { chipsAddress, shortHex } from "@/lib/chips";

type Props = {
    /** Optional pool ids already known to the caller (MatchStats / session). */
    claimablePoolIds?: `0x${string}`[];
    /** Compact mode for tight headers. */
    compact?: boolean;
    className?: string;
};

/**
 * Persistent CHIPS strip: live balance + claim/refresh actions.
 * Fed by lib/chips + useChipsBalance / useClaimAll — no second source of truth.
 */
export function ChipsBalanceBar({ claimablePoolIds, compact = false, className = "" }: Props) {
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

    if (!bal.configured) {
        return (
            <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-black/30 text-[10px] uppercase tracking-wider text-white/40 ${className}`}
            >
                CHIPS · env pending
            </div>
        );
    }

    if (compact) {
        return (
            <div
                className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border border-cyan-500/40 bg-black/40 ${className}`}
            >
                <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
                    CHIPS
                </span>
                <span className="text-xs font-bold text-white tabular-nums">{bal.human}</span>
                <button
                    type="button"
                    onClick={() => void bal.refresh()}
                    className="text-[9px] uppercase text-white/50 hover:text-cyan-300"
                    title="Refresh balance"
                >
                    {bal.refreshing ? "…" : "↻"}
                </button>
            </div>
        );
    }

    return (
        <div
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-xl border border-cyan-500/35 bg-black/35 ${className}`}
        >
            <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300/90">
                    CHIPS
                </span>
                <span className="text-sm font-black text-white tabular-nums">{bal.human}</span>
            </div>

            <button
                type="button"
                onClick={copyAddress}
                className="text-[10px] font-mono text-white/55 hover:text-cyan-200 uppercase"
                title={bal.address ?? "wallet"}
            >
                {copied ? "COPIED" : bal.short || "—"}
            </button>

            <div className="flex items-center gap-1.5 ml-auto">
                <button
                    type="button"
                    onClick={() => void bal.refresh()}
                    disabled={bal.refreshing}
                    className="px-2 py-1 rounded-md border border-white/15 text-[10px] font-bold uppercase tracking-wider text-white/70 hover:border-cyan-400/50 hover:text-cyan-200 disabled:opacity-50"
                >
                    {bal.refreshing ? "SYNC" : "REFRESH"}
                </button>
                {claimConfigured && (
                    <button
                        type="button"
                        onClick={() => void onClaimAll()}
                        disabled={claiming || !claimablePoolIds?.length}
                        title={
                            claimablePoolIds?.length
                                ? "Claim settled prizes"
                                : "No settled prize in this session"
                        }
                        className="px-2 py-1 rounded-md border border-cyan-400/50 bg-cyan-500/15 text-[10px] font-black uppercase tracking-wider text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40 disabled:hover:bg-cyan-500/15"
                    >
                        {claiming ? "CLAIMING" : "CLAIM"}
                    </button>
                )}
                <Link
                    href="/burn"
                    className="px-2 py-1 rounded-md border border-white/15 text-[10px] font-bold uppercase tracking-wider text-white/60 hover:border-white/35 hover:text-white"
                >
                    FEED
                </Link>
            </div>

            {(note || claimError || bal.error) && (
                <div className="w-full text-[10px] text-red-300/90">
                    {note || claimError || bal.error}
                </div>
            )}

            {bal.token && (
                <div className="w-full text-[9px] font-mono text-white/35">
                    token {shortHex(bal.token)}
                </div>
            )}
        </div>
    );
}

export default ChipsBalanceBar;
