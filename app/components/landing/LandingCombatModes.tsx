"use client";

import React, { useState } from 'react';
import { ArenaLaunchConfig } from '@/hooks/useDesktopLandingGate';

interface LandingCombatModesProps {
  onEnterArena: (config?: ArenaLaunchConfig) => void;
}

const MODES = [
  {
    id: '1v1',
    num: '01',
    name: '1v1 High-Stakes Duel',
    tag: 'PURE SKILL',
    desc: 'Diagonally opposite seating (BL ↔ TR or BR ↔ TL). Mathematical precision, rapid turn timers, and zero room for error. Winner takes the escrow pool.',
    features: ['Diagonally Opposite Seating', 'Fast 15s Turn Clock', 'Direct 1-on-1 Elimination'],
    config: { matchType: 2 as const, gameMode: 'classic' as const },
    badgeColor: 'border-accent text-accent',
  },
  {
    id: '2v2',
    num: '02',
    name: '2v2 Tactical Team-Up',
    tag: 'FLAGSHIP CO-OP',
    desc: 'Green+Blue vs Red+Yellow. Teammates sit diagonally opposite. Enjoy friendly-tile trap truce, collaborative captures, and joint team victory.',
    features: ['Teammates Diagonally Paired', 'Trap Truce Immunity', 'Shared Assist Victories'],
    config: { matchType: '2v2' as const, gameMode: 'classic' as const },
    badgeColor: 'border-positive text-positive',
    highlight: true,
  },
  {
    id: '4p',
    num: '03',
    name: '4P Free-For-All Chaos',
    tag: 'BATTLE ROYALE',
    desc: 'Total multiplayer mayhem. 4 players, 4 corners, totally randomized seating. Navigate a hostile battlefield where any opponent can capture your tokens.',
    features: ['4 Corners Fully Active', 'Randomized Seat Draw', 'High-Multiplier Pots'],
    config: { matchType: 4 as const, gameMode: 'classic' as const },
    badgeColor: 'border-warn text-warn',
  },
  {
    id: 'power',
    num: '04',
    name: 'Power Arena (Fog of War)',
    tag: 'TACTICAL TILES',
    desc: 'Unpredictable cyber warfare. Hidden power tiles on the perimeter ring: Warp Portals, Kinetic Shields, Freeze Traps, and Double Boosts.',
    features: ['Server-Masked Tile Types', 'Inventory Hand of 3 Cards', 'Dynamic Board Modifiers'],
    config: { gameMode: 'power' as const },
    badgeColor: 'border-accent text-accent',
  },
];

export default function LandingCombatModes({ onEnterArena }: LandingCombatModesProps) {
  const [selectedModeId, setSelectedModeId] = useState<string>('2v2');

  return (
    <section id="modes" className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      {/* Section Header */}
      <div className="flex flex-col gap-2 max-w-2xl mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-recessed border border-line-soft w-fit text-ludo-xs uppercase tracking-widest text-accent font-semibold">
          Arena Mechanics
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-ink-strong">
          Four Combat Modes. Zero Luck Defaults.
        </h2>
        <p className="text-sm sm:text-base text-ink-muted leading-relaxed">
          Engineered around deterministic mathematical rules, seat-aware turn cycles, and verified team pairings.
        </p>
      </div>

      {/* 4-Card Tactical Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {MODES.map((m) => {
          const isSelected = selectedModeId === m.id;
          return (
            <div
              key={m.id}
              onClick={() => setSelectedModeId(m.id)}
              className={`landing-card p-6 flex flex-col justify-between gap-6 cursor-pointer transition-all ${
                isSelected
                  ? 'border-accent shadow-[0_0_25px_rgba(0,229,255,0.2)] bg-surface-panel'
                  : 'hover:border-line-strong'
              }`}
            >
              <div className="flex flex-col gap-4">
                {/* Header Tag & Number */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-ludo-xs text-ink-faint">{m.num} //</span>
                  <span
                    className={`px-2 py-0.5 rounded text-ludo-xs font-mono font-semibold border ${m.badgeColor}`}
                  >
                    {m.tag}
                  </span>
                </div>

                {/* Title & Description */}
                <div>
                  <h3 className="text-lg font-bold uppercase tracking-wide text-ink-strong mb-2">
                    {m.name}
                  </h3>
                  <p className="text-ludo-xs text-ink-muted leading-relaxed">{m.desc}</p>
                </div>

                {/* Feature Bullet List */}
                <div className="flex flex-col gap-1.5 pt-2 border-t border-line-soft text-ludo-xs text-ink-faint">
                  {m.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-accent">•</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEnterArena(m.config);
                }}
                className={`w-full py-2.5 px-3 rounded-xl text-ludo-xs uppercase tracking-wider label-chrome font-black transition-all ${
                  isSelected
                    ? 'bg-accent text-surface-page hover:brightness-110 shadow-[0_0_15px_rgba(0,229,255,0.3)]'
                    : 'bg-surface-recessed text-ink-strong border border-line-soft hover:border-accent'
                }`}
              >
                PLAY THIS MODE →
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
