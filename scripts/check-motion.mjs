/**
 * Motion gate — CSS_LAYOUT_ANIMATION_PLAN.md §3.3 (P0/S).
 *
 * The plan's rule: all motion on the compositor (transform / opacity only).
 * Animating layout properties (width/height/top/left/right/bottom/margin/
 * padding) re-layouts the document on every frame — the single largest source
 * of INP jank on mid-tier mobile, and the board is the app's hot surface.
 *
 * The gate is deliberately allowlist-shaped, mirroring check-routes.mjs: the
 * codebase was NOT born clean, and pretending otherwise either fails forever
 * or lies. Each KNOWN entry is a measured as-found case with the reason it is
 * still allowed; closing one means deleting it from the list and fixing the
 * code. Anything NEW fails.
 *
 * Scope: app/**\/*.css and app/**\/*.tsx (inline styles + framer-motion
 * `animate` objects). Tailwind utility classes are not (and cannot be)
 * resolved statically — that half is covered by the visual-diff harness in
 * the plan's Phase 0.
 *
 * Also reports (informational, never failing): the reduced-motion census —
 * how many motion entry points exist and how many honor the OS setting.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');

/** Layout properties: animating any of these forces layout per frame. */
const LAYOUT_PROPS = ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'inset'];

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

const appFiles = walk(join(root, 'app')).filter((f) => ['.css', '.tsx'].includes(extname(f)));

/**
 * Known violations, by stable key (never line numbers — they rot).
 * key -> why it is still allowed.
 */
const KNOWN_KEYFRAMES = new Map([
    // Progress/loading bars: width is the semantic of the animation itself.
    // Burn-down target: convert to transform: scaleX with a transform-origin.
    ['loading-bar', 'bar fill animates width by design; convert to scaleX (plan §3.3)'],
    ['shimmer', 'sheen sweeps via left; convert to transform translateX (plan §3.3)'],
]);

const KNOWN_CSS_SELECTOR = new Map([
    // Identified by file + the declaration fragment, so unrelated edits nearby
    // do not silently pass new violations through.
    ['app/globals.css|stroke-dasharray', 'BoardHome progress ring animates stroke-dasharray (SVG geometry); migrate to the motion scale'],
]);

const KNOWN_FRAMER_SITE = new Map([
    // Progress bars (XP / rank / bet-window / dice音量): width IS the content.
    ['app/components/UserProfilePanel.tsx', 'XP + rank progress bars animate width (fraction of a track)'],
    ['app/components/SpectatorHUD.tsx', 'bet-window progress bar animates width'],
    ['app/components/QuickMatchPanel.tsx', 'signal bars animate height (equalizer)'],
    ['app/components/MatchHistoryTab.tsx', 'expanded match card details accordion animates height: auto'],
    ['app/components/UnsyncedMatchesPanel.tsx', 'unsynced match list accordion animates height: auto'],
]);

const KNOWN_WILL_CHANGE = new Map([
    // Plan §3.3: keep will-change at zero; transient use on board/* token
    // pieces during a move is the only sanctioned exception, applied and
    // removed in JS — not declared in CSS.
]);

let failures = 0;
const note = (m) => console.log(`  ${m}`);

// ── CSS checks ────────────────────────────────────────────────────────────
const cssViolations = [];
for (const file of appFiles.filter((f) => f.endsWith('.css'))) {
    const rel = relative(root, file);
    const css = readFileSync(file, 'utf8');

    // 1. transition/animation shorthands + transition-property naming layout props
    const declRe = /(transition(?:-property)?|animation)\s*:\s*([^;{}]+)/g;
    for (const m of css.matchAll(declRe)) {
        const value = m[2];
        const named = LAYOUT_PROPS.filter((p) => new RegExp(`(^|[\\s,])${p}([\\s,]|$)`).test(value));
        if (named.length === 0) continue;
        const key = `${rel}|${named.join(',')}`;
        if (KNOWN_CSS_SELECTOR.has(key)) continue;
        cssViolations.push(`${rel}: \`${m[1]}: ${value.trim().slice(0, 60)}\` animates ${named.join('/')}`);
    }

    // 2. @keyframes bodies animating layout props
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
        const name = m[1];
        if (KNOWN_KEYFRAMES.has(name)) continue;
        const start = m.index + m[0].length;
        const body = css.slice(start, css.indexOf('}', start));
        const named = LAYOUT_PROPS.filter((p) => new RegExp(`(^|[\\s;{])${p}\\s*:`).test(body));
        if (named.length > 0) {
            cssViolations.push(`${rel}: @keyframes ${name} animates ${named.join('/')}`);
        }
    }

    // 3. will-change: zero by default
    for (const m of css.matchAll(/will-change\s*:\s*([^;]+)/g)) {
        const key = `${rel}|${m[1].trim()}`;
        if (KNOWN_WILL_CHANGE.has(key)) continue;
        cssViolations.push(`${rel}: will-change: ${m[1].trim()} — plan §3.3 keeps will-change at zero (transient use only, applied/removed in JS)`);
    }
}

