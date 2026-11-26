/**
 * Motion gate — CSS_LAYOUT_ANIMATION_PLAN.md §3.3 (P0/S).
 *
 * The plan's rule: all motion on the compositor (transform / opacity only).
 * Animating layout properties (width/height/top/left/right/bottom/margin/
 * padding) re-layouts the document on every frame — the single largest source
 * of INP jank on mid-tier mobile, and the board is the app's hot surface.
 *
 * Also enforces the reduced-motion invariants:
 *   1. Every `@media (prefers-reduced-motion: reduce)` block in app/**\/*.css
 *      scopes its rules with `:not(.motion-force-full)` so the user's manual
 *      motion toggle overrides stay consistent.
 *   2. Every file in app/ or hooks/ importing `gsap` or `canvas-confetti` guards
 *      motion with `prefersReducedMotion` or `useReducedMotion` (or `MotionConfig`).
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

function extractAtMediaBlocks(css) {
    const blocks = [];
    const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
    for (const m of css.matchAll(re)) {
        let depth = 1;
        let idx = m.index + m[0].length;
        while (idx < css.length && depth > 0) {
            const ch = css[idx];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            idx++;
        }
        blocks.push(css.slice(m.index, idx));
    }
    return blocks;
}

const appFiles = walk(join(root, 'app')).filter((f) => ['.css', '.tsx', '.ts'].includes(extname(f)));
const hookFiles = walk(join(root, 'hooks')).filter((f) => ['.tsx', '.ts'].includes(extname(f)));
const scannedFiles = [...appFiles, ...hookFiles];

/**
 * Known violations, by stable key (never line numbers — they rot).
 * key -> why it is still allowed.
 */
const KNOWN_KEYFRAMES = new Map([
    ['loading-bar', 'bar fill animates width by design; convert to scaleX (plan §3.3)'],
    ['shimmer', 'sheen sweeps via left; convert to transform translateX (plan §3.3)'],
]);

const KNOWN_CSS_SELECTOR = new Map([
    ['app/globals.css|stroke-dasharray', 'BoardHome progress ring animates stroke-dasharray (SVG geometry); migrate to the motion scale'],
]);

const KNOWN_FRAMER_SITE = new Map([]);
const KNOWN_WILL_CHANGE = new Map([]);

let failures = 0;
const note = (m) => console.log(`  ${m}`);

// ── CSS checks ────────────────────────────────────────────────────────────
const cssViolations = [];
const bareReducedMotionBlocks = [];
let cssReducedBlocks = 0;

for (const file of appFiles.filter((f) => f.endsWith('.css'))) {
    const rel = relative(root, file);
    const css = readFileSync(file, 'utf8');

    const declRe = /(transition(?:-property)?|animation)\s*:\s*([^;{}]+)/g;
    for (const m of css.matchAll(declRe)) {
        const value = m[2];
        const named = LAYOUT_PROPS.filter((p) => new RegExp(`(^|[\\s,])${p}([\\s,]|$)`).test(value));
        if (named.length === 0) continue;
        const key = `${rel}|${named.join(',')}`;
        if (KNOWN_CSS_SELECTOR.has(key)) continue;
        cssViolations.push(`${rel}: \`${m[1]}: ${value.trim().slice(0, 60)}\` animates ${named.join('/')}`);
    }

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

    for (const m of css.matchAll(/will-change\s*:\s*([^;]+)/g)) {
        const key = `${rel}|${m[1].trim()}`;
        if (KNOWN_WILL_CHANGE.has(key)) continue;
        cssViolations.push(`${rel}: will-change: ${m[1].trim()} — plan §3.3 keeps will-change at zero (transient use only, applied/removed in JS)`);
    }

    const blocks = extractAtMediaBlocks(css);
    cssReducedBlocks += blocks.length;
    for (const block of blocks) {
        if (!block.includes(':not(.motion-force-full)')) {
            bareReducedMotionBlocks.push(`${rel}: @media (prefers-reduced-motion: reduce) missing :not(.motion-force-full) guard`);
        }
    }
}

