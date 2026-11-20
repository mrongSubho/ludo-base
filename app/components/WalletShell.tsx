"use client";

import { useEffect, useState } from "react";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import ReceiveSheet from "./ReceiveSheet";
import SendNativeSheet from "./SendNativeSheet";
import SendTokenSheet from "./SendTokenSheet";
import SwapSheet from "./SwapSheet";
import BuyCryptoButton from "./BuyCryptoButton";
import WalletActivityList from "./WalletActivityList";
import WcWalletPanel from "./WcWalletPanel";
import WalletSecurityPanel from "./WalletSecurityPanel";
import { useBiometricGate } from "@/hooks/useBiometricGate";
import { usePushReady } from "@/hooks/usePushReady";
import { useAppSession } from "@/hooks/useAppSession";
import { useWalletMode } from "@/hooks/useWalletMode";

type Tab = "home" | "send" | "token" | "receive" | "swap" | "activity" | "apps" | "security";

/**
 * R0 — Wallet shell (SMART_WALLET_PLANNING §2).
 * Home: tokens + Send/Receive. CHIPS = unpriced badge (H2).
 */
export default function WalletShell() {
    const { tokens, loading, refresh, needsReconnect, address } = useWalletAssets();
    const [tab, setTab] = useState<Tab>("home");
    const bio = useBiometricGate();
    const push = usePushReady();
    const appSession = useAppSession();
    const walletMode = useWalletMode();
    const [bioSkipped, setBioSkipped] = useState(false);
    const showGate =
        walletMode === "ingame" &&
        bio.supported === true &&
        !bio.unlocked &&
        !bioSkipped;

    useEffect(() => {
        bio.checkSupport();
        // R5: register service worker for push / cache (safe no-op if unsupported)
        if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
            void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
        }
    }, [bio]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-ludo-sm font-bold label-chrome uppercase tracking-[0.25em] text-ink-muted">Wallet</h3>
                <div className="flex gap-2">
                    {push.permission !== "granted" && push.permission !== "unsupported" && (
                        <button
                            type="button"
                            className="text-ludo-xs uppercase text-ink-muted hover:text-ink-strong underline"
                            onClick={() => {
                                // User gesture: enable push end-to-end (permission → VAPID → save).
                                void push.enableRemotePush({
                                    walletAddress: address || "",
                                    sessionId: appSession.peekAppSession(),
                                });
                            }}
                        >
                            Enable push
                        </button>
                    )}
                    {push.permission === "granted" && push.remote !== "subscribed" && (
                        <button
                            type="button"
                            className="text-ludo-xs uppercase text-ink-muted hover:text-ink-strong underline"
                            onClick={() => {
                                void push.enableRemotePush({
                                    walletAddress: address || "",
                                    sessionId: appSession.peekAppSession(),
                                });
                            }}
                        >
                            {push.remote === "error" ? "Retry remote push" : "Enable remote push"}
                        </button>
                    )}
                    <button
                        type="button"
                        className="text-ludo-xs uppercase text-ink-muted hover:text-ink-strong underline"
                        onClick={() => void refresh()}
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {showGate && (
                <div className="rounded-2xl border border-line-soft bg-surface-recessed p-4 space-y-2">
                    <h4 className="text-ludo-sm font-bold label-chrome uppercase tracking-[0.25em] text-ink-muted">
                        Unlock wallet
                    </h4>
                    <p className="text-ludo-sm text-ink-faint">
                        Face ID / Touch ID / device passcode (local lock — not on-chain).
                    </p>
                    <button
                        type="button"
                        className="rounded-lg bg-accent-soft border border-accent/40 text-accent px-3 py-2 text-ludo-sm font-bold uppercase"
                        disabled={bio.busy}
                        onClick={() => void bio.unlock()}
                    >
                        {bio.busy ? "Waiting for biometric…" : "Unlock with biometrics"}
                    </button>
                    {bio.error && <p className="text-ludo-sm text-negative">{bio.error}</p>}
                    <button
                        type="button"
                        className="text-ludo-xs text-ink-faint hover:text-ink-muted underline"
                        onClick={() => setBioSkipped(true)}
                    >
                        Continue without lock
                    </button>
                </div>
            )}

            {needsReconnect && (
                <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-ludo-sm text-warn">
                    In-game session expired — reconnect to restore wallet access. Your external wallet is
                    unchanged.
                </div>
            )}

            {!showGate && tab === "home" && (
                <div className="space-y-3">
                    <div className="rounded-2xl border border-line-soft bg-surface-recessed p-4">
                        <div className="text-ludo-xs text-ink-faint uppercase tracking-wider">Address</div>
                        <div className="font-mono text-ludo-sm break-all text-ink-strong">{address || "—"}</div>
                        <div className="mt-3 space-y-2">
                            {tokens.map((t) => (
                                <div key={t.key} className="flex items-center justify-between text-ludo-md">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-ink-strong">{t.label}</span>
                                        {t.unpriced && (
                                            <span className="rounded-full border border-line-soft px-1.5 py-0.5 text-ludo-xs uppercase text-ink-muted">
                                                unpriced
                                            </span>
                                        )}
                                    </div>
                                    <span className="font-mono text-ink-muted">
                                        {loading ? "…" : t.formatted}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <p className="mt-3 text-ludo-xs text-ink-faint leading-relaxed">
                            USD total shows priced assets only (ETH, USDC). CHIPS is excluded until a real
                            market exists.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="flex-1 rounded-xl bg-accent-soft border border-accent/40 text-accent py-3 text-ludo-sm font-bold label-chrome uppercase tracking-wider"
                            onClick={() => setTab("send")}
                        >
                            Send
                        </button>
                        <button
                            type="button"
                            className="flex-1 rounded-xl border border-line-soft text-ink-strong hover:bg-surface-hover py-3 text-ludo-sm font-bold label-chrome uppercase tracking-wider"
                            onClick={() => setTab("swap")}
                        >
                            Swap
                        </button>
                        <button
                            type="button"
                            className="flex-1 rounded-xl border border-line-soft text-ink-strong hover:bg-surface-hover py-3 text-ludo-sm font-bold label-chrome uppercase tracking-wider"
                            onClick={() => setTab("receive")}
                        >
                            Receive
                        </button>
                    </div>
                    <BuyCryptoButton />
                    <p className="text-ludo-xs text-ink-faint">
                        NFTs live in the Marketplace tab — not duplicated in Wallet. Chain: <strong>Base</strong> only.
                    </p>
                </div>
            )}

            {!showGate && tab === "send" && <SendNativeSheet />}
            {!showGate && tab === "token" && <SendTokenSheet />}
            {!showGate && tab === "receive" && <ReceiveSheet />}
            {!showGate && tab === "swap" && <SwapSheet />}
            {!showGate && tab === "activity" && <WalletActivityList />}
            {!showGate && tab === "apps" && <WcWalletPanel />}
            {!showGate && tab === "security" && <WalletSecurityPanel />}

            <div className={`flex gap-1 border-t border-line-soft pt-2 overflow-x-auto ${showGate ? "hidden" : ""}`}>
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
                        className={`flex-1 rounded-lg py-2 text-ludo-xs font-bold uppercase tracking-wider ${
                            tab === k ? "bg-surface-active text-ink-strong" : "text-ink-faint hover:text-ink-muted"
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
