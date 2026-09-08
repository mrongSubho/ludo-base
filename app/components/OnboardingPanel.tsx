"use client";

import React from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { completeOnboarding } from '@/lib/onboarding';

// ─── OnboardingPanel ─────────────────────────────────────────────────────────
// First-run setup shown once per device before the lobby: pick a theme
// (+ token style). Selections apply live so the user sees the arena change.

export const OnboardingPanel = ({ onDone }: { onDone: () => void }) => {
    const { preferences, updatePreference } = usePreferences();
    const theme = preferences.theme === 'light' ? 'light' : 'retro';
    const tokenStyle = preferences.tokenStyle === 'orb' ? 'orb' : 'pawn';

    const finish = () => {
        completeOnboarding();
        onDone();
    };

    const card = (active: boolean) =>
        `flex-1 rounded-2xl border p-3 flex flex-col items-center gap-2 transition-all active:scale-[0.98] ${
            active
                ? 'border-cyan-300/80 bg-cyan-400/10 shadow-[0_0_18px_rgba(34,211,238,0.25)]'
                : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
        }`;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-4 bg-black/70 backdrop-blur-md">
            <div
                className="ludo-onboard-scope w-full max-w-[420px] rounded-[32px] border border-white/10 px-6 py-7 flex flex-col gap-5 shadow-2xl"
                style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))', backdropFilter: 'blur(32px)' }}
            >
                <div className="text-center flex flex-col gap-1.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">
                        First time setup
                    </p>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight">
                        Shape your arena
                    </h2>
                    <p className="text-[11px] font-bold text-white/50">
                        Pick a look. You can change everything later in Settings.
                    </p>
                </div>

                {/* Theme */}
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40 px-1">
                        Theme
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => updatePreference('ludo-theme', 'retro')} aria-pressed={theme === 'retro'} className={card(theme === 'retro')}>
                            <span
                                className="w-full h-12 rounded-xl border border-white/15"
                                style={{ background: 'linear-gradient(135deg, #0b0f19 0%, #12202e 55%, #0e3a45 100%)' }}
                                aria-hidden
                            />
                            <span className="text-[11px] font-black text-white uppercase tracking-widest">Retro</span>
                            <span className="text-[9px] font-bold text-white/40">Neon dark</span>
                        </button>
                        <button onClick={() => updatePreference('ludo-theme', 'light')} aria-pressed={theme === 'light'} className={card(theme === 'light')}>
                            <span
                                className="w-full h-12 rounded-xl border border-black/10"
                                style={{ background: 'linear-gradient(135deg, #fdf6e3 0%, #fde68a 45%, #a5b4fc 100%)' }}
                                aria-hidden
                            />
                            <span className="text-[11px] font-black text-white uppercase tracking-widest">Daybreak</span>
                            <span className="text-[9px] font-bold text-white/40">Soft light</span>
                        </button>
                    </div>
                </div>

                {/* Token style */}
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40 px-1">
                        Tokens
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => updatePreference('token-style', 'pawn')} aria-pressed={tokenStyle === 'pawn'} className={card(tokenStyle === 'pawn')}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-white">
                                <path d="M12 2a3 3 0 0 0-3 3c0 1.2.7 2.2 1.7 2.7L10 9H8a2 2 0 0 0-2 2v1h12v-1a2 2 0 0 0-2-2h-2l-.7-1.3c1-.5 1.7-1.5 1.7-2.7a3 3 0 0 0-3-3z" />
                                <path d="M6 15h12l-1.5 6h-9L6 15z" />
                            </svg>
                            <span className="text-[11px] font-black text-white uppercase tracking-widest">Chess</span>
                            <span className="text-[9px] font-bold text-white/40">Ranked pieces</span>
                        </button>
                        <button onClick={() => updatePreference('token-style', 'orb')} aria-pressed={tokenStyle === 'orb'} className={card(tokenStyle === 'orb')}>
                            <span className="w-7 h-7 rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #a5f3fc 0%, #0891b2 55%, #083344 100%)', boxShadow: '0 0 12px rgba(34,211,238,0.6)' }} aria-hidden />
                            <span className="text-[11px] font-black text-white uppercase tracking-widest">Orbs</span>
                            <span className="text-[9px] font-bold text-white/40">Glass discs</span>
                        </button>
                    </div>
                </div>

                <button
                    onClick={finish}
                    className="w-full py-4 rounded-2xl bg-white text-black text-sm font-black uppercase tracking-[0.2em] hover:bg-white/90 active:scale-[0.99] transition-all"
                >
                    Enter the lobby
                </button>
            </div>
        </div>
    );
};
