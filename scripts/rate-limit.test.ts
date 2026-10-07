/**
 * Rate limiting (Phase 3 / SEC-34, SEC-08, SEC-27, SEC-28).
 *
 * Two parts. The limiter itself is executed and tested directly. The *route
 * table* is a security decision, so it is pinned structurally: the point of
 * SEC-34 is that no unauthenticated route is left unlimited by accident, and
 * that no heartbeat route is limited by accident. Both failures are silent —
 * one is an unbounded bill, the other looks like an outage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    checkRateLimit,
    clientIp,
    rateKey,
    rateLimitHeaders,
    resetRateLimits,
} from '../lib/rateLimit';
import { NEVER_LIMIT, RATE_LIMITS, SESSION_GATED, ruleAppliesTo, ruleFor } from '../lib/rateLimitRoutes';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/** Source with comments stripped, so a comment naming a header is not a use. */
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

// ── The limiter ─────────────────────────────────────────────────────────────

test('a caller is allowed exactly `limit` requests, then refused', () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 1; i <= 3; i++) {
        const v = checkRateLimit('k', 3, 60_000, now);
        assert.equal(v.ok, true, `request ${i} must be allowed`);
        assert.equal(v.remaining, 3 - i);
    }
    const denied = checkRateLimit('k', 3, 60_000, now);
    assert.equal(denied.ok, false);
    assert.equal(denied.remaining, 0);
    assert.ok(denied.retryAfterSec >= 1, 'a refusal must say when to come back');
});

test('the window slides: a hit expires, freeing the budget', () => {
    resetRateLimits();
    const t0 = 1_000_000;
    checkRateLimit('slide', 2, 10_000, t0);
    checkRateLimit('slide', 2, 10_000, t0 + 1_000);
    assert.equal(checkRateLimit('slide', 2, 10_000, t0 + 2_000).ok, false);
    // First hit falls out of the 10s window at t0+10_000.
    assert.equal(checkRateLimit('slide', 2, 10_000, t0 + 10_001).ok, true);
});

test('keys are independent', () => {
    resetRateLimits();
    for (let i = 0; i < 5; i++) checkRateLimit('a', 5, 60_000, 0);
    assert.equal(checkRateLimit('a', 5, 60_000, 0).ok, false);
    assert.equal(checkRateLimit('b', 5, 60_000, 0).ok, true, 'one caller must not starve another');
});

test('a misconfigured limit refuses rather than allowing everything', () => {
    resetRateLimits();
    for (const bad of [0, -1, NaN, Infinity]) {
        assert.equal(checkRateLimit('bad', bad, 60_000, 0).ok, false, `limit=${bad} must not open the gate`);
    }
    assert.equal(checkRateLimit('', 5, 60_000, 0).ok, false, 'an empty key must not be a free pass');
});

test('rate-limit headers carry the standard shape, and Retry-After only on refusal', () => {
    const ok = rateLimitHeaders({ ok: true, remaining: 4, resetMs: 60_000 });
    assert.equal(ok['X-RateLimit-Remaining'], '4');
    assert.equal(ok['X-RateLimit-Reset'], '60');
    assert.equal('Retry-After' in ok, false, 'a success must not advertise a retry');

    const denied = rateLimitHeaders({ ok: false, remaining: 0, resetMs: 30_000, retryAfterSec: 30 });
    assert.equal(denied['Retry-After'], '30');
});

test('rateKey scopes by route so one noisy path cannot starve another', () => {
    assert.notEqual(rateKey('api:friends', '1.2.3.4'), rateKey('api:farcaster', '1.2.3.4'));
    assert.equal(rateKey('api:friends', '1.2.3.4'), rateKey('api:friends', '1.2.3.4'));
});

// ── Client IP: the spoofable header must not win ────────────────────────────

