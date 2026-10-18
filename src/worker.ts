// src/worker.ts (P0 + P1)
// Custom worker entrypoint wrapping the OpenNext handler and exporting
// Durable Object classes, with fast-path WebSocket upgrade on /api/room/,
// sharded mutation rate-limiting (P13/G1, F6), and Cron cleanup scheduler (P14/G2).
// See: docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.4, §5-P0, §5-P1

// @ts-expect-error: will be resolved by wrangler build against .open-next
import openNextHandler from "../.open-next/worker.js";

export { MatchRoom } from "./room/MatchRoom";
export { RateLimitDO } from "./rateLimit/RateLimitDO";

async function invokeSupabaseRpc(
  supabaseUrl: string,
  serviceKey: string,
  fnName: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function handleScheduledCleanups(event: ScheduledEvent, env: CloudflareEnv): Promise<void> {
  const envMap = env as unknown as Record<string, string | undefined>;
  const supabaseUrl = envMap.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = envMap.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.warn('[cron] Supabase URL or service key missing; skipping cleanup trigger');
    return;
  }

  console.log(`[cron] executing cleanup trigger (${event.cron} at ${event.scheduledTime})`);

  // 1. Cleanup matchmaking queue
  const queueRes = await invokeSupabaseRpc(supabaseUrl, serviceKey, 'cleanup_matchmaking_queue');
  if (!queueRes.ok) {
    console.error('[cron] cleanup_matchmaking_queue failed', queueRes.status, queueRes.text);
  } else {
    console.log('[cron] cleanup_matchmaking_queue ok');
  }

  // 2. Cleanup stale matchmaking / sessions data
  const staleRes = await invokeSupabaseRpc(supabaseUrl, serviceKey, 'cleanup_stale_data');
  if (!staleRes.ok) {
    console.error('[cron] cleanup_stale_data failed', staleRes.status, staleRes.text);
  } else {
    console.log('[cron] cleanup_stale_data ok');
  }

  // 3. Retention: auth_challenges older than 24 hours
  const authRes = await invokeSupabaseRpc(supabaseUrl, serviceKey, 'cleanup_auth_challenges', { p_keep_hours: 24 });
  if (!authRes.ok) {
    console.error('[cron] cleanup_auth_challenges failed', authRes.status, authRes.text);
  } else {
    console.log('[cron] cleanup_auth_challenges ok:', authRes.text);
  }

  // 4. Retention: sessions older than 30 days
  const sessRes = await invokeSupabaseRpc(supabaseUrl, serviceKey, 'cleanup_sessions', { p_keep_days: 30 });
  if (!sessRes.ok) {
    console.error('[cron] cleanup_sessions failed', sessRes.status, sessRes.text);
  } else {
    console.log('[cron] cleanup_sessions ok:', sessRes.text);
  }
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Fast-path WebSocket upgrades directly to the DO, bypassing Next.js server functions
    if (url.pathname.startsWith("/api/room/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      // Expected pattern: /api/room/:matchId/ws or /api/room/:matchId/info
      const matchId = parts[2];
      if (!matchId) {
        return new Response("Missing matchId in /api/room/:matchId/ws", { status: 400 });
      }

      if (!env.MATCH_ROOM) {
        return new Response("MATCH_ROOM binding not configured", { status: 500 });
      }

      const id = env.MATCH_ROOM.idFromName(matchId);
      return env.MATCH_ROOM.get(id).fetch(request);
    }

    // Distributed Rate Limiting (P13/G1, Rev 3 — F6):
    // Sharded by `${colo}_${routeClass}_${ipPrefix}` and applied ONLY to high-value mutations
    const method = request.method.toUpperCase();
    const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (
      isMutation &&
      env.RATE_LIMITER &&
      (url.pathname.startsWith('/api/auth/') ||
        url.pathname.startsWith('/api/match/start') ||
        url.pathname.startsWith('/api/chips/'))
    ) {
      const cf = (request as unknown as { cf?: { colo?: string } }).cf;
      const colo = cf?.colo || 'def';
      const clientIp =
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-real-ip') ||
        '127.0.0.1';
      const ipPrefix = clientIp.split('.').slice(0, 3).join('.') || clientIp.slice(0, 8);
      const routeClass = url.pathname.split('/')[2] || 'mut';
      const shardKey = `${colo}_${routeClass}_${ipPrefix}`;

      const limiterId = env.RATE_LIMITER.idFromName(shardKey);
      const limiter = env.RATE_LIMITER.get(limiterId);
      const limitKey = `${clientIp}:${url.pathname}`;
      const checkResult = await limiter.check(limitKey, 30, 60_000);

      if (!checkResult.allowed) {
        return new Response(
          JSON.stringify({ error: 'Too Many Requests', code: 'RATE_LIMITED' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(Math.max(1, Math.ceil((checkResult.resetAt - Date.now()) / 1000))),
            },
          },
        );
      }
    }

    return openNextHandler.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduledCleanups(event, env));
  },
};
