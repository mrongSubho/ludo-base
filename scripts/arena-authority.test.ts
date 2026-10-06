/**
 * The AI arena's trust boundary (Phase 3 / SEC-07).
 *
 * The arena is AI-vs-AI with no wager, but the *board* was still fully exposed:
 * `PATCH` accepted a caller-supplied `matchId`, and the authority claim was won by
 * whichever spectator's browser sent the first write. Any visitor could advance
 * the match and decide a winner.
 *
 * Now: `matchId` is derived server-side from the arena key, a session is
 * required, and only the recorded host may tick.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE_LIMITS, ruleAppliesTo, ruleFor } from '../lib/rateLimitRoutes';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

const route = code('app/api/live-arena/power4p/route.ts');
const page = code('app/page.tsx');

// ── requestedMatchId must be gone ───────────────────────────────────────────

test('SEC-07: the caller can no longer name a match', () => {
    assert.doesNotMatch(route, /requestedMatchId/, 'the client-supplied matchId must be deleted');
    assert.doesNotMatch(route, /const matchId = requestedMatchId/, 'and must not be derived from the body');
    // The only match source is the arena key, resolved server-side.
    assert.match(route, /\.eq\('arena_key', ARENA_KEY\)/);
    // Strict equality against the server constant: a caller-supplied arenaKey
    // must not be able to select a different match.
    assert.match(route, /arenaKey !== ARENA_KEY \|\| !authorityId/, 'a caller-supplied arenaKey is rejected');
});

test('SEC-07: a tick with no session is refused', () => {
    assert.match(route, /requireAppSession\(walletAddress, sessionId\)/);
    assert.match(route, /\{ error: 'Session required' \}, \{ status: 401 \}/);
    // Bootstrap also needs one — otherwise there is no host to record.
    assert.match(route, /Session required to watch the arena/);
});

test('SEC-07: only the recorded host may tick', () => {
    assert.match(route, /async function arenaHost/, 'the host is read from the match row');
    assert.match(route, /if \(host && host !== wallet\)/, 'a non-host is refused');
    assert.match(route, /reason: 'NOT_HOST'/, 'and told why, for the UI to stop retrying');
    assert.match(route, /\{ status: 403 \}/);
    // The placeholder host must not be treated as a real wallet.
    assert.match(route, /host !== 'ai-arena'/, 'the placeholder is not a host');
});

test('SEC-07: the host is a real wallet recorded at bootstrap', () => {
    assert.doesNotMatch(route, /host_address: 'ai-arena'/, 'the placeholder must be gone');
    assert.match(route, /host_address: wallet/);
    // Both rows agree, so the Edge boundary and this route read the same host.
    assert.equal((route.match(/host_address: wallet/g) || []).length, 2);
});

test('SEC-07: the tick is rate-limited even when called directly', () => {
    assert.match(route, /checkRateLimit\(/);
    assert.match(route, /status: 429,/, 'the direct-call bound returns 429');
});

// ── The client must honour the gate rather than hammering it ───────────────

test('the client passes its session on both calls', () => {
    // The POST builds its query with URLSearchParams, so assert on the params.
    const params = /new URLSearchParams\(\{[\s\S]*?sessionId: sid[\s\S]*?\}\)/.exec(page);
    assert.ok(params, 'the bootstrap query must carry a session');
    assert.match(page, /walletAddress: address\.toLowerCase\(\)/);
    assert.match(page, /sessionId: sid/, 'the PATCH body must carry a session');
});

test('a non-host spectator never sends a tick', () => {
    assert.match(page, /if \(!arenaIsHost \|\| !address\) return;/, 'the tick effect must bail for non-hosts');
    assert.match(page, /setArenaIsHost\(Boolean\(data\.isHost\)\)/);
});

test('the client cannot name a match either', () => {
    // Scoped to the tick body: `matchId` legitimately appears elsewhere in
    // page.tsx for real matches.
    const tick = page.slice(page.indexOf("arenaKey: 'power4p-ai'"));
    assert.doesNotMatch(tick.slice(0, 400), /matchId/, 'no matchId in the arena PATCH body');
    assert.match(page, /arenaKey: 'power4p-ai'/);
});

// ── The route table still classifies this route ────────────────────────────

test('the arena remains bounded by the shared limiter', () => {
    // SEC-34 already limits PATCH here; SEC-07 makes the limit secondary to the
    // host check. Both must hold.
    const rule = ruleFor('live-arena/power4p');
    assert.ok(rule, 'the arena must stay in the rate-limit table');
    assert.equal(ruleAppliesTo(rule, 'PATCH'), true);
    assert.equal(RATE_LIMITS['live-arena/power4p'].limit, 40);
});
