/**
 * RateLimitDO — Durable Object implementing sharded rate limiting.
 *
 * Sits alongside MatchRoom in src/worker.ts to provide colo-local sharded
 * mutation rate-limiting for high-value endpoints (/api/auth/*, /api/match/start, /api/chips/*).
 *
 * See: docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.4, §5-P0, §5-P1
 */
import { DurableObject } from 'cloudflare:workers';
import { checkRateLimitStorage, type RateLimitCheckResult } from './rateLimitCore';

export { type RateLimitCheckResult };

interface Env {
  RATE_LIMITER: DurableObjectNamespace<RateLimitDO>;
}

export class RateLimitDO extends DurableObject<Env> {
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitCheckResult> {
    return checkRateLimitStorage(this.ctx.storage, key, limit, windowMs);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/check')) {
      const key = url.searchParams.get('key') || 'default';
      const limit = parseInt(url.searchParams.get('limit') || '60', 10);
      const windowMs = parseInt(url.searchParams.get('windowMs') || '60000', 10);
      const res = await this.check(key, limit, windowMs);
      return Response.json(res, { status: res.allowed ? 200 : 429 });
    }
    return new Response('RateLimitDO endpoint not found', { status: 404 });
  }
}
