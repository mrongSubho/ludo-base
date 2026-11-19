"use client";

import React from 'react';
import {
    ChatIcon,
    ChipsHexIcon,
    PilotAvatarFallbackIcon,
    SlidersIcon,
} from './icons';
import { RankTierIcon } from './RankTierIcon';
import { useTotalChips } from '@/hooks/useTotalChips';
import { formatCompactChips } from '@/lib/chips';

// ─── Shared Token Glyph (back-compat re-export for BoardHeaderCompact/page) ──

export const TokenIcon = () => <ChipsHexIcon className="w-full h-full" active />;

// ─── Component ───────────────────────────────────────────────────────────────

interface HeaderNavPanelProps {
    finalAvatar: string | null;
    finalName: string;
    level: number;
    tier: string;
    coins: number;
    unreadCount: number;
    hasNotifications: boolean;
    onMessagesClick: () => void;
    onSettingsClick: () => void;
    onFeedClick?: () => void;
    /** Open wallet at page shell — never render it inside this header. */
    onOpenWallet?: () => void;
    /** Open the signed-in user's profile panel. */
    onOpenProfile?: () => void;
    /** Reveal the auto-hidden match status when the empty header area is tapped. */
    onRevealMatchStatus?: () => void;
}

export const HeaderNavPanel = ({
    finalAvatar,
    finalName,
    level,
    tier,
    coins,
    unreadCount,
    hasNotifications,
    onMessagesClick,
    onSettingsClick,
    onFeedClick: _onFeedClick,
    onOpenWallet,
    onOpenProfile,
    onRevealMatchStatus,
}: HeaderNavPanelProps) => {
    const chips = useTotalChips();
    const showChips = Boolean(chips.configured && chips.address);
    const balanceDisplay = showChips
        ? chips.walletReady || chips.totalChips > 0
            ? chips.totalFormatted
            : '—'
        : formatCompactChips(coins);
    const balanceTooltip = showChips
        ? [
              `Total CHIPS: ${chips.totalChips.toLocaleString()}`,
              `Wallet: ${chips.walletChips.toLocaleString()}`,
              `Vault: ${chips.vaultTotalChips.toLocaleString()}`,
              `Unclaimed: ${chips.unclaimedChips.toLocaleString()}`,
              ...(chips.escrowChips > 0 ? [`Escrow: ${chips.escrowChips.toLocaleString()}`] : []),
          ].join(' · ')
        : `Balance: ${coins.toLocaleString()}`;

    return (
        <header
            className="header dash-header ludo-header-scope px-2 sm:px-3 flex items-center justify-between py-2 sm:py-3 gap-1.5 sm:gap-2 sticky top-0 z-[300]"
            onClick={(event) => {
                if (event.target === event.currentTarget) onRevealMatchStatus?.();
            }}
        >
            {/* Zone 1: Left — Compact Total CHIPS Readout (Icon + Amount only) */}
            <button
                type="button"
                onClick={() => onOpenWallet?.()}
                title={balanceTooltip}
                aria-label={`${balanceTooltip} — Open wallet`}
                className="hud-header-cluster min-w-[68px] max-w-[116px] flex-none h-[40px] sm:h-[44px] px-2.5 flex items-center gap-1.5 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong hover:border-line-strong active:scale-[0.98] transition-[border-color,background-color,transform] cursor-pointer text-left"
            >
                <span className={`w-5 h-5 flex-shrink-0 ${showChips ? 'text-accent' : 'text-warn'}`}>
                    <ChipsHexIcon className="w-full h-full" active />
                </span>
                <span className="text-ludo-sm font-bold text-ink-strong font-mono tabular-nums truncate leading-none">
                    {balanceDisplay}
                </span>
            </button>

            {/* Zone 2: Center — Pilot Dossier Badge */}
            <button
                type="button"
                onClick={() => onOpenProfile?.()}
                title="Open profile"
                aria-label="Open profile"
                className="hud-header-cluster flex-1 min-w-0 max-w-[208px] h-[40px] sm:h-[44px] px-2 sm:px-2.5 flex items-center gap-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong hover:border-line-strong active:scale-[0.98] transition-[border-color,background-color,transform] cursor-pointer text-left"
            >
                <div className="relative flex-shrink-0">
                    <div className="hud-avatar-frame w-7 h-7 sm:w-8 sm:h-8 rounded-lg overflow-hidden border border-line-strong bg-surface-panel flex items-center justify-center">
                        {finalAvatar ? (
                            <img
                                src={finalAvatar}
                                alt={finalName}
                                className="w-full h-full object-cover"
                                width={96}
                                height={96}
                            />
                        ) : (
                            <PilotAvatarFallbackIcon className="w-4 h-4 text-accent" active />
                        )}
                    </div>
                    <span
                        className="hud-status-breath absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-positive border-2 border-surface-page rounded-full"
                        aria-hidden="true"
                    />
                </div>

                <div className="flex flex-col items-start min-w-0 flex-1 leading-none">
                    <span className="text-ludo-sm font-bold text-ink-strong uppercase tracking-tight truncate w-full">
                        {finalName}
                    </span>
                    <span className="flex items-center gap-1 mt-0.5 min-w-0 w-full">
                        <RankTierIcon tier={tier} size={11} className="shrink-0" />
                        <span className="text-ludo-xs font-mono font-bold text-accent uppercase tracking-wider truncate">
                            LV.{level} · {tier}
                        </span>
                    </span>
                </div>
            </button>

            {/* Zone 3: Right — Comms & System Tune Cluster */}
            <div className="hud-header-cluster flex-none h-[40px] sm:h-[44px] px-1 sm:px-1.5 flex items-center gap-0.5 rounded-xl bg-surface-recessed border border-line-soft text-ink-strong">
                <button
                    type="button"
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink-strong hover:bg-surface-hover active:scale-95 transition-[color,background-color,transform] relative cursor-pointer"
                    onClick={onMessagesClick}
                    title="Messages"
                    aria-label={unreadCount > 0 ? `Messages (${unreadCount} unread)` : 'Messages'}
                >
                    <ChatIcon className="w-5 h-5" active={unreadCount > 0} />
                    {hasNotifications && (
                        <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-warn border border-surface-page" />
                    )}
                    {unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-[16px] px-1 bg-accent text-accent-ink text-ludo-xs font-mono font-bold rounded-full border border-surface-page tabular-nums">
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </button>

                <div className="w-px h-5 bg-line-soft mx-0.5" aria-hidden="true" />

                <button
                    type="button"
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink-strong hover:bg-surface-hover active:scale-95 transition-[color,background-color,transform] cursor-pointer"
                    onClick={onSettingsClick}
                    title="Settings"
                    aria-label="Settings"
                >
                    <SlidersIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
            </div>
        </header>
    );
};
