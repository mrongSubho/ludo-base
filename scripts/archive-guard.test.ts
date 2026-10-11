/**
 * Archive deny rule (Phase 3 / DB-08).
 *
 * New SQL goes in supabase/migrations/ (canonical) only. The two archive
 * dirs — root migrations/ and supabase/migrations_archive/ — are frozen
 * history: every file there must carry the ARCHIVED header, and no canonical
 * migration may carry it (archives must not leak back into the live chain).
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '-- ARCHIVED';

const archiveFiles = (dir: string): string[] =>
    readdirSync(join(root, dir))
        .filter((f) => f.endsWith('.sql'))
        .map((f) => join(dir, f));

const archives = [...archiveFiles('migrations'), ...archiveFiles('supabase/migrations_archive')];

test('DB-08: every archive file carries the frozen-history header', () => {
    assert.ok(archives.length >= 30, `expected the archive dirs to hold history, found ${archives.length}`);
    const missing: string[] = [];
    for (const f of archives) {
        const head = readFileSync(join(root, f), 'utf8').split('\n').slice(0, 5).join('\n');
        if (!head.includes(MARKER)) missing.push(f);
    }
    assert.deepEqual(missing, [], `archive files without the ARCHIVED header:\n${missing.join('\n')}`);
});

test('DB-08: the canonical chain carries no archive marker', () => {
    // Guards against copy-pasting an archived function back into a live
    // migration without noticing where it came from.
    const leaked: string[] = [];
    for (const f of readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'))) {
        const src = readFileSync(join(root, 'supabase', 'migrations', f), 'utf8');
        if (src.includes(MARKER)) leaked.push(f);
    }
    assert.deepEqual(leaked, [], `canonical migrations carrying the ARCHIVED marker:\n${leaked.join('\n')}`);
});
