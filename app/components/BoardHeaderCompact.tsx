"use client";

import React from 'react';
import { ChatIcon, ChipsHexIcon, CloseReticleIcon, PilotAvatarFallbackIcon, SlidersIcon } from './icons';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';
import { ConnectionBadge } from './ConnectionBadge';
import RankTierIcon from './RankTierIcon';
import { useTotalChips } from '@/hooks/useTotalChips';
import { formatCompactChips } from '@/lib/chips';

// ─── BoardHeaderCompact ──────────────────────────────────────────────────────
// In-game header: ONE shell pill holding the main-header clusters
// (coins / profile / DM+settings) with the mode strip ("Power 2v2 10k")
// docked inside as its own inner pill. In-flow + sticky (never absolute)
// so it can never overlap board elements.

interface BoardHeaderCompactProps {
    finalAvatar: string | null;
    finalName: string;
    level: number;
    tier: string;
    coins: number;
    unreadCount: number;
    hasNotifications: boolean;
    onMessagesClick: () => void;
    onSettingsClick: () => void;
    modeLabel: string;
    spectators?: number;
    streamNode?: React.ReactNode;
    matchConnectionStatus?: MatchConnectionStatus;
    // Optional exit (spectating only): renders a leave button in the strip's
    // left slot. Match play exits via Settings → Leave Match instead.
    onExit?: () => void;
}

