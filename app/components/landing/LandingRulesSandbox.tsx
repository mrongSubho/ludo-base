"use client";

import React, { useMemo, useState } from 'react';
import { ArenaLaunchConfig } from '@/hooks/useDesktopLandingGate';
import { assignCornersForShape } from '@/lib/boardLayout';
import { TEAM_PAIRINGS, MAX_CONSECUTIVE_SIXES } from '@/lib/constants';
import {
  calculateNextPosition,
  handleThreeSixes,
  getStarIndices,
  getTeammateColor,
  getTeam,
} from '@/lib/engine/core';

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
  },
  {
    id: 'gate',
    title: 'Gate-Crossing Math',
    subtitle: 'Home Stretch (52–57)',
    code: 'calculateNextPosition()',
    explanation:
      'Entering the home stretch is strictly governed by corner geometry. Tokens cannot overshoot the finish cell. A token at position 55 needing 2 steps to hit 57 will stay put if a 4 is rolled. Naive pos + roll math is banned by the engine.',
    points: [
      'Gate exit transitions smoothly into Home Lane 52–57',
      'Exact Roll Required to reach Home Base 57',
      'Overshoot protection refuses invalid moves automatically',
    ],
  },
  {
    id: 'threesixes',
    title: 'Three Consecutive Sixes',
    subtitle: 'Anti-Monopoly Penalty',
    code: 'handleThreeSixes()',
    explanation:
      'Rolling a 6 grants a bonus turn. However, if a player rolls three 6s consecutively, the third roll is forfeited, all bonus turns are revoked immediately, and the turn cycle rotates to the next active seated player.',
    points: [
      'Roll 1: Six → Token exits yard or advances + Roll Again',
      'Roll 2: Six → Advance + Roll Again',
      'Roll 3: Six → FORFEIT! Turn passes immediately to opponent',
    ],
  },
  {
    id: 'captures',
    title: 'Safe Stars & Capture Bounties',
    subtitle: 'Combat Tile Dynamics',
    code: 'getStarIndices()',
    explanation:
      'The 8 Star tiles on the 52-cell perimeter are non-combat sanctuaries where tokens cannot be captured. Anywhere else on the shared path, matching or greater team force captures opponent tokens back to their yard and grants +1 bonus roll.',
    points: [
      '8 Designated Star Tiles provide total sanctuary',
      'Capturing opponent returns token to yard (-1)',
      'Successful capture awards immediate bonus turn',
    ],
  },
] as const;

