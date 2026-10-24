import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit, clientIp, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import { checkNativeRateLimit } from '@/lib/rateLimitNative';
import type { NativeRateLimitBinding } from '@/lib/rateLimitNative';
import { NEVER_LIMIT, ruleAppliesTo, ruleFor, nativeBindingFor } from '@/lib/rateLimitRoutes';

/**
 * Edge rate limiting (Phase 3 / SEC-34; distributed layer = A2, plan §5-P1).
 *
 * Applies the table in `lib/rateLimitRoutes.ts` to unauthenticated `/api`
 * traffic. Three deliberate properties:
 *
 *  - **Conservative.** Only listed paths are limited. An unlisted route is
 *    unlimited, so adding a new endpoint cannot accidentally break it.
 *  - **Never breaks the game.** `match/state`, `match/stream` and `profile` are
 *    explicitly exempt: they are on the client's heartbeat and reconnect path.
 *  - **Two layers, in order.** The in-process Map (`lib/rateLimit.ts`) filters
 *    cheaply first; when it passes, the native Cloudflare Rate Limiting
 *    binding for the rule's tier (A2) applies the *distributed* mutation cap —
 *    the in-process counters were per-isolate, so the effective budget used to
 *    be `limit x instances`. The native layer fails open to the in-process
 *    floor on any error; see `lib/rateLimitNative.ts`.
 *
 * The in-process counters are per-isolate and per-region. They bound casual
 * abuse and accidental loops; the native bindings are what bound a determined
 * caller. **Native accuracy is documented as approximate and per-location:**
 * counts sync in the background, so a rapid burst can exceed the configured
 * limit before counts converge (verified live 2026-10-24 — the binding
 * engaged on every request; a 30+ burst tripped the in-process layer first).
 * A strict global limit would need a Durable Object counter (plan §5-P1's
 * explicitly deferred fallback; `RateLimitDO` is built and bound for that).
 * See `lib/rateLimit.ts` for the honest ceiling of each layer.
 */

/**
 * Resolve the rule's native binding out of the Cloudflare env, or null when
 * unavailable (local dev, non-CF runtime, context error). `getCloudflareContext`
 * only resolves inside the OpenNext worker; everywhere else this returns null
 * and the in-process limiter stays the single active layer.
 */
async function nativeBindingOrNull(name: string): Promise<NativeRateLimitBinding | null> {
    try {
        const { getCloudflareContext } = await import('@opennextjs/cloudflare');
        const env = (await getCloudflareContext({ async: true })).env as unknown as Record<string, unknown>;
        return (env?.[name] as NativeRateLimitBinding) ?? null;
    } catch {
        return null;
    }
}

export async function middleware(request: NextRequest) {
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
        // A2: the in-process budget is not spent yet — apply the distributed
        // native cap before letting the request through. Runs only when a
        // binding exists for this tier; otherwise this is exactly the old
        // behaviour (headers-only response, see the body-preservation note
        // below for why we never rewrite the request).
        const bindingName = nativeBindingFor(rule);
        if (bindingName) {
            const native = await checkNativeRateLimit(
                await nativeBindingOrNull(bindingName),
                key,
            );
            if (!native.ok) {
                const retryAfterSec = Math.max(1, Math.ceil(rule.windowMs / 1000));
                return NextResponse.json(
                    {
                        error: 'Too many requests',
                        code: 'RATE_LIMITED',
                        retryAfter: retryAfterSec,
                    },
                    {
                        status: 429,
                        headers: {
                            'X-RateLimit-Limit': String(rule.limit),
                            'X-RateLimit-Remaining': '0',
                            'X-RateLimit-Reset': String(Math.max(0, Math.ceil(rule.windowMs / 1000))),
                            'Retry-After': String(retryAfterSec),
                            'X-RateLimit-Layer': 'native',
                        },
                    },
                );
            }
        }

        // Response headers ONLY — never override the request.
        //
        // An earlier version did `NextResponse.next({ request: { headers } })`
        // so a handler could read its own budget off the request. No handler
        // ever did — and in Vercel's production runtime the rewritten request
        // arrives with an EMPTY BODY. Every rate-limited POST (siwe/verify,
        // presence, live-chat, matchmaking/join, matchmaking/cancel) then
        // 500'd inside request.json() in prod while passing locally and in CI:
        // verified live, POST {} to /api/presence returned
        // {"error":"Unexpected end of JSON input"} while /api/lobby/policy
        // (exempt, plain next()) parsed the identical body. Plain next() leaves
        // the caller's headers and body untouched, which is also what keeps
        // x-vercel-ip-country and webhook signatures intact downstream.
        const res = NextResponse.next();
        for (const [k, v] of Object.entries(rateLimitHeaders(verdict))) {
            res.headers.set(k, v);
        }
        res.headers.set('X-RateLimit-Limit', String(rule.limit));
        return res;
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
