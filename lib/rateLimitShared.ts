/**
 * SA-5 — shared (cross-isolate) rate limiting.
 *
 * `lib/rateLimit.ts` is deliberately an in-process `Map`: it stops casual abuse
 * and accidental loops, and it says so at runtime. The honest ceiling it
 * documents — `limit x instances` — is still a real hole for the two endpoints
 * where abuse converts directly into cost or progression: the matchmaking join
 * heartbeat and the result-recording path.
 *
 * This module adds the shared counter those two routes need, backed by
 * `public.rate_limit_hit` (migration `202610200003`). It is a *supplement*, not a
 * replacement: callers keep the in-process check first (cheap, no I/O) and add
 * this one when the request is about to do real work.
 *
 * Fail-open by design. A rate limiter that fails closed turns a database blip
 * into a full outage; the in-process limiter is still in front of it.
 */

import { serviceDb } from './serverAuth';
import { checkRateLimit, type RateLimitVerdict } from './rateLimit';

/**
 * Fixed-window check shared across every isolate.
 *
 * @param key      Logical bucket, e.g. `matchmaking:join:<wallet>`.
 * @param limit    Max hits per window.
 * @param windowMs Window length in milliseconds.
 */
export async function checkRateLimitShared(
    key: string,
    limit: number,
    windowMs: number,
): Promise<RateLimitVerdict> {
    // Fast local rejection first — no network cost for an obvious flood.
    const local = checkRateLimit(key, limit, windowMs);
    if (!local.ok) return local;

    try {
        // `types/database.types.ts` is generated from the remote schema and lags
        // the migration chain (tracked as DB-22), so `rate_limit_hit` is not in the
        // RPC union yet. Narrow cast at the boundary rather than a hand-edit of a
        // generated file; drop it when DB-22 regenerates the types.
        const rpc = serviceDb().rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>;
        const { data, error } = await rpc('rate_limit_hit', {
            p_key: key,
            p_window_ms: windowMs,
            p_limit: limit,
        });
        if (error) throw error;

        const row = (data ?? {}) as {
            ok?: boolean;
            remaining?: number;
            resetMs?: number | string;
        };
        const resetMs = Math.max(0, Number(row.resetMs ?? 0) - Date.now());
        if (row.ok === false) {
            return {
                ok: false,
                remaining: 0,
                resetMs,
                retryAfterSec: Math.max(1, Math.ceil(resetMs / 1000)),
            };
        }
        return { ok: true, remaining: Number(row.remaining ?? 0), resetMs };
    } catch (err) {
        // Fail open: the local limiter above already applied.
        console.warn('[rate-limit] shared counter unavailable, using in-process budget:', (err as Error).message);
        return local;
    }
}
