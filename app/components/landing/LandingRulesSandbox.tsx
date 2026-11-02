"use client";

import React, { useState } from 'react';
import { ArenaLaunchConfig } from '@/hooks/useDesktopLandingGate';

interface LandingRulesSandboxProps {
  onEnterArena: (config?: ArenaLaunchConfig) => void;
}

const RULES_TABS = [
  {
    id: 'synergy',
    title: '2v2 Teammate Synergy',
    subtitle: 'GB vs RY Tactical Co-op',
    code: 'TEAM_PAIRINGS',
    explanation:
      'Teammates are fixed by protocol: Green+Blue vs Red+Yellow. Teammates sit diagonally opposite. Landing on a teammate’s tile creates a collaborative block, never an accidental capture. If either teammate gets all tokens home, the entire team wins.',
    points: [
      'Trap Truce: Teammates never capture each other',
      'Diagonal Seating: Axis Green/Blue vs Red/Yellow',
      'Joint Victory: First team with 8 total home tokens takes pool',
    ],
    simulation: 'Green Token at Pos #14 + Blue Token at Pos #14 = TEAM SAFE CLUSTER',
  },
  {
    id: 'gate',
    title: 'Gate-Crossing Math',
    subtitle: 'Home Stretch (52–57)',
    code: 'calculateNextPosition()',
    explanation:
      'Entering the home stretch is strictly governed by corner geometry. Tokens cannot overshoot the finish cell. A token at position 55 needing 2 steps to hit 57 will bounce or fail if a 4 is rolled. Naive pos + roll math is banned by the engine.',
    points: [
      'Turn Index 51 turns into Home Lane 52',
      'Exact Roll Required to reach Home Base 57',
      'Overshoot protection prevents invalid moves',
    ],
    simulation: 'Token at 55 + Roll 4 = ILLEGAL (Overshoots 57) | Roll 2 = GOAL REACHED',
  },
  {
    id: 'threesixes',
    title: 'Three Consecutive Sixes',
    subtitle: 'Anti-Monopoly Penalty',
    code: 'THREE_SIXES_BURNDOWN',
    explanation:
      'Rolling a 6 grants a bonus turn. However, if a player rolls three 6s consecutively, the third roll is forfeited, all bonus turns are revoked immediately, and the turn cycle rotates to the next active seated player.',
    points: [
      'Roll 1: Six → Token exits yard or advances + Roll Again',
      'Roll 2: Six → Advance + Roll Again',
      'Roll 3: Six → FORFEIT! Turn passes immediately to opponent',
    ],
    simulation: 'Roll sequence: [6, 6, 6] → Turn Cancelled by MatchRoom Engine',
  },
  {
    id: 'captures',
    title: 'Safe Stars & Capture Bounties',
    subtitle: 'Combat Tile Dynamics',
    code: 'SAFE_POSITIONS',
    explanation:
      'The 8 Star tiles ([0, 8, 13, 21, 26, 34, 39, 47]) are non-combat safe sanctuaries where tokens cannot be captured. Anywhere else on the perimeter path, landing on an opponent token captures it back to their yard and grants +1 bonus turn.',
    points: [
      '8 Designated Star Tiles provide total sanctuary',
      'Capturing opponent returns token to yard',
      'Successful capture awards immediate bonus turn',
    ],
    simulation: 'Opponent at Pos #22 + Landed on #22 = CAPTURED to Yard + Bonus Roll',
  },
];