test('SEC-27: the platform IP beats a client-supplied x-forwarded-for', () => {
    const h = (m: Record<string, string>) => ({ headers: new Headers(m) });
    assert.equal(clientIp(h({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' })), '1.1.1.1');
    assert.equal(clientIp(h({ 'x-vercel-forwarded-for': '2.2.2.2' })), '2.2.2.2');
    assert.equal(clientIp(h({ 'fly-client-ip': '3.3.3.3' })), '3.3.3.3');
    assert.equal(clientIp(h({ 'x-real-ip': '4.4.4.4' })), '4.4.4.4');
});

test('SEC-27: a spoofed x-forwarded-for prefix cannot become the key', () => {
    // Anyone can send `x-forwarded-for`. The spoofable value is the FIRST entry,
    // so the last is used — the one a real proxy appended.
    const spoof = { headers: new Headers({ 'x-forwarded-for': '6.6.6.6, 5.5.5.5' }) };
    assert.equal(clientIp(spoof), '5.5.5.5');
    assert.notEqual(clientIp(spoof), '6.6.6.6');
});

test('a request with no IP at all still gets a stable bucket', () => {
    assert.equal(clientIp({ headers: new Headers({}) }), 'unknown');
});

// ── The route table ─────────────────────────────────────────────────────────

test('every listed route is a real route file', () => {
    for (const key of Object.keys(RATE_LIMITS)) {
        assert.ok(
            existsSync(join(root, 'app', 'api', key, 'route.ts')),
            `RATE_LIMITS names "${key}" but app/api/${key}/route.ts does not exist`,
        );
    }
});

test('every real /api route is either limited or explicitly exempt', () => {
    // This is the SEC-34 property: no unauthenticated route is unlimited by
    // accident. A new route must be classified, deliberately.
    const dir = join(root, 'app', 'api');
    const routes: string[] = [];
    const walk = (d: string, prefix = '') => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.name.startsWith('.')) continue;
            if (e.isDirectory()) walk(join(d, e.name), `${prefix}${e.name}/`);
            else if (e.name === 'route.ts') routes.push(`${prefix}${e.name.slice(0, -'route.ts'.length)}`.replace(/\/$/, ''));
        }
    };
    walk(dir);
    assert.ok(routes.length > 30, 'route discovery found too few routes');

    const classified = new Set([...Object.keys(RATE_LIMITS), ...NEVER_LIMIT, ...SESSION_GATED]);
    const unclassified = routes.filter((r) => !classified.has(r));
    assert.deepEqual(
        unclassified,
        [],
        'these /api routes are neither rate-limited nor explicitly exempt — classify them:\n  ' +
            unclassified.join('\n  '),
    );
});

test('a route in SESSION_GATED really does authenticate itself', () => {
    // Otherwise the set is a hole: drop a route in here, delete its auth call,
    // and the test suite still passes.
    for (const key of SESSION_GATED) {
        const src = code(join('app', 'api', key, 'route.ts'));
        const selfAuthenticating =
            /requireAppSession|verifyPersonalSign|verifyTypedData|verifyGalxeHmac|buildMatchRecordMessage/.test(src)
            // A retired 410 that reads no input cannot be abused.
            || /status:\s*410/.test(src)
            // Fails closed when its secret is absent.
            || /GALXE_HMAC_SECRET/.test(src);
        assert.ok(
            selfAuthenticating,
            `${key} is in SESSION_GATED but its handler shows no session, signature, 410 or fail-closed check`,
        );
    }
});

test('only NEVER_LIMIT overlaps are forbidden', () => {
    // SESSION_GATED ∩ RATE_LIMITS is intentional: a session is not a rate limit.
    // NEVER_LIMIT ∩ RATE_LIMITS would mean a heartbeat route got a limit, which
    // is the outage-shaped failure this whole design avoids.
    for (const r of NEVER_LIMIT) {
        assert.equal(RATE_LIMITS[r], undefined, `${r} is exempt but also limited — pick one`);
        assert.equal(SESSION_GATED.has(r), false, `${r} is exempt; it does not need a session either`);
    }
    const both = Object.keys(RATE_LIMITS).filter((k) => SESSION_GATED.has(k));
    assert.ok(both.length > 0, 'at least some authenticated routes should also be bounded');
});

test('the heartbeat and reconnect paths can never be limited', () => {
    // A limit here does not protect anything; it produces ghost boards and
    // "cannot find match" loops that look exactly like an outage.
    for (const r of ['match/state', 'match/stream', 'profile']) {
        assert.ok(NEVER_LIMIT.has(r), `${r} must be exempt`);
        assert.equal(RATE_LIMITS[r], undefined, `${r} must not also carry a limit`);
        assert.equal(ruleFor(r), null, `${r} must resolve to no rule`);
    }
});

test('SEC-07: the arena tick is bounded even though its claim is still open', () => {
    const rule = ruleFor('live-arena/power4p');
    assert.ok(rule, 'the arena must have a rule');
    assert.ok(ruleAppliesTo(rule, 'PATCH'), 'the tick is the PATCH');
    assert.equal(ruleAppliesTo(rule, 'POST'), false, 'bootstrap is a once-per-arena call');
});

test('method-scoped rules only apply to their methods', () => {
    const friends = ruleFor('friends')!;
    assert.ok(friends);
    assert.ok(ruleAppliesTo(friends, 'GET'));
    assert.ok(ruleAppliesTo(friends, 'POST'), 'an unscoped rule applies to every method');

    const chat = ruleFor('live-chat')!;
    assert.ok(chat);
    assert.equal(ruleAppliesTo(chat, 'POST'), true);
    assert.equal(ruleAppliesTo(chat, 'GET'), false, 'reading chat must stay free');
});

test('unlisted and malformed paths are unlimited rather than blocked', () => {
    // Fail-open on unknown paths: a typo in the table must not take the API down.
    assert.equal(ruleFor('nope/does/not/exist'), null);
    assert.equal(ruleFor('/'), null);
    assert.equal(ruleFor('friends/'), ruleFor('friends'), 'a trailing slash is the same route');
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('middleware.ts exists and matches /api broadly', () => {
    const src = read('middleware.ts');
    assert.match(src, /export function middleware/);
    assert.match(src, /pathname\.startsWith\('\/api\/'\)/);
    assert.match(src, /429/);
    assert.match(src, /Retry-After/);
    // It must consult the shared table rather than hardcoding limits.
    assert.match(src, /from '@\/lib\/rateLimitRoutes'/);
    assert.match(src, /from '@\/lib\/rateLimit'/);
    assert.doesNotMatch(src, /limit:\s*\d/, 'limits belong in the table, not the middleware');
});

test('the ALLOWED path sets response headers and never rewrites the request', () => {
    // Found in production: an allowed /api/farcaster returned no X-RateLimit-*
    // at all, because the middleware only set request headers. A client cannot
    // back off from a limit it never sees.
    //
    // The first fix went too far the other way: `NextResponse.next({ request:
    // { headers } })` to keep "both sides". No handler ever read the request
    // side — and in Vercel's production runtime the rewritten request arrives
    // with an EMPTY BODY, so every rate-limited POST (siwe/verify, presence,
    // live-chat, matchmaking/join, matchmaking/cancel) 500'd inside
    // request.json() in prod while passing locally and in CI. Verified live:
    // POST {} to /api/presence returned "Unexpected end of JSON input" while
    // exempt /api/lobby/policy parsed the identical body. So the request must
    // pass through untouched; the budget travels on the response alone.
    const src = read('middleware.ts');
    const okBranch = src.slice(src.indexOf('if (verdict.ok)'), src.indexOf('if (!verdict.ok)'));
    assert.match(okBranch, /res\.headers\.set\(/, 'the response must carry the budget');
    assert.match(okBranch, /res\.headers\.set\('X-RateLimit-Limit'/, 'including the limit itself');
    // Strip line comments first: the comment above documents the forbidden
    // pattern by name, and matching it would prove nothing.
    const code = okBranch.replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(
        code,
        /NextResponse\.next\(\{\s*request:/,
        'the request must not be rewritten or prod loses the body',
    );
});

test('the key unauthenticated spenders are limited', () => {
    // These three call Neynar with a server-side key and no session.
    for (const r of ['farcaster', 'friends', 'activity']) {
        assert.ok(RATE_LIMITS[r], `${r} spends NEYNAR_API_KEY unauthenticated and must be limited`);
    }
});

test('SEC-27: feedback uses the shared limiter and the platform IP', () => {
    const src = code('app/api/feedback/route.ts');
    assert.match(src, /checkRateLimit\(/);
    assert.match(src, /clientIp\(request\)/);
    assert.doesNotMatch(src, /throttleOk/, 'the per-file limiter is gone');
    // Attribution must require a real session.
    assert.match(src, /if \(typeof walletAddress === 'string' && walletAddress && sessionId\)/);
    assert.doesNotMatch(src, /x-forwarded-for/, 'must not key a limit on a client-settable header');
});

test('SEC-28: moderation is rate-limited and its dedup key is server-derived', () => {
    const src = read('app/api/social/moderation/route.ts');
    assert.match(src, /checkRateLimit\(/);
    assert.match(src, /deriveActivityId\(/);
    // No branch may still key off a client-supplied requestId.
    assert.doesNotMatch(src, /String\(requestId/, 'requestId must not drive the dedup key');
});

test('routes that throttle in-handler use the shared limiter', () => {
    for (const f of [
        'app/api/friends/route.ts',
        'app/api/feedback/route.ts',
        'app/api/social/moderation/route.ts',
        'app/api/marketplace/purchase/route.ts',
    ]) {
        const src = read(f);
        assert.match(src, /from '@\/lib\/rateLimit'/, `${f} must use the shared limiter`);
    }
});
