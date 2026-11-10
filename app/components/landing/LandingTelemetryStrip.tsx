"use client";

import React, { useEffect, useState } from 'react';

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

export default function LandingTelemetryStrip() {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [openQueueCount, setOpenQueueCount] = useState<number | null>(null);
  const [recentActivities, setRecentActivities] = useState<ActivityItem[]>([]);

  useEffect(() => {
    const fetchTelemetry = async () => {
      try {
        const [onlineRes, poolsRes, actRes] = await Promise.allSettled([
          fetch('/api/presence/online?limit=50', { signal: AbortSignal.timeout(6000) }),
          fetch('/api/matchmaking/pools?gameMode=classic&matchType=2v2', { signal: AbortSignal.timeout(6000) }),
          fetch('/api/activities', { signal: AbortSignal.timeout(6000) }),
        ]);

        if (onlineRes.status === 'fulfilled' && onlineRes.value.ok) {
          const data = await onlineRes.value.json();
          if (Array.isArray(data.players)) {
            setOnlineCount(data.players.length);
          }
        }

        if (poolsRes.status === 'fulfilled' && poolsRes.value.ok) {
          const data = await poolsRes.value.json();
          if (data?.pools && typeof data.pools === 'object') {
            const total = Object.values(data.pools as Record<string, number>).reduce(
              (sum, n) => sum + (Number(n) || 0),
              0,
            );
            setOpenQueueCount(total);
          }
        }

        if (actRes.status === 'fulfilled' && actRes.value.ok) {
          const list = await actRes.value.json();
          if (Array.isArray(list)) {
            setRecentActivities(list.slice(0, 5));
          }
        }
      } catch {
        // Keep safe initial display on offline error
      }
    };

    void fetchTelemetry();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchTelemetry();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const latest = recentActivities[0];
  const latestLabel = latest
    ? `${latest.actor?.username || (latest.actor_id ? `${latest.actor_id.slice(0, 6)}…` : 'Operator')} • ${latest.type.replace(/_/g, ' ')}`
    : 'Arena MatchRoom Durable Objects ready • Commit-reveal RNG synced';

  return (
    <div className="w-full bg-surface-panel/90 border-y border-line-soft py-3 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Core Arena Metrics */}
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 sm:gap-6 text-ludo-xs uppercase tracking-wider font-semibold">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-positive animate-pulse" />
            <span className="text-ink-strong">
              {onlineCount !== null ? `${onlineCount} PLAYERS ONLINE` : 'PRESENCE SYNCED'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-ink-muted">
            <span className="text-accent">❖</span>
            <span>
              {openQueueCount !== null ? `${openQueueCount} IN 2v2 QUEUE` : 'MATCHMAKING LIVE'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-ink-muted">
            <span className="text-positive">🛡️</span>
            <span>SERVER-AUTHORITATIVE STATE</span>
          </div>

          <div className="flex items-center gap-2 text-ink-muted">
            <span className="text-accent">⚡</span>
            <span>ZERO GAS COMMIT-REVEAL</span>
          </div>
        </div>

        {/* Live Ticker Feed */}
        <div className="hidden lg:flex items-center gap-2 text-ludo-xs font-mono text-ink-muted">
          <span className="px-2 py-0.5 rounded bg-surface-recessed text-accent border border-line-soft">
            FEED
          </span>
          <span className="truncate max-w-sm">
            {latestLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
