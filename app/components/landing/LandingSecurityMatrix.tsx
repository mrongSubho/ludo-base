"use client";

import React, { useState } from 'react';

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

const SIMULATOR_PRESETS = [
  {
    id: 'sig',
    label: 'Session Auth (Zero Gas)',
    mode: 'Signature Mode',
    contract: 'Session v2 • SHA-256 Cookie/Token',
    sendDelta: '0 ETH • 0 CHIPS',
    receiveDelta: 'Authenticated Seat Token',
    revertCheck: 'PASS • Zero-gas EIP-191 / Passkey check',
  },
  {
    id: 'budget',
    label: 'Ranked Budget (100k)',
    mode: 'Transaction Mode',
    contract: 'MatchPool Escrow (Verified)',
    sendDelta: '100,000 CHIPS Cap',
    receiveDelta: 'Multi-match instant entry',
    revertCheck: 'PASS • Dry-run rpc simulation OK (~0.00001 ETH)',
  },
  {
    id: 'revoke',
    label: '1-Click Revoke (0 Cap)',
    mode: 'Transaction Mode',
    contract: 'CHIPS ERC-20 Allowance',
    sendDelta: '0 CHIPS Cap (Revoked)',
    receiveDelta: 'Allowance Reset to 0',
    revertCheck: 'SAFE • Spender permission cleared immediately',
  },
] as const;

export default function LandingSecurityMatrix() {
  const [activePresetId, setActivePresetId] = useState<'sig' | 'budget' | 'revoke'>('budget');
  const preset = SIMULATOR_PRESETS.find((p) => p.id === activePresetId) || SIMULATOR_PRESETS[1];

  return (
    <section id="security" className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      {/* Header */}
      <div id="fair-play" className="flex flex-col gap-2 max-w-2xl mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-recessed border border-line-soft w-fit text-ludo-xs uppercase tracking-widest text-accent font-semibold">
          Web3 Architecture & Trust
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-ink-strong">
          Audited Onchain Security. Pre-Flight Verified.
        </h2>
        <p className="text-sm sm:text-base text-ink-muted leading-relaxed">
          Built on Base Sepolia (<code className="font-mono text-accent">84532</code>) with universal wallet protection, verified smart contracts, and zero custodial risk.
        </p>
      </div>

      {/* 4 Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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

      {/* Interactive Pre-Flight Telemetry Preview (Dual-Modal Guard) */}
      <div className="landing-card p-6 sm:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="flex flex-col gap-3 max-w-md">
          <span className="text-ludo-xs font-mono uppercase tracking-widest text-accent font-bold">
            Interactive Pre-Flight Preview • SignWaitModal
          </span>
          <h3 className="text-lg font-extrabold uppercase tracking-wide text-ink-strong">
            Preview What Your Wallet Sees Before You Sign
          </h3>
          <p className="text-ludo-xs text-ink-muted leading-relaxed">
            Every EIP-1193 provider call passes through <code className="font-mono text-accent">lib/walletGuard.ts</code> and{' '}
            <code className="font-mono text-accent">lib/txSimulator.ts</code> before your extension or passkey opens.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {SIMULATOR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePresetId(p.id)}
                className={`px-3 py-1.5 rounded-lg text-ludo-xs font-mono border cursor-pointer transition-all ${
                  activePresetId === p.id
                    ? 'bg-accent text-surface-page border-accent font-bold'
                    : 'bg-surface-recessed text-ink-muted border-line-soft hover:border-line-strong'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-full lg:w-[460px] p-4 rounded-xl bg-surface-recessed border border-accent/30 font-mono text-ludo-xs flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-line-soft pb-2">
            <span className="text-accent font-bold uppercase">{preset.mode}</span>
            <span className="px-2 py-0.5 rounded bg-surface-panel text-positive border border-line-soft">
              {preset.contract}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-faint">YOU SEND / CAP:</span>
            <span className="text-warn font-semibold">{preset.sendDelta}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-faint">OUTCOME / GRANT:</span>
            <span className="text-ink-strong font-semibold">{preset.receiveDelta}</span>
          </div>
          <div className="pt-2 border-t border-line-soft text-positive font-semibold">
            {preset.revertCheck}
          </div>
        </div>
      </div>
    </section>
  );
}
