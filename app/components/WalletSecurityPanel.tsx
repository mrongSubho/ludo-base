"use client";

import { useCallback, useState } from "react";
import { useCurrentUser, useExportEvmAccount, useVerifyPasskey } from "@coinbase/cdp-hooks";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";
import { usePushReady } from "@/hooks/usePushReady";
import { useAppSession } from "@/hooks/useAppSession";
import { useWalletMode } from "@/hooks/useWalletMode";
import WalletDetailsSheet from "./WalletDetailsSheet";

/**
 * Wallet → Security (Settings-style cards).
 * Notifications · Export Private Key (bio → confirm page → reveal + copy) · details.
 * Passkey lives in Settings → Passkey (SMART_WALLET_PLANNING §5).
 */

type View = "main" | "exportConfirm" | "exportKey";

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-2.5 mb-2">
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
    </div>
);

const IconTile = ({ children, danger }: { children: React.ReactNode; danger?: boolean }) => (
    <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
            danger ? "bg-red-500/15 text-red-300" : "bg-cyan-500/15 text-cyan-300"
        }`}
    >
        {children}
    </div>
);

const BellIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9a6 6 0 1 1 12 0c0 4 2 5 2 5H4s2-1 2-5" />
        <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
);

const KeyIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
);

const InfoIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
    </svg>
);

const BackIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
    </svg>
);

export default function WalletSecurityPanel() {
    const { currentUser } = useCurrentUser();
    const id = resolvePlayerIdentity(currentUser);
    const ownerEoa = id.cdpOwnerEoa as `0x${string}` | undefined;
    const { exportEvmAccount } = useExportEvmAccount();
    const { verifyPasskeyAsync } = useVerifyPasskey();
    const mfa = useMfaStepUp();
    const push = usePushReady();
    const appSession = useAppSession();
    const mode = useWalletMode();
    const isInGame = mode === "ingame";

    const [view, setView] = useState<View>("main");
    const [privateKey, setPrivateKey] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    /** Reveal: device bio first, then confirm page. */
    const startExport = useCallback(async () => {
        setErr(null);
        setBusy(true);
        try {
            const ok = await mfa.stepUp();
            if (!ok) {
                setErr(mfa.mfaError || "Device unlock failed");
                return;
            }
            setView("exportConfirm");
        } finally {
            setBusy(false);
        }
    }, [mfa]);

    const revealKey = useCallback(async () => {
        if (!ownerEoa) return;
        setBusy(true);
        setErr(null);
        try {
            // Full passkey ceremony inside this click (user gesture).
            await verifyPasskeyAsync();
            const result = await exportEvmAccount({ evmAccount: ownerEoa });
            if (result?.privateKey) {
                setPrivateKey(result.privateKey);
                setView("exportKey");
            } else {
                setErr("Export was cancelled");
            }
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [exportEvmAccount, ownerEoa, verifyPasskeyAsync]);

    const copyKey = useCallback(async () => {
        if (!privateKey) return;
        try {
            await navigator.clipboard.writeText(privateKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            setErr("Clipboard blocked — copy manually");
        }
    }, [privateKey]);

    // ── Export confirm page ──
    if (view === "exportConfirm") {
        return (
            <div className="sec-sheet">
                <div className="flex items-center gap-2 mb-3">
                    <button
                        type="button"
                        className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70"
                        aria-label="Back"
                        onClick={() => setView("main")}
                    >
                        <BackIcon />
                    </button>
                    <h3 className="text-[13px] font-black uppercase tracking-[0.18em] text-white/70">
                        Export private key
                    </h3>
                </div>
                <div className="sec-card danger">
                    <div className="sec-row">
                        <IconTile danger>
                            <KeyIcon />
                        </IconTile>
                        <div className="sec-text">
                            <div className="sec-title">Confirm reveal</div>
                            <div className="sec-sub">Owner key · not your profile address</div>
                        </div>
                    </div>
                    <ul className="sec-list">
                        <li className="sec-row">
                            <div className="sec-text">
                                <div className="sec-sub">
                                    Anyone with this key controls the wallet. Store it offline.
                                </div>
                            </div>
                        </li>
                        <li className="sec-row">
                            <div className="sec-text">
                                <div className="sec-sub">
                                    MetaMask will show the owner address after import — not the in-game address.
                                </div>
                            </div>
                        </li>
                    </ul>
                    {err && <p className="err-text pad">{err}</p>}
                    <div className="sec-actions">
                        <button type="button" className="btn-mini danger" disabled={busy} onClick={revealKey}>
                            {busy ? "Opening…" : "Reveal private key"}
                        </button>
                        <button type="button" className="btn-mini ghost" onClick={() => setView("main")}>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Key reveal page ──
    if (view === "exportKey" && privateKey) {
        return (
            <div className="sec-sheet">
                <div className="flex items-center gap-2 mb-3">
                    <button
                        type="button"
                        className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70"
                        aria-label="Back"
                        onClick={() => {
                            setPrivateKey(null);
                            setView("main");
                        }}
                    >
                        <BackIcon />
                    </button>
                    <h3 className="text-[13px] font-black uppercase tracking-[0.18em] text-white/70">
                        Private key
                    </h3>
                </div>
                <div className="sec-card danger">
                    <p className="sec-sub pad">
                        Copy and store offline. Never share it. Closing this screen does not revoke the key.
                    </p>
                    <pre className="sec-secret">{privateKey}</pre>
                    <div className="sec-actions">
                        <button type="button" className="btn-mini primary" onClick={copyKey}>
                            {copied ? "Copied" : "Copy key"}
                        </button>
                        <button
                            type="button"
                            className="btn-mini ghost"
                            onClick={() => {
                                setPrivateKey(null);
                                setView("main");
                            }}
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Main ──
    return (
        <div className="sec-sheet">
            <section>
                <SectionLabel>Notifications</SectionLabel>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                    <div className="flex items-center gap-3 p-3.5">
                        <IconTile>
                            <BellIcon />
                        </IconTile>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-bold text-white truncate">Turn & claim nudges</div>
                            <div className="text-[10px] font-bold text-white/35 truncate">
                                {push.remote === "subscribed"
                                    ? "Remote push on"
                                    : push.permission === "granted"
                                      ? "This device only"
                                      : "Permission off"}
                            </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                            <button
                                type="button"
                                className="rounded-lg bg-cyan-500/15 border border-cyan-400/30 px-2.5 py-1.5 text-[10px] font-bold uppercase text-white disabled:opacity-40"
                                disabled={!id.address}
                                onClick={async () => {
                                    setNote(null);
                                    const r = await push.enableRemotePush({
                                        walletAddress: id.address || "",
                                        sessionId: appSession.peekAppSession(),
                                    });
                                    setNote(r.ok ? "Remote push enabled." : push.error || "Could not enable push");
                                }}
                            >
                                On
                            </button>
                            <button
                                type="button"
                                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-bold uppercase text-white/80 disabled:opacity-40"
                                disabled={!id.address}
                                onClick={async () => {
                                    setNote(null);
                                    const err = await push.sendTestPush({
                                        walletAddress: id.address || "",
                                        sessionId: appSession.peekAppSession(),
                                    });
                                    setNote(err || "Test notification sent.");
                                }}
                            >
                                Test
                            </button>
                            <button
                                type="button"
                                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-bold uppercase text-white/60 disabled:opacity-40"
                                disabled={!id.address}
                                onClick={async () => {
                                    setNote(null);
                                    await push.disableRemotePush({
                                        walletAddress: id.address || "",
                                        sessionId: appSession.peekAppSession(),
                                    });
                                    setNote("Remote push disabled.");
                                }}
                            >
                                Off
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {isInGame && (
                <section>
                    <SectionLabel>Export</SectionLabel>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
                        <button
                            type="button"
                            className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-white/5 transition-colors"
                            disabled={busy}
                            onClick={startExport}
                        >
                            <IconTile danger>
                                <KeyIcon />
                            </IconTile>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-bold text-white truncate">Export Private Key</div>
                                <div className="text-[10px] font-bold text-white/35 truncate">
                                    Reveal · device unlock · owner key
                                </div>
                            </div>
                            <span className="rounded-lg bg-red-500/15 border border-red-400/30 px-2.5 py-1.5 text-[10px] font-bold uppercase text-red-200">
                                Reveal
                            </span>
                        </button>
                    </div>
                </section>
            )}

            <section>
                <SectionLabel>Details</SectionLabel>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
                    <button
                        type="button"
                        className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-white/5 transition-colors"
                        onClick={() => setShowDetails((v) => !v)}
                        aria-expanded={showDetails}
                    >
                        <IconTile>
                            <InfoIcon />
                        </IconTile>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-bold text-white truncate">Wallet details</div>
                            <div className="text-[10px] font-bold text-white/35 truncate">
                                Address · mode · owner key (view only)
                            </div>
                        </div>
                        <svg
                            viewBox="0 0 24 24"
                            className={`w-3.5 h-3.5 text-white/45 transition-transform ${showDetails ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                        >
                            <path d="M6 9l6 6 6-6" />
                        </svg>
                    </button>
                    {showDetails && (
                        <div className="px-3.5 pb-3.5 border-t border-white/5 pt-3">
                            <WalletDetailsSheet />
                        </div>
                    )}
                </div>
            </section>

            {note && <p className="ok-inline">{note}</p>}
            {err && <p className="err-text">{err}</p>}
        </div>
    );
}
