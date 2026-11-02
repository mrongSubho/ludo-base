"use client";

import React, { useState } from 'react';
import LandingNavbar from './LandingNavbar';
import LandingHero from './LandingHero';
import LandingTelemetryStrip from './LandingTelemetryStrip';
import LandingCombatModes from './LandingCombatModes';
import LandingRulesSandbox from './LandingRulesSandbox';
import LandingSecurityMatrix from './LandingSecurityMatrix';
import LandingArenaRadar from './LandingArenaRadar';
import LandingFooter from './LandingFooter';
import LandingQrModal from './LandingQrModal';
import { ArenaLaunchConfig } from '@/hooks/useDesktopLandingGate';

interface DesktopLandingPageProps {
  onEnterArena: (config?: ArenaLaunchConfig) => void;
  theme?: string;
  tokenStyle?: 'orb' | 'chess';
}

export default function DesktopLandingPage({
  onEnterArena,
  theme = '3077',
  tokenStyle = 'orb',
}: DesktopLandingPageProps) {
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  return (
    <div className="ludo-landing-viewport">
      {/* Sticky Tactical Header */}
      <LandingNavbar
        onEnterArena={() => onEnterArena()}
        onOpenQrModal={() => setIsQrModalOpen(true)}
      />

      {/* Main Sections */}
      <main className="relative flex flex-col">
        {/* Hero Section */}
        <LandingHero
          onEnterArena={onEnterArena}
          onOpenQrModal={() => setIsQrModalOpen(true)}
          tokenStyle={tokenStyle}
          theme={theme}
        />

        {/* Live Telemetry Ribbon */}
        <LandingTelemetryStrip />

        {/* 4 Combat Modes */}
        <LandingCombatModes onEnterArena={onEnterArena} />

        {/* Interactive Engine Rules Sandbox */}
        <LandingRulesSandbox onEnterArena={onEnterArena} />

        {/* Audited Security & Wallet Guard */}
        <LandingSecurityMatrix />

        {/* Arena Radar & Standings */}
        <LandingArenaRadar onEnterArena={onEnterArena} />
      </main>

      {/* Footer */}
      <LandingFooter />

      {/* Mobile QR Modal */}
      <LandingQrModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
      />
    </div>
  );
}
