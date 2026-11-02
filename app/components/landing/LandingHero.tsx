"use client";

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { ArenaLaunchConfig } from '@/hooks/useDesktopLandingGate';

// Lazy-load Three.js 3D board to safeguard critical path bundle budget
const LandingHero3D = dynamic(() => import('./LandingHero3D'), {
  ssr: false,
  loading: () => (
    <div className="landing-canvas-host w-full h-full min-h-[460px] flex flex-col items-center justify-center gap-3 bg-surface-recessed border border-line-soft">
      <div className="w-10 h-10 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
      <span className="text-ludo-xs uppercase tracking-widest text-ink-muted">
        Initializing 3D Tactical Arena…
      </span>
    </div>
  ),
});

interface LandingHeroProps {
  onEnterArena: (config?: ArenaLaunchConfig) => void;
  onOpenQrModal: () => void;
  tokenStyle?: 'orb' | 'chess';
  theme?: string;
}

export default function LandingHero({
  onEnterArena,
  onOpenQrModal,
  tokenStyle = 'orb',
  theme = '3077',
}: LandingHeroProps) {
  const [roomCode, setRoomCode] = useState('');

  const handleQuickJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanCode) return;
    onEnterArena({ joinRoomCode: cleanCode });
  };

  return (
    <section className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
      {/* Left Column: Value Proposition & Launch Cluster */}
      <div className="lg:col-span-6 flex flex-col gap-6">
        {/* Tactical Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-recessed border border-line-soft w-fit text-ludo-xs uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-ink-strong font-semibold">ONCHAIN TACTICAL ARENA</span>
          <span className="text-ink-faint">|</span>
          <span className="text-accent font-mono font-medium">SEASON 01</span>
        </div>

        {/* Display Headline */}
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold uppercase tracking-tight text-ink-strong leading-[1.08]">
            The Onchain Arena for <span className="text-accent drop-shadow-[0_0_24px_rgba(0,229,255,0.4)]">High-Stakes</span> Ludo.
          </h1>
          <p className="text-sm sm:text-base text-ink-muted max-w-xl leading-relaxed mt-1">
            Futuristic tactical warfare on Base. Server-authoritative commit-reveal dice, 2v2 diagonal team-up co-op, and non-custodial smart contract escrow pools.
          </p>
        </div>

        {/* Action Button Cluster */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => onEnterArena()}
            className="px-6 py-3.5 rounded-xl text-ludo-sm uppercase tracking-widest label-chrome font-black bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all shadow-[0_0_30px_rgba(0,229,255,0.45)]"
          >
            ⚡ PLAY IN BROWSER
          </button>

          <button
            type="button"
            onClick={onOpenQrModal}
            className="flex items-center gap-2 px-5 py-3.5 rounded-xl text-ludo-sm uppercase tracking-wider font-bold bg-surface-recessed border border-line-soft hover:border-line-strong text-ink-strong transition-all"
          >
            <span>📱</span>
            <span>MOBILE / FARCASTER</span>
          </button>
        </div>

        {/* Quick Join Room Code Input Form */}
        <form
          onSubmit={handleQuickJoin}
          className="flex items-center gap-2 p-1.5 rounded-2xl bg-surface-panel border border-line-soft max-w-md mt-2 shadow-lg"
        >
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="ENTER ROOM CODE (E.G. X7K9)"
            maxLength={8}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="flex-1 bg-transparent px-3 py-2 text-ludo-sm text-ink-strong placeholder:text-ink-faint font-mono uppercase focus:outline-none"
          />
          <button
            type="submit"
            disabled={!roomCode.trim()}
            className="px-4 py-2 rounded-xl text-ludo-xs uppercase tracking-wider font-bold bg-surface-recessed hover:bg-surface-hover text-accent border border-line-soft transition-all disabled:opacity-40"
          >
            JOIN ROOM →
          </button>
        </form>

        {/* Quick Feature Proof List */}
        <div className="grid grid-cols-3 gap-3 pt-2 text-ludo-xs text-ink-muted border-t border-line-soft">
          <div className="flex items-center gap-1.5">
            <span className="text-positive">✓</span>
            <span>Zero-Gas Passkeys</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-positive">✓</span>
            <span>Durable Object RNG</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-positive">✓</span>
            <span>2v2 Team-Up Co-op</span>
          </div>
        </div>
      </div>

      {/* Right Column: Three.js Interactive 3D Cyber Board Host */}
      <div className="lg:col-span-6 w-full h-[460px] sm:h-[520px] rounded-2xl border border-line-soft bg-surface-panel/40 backdrop-blur-md p-2 shadow-2xl relative">
        <LandingHero3D
          theme={theme}
          tokenStyle={tokenStyle}
          onDiceRollResult={() => {}}
        />
      </div>
    </section>
  );
}
