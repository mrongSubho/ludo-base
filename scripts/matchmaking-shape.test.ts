import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('MM-1: migration SQL implements shape-aware table formation and caller ticket insertion', () => {
    const sql = read('supabase/migrations/202610200001_matchmaking_shape_aware.sql');
    
    // Asserts slots_needed calculation in SQL
    assert.match(sql, /slots_needed\s*:=\s*case\s+when\s+p_match_type\s+in\s*\('2v2',\s*'4P'\)\s+then\s+4\s+else\s+2\s+end/);
    assert.match(sql, /opponents_needed\s*:=\s*slots_needed\s*-\s*1/);
    assert.match(sql, /limit\s+opponents_needed/);
    assert.match(sql, /cardinality\(opponents_found\.player_ids\)\s*=\s*opponents_needed/);
    
    // Asserts that the caller's ticket is inserted with 'matched' status so all participants exist in matchmaking_queue
    assert.match(sql, /insert\s+into\s+public\.matchmaking_queue\([^)]*status[^)]*match_id[^)]*room_code[^)]*\)/);
    assert.match(sql, /values\s*\([^)]*'matched',\s*m,\s*room\)/);
    assert.match(sql, /'ticket_id',\s*q/);
});

test('MM-4: /api/matchmaking/join enforces runtime whitelist boundary on mode and shape', () => {
    const routeSrc = read('app/api/matchmaking/join/route.ts');
    
    // Asserts route defines ALLOWED_MODES and ALLOWED_TYPES sets
    assert.match(routeSrc, /const\s+ALLOWED_MODES\s*=\s*new\s+Set\(\['classic',\s*'power',\s*'snakes'\]\)/);
    assert.match(routeSrc, /const\s+ALLOWED_TYPES\s*=\s*new\s+Set\(\['1v1',\s*'2v2',\s*'4P'\]\)/);
    // Asserts that invalid modes/types are rejected with 400
    assert.match(routeSrc, /if\s*\(!ALLOWED_MODES\.has\(gameMode\)\s*\|\|\s*!ALLOWED_TYPES\.has\(matchType\)\)/);
    assert.match(routeSrc, /return\s+NextResponse\.json\(\{\s*error:\s*'Invalid gameMode or matchType'\s*\},\s*\{\s*status:\s*400\s*\}\)/);
});

test('MM-2: useMatchmaking cancel includes sessionId for authentication', () => {
    const hookSrc = read('hooks/useMatchmaking.ts');
    
    // Asserts that orphan ticket cancellation resolves app session and includes sessionId
    assert.match(hookSrc, /ensureAppSession\(\)/);
    assert.match(hookSrc, /ticketId:\s*tid,\s*playerId:\s*null,\s*sessionId:\s*sId/);
    
    // Asserts that user-initiated cancelSearch also passes sessionId
    assert.match(hookSrc, /const\s+sessionId\s*=\s*await\s+ensureAppSession\(\)/);
    assert.match(hookSrc, /sessionId\s*\n\s*\}\)/);
});

test('MO-2: spectator view derives dynamic shape and mode from loaded match record', () => {
    const pageSrc = read('app/page.tsx');
    
    // Asserts dynamic player count
    assert.match(pageSrc, /playerCount=\{spectatorGameState\?\.playerCount\s*\|\|\s*"4P"\}/);
    // Asserts dynamic mode based on powerTiles presence
    assert.match(pageSrc, /gameMode=\{\(spectatorGameState\?\.powerTiles\?\.length\s*\?\?\s*0\)\s*>\s*0\s*\?\s*"power"\s*:\s*"classic"\}/);
});
