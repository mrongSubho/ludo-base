"use client";

import { useMemo, useState } from "react";
import { useWalletActivity, type WalletActivityItem } from "@/hooks/useWalletActivity";

type Filter =
    | "all"
    | "pending"
    | "confirmed"
    | "failed"
    | "send"
    | "receive"
    | "other";

const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pending", label: "Pending" },
    { id: "confirmed", label: "Successful" },
    { id: "failed", label: "Failed" },
    { id: "send", label: "Sent" },
    { id: "receive", label: "Received" },
    { id: "other", label: "Game" },
];

function kindOf(i: WalletActivityItem): Filter {
    if (i.kind === "send") return "send";
    if (i.kind === "receive") return "receive";
    return "other";
}

function rowIcon(i: WalletActivityItem) {
    if (i.kind === "receive") {
        return (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
        );
    }
    if (i.kind === "send") {
        return (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4l2.5 2.5" />
        </svg>
    );
}

function titleOf(i: WalletActivityItem) {
    if (i.kind === "receive") return "Received";
    if (i.kind === "send") return "Sent";
    return i.kind.replace(/[_-]/g, " ");
}

/** R1 — unified activity (SMART_WALLET_PLANNING §5). */
export default function WalletActivityList() {
    const { items, loading, refresh, needsReconnect, explorerBase } = useWalletActivity();
    const [filter, setFilter] = useState<Filter>("all");

    const visible = useMemo(() => {
        if (filter === "all") return items;
        if (filter === "pending" || filter === "confirmed" || filter === "failed") {
            return items.filter((i) => i.status === filter);
        }
        return items.filter((i) => kindOf(i) === filter);
    }, [items, filter]);

    if (needsReconnect) {
        return (
            <div className="cb-screen">
                <div className="cb-banner">Session expired — reconnect your wallet.</div>
            </div>
        );
    }

    return (
        <div className="cb-screen space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="cb-page-label">History</h4>
                <button type="button" className="cb-link" onClick={() => void refresh()}>
                    {loading ? "Updating…" : "Refresh"}
                </button>
            </div>

            <div className="cb-filter-row" role="tablist" aria-label="Activity filter">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        type="button"
                        role="tab"
                        aria-selected={filter === f.id}
                        className={`cb-filter-chip ${filter === f.id ? "active" : ""}`}
                        onClick={() => setFilter(f.id)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {loading && items.length === 0 && (
                <div className="cb-card">
                    <p className="cb-empty">Loading activity…</p>
                </div>
            )}

            {!loading && visible.length === 0 && (
                <div className="cb-empty-state">
                    <div className="cb-empty-icon" aria-hidden>
                        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 7h16M4 12h10M4 17h7" />
                        </svg>
                    </div>
                    <p className="cb-empty-title">
                        {filter === "all" ? "No activity yet" : `No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} activity`}
                    </p>
                    <p className="cb-empty-hint">
                        Sends you confirm appear here. On-chain history fills in when the RPC supports it.
                    </p>
                </div>
            )}

            {visible.length > 0 && (
                <ul className="cb-card cb-activity-list">
                    {visible.map((i) => (
                        <li key={i.hash || i.id} className="cb-activity-row">
                            <span
                                className={`cb-activity-icon ${
                                    i.kind === "receive" ? "in" : i.kind === "send" ? "out" : "game"
                                }`}
                                aria-hidden
                            >
                                {rowIcon(i)}
                            </span>
                            <div className="cb-activity-meta">
                                <div className="cb-activity-title">
                                    {titleOf(i)}
                                    <span className="cb-activity-amt">
                                        {i.kind === "receive" ? "+" : i.kind === "send" ? "−" : ""}
                                        {i.amount} {i.token}
                                    </span>
                                </div>
                                <div className="cb-activity-sub">
                                    <span className="cb-activity-party">{i.counterparty || "—"}</span>
                                    {i.hash && (
                                        <a
                                            className="cb-activity-link"
                                            href={`${explorerBase}/tx/${i.hash}`}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            BaseScan
                                        </a>
                                    )}
                                </div>
                            </div>
                            <span className={`cb-status-pill ${i.status}`}>{i.status}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
