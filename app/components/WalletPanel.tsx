"use client";

import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { useWalletMode } from "@/hooks/useWalletMode";
import { useNetworkLabel } from "@/hooks/useNetworkLabel";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useAppSession } from "@/hooks/useAppSession";
import { useTotalChips } from "@/hooks/useTotalChips";
import { formatCompactChips } from "@/lib/chips";
import SendTokenSheet from "./SendTokenSheet";
import ReceiveSheet from "./ReceiveSheet";
import WalletActivityList from "./WalletActivityList";
import WcWalletPanel from "./WcWalletPanel";
import WalletSecurityPanel from "./WalletSecurityPanel";
import AllowanceHubSheet from "./AllowanceHubSheet";
import RevokeAllowanceSheet from "./RevokeAllowanceSheet";
import ClaimHubSheet from "./ClaimHubSheet";
import { HudCornerTicks } from "./HudPrimitives";
import { ChipsHexIcon, CloseReticleIcon } from "./icons";

/**
 * Wallet — Coinbase-style card.
 * Footer: Home · Swap · Activity · More.
 * More hosts Allowances, Claims, Dapps, and Security. App Settings live in the header gear only
 * (never duplicated here). Activity is footer-only (no second action tile).
 */
type Screen =
    | "home"
    | "send"
    | "receive"
    | "swap"
    | "activity"
    | "more"
    | "dapps"
    | "security"
    | "allowance"
    | "revoke-allowance"
    | "claims";

function shortAddr(a: string | undefined) {
    if (!a) return "—";
    return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function TokenIcon({ kind }: { kind: "eth" | "usdc" | "chips" }) {
    if (kind === "eth") {
        return (
            <div className="cb-asset-icon" style={{ background: "#627EEA" }}>
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                    <path d="M12 2 6.5 12.2 12 15.5l5.5-3.3L12 2z" fill="#fff" opacity=".85" />
                    <path d="M12 16.8 6.5 13.5 12 22l5.5-8.5L12 16.8z" fill="#fff" opacity=".65" />
                </svg>
            </div>
        );
    }
    if (kind === "usdc") {
        return (
            <div className="cb-asset-icon" style={{ background: "#2775CA" }}>
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2" />
                    <path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
            </div>
        );
    }
    return (
        <div
            className="cb-asset-icon"
            style={{
                background: "linear-gradient(145deg, rgba(0, 229, 255, 0.24) 0%, #09131f 100%)",
                border: "1px solid rgba(0, 229, 255, 0.45)",
            }}
        >
            <ChipsHexIcon className="w-5 h-5 text-cyan-300" active />
        </div>
    );
}

function BaseIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
    return (
        <svg viewBox="0 0 512 512" className={className} fill="none" aria-hidden="true">
            <rect width="512" height="512" rx="118" fill="#0052FF" />
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M255.457 348.667C238.337 348.321 221.688 343.167 207.351 333.791C129.212 282.88 153.84 163.333 246.331 163.333C292.576 163.333 337.5 198.817 337.5 256C337.5 313.183 292.576 348.667 246.331 348.667H255.457ZM426 274.074H337.5C337.5 330.655 289.479 375.407 232.062 375.407C163.099 375.407 106 320.106 106 256C106 191.894 163.099 136.593 232.062 136.593C301.026 136.593 354.12 185.088 360.778 247.333H426C420.334 179.917 386.417 129.815 332.222 101.407C278.028 73 207.028 73.0001 152.833 101.407C98.6389 129.815 64.7222 179.917 59.0556 247.333C53.3889 314.75 87.3056 372.25 141.5 400.658C195.694 429.065 266.694 429.065 320.889 400.658C363.69 378.106 394.019 339.721 408.834 294.593H426V274.074Z"
                fill="white"
            />
        </svg>
    );
}

function InGameIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="6" width="20" height="12" rx="4" />
            <path d="M6 12h4m-2-2v4" />
            <circle cx="15" cy="11" r=".8" fill="currentColor" />
            <circle cx="18" cy="13" r=".8" fill="currentColor" />
        </svg>
    );
}

function ExternalWalletIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 7V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2" />
            <rect x="13" y="10" width="9" height="5" rx="1.5" />
            <circle cx="17.5" cy="12.5" r=".75" fill="currentColor" />
            <path d="M17 2h5m0 0v5m0-5l-6 6" />
        </svg>
    );
}

function DisconnectedIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m2 2 20 20" />
            <path d="M8.5 8.5 5 12l4 4 3.5-3.5" />
            <path d="m15.5 15.5 3.5-3.5-4-4-3.5 3.5" />
        </svg>
    );
}

function ActionButton({
    label,
    icon,
    onClick,
    primary,
}: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    primary?: boolean;
}) {
    return (
        <button type="button" className="cb-action" onClick={onClick}>
            <span className={`cb-action-circle ${primary ? "primary" : ""}`}>{icon}</span>
            <span className="cb-action-label">{label}</span>
        </button>
    );
}

function MoreRow({
    icon,
    title,
    hint,
    onClick,
    last,
}: {
    icon: React.ReactNode;
    title: string;
    hint: string;
    onClick: () => void;
    last?: boolean;
}) {
    return (
        <button
            type="button"
            className={`cb-more-row ${last ? "last" : ""}`}
            onClick={onClick}
        >
            <span className="cb-more-icon">{icon}</span>
            <span className="cb-more-text">
                <span className="cb-more-title">{title}</span>
                <span className="cb-more-hint">{hint}</span>
            </span>
            <svg viewBox="0 0 24 24" className="cb-more-chevron" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
            </svg>
        </button>
    );
}

const TITLES: Record<Screen, string> = {
    home: "Wallet",
    send: "Send",
    receive: "Receive",
    swap: "Swap",
    activity: "Activity",
    more: "More",
    dapps: "Dapps",
    security: "Security",
    allowance: "Token Allowances",
    "revoke-allowance": "Revoke Allowances",
    claims: "Claim Hub",
};

