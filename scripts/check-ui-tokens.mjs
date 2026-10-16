#!/usr/bin/env node
/**
 * check-ui-tokens.mjs — the ui-token guard (DESIGN.md §9, UI_DESIGN_AUDIT §6.3).
 *
 * Fails on dark-first utilities INTRODUCED BY THE DIFF: `text-white`,
 * `bg-white/…`, `border-white/…`, `text-cyan-400`, and the amber/green status
 * families that the semantic tokens replaced.
 *
 * Diff-scoped on purpose: the codebase was not born token-clean, so a
 * whole-repo check would fail forever and teach everyone to ignore it. Only
 * what a change ADDS is judged; the legacy is burned down group by group
 * (UI_AUDIT_TRACKER §5).
 *
 * Warn mode by default — the audits specify warn until Phase 4 completes, then
 * hard-fail. `--strict` flips it now.
 *
 * Usage: node scripts/check-ui-tokens.mjs [--strict] [--base <ref>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const baseArg = args.indexOf("--base");
const BASE = baseArg !== -1 ? args[baseArg + 1] : "origin/main";

const DARK_FIRST =
    /\btext-white\b|\bbg-white\/|\bborder-white\/|\bdivide-white\/|\bring-white\/|\btext-cyan-[0-9]|\btext-amber-[0-9]|\btext-green-[0-9]|\btext-red-[0-9]|\btext-emerald-[0-9]/;

function git(a) {
    return execFileSync("git", a, { encoding: "utf8" }).trim();
}

/** First base ref that actually resolves in this clone (shallow clones have no origin/main). */
function resolveBase(preferred) {
    for (const candidate of [preferred, "origin/main", "main", "HEAD~1"]) {
        try {
            execFileSync("git", ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], { stdio: "ignore" });
            return candidate;
        } catch {
            /* try the next one */
        }
    }
    return null;
}

const base = resolveBase(BASE);
if (!base) {
    console.log("ui-token-guard: no resolvable base ref (shallow clone?) — skipping, not blocking");
    process.exit(0);
}

let files;
try {
    files = git(["diff", "--name-only", "--diff-filter=d", `${base}...HEAD`, "--", "app"])
        .split("\n")
        .filter((f) => f && /\.(tsx|ts)$/.test(f) && !f.endsWith("globals.css"));
} catch {
    console.error(`ui-token-guard: could not diff against ${base} — pass --base <ref>`);
    process.exit(0); // never block on a missing ref in warn mode
}

if (files.length === 0) {
    console.log("ui-token-guard: no changed app files to check");
    process.exit(0);
}

const hits = [];
for (const file of files) {
    let src;
    try {
        src = readFileSync(file, "utf8");
    } catch {
        continue;
    }
    src.split("\n").forEach((line, i) => {
        if (DARK_FIRST.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
}

if (hits.length === 0) {
    console.log(`ui-token-guard: clean (${files.length} changed file(s))`);
    process.exit(0);
}

console.log(`ui-token-guard: dark-first utilities in changed files (${hits.length}):`);
for (const h of hits.slice(0, 40)) console.log("  " + h);
if (hits.length > 40) console.log(`  … ${hits.length - 40} more`);

if (STRICT) {
    console.error("✗ use the semantic tokens (DESIGN.md §9) — text-ink-*, bg-surface-*, text-accent");
    process.exit(1);
}
console.log("⚠ warn mode (not blocking) — flips to hard-fail when Phase 4 completes");
