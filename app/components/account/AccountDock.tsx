"use client";

import React, { useMemo } from "react";
import { useAccount, useChainId } from "wagmi";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePreferences } from "@/hooks/usePreferences";
import { StatusBadge } from "./StatusBadge";
import { AccountSheet } from "./AccountSheet";
import { useAccountDockState, TARGET_CHAIN_ID } from "./useAccountDockState";

export interface AccountDockProps {
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
  onOpenAllowances?: () => void;
  onOpenWallet?: () => void;
  className?: string;
}

function formatShortAddress(addr?: string | null): string {
  if (!addr) return "—";
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * §5.2 / §5.5 Account Dock Component
 * Supports collapsed dock state (desktop 264×64) and mobile avatar trigger.
 */
export const AccountDock: React.FC<AccountDockProps> = ({
  onOpenProfile,
  onOpenSettings,
  onOpenHistory,
  onOpenAllowances,
  onOpenWallet,
  className = "",
}) => {
  const { profile, address, displayName, isConnected } = useCurrentUser();
  const chainId = useChainId();
  const { preferences, updatePreference } = usePreferences();

  const isAudioMuted = !preferences.music;
  const toggleAudio = () => {
    updatePreference("ludo-music", isAudioMuted ? "true" : "false");
  };

  const {
    state,
    isExpanded,
    isConfirmingDisconnect,
    expand,
    collapse,
    requestDisconnect,
    cancelDisconnect,
    confirmDisconnect,
  } = useAccountDockState({
    isConnected,
    chainId,
  });

  const isWrongChain = chainId != null && chainId !== TARGET_CHAIN_ID;
  const statusState = !isConnected ? "offline" : isWrongChain ? "pending" : "online";

  const handleIdentityClick = () => {
    if (!isConnected) {
      if (onOpenWallet) onOpenWallet();
      return;
    }
    if (isExpanded) {
      collapse();
    } else {
      expand();
    }
  };

  return (
    <>
      <div
        className={`account-dock flex items-center justify-between h-16 px-3 bg-surface-2 border border-line-subtle rounded-xl text-ink-strong ${className}`}
      >
        {/* Identity block */}
        <button
          type="button"
          onClick={handleIdentityClick}
          aria-expanded={isExpanded}
          aria-controls="account-dialog-title"
          className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer group"
        >
          {/* Avatar (40x40) */}
          <div className="relative w-10 h-10 rounded-lg bg-surface-1 border border-line-dim flex items-center justify-center shrink-0 overflow-hidden">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-accent font-mono text-ludo-sm font-bold">
                {displayName ? displayName.slice(0, 2).toUpperCase() : "G"}
              </div>
            )}
            <StatusBadge status={statusState} size={10} />
          </div>

          {/* Identity labels */}
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-ludo-sm text-ink-strong truncate font-chakra group-hover:text-accent transition-colors">
              {displayName || "Guest"}
            </span>
            <div className="flex items-center gap-1.5 text-ludo-xs font-mono">
              <span className="text-ink-muted account-tabular-mono truncate max-w-[80px]">
                {formatShortAddress(address)}
              </span>
              <span
                className={`font-bold ${
                  isWrongChain ? "text-sig-warn" : "text-ink-muted"
                }`}
              >
                · {isWrongChain ? "WRONG NET" : "BASE SEP"}
              </span>
            </div>
          </div>
        </button>

        {/* Quick Actions (Settings, Audio, Disconnect) */}
        {isConnected && (
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Settings"
                title="Settings"
                className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:text-ink-strong hover:bg-surface-3 transition-colors"
              >
                ⚙
              </button>
            )}
            <button
              type="button"
              onClick={toggleAudio}
              aria-label={isAudioMuted ? "Unmute audio" : "Mute audio"}
              aria-pressed={!isAudioMuted}
              title={isAudioMuted ? "Audio Muted" : "Audio Active"}
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                isAudioMuted
                  ? "text-ink-faint hover:text-ink-muted"
                  : "text-accent hover:bg-surface-3"
              }`}
            >
              {isAudioMuted ? "🔇" : "🔊"}
            </button>
            <button
              type="button"
              onClick={requestDisconnect}
              aria-label="Disconnect"
              title="Disconnect"
              className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:text-sig-danger hover:bg-surface-3 transition-colors"
            >
              ⏻
            </button>
          </div>
        )}
      </div>

      {/* Account Sheet portal */}
      <AccountSheet
        isOpen={isExpanded}
        onClose={collapse}
        onOpenProfile={onOpenProfile}
        onOpenHistory={onOpenHistory}
        onOpenSettings={onOpenSettings}
        onOpenAllowances={onOpenAllowances}
        isConfirmingDisconnect={isConfirmingDisconnect}
        onRequestDisconnect={requestDisconnect}
        onCancelDisconnect={cancelDisconnect}
        onConfirmDisconnect={confirmDisconnect}
      />
    </>
  );
};

/**
 * Mobile Avatar Trigger for FooterNavPanel
 */
export const MobileAccountAvatarSlot: React.FC<{
  onClick: () => void;
  isOpen?: boolean;
}> = ({ onClick, isOpen = false }) => {
  const { profile, displayName, isConnected } = useCurrentUser();
  const chainId = useChainId();
  const isWrongChain = chainId != null && chainId !== TARGET_CHAIN_ID;
  const statusState = !isConnected ? "offline" : isWrongChain ? "pending" : "online";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={isOpen}
      aria-controls="account-dialog-title"
      aria-label="Open account menu"
      className="nav-item relative z-10 group flex flex-col items-center justify-center"
    >
      <div className="relative w-7 h-7 rounded-md bg-surface-1 border border-line-dim flex items-center justify-center shrink-0 overflow-hidden">
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-accent font-mono text-ludo-xs font-bold">
            {displayName ? displayName.slice(0, 2).toUpperCase() : "G"}
          </div>
        )}
        <StatusBadge status={statusState} size={8} />
      </div>
      <span className="nav-label text-ludo-xs">Account</span>
    </button>
  );
};
