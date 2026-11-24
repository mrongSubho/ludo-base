/**
 * Motion preference — the JS-side contract for `prefers-reduced-motion`.
 *
 * The CSS kill-switch in `app/globals.css` (four `@media (prefers-reduced-motion:
 * reduce)` blocks) only covers CSS-driven animation. JS motion — framer-motion
 * components, the GSAP token timelines in `board/TokenPiece.tsx` /
 * `board/TokenVisual.tsx`, and `canvas-confetti` on wins — never saw the OS
 * setting, so a reduced-motion user still got full translation, squash and
 * particle motion. This module is the single source of truth those paths check,
 * and `<MotionConfig reducedMotion="user">` (app/Providers.tsx) covers the
 * framer surface from the same query.
 *
 * Rule (CSS_LAYOUT_ANIMATION_PLAN.md §5): reduced motion removes *translation*,
 * never *information*. Board positions are engine state (`GameState`) rendered
 * from `lib/boardLayout` coordinates, so a reduced-motion move becomes an
 * instant repositioning — the same fact, delivered without motion.
 *
 * Motion scale tokens (--ludo-motion-*) live in app/globals.css; the census and
 * the compositor-only rule are enforced by `scripts/check-motion.mjs` in CI.
 */

import { getPreferenceCookie } from '@/lib/preferencesUtils';

/** The one media query every motion path must respect. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export type MotionMode = 'system' | 'full' | 'reduced';
export type OsPlatform = 'macos' | 'windows' | 'ios' | 'android' | 'other';

export const OS_REDUCED_MOTION_HINTS: Record<
    Exclude<OsPlatform, 'other'>,
    { label: string; steps: string }
> = {
    macos: {
        label: 'macOS',
        steps: 'System Settings → Accessibility → Display → Reduce motion',
    },
    windows: {
        label: 'Windows',
        steps: 'Settings → Accessibility → Visual effects → Animation effects',
    },
    ios: {
        label: 'iOS / iPadOS',
        steps: 'Settings → Accessibility → Motion → Reduce Motion',
    },
    android: {
        label: 'Android',
        steps: 'Settings → Accessibility → Color and motion → Remove animations',
    },
};

/** Read the raw OS-level `prefers-reduced-motion: reduce` state. */
export function osPrefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Read the user's in-app motion override (`system` | `full` | `reduced`). */
export function getMotionMode(): MotionMode {
    if (typeof window === 'undefined') return 'system';
    try {
        const raw = getPreferenceCookie('ludo-motion') || window.localStorage?.getItem('ludo-motion');
        if (raw === 'full' || raw === 'reduced') return raw;
    } catch {
        /* ignore storage errors */
    }
    return 'system';
}

/** Best-effort client OS detection for showing relevant Accessibility steps. */
export function detectOsPlatform(): OsPlatform {
    if (typeof navigator === 'undefined') return 'other';
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
    if (/Windows/i.test(ua)) return 'windows';
    return 'other';
}

/**
 * Current effective reduced-motion state. Honors the in-app `ludo-motion`
 * override (`full` / `reduced`) when set, otherwise falls back to the OS
 * `prefers-reduced-motion: reduce` setting. SSR-safe (returns false on server).
 */
export function prefersReducedMotion(): boolean {
    const mode = getMotionMode();
    if (mode === 'full') return false;
    if (mode === 'reduced') return true;
    return osPrefersReducedMotion();
}

/**
 * Subscribe to effective reduced-motion changes (both OS media-query changes
 * and in-app `ludo-motion` preference updates).
 */
export function onReducedMotionChange(listener: (reduced: boolean) => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const notify = () => listener(prefersReducedMotion());
    mq.addEventListener('change', notify);
    window.addEventListener('ludo-prefs-change', notify);
    return () => {
        mq.removeEventListener('change', notify);
        window.removeEventListener('ludo-prefs-change', notify);
    };
}