// ── TSX checks (inline styles + framer-motion) ────────────────────────────
const tsxViolations = [];
for (const file of appFiles.filter((f) => f.endsWith('.tsx'))) {
    const rel = relative(root, file);
    const src = readFileSync(file, 'utf8');

    // 4. inline style={{ transition: '…layout props…' }}
    for (const m of src.matchAll(/transition\s*:\s*'([^']+)'/g)) {
        const value = m[1];
        const named = LAYOUT_PROPS.filter((p) => new RegExp(`(^|[\\s,])${p}([\\s,]|$)`).test(value));
        if (named.length === 0) continue;
        const key = `${rel}|${named.join(',')}`;
        if (KNOWN_CSS_SELECTOR.has(key)) continue;
        tsxViolations.push(`${rel}: inline transition animates ${named.join('/')} ('${value.slice(0, 50)}')`);
    }

    // 5. framer-motion animate={{ width|height: … }}
    for (const m of src.matchAll(/animate=\{\{\s*([^}]*)\}\}/g)) {
        const body = m[1];
        const named = LAYOUT_PROPS.filter((p) => new RegExp(`(^|[\\s,{])${p}\\s*:`).test(body));
        if (named.length === 0) continue;
        if (KNOWN_FRAMER_SITE.has(rel)) continue;
        tsxViolations.push(`${rel}: framer-motion animate targets ${named.join('/')}`);
    }
}

// ── Reduced-motion census (informational) ─────────────────────────────────
const census = { cssBlocks: 0, gsapFiles: [], confettiFiles: [], framerFiles: 0, motionGuarded: 0 };
const globals = readFileSync(join(root, 'app/globals.css'), 'utf8');
census.cssBlocks = (globals.match(/prefers-reduced-motion/g) || []).length;
for (const file of appFiles.filter((f) => f.endsWith('.tsx'))) {
    const rel = relative(root, file);
    const src = readFileSync(file, 'utf8');
    if (/from 'gsap'|from "gsap"/.test(src)) census.gsapFiles.push(rel);
    // Import-shaped match only — a comment or string mentioning canvas-confetti
    // (as in Providers.tsx's MotionConfig note) is not a motion surface.
    if (/(?:from\s+|import\s*\(\s*)['"]canvas-confetti['"]/.test(src)) census.confettiFiles.push(rel);
    if (/from 'framer-motion'|from "framer-motion"/.test(src)) census.framerFiles++;
    if (/prefersReducedMotion/.test(src)) census.motionGuarded++;
}
const jsMotionFiles = new Set([...census.gsapFiles, ...census.confettiFiles]);
const unguarded = [...jsMotionFiles].filter((f) => {
    const src = readFileSync(join(root, f), 'utf8');
    return !src.includes('prefersReducedMotion') && !src.includes('MotionConfig');
});

// ── Report ────────────────────────────────────────────────────────────────
console.log(`motion gate: ${appFiles.length} files scanned (${appFiles.filter((f) => f.endsWith('.css')).length} css, ${appFiles.filter((f) => f.endsWith('.tsx')).length} tsx)`);
for (const v of [...cssViolations, ...tsxViolations]) {
    console.log(`✗ ${v}`);
    failures++;
}
note(`keyframes allowlist: ${KNOWN_KEYFRAMES.size} (${[...KNOWN_KEYFRAMES.keys()].join(', ')})`);
note(`framer layout-animation allowlist: ${KNOWN_FRAMER_SITE.size} (${[...KNOWN_FRAMER_SITE.keys()].join(', ')})`);
console.log(`reduced-motion census:`);
note(`css kill-switch blocks: ${census.cssBlocks} · framer files: ${census.framerFiles} (covered by MotionConfig reducedMotion="user")`);
note(`gsap files: ${census.gsapFiles.join(', ') || 'none'} · confetti files: ${census.confettiFiles.join(', ') || 'none'}`);
note(`js motion files honoring prefers-reduced-motion: ${jsMotionFiles.size - unguarded.length}/${jsMotionFiles.size}`);
for (const f of unguarded) note(`  ! ${f} — motion without a reduced-motion guard`);

if (failures > 0) {
    console.log(`✗ motion gate failed: ${failures} new layout-property animation(s) — fix, or add a KNOWN entry with a reason and a burn-down plan`);
    process.exit(1);
}
console.log('✓ motion gate clean (compositor-only; no new layout-property animations)');
