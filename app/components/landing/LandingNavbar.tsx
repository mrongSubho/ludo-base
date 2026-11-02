"use client";

import React from 'react';
import { usePreferences } from '@/hooks/usePreferences';

interface LandingNavbarProps {
  onEnterArena: () => void;
  onOpenQrModal: () => void;
}

export default function LandingNavbar({ onEnterArena, onOpenQrModal }: LandingNavbarProps) {
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

  const cycleTokenStyle = () => {
    const nextStyle = preferences.tokenStyle === 'orb' ? 'chess' : 'orb';
    updatePreference('token-style', nextStyle);
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-surface-panel/85 backdrop-blur-xl border-b border-line-soft">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand & Telemetry Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-recessed border border-accent/40 flex items-center justify-center text-accent shadow-[0_0_12px_rgba(0,229,255,0.25)]">
              <span className="text-base font-bold">❖</span>
            </div>
            <span className="text-lg font-extrabold uppercase tracking-widest text-ink-strong">
              Ludo <span className="text-accent">3077</span>
            </span>
          </div>

          {/* Network Telemetry Pill */}
          <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-recessed border border-line-soft text-ludo-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-positive animate-pulse" />
            <span className="font-mono text-ink-muted">BASE SEPOLIA 84532</span>
            <span className="text-ink-faint">|</span>
            <span className="text-accent font-mono font-medium">14ms</span>
          </div>
        </div>

        {/* Navigation Anchors */}
        <nav className="hidden lg:flex items-center gap-6 text-ludo-sm uppercase tracking-wider text-ink-muted">
          <a href="#modes" className="hover:text-accent transition-colors">
            Combat Modes
          </a>
          <a href="#sandbox" className="hover:text-accent transition-colors">
            3D Sandbox
          </a>
          <a href="#fair-play" className="hover:text-accent transition-colors">
            Provably Fair
          </a>
          <a href="#security" className="hover:text-accent transition-colors">
            Wallet Guard
          </a>
          <a href="#leaderboard" className="hover:text-accent transition-colors">
            Radar
          </a>
        </nav>

        {/* Controls & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Theme Quick Switcher */}
          <button
            type="button"
            onClick={cycleTheme}
            className="px-2.5 py-1.5 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs uppercase tracking-wider text-ink-muted hover:text-ink-strong transition-all"
            title="Cycle Theme (3077 / Retro / Daybreak)"
          >
            <span>Theme: </span>
            <span className="text-accent font-semibold">{preferences.theme}</span>
          </button>

          {/* Token Style Switcher */}
          <button
            type="button"
            onClick={cycleTokenStyle}
            className="hidden sm:inline-flex px-2.5 py-1.5 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs uppercase tracking-wider text-ink-muted hover:text-ink-strong transition-all"
            title="Switch Token Visuals (Orb / Chess)"
          >
            <span>Tokens: </span>
            <span className="text-accent font-semibold">{preferences.tokenStyle}</span>
          </button>

          {/* Mobile QR Modal Trigger */}
          <button
            type="button"
            onClick={onOpenQrModal}
            className="p-2 rounded-xl bg-surface-recessed border border-line-soft text-ink-muted hover:text-accent transition-all"
            title="Mobile QR Code"
            aria-label="Open mobile QR code"
          >
            📱
          </button>

          {/* Primary Arena Entry CTA */}
          <button
            type="button"
            onClick={onEnterArena}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-ludo-sm uppercase tracking-widest label-chrome font-black bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(0,229,255,0.4)]"
          >
            <span>⚡ ENTER ARENA</span>
            <span>→</span>
          </button>
        </div>
      </div>
    </header>
  );
}
