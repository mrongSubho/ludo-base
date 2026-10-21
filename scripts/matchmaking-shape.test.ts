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
    assert.match(routeSrc, /const\s+ALLOWED_MODES\s*=\s*new\s+Set\(\['classic',\s*'power'\]\)/);
    assert.match(routeSrc, /const\s+ALLOWED_TYPES\s*=\s*new\s+Set\(\['1v1',\s*'2v2',\s*'4P'\]\)/);
    // Asserts that invalid modes/types are rejected with 400
    assert.match(routeSrc, /if\s*\(!ALLOWED_MODES\.has\(gameMode\)\s*\|\|\s*!ALLOWED_TYPES\.has\(matchType\)\)/);
    assert.match(routeSrc, /return\s+NextResponse\.json\(\{\s*error:\s*'Invalid gameMode or matchType'\s*\},\s*\{\s*status:\s*400\s*\}\)/);
});

test('MM-2: useMatchmaking cancel includes sessionId for authentication', () => {
    const hookSrc = read('hooks/useMatchmaking.ts');

    // The queue cancel must resolve an app session and carry it, or the route's
    // requireAppSession() 401s and the ticket is never cancelled (it only expires).
    assert.match(hookSrc, /const\s+sessionId\s*=\s*await\s+ensureAppSession\(\)/);
    assert.match(hookSrc, /ticketId:\s*allForPlayer\s*\?\s*null\s*:\s*currentTicketId,[\s\S]{0,120}sessionId/);

    // MM-5 removed the parallel Edge matcher, so the orphan-ticket race it used to
    // guard no longer exists — there is no second queue to lose to.
    assert.doesNotMatch(hookSrc, /attemptEdgeInBackground|getEdgeClient/);
});

test('MO-2: spectator view derives dynamic shape and mode from loaded match record', () => {
    const pageSrc = read('app/page.tsx');
    
    // Asserts dynamic player count
    assert.match(pageSrc, /playerCount=\{spectatorGameState\?\.playerCount\s*\|\|\s*"4P"\}/);
    // Asserts dynamic mode based on powerTiles presence
    assert.match(pageSrc, /gameMode=\{\(spectatorGameState\?\.powerTiles\?\.length\s*\?\?\s*0\)\s*>\s*0\s*\?\s*"power"\s*:\s*"classic"\}/);
});

test('MM-6: validation_token is shared across participants in join and status routes', () => {
    const statusSrc = read('app/api/matchmaking/status/route.ts');
    const joinSrc = read('app/api/matchmaking/join/route.ts');

    // Asserts status route looks up sibling token on matched ticket
    assert.match(statusSrc, /ticket\.status\s*===\s*'matched'/);
    assert.match(statusSrc, /\.eq\('match_id',\s*ticket\.match_id\)/);
    assert.match(statusSrc, /\.not\('validation_token',\s*'is',\s*null\)/);

    // Asserts join route checks for existing sibling token
    assert.match(joinSrc, /\.eq\('match_id',\s*data\.match_id\)/);
    assert.match(joinSrc, /\.not\('validation_token',\s*'is',\s*null\)/);
});

test('MM-7: heartbeat polls ticket status without re-invoking join RPC', () => {
    const hookSrc = read('hooks/useMatchmaking.ts');

    // Heartbeat tick checks current ticket status without calling joinSupabase
    assert.match(hookSrc, /const\s+heartbeatTick\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{/);
    assert.match(hookSrc, /await\s+checkTicketStatus\(currentId\)/);
    assert.doesNotMatch(hookSrc, /heartbeatTick[\s\S]{0,100}joinSupabase/);
});

test('MM-8: hybrid matchmaking migration advertises party ticket and hunts waiters', () => {
    const sql = read('supabase/migrations/202610210001_fix_hybrid_matchmaking.sql');

    assert.match(sql, /create or replace function public\.join_matchmaking_hybrid/);
    assert.match(sql, /where\s+player_id\s*=\s*p_player_id\s+and\s+status\s*=\s*'searching'/);
    assert.match(sql, /room_code\s+is\s+null/);
    assert.match(sql, /array\[p_player_id,\s*v_opponent_id\]/);
});

test('MM-9: TeamUpContext.startQuickMatch passes session and resolves host deterministically', () => {
    const contextSrc = read('hooks/TeamUpContext.tsx');

    assert.match(contextSrc, /const\s+sessionId\s*=\s*await\s+ensureAppSession\(\)/);
    assert.match(contextSrc, /sessionId,/);
    assert.match(contextSrc, /hash\(match_id\)|charCodeAt/);
});

