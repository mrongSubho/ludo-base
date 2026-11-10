'use client';

import React, { useEffect, useState } from 'react';
import { useIsDesktop } from '@/hooks/useIsDesktop';

interface ActivityItem {
  id: string;
  actor_id?: string;
  type: string;
  actor?: { username?: string | null; wallet_address?: string } | null;
  metadata?: {
    winner?: string;
    wager?: number;
    game_mode?: string;
  };
  created_at: string;
}

interface LeaderboardItem {
  username?: string;
  player_id: string;
  profit?: number;
  wins?: number;
}

interface DesktopLobbyHubProps {
  children: React.ReactNode;
  onReturnToLanding?: () => void;
}

export default function DesktopLobbyHub({
  children,
  onReturnToLanding,
}: DesktopLobbyHubProps) {
  const isDesktop = useIsDesktop();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [leaders, setLeaders] = useState<LeaderboardItem[]>([]);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isDesktop) return;

    fetch('/api/presence/online?limit=50', { signal: AbortSignal.timeout(6000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.players)) {
          setOnlineCount(data.players.length);
        }
      })
      .catch(() => {});

    fetch('/api/activities', { signal: AbortSignal.timeout(6000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data)) {
          setActivities(data.slice(0, 4));
        }
      })
      .catch(() => {});

    fetch('/api/predictors/board', { signal: AbortSignal.timeout(6000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data)) {
          setLeaders(data.slice(0, 4));
        }
      })
      .catch(() => {});
  }, [isDesktop]);

  if (!isDesktop) {
    return <>{children}</>;
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col">
      {/* Top Desktop Breadcrumb */}
      <div className="hidden lg:flex items-center justify-between px-4 py-2 mb-2 rounded-xl border border-line-soft bg-surface-panel/60 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          {onReturnToLanding && (
            <button
              type="button"
              onClick={onReturnToLanding}
              className="text-ludo-xs uppercase tracking-wider text-ink-muted hover:text-accent flex items-center gap-1.5 font-mono transition-colors cursor-pointer"
            >
              <span>←</span>
              <span>Arena Overview</span>
            </button>
          )}
          <span className="text-ink-faint">|</span>
          <span className="text-ludo-xs font-mono font-bold text-accent">
            TACTICAL COMMAND HUB
          </span>
        </div>

        <div className="flex items-center gap-2 text-ludo-xs font-mono text-ink-muted">
          <span className="w-2 h-2 rounded-full bg-positive animate-pulse" />
          <span>{onlineCount !== null ? `${onlineCount} OPERATORS ONLINE` : 'PRESENCE SYNCED'}</span>
        </div>
      </div>

      {/* Main 2-Column Responsive Layout (Flex-1 chain preserved on mobile) */}
      <div className="desktop-lobby-hub flex-1 min-h-0 flex flex-col">
        {/* Left Column: GameLobby Component */}
        <div className="desktop-lobby-hub-left flex-1 min-h-0 flex flex-col">
          {children}
        </div>

        {/* Right Column: Tactical Radar & Intelligence Deck */}
        <div className="hidden lg:flex desktop-lobby-hub-right">
          {/* Live Arena Radar Feed */}
          <div className="p-4 rounded-2xl bg-surface-panel/90 backdrop-blur-md border border-line-soft flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-line-soft pb-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-positive animate-pulse" />
                <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-strong">
                  Arena Radar Feed
                </span>
              </div>
              <span className="text-ludo-xs font-mono text-ink-faint">BASE SEPOLIA</span>
            </div>

            <div className="flex flex-col gap-2">
              {activities.length === 0 ? (
                <div className="p-3 text-center text-ludo-xs text-ink-muted">
                  MatchRoom Durable Objects synced • Ready for matchmaking
                </div>
              ) : (
                activities.map((act) => (
                  <div
                    key={act.id}
                    className="p-2.5 rounded-xl bg-surface-recessed border border-line-soft flex items-center justify-between text-ludo-xs font-mono"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-accent font-bold">❖</span>
                      <span className="text-ink-strong truncate max-w-[180px]">
                        {act.actor?.username || (act.actor_id ? `${act.actor_id.slice(0, 8)}…` : 'Operator')}
                      </span>
                    </div>
                    <span className="text-ink-muted uppercase shrink-0">
                      {act.type.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Daily Sharp Standings Preview */}
          <div className="p-4 rounded-2xl bg-surface-panel/90 backdrop-blur-md border border-line-soft flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-line-soft pb-2.5">
              <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-strong">
                Daily Sharp Top 4
              </span>
              <span className="text-ludo-xs font-mono text-accent">TODAY (UTC)</span>
            </div>

            <div className="flex flex-col gap-2">
              {leaders.length === 0 ? (
                <div className="p-3 text-center text-ludo-xs text-ink-muted">
                  No settled spectator predictions yet today
                </div>
              ) : (
                leaders.map((ldr, idx) => (
                  <div
                    key={ldr.player_id}
                    className="p-2.5 rounded-xl bg-surface-recessed border border-line-soft flex items-center justify-between text-ludo-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-accent">#{idx + 1}</span>
                      <span className="font-bold text-ink-strong">
                        {ldr.username || ldr.player_id.slice(0, 10)}
                      </span>
                    </div>
                    <span className={`font-mono font-bold ${(ldr.profit ?? 0) >= 0 ? 'text-positive' : 'text-warn'}`}>
                      {(ldr.profit ?? 0) >= 0 ? '+' : ''}
                      {typeof ldr.profit === 'number' ? ldr.profit.toLocaleString() : '0'} PTS
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Tactical Advice Card */}
          <div className="p-4 rounded-2xl bg-surface-panel/90 backdrop-blur-md border border-line-soft flex flex-col gap-2">
            <div className="flex items-center gap-2 text-ludo-xs font-bold uppercase tracking-wider text-ink-strong">
              <span>💡</span>
              <span>2v2 Synergy Protocol</span>
            </div>
            <p className="text-ludo-xs text-ink-muted leading-relaxed">
              Green and Blue form Team Alpha; Red and Yellow form Team Omega. Landing on a teammate’s token creates a defensive cluster with full trap truce immunity.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