export default function LandingRulesSandbox({ onEnterArena }: LandingRulesSandboxProps) {
  const [activeTabId, setActiveTabId] = useState<string>('synergy');
  const cc = useMemo(() => assignCornersForShape('2v2'), []);

  // Tab 1 state: Team pairing lookup
  const [synergyColor, setSynergyColor] = useState<'green' | 'blue' | 'red' | 'yellow'>('green');
  const teammate = getTeammateColor(synergyColor, '2v2') ?? TEAM_PAIRINGS[synergyColor];
  const teamNum = getTeam(synergyColor, '2v2');

  // Tab 2 state: Gate-crossing live engine calculation
  const [gatePos, setGatePos] = useState<number>(54);
  const [gateRoll, setGateRoll] = useState<number>(4);
  const gateNext = useMemo(
    () => calculateNextPosition(gatePos, gateRoll, 'green', cc),
    [gatePos, gateRoll, cc],
  );
  const gateOutcome =
    gateNext === gatePos
      ? `BLOCKED OVERSHOOT (stays at #${gatePos} — needs ${57 - gatePos} to finish)`
      : gateNext === 57
        ? `GOAL REACHED! #${gatePos} + ${gateRoll} → HOME BASE #57`
        : `MOVED! #${gatePos} + ${gateRoll} → HOME STRETCH #${gateNext}`;

  // Tab 3 state: Three-sixes stepper using handleThreeSixes()
  const [sixCount, setSixCount] = useState<number>(0);
  const sixStep = useMemo(() => handleThreeSixes(sixCount, 6), [sixCount]);

  // Tab 4 state: Safe star indices computed live from getStarIndices()
  const greenStars = useMemo(() => getStarIndices('green', cc), [cc]);
  const [probeTile, setProbeTile] = useState<number>(greenStars[1] ?? 8);
  const isProbeStar = greenStars.includes(probeTile);

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
          Every turn, move, and capture is verified by the MatchRoom engine math. Test-drive live calls to{' '}
          <code className="font-mono text-accent">lib/engine/core.ts</code> before entering the arena.
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
                className={`w-full text-left p-4 rounded-xl border transition-all flex flex-col gap-1 cursor-pointer ${
                  isActive
                    ? 'border-accent bg-surface-panel shadow-[0_0_20px_rgba(0,229,255,0.15)]'
                    : 'border-line-soft bg-surface-recessed/60 hover:border-line-strong text-ink-muted'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
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
              className="px-3 py-2 rounded-lg text-ludo-xs uppercase font-bold bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all shadow-sm cursor-pointer"
            >
              TRY BOT →
            </button>
          </div>
        </div>

        {/* Right Column: Interactive Engine Stepper */}
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

            {/* Interactive Controls per Tab (Real Engine Math) */}
            <div className="p-4 rounded-xl border border-accent/30 bg-surface-recessed/80 font-mono text-ludo-xs flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-ink-faint uppercase">Live Engine Evaluator:</span>
                <span className="text-positive font-semibold">LIVE CORE.TS</span>
              </div>

              {activeTabId === 'synergy' && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-muted">ACTING SEAT:</span>
                    {(['green', 'blue', 'red', 'yellow'] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setSynergyColor(c)}
                        className={`px-2.5 py-1 rounded-md uppercase border cursor-pointer transition-all ${
                          synergyColor === c
                            ? 'bg-accent text-surface-page border-accent font-bold'
                            : 'bg-surface-panel text-ink-muted border-line-soft hover:border-line-strong'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="text-accent font-semibold">
                    TEAM {teamNum} ({synergyColor.toUpperCase()} + {teammate.toUpperCase()}) • CORNER AXIS: {cc[synergyColor]} ↔ {cc[teammate]} • TRAP TRUCE: IMMUNE
                  </div>
                </>
              )}

              {activeTabId === 'gate' && (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-ink-muted">POS:</span>
                      {[52, 53, 54, 55, 56].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setGatePos(p)}
                          className={`px-2 py-1 rounded-md border cursor-pointer ${
                            gatePos === p
                              ? 'bg-accent text-surface-page border-accent font-bold'
                              : 'bg-surface-panel text-ink-muted border-line-soft'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-ink-muted">ROLL:</span>
                      {[1, 2, 3, 4, 5, 6].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setGateRoll(r)}
                          className={`px-2 py-1 rounded-md border cursor-pointer ${
                            gateRoll === r
                              ? 'bg-accent text-surface-page border-accent font-bold'
                              : 'bg-surface-panel text-ink-muted border-line-soft'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={gateNext === gatePos ? 'text-warn font-semibold' : 'text-positive font-semibold'}>
                    calculateNextPosition({gatePos}, {gateRoll}, &apos;green&apos;) → {gateOutcome}
                  </div>
                </>
              )}

              {activeTabId === 'threesixes' && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSixCount((prev) => (prev >= MAX_CONSECUTIVE_SIXES - 1 ? 0 : prev + 1))}
                      className="px-3 py-1.5 rounded-lg bg-accent text-surface-page font-bold uppercase cursor-pointer hover:brightness-110"
                    >
                      🎲 Roll 6 ({sixCount}/{MAX_CONSECUTIVE_SIXES})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSixCount(0)}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-panel text-ink-muted border border-line-soft uppercase cursor-pointer"
                    >
                      Reset Streak
                    </button>
                  </div>
                  <div className={sixStep.isThreeSixes ? 'text-warn font-semibold' : 'text-accent font-semibold'}>
                    {sixStep.isThreeSixes
                      ? 'isThreeSixes=true → 3rd Six! Move FORFEITED & streak reset to 0.'
                      : `handleThreeSixes(${sixCount}, 6) → nextSixes=${sixStep.nextSixes}, bonusTurn=ACTIVE`}
                  </div>
                </>
              )}

              {activeTabId === 'captures' && (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-ink-muted">PROBE CELL:</span>
                    {[greenStars[0], greenStars[1], greenStars[1] + 2, greenStars[2], greenStars[3] + 1].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setProbeTile(idx)}
                        className={`px-2 py-1 rounded-md border cursor-pointer ${
                          probeTile === idx
                            ? 'bg-accent text-surface-page border-accent font-bold'
                            : 'bg-surface-panel text-ink-muted border-line-soft'
                        }`}
                      >
                        #{idx}
                      </button>
                    ))}
                  </div>
                  <div className={isProbeStar ? 'text-positive font-semibold' : 'text-warn font-semibold'}>
                    Tile #{probeTile} → {isProbeStar ? 'STAR SANCTUARY (0 captures possible)' : 'COMBAT TILE (Enemy captured to yard -1 + Bonus Roll)'}
                  </div>
                </>
              )}
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
              className="text-ludo-xs uppercase font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
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
