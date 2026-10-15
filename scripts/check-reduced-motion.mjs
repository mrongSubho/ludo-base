/**
 * Reduced-motion gate — UI_DESIGN_AUDIT 1.5.4, CSS_LAYOUT_ANIMATION_PLAN.md §5.
 *
 * 1.5.4 was a manual check ("macOS System Settings → Accessibility → Display →
 * Reduce Motion, walk the lobby and a panel open/close"). Manual checks rot: the
 * CSS kill-switch and `<MotionConfig reducedMotion="user">` can silently stop
 * working and nobody notices until a motion-sensitive user does. This gate makes
 * the same assertion machine-checkable, so it can run in CI.
 *
 * WHAT IT ASSERTS (both directions — the second is what makes the first mean
 * anything):
 *   1. Under `prefers-reduced-motion: reduce`, the app runs ZERO animations.
 *   2. Under `no-preference`, the app runs SOME animations (> 0, and at least
 *      one looping one).
 * Without (2), an app that simply never animated would "pass" (1) while proving
 * nothing. The pair is the real contract: motion exists, and the preference
 * turns it off.
 *
 * SCOPE / HONEST LIMITS: this covers *CSS* animation and the framer surface via
 * `document.getAnimations()` — the browser's own registry, so it sees both
 * stylesheet animation and Web Animations API motion. It cannot see GSAP's
 * canvas work (`board/TokenPiece.tsx`) or `canvas-confetti`, which are not in
 * that registry; `lib/motion.ts` `prefersReducedMotion()` is the contract those
 * paths check, and it is exercised here indirectly (the same media query drives
 * both). The lobby is the probe surface because it carries the app's densest
 * decorative motion (orbs, ticker, status pulse).
 *
 * Requires a running app (VISUAL_BASE_URL, default http://127.0.0.1:3000).
 *
 * Usage:  node scripts/check-reduced-motion.mjs
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:3000';
const VIEWPORT = { width: 390, height: 844 };

/** Drive the guest flow into the lobby — the densest motion surface. */
async function openLobby(page) {
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByText('Continue as Guest', { exact: false }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.getByText('Enter the lobby', { exact: false }).first().click().catch(() => {});
    await page.waitForTimeout(4000);
}

/** Count animations the browser is actually running. */
async function sample(mode) {
    const browser = await chromium.launch();
    try {
        const ctx = await browser.newContext({
            viewport: VIEWPORT,
            deviceScaleFactor: 1,
            reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference',
        });
        await ctx.addInitScript(() => {
            try {
                localStorage.setItem('ludo-guest-id', 'guest_5eed01');
                localStorage.setItem('ludo-guest-active', '1');
                localStorage.setItem('ludo-last-mode', 'offline');
            } catch {}
        });
        const page = await ctx.newPage();
        await openLobby(page);
        return await page.evaluate(() => {
            const anims = document.getAnimations();
            return {
                mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
                total: anims.length,
                looping: anims.filter(
                    (a) => a.effect && a.effect.getTiming().iterations === Infinity
                ).length,
            };
        });
    } finally {
        await browser.close();
    }
}

const reduced = await sample('reduce');
const normal = await sample('no-preference');

console.log(`reduced-motion gate (lobby @ ${BASE_URL})`);
console.log(`  reduce:        ${reduced.total} animations (${reduced.looping} looping), matchMedia=${reduced.mediaMatches}`);
console.log(`  no-preference: ${normal.total} animations (${normal.looping} looping), matchMedia=${normal.mediaMatches}`);

const problems = [];

if (!reduced.mediaMatches) {
    problems.push('the browser did not report prefers-reduced-motion:reduce — the probe is not testing what it claims');
}
if (normal.mediaMatches) {
    problems.push('no-preference run also matched the reduce query — the two runs are not distinguishable');
}

// (1) reduced motion must stop everything.
if (reduced.total !== 0) {
    problems.push(
        `reduced motion still runs ${reduced.total} animation(s) — the CSS kill-switch or MotionConfig has regressed (plan §5: reduced motion removes translation, never information)`
    );
}

// (2) the control run must actually animate, or (1) proves nothing.
if (normal.total === 0) {
    problems.push(
        'the no-preference control run also ran 0 animations — the lobby has no motion to suppress, so the reduced-motion result is meaningless (this gate would pass vacuously)'
    );
}
if (normal.looping === 0) {
    problems.push(
        'the no-preference control run had no looping animation — decorative motion (orbs, ticker, status pulse) is missing, so this probe is no longer exercising the case it was written for'
    );
}

if (problems.length > 0) {
    for (const p of problems) console.log(`✗ ${p}`);
    console.log(`✗ reduced-motion gate failed: ${problems.length} problem(s)`);
    process.exit(1);
}

console.log('✓ reduced-motion gate clean (reduce stops all motion; no-preference still animates)');
