/**
 * RateLimiter Core Storage Algorithm (Server Authority Migration Phase 1).
 *
 * Provides storage-backed sliding/fixed-window rate limiting used by RateLimitDO.
 * Decoupled from cloudflare:workers so it can be verified in unit tests under Node.js.
 *
 * See: docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.4, §5-P1
 */

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export async function checkRateLimitStorage(
  storage: StorageAdapter,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitCheckResult> {
  const now = Date.now();
  const stored = (await storage.get<{ count: number; resetAt: number }>(key)) ?? {
    count: 0,
    resetAt: now + windowMs,
  };

  if (now >= stored.resetAt) {
    stored.count = 0;
    stored.resetAt = now + windowMs;
  }

  stored.count += 1;
  await storage.put(key, stored);

  const allowed = stored.count <= limit;
  const remaining = Math.max(0, limit - stored.count);

  return {
    allowed,
    remaining,
    resetAt: stored.resetAt,
  };
}