export const BoardHeaderCompact = ({
    finalAvatar,
    finalName,
    level,
    tier,
    coins,
    unreadCount,
    hasNotifications,
    onMessagesClick,
    onSettingsClick,
    modeLabel,
    spectators = 0,
    streamNode,
    onExit,
    matchConnectionStatus = 'offline',
}: BoardHeaderCompactProps) => {
    const chips = useTotalChips();
    const showChips = Boolean(chips.configured && chips.address);
    const balanceDisplay = showChips
        ? chips.walletReady || chips.totalChips > 0
            ? chips.totalFormatted
            : '—'
        : formatCompactChips(coins);

    return (
        <header className="board-compact-header ludo-header-scope px-0 pt-2 sticky top-0 z-[200]">
            {/* ── Single shell: clusters row + mode strip live inside ── */}
            <div className="board-header-shell relative overflow-hidden bg-transparent border border-line-strong rounded-[18px] shadow-[0_4px_25px_rgba(0,0,0,0.45)] px-1 pt-1 pb-1.5 flex flex-col gap-1">
                {/* Clusters row: same design language as the main header */}
                <div className="flex items-center justify-between gap-1">
                    {/* Cluster 1: Left - Coin Balance */}
                    <div
                        className="w-[86px] flex-none h-[34px] flex items-center justify-start"
                        title={
                            showChips
                                ? `Total CHIPS: ${chips.totalChips.toLocaleString()} (Wallet ${chips.walletChips.toLocaleString()} · Vault ${chips.vaultTotalChips.toLocaleString()} · Unclaimed ${chips.unclaimedChips.toLocaleString()})`
                                : coins.toLocaleString()
                        }
                    >
                        <div className="flex items-center gap-1.5 z-10 px-2.5 w-full justify-start">
                            <ChipsHexIcon className="w-4 h-4 flex-shrink-0 text-accent" active />
                            <span className="text-xs font-extrabold font-mono text-ink-strong tracking-tight tabular-nums truncate max-w-[56px]">
                                {balanceDisplay}
                            </span>
                        </div>
                    </div>

                    <div className="w-px h-6 bg-line-soft flex-none" />

                    {/* Cluster 2: Center - User Profile */}
                    <div className="flex-1 max-w-[158px] h-[34px] flex items-center justify-center">
                        <div className="flex items-center gap-1.5 w-full justify-center z-10 px-1">
                            <div className="relative flex-shrink-0">
                                <div className="hud-avatar-frame w-6 h-6 rounded-full overflow-hidden border border-accent/60 bg-surface-recessed shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_30%,transparent)]">
                                    {finalAvatar ? (
                                        <img src={finalAvatar} alt={finalName} className="w-full h-full object-cover" width={96} height={96} />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-accent">
                                            <PilotAvatarFallbackIcon className="w-3.5 h-3.5" />
                                        </div>
                                    )}
                                </div>
                                {/* Live Telemetry Dot */}
                                <span className="hud-status-breath absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-400 border border-[#05070A] rounded-full shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
                            </div>

                            <div className="flex flex-col items-start min-w-0 pr-1 max-w-[92px]">
                                <span className="text-ludo-xs font-extrabold text-ink-strong tracking-tight uppercase truncate w-full leading-tight">
                                    {finalName}
                                </span>
                                <span className="flex items-center gap-1 text-ludo-xs font-bold font-mono text-accent uppercase tracking-wider leading-none mt-0.5">
                                    <RankTierIcon tier={tier} className="w-2.5 h-2.5 shrink-0" />
                                    <span className="truncate">{tier}</span>
                                    <span className="text-ink-muted">·</span>
                                    <span className="tabular-nums text-ink-strong">LV{level}</span>
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="w-px h-6 bg-line-soft flex-none" />

                    {/* Cluster 3: Right - Actions (DM + Settings) */}
                    <div className="w-[86px] flex-none h-[34px] flex items-center justify-end">
                        <div className="flex items-center gap-0.5 z-10 w-full justify-end px-1.5">
                            <button
                                className={`hud-header-action-3077 w-7 h-7 flex items-center justify-center rounded-full text-ink-muted hover:text-ink-strong hover:bg-surface-hover transition-all relative ${unreadCount > 0 ? 'ping-glow' : ''}`}
                                onClick={onMessagesClick}
                                title="Messages"
                                aria-label="Messages"
                            >
                                <ChatIcon className="w-4 h-4" active={unreadCount > 0} />
                                {hasNotifications && (
                                    <span className="hud-status-breath absolute top-0 left-0 w-2 h-2 rounded-full bg-amber-400 border border-[#05070A] shadow-[0_0_10px_rgba(251,191,36,0.9)]" />
                                )}
                                {unreadCount > 0 && (
                                    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 bg-accent text-accent-ink text-ludo-xs font-extrabold rounded-full shadow-[0_0_10px_color-mix(in_srgb,var(--accent)_65%,transparent)]">
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </span>
                                )}
                            </button>

                            <div className="w-px h-4 bg-line-strong mx-0.5"></div>

                            <button
                                className="hud-header-action-3077 w-7 h-7 flex items-center justify-center rounded-full text-ink-muted hover:text-ink-strong hover:bg-surface-hover transition-all"
                                onClick={onSettingsClick}
                                title="Settings"
                                aria-label="Settings"
                            >
                                <SlidersIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Mode strip: pure status pill, one line, 7px, theme-proof ── */}
                <div className="mode-strip-pill mx-0.5 flex items-center justify-between rounded-full border border-line-soft bg-surface-recessed pl-1.5 pr-1.5 py-[5px]">
                    {onExit ? (
                        <button
                            onClick={onExit}
                            title="Leave stream"
                            aria-label="Leave stream"
                            className="panel-close-3077 w-6 h-6 flex-none flex items-center justify-center rounded-full border border-line-soft bg-surface-hover text-ink-muted hover:text-ink-strong transition-all active:scale-90"
                        >
                            <CloseReticleIcon className="w-3 h-3" />
                        </button>
                    ) : (
                        <span className="w-6 flex-none" />
                    )}

                    <span className="mode-strip-text text-ludo-xs font-extrabold font-mono uppercase tracking-[0.26em] text-accent whitespace-nowrap overflow-hidden text-ellipsis px-2">
                        {modeLabel}
                    </span>

                    <div className="flex-none min-w-[24px] flex items-center justify-end gap-1.5">
                        <ConnectionBadge status={matchConnectionStatus} compact />
                        {spectators > 0 && (
                            <span
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-ludo-xs font-extrabold bg-pink-500/15 text-pink-300 border border-pink-500/30 whitespace-nowrap"
                                title="Spectators watching this match"
                            >
                                <span className="hud-status-breath w-1.5 h-1.5 rounded-full bg-pink-400" />
                                {spectators}
                            </span>
                        )}
                        {streamNode}
                    </div>
                </div>
            </div>
        </header>
    );
};