export default function LandingRulesSandbox({ onEnterArena }: LandingRulesSandboxProps) {
  const [activeTabId, setActiveTabId] = useState<string>('synergy');
  const activeTab = RULES_TABS.find((t) => t.id === activeTabId) || RULES_TABS[0];

  return (
    <section id="sandbox" className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      {/* Header */}
      <div className="flex flex-col gap-2 max-w-2xl mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-recessed border border-line-soft w-fit text-ludo-xs uppercase tracking-widest text-accent font-semibold">
          Engine Math & Rules
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-ink-strong">
          Competitive Integrity. Zero Compromise.
        </h2>
        <p className="text-sm sm:text-base text-ink-muted leading-relaxed">
          Every turn, move, and capture is verified by the MatchRoom engine math. Test-drive the core rules before entering the arena.
        </p>
      </div>

      {/* Interactive Tabs + Simulator Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column: Rules Navigation Tabs */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {RULES_TABS.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col gap-1 ${
                  isActive
                    ? 'border-accent bg-surface-panel shadow-[0_0_20px_rgba(0,229,255,0.15)]'
                    : 'border-line-soft bg-surface-recessed/60 hover:border-line-strong text-ink-muted'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-sm font-bold uppercase tracking-wider ${
                      isActive ? 'text-accent' : 'text-ink-strong'
                    }`}
                  >
                    {tab.title}
                  </span>
                  <span className="font-mono text-ludo-xs text-ink-faint">{tab.code}</span>
                </div>
                <span className="text-ludo-xs text-ink-muted">{tab.subtitle}</span>
              </button>
            );
          })}

          {/* Quick Bot Practice CTA */}
          <div className="p-4 rounded-xl border border-line-soft bg-surface-recessed flex items-center justify-between gap-4 mt-2">
            <div>
              <span className="text-ludo-xs uppercase font-bold text-ink-strong block">
                Want to test live?
              </span>
              <span className="text-ludo-xs text-ink-muted">Practice vs offline AI bots instantly.</span>
            </div>
            <button
              type="button"
              onClick={() => onEnterArena({ startBotMatch: true })}
              className="px-3 py-2 rounded-lg text-ludo-xs uppercase font-bold bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all shadow-sm"
            >
              TRY BOT →
            </button>
          </div>
        </div>

        {/* Right Column: Interactive Diagram & Simulation Card */}
        <div className="lg:col-span-7 landing-card p-6 sm:p-8 flex flex-col justify-between gap-6 shadow-xl relative overflow-hidden">
          <div className="flex flex-col gap-5">
            {/* Header & Protocol Pill */}
            <div className="flex items-center justify-between border-b border-line-soft pb-4">
              <span className="text-lg font-extrabold uppercase tracking-wide text-ink-strong">
                {activeTab.title}
              </span>
              <span className="px-2.5 py-1 rounded-md text-ludo-xs font-mono font-semibold bg-surface-recessed text-accent border border-line-soft">
                {activeTab.code}
              </span>
            </div>

            {/* Explanation Prose */}
            <p className="text-sm text-ink-muted leading-relaxed">
              {activeTab.explanation}
            </p>

            {/* Core Invariants */}
            <div className="flex flex-col gap-2 p-4 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs">
              <span className="font-bold uppercase tracking-wider text-ink-strong">
                Engine Invariants:
              </span>
              {activeTab.points.map((pt, i) => (
                <div key={i} className="flex items-center gap-2 text-ink-muted">
                  <span className="text-positive">✓</span>
                  <span>{pt}</span>
                </div>
              ))}
            </div>

            {/* Live Calculation Simulation Box */}
            <div className="p-4 rounded-xl border border-accent/30 bg-surface-recessed/80 font-mono text-ludo-xs flex flex-col gap-1.5">
              <span className="text-ink-faint uppercase">Simulation Verdict:</span>
              <span className="text-accent font-semibold">{activeTab.simulation}</span>
            </div>
          </div>

          {/* Action Row */}
          <div className="pt-4 border-t border-line-soft flex items-center justify-between">
            <span className="text-ludo-xs font-mono text-ink-faint">
              STATUS: RULE VERIFIED IN SCRIPTS/ENGINE.TEST.TS
            </span>
            <button
              type="button"
              onClick={() => onEnterArena()}
              className="text-ludo-xs uppercase font-bold text-accent hover:underline flex items-center gap-1"
            >
              <span>ENTER ARENA</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
