"use client";

import { useWalletActivity, type WalletActivityItem } from "@/hooks/useWalletActivity";

function rowLabel(i: WalletActivityItem) {
    const sign = i.kind === "receive" ? "+" : i.kind === "send" ? "−" : "";
    return `${sign}${i.amount} ${i.token}`;
}

/** R1 — unified activity list (WALLET_PLAN §3.3). */
export default function WalletActivityList() {
    const { items, loading, refresh, needsReconnect, explorerBase } = useWalletActivity();

    if (needsReconnect) {
        return <p className="text-[11px] text-amber-200">Session expired — reconnect your wallet.</p>;
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                    Activity
                </h4>
                <button type="button" className="text-[10px] uppercase text-white/50 underline" onClick={() => void refresh()}>
                    Refresh
                </button>
            </div>
            {loading && <p className="text-[11px] text-white/45">Loading…</p>}
            {!loading && items.length === 0 && (
                <p className="text-[11px] text-white/45">
                    No activity yet. Sends you confirm appear here; on-chain history fills in when the RPC
                    supports it.
                </p>
            )}
            <ul className="space-y-2">
                {items.map((i) => (
                    <li
                        key={i.hash || i.id}
                        className="flex items-start justify-between gap-2 rounded-xl border border-white/10 p-3"
                    >
                        <div className="min-w-0">
                            <div className="text-[11px] font-bold text-white/90">
                                {rowLabel(i)}{" "}
                                <span className="text-white/40 font-normal uppercase">{i.kind}</span>
                            </div>
                            <div className="text-[10px] text-white/45 font-mono truncate">
                                {i.counterparty}
                            </div>
                        </div>
                        <div className="text-right">
                            <div
                                className={`text-[10px] uppercase ${
                                    i.status === "failed"
                                        ? "text-red-300"
                                        : i.status === "pending"
                                          ? "text-amber-200"
                                          : "text-emerald-300"
                                }`}
                            >
                                {i.status}
                            </div>
                            {i.hash && (
                                <a
                                    className="text-[10px] text-cyan-300 underline"
                                    href={`${explorerBase}/tx/${i.hash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Explorer
                                </a>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
