"use client";

import React, { useEffect, useState } from 'react';
import { ArenaLaunchConfig } from '@/hooks/useDesktopLandingGate';

interface LandingArenaRadarProps {
  onEnterArena: (config?: ArenaLaunchConfig) => void;
}

interface LeaderboardItem {
  username?: string;
  player_id: string;
  profit?: number;
  wins?: number;
}

interface PublicActivity {
  id: string;
  actor_id?: string;
  type: string;
  actor?: { username?: string | null; wallet_address?: string } | null;
  metadata?: {
    roomCode?: string;
    wager?: number;
    winner?: string;
    game_mode?: string;
  };
  created_at: string;
}

export default function LandingArenaRadar({ onEnterArena }: LandingArenaRadarProps) {
  const [leaders, setLeaders] = useState<LeaderboardItem[]>([]);
  const [activities, setActivities] = useState<PublicActivity[]>([]);
  const [spectateCode, setSpectateCode] = useState('');

  useEffect(() => {
    fetch('/api/predictors/board', { signal: AbortSignal.timeout(6000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data)) {
          setLeaders(data.slice(0, 5));
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
  }, []);

  const handleSpectateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = spectateCode.trim().toUpperCase();
    if (!clean) return;
    onEnterArena({ spectateRoomCode: clean });
  };

  return (
    <section id="leaderboard" className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      {/* Header */}
      <div className="flex flex-col gap-2 max-w-2xl mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-recessed border border-line-soft w-fit text-ludo-xs uppercase tracking-widest text-accent font-semibold">
          High Rollers & Live Spectating
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-ink-strong">
          Arena Radar & Leaderboard
        </h2>
        <p className="text-sm sm:text-base text-ink-muted leading-relaxed">
          Tune into the 24/7 Power 4P Broadcast Arena, spectate a room code live, or track today&apos;s top onchain predictors.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Live Arena Broadcast & Public Feed */}
        <div className="lg:col-span-7 landing-card p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-line-soft pb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-positive animate-pulse" />
              <span className="text-sm font-bold uppercase tracking-wider text-ink-strong">
                Live Broadcast & Room Watch
              </span>
            </div>
            <span className="text-ludo-xs font-mono text-ink-faint">
              REALTIME STREAM
            </span>
          </div>

          {/* 24/7 Flagship Live Arena Card */}
          <div className="p-4 rounded-xl bg-surface-recessed border border-accent/40 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-ink-strong">ARENA-POWER-4P</span>
                <span className="px-2 py-0.5 rounded text-ludo-xs bg-surface-panel text-accent font-semibold border border-line-soft">
                  Power 4P AI • 24/7
                </span>
              </div>
              <div className="flex items-center gap-3 text-ludo-xs text-ink-muted">
                <span>Spectator Predictions Active</span>
                <span>•</span>
                <span className="text-positive font-semibold">LIVE NOW</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onEnterArena({ spectateRoomCode: 'ARENA-POWER-4P' })}
              className="px-3.5 py-1.5 rounded-lg text-ludo-xs uppercase tracking-wider font-bold bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all shadow-sm cursor-pointer"
            >
              WATCH LIVE →
            </button>
          </div>

          {/* Direct Room Code Spectator Input */}
          <form
            onSubmit={handleSpectateRoom}
            className="flex items-center gap-2 p-1.5 rounded-xl bg-surface-recessed border border-line-soft"
          >
            <input
              type="text"
              value={spectateCode}
              onChange={(e) => setSpectateCode(e.target.value)}
              placeholder="SPECTATE ROOM CODE (E.G. ABCD)"
              maxLength={12}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="flex-1 bg-transparent px-3 py-1.5 text-ludo-xs text-ink-strong placeholder:text-ink-faint font-mono uppercase focus:outline-none"
            />
            <button
              type="submit"
              disabled={!spectateCode.trim()}
              className="px-3 py-1.5 rounded-lg text-ludo-xs uppercase font-bold bg-surface-panel text-accent border border-line-soft hover:border-accent disabled:opacity-40 cursor-pointer"
            >
              SPECTATE →
            </button>
          </form>

          {/* Recent Verified Arena Activity */}
          <div className="flex flex-col gap-2 pt-2 border-t border-line-soft">
            <span className="text-ludo-xs font-mono uppercase text-ink-faint">
              Recent Onchain & Arena Activity
            </span>
            {activities.length === 0 ? (
              <div className="p-3 rounded-xl bg-surface-recessed/50 border border-line-soft text-ludo-xs text-ink-muted font-mono">
                No recent public match events recorded yet. Enter the arena to claim the board.
              </div>
            ) : (
              activities.map((act) => (
                <div
                  key={act.id}
                  className="p-3 rounded-xl bg-surface-recessed border border-line-soft flex items-center justify-between gap-3 text-ludo-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-accent font-mono">❖</span>
                    <span className="font-bold text-ink-strong truncate">
                      {act.actor?.username || (act.actor_id ? `${act.actor_id.slice(0, 8)}…` : 'Player')}
                    </span>
                    <span className="text-ink-muted uppercase font-mono truncate">
                      {act.type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <span className="font-mono text-ink-faint shrink-0">
                    {new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Grandmaster Predictor Standings Snapshot */}
        <div className="lg:col-span-5 landing-card p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-line-soft pb-4">
            <span className="text-sm font-bold uppercase tracking-wider text-ink-strong">
              Daily Sharp Standings
            </span>
            <span className="text-ludo-xs font-mono text-accent">TODAY (UTC)</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {leaders.length === 0 ? (
              <div className="p-4 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs text-ink-muted text-center">
                No settled spectator predictions yet today — watch live to take #1.
              </div>
            ) : (
              leaders.map((p, idx) => (
                <div
                  key={p.player_id}
                  className="flex items-center justify-between p-3 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-6 h-6 rounded-md flex items-center justify-center font-bold font-mono ${
                        idx === 0
                          ? 'bg-amber-400 text-surface-page'
                          : idx === 1
                            ? 'bg-slate-300 text-surface-page'
                            : idx === 2
                              ? 'bg-amber-700 text-surface-page'
                              : 'bg-surface-panel text-ink-muted'
                      }`}
                    >
                      #{idx + 1}
                    </span>
                    <div className="flex flex-col">
                      <span className="font-bold text-ink-strong">
                        {p.username || p.player_id.slice(0, 10)}
                      </span>
                      <span className="font-mono text-ink-faint">
                        {p.wins !== undefined ? `${p.wins} Wins` : 'Ranked Predictor'}
                      </span>
                    </div>
                  </div>

                  <span className={`font-mono font-bold ${(p.profit ?? 0) >= 0 ? 'text-positive' : 'text-warn'}`}>
                    {(p.profit ?? 0) >= 0 ? '+' : ''}
                    {typeof p.profit === 'number' ? p.profit.toLocaleString() : '0'} PTS
                  </span>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => onEnterArena()}
            className="w-full py-2.5 rounded-xl text-ludo-xs uppercase tracking-wider font-bold bg-surface-recessed border border-line-soft hover:border-accent text-ink-strong transition-all mt-1 cursor-pointer"
          >
            VIEW FULL LEADERBOARD →
          </button>
        </div>
      </div>
    </section>
  );
}
