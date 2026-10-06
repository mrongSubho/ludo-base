import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit, clientIp, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { NEVER_LIMIT, ruleAppliesTo, ruleFor } from '@/lib/rateLimitRoutes';

/**
 * Edge rate limiting (Phase 3 / SEC-34).
 *
 * Applies the table in `lib/rateLimitRoutes.ts` to unauthenticated `/api`
 * traffic. Two deliberate properties:
 *
 *  - **Conservative.** Only listed paths are limited. An unlisted route is
 *    unlimited, so adding a new endpoint cannot accidentally break it.
 *  - **Never breaks the game.** `match/state`, `match/stream` and `profile` are
 *    explicitly exempt: they are on the client's heartbeat and reconnect path.
 *
 * This runs in the Edge runtime, so the counters are per-isolate and per-region.
 * That bounds casual abuse and accidental loops; it is not a defence against a
 * determined caller. See `lib/rateLimit.ts`.
 */
export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (!pathname.startsWith('/api/')) return NextResponse.next();

    const apiPath = pathname.slice('/api'.length);
    if (NEVER_LIMIT.has(apiPath.replace(/^\/+|\/+$/g, ''))) {
        return NextResponse.next();
    }

    const rule = ruleFor(apiPath);
    if (!rule) return NextResponse.next();
    if (!ruleAppliesTo(rule, request.method)) return NextResponse.next();

    const key = rateKey(`api:${apiPath}`, clientIp(request));
    const verdict = checkRateLimit(key, rule.limit, rule.windowMs);

    if (verdict.ok) {
        // Pass the remaining budget downstream so a handler can pre-empt rather
        // than discover the limit at the database.
        const headers = new Headers(rateLimitHeaders(verdict));
        headers.set('X-RateLimit-Limit', String(rule.limit));
        return NextResponse.next({ request: { headers } });
    }

    return NextResponse.json(
        {
            error: 'Too many requests',
            code: 'RATE_LIMITED',
            retryAfter: verdict.retryAfterSec,
        },
        {
            status: 429,
            headers: {
                ...rateLimitHeaders(verdict),
                'X-RateLimit-Limit': String(rule.limit),
                'Retry-After': String(verdict.retryAfterSec),
            },
        },
    );
}

export const config = {
    /**
     * Everything except static assets and image optimisation. Kept broad on
     * purpose: the matcher decides what to limit, not where it can run.
     */
    matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