// ── TS/TSX checks (inline styles + framer-motion) ─────────────────────────
const tsxViolations = [];
for (const file of appFiles.filter((f) => f.endsWith('.tsx'))) {
    const rel = relative(root, file);
    const src = readFileSync(file, 'utf8');

    for (const m of src.matchAll(/transition\s*:\s*'([^']+)'/g)) {
        const value = m[1];
        const named = LAYOUT_PROPS.filter((p) => new RegExp(`(^|[\\s,])${p}([\\s,]|$)`).test(value));
        if (named.length === 0) continue;
        const key = `${rel}|${named.join(',')}`;
        if (KNOWN_CSS_SELECTOR.has(key)) continue;
        tsxViolations.push(`${rel}: inline transition animates ${named.join('/')} ('${value.slice(0, 50)}')`);
    }

    for (const m of src.matchAll(/animate=\{\{\s*([^}]*)\}\}/g)) {
        const body = m[1];
        const named = LAYOUT_PROPS.filter((p) => new RegExp(`(^|[\\s,{])${p}\\s*:`).test(body));
        if (named.length === 0) continue;
        if (KNOWN_FRAMER_SITE.has(rel)) continue;
        tsxViolations.push(`${rel}: framer-motion animate targets ${named.join('/')}`);
    }
}

// ── Reduced-motion census (app/ + hooks/) ─────────────────────────────────
const census = { cssBlocks: cssReducedBlocks, gsapFiles: [], confettiFiles: [], framerFiles: 0, motionGuarded: 0 };
for (const file of scannedFiles.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
    const rel = relative(root, file);
    const src = readFileSync(file, 'utf8');
    if (/from 'gsap'|from "gsap"/.test(src)) census.gsapFiles.push(rel);
    if (/(?:from\s+|import\s*\(\s*)['"]canvas-confetti['"]/.test(src)) census.confettiFiles.push(rel);
    if (/from 'framer-motion'|from "framer-motion"/.test(src)) census.framerFiles++;
    if (/prefersReducedMotion|useReducedMotion/.test(src)) census.motionGuarded++;
}
const jsMotionFiles = new Set([...census.gsapFiles, ...census.confettiFiles]);
const unguarded = [...jsMotionFiles].filter((f) => {
    const src = readFileSync(join(root, f), 'utf8');
    return !src.includes('prefersReducedMotion') && !src.includes('useReducedMotion') && !src.includes('MotionConfig');
});

// ── Report ────────────────────────────────────────────────────────────────
console.log(
    `motion gate: ${scannedFiles.length} files scanned (${appFiles.filter((f) => f.endsWith('.css')).length} css, ${appFiles.filter((f) => f.endsWith('.tsx')).length} tsx, ${hookFiles.length} hooks)`,
);
for (const v of [...cssViolations, ...tsxViolations, ...bareReducedMotionBlocks]) {
    console.log(`✗ ${v}`);
    failures++;
}
for (const f of unguarded) {
    console.log(`✗ ${f}: uses gsap/canvas-confetti without a reduced-motion guard`);
    failures++;
}
note(`keyframes allowlist: ${KNOWN_KEYFRAMES.size} (${[...KNOWN_KEYFRAMES.keys()].join(', ')})`);
note(`framer layout-animation allowlist: ${KNOWN_FRAMER_SITE.size} (${[...KNOWN_FRAMER_SITE.keys()].join(', ')})`);
console.log(`reduced-motion census:`);
note(`css kill-switch blocks: ${census.cssBlocks} · framer files: ${census.framerFiles} (covered by MotionConfig reducedMotion="user")`);
note(`gsap files: ${census.gsapFiles.join(', ') || 'none'} · confetti files: ${census.confettiFiles.join(', ') || 'none'}`);
note(`js motion files honoring prefers-reduced-motion: ${jsMotionFiles.size - unguarded.length}/${jsMotionFiles.size}`);

if (failures > 0) {
    console.log(`✗ motion gate failed: ${failures} violation(s)`);
    process.exit(1);
}
console.log('✓ motion gate clean (compositor-only; no new layout-property animations; reduced-motion scoped)');
