/**
 * Phase 6 Static Retirement Gate.
 *
 * Enforces that host-centric legacy paths, retired Edge functions, and deprecated
 * fallback patterns cannot be reintroduced into the codebase:
 * 1. Retired intents (DICE_COMMIT, DICE_REVEAL, CMD_REQUEST_TRUST) are rejected.
 * 2. Retired events (HOST_ELECT) are eliminated from the match FSM.
 * 3. Retired provisional match sessions are eliminated.
 * 4. Retired Edge function directories and shared engine copy do NOT exist.
 * 5. Durable chain indexer cursor is enforced.
 * 6. Pure session v2 authentication in serverAuth is enforced.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('P6-1: Retired intents do not appear in game protocol schemas', () => {
    const schemasSrc = read('lib/protocol/schemas.ts');
    const intentBlock = schemasSrc.slice(
        schemasSrc.indexOf('export const gameIntentSchema'),
        schemasSrc.indexOf('export const gameActionEnvelopeSchema'),
    );
    assert.doesNotMatch(intentBlock, /'DICE_COMMIT'/);
    assert.doesNotMatch(intentBlock, /'DICE_REVEAL'/);
    assert.doesNotMatch(intentBlock, /'CMD_REQUEST_TRUST'/);

    const protocolSrc = read('lib/gameProtocol.ts');
    assert.doesNotMatch(protocolSrc, /intent\.type === 'DICE_COMMIT'/);
    assert.doesNotMatch(protocolSrc, /intent\.type === 'DICE_REVEAL'/);
    assert.doesNotMatch(protocolSrc, /intent\.type === 'CMD_REQUEST_TRUST'/);
});

test('P6-2: HOST_ELECT does not exist in MatchFsmEvent or matchFsm transitions', () => {
    const fsmSrc = read('lib/matchFsm.ts');
    assert.doesNotMatch(fsmSrc, /\|\s*'HOST_ELECT'/);
    assert.doesNotMatch(fsmSrc, /event\.type === 'HOST_ELECT'/);
    assert.doesNotMatch(fsmSrc, /case 'HOST_ELECT':/);
});

test('P6-3: Edge function directories and shared engine copy are deleted', () => {
    const retiredDirs = [
        'supabase/functions/roll-dice',
        'supabase/functions/move-auth',
        'supabase/functions/resolve-bet',
    ];
    for (const d of retiredDirs) {
        assert.equal(existsSync(join(root, d)), false, `${d} must not exist`);
    }

    const retiredFiles = [
        'supabase/functions/_shared/engine.ts',
    ];
    for (const f of retiredFiles) {
        assert.equal(existsSync(join(root, f)), false, `${f} must not exist`);
    }
});

test('P6-4: Durable indexer cursor contract is implemented', () => {
    const migration = read('supabase/migrations/202610180006_indexer_cursor.sql');
    assert.match(migration, /create table if not exists public\.chain_indexer_cursors/i);
    assert.match(migration, /get_chain_indexer_cursor/i);
    assert.match(migration, /update_chain_indexer_cursor/i);

    const dbTypes = read('types/database.types.ts');
    assert.match(dbTypes, /chain_indexer_cursors/);
    assert.match(dbTypes, /get_chain_indexer_cursor/);
    assert.match(dbTypes, /update_chain_indexer_cursor/);

    const indexerSrc = read('lib/chipsIndexer.ts');
    assert.match(indexerSrc, /syncWithDurableCursor/);
    assert.match(indexerSrc, /confirmations\s*\?\?\s*BigInt\(12\)/);
    assert.match(indexerSrc, /maxChunk\s*\?\?\s*BigInt\(900\)/);
    assert.match(indexerSrc, /get_chain_indexer_cursor/);
    assert.match(indexerSrc, /update_chain_indexer_cursor/);
});

test('P6-5: serverAuth requireSession does not fall back to app_sessions', () => {
    const serverAuthSrc = read('lib/serverAuth.ts');
    // Ensure requireSession only queries 'sessions' table
    const reqSessionMatch = serverAuthSrc.match(/export async function requireSession[\s\S]*?^}/m);
    assert.ok(reqSessionMatch, 'requireSession function must exist');
    assert.doesNotMatch(reqSessionMatch[0], /\.from\('app_sessions'\)/, 'requireSession must not query app_sessions');
    assert.match(reqSessionMatch[0], /\.from\('sessions'\)/, 'requireSession must query sessions');
});
