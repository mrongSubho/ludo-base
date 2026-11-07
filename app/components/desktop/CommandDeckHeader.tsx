'use client';

import React from 'react';
import { usePreferences } from '@/hooks/usePreferences';

interface CommandDeckHeaderProps {
  roomCode?: string | null;
  matchId?: string | null;
  gameMode?: string;
  playerCount?: string | number;
  wager?: number;
  spectators?: number;
  matchConnectionStatus?: string;
  onExitMatch?: () => void;
  onReturnToLanding?: () => void;
  onOpenSettings?: () => void;
  streamNode?: React.ReactNode;
}

export default function CommandDeckHeader({
  roomCode,
  matchId: _matchId,
  gameMode = 'classic',
  playerCount = '4P',
  wager = 0,
  spectators = 0,
  matchConnectionStatus: _matchConnectionStatus,
  onExitMatch,
  onReturnToLanding,
  onOpenSettings,
  streamNode,
}: CommandDeckHeaderProps) {
  const { preferences, updatePreference } = usePreferences();

  const cycleTheme = () => {
    const nextTheme =
      preferences.theme === '3077'
        ? 'retro'
        : preferences.theme === 'retro'
          ? 'light'
          : '3077';
    updatePreference('ludo-theme', nextTheme);
  };

  const modeBadge =
    playerCount === '2v2'
      ? '2v2 TEAM-UP'
      : playerCount === '1v1' || playerCount === 2
        ? '1v1 DUEL'
        : gameMode === 'power'
          ? 'POWER ARENA'
          : '4P FFA';

  return (
    <header className="command-deck-header">
      {/* Left: Overview Breadcrumb & Brand */}
      <div className="flex items-center gap-4">
        {onReturnToLanding && (
          <button
            type="button"
            onClick={onReturnToLanding}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-recessed border border-line-soft text-ludo-xs uppercase tracking-wider text-ink-muted hover:text-accent hover:border-accent transition-colors font-mono cursor-pointer"
            title="Return to Arena Landing Overview"
          >
            <span>←</span>
            <span>OVERVIEW</span>
          </button>
        )}

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-surface-recessed border border-accent/40 flex items-center justify-center text-accent text-sm font-bold shadow-[0_0_10px_rgba(0,229,255,0.2)]">
            ❖
          </div>
          <span className="text-base font-extrabold uppercase tracking-widest text-ink-strong">
            LUDO <span className="text-accent">3077</span>
          </span>
        </div>

        {/* Room & Mode Badges */}
        <div className="flex items-center gap-2 pl-2 border-l border-line-soft">
          <span className="px-2.5 py-0.5 rounded-md bg-surface-recessed border border-accent/30 text-ludo-xs font-mono font-bold text-accent">
            {roomCode ? `#${roomCode}` : 'LOCAL ARENA'}
          </span>
          <span className="px-2 py-0.5 rounded-md bg-surface-recessed border border-line-soft text-ludo-xs font-mono font-semibold text-ink-strong">
            {modeBadge}
          </span>
        </div>
      </div>

      {/* Center: Live Match Telemetry Ribbon */}
      <div className="hidden xl:flex items-center gap-5 text-ludo-xs font-mono">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-recessed border border-line-soft">
          <span className="text-ink-muted uppercase">ESCROW POOL:</span>
          <span className="font-bold text-positive">
            {wager > 0 ? `${(wager * 2).toLocaleString()} CHIPS` : 'FREE PLAY'}
          </span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-recessed border border-line-soft text-ink-muted">
          <span className="w-2 h-2 rounded-full bg-positive animate-pulse" />
          <span>BASE SEPOLIA 84532</span>
          <span className="text-ink-faint">|</span>
          <span className="text-accent font-semibold">14ms</span>
        </div>

        {spectators > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-recessed border border-line-soft text-ink-muted">
            <span>👁️</span>
            <span>{spectators} SPECTATING</span>
          </div>
        )}
      </div>

      {/* Right: Controls & Exit CTA */}
      <div className="flex items-center gap-3">
        {streamNode}

        {/* Theme Quick Toggle */}
        <button
          type="button"
          onClick={cycleTheme}
          className="px-2.5 py-1 rounded-lg bg-surface-recessed border border-line-soft text-ludo-xs uppercase tracking-wider text-ink-muted hover:text-ink-strong transition-all"
          title="Cycle Theme"
        >
          <span>THEME: </span>
          <span className="text-accent font-semibold">{preferences.theme}</span>
        </button>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg bg-surface-recessed border border-line-soft text-ink-muted hover:text-accent transition-all"
            title="Settings"
            aria-label="Settings"
          >
            ⚙️
          </button>
        )}

        {onExitMatch && (
          <button
            type="button"
            onClick={onExitMatch}
            className="px-3 py-1 rounded-lg text-ludo-xs uppercase tracking-wider font-bold bg-surface-recessed border border-line-soft hover:border-warn text-warn hover:bg-warn/10 transition-all cursor-pointer"
          >
            LEAVE MATCH
          </button>
        )}
      </div>
    </header>
  );
}
