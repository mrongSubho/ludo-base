/**
 * Rate limiting (Phase 3 / SEC-34, SEC-08, SEC-27, SEC-28).
 *
 * One sliding-window limiter, used by `middleware.ts` for the routes that carry
 * no session and by individual handlers for the ones that must throttle on more
 * than the client IP.
 *
 * ## What this is not
 *
 * This is an **in-process** counter. On a multi-instance deployment (Vercel,
 * any serverless runtime) each instance keeps its own map, so the effective limit
 * is `limit x instances` and an attacker gets a fresh budget per instance. It
 * stops casual abuse and accidental loops. It does not stop a determined caller,
 * and it must not be described as if it does.
 *
 * A shared store (Upstash/Redis) is the real fix and is a deployment decision,
 * not a code one. `RATE_LIMIT_SHARED_URL` is reserved for it: when set, callers
 * are expected to have a distributed implementation. Until then this is the
 * honest ceiling, and `lib/rateLimit.ts` says so at runtime too.
 *
 * ## Client IP
 *
 * `clientIp()` prefers the platform-provided value. `x-forwarded-for` is a
 * **client-controllable header**: anyone can send their own, so keying a limit
 * on `x-forwarded-for[0]` means keying it on attacker input (SEC-27). The
 * platform header is only trustworthy because the edge sets it; `x-real-ip` is
 * accepted as a fallback for platforms that use that name instead.
 */

export type RateLimitVerdict =
    | { ok: true; remaining: number; resetMs: number }
    | { ok: false; remaining: 0; resetMs: number; retryAfterSec: number };

interface Bucket {
    hits: number[];
}

/**
 * Process-lifetime store. Module scope so every caller in one instance shares
 * it; deliberately not exported for mutation.
 */
const buckets = new Map<string, Bucket>();

/** Cap the map so a spray of distinct keys cannot exhaust memory. */
const MAX_TRACKED_KEYS = 20_000;

function sweep(now: number, windowMs: number): void {
    if (buckets.size <= MAX_TRACKED_KEYS) return;
    for (const [k, b] of buckets) {
        if (b.hits.length === 0 || now - b.hits[b.hits.length - 1] >= windowMs) {
            buckets.delete(k);
        }
    }
    // Still oversized after a full sweep (everything is inside the window):
    // drop the oldest half rather than growing further.
    if (buckets.size > MAX_TRACKED_KEYS) {
        const keys = [...buckets.entries()]
            .sort((a, b) => a[1].hits[0] - b[1].hits[0])
            .slice(0, Math.floor(buckets.size / 2));
        for (const [k] of keys) buckets.delete(k);
    }
}

/**
 * Sliding-window check. Records a hit on success, so the caller should call this
 * once per request rather than probing it.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitVerdict {
    if (!key || !Number.isFinite(limit) || limit <= 0) {
        // A misconfigured limit must not silently become "allow everything"
        // nor "deny everything"; refuse the request.
        return { ok: false, remaining: 0, resetMs: windowMs, retryAfterSec: Math.ceil(windowMs / 1000) };
    }
    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= limit) {
        const oldest = bucket.hits[0];
        const resetMs = Math.max(0, windowMs - (now - oldest));
        buckets.set(key, bucket);
        return { ok: false, remaining: 0, resetMs, retryAfterSec: Math.max(1, Math.ceil(resetMs / 1000)) };
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
    sweep(now, windowMs);
    return { ok: true, remaining: limit - bucket.hits.length, resetMs: windowMs };
}

/**
 * The client IP, preferring the platform-provided header.
 *
 * `x-forwarded-for` is only consulted as a **last** resort, and when it is, the
 * *last* entry is taken rather than the first — a client-supplied prefix sits at
 * the front, so `[0]` is the spoofable one.
 */
export function clientIp(req: { headers: Headers }): string {
    const h = req.headers;
    const platform =
        h.get('cf-connecting-ip') ||      // Cloudflare
        h.get('x-vercel-forwarded-for') || // Vercel
        h.get('fly-client-ip') ||          // Fly
        h.get('x-real-ip');                // nginx convention
    if (platform && platform.trim()) return platform.trim();

    const xff = h.get('x-forwarded-for');
    if (xff) {
        const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
        const last = parts[parts.length - 1];
        if (last) return last;
    }
    return 'unknown';
}

/** Stable bucket key. Scoped by route so one noisy path cannot starve another. */
export function rateKey(scope: string, identity: string): string {
    return `${scope}:${identity}`;
}

export function resetRateLimits(): void {
    buckets.clear();
}

/** True when a distributed limiter is configured (see the file header). */
export function hasSharedStore(): boolean {
    return Boolean(process.env.RATE_LIMIT_SHARED_URL);
}

export const RATE_LIMIT_HEADERS = {
    'X-RateLimit-Limit': 'limit',
    'X-RateLimit-Remaining': 'remaining',
    'X-RateLimit-Reset': 'resetSeconds',
} as const;

/** Standard rate-limit headers, including the `Retry-After` SEC-31 asks for. */
export function rateLimitHeaders(v: RateLimitVerdict): Record<string, string> {
    const resetSeconds = String(Math.max(0, Math.ceil(v.resetMs / 1000)));
    const out: Record<string, string> = {
        'X-RateLimit-Remaining': String(Math.max(0, v.remaining)),
        'X-RateLimit-Reset': resetSeconds,
    };
    if (!v.ok) out['Retry-After'] = String(v.retryAfterSec);
    return out;
}
