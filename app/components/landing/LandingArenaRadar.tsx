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

const MOCK_LEADERS: LeaderboardItem[] = [
  { username: 'Phoenix_3077', player_id: '0x3a4b...c89e', profit: 125000, wins: 48 },
  { username: 'Cipher_Alpha', player_id: '0x8f2d...41a2', profit: 98000, wins: 39 },
  { username: 'Vortex_Base', player_id: '0x1c9e...55b7', profit: 74500, wins: 31 },
  { username: 'Nexus_Tactical', player_id: '0x992a...12f4', profit: 62000, wins: 28 },
  { username: 'Aura_Green', player_id: '0x44fa...77c1', profit: 51200, wins: 24 },
];

export default function LandingArenaRadar({ onEnterArena }: LandingArenaRadarProps) {
  const [leaders, setLeaders] = useState<LeaderboardItem[]>(MOCK_LEADERS);

  useEffect(() => {
    fetch('/api/predictors/board')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setLeaders(data.slice(0, 5));
        }
      })
      .catch(() => {});
  }, []);

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
          Watch ongoing high-stakes matches in real-time or climb the onchain Grandmaster ladder.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Live Matches Directory Mockup */}
        <div className="lg:col-span-7 landing-card p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-line-soft pb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-positive animate-pulse" />
              <span className="text-sm font-bold uppercase tracking-wider text-ink-strong">
                Live Broadcast Rooms
              </span>
            </div>
            <span className="text-ludo-xs font-mono text-ink-faint">
              UPDATED EVERY 15s
            </span>
          </div>

          {/* Sample Active Live Matches */}
          <div className="flex flex-col gap-3">
            {[
              { id: 'ROOM-8492', mode: '2v2 Team-Up', pot: '20,000 CHIPS', spectators: 14, tick: 'Round 18' },
              { id: 'ROOM-3104', mode: '1v1 Duel', pot: '100,000 CHIPS', spectators: 32, tick: 'Final Stretch' },
              { id: 'ROOM-9921', mode: 'Power Arena', pot: '50,000 CHIPS', spectators: 9, tick: 'Round 8' },
            ].map((match) => (
              <div
                key={match.id}
                className="p-4 rounded-xl bg-surface-recessed border border-line-soft flex flex-wrap items-center justify-between gap-4 hover:border-line-strong transition-all"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-ink-strong">{match.id}</span>
                    <span className="px-2 py-0.5 rounded text-ludo-xs bg-surface-panel text-accent font-semibold border border-line-soft">
                      {match.mode}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-ludo-xs text-ink-muted">
                    <span>Pool: <strong className="text-positive">{match.pot}</strong></span>
                    <span>•</span>
                    <span>{match.spectators} Watching</span>
                    <span>•</span>
                    <span className="text-warn">{match.tick}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onEnterArena()}
                  className="px-3.5 py-1.5 rounded-lg text-ludo-xs uppercase tracking-wider font-bold bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all shadow-sm"
                >
                  SPECTATE →
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Grandmaster Leaderboard Snapshot */}
        <div className="lg:col-span-5 landing-card p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-line-soft pb-4">
            <span className="text-sm font-bold uppercase tracking-wider text-ink-strong">
              Grandmaster Standings
            </span>
            <span className="text-ludo-xs font-mono text-accent">SEASON 01</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {leaders.map((p, idx) => (
              <div
                key={idx}
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
                      {p.wins !== undefined ? `${p.wins} Wins` : 'Rank Tier S'}
                    </span>
                  </div>
                </div>

                <span className="font-mono font-bold text-positive">
                  +{typeof p.profit === 'number' ? p.profit.toLocaleString() : '50,000'} CHIPS
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onEnterArena()}
            className="w-full py-2.5 rounded-xl text-ludo-xs uppercase tracking-wider font-bold bg-surface-recessed border border-line-soft hover:border-accent text-ink-strong transition-all mt-1"
          >
            VIEW FULL LEADERBOARD →
          </button>
        </div>
      </div>
    </section>
  );
}
