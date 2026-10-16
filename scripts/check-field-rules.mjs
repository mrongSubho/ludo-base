#!/usr/bin/env node
/**
 * check-field-rules.mjs — the text-field contract gate (DESIGN.md §6.6).
 *
 * Every <input>/<textarea> that takes free text must carry the "no OS
 * interference" set, so the OS never autofills, autocorrects, capitalises or
 * spell-marks a value the app treats as a code, address, amount or handle:
 *
 *     autoComplete="off"  autoCorrect="off"  autoCapitalize="none"  spellCheck={false}
 *
 * Two documented deviations (DESIGN.md §6.6):
 *   1. PROSE fields omit `autoCapitalize` on purpose — chat, reactions and the
 *      feedback form want the OS's sentence capitalisation. Listed below by a
 *      stable substring of the tag, not by line number.
 *   2. POSITIVE-autofill fields (OTP `one-time-code`, email `email`) override
 *      `autoComplete` only; the other three still apply.
 *
 * Non-text inputs (file, range, hidden) are out of scope.
 *
 * Usage: node scripts/check-field-rules.mjs     → exit 1 on any violation
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Prose fields: `autoCapitalize` intentionally absent. Matched by a stable
 *  substring of the field's own tag, so moving the code cannot break the list. */
const PROSE_ALLOWED = [
    { file: "RichChatField.tsx", match: "rich-field-input", why: "chat/DM composer — prose" },
    { file: "EmoteTray.tsx", match: "Write a reaction", why: "custom reaction — prose" },
    { file: "SettingsPanel.tsx", match: "Tell us what to fix next", why: "feedback form — prose" },
];

const ATTRS = ["autoComplete", "autoCorrect", "autoCapitalize", "spellCheck"];
const NON_TEXT = ['type="file"', 'type="range"', 'type="hidden"', 'type="checkbox"', 'type="radio"'];

function walk(dir) {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

const violations = [];
let checked = 0;
let allowed = 0;

for (const file of walk(join(ROOT, "app")).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(file, "utf8");
    const re = /<(input|textarea)\b/g;
    let m;
    while ((m = re.exec(src))) {
        const line = src.slice(0, m.index).split("\n").length;
        // Capture the tag, balancing {} so handler arrows don't truncate it.
        let i = m.index;
        let depth = 0;
        let tag = "";
        for (; i < src.length && i < m.index + 2000; i++) {
            const ch = src[i];
            tag += ch;
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
            else if (ch === ">" && depth === 0) break;
        }
        // A real field has attributes; the JSDoc mention in RichChatField does not.
        if (!/=(?!=)/.test(tag)) continue;
        if (NON_TEXT.some((t) => tag.includes(t))) continue;

        checked++;
        const prose = PROSE_ALLOWED.find((p) => file.endsWith(p.file) && tag.includes(p.match));
        const required = prose ? ATTRS.filter((a) => a !== "autoCapitalize") : ATTRS;
        const missing = required.filter((a) => !new RegExp(a + "=").test(tag));
        if (missing.length === 0) {
            if (prose) allowed++;
            continue;
        }
        violations.push(`${relative(ROOT, file)}:${line} missing ${missing.join(", ")}${prose ? ` (prose: ${prose.why})` : ""}`);
    }
}

if (violations.length > 0) {
    console.error(`✗ field-rule gate failed — ${violations.length} violation(s) of DESIGN.md §6.6:`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}
console.log(`✓ field-rule gate clean (${checked} text fields checked, ${allowed} documented prose exception(s))`);
