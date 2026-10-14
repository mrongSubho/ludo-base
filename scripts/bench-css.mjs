/**
 * CSS budget baseline — CSS_LAYOUT_ANIMATION_PLAN.md §6 (advisory).
 *
 * The plan's gates need numbers before they can enforce anything: this script
 * produces the Phase 0 baseline (and every future re-measurement) for CSS
 * payload, rule/selector/keyframe counts, and the JS-side motion surface.
 * Advisory by design: it never fails, it reports. Enforcement (blocking
 * merges) lands with the plan's Phase 2, once the token migration is what the
 * numbers are protecting.
 *
 * Usage:  node scripts/bench-css.mjs [--json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = join(import.meta.dirname ?? __dirname, '..');
const asJson = process.argv.includes('--json');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

const cssFiles = walk(join(root, 'app')).filter((f) => extname(f) === '.css');
const tsxFiles = walk(join(root, 'app')).filter((f) => extname(f) === '.tsx');

let totalBytes = 0;
let totalGzip = 0;
const perFile = [];
for (const f of cssFiles) {
    const src = readFileSync(f);
    totalBytes += src.length;
    totalGzip += gzipSync(src).length;
    perFile.push({ file: relative(root, f), bytes: src.length, gzip: gzipSync(src).length });
}
perFile.sort((a, b) => b.bytes - a.bytes);

const globals = readFileSync(join(root, 'app/globals.css'), 'utf8');
const count = (re) => (globals.match(re) || []).length;

let inlineStyles = 0;
let rawImgs = 0;
let framerAnimateLayout = 0;
let mediaQueries = 0;
// Type-scale adoption (plan §3.2 P1/S): hardcoded `text-[Npx]` sites vs.
// sites on the fluid `text-ludo-*` scale. The burn-down target is
// hardcodedTextPx → 0 as surfaces are migrated; reported, never enforced.
let hardcodedTextPx = 0;
let scaleTextUtilities = 0;
for (const f of tsxFiles) {
    const src = readFileSync(f, 'utf8');
    inlineStyles += (src.match(/style=\{\{/g) || []).length;
    rawImgs += (src.match(/<img\b/g) || []).length;
    hardcodedTextPx += (src.match(/text-\[[0-9]+px\]/g) || []).length;
    scaleTextUtilities += (src.match(/text-ludo-(?:xs|sm|md|lg|xl|2xl|3xl)\b/g) || []).length;
    for (const m of src.matchAll(/animate=\{\{\s*([^}]*)\}\}/g)) {
        if (/\b(width|height)\s*:/.test(m[1])) framerAnimateLayout++;
    }
}
for (const f of cssFiles) mediaQueries += (readFileSync(f, 'utf8').match(/@media/g) || []).length;

const report = {
    css: {
        files: cssFiles.length,
        totalBytes,
        totalGzip,
        mediaQueries,
        largest: perFile.slice(0, 5),
    },
    globals: {
        lines: globals.split('\n').length,
        rules: count(/\}/g),
        selectors: count(/[^{}]+\{/g),
        keyframes: count(/@keyframes/g),
        mediaQueries: (globals.match(/@media/g) || []).length,
        customProperties: count(/--[\w-]+\s*:/g),
        reducedMotionBlocks: count(/prefers-reduced-motion/g),
    },
    surface: {
        tsxFiles: tsxFiles.length,
        inlineStyles,
        rawImgs,
        framerAnimateLayout,
        hardcodedTextPx,
        scaleTextUtilities,
    },
};

if (asJson) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log('CSS budget baseline (advisory — CSS_LAYOUT_ANIMATION_PLAN §6)');
    console.log(`  css files            ${report.css.files}  (${report.css.totalBytes} B raw, ${report.css.totalGzip} B gzip, ${report.css.mediaQueries} @media)`);
    for (const f of report.css.largest) console.log(`    ${f.file.padEnd(34)} ${String(f.bytes).padStart(7)} B  ${String(f.gzip).padStart(6)} B gzip`);
    console.log(`  globals.css          ${report.globals.lines} lines · ~${report.globals.rules} rules · ~${report.globals.selectors} selectors`);
    console.log(`  keyframes            ${report.globals.keyframes} · media queries ${report.globals.mediaQueries} · custom props ${report.globals.customProperties}`);
    console.log(`  reduced-motion       ${report.globals.reducedMotionBlocks} @media blocks (css kill-switch)`);
    console.log(`  surface              inline style={{} ${report.surface.inlineStyles} · raw <img> ${report.surface.rawImgs} · framer layout anims ${report.surface.framerAnimateLayout}`);
    console.log(`  type scale           text-ludo-* ${report.surface.scaleTextUtilities} · hardcoded text-[Npx] ${report.surface.hardcodedTextPx}`);
    console.log('  targets (plan §6):   inline ≤ 100 dynamic-only · raw img 0 · keyframes declining · css −30% after Phase 2');
}
