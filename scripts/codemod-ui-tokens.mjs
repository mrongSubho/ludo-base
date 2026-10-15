#!/usr/bin/env node
/**
 * codemod-ui-tokens.mjs — UI_DESIGN_AUDIT Phase 4.0 codemod.
 *
 * Mechanically converts dark-first Tailwind color utilities to the semantic
 * token layer (`text-ink-*`, `bg-surface-*`, `border-line-*`, `text-accent`, …)
 * inside className/class literals. Nothing else in the file is touched.
 *
 * Why this is safe (audit §4 "the invariant"): every old utility below is
 * already remapped by the Daybreak patch layer, so converting a panel cannot
 * change either theme's appearance — the token resolves to the value the patch
 * layer was already painting. Patch rules are deleted separately, once their
 * last consumer converts.
 *
 * Usage:
 *   node scripts/codemod-ui-tokens.mjs <file.tsx> [more files...]   # dry run: prints converted source + a summary
 *   node scripts/codemod-ui-tokens.mjs <file.tsx> --write          # writes in place
 *   node scripts/codemod-ui-tokens.mjs --check <file.tsx>          # exits 1 if the file still has convertible classes
 *
 * Guardrails (audit §4.0):
 *   - Only text inside className="…", className={`…`} and class="…" is rewritten.
 *     clsx()/array/concatenated class strings are skipped — hand-fix those.
 *   - The board is excluded by the mapping itself: --ludo-* pastels, var(--ludo-*)
 *     colors and bg-black/40 scrims are not in the table and stay as-is.
 *   - One file at a time; review with `git diff -w` before --write.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Left = dark-first utility (already patch-remapped today), right = token utility. */
const MAP = [
    [/\btext-white\/90\b|\btext-white\/80\b|\btext-white\/75\b|\btext-white\/70\b/g, "text-ink-muted"],
    [/\btext-white\/60\b|\btext-white\/55\b|\btext-white\/50\b|\btext-white\/45\b|\btext-white\/40\b/g, "text-ink-faint"],
    [/\btext-white\/35\b|\btext-white\/30\b|\btext-white\/25\b|\btext-white\/20\b|\btext-white\/10\b/g, "text-ink-faint"],
    [/\btext-white\b/g, "text-ink-strong"],
    [/\bhover:text-white\/70\b|\bhover:text-white\/60\b/g, "hover:text-ink-strong"],
    [/\bbg-white\/\[0\.04\]\b|\bbg-white\/\[0\.07\]\b|\bbg-white\/5\b/g, "bg-surface-recessed"],
    [/\bbg-white\/10\b/g, "bg-surface-hover"],
    [/\bbg-white\/15\b|\bbg-white\/20\b|\bbg-white\/25\b|\bbg-white\/30\b/g, "bg-surface-active"],
    [/\bborder-white\/5\b|\bborder-white\/10\b|\bborder-white\/15\b|\bborder-white\/20\b|\bborder-white\/25\b|\bborder-white\/30\b|\bborder-white\/40\b/g, "border-line-soft"],
    [/\bdivide-white\/5\b/g, "divide-line-soft"],
    [/\bring-white\/10\b/g, "ring-line-soft"],
    [/\btext-cyan-300\b|\btext-cyan-400\b/g, "text-accent"],
    [/\bbg-cyan-500\/20\b|\bbg-cyan-400\/20\b|\bbg-cyan-500\/15\b/g, "bg-accent-soft"],
    [/\btext-amber-300\b|\btext-amber-400\b|\btext-amber-500\b|\btext-yellow-300\b|\btext-yellow-400\b|\btext-yellow-500\b/g, "text-warn"],
    [/\btext-green-200\b|\btext-green-300\b|\btext-green-400\b|\btext-green-500\b|\btext-emerald-400\b/g, "text-positive"],
    [/\btext-red-300\b|\btext-red-400\b|\btext-red-500\b/g, "text-negative"],
];

/** className="…" | className={`…`} | class="…" — captured group is the literal to rewrite. */
const SEGMENT = /(className|class)\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g;

/** Class-string literal → converted class string, recording every replacement. */
function convertSegment(s, hits) {
    for (const [re, to] of MAP) {
        s = s.replace(re, (m) => {
            hits.push([m, to]);
            return to;
        });
    }
    return s;
}

function convertSource(src) {
    const hits = [];
    const out = src.replace(SEGMENT, (m, attr, dq, tpl, brace) => {
        if (dq !== undefined) return `${attr}="${convertSegment(dq, hits)}"`;
        if (tpl !== undefined) return `${attr}={\`${convertSegment(tpl, hits)}\`}`;
        return `${attr}={${JSON.stringify(convertSegment(brace, hits))}}`;
    });
    return { out, hits };
}

function summarize(hits) {
    const byPair = new Map();
    for (const [from, to] of hits) byPair.set(`${from} → ${to}`, (byPair.get(`${from} → ${to}`) ?? 0) + 1);
    return [...byPair.entries()].map(([k, n]) => `  ${n}× ${k}`).sort().join("\n");
}

const argv = process.argv.slice(2);
const checkMode = argv.includes("--check");
const writeMode = argv.includes("--write");
const files = argv.filter((a) => !a.startsWith("--"));

if (files.length === 0) {
    console.error("usage: node scripts/codemod-ui-tokens.mjs <file.tsx> [...] [--write|--check]");
    process.exit(2);
}

let dirty = false;
for (const f of files) {
    const src = readFileSync(f, "utf8");
    const { out, hits } = convertSource(src);
    if (hits.length === 0) {
        console.error(`${f}: no convertible classes`);
        continue;
    }
    dirty = true;
    console.error(`${f}: ${hits.length} replacement(s)`);
    console.error(summarize(hits));
    if (checkMode) continue;
    if (writeMode) {
        writeFileSync(f, out);
        console.error(`${f}: written`);
    } else {
        console.log(out);
    }
}
process.exit(checkMode && dirty ? 1 : 0);
