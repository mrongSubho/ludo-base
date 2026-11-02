"use client";

import React from 'react';

const CONTRACT_CHIPS = '0x323565f126B4c0628E101036A49567E1e03F543C';
const CONTRACT_MATCH_POOL = '0x81507f3C289b4f6D2140aF66E7C487a55F603099';

export default function LandingFooter() {
  return (
    <footer className="w-full bg-surface-panel border-t border-line-soft mt-16 sm:mt-24 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border-b border-line-soft pb-8">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-accent">❖</span>
              <span className="text-lg font-extrabold uppercase tracking-widest text-ink-strong">
                LUDO 3077
              </span>
            </div>
            <p className="text-ludo-xs text-ink-muted">
              The onchain arena for high-stakes tactical Ludo on Base.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-ludo-xs uppercase tracking-wider text-ink-muted">
            <a href="/terms" className="hover:text-accent transition-colors">
              Terms of Service
            </a>
            <a href="/privacy" className="hover:text-accent transition-colors">
              Privacy Policy
            </a>
            <a href="/burn" className="hover:text-accent transition-colors">
              Burn Dashboard
            </a>
            <a
              href="https://sepolia.basescan.org"
              target="_blank"
              rel="noreferrer"
              className="hover:text-accent transition-colors flex items-center gap-1"
            >
              <span>BaseScan</span>
              <span>↗</span>
            </a>
          </div>
        </div>

        {/* Verified Contracts & System Status */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-ludo-xs text-ink-faint">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 font-mono">
            <span>CHIPS ERC-20: {CONTRACT_CHIPS.slice(0, 10)}…{CONTRACT_CHIPS.slice(-6)}</span>
            <span className="hidden sm:inline">•</span>
            <span>MatchPool Escrow: {CONTRACT_MATCH_POOL.slice(0, 10)}…{CONTRACT_MATCH_POOL.slice(-6)}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-positive" />
            <span className="font-semibold text-ink-muted">ALL SYSTEMS OPERATIONAL</span>
          </div>
        </div>

        <div className="text-center md:text-left text-ludo-xs text-ink-faint pt-4">
          © 2026 Ludo 3077. Powered by Base, Wagmi & Cloudflare MatchRoom.
        </div>
      </div>
    </footer>
  );
}
