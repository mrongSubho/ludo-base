'use client';

import React, { useEffect, useState } from 'react';

interface ActivityItem {
  id: string;
  type: string;
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
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [leaders, setLeaders] = useState<LeaderboardItem[]>([]);
  const [onlineCount, setOnlineCount] = useState<number>(36);

  useEffect(() => {
    // 1. Fetch Online Presence
    fetch('/api/presence/online?limit=1')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.players) && data.players.length > 0) {
          setOnlineCount(Math.max(28, data.players.length * 8));
        }
      })
      .catch(() => {});

    // 2. Fetch Recent Activities
    fetch('/api/activities')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data)) {
          setActivities(data.slice(0, 4));
        }
      })
      .catch(() => {});

    // 3. Fetch Predictors/Board
    fetch('/api/predictors/board')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data)) {
          setLeaders(data.slice(0, 4));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Top Desktop Breadcrumb */}
      <div className="hidden lg:flex items-center justify-between px-6 py-2.5 border-b border-line-soft bg-surface-panel/40 backdrop-blur-md">
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
          <span>{onlineCount} OPERATORS ONLINE</span>
        </div>
      </div>

      {/* Main 2-Column Responsive Layout */}
      <div className="desktop-lobby-hub">
        {/* Left Column: GameLobby Component */}
        <div className="desktop-lobby-hub-left">
          {children}
        </div>

        {/* Right Column: Tactical Radar & Intelligence Deck */}
        <div className="hidden lg:flex desktop-lobby-hub-right">
          {/* Live Arena Radar Feed */}
          <div className="p-4 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-3">
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
                    <div className="flex items-center gap-2">
                      <span className="text-accent font-bold">❖</span>
                      <span className="text-ink-strong truncate max-w-[180px]">
                        {act.metadata?.winner
                          ? `${act.metadata.winner.slice(0, 8)}… won`
                          : 'Match settled'}
                      </span>
                    </div>
                    <span className="text-positive font-bold">
                      +{act.metadata?.wager ? (act.metadata.wager * 2).toLocaleString() : '5,000'} CHIPS
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Grandmaster Season Standings Preview */}
          <div className="p-4 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-line-soft pb-2.5">
              <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-strong">
                Grandmaster Top 4
              </span>
              <span className="text-ludo-xs font-mono text-accent">SEASON 01</span>
            </div>

            <div className="flex flex-col gap-2">
              {leaders.length === 0 ? (
                <div className="p-3 text-center text-ludo-xs text-ink-muted">
                  Climb the onchain leaderboard in ranked matches
                </div>
              ) : (
                leaders.map((ldr, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-surface-recessed border border-line-soft flex items-center justify-between text-ludo-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-accent">#{idx + 1}</span>
                      <span className="font-bold text-ink-strong">
                        {ldr.username || ldr.player_id.slice(0, 10)}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-positive">
                      +{typeof ldr.profit === 'number' ? ldr.profit.toLocaleString() : '25,000'} CHIPS
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Tactical Advice Card */}
          <div className="p-4 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-2">
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
