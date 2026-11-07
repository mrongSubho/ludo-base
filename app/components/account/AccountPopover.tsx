"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, useChainId, useSwitchChain, useDisconnect } from "wagmi";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useWalletMode } from "@/hooks/useWalletMode";
import { useAppSession } from "@/hooks/useAppSession";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useSecurityPrefs } from "@/hooks/useSecurityPrefs";
import { useTeamUp } from "@/hooks/useTeamUp";
import { getProgression } from "@/lib/progression";
import { StatusBadge } from "./StatusBadge";
import { TARGET_CHAIN_ID } from "./useAccountDockState";

export interface AccountPopoverProps {
  onClose: () => void;
  onOpenProfile?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onOpenAllowances?: () => void;
  isConfirmingDisconnect?: boolean;
  onRequestDisconnect?: () => void;
  onCancelDisconnect?: () => void;
  onConfirmDisconnect?: () => void;
}

interface MatchRecord {
  matchId: string;
  gameMode: string;
  matchShape: string;
  won: boolean;
  createdAt: string;
  poolEntryFee: number | null;
  rxpDelta: number;
}

function formatShortAddress(addr?: string | null): string {
  if (!addr) return "—";
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatRelativeTime(isoDate?: string | null): string {
  if (!isoDate) return "—";
  const deltaMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.max(0, Math.floor(deltaMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * §5.3 / §5.5 Account Popover & Bottom Sheet Internal Sections
 */
export const AccountPopover: React.FC<AccountPopoverProps> = ({
  onClose,
  onOpenProfile,
  onOpenHistory,
  onOpenSettings: _onOpenSettings,
  onOpenAllowances,
  isConfirmingDisconnect = false,
  onRequestDisconnect,
  onCancelDisconnect,
  onConfirmDisconnect,
}) => {
  const { profile, address, displayName, isConnected } = useCurrentUser();
  const walletMode = useWalletMode();
  const { connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const { peekAppSession, clearAppSession } = useAppSession();
  const { tokens, eth, usdc } = useWalletAssets();
  const chips = useChipsBalance();
  const { isLobbyConnected } = useTeamUp();
  const { bootLock, autoSign, setBootLock, setAutoSign } = useSecurityPrefs();

  // Address copy state
  const [copied, setCopied] = useState(false);
  const handleCopyAddress = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [address]);

  // Progression calculation
  const progression = useMemo(
    () => getProgression(profile?.lxp || 0, profile?.rxp || 0),
    [profile?.lxp, profile?.rxp]
  );

  // Recent matches state
  const [recentMatches, setRecentMatches] = useState<MatchRecord[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    async function fetchRecentMatches() {
      setIsLoadingMatches(true);
      try {
        const sessionToken = peekAppSession();
        const headers: Record<string, string> = {};
        if (sessionToken) {
          headers["x-app-session"] = sessionToken;
        }
        const res = await fetch(`/api/matches/history?wallet=${encodeURIComponent(address || "")}`, {
          headers,
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data.matches)) {
            setRecentMatches(data.matches.slice(0, 3));
          }
        }
      } catch {
        /* best-effort telemetry */
      } finally {
        if (!cancelled) setIsLoadingMatches(false);
      }
    }

    void fetchRecentMatches();
    return () => {
      cancelled = true;
    };
  }, [address, peekAppSession]);

  // Switch network handler
  const handleSwitchNetwork = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: TARGET_CHAIN_ID });
    } catch {
      /* user rejected or error */
    }
  }, [switchChainAsync]);

  // Disconnect handler
  const handleFinalDisconnect = useCallback(() => {
    if (onConfirmDisconnect) {
      onConfirmDisconnect();
    } else {
      clearAppSession();
      disconnect();
      onClose();
    }
  }, [onConfirmDisconnect, clearAppSession, disconnect, onClose]);

  const ethFormatted = tokens.find((t) => t.key === "eth")?.formatted || "0.00";
  const usdcFormatted = tokens.find((t) => t.key === "usdc")?.formatted || "0.00";
  const chipsFormatted = chips.human || "0";

  const isWrongChain = chainId !== TARGET_CHAIN_ID;
  const isIngameWallet = walletMode === "ingame";
  const connectorName = connector?.name || "MetaMask";

  return (
    <div className="flex flex-col h-full overflow-hidden text-ink-strong">
      {/* ── Popover / Sheet Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-subtle bg-surface-2 shrink-0">
        <span
          id="account-dialog-title"
          className="font-mono text-ludo-xs font-bold tracking-wider text-ink-muted uppercase"
        >
          ACCOUNT
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close account sheet"
          className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink-strong hover:bg-surface-3 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* ── Scrollable Body ── */}
      <div className="flex-1 overflow-y-auto panel-body-scroller">
        {/* ── §5.3 Section 1: Profile ── */}
        <div className="account-section-header">
          <span>Identity</span>
        </div>
        <div className="account-section-content flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-14 h-14 rounded-xl bg-surface-1 border border-line-dim flex items-center justify-center shrink-0 overflow-hidden">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-accent font-mono text-ludo-md font-bold">
                  {displayName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <StatusBadge status={isConnected ? "online" : "offline"} size={12} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-ludo-md text-ink-strong truncate font-chakra">
                {displayName}
              </span>
              <span className="text-ludo-xs text-ink-muted font-mono tracking-tight">
                Tier: {progression.tier} {progression.subRank} · LV {progression.level}
              </span>
            </div>
          </div>
          {onOpenProfile && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenProfile();
              }}
              className="account-btn-secondary shrink-0"
            >
              EDIT PROFILE
            </button>
          )}
        </div>

        {/* ── §5.3 Section 2: Wallet Telemetry ── */}
        <div className="account-section-header">
          <span>Wallet</span>
        </div>
        <div className="account-section-content">
          <div className="flex items-center justify-between text-ludo-xs font-mono">
            <span className="text-ink-strong select-all account-tabular-mono">
              {formatShortAddress(address)}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyAddress}
                className="account-btn-secondary py-1 px-2 text-ludo-xs"
                title="Copy address"
              >
                {copied ? "COPIED" : "COPY"}
              </button>
              {address && (
                <a
                  href={`https://sepolia.basescan.org/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="account-btn-secondary py-1 px-2 text-ludo-xs"
                  title="View on BaseScan"
                >
                  ↗
                </a>
              )}
            </div>
          </div>
          <div className="text-ludo-xs text-ink-muted font-mono">
            Mode:{" "}
            <span className="text-accent font-semibold">
              {isIngameWallet ? "IN-GAME (CDP)" : `EXTERNAL (${connectorName})`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line-dim text-ludo-xs font-mono">
            <div className="flex justify-between bg-surface-1 p-2 rounded border border-line-dim">
              <span className="text-ink-muted">CHIPS</span>
              <span className="account-tabular-mono text-ink-strong font-bold">
                {chipsFormatted}
              </span>
            </div>
            <div className="flex justify-between bg-surface-1 p-2 rounded border border-line-dim">
              <span className="text-ink-muted">USDC</span>
              <span className="account-tabular-mono text-ink-strong font-bold">
                {Number(usdcFormatted).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between bg-surface-1 p-2 rounded border border-line-dim col-span-2">
              <span className="text-ink-muted">ETH</span>
              <span className="account-tabular-mono text-ink-strong font-bold">
                {Number(ethFormatted).toFixed(4)}
              </span>
            </div>
          </div>
        </div>

        {/* ── §5.3 Section 3: Network & Connectivity ── */}
        <div className="account-section-header">
          <span>Network</span>
        </div>
        <div className="account-section-content text-ludo-xs font-mono">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isWrongChain ? "bg-sig-warn" : "bg-sig-ok"
                }`}
              />
              <span className="text-ink-strong">
                {isWrongChain ? "WRONG NETWORK" : "Base Sepolia · 84532"}
              </span>
            </div>
            <div className="text-ink-muted">
              Room:{" "}
              <span
                className={isLobbyConnected ? "text-sig-ok font-semibold" : "text-ink-faint"}
              >
                {isLobbyConnected ? "CONNECTED" : "LOBBY"}
              </span>
            </div>
          </div>
          {isWrongChain && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleSwitchNetwork}
                disabled={isSwitchingChain}
                className="w-full py-2 bg-sig-warn/15 border border-sig-warn text-sig-warn font-mono font-bold text-ludo-xs rounded flex items-center justify-center hover:bg-sig-warn/25 transition-colors"
              >
                {isSwitchingChain ? "SWITCHING..." : "SWITCH TO BASE SEPOLIA"}
              </button>
            </div>
          )}
        </div>

        {/* ── §5.3 Section 4: Recent Matches ── */}
        <div className="account-section-header">
          <span>Recent Matches</span>
        </div>
        <div className="account-section-content text-ludo-xs font-mono">
          {isLoadingMatches ? (
            <div className="py-2 text-ink-muted text-center">Loading matches...</div>
          ) : recentMatches.length === 0 ? (
            <div className="py-2 text-ink-muted text-center">No recent matches recorded</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {recentMatches.map((m) => (
                <div
                  key={m.matchId}
                  className="flex items-center justify-between py-1 px-2 rounded bg-surface-1 border border-line-dim"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-ludo-xs font-bold ${
                        m.won
                          ? "bg-sig-ok/15 text-sig-ok"
                          : "bg-sig-danger/15 text-sig-danger"
                      }`}
                    >
                      {m.won ? "W" : "L"}
                    </span>
                    <span className="text-ink-strong capitalize">
                      {m.matchShape} {m.gameMode}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`account-tabular-mono font-bold ${
                        m.won ? "text-sig-ok" : "text-sig-danger"
                      }`}
                    >
                      {m.won
                        ? `+${m.poolEntryFee ? m.poolEntryFee * 2 : 100} CHIPS`
                        : `-${m.poolEntryFee || 100} CHIPS`}
                    </span>
                    <span className="text-ink-muted">
                      {formatRelativeTime(m.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {onOpenHistory && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenHistory();
              }}
              className="text-left text-accent hover:underline pt-1 text-ludo-xs font-bold"
            >
              [VIEW FULL HISTORY →]
            </button>
          )}
        </div>

        {/* ── §5.3 Section 5: Security (MANDATORY WALLET BOUNDARY) ── */}
        <div className="account-section-header">
          <span>Security</span>
        </div>
        <div className="account-section-content text-ludo-xs font-mono">
          {isIngameWallet ? (
            <>
              {/* Passkey boot lock toggle */}
              <div className="flex items-center justify-between">
                <span className="text-ink-strong">Passkey boot lock</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bootLock}
                  data-checked={bootLock}
                  onClick={() => setBootLock(!bootLock)}
                  className="account-toggle-track"
                >
                  <span className="account-toggle-thumb" />
                </button>
              </div>

              {/* Auto-sign match messages toggle */}
              <div className="flex items-center justify-between">
                <span className="text-ink-strong">Auto-sign match msgs</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSign}
                  data-checked={autoSign}
                  onClick={() => setAutoSign(!autoSign)}
                  className="account-toggle-track"
                >
                  <span className="account-toggle-thumb" />
                </button>
              </div>

              {/* Allowances management link */}
              {onOpenAllowances && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-ink-muted">Allowances</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAllowances();
                    }}
                    className="account-btn-secondary py-1 px-2"
                  >
                    MANAGE →
                  </button>
                </div>
              )}

              {/* Session sign-out */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-ink-muted">Active session</span>
                <button
                  type="button"
                  onClick={() => {
                    clearAppSession();
                    onClose();
                  }}
                  className="account-btn-secondary py-1 px-2 text-sig-warn"
                >
                  SIGN OUT
                </button>
              </div>
            </>
          ) : (
            /* External Wallet Boundary Guarantee: No passkeys, no WebAuthn prompts */
            <div className="text-ink-muted py-1 leading-relaxed">
              Security is managed by your wallet ({connectorName}).
            </div>
          )}
        </div>
      </div>

      {/* ── §5.3 Disconnect Footer (In-Place Confirmation, Fixed Height) ── */}
      <div className="p-3 border-t border-line-subtle bg-surface-2 shrink-0 h-16 flex items-center justify-center">
        {isConfirmingDisconnect ? (
          <div className="flex items-center justify-between w-full gap-2">
            <span className="text-ludo-xs font-mono text-sig-warn font-semibold">
              Confirm disconnect?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancelDisconnect}
                className="account-btn-secondary py-1.5 px-3"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleFinalDisconnect}
                className="account-btn-danger py-1.5 px-3"
              >
                DISCONNECT
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRequestDisconnect}
            className="account-btn-danger w-full justify-center"
          >
            DISCONNECT WALLET
          </button>
        )}
      </div>
    </div>
  );
};
