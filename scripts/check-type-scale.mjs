#!/usr/bin/env node
/**
 * check-type-scale.mjs — Type scale token gate (CSS_LAYOUT_ANIMATION_PLAN §3.2 P1/S).
 *
 * Enforces zero hardcoded arbitrary `text-[Npx]` utilities across `app/**`.
 * All font sizes must consume standard `--text-ludo-*` design tokens from @theme.
 *
 * Exit code 0: Clean type scale compliance.
 * Exit code 1: Regressions detected.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

const tsxFiles = walk(join(root, 'app')).filter((f) => extname(f) === '.tsx');
const violations = [];

for (const f of tsxFiles) {
    const src = readFileSync(f, 'utf8');
    const matches = src.match(/text-\[[0-9]+px\]/g);
    if (matches && matches.length > 0) {
        violations.push({ file: f, count: matches.length, matches });
    }
}

if (violations.length > 0) {
    console.error('❌ Type Scale Gate Failed: Found hardcoded text-[Npx] instances:');
    for (const v of violations) {
        console.error(`  ${v.file}: ${v.count} violations (${v.matches.join(', ')})`);
    }
    console.error('Please migrate to standard --text-ludo-* tokens (e.g. text-ludo-xs, text-ludo-sm, text-ludo-md, text-ludo-lg).');
    process.exit(1);
} else {
    console.log('✅ Type Scale Gate Passed: 0 hardcoded text-[Npx] sites across all app surfaces.');
    process.exit(0);
}
