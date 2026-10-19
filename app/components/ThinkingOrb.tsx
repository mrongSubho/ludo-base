"use client";

/**
 * ThinkingOrb — the one place `thinking-orbs` is allowed to be used.
 *
 * Why a wrapper instead of importing the package directly:
 *
 * 1. THEME. The package's `theme="auto"` resolves an ancestor
 *    `data-theme` attribute or a `dark`/`light` class, then falls back to
 *    `prefers-color-scheme`. This app's theme is a `body` class
 *    (`theme-daybreak` / `theme-retro-futurism`, see `usePreferences`
 *    `applyBodyClasses`), so auto-detection finds nothing and silently falls
 *    through to the OS preference — a light-OS user on the default dark theme
 *    would get dark ink on a dark panel. The preference store is the only
 *    correct source, so it is pinned here.
 *
 * 2. MOTION. `lib/motion.ts` is the repo's single source of truth for
 *    `prefers-reduced-motion` (CSS_LAYOUT_ANIMATION_PLAN §5). The package
 *    checks the same media query internally, but the contract is that JS
 *    motion paths consult `lib/motion.ts`; passing `paused` from it keeps that
 *    true even if the package's internal detection changes. Note that
 *    `check:reduce-motion` cannot see canvas at all — it reads
 *    `document.getAnimations()` — so this wrapper IS the gate for this path.
 *
 * 3. A11Y. The orb is `role="img"` with a per-state `aria-label`. In the
 *    matchmaking panel a visible text label already names the state
 *    ("SCANNING LUDO ARENA"), so the default here is decorative
 *    (`aria-hidden`) to avoid announcing the same thing twice. Pass `label`
 *    only where the orb stands alone.
 */

import { useEffect, useState } from 'react';
import { ThinkingOrb as BaseThinkingOrb, type OrbSize, type OrbState } from 'thinking-orbs';
import { usePreferences } from '@/hooks/usePreferences';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

/**
 * Semantic ink tints, as theme pairs.
 *
 * A single hex cannot serve both themes: the package's ramp fades toward black
 * on dark substrates and toward white on light ones, so a mid-tone brand colour
 * nearly disappears on the dark panel. Measured on the matchmaking substrate at
 * 64px (`searching`), contrast against the panel:
 *
 *            retro   daybreak
 *   neutral   7.9     10.6
 *   accent    5.5      3.2
 *   warn      5.6      3.1
 *   success   ~5.5     ~3.4
 *
 * Tinting always costs contrast, so it is opt-in and never the default.
 */
const TONES: Record<'accent' | 'warn' | 'success', { retro: string; light: string }> = {
    accent: { retro: '#67e8f9', light: '#0e7490' },
    warn: { retro: '#fcd34d', light: '#b45309' },
    success: { retro: '#6ee7b7', light: '#047857' },
};

export type OrbTone = 'neutral' | 'accent' | 'warn' | 'success';

export interface ThinkingOrbProps {
    state: OrbState;
    /** Tuned presets only: 64 (avatar), 32 (compact), 20 (inline text). */
    size?: OrbSize;
    className?: string;
    /**
     * Which substrate the orb sits on.
     * - `app` (default) follows the active app theme — correct for every
     *   surface driven by the `--panel-bg` token family, including the
     *   matchmaking sheet (Daybreak overrides `--panel-bg` to
     *   `rgba(255,255,255,0.88)`, so that sheet is white in light mode).
     * - `dark` / `light` pin the ink, for surfaces that hardcode a background
     *   instead of reading the theme tokens. Verify with
     *   `getComputedStyle(document.body).getPropertyValue('--panel-bg')`
     *   before reaching for these — a wrong pin renders ink-on-ink and is
     *   invisible rather than merely ugly.
     */
    theme?: 'app' | 'dark' | 'light';
    /**
     * Semantic ink tint. Ignored at `size={20}` — at that scale the untinted
     * ink is the only variant that clears the non-text contrast floor
     * comfortably (10.6:1 vs ~3.2:1 tinted on Daybreak), and a 20px glyph is
     * exactly where a few points of contrast decide whether it reads at all.
     * Use tone on the 32/64 avatar-scale orbs.
     */
    tone?: OrbTone;
    /** Accessible name. Omit when a visible label already names the state. */
    label?: string;
}

export function ThinkingOrb({ state, size = 20, className, theme = 'app', tone = 'neutral', label }: ThinkingOrbProps) {
    const { preferences } = usePreferences();
    // Lazy init keeps the first client render honest; the server snapshot is
    // `false` (SSR has no window), and since the preference only affects the
    // canvas paint inside the effect, this cannot desync hydration.
    const [reduced, setReduced] = useState(prefersReducedMotion);

    useEffect(() => {
        setReduced(prefersReducedMotion());
        return onReducedMotionChange(setReduced);
    }, []);

    const resolvedTheme = theme === 'app' ? (preferences.theme === 'light' ? 'light' : 'dark') : theme;
    // Tint is opt-in and suppressed at the inline scale (see the `tone` doc).
    const tint = tone !== 'neutral' && size !== 20 ? TONES[tone][resolvedTheme === 'light' ? 'light' : 'retro'] : undefined;

    return (
        <BaseThinkingOrb
            state={state}
            size={size}
            theme={resolvedTheme}
            color={tint}
            paused={reduced}
            className={className}
            aria-hidden={label ? undefined : true}
            aria-label={label}
        />
    );
}
