"use client";

import React, { useEffect, useRef } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { completeOnboarding } from '@/lib/onboarding';
import { PanelTabs } from './PanelTabs';

// ─── OnboardingPanel ─────────────────────────────────────────────────────────
// First-run setup shown once per device before the lobby. Chrome matches
// Settings → Appearance (same card shell + PanelTabs segmented controls).
// Fresh devices default to Retro + Orbs; stored prefs are always respected.
// Selections apply live so the user sees the arena change.

const BoltIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
);

const SunIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
);

const PawnIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <circle cx="12" cy="7" r="3" />
        <path d="M12 10v7M8.5 21h7M9.5 17h5" />
    </svg>
);

const OrbIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

export const OnboardingPanel = ({ onDone }: { onDone: () => void }) => {
    const { preferences, updatePreference } = usePreferences();
    const theme = preferences.theme === 'light' ? 'light' : 'retro';
    const tokenStyle = preferences.tokenStyle === 'orb' ? 'orb' : 'pawn';
    const defaulted = useRef(false);

    useEffect(() => {
        if (defaulted.current) return;
        defaulted.current = true;
        try {
            // Fresh device → Retro (product default). Stored choices win.
            if (localStorage.getItem('ludo-theme') === null) {
                updatePreference('ludo-theme', 'retro');
            }
            if (localStorage.getItem('token-style') === null) {
                updatePreference('token-style', 'orb');
            }
        } catch {
            /* storage unavailable — hook fallbacks stand */
        }
         
    }, []);

    const finish = () => {
        completeOnboarding();
        onDone();
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-4 bg-black/70 backdrop-blur-md">
            <div
                className="ludo-onboard-scope w-full max-w-[360px] rounded-[26px] border border-white/10 px-5 pt-5 pb-5 flex flex-col gap-4 shadow-2xl"
                style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))', backdropFilter: 'blur(32px)' }}
            >
                <div className="text-center flex flex-col gap-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-cyan-300">
                        First time setup
                    </p>
                    <h2 className="text-lg font-black text-white uppercase tracking-tight">
                        Shape your arena
                    </h2>
                </div>

                {/* Appearance — same card shell + segmented controls as Settings */}
                <section>
                    <div className="flex items-center gap-2.5 mb-2">
                        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
                            Appearance
                        </span>
                        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
                    </div>
                    <div className="onboard-appearance rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                        <div className="onboard-appearance-row">
                            <div className="onboard-row-label">Theme</div>
                            <PanelTabs
                                value={theme}
                                onPick={(v) => updatePreference('ludo-theme', v)}
                                options={[
                                    { value: 'retro', label: 'Retro', icon: BoltIcon },
                                    { value: 'light', label: 'Daybreak', icon: SunIcon },
                                ]}
                            />
                        </div>
                        <div className="onboard-appearance-row">
                            <div className="onboard-row-label">Token style</div>
                            <PanelTabs
                                value={tokenStyle}
                                onPick={(v) => updatePreference('token-style', v)}
                                options={[
                                    { value: 'pawn', label: 'Chess', icon: PawnIcon },
                                    { value: 'orb', label: 'Orbs', icon: OrbIcon },
                                ]}
                            />
                        </div>
                    </div>
                </section>

                <button
                    onClick={finish}
                    className="onboard-cta w-full min-h-[56px] py-4 rounded-2xl bg-cyan-400 text-black text-[15px] sm:text-base font-black uppercase tracking-[0.22em] shadow-[0_0_28px_rgba(34,211,238,0.4)] hover:bg-cyan-300 active:scale-[0.98] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                    Enter the lobby
                </button>
                <p className="text-center text-[9px] font-bold text-white/35 -mt-2">
                    Change anytime in Settings
                </p>
            </div>
        </div>
    );
};
