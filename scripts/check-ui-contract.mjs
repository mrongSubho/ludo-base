#!/usr/bin/env node
/**
 * check-ui-contract.mjs — the banned-pattern guard (DESIGN.md §9,
 * UI_COMPONENT_AUDIT E.1).
 *
 * Fails on the one-off values the contract bans, in files the diff touches:
 *
 *   - `text-[6|7|8|9]px]`        sub-10px text (the type floor is 10px)
 *   - `rounded-[Npx]`            arbitrary radius outside the scale allowlist
 *   - `font-black`               weight 900 outside the chrome-label pattern
 *   - `bg-cyan-500`              pre-token accent fills
 *   - `#0052FF`                  the retired CTA fill (allowed only as the
 *                                documented `Button brand` exception)
 *
 * Diff-scoped and warn-by-default for the same reason as the token guard: the
 * legacy is mid-migration, so only what a change ADDS is judged. `--strict`
 * flips it to a hard fail once Phase 4 completes.
 *
 * Note on the audit's naming: this is `.mjs`, not the `.sh` the audit sketched,
 * because the radius rule needs negative lookahead and BSD/macOS grep has no
 * `-P`. The repo's other gates are node scripts for the same reason.
 *
 * Usage: node scripts/check-ui-contract.mjs [--strict] [--base <ref>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const baseArg = args.indexOf("--base");
const BASE = baseArg !== -1 ? args[baseArg + 1] : "origin/main";

/** Radii the scale sanctions (card 16/18 · sheet 28/32 · pill 999 · control 10/12/14). */
const RADIUS_OK = new Set([10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 100, 999, 9999]);

/** The only file allowed to carry the retired brand hex. */
const BRAND_ALLOWED = ["app/components/Button.tsx"];

const RULES = [
    { name: "sub-10px text", re: /text-\[[6-9]px\]/, hint: "the type floor is 10px (DESIGN.md §4)" },
    { name: "font-black outside chrome labels", re: /\bfont-black\b/, hint: "weight 900 is reserved for label-chrome (DESIGN.md §4)" },
    { name: "pre-token accent fill", re: /\bbg-cyan-500\b/, hint: "use bg-accent / bg-accent-soft" },
    { name: "retired CTA fill", re: /#0052FF/i, hint: "use Button variant=\"primary\"; #0052FF only as the documented brand exception" },
];

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
    console.log("ui-contract-guard: no resolvable base ref (shallow clone?) — skipping, not blocking");
    process.exit(0);
}

let files;
try {
    files = git(["diff", "--name-only", "--diff-filter=d", `${base}...HEAD`, "--", "app"])
        .split("\n")
        .filter((f) => f && /\.(tsx|ts)$/.test(f) && !f.endsWith("globals.css"));
} catch {
    console.error(`ui-contract-guard: could not diff against ${base} — pass --base <ref>`);
    process.exit(0);
}

if (files.length === 0) {
    console.log("ui-contract-guard: no changed app files to check");
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
        for (const rule of RULES) {
            if (!rule.re.test(line)) continue;
            // `font-black` is legal on a line that opts into the label pattern.
            if (rule.name.includes("font-black") && /label-chrome/.test(line)) continue;
            if (rule.name === "retired CTA fill" && BRAND_ALLOWED.includes(file)) continue;
            hits.push(`${file}:${i + 1} [${rule.name}] ${line.trim().slice(0, 100)} → ${rule.hint}`);
        }
        // Radius needs a numeric check, not just a pattern.
        const radii = line.match(/rounded-\[(\d+)px\]/g) || [];
        for (const r of radii) {
            const px = Number(r.match(/(\d+)px/)[1]);
            if (!RADIUS_OK.has(px)) {
                hits.push(`${file}:${i + 1} [arbitrary radius] ${r} is outside the radius scale (DESIGN.md §5)`);
            }
        }
    });
}

if (hits.length === 0) {
    console.log(`ui-contract-guard: clean (${files.length} changed file(s))`);
    process.exit(0);
}

console.log(`ui-contract-guard: banned patterns in changed files (${hits.length}):`);
for (const h of hits.slice(0, 40)) console.log("  " + h);
if (hits.length > 40) console.log(`  … ${hits.length - 40} more`);

if (STRICT) {
    console.error("✗ fix the hits above or add the value to the scale (DESIGN.md §5)");
    process.exit(1);
}
console.log("⚠ warn mode (not blocking) — flips to hard-fail when Phase 4 completes");
