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
    /** Accessible name. Omit when a visible label already names the state. */
    label?: string;
}

export function ThinkingOrb({ state, size = 20, className, theme = 'app', label }: ThinkingOrbProps) {
    const { preferences } = usePreferences();
    // Lazy init keeps the first client render honest; the server snapshot is
    // `false` (SSR has no window), and since the preference only affects the
    // canvas paint inside the effect, this cannot desync hydration.
    const [reduced, setReduced] = useState(prefersReducedMotion);

    useEffect(() => {
        setReduced(prefersReducedMotion());
        return onReducedMotionChange(setReduced);
    }, []);

    return (
        <BaseThinkingOrb
            state={state}
            size={size}
            theme={theme === 'app' ? (preferences.theme === 'light' ? 'light' : 'dark') : theme}
            paused={reduced}
            className={className}
            aria-hidden={label ? undefined : true}
            aria-label={label}
        />
    );
}
