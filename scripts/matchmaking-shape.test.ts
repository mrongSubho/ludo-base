import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('MM-10: status route takes the session from a header only, and the hook never puts it in a URL', () => {
    const statusSrc = read('app/api/matchmaking/status/route.ts');
    const hookSrc = read('hooks/useMatchmaking.ts');
    const authSrc = read('lib/serverAuth.ts');

    // P3: the session is a bearer credential. The query-string form was removed
    // (it leaked into access logs, browser history and `Referer`), so the only
    // accepted sources are the `x-session-id` header and `Authorization: Bearer`.
    assert.doesNotMatch(
        statusSrc,
        /searchParams\.get\(\s*['"`]sessionId['"`]\s*\)/,
        'the status route must not read sessionId from the query string',
    );
    assert.match(statusSrc, /request\.headers\.get\('x-session-id'\)/);
    assert.match(statusSrc, /authHeader\.slice\(7\)\.trim\(\)/);
    assert.match(statusSrc, /requireAppSession\(expectedWallet,\s*sessionId\)/);
    assert.match(statusSrc, /matches[\s\S]{0,100}participants/);

    // requireAppSession can resolve wallet directly when expectedWallet is omitted
    assert.match(authSrc, /(!wallet\s*\|\|\s*session\.wallet_address\.toLowerCase\(\)\s*===\s*wallet)/);

    // The hook sends the session as a header and never in the query string.
    assert.doesNotMatch(
        hookSrc,
        /params\.set\(\s*['"`]sessionId['"`]/,
        'the hook must not put sessionId in the query string',
    );
    assert.match(hookSrc, /sessionAuthHeaders\(sessionId\)/);
    // …and the helper itself emits both header forms.
    assert.match(hookSrc, /'x-session-id':\s*sessionId/);
    assert.match(hookSrc, /'Authorization':\s*`Bearer \$\{sessionId\}`/);
    assert.match(hookSrc, /dispatchMatch\(typedData\.match_id,[\s\S]{0,80}typedData\.players\)/);
    assert.match(hookSrc, /dispatchMatch\(data\.match_id,[\s\S]{0,80}data\.participants\)/);
});

test('P3: no route anywhere reads sessionId from the query string', () => {
    // The same invariant `scripts/check-routes.mjs` enforces across all 53
    // routes, kept here so a regression fails the suite and not just CI.
    const apiDir = join(root, 'app/api');
    const offenders: string[] = [];
    const walk = (dir: string, prefix: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) walk(p, prefix ? `${prefix}/${e.name}` : e.name);
            else if (e.name === 'route.ts') {
                const src = readFileSync(p, 'utf8');
                if (/searchParams\.get\(\s*['"`]sessionId['"`]\s*\)/.test(src)) {
                    offenders.push(prefix || 'root');
                }
            }
        }
    };
    walk(apiDir, '');
    assert.deepEqual(offenders, [], `routes reading sessionId from the query string: ${offenders.join(', ')}`);
});

test('P3: P2P lobby/join host poll is retired from TeamUpContext in Phase S4', () => {
    const ctx = read('hooks/TeamUpContext.tsx');
    assert.doesNotMatch(
        ctx,
        /['"]\/api\/lobby\/join['"]/,
        'TeamUpContext no longer polls /api/lobby/join',
    );
});



// ── MM-12: the matchmaking credential must survive the whole join chain ────
//
// Reported live: after a 1v1 quick match both devices sat on the Match! panel
// forever, the host showing "Opponent hasn't linked yet…". Verified against the
// database rather than guessed: the match row, both queue tickets and the
// `lobby_join_policies` hash were all correct, and the guest's REST join request
// was stored WITH the right token — the host simply never read it.
//
// Two independent breaks, both of which had to fire for the stall:
//   1. the `match-found` broadcast carries only {matchId, roomCode}, so the
//      guest dispatched with no token and the host's matchmaking door rejected
//      the token-less JOIN_REQUEST;
//   2. the host's REST poll selected no `validation_token`, so even the stored
//      credential never reached `seatGuestPlayer`.

test('MM-12: dispatchMatch resolves the validation_token instead of dispatching without it', () => {
    const src = read('hooks/useMatchmaking.ts');
    // The broadcast is a public topic, so the token must be fetched, not broadcast.
    assert.match(
        src,
        /if \(!token \|\| !players \|\| players\.length === 0\) \{[\s\S]{0,900}?validation_token/,
        'dispatchMatch must resolve the token from the status route when the caller has none',
    );
    assert.match(src, /onMatchFoundRef\.current\(matchId, roomCode, isHost, token \?\? undefined\)/,
        'the resolved token must reach onMatchFound');
    // And it must say so loudly rather than fail silently at the host.
    assert.match(src, /No validation_token resolved/);
});

test('MM-12: the lobby/join GET returns the stored credential', () => {
    const src = read('app/api/lobby/join/route.ts');
    // The POST stores it; the GET must hand it back or the host cannot seat.
    assert.match(src, /validation_token:\s*secret \? secret\.trim\(\)\.toLowerCase\(\) : null/,
        'POST must persist the credential');
    assert.match(
        src,
        /\.select\('id, room_code, wallet_address, username, avatar_url, desired_seat, validation_token, created_at'\)/,
        'GET must select validation_token',
    );
});

test('MM-12: P2P seatGuestPlayer formation is retired from client in Phase S4', () => {
    const ctx = read('hooks/TeamUpContext.tsx');
    assert.ok(
        !ctx.includes('seatGuestPlayer'),
        'seatGuestPlayer must not exist in client TeamUpContext; seating is server-authoritative via assign_match_seats',
    );
});

// ── MM-13: a guest adopts the host's roster, it never mints its own ────────
//
// Reported live after MM-12 landed: the match now forms and the board appears,
// but device A showed "me + a generic Player seat" while device B showed "two
// random bots" — two different tables on two devices.
//
// `joinGame` does not call `initQuickLobby`, so a guest's `lobbyState` is still
// null when QuickMatchPanel fires `onStartGame`; it only arrives later via the
// host's LOBBY_SYNC. That sent the guest down the offline/bot branch, which
// calls `shufflePlayers(...)` on `Math.random()` — minting a second, random
// roster. The host's broadcast is the only authority on who is seated.

// ── MM-13: Server-owned lobby total predicate (§6.7) ──────────────────────
//
// Replaces the legacy P2P host/guest branching with a total predicate:
// a match is either local/bot or networked. In a networked match, the server
// room DO is the sole authority for roster, seats, and seeding.

test('MM-13: handlePlayNow uses server-owned total predicate (§6.7)', () => {
    const src = read('app/page.tsx');
    assert.match(src, /const isLocalMatch =\s*effectiveIsBotMatch \|\|\s*!currentMatchId \|\|\s*currentMatchId === 'local' \|\|\s*currentMatchId\.startsWith\('local-'\);/);
    assert.match(src, /ARM 1: OFFLINE \/ BOT \/ LOCAL MATCH/);
    assert.match(src, /ARM 2: NETWORKED MATCH \(Server room DO is sole authority\)/);
    assert.match(src, /connectRoom\(currentMatchId\);/);
    assert.match(src, /setAppState\('game'\);/);
});

// ── MM-15: the auto-navigate effect must not bypass the roster gate ────────
//
// Reported after MM-13/MM-14: the match reaches the board, device A shows the
// correct roster, device B shows "a random bot player", and nobody can roll.
//
// MM-13 gated `handlePlayNow`, but page.tsx has a SECOND way onto the board: a
// "missed START_GAME" recovery effect that navigates as soon as `isStarted` OR
// `lobbyState.status === 'playing'`. That bypassed `handlePlayNow` entirely, so
// the guest's `boardSeed` stayed null, `Board` mounted with `initialPlayers`
// undefined, and its `shufflePlayers` fallback invented a random table. The
// `status === 'playing'` half is the usual trigger — LOBBY_SYNC lands before
// START_GAME.

test('MM-15: the game-start recovery effect gates the guest on the host roster', () => {
    const src = read('app/page.tsx');
    // Locate the effect by its recovery-path comment, then check the guard.
    const at = src.indexOf('TeamUp Game Start Sync');
    assert.ok(at > 0, 'the game-start sync effect must exist');
    const effect = src.slice(at, at + 2000);
    assert.match(effect, /if \(!isHost\) \{/);
    assert.match(effect, /const roster = gameState\?\.initialBoardConfig\?\.players/);
    assert.match(effect, /guest start pending — waiting for the host roster/);
    // It must set boardSeed before navigating, or Board still has nothing.
    assert.ok(
        effect.indexOf('setBoardSeed(') < effect.indexOf("setAppState('game')"),
        'boardSeed must be set before navigating to the board',
    );
    // And the roster must be in the dep array, or the wait never lifts.
    assert.match(
        src,
        /\[gameState\?\.isStarted, gameState\?\.isBotMatch, gameState\?\.initialBoardConfig, lobbyState\?\.status, appState, isHost\]/,
    );
});

test('MM-15: Board announces rather than silently inventing a networked roster', () => {
    const src = read('app/components/Board.tsx');
    assert.match(src, /no roster supplied — seeding a local table/);
    assert.match(src, /In a networked match this means START_GAME arrived without initialBoardConfig/);
});

// ── D2: a room that cannot connect must be visible, not silent ─────────────
//
// The plan's D2 decision: remove the silent P2P fallback, fail loudly with
// "Unable to connect to game room — retrying…". It was never implemented, which
// is why an unreachable room endpoint presented as an indefinite
// "Still linking both players…" with no error anywhere.
//
// This matters concretely: `/api/room/:matchId/ws` is served only by
// `src/worker.ts` (the Cloudflare Worker entry). There is no `app/api/room`
// Next route, so a plain Next host — dev server, Vercel — 404s the socket. The
// only observable difference used to be a match that never started.

test('D2: connectRoom surfaces a failed room instead of reverting to host authority', () => {
    // Strip comments first: the removal is documented in place, so a raw grep for
    // the old wording matches its own explanation and the assertion becomes a
    // tautology. Same trap as the relay gate — see relay-hardening.test.ts.
    const ctx = read('hooks/TeamUpContext.tsx')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');
    // The old behaviour, which the plan removed.
    assert.doesNotMatch(ctx, /host remains the authority/,
        'the silent P2P fallback must not come back');
    // The new signal.
    assert.match(ctx, /setRoomStatus\('failed'\)/);
    assert.match(ctx, /setRoomStatus\('connecting'\)/);
    assert.match(ctx, /setRoomStatus\('connected'\)/);
    assert.match(ctx, /roomStatus: 'idle' \| 'connecting' \| 'connected' \| 'failed'/);
});

test('D2: the room retries with backoff and gives up visibly', () => {
    const ctx = read('hooks/TeamUpContext.tsx');
    assert.match(ctx, /const retryRoom = useCallback/, 'a retry entry point must exist');
    assert.match(ctx, /roomClientRef\.current\?\.disconnect\(\)/, 'a failed client must be torn down before retrying');
    assert.match(ctx, /roomAttemptsRef\.current >= 5/, 'retries must be bounded');
    assert.match(ctx, /giving up after 5 attempts/);
});

test('D2: the panel shows the room error, not a generic wait', () => {
    const panel = read('app/components/QuickMatchPanel.tsx');
    assert.match(panel, /Unable to connect to game room — retrying/);
    // It must win over the p2pHost branch, or the host still reads "opponent hasn't linked".
    const idx = panel.indexOf("roomStatus === 'failed'");
    const p2p = panel.indexOf("p2pHost\n");
    assert.ok(idx > 0, 'the failed branch must exist');
    assert.ok(idx < panel.indexOf("Opponent hasn’t linked yet") || p2p === -1 || idx < p2p,
        'the failed branch must be evaluated before the p2pHost branch');
});
