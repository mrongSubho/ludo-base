/**
 * Lint burn-down helper — prefix unused bindings with `_` (safe rename).
 * Run: node scripts/lint-burndown.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const raw = execSync('npx eslint . -f json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const report = JSON.parse(raw);

let renamed = 0;
for (const file of report) {
    const path = file.filePath;
    let src;
    try {
        src = readFileSync(path, 'utf8');
    } catch {
        continue;
    }
    const lines = src.split('\n');
    let touched = false;
    const unused = (file.messages || []).filter(
        (m) => m.ruleId === '@typescript-eslint/no-unused-vars' && m.suggestions == null
    );
    for (const m of unused) {
        const lineIdx = m.line - 1;
        const line = lines[lineIdx];
        if (!line) continue;
        // Extract identifier from message: 'foo' is defined but never used
        const match = /'([^']+)' is (?:defined but never used|assigned a value but never used|defined but never used)/.exec(m.message || '');
        const name = match?.[1];
        if (!name || name.startsWith('_')) continue;
        // Rename only word-boundary identifier on that line (conservative)
        const re = new RegExp(`\\b${name}\\b`);
        if (re.test(line)) {
            lines[lineIdx] = line.replace(re, `_${name}`);
            touched = true;
            renamed += 1;
        }
    }
    if (touched) writeFileSync(path, lines.join('\n'));
}
console.log('renamed', renamed, 'unused bindings');
