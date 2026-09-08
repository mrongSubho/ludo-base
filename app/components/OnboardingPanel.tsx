"use client";

import React, { useEffect, useRef } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { completeOnboarding } from '@/lib/onboarding';

// ─── OnboardingPanel ─────────────────────────────────────────────────────────
// First-run setup shown once per device before the lobby: pick a theme
// (+ token style). Compact + minimal by design. Selections apply live so the
// user sees the arena change. Fresh devices (no stored choice) start on
// Daybreak + Orbs; stored prefs are always respected.

export const OnboardingPanel = ({ onDone }: { onDone: () => void }) => {
    const { preferences, updatePreference } = usePreferences();
    const theme = preferences.theme === 'light' ? 'light' : 'retro';
    const tokenStyle = preferences.tokenStyle === 'orb' ? 'orb' : 'pawn';
    const defaulted = useRef(false);

    useEffect(() => {
        if (defaulted.current) return;
        defaulted.current = true;
        try {
            if (localStorage.getItem('ludo-theme') === null) {
                updatePreference('ludo-theme', 'light');
            }
            if (localStorage.getItem('token-style') === null) {
                updatePreference('token-style', 'orb');
            }
        } catch {
            /* storage unavailable — hook fallbacks stand */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const finish = () => {
        completeOnboarding();
        onDone();
    };

    const card = (active: boolean) => `onboard-pick${active ? ' onboard-pick-active' : ''}`;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-4 bg-black/70 backdrop-blur-md">
            <div
                className="ludo-onboard-scope w-full max-w-[360px] rounded-[26px] border border-white/10 px-5 pt-5 pb-4 flex flex-col gap-3.5 shadow-2xl"
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

                {/* Theme */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-black uppercase tracking-[0.25em] text-white/40 px-1">
                        Theme
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => updatePreference('ludo-theme', 'retro')} aria-pressed={theme === 'retro'} className={card(theme === 'retro')}>
                            <span
                                className="w-full h-9 rounded-lg border border-white/15"
                                style={{ background: 'linear-gradient(135deg, #0b0f19 0%, #12202e 55%, #0e3a45 100%)' }}
                                aria-hidden
                            />
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Retro</span>
                        </button>
                        <button onClick={() => updatePreference('ludo-theme', 'light')} aria-pressed={theme === 'light'} className={card(theme === 'light')}>
                            <span
                                className="w-full h-9 rounded-lg border border-black/10"
                                style={{ background: 'linear-gradient(135deg, #fdf6e3 0%, #fde68a 45%, #a5b4fc 100%)' }}
                                aria-hidden
                            />
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Daybreak</span>
                        </button>
                    </div>
                </div>

                {/* Token style */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-black uppercase tracking-[0.25em] text-white/40 px-1">
                        Tokens
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => updatePreference('token-style', 'pawn')} aria-pressed={tokenStyle === 'pawn'} className={card(tokenStyle === 'pawn')}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-white">
                                <path d="M12 2a3 3 0 0 0-3 3c0 1.2.7 2.2 1.7 2.7L10 9H8a2 2 0 0 0-2 2v1h12v-1a2 2 0 0 0-2-2h-2l-.7-1.3c1-.5 1.7-1.5 1.7-2.7a3 3 0 0 0-3-3z" />
                                <path d="M6 15h12l-1.5 6h-9L6 15z" />
                            </svg>
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Chess</span>
                        </button>
                        <button onClick={() => updatePreference('token-style', 'orb')} aria-pressed={tokenStyle === 'orb'} className={card(tokenStyle === 'orb')}>
                            <span className="w-6 h-6 rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #a5f3fc 0%, #0891b2 55%, #083344 100%)', boxShadow: '0 0 12px rgba(34,211,238,0.6)' }} aria-hidden />
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Orbs</span>
                        </button>
                    </div>
                </div>

                <button
                    onClick={finish}
                    className="mt-1 w-full py-3.5 rounded-2xl bg-white text-black text-sm font-black uppercase tracking-[0.2em] hover:bg-white/90 active:scale-[0.99] transition-all"
                >
                    Enter the lobby
                </button>
                <p className="text-center text-[9px] font-bold text-white/35 -mt-1.5">
                    Change anytime in Settings
                </p>
            </div>
        </div>
    );
};
