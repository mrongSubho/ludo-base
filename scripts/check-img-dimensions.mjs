/**
 * Image-dimensions gate — CSS_LAYOUT_ANIMATION_PLAN.md §3.1 (P0/S) + §6.
 *
 * Finding G5: 23 files render raw <img> with no intrinsic dimensions. An image
 * whose size the browser only learns after decode reflows its surroundings
 * (CLS — plan §6 target: ≤ 0.05 in-game). The fix is the classic one: every
 * image carries width/height (attributes or inline style), so the browser
 * reserves the correct box before the bytes arrive. Where CSS already sizes
 * the element (Tailwind w-full h-full, .chat-rich-emote, …) the attributes
 * are overridden and purely declare the intrinsic ratio — harmless metadata
 * that keeps the gate honest and the audit complete.
 *
 * Scope: app/**\/*.tsx. next/image is not scanned (it has its own contract).
 * Tailwind class names cannot be resolved statically, so the gate accepts
 * HTML width/height attributes or a style object with numeric width+height —
 * the two forms a static check can verify without guessing.
 *
 * Allowlist-shaped like check-motion.mjs: KNOWN entries are documented
 * exceptions (none today); anything new fails.
 *
 * Usage:  node scripts/check-img-dimensions.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');

/** Documented exceptions: file -> why a raw <img> is allowed without dimensions. */
const KNOWN = new Map([
    // (none — every site in the 2026-10-13 pass carries width/height or style dims)
]);

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

const tsxFiles = walk(join(root, 'app')).filter((f) => extname(f) === '.tsx');

/**
 * Extract raw <img …> tags. A naive /<img\b[^>]*>/ breaks on arrow functions
 * inside braces (onError={(e) => …}), so scan the tag tracking brace depth
 * and quotes; a '>' only ends the tag at brace depth 0 outside quotes.
 */
function extractImgTags(src) {
    const tags = [];
    let i = 0;
    for (;;) {
        i = src.indexOf('<img', i);
        if (i === -1) break;
        let j = i + 4;
        let depth = 0;
        let quote = null;
        let end = -1;
        for (; j < src.length; j++) {
            const ch = src[j];
            if (quote) {
                if (ch === quote) quote = null;
                continue;
            }
            if (ch === '"' || ch === "'") { quote = ch; continue; }
            if (ch === '{') depth++;
            else if (ch === '}') { if (depth > 0) depth--; }
            else if (ch === '>' && depth === 0) { end = j; break; }
        }
        if (end === -1) break; // unterminated — let the parser gate catch it
        tags.push({ text: src.slice(i, end + 1), index: i });
        i = end + 1;
    }
    return tags;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

let total = 0;
const violations = [];

for (const file of tsxFiles) {
    const rel = relative(root, file);
    const src = readFileSync(file, 'utf8');
    for (const tag of extractImgTags(src)) {
        total++;
        const hasWidthAttr = /\bwidth\s*=/.test(tag.text);
        const hasHeightAttr = /\bheight\s*=/.test(tag.text);
        const styleM = tag.text.match(/style=\{\{([\s\S]*?)\}\}/);
        const styleSized = !!styleM && /\bwidth\s*:/.test(styleM[1]) && /\bheight\s*:/.test(styleM[1]);
        const sized = (hasWidthAttr && hasHeightAttr) || styleSized;
        if (!sized && !KNOWN.has(rel)) {
            violations.push(`${rel}:${lineOf(src, tag.index)}: <img> without width/height (attributes or style) — plan §3.1`);
        }
    }
}

console.log(`img-dimensions gate: ${total} raw <img> across ${tsxFiles.length} tsx files`);
if (violations.length > 0) {
    for (const v of violations) console.log(`✗ ${v}`);
    console.log(`✗ img-dimensions gate failed: ${violations.length} raw <img> without intrinsic dimensions — add width/height (CSS-sized elements: the attributes declare the ratio and are overridden)`);
    process.exit(1);
}
console.log('✓ img-dimensions gate clean (every raw <img> reserves its box before decode)');
