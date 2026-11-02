"use client";

import React from 'react';

const SECURITY_PILLARS = [
  {
    icon: '⚡',
    title: 'MatchRoom Durable Objects',
    subtitle: 'Server Authority & CSPRNG Dice',
    desc: 'Single authoritative execution context for state, clock, and non-tamperable dice rolls. Mutates state atomically through Postgres RPCs.',
    badge: 'ZERO CLIENT TRUST',
  },
  {
    icon: '🛡️',
    title: 'Dual-Modal Wallet Guard',
    subtitle: 'Pre-Flight Telemetry & Simulation',
    desc: 'Every onchain transaction undergoes a dry-run RPC simulation before your wallet prompts. Inspect exact gas, asset deltas, and contract signatures.',
    badge: 'NO BLIND SIGNING',
  },
  {
    icon: '🔑',
    title: 'CDP Passkey Smart Accounts',
    subtitle: 'Frictionless In-Game Wallets',
    desc: 'Play instantly with device biometrics or passkeys. Enjoy zero-gas session signatures without annoying wallet popups on every dice roll.',
    badge: 'ZERO-GAS SESSIONS',
  },
  {
    icon: '💳',
    title: 'Token Allowance Hub',
    subtitle: 'Budget Control & 1-Click Revoke',
    desc: 'Never give blanket unlimited access. Choose sensible allowance presets (10k, 100k, 1M) or revoke any token permission in a single click.',
    badge: '1-CLICK REVOKE',
  },
];

export default function LandingSecurityMatrix() {
  return (
    <section id="security" className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      {/* Header */}
      <div className="flex flex-col gap-2 max-w-2xl mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-recessed border border-line-soft w-fit text-ludo-xs uppercase tracking-widest text-accent font-semibold">
          Web3 Architecture & Trust
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-ink-strong">
          Audited Onchain Security. Pre-Flight Verified.
        </h2>
        <p className="text-sm sm:text-base text-ink-muted leading-relaxed">
          Built on Base Sepolia (`84532`) with universal wallet protection, verified smart contracts, and zero custodial risk.
        </p>
      </div>

      {/* 4 Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {SECURITY_PILLARS.map((pillar, i) => (
          <div
            key={i}
            className="landing-card p-6 flex flex-col justify-between gap-6 hover:border-line-strong transition-all"
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-2xl">{pillar.icon}</span>
                <span className="px-2 py-0.5 rounded text-ludo-xs font-mono font-semibold bg-surface-recessed text-accent border border-line-soft">
                  {pillar.badge}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold uppercase tracking-wide text-ink-strong mb-1">
                  {pillar.title}
                </h3>
                <span className="text-ludo-xs text-accent font-semibold block mb-2">
                  {pillar.subtitle}
                </span>
                <p className="text-ludo-xs text-ink-muted leading-relaxed">{pillar.desc}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-line-soft flex items-center justify-between text-ludo-xs font-mono text-ink-faint">
              <span>STATUS:</span>
              <span className="text-positive">VERIFIED IN CI</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
