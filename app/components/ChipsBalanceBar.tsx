"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClaimAll } from "@/hooks/useChipsPool";
import { shortHex } from "@/lib/chips";

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
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-warn/35 bg-surface-recessed text-ludo-xs uppercase tracking-wider text-warn ${className}`}
            >
                CHIPS env not in client bundle — restart <code className="mx-1">npm run dev</code>
                (NEXT_PUBLIC_CHIPS_ADDRESS + NEXT_PUBLIC_MATCH_POOL_ADDRESS)
            </div>
        );
    }

    if (compact) {
        return (
            <div
                className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border border-accent/40 bg-surface-panel ${className}`}
            >
                <span className="text-ludo-xs font-bold label-chrome uppercase tracking-wider text-accent">
                    CHIPS
                </span>
                <span className="text-xs font-bold text-ink-strong tabular-nums">{bal.human}</span>
                <button
                    type="button"
                    onClick={() => void bal.refresh()}
                    className="text-ludo-xs uppercase text-ink-muted hover:text-accent"
                    title="Refresh balance"
                >
                    {bal.refreshing ? "…" : "↻"}
                </button>
            </div>
        );
    }

    return (
        <div
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-xl border border-accent/35 bg-surface-panel ${className}`}
        >
            <div className="flex items-baseline gap-2">
                <span className="text-ludo-xs font-bold label-chrome uppercase tracking-[0.16em] text-accent">
                    CHIPS
                </span>
                <span className="text-sm font-bold label-chrome text-ink-strong tabular-nums">{bal.human}</span>
            </div>

            <button
                type="button"
                onClick={copyAddress}
                className="text-ludo-xs font-mono text-ink-muted hover:text-accent uppercase"
                title={bal.address ?? "wallet"}
            >
                {copied ? "COPIED" : bal.short || "—"}
            </button>

            <div className="flex items-center gap-1.5 ml-auto">
                <button
                    type="button"
                    onClick={() => void bal.refresh()}
                    disabled={bal.refreshing}
                    className="px-2 py-1 rounded-md border border-line-soft text-ludo-xs font-bold uppercase tracking-wider text-ink-muted hover:border-accent/50 hover:text-accent disabled:opacity-50"
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
                        className="px-2 py-1 rounded-md border border-accent/50 bg-accent-soft text-ludo-xs font-bold label-chrome uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-40"
                    >
                        {claiming ? "CLAIMING" : "CLAIM"}
                    </button>
                )}
                <Link
                    href="/burn"
                    className="px-2 py-1 rounded-md border border-line-soft text-ludo-xs font-bold uppercase tracking-wider text-ink-muted hover:border-line-strong hover:text-ink-strong"
                >
                    FEED
                </Link>
            </div>

            {(note || claimError || bal.error) && (
                <div className="w-full text-ludo-xs text-negative">
                    {note || claimError || bal.error}
                </div>
            )}

            {bal.token && (
                <div className="w-full text-ludo-xs font-mono text-ink-faint">
                    token {shortHex(bal.token)}
                </div>
            )}
        </div>
    );
}

export default ChipsBalanceBar;
