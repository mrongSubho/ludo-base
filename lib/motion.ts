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

/** The one media query every motion path must respect. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Current preference. SSR-safe: returns false on the server (no window), so
 * first paint matches the non-reduced design and hydration never mismatches —
 * animations trigger on state changes, which re-check this at trigger time.
 */
export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Subscribe to preference changes. Returns an unsubscribe function. Used by
 * long-lived motion surfaces (and tests) that must react mid-session.
 */
export function onReducedMotionChange(listener: (reduced: boolean) => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const handler = (e: MediaQueryListEvent) => listener(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
}
