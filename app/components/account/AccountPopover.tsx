"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { useSignOut } from "@coinbase/cdp-hooks";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";
import { getProgression } from "@/lib/progression";
import { exitGuest } from "@/lib/guest";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useWalletMode } from "@/hooks/useWalletMode";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useChipsAllowance } from "@/hooks/useChipsAllowance";
import { useSecurityPrefs } from "@/hooks/useSecurityPrefs";
import { useAppSession } from "@/hooks/useAppSession";
import { useTeamUpContext } from "@/hooks/TeamUpContext";
import type { MatchHistoryRecord } from "@/app/api/matches/history/route";
import { StatusBadge } from "./StatusBadge";
import {
    AccountDockAction,
    AccountDockPhase,
    isCorrectNetwork,
    resolveAccountSecurityView,
} from "./useAccountDockState";

type PanelTarget = "profile" | "settings" | "wallet";

export interface AccountPopoverProps {
    open: boolean;
    phase: AccountDockPhase;
    dispatch: React.Dispatch<AccountDockAction>;
    onOpenPanel: (panel: PanelTarget) => void;
    returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

function truncateAddress(addr: string | undefined): string {
    if (!addr) return "Guest Session";
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function isEvmAddress(addr: string | undefined): addr is `0x${string}` {
    return Boolean(addr && /^0x[a-fA-F0-9]{40}$/.test(addr));
}

function formatAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 60_000) return "now";
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export function AccountPopover({
    open,
    phase,
    dispatch,
    onOpenPanel,
    returnFocusRef,
}: AccountPopoverProps) {
    const { address, profile, displayName, isGuest } = useCurrentUser();
    const { connector } = useAccount();
    const chainId = useChainId();
    const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
    const { disconnect } = useDisconnect();
    const { signOut: cdpSignOut } = useSignOut();
    const walletMode = useWalletMode();
    const chips = useChipsBalance();
    const chipsAllowance = useChipsAllowance();
    const security = useSecurityPrefs();
    const { peekAppSession, clearAppSession } = useAppSession();
    const { roomAuthority } = useTeamUpContext();

    const [mounted, setMounted] = useState(false);
    const [copied, setCopied] = useState(false);
    const [recentMatches, setRecentMatches] = useState<MatchHistoryRecord[]>([]);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const closeBtnRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => setMounted(true), []);

    // Close on Escape and trap Tab focus while open.
    useEffect(() => {
        if (!open) return;
        const focusTimer = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                dispatch({ type: "CLOSE" });
                returnFocusRef?.current?.focus();
                return;
            }
            if (e.key === "Tab" && sheetRef.current) {
                const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
                );
                if (focusables.length === 0) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.clearTimeout(focusTimer);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [open, dispatch, returnFocusRef]);

    // Fetch up to 3 recent matches using cached app session only (no popup prompts).
    useEffect(() => {
        if (!open || isGuest || !isEvmAddress(address)) {
            setRecentMatches([]);
            return;
        }
        const sessionId = peekAppSession();
        if (!sessionId) {
            setRecentMatches([]);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(
                    `/api/matches/history?wallet=${encodeURIComponent(address)}`,
                    {
                        headers: {
                            Authorization: `Bearer ${sessionId}`,
                            "x-session-id": sessionId,
                        },
                    },
                );
                if (!res.ok || cancelled) return;
                const data = (await res.json()) as { matches?: MatchHistoryRecord[] };
                if (!cancelled && Array.isArray(data?.matches)) {
                    setRecentMatches(data.matches.slice(0, 3));
                }
            } catch {
                /* keep existing state silently */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, isGuest, address, peekAppSession]);

    if (!mounted || !open) return null;

    const progression = getProgression(profile?.lxp ?? 0, profile?.rxp ?? 0);
    const tierLabel = `${progression.tier.toUpperCase()}${progression.subRank ? ` ${progression.subRank}` : ""}`;
    const networkOk = isCorrectNetwork(chainId);
    const securityView = resolveAccountSecurityView(
        isGuest ? null : walletMode,
        connector?.name,
    );
    const modeLabel = isGuest
        ? "GUEST"
        : walletMode === "ingame"
          ? "IN-GAME (CDP)"
          : `EXTERNAL (${connector?.name || "WALLET"})`;
    const isConfirmingDisconnect = phase === "ConfirmDisconnect";

    const openTargetPanel = (target: PanelTarget) => {
        dispatch({ type: "PANEL_OPENED" });
        onOpenPanel(target);
    };

    const handleCopy = async () => {
        if (!address) return;
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            /* ignore clipboard refusal */
        }
    };

