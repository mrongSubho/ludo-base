"use client";

import { useState } from "react";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import ReceiveSheet from "./ReceiveSheet";
import SendNativeSheet from "./SendNativeSheet";
import SendTokenSheet from "./SendTokenSheet";
import SwapSheet from "./SwapSheet";
import BuyCryptoButton from "./BuyCryptoButton";
import WalletActivityList from "./WalletActivityList";
import WcWalletPanel from "./WcWalletPanel";
import WalletSecurityPanel from "./WalletSecurityPanel";

type Tab = "home" | "send" | "token" | "receive" | "swap" | "activity" | "apps" | "security";

/**
 * R0 — Wallet shell (REAL_WALLET_PLAN §2).
 * Home: tokens + Send/Receive. CHIPS = unpriced badge (H2).
 */
export default function WalletShell() {
    const { tokens, loading, refresh, needsReconnect, address } = useWalletAssets();
    const [tab, setTab] = useState<Tab>("home");

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">Wallet</h3>
                <button
                    type="button"
                    className="text-[10px] uppercase text-white/50 underline"
                    onClick={() => void refresh()}
                >
                    Refresh
                </button>
            </div>

            {needsReconnect && (
                <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-[11px] text-amber-100">
                    In-game session expired — reconnect to restore wallet access. Your external wallet is
                    unchanged.
                </div>
            )}

            {tab === "home" && (
                <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[10px] text-white/40 uppercase tracking-wider">Address</div>
                        <div className="font-mono text-[11px] break-all text-white/85">{address || "—"}</div>
                        <div className="mt-3 space-y-2">
                            {tokens.map((t) => (
                                <div key={t.key} className="flex items-center justify-between text-[12px]">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-white/90">{t.label}</span>
                                        {t.unpriced && (
                                            <span className="rounded-full border border-white/20 px-1.5 py-0.5 text-[9px] uppercase text-white/50">
                                                unpriced
                                            </span>
                                        )}
                                    </div>
                                    <span className="font-mono text-white/80">
                                        {loading ? "…" : t.formatted}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <p className="mt-3 text-[10px] text-white/40 leading-relaxed">
                            USD total shows priced assets only (ETH, USDC). CHIPS is excluded until a real
                            market exists.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="flex-1 rounded-xl bg-cyan-500/20 border border-cyan-400/40 py-3 text-[11px] font-black uppercase tracking-wider"
                            onClick={() => setTab("send")}
                        >
                            Send
                        </button>
                        <button
                            type="button"
                            className="flex-1 rounded-xl border border-white/15 py-3 text-[11px] font-black uppercase tracking-wider"
                            onClick={() => setTab("swap")}
                        >
                            Swap
                        </button>
                        <button
                            type="button"
                            className="flex-1 rounded-xl border border-white/15 py-3 text-[11px] font-black uppercase tracking-wider"
                            onClick={() => setTab("receive")}
                        >
                            Receive
                        </button>
                    </div>
                    <BuyCryptoButton />
                    <p className="text-[10px] text-white/40">
                        NFTs live in the Marketplace tab — not duplicated in Wallet. Chain: <strong>Base</strong> only.
                    </p>
                </div>
            )}

            {tab === "send" && <SendNativeSheet />}
            {tab === "token" && <SendTokenSheet />}
            {tab === "receive" && <ReceiveSheet />}
            {tab === "swap" && <SwapSheet />}
            {tab === "activity" && <WalletActivityList />}
            {tab === "apps" && <WcWalletPanel />}
            {tab === "security" && <WalletSecurityPanel />}

            <div className="flex gap-1 border-t border-white/10 pt-2 overflow-x-auto">
                {(
                    [
                        ["home", "Home"],
                        ["send", "Send"],
                        ["token", "Token"],
                        ["receive", "Receive"],
                        ["swap", "Swap"],
                        ["activity", "Activity"],
                        ["apps", "Apps"],
                        ["security", "Security"],
                    ] as const
                ).map(([k, label]) => (
                    <button
                        key={k}
                        type="button"
                        className={`flex-1 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wider ${
                            tab === k ? "bg-white/10 text-white" : "text-white/45"
                        }`}
                        onClick={() => setTab(k)}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}