export default function WalletPanel({ onClose }: { onClose: () => void }) {
    const { tokens, loading, refresh, needsReconnect, address, usdc } = useWalletAssets();
    const totalChips = useTotalChips();
    const mode = useWalletMode();
    const network = useNetworkLabel();
    const { sessionId } = useAppSession();
    const hasActiveSession = Boolean(sessionId);
    const { items: activity } = useWalletActivity();
    const [screen, setScreen] = useState<Screen>("home");
    const [copied, setCopied] = useState(false);

    // H2 — CHIPS never priced into USD total.
    const usdTotal = useMemo(() => Number(formatUnits(usdc ?? BigInt(0), 6)), [usdc]);

    const unclaimedSourceParts = useMemo(
        () =>
            [
                totalChips.vaultClaimableChips > 0
                    ? `Match Prizes ${formatCompactChips(totalChips.vaultClaimableChips)}`
                    : null,
                totalChips.clanClaimableChips > 0
                    ? `Clan ${formatCompactChips(totalChips.clanClaimableChips)}`
                    : null,
                totalChips.legacyClaimableChips > 0
                    ? `Legacy ${formatCompactChips(totalChips.legacyClaimableChips)}`
                    : null,
            ].filter(Boolean) as string[],
        [
            totalChips.clanClaimableChips,
            totalChips.legacyClaimableChips,
            totalChips.vaultClaimableChips,
        ],
    );

    const claimsHubHint =
        totalChips.unclaimedChips > 0 || totalChips.vaultTotalChips > 0
            ? [
                  totalChips.unclaimedChips > 0
                      ? `${formatCompactChips(totalChips.unclaimedChips)} unclaimed`
                      : null,
                  totalChips.vaultTotalChips > 0
                      ? `${formatCompactChips(totalChips.vaultTotalChips)} in vault`
                      : null,
              ]
                  .filter(Boolean)
                  .join(" · ")
            : "Top up match vault, withdraw & claim prizes";

    const copyAddress = async () => {
        if (!address) return;
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch {
            /* clipboard blocked */
        }
    };

    const isHome = screen === "home";
    const isMoreBranch =
        screen === "more" ||
        screen === "dapps" ||
        screen === "security" ||
        screen === "allowance" ||
        screen === "revoke-allowance" ||
        screen === "claims";
    const title = TITLES[screen];

    // Footer: four destinations. Swap/Activity are first-class tabs (no
    // duplicate action tiles). More hosts Dapps + Security only — app
    // Settings stay in the header gear.
    const footer: { id: Screen; label: string; icon: React.ReactNode }[] = [
        {
            id: "home",
            label: "Home",
            icon: (
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
                </svg>
            ),
        },
        {
            id: "swap",
            label: "Swap",
            icon: (
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 7h11l-3-3M17 17H6l3 3" />
                    <path d="M18 7l-3 3M6 17l3-3" opacity=".4" />
                </svg>
            ),
        },
        {
            id: "activity",
            label: "Activity",
            icon: (
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h16M4 12h10M4 18h7" />
                    <circle cx="18" cy="12" r="2" fill="currentColor" stroke="none" />
                </svg>
            ),
        },
        {
            id: "more",
            label: "More",
            icon: (
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <circle cx="6" cy="12" r="1.6" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                    <circle cx="18" cy="12" r="1.6" fill="currentColor" />
                </svg>
            ),
        },
    ];

    const backTarget: Screen =
        screen === "revoke-allowance"
            ? "allowance"
            : isMoreBranch && screen !== "more"
              ? "more"
              : "home";

    return (
        <>
            {/* Dim layer — inline fill so theme CSS cannot turn this white */}
            <div
                className="cb-wallet-backdrop"
                aria-hidden
                onClick={onClose}
                style={{ background: 'rgba(6, 8, 14, 0.55)' }}
            />
            <div className="cb-wallet-root" role="dialog" aria-modal="true" aria-label="Wallet">
                <HudCornerTicks />
                <header className="cb-nav">
                    {!isHome ? (
                        <button type="button" className="cb-icon-btn" aria-label="Back" onClick={() => setScreen(backTarget)}>
                            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M15 18l-6-6 6-6" />
                            </svg>
                        </button>
                    ) : (
                        <div className="cb-nav-title flex items-center gap-2">
                            <span>Wallet</span>
                            <span
                                className="relative flex h-2 w-2 items-center justify-center cursor-help"
                                title={hasActiveSession ? "Session Active (Authenticated)" : "Session Inactive (Not Authenticated)"}
                                aria-label={hasActiveSession ? "Session Active" : "Session Inactive"}
                            >
                                {hasActiveSession && (
                                    <span className="hud-status-breath absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                                )}
                                <span className={`cb-session-dot ${hasActiveSession ? "active" : "inactive"}`} />
                            </span>
                        </div>
                    )}
                    {isHome && (
                        <div
                            className="cb-mode-pill"
                            title={`${network.long} · ${
                                mode === "ingame"
                                    ? "In-Game Smart Wallet"
                                    : mode === "external"
                                      ? "Connected External Wallet"
                                      : "Wallet Not Connected"
                            }`}
                        >
                            <div className="flex items-center gap-1.5">
                                <BaseIcon className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{network.isTestnet ? "Sepolia" : network.label.replace(/^Base\s*/i, "") || "Base"}</span>
                            </div>
                            <span className="cb-mode-pill-divider" aria-hidden="true" />
                            <div className="flex items-center gap-1">
                                {mode === "ingame" ? (
                                    <>
                                        <InGameIcon className="w-3.5 h-3.5 text-cyan-400" />
                                        <span className="text-cyan-400 font-semibold">In-Game</span>
                                    </>
                                ) : mode === "external" ? (
                                    <>
                                        <ExternalWalletIcon className="w-3.5 h-3.5 text-amber-300" />
                                        <span className="text-amber-300 font-semibold">External</span>
                                    </>
                                ) : (
                                    <>
                                        <DisconnectedIcon className="w-3.5 h-3.5 opacity-40" />
                                        <span className="opacity-40 font-semibold">Offline</span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                    {!isHome && <h1 className="cb-nav-title">{title}</h1>}
                    <button type="button" className="cb-icon-btn panel-close-3077" aria-label="Close wallet" onClick={onClose}>
                        <CloseReticleIcon className="w-4 h-4" />
                    </button>
                </header>

                {needsReconnect && (
                    <div className="cb-banner">
                        Session expired — reconnect to restore in-game wallet. External wallets stay connected.
                    </div>
                )}

                <main className="cb-main">
                    {isHome && (
                        <>
                            <button type="button" className="cb-address" onClick={copyAddress} title="Copy address">
                                <span className="cb-addr-text">{shortAddr(address)}</span>
                                <span className="cb-copy">{copied ? "Copied" : "Copy"}</span>
                            </button>

                            <div className="cb-balance">
                                <div className="cb-balance-label">Portfolio</div>
                                <div className="cb-balance-row">
                                    <span className="cb-balance-num">
                                        $
                                        {usdTotal.toLocaleString(undefined, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        })}
                                    </span>
                                    <span className="cb-balance-ccy">USD</span>
                                </div>
                                <div className="cb-balance-sub">Priced assets only · CHIPS not included</div>
                            </div>

                            <div className="cb-actions duo">
                                <ActionButton
                                    label="Send"
                                    primary
                                    onClick={() => setScreen("send")}
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 19V5M6 11l6-6 6 6" />
                                        </svg>
                                    }
                                />
                                <ActionButton
                                    label="Receive"
                                    onClick={() => setScreen("receive")}
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 5v14M6 13l6 6 6-6" />
                                        </svg>
                                    }
                                />
                            </div>

                            <div className="cb-section">
                                <div className="cb-section-head">
                                    <span>Assets</span>
                                    <button
                                        type="button"
                                        className="cb-link"
                                        onClick={() => void Promise.all([refresh(), totalChips.refresh()])}
                                    >
                                        {loading || totalChips.loading ? "Updating…" : "Refresh"}
                                    </button>
                                </div>
                                <div className="cb-card">
                                    {tokens.map((t) => {
                                        const isChips = t.key === "chips";
                                        const amountText = loading
                                            ? "…"
                                            : isChips
                                              ? formatCompactChips(t.raw)
                                              : t.formatted;
                                        const secondaryText = isChips
                                            ? totalChips.walletChips >= 1000
                                                ? `${totalChips.walletChips.toLocaleString()} CHIPS`
                                                : "On-chain"
                                            : t.unpriced || t.key === "eth"
                                              ? "—"
                                              : `$${Number(t.formatted).toFixed(2)}`;
                                        return (
                                            <button
                                                key={t.key}
                                                type="button"
                                                className="cb-asset-row"
                                                onClick={() => setScreen("send")}
                                            >
                                                <TokenIcon kind={t.key} />
                                                <div className="cb-asset-meta">
                                                    <div className="cb-asset-name">
                                                        {t.label}
                                                        {t.unpriced && <span className="cb-badge">Unpriced</span>}
                                                    </div>
                                                    <div className="cb-asset-sub">
                                                        {isChips ? "In Wallet · Spendable on Base" : "Base"}
                                                    </div>
                                                </div>
                                                <div className="cb-asset-bal">
                                                    <div className="cb-asset-amt">{amountText}</div>
                                                    <div className="cb-asset-fiat">{secondaryText}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="cb-section">
                                <div className="cb-section-head">
                                    <span>CHIPS Breakdown</span>
                                    <button type="button" className="cb-link" onClick={() => setScreen("claims")}>
                                        Total {totalChips.totalFormatted} · Claim Hub
                                    </button>
                                </div>
                                <div className="cb-card">
                                    <button
                                        type="button"
                                        className="cb-asset-row"
                                        onClick={() => setScreen("send")}
                                    >
                                        <div
                                            className="cb-asset-icon"
                                            style={{
                                                background: "#09131f",
                                                border: "1px solid rgba(0, 229, 255, 0.45)",
                                            }}
                                        >
                                            <ChipsHexIcon className="w-4 h-4 text-cyan-300" active />
                                        </div>
                                        <div className="cb-asset-meta">
                                            <div className="cb-asset-name">In Wallet</div>
                                            <div className="cb-asset-sub">On-chain spendable CHIPS</div>
                                        </div>
                                        <div className="cb-asset-bal">
                                            <div className="cb-asset-amt">
                                                {formatCompactChips(totalChips.walletChips)}
                                            </div>
                                            <div className="cb-asset-fiat">
                                                {totalChips.walletChips >= 1000
                                                    ? `${totalChips.walletChips.toLocaleString()} CHIPS`
                                                    : "Spendable"}
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        className="cb-asset-row"
                                        onClick={() => setScreen("claims")}
                                    >
                                        <div
                                            className="cb-asset-icon"
                                            style={{
                                                background: "#0b1a29",
                                                border: "1px solid rgba(56, 189, 248, 0.45)",
                                            }}
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                className="w-4 h-4 text-cyan-300"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                            </svg>
                                        </div>
                                        <div className="cb-asset-meta">
                                            <div className="cb-asset-name">Arena Match Vault</div>
                                            <div className="cb-asset-sub">
                                                {totalChips.vaultReservedChips > 0
                                                    ? `Reusable 0-gas · ${formatCompactChips(totalChips.vaultReservedChips)} locked`
                                                    : "Reusable 0-gas match balance"}
                                            </div>
                                        </div>
                                        <div className="cb-asset-bal">
                                            <div className="cb-asset-amt">
                                                {formatCompactChips(totalChips.vaultAvailableChips)}
                                            </div>
                                            <div className="cb-asset-fiat">
                                                {totalChips.vaultAvailableChips >= 1000
                                                    ? `${totalChips.vaultAvailableChips.toLocaleString()} CHIPS`
                                                    : "Ready"}
                                            </div>
                                        </div>
                                    </button>

                                    {totalChips.vaultReservedChips > 0 && (
                                        <div className="cb-asset-row static">
                                            <div
                                                className="cb-asset-icon"
                                                style={{
                                                    background: "#1c1507",
                                                    border: "1px solid rgba(251, 191, 36, 0.45)",
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    className="w-4 h-4 text-amber-300"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                >
                                                    <circle cx="12" cy="12" r="9" />
                                                    <path d="M12 7v5l3 2" />
                                                </svg>
                                            </div>
                                            <div className="cb-asset-meta">
                                                <div className="cb-asset-name">
                                                    Locked in Match
                                                    <span className="cb-badge">Active</span>
                                                </div>
                                                <div className="cb-asset-sub">
                                                    Reserved for open search or table
                                                </div>
                                            </div>
                                            <div className="cb-asset-bal">
                                                <div className="cb-asset-amt">
                                                    {formatCompactChips(totalChips.vaultReservedChips)}
                                                </div>
                                                <div className="cb-asset-fiat status-pending">
                                                    {`${totalChips.vaultReservedChips.toLocaleString()} CHIPS`}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        className="cb-asset-row"
                                        onClick={() => setScreen("claims")}
                                    >
                                        <div
                                            className="cb-asset-icon"
                                            style={{
                                                background: "#071f17",
                                                border: "1px solid rgba(52, 211, 153, 0.45)",
                                            }}
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                className="w-4 h-4 text-emerald-300"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                                                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                                                <path d="M4 22h16" />
                                                <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
                                                <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
                                                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                                            </svg>
                                        </div>
                                        <div className="cb-asset-meta">
                                            <div className="cb-asset-name">
                                                Unclaimed Rewards
                                                {totalChips.unclaimedChips > 0 && (
                                                    <span className="cb-badge">Claimable</span>
                                                )}
                                            </div>
                                            <div className="cb-asset-sub">
                                                {unclaimedSourceParts.length > 0
                                                    ? unclaimedSourceParts.join(" · ")
                                                    : "Claim Hub · Match & Clan prizes"}
                                            </div>
                                        </div>
                                        <div className="cb-asset-bal">
                                            <div className="cb-asset-amt">
                                                {formatCompactChips(totalChips.unclaimedChips)}
                                            </div>
                                            <div
                                                className={`cb-asset-fiat ${
                                                    totalChips.unclaimedChips > 0 ? "status-confirmed" : ""
                                                }`}
                                            >
                                                {totalChips.unclaimedChips > 0
                                                    ? totalChips.unclaimedChips >= 1000
                                                        ? `${totalChips.unclaimedChips.toLocaleString()} ready`
                                                        : "Tap to claim"
                                                    : "None pending"}
                                            </div>
                                        </div>
                                    </button>

                                    {totalChips.escrowChips > 0 && (
                                        <div className="cb-asset-row static">
                                            <div
                                                className="cb-asset-icon"
                                                style={{
                                                    background: "#121722",
                                                    border: "1px solid rgba(148, 163, 184, 0.35)",
                                                }}
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    className="w-4 h-4 text-cyan-300"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                >
                                                    <path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9" />
                                                    <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
                                                    <path d="M4 9h16" />
                                                </svg>
                                            </div>
                                            <div className="cb-asset-meta">
                                                <div className="cb-asset-name">Marketplace Escrow</div>
                                                <div className="cb-asset-sub">Spendable in Marketplace</div>
                                            </div>
                                            <div className="cb-asset-bal">
                                                <div className="cb-asset-amt">
                                                    {formatCompactChips(totalChips.escrowChips)}
                                                </div>
                                                <div className="cb-asset-fiat">
                                                    {`${totalChips.escrowChips.toLocaleString()} CHIPS`}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="cb-section">
                                <div className="cb-section-head">
                                    <span>Recent</span>
                                    <button type="button" className="cb-link" onClick={() => setScreen("activity")}>
                                        See all
                                    </button>
                                </div>
                                <div className="cb-card">
                                    {activity.length === 0 ? (
                                        <p className="cb-empty">No transfers yet. Sends you confirm show up here.</p>
                                    ) : (
                                        activity.slice(0, 4).map((i) => (
                                            <div key={i.hash || i.id} className="cb-asset-row static">
                                                <div className="cb-asset-icon neutral">{i.kind === "receive" ? "↓" : "↑"}</div>
                                                <div className="cb-asset-meta">
                                                    <div className="cb-asset-name">
                                                        {i.kind === "receive" ? "Received" : i.kind === "send" ? "Sent" : i.kind}
                                                    </div>
                                                    <div className="cb-asset-sub font-mono">{i.counterparty}</div>
                                                </div>
                                                <div className="cb-asset-bal">
                                                    <div className="cb-asset-amt">
                                                        {i.kind === "receive" ? "+" : "−"}
                                                        {i.amount} {i.token}
                                                    </div>
                                                    <div className={`cb-asset-fiat status-${i.status}`}>{i.status}</div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {screen === "send" && (
                        <div className="cb-screen">
                            <SendTokenSheet onDone={() => setScreen("activity")} />
                        </div>
                    )}
                    {screen === "receive" && (
                        <div className="cb-screen">
                            <ReceiveSheet />
                        </div>
                    )}
                    {screen === "swap" && (
                        <div className="cb-screen">
                            <div className="cb-empty-state">
                                <p className="cb-empty-title">Swap ships with Base mainnet</p>
                                <p className="cb-empty-hint">
                                    The app is on Base Sepolia. Coinbase swap is mainnet-only — it unlocks
                                    when we launch on Base.
                                </p>
                            </div>
                        </div>
                    )}
                    {screen === "activity" && (
                        <div className="cb-screen">
                            <WalletActivityList />
                        </div>
                    )}
                    {screen === "more" && (
                        <div className="cb-screen">
                            <p className="cb-more-lead">Wallet tools. App settings live in the header gear.</p>
                            <div className="cb-card cb-more-card">
                                <MoreRow
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                            <path d="m9 12 2 2 4-4" />
                                        </svg>
                                    }
                                    title="Token Allowances"
                                    hint="Pre-approved budgets & 1-click game entry"
                                    onClick={() => setScreen("allowance")}
                                />
                                <MoreRow
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                                            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                                            <path d="M4 22h16" />
                                            <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
                                            <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
                                            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                                        </svg>
                                    }
                                    title="Vault & Claim Hub"
                                    hint={claimsHubHint}
                                    onClick={() => setScreen("claims")}
                                />
                                <MoreRow
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="4" y="5" width="16" height="14" rx="3" />
                                            <path d="M8 10h3M8 14h8" />
                                        </svg>
                                    }
                                    title="Dapps"
                                    hint="Connect Uniswap and other apps via WalletConnect"
                                    onClick={() => setScreen("dapps")}
                                />
                                <MoreRow
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 3l8 4v5c0 5-3.5 8.2-8 9-4.5-.8-8-4-8-9V7l8-4z" />
                                            <path d="M9.5 12l1.8 1.8L15 10" />
                                        </svg>
                                    }
                                    title="Security"
                                    hint={mode === "ingame" ? "Passkey · export · notifications" : "Notifications · wallet details"}
                                    onClick={() => setScreen("security")}
                                    last
                                />
                            </div>
                            {/* Settings intentionally absent — header gear only. */}
                        </div>
                    )}
                    {screen === "allowance" && (
                        <div className="cb-screen">
                            <AllowanceHubSheet onOpenRevoke={() => setScreen("revoke-allowance")} />
                        </div>
                    )}
                    {screen === "revoke-allowance" && (
                        <div className="cb-screen">
                            <RevokeAllowanceSheet onBack={() => setScreen("allowance")} />
                        </div>
                    )}
                    {screen === "claims" && (
                        <div className="cb-screen">
                            <ClaimHubSheet />
                        </div>
                    )}
                    {screen === "dapps" && (
                        <div className="cb-screen">
                            <WcWalletPanel />
                        </div>
                    )}
                    {screen === "security" && (
                        <div className="cb-screen">
                            {/* Linked wallets lives inside WalletSecurityPanel */}
                            <WalletSecurityPanel />
                        </div>
                    )}
                </main>

                <nav className="cb-tabs" aria-label="Wallet sections">
                    {footer.map((tab) => {
                        const active =
                            screen === tab.id ||
                            (tab.id === "home" && (screen === "send" || screen === "receive")) ||
                            (tab.id === "more" && isMoreBranch);
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                className={`cb-tab ${active ? "active" : ""}`}
                                onClick={() => setScreen(tab.id)}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>
        </>
    );
}
