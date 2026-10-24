/**
 * Native Cloudflare Rate Limiting binding wrapper (A2 / plan §5-P1).
 *
 * The in-process limiter in `lib/rateLimit.ts` counts per isolate, so on a
 * multi-isolate deployment the effective mutation budget is `limit x
 * instances`. The native bindings declared in `wrangler.jsonc` (`ratelimits`,
 * simple mode) count at the edge — one eventually-consistent counter per
 * namespace — and close that gap for mutations. Reads stay in-process.
 *
 * ## Degradation contract
 *
 * This layer **fails open**: if the binding is absent (local `next dev`, a
 * non-Cloudflare runtime), the context is unavailable, or `limit()` throws,
 * the caller falls back to the in-process check that has always run. A
 * degraded distributed layer must never take the API down — the in-process
 * limiter is the floor, this is the upgrade. `middleware.ts` is the only
 * consumer.
 */

/** Shape of a `ratelimits` binding (simple mode) in the Worker env. */
export interface NativeRateLimitBinding {
    limit(input: { key: string }): Promise<{ success: boolean }>;
}

export type NativeRateLimitVerdict =
    | { ok: true; usedNative: true }
    | { ok: true; usedNative: false; reason: 'no-binding' | 'error' }
    | { ok: false; usedNative: true };

/**
 * One distributed check. Records a hit inside the binding namespace on every
 * successful `limit()` call (Cloudflare counts regardless of `success`).
 *
 * @param binding the resolved env binding, or null/undefined when unavailable
 * @param key     stable bucket key — same shape as `rateKey()`
 */
export async function checkNativeRateLimit(
    binding: NativeRateLimitBinding | null | undefined,
    key: string,
): Promise<NativeRateLimitVerdict> {
    if (!binding || typeof binding.limit !== 'function') {
        return { ok: true, usedNative: false, reason: 'no-binding' };
    }
    try {
        const res = await binding.limit({ key });
        return res?.success ? { ok: true, usedNative: true } : { ok: false, usedNative: true };
    } catch {
        // Transient edge error (or a non-Workers runtime): let the in-process
        // limiter be the only active layer rather than failing the request.
        return { ok: true, usedNative: false, reason: 'error' };
    }
}