    const handleDisconnectNow = () => {
        if (isGuest) exitGuest();
        clearAppSession();
        void cdpSignOut().catch(() => undefined);
        try {
            disconnect();
        } catch {
            /* not connected */
        }
        dispatch({ type: "CONFIRM_DISCONNECT" });
    };

    return createPortal(
        <>
            <div
                className="account-sheet-scrim-3077"
                aria-hidden
                onClick={() => {
                    dispatch({ type: "CLOSE" });
                    returnFocusRef?.current?.focus();
                }}
            />
            <div
                ref={sheetRef}
                id="account-popover"
                role="dialog"
                aria-modal="false"
                aria-label="Account management"
                className="account-sheet-3077"
            >
                {/* Header */}
                <div
                    className="flex items-center justify-between px-4 py-3 shrink-0 border-b"
                    style={{ borderColor: "var(--line-soft)" }}
                >
                    <div className="flex items-center gap-2">
                        <StatusBadge status={networkOk ? "online" : "pending"} />
                        <span
                            className="font-semibold text-xs uppercase tracking-[0.12em]"
                            style={{ fontFamily: "var(--font-chakra), sans-serif", color: "var(--ink-strong)" }}
                        >
                            Account
                        </span>
                    </div>
                    <button
                        ref={closeBtnRef}
                        type="button"
                        onClick={() => {
                            dispatch({ type: "CLOSE" });
                            returnFocusRef?.current?.focus();
                        }}
                        aria-label="Close account sheet"
                        className="w-10 h-10 rounded-lg border flex items-center justify-center text-ink-muted hover:text-ink-strong cursor-pointer"
                        style={{ borderColor: "var(--line-soft)", backgroundColor: "var(--surface-2)" }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Single Scroll Body */}
                <div className="account-sheet-body-3077 px-4 py-3 space-y-4">
                    {/* Profile Section */}
                    <section className="flex items-center gap-3">
                        <div
                            className="w-14 h-14 rounded-lg overflow-hidden border shrink-0 flex items-center justify-center"
                            style={{ borderColor: "var(--line-strong)", backgroundColor: "var(--surface-2)" }}
                        >
                            {profile?.avatar_url ? (
                                <img
                                    src={profile.avatar_url}
                                    alt={displayName}
                                    width={56}
                                    height={56}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <span
                                    className="font-mono text-sm font-semibold uppercase"
                                    style={{ color: "var(--accent)" }}
                                >
                                    {displayName.slice(0, 2)}
                                </span>
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div
                                className="text-sm font-semibold truncate"
                                style={{ fontFamily: "var(--font-chakra), sans-serif", color: "var(--ink-strong)" }}
                            >
                                {displayName}
                            </div>
                            <div className="font-mono text-xs tabular-nums text-ink-muted">
                                {tierLabel} · LV {progression.level}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => openTargetPanel("profile")}
                            className="h-9 px-3 rounded-lg border font-mono text-[11px] uppercase tracking-wider shrink-0 cursor-pointer"
                            style={{ borderColor: "var(--line-soft)", backgroundColor: "var(--surface-2)", color: "var(--ink-strong)" }}
                        >
                            Edit
                        </button>
                    </section>

                    {/* Wallet Telemetry Section */}
                    <section
                        className="rounded-lg border p-3 space-y-2"
                        style={{ borderColor: "var(--line-soft)", backgroundColor: "var(--surface-2)" }}
                    >
                        <div className="flex items-center justify-between">
                            <span
                                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
                                style={{ fontFamily: "var(--font-chakra), sans-serif" }}
                            >
                                Wallet
                            </span>
                            <span className="font-mono text-[11px] uppercase text-ink-faint">
                                {modeLabel}
                            </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs tabular-nums text-ink-strong truncate">
                                {truncateAddress(address)}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {address && (
                                    <button
                                        type="button"
                                        onClick={() => void handleCopy()}
                                        className="h-8 px-2.5 rounded border font-mono text-[11px] uppercase cursor-pointer"
                                        style={{ borderColor: "var(--line-soft)", color: "var(--ink-muted)" }}
                                    >
                                        {copied ? "Copied" : "Copy"}
                                    </button>
                                )}
                                {isEvmAddress(address) && (
                                    <a
                                        href={`https://sepolia.basescan.org/address/${address}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="h-8 px-2 rounded border font-mono text-[11px] inline-flex items-center"
                                        style={{ borderColor: "var(--line-soft)", color: "var(--ink-muted)" }}
                                        aria-label="View on Basescan"
                                    >
                                        ↗
                                    </a>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t" style={{ borderColor: "var(--line-soft)" }}>
                            <div>
                                <div className="text-[11px] text-ink-faint">CHIPS</div>
                                <div className="font-mono text-sm font-medium tabular-nums text-ink-strong">
                                    {chips.configured ? chips.human : "—"}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[11px] text-ink-faint">Coins</div>
                                <div className="font-mono text-sm font-medium tabular-nums text-ink-strong">
                                    {(profile?.coins ?? 0).toLocaleString()}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Network Section */}
                    <section
                        className="rounded-lg border p-3 space-y-2"
                        style={{ borderColor: "var(--line-soft)", backgroundColor: "var(--surface-2)" }}
                    >
                        <div className="flex items-center justify-between">
                            <span
                                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
                                style={{ fontFamily: "var(--font-chakra), sans-serif" }}
                            >
                                Network
                            </span>
                            <span className="font-mono text-[11px] text-ink-muted">
                                Room: {roomAuthority ? "CONNECTED" : "STANDBY"}
                            </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <StatusBadge
                                status={networkOk ? "online" : "pending"}
                                label={networkOk ? `Base Sepolia · ${DEFAULT_CHAIN_ID}` : "Wrong network"}
                            />
                            {!networkOk && (
                                <button
                                    type="button"
                                    disabled={isSwitchingChain}
                                    onClick={() => void switchChainAsync({ chainId: DEFAULT_CHAIN_ID }).catch(() => undefined)}
                                    className="h-8 px-2.5 rounded border font-mono text-[11px] uppercase cursor-pointer"
                                    style={{ borderColor: "var(--sig-warn)", color: "var(--sig-warn)" }}
                                >
                                    {isSwitchingChain ? "Switching…" : "Switch"}
                                </button>
                            )}
                        </div>
                    </section>

                    {/* Recent Matches Section */}
                    <section
                        className="rounded-lg border p-3 space-y-2"
                        style={{ borderColor: "var(--line-soft)", backgroundColor: "var(--surface-2)" }}
                    >
                        <div className="flex items-center justify-between">
                            <span
                                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
                                style={{ fontFamily: "var(--font-chakra), sans-serif" }}
                            >
                                Recent Matches
                            </span>
                            <button
                                type="button"
                                onClick={() => openTargetPanel("profile")}
                                className="font-mono text-[11px] uppercase cursor-pointer"
                                style={{ color: "var(--accent)" }}
                            >
                                Full History →
                            </button>
                        </div>
                        {recentMatches.length === 0 ? (
                            <p className="text-xs text-ink-faint">
                                {isGuest ? "Connect a wallet to record ranked history." : "No recent matches cached yet."}
                            </p>
                        ) : (
                            <div className="space-y-1.5">
                                {recentMatches.map((m) => (
                                    <div key={m.matchId} className="flex items-center justify-between font-mono text-xs tabular-nums">
                                        <span className="truncate text-ink-strong">
                                            <span style={{ color: m.won ? "var(--sig-ok)" : "var(--sig-danger)" }}>
                                                {m.won ? "W" : "L"}
                                            </span>{" "}
                                            {m.matchShape} {m.gameMode}
                                        </span>
                                        <span className="text-ink-faint shrink-0">{formatAgo(m.createdAt)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Security Section (Strict Wallet Boundary) */}
                    <section
                        className="rounded-lg border p-3 space-y-2"
                        style={{ borderColor: "var(--line-soft)", backgroundColor: "var(--surface-2)" }}
                    >
                        <div className="flex items-center justify-between">
                            <span
                                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
                                style={{ fontFamily: "var(--font-chakra), sans-serif" }}
                            >
                                Security
                            </span>
                            <button
                                type="button"
                                onClick={() => openTargetPanel("settings")}
                                className="font-mono text-[11px] uppercase cursor-pointer"
                                style={{ color: "var(--ink-muted)" }}
                            >
                                Settings →
                            </button>
                        </div>

                        {securityView.showPasskeyControls ? (
                            <div className="space-y-1.5 font-mono text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-ink-muted">Passkey boot lock</span>
                                    <span style={{ color: security.bootLock ? "var(--sig-ok)" : "var(--ink-faint)" }}>
                                        {security.bootLock ? "ON" : "OFF"}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-ink-muted">Auto-sign match msgs</span>
                                    <span style={{ color: security.autoSign ? "var(--sig-ok)" : "var(--ink-faint)" }}>
                                        {security.autoSign ? "ON" : "OFF"}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-ink-muted">
                                {securityView.externalWalletNotice}
                            </p>
                        )}

                        <div
                            className="flex items-center justify-between pt-2 border-t font-mono text-xs"
                            style={{ borderColor: "var(--line-soft)" }}
                        >
                            <span className="text-ink-muted truncate">
                                Allowances · {chipsAllowance.allowance > BigInt(0) ? chipsAllowance.allowanceHuman : "None"}
                            </span>
                            <button
                                type="button"
                                onClick={() => openTargetPanel("wallet")}
                                className="uppercase shrink-0 cursor-pointer"
                                style={{ color: "var(--accent)" }}
                            >
                                Manage →
                            </button>
                        </div>
                        <div className="flex items-center justify-between font-mono text-xs">
                            <span className="text-ink-muted">Active session</span>
                            <button
                                type="button"
                                onClick={() => clearAppSession()}
                                className="uppercase cursor-pointer"
                                style={{ color: "var(--ink-muted)" }}
                            >
                                Clear Session
                            </button>
                        </div>
                    </section>
                </div>

                {/* Fixed-Height Disconnect Footer (zero layout jump) */}
                <div
                    className="px-4 py-3 border-t shrink-0 min-h-[60px] flex items-center"
                    style={{ borderColor: "var(--line-soft)", backgroundColor: "var(--surface-1)" }}
                >
                    {isConfirmingDisconnect ? (
                        <div className="w-full flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-ink-strong truncate">
                                Confirm disconnect?
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => dispatch({ type: "CANCEL_DISCONNECT" })}
                                    className="h-9 px-3 rounded-lg border font-mono text-xs uppercase cursor-pointer"
                                    style={{ borderColor: "var(--line-soft)", color: "var(--ink-strong)" }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDisconnectNow}
                                    className="h-9 px-3 rounded-lg border font-mono text-xs uppercase cursor-pointer"
                                    style={{ borderColor: "var(--sig-danger)", color: "var(--sig-danger)", backgroundColor: "rgba(244, 63, 94, 0.12)" }}
                                >
                                    Disconnect
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => dispatch({ type: "REQUEST_DISCONNECT" })}
                            className="w-full h-9 rounded-lg border font-mono text-xs uppercase tracking-wider cursor-pointer"
                            style={{ borderColor: "rgba(244, 63, 94, 0.35)", color: "var(--sig-danger)" }}
                        >
                            {isGuest ? "Exit Guest Mode" : "Disconnect Wallet"}
                        </button>
                    )}
                </div>
            </div>
        </>,
        document.body,
    );
}

export default AccountPopover;
