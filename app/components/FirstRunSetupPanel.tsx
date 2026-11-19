"use client";

import React, { useEffect, useRef } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { completeOnboarding } from '@/lib/onboarding';
import { PanelTabs } from './PanelTabs';
import { Button } from './Button';
import { HudCornerTicks, HudSectionLabel } from './HudPrimitives';
import {
    Theme3077Icon,
    ThemeDaybreakIcon,
    ThemeRetroIcon,
    TokenChessIcon,
    TokenOrbIcon,
} from './icons';

// ─── FirstRunSetupPanel ──────────────────────────────────────────────────────
// First-run setup shown once per device before the lobby. Chrome matches
// Settings → Appearance (same card shell + PanelTabs segmented controls).
// Fresh devices default to 3077 (flagship cyber-tactical) + Orbs; stored prefs
// are always respected. Selections apply live so the user sees the arena change.

export const FirstRunSetupPanel = ({ onDone }: { onDone: () => void }) => {
    const { preferences, updatePreference } = usePreferences();
    const theme = preferences.theme === 'retro' ? 'retro' : preferences.theme === 'light' ? 'light' : '3077';
    const tokenStyle = preferences.tokenStyle === 'orb' ? 'orb' : 'pawn';
    const defaulted = useRef(false);

    useEffect(() => {
        if (defaulted.current) return;
        defaulted.current = true;
        try {
            // Fresh device → 3077 (flagship default). Stored choices win.
            if (localStorage.getItem('ludo-theme') === null) {
                updatePreference('ludo-theme', '3077');
            }
            if (localStorage.getItem('token-style') === null) {
                updatePreference('token-style', 'orb');
            }
        } catch {
            /* storage unavailable — hook fallbacks stand */
        }
    }, [updatePreference]);

    const finish = () => {
        completeOnboarding();
        onDone();
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-4 bg-black/70 backdrop-blur-md">
            <div
                className="ludo-onboard-scope panel-shell-3077 relative w-full max-w-[360px] rounded-[26px] border border-line-soft px-5 pt-5 pb-5 flex flex-col gap-4 shadow-2xl overflow-hidden"
                style={{
                    background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                    backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))',
                    backdropFilter: 'blur(32px)',
                }}
            >
                <HudCornerTicks />

                <div className="text-center flex flex-col gap-1 relative z-10">
                    <p className="text-ludo-xs font-mono font-bold uppercase tracking-[0.28em] text-accent">
                        {'// FIRST TIME SETUP'}
                    </p>
                    <h2 className="text-lg font-bold text-ink-strong uppercase tracking-tight">
                        Shape your arena
                    </h2>
                </div>

                {/* Appearance — same card shell + segmented controls as Settings */}
                <section className="relative z-10">
                    <HudSectionLabel className="mb-2">Appearance</HudSectionLabel>
                    <div className="onboard-appearance rounded-2xl border border-line-soft bg-surface-recessed overflow-hidden divide-y divide-line-soft">
                        <div className="onboard-appearance-row">
                            <div className="onboard-row-label">Theme</div>
                            <PanelTabs
                                cols={3}
                                value={theme}
                                onPick={(v) => updatePreference('ludo-theme', v)}
                                options={[
                                    { value: '3077', label: '3077', icon: <Theme3077Icon className="w-4 h-4" /> },
                                    { value: 'retro', label: 'Retro', icon: <ThemeRetroIcon className="w-4 h-4" /> },
                                    { value: 'light', label: 'Daybreak', icon: <ThemeDaybreakIcon className="w-4 h-4" /> },
                                ]}
                            />
                        </div>
                        <div className="onboard-appearance-row">
                            <div className="onboard-row-label">Token style</div>
                            <PanelTabs
                                cols={2}
                                value={tokenStyle}
                                onPick={(v) => updatePreference('token-style', v)}
                                options={[
                                    { value: 'pawn', label: 'Chess', icon: <TokenChessIcon className="w-4 h-4" /> },
                                    { value: 'orb', label: 'Orbs', icon: <TokenOrbIcon className="w-4 h-4" /> },
                                ]}
                            />
                        </div>
                    </div>
                </section>

                <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={finish}
                    className="onboard-cta relative z-10 min-h-[56px] rounded-2xl text-ludo-lg uppercase tracking-[0.22em] shadow-[0_0_28px_color-mix(in_srgb,var(--accent)_40%,transparent)]"
                >
                    Enter the lobby
                </Button>
                <p className="relative z-10 text-center text-ludo-xs font-bold text-ink-muted -mt-2">
                    Change anytime in Settings
                </p>
            </div>
        </div>
    );
};
