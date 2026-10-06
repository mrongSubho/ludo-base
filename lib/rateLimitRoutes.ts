/**
 * Route rate limits (Phase 3 / SEC-34).
 *
 * `middleware.ts` cannot know which routes carry a session, so this table is the
 * contract: **anything not listed here is unlimited**, and the middleware is
 * deliberately conservative about what it limits.
 *
 * Two rules govern the entries:
 *
 *  1. Never limit a route the client polls. `match/state`, `presence`, and the
 *     realtime-adjacent reads are on a heartbeat; a limit there breaks the game
 *     rather than protecting it.
 *  2. A route that spends a **server-side API key** or touches the service role
 *     is the interesting target. Those are the ones an anonymous caller can
 *     turn into your bill (`NEYNAR_API_KEY`, `ETHERSCAN_API_KEY`) or into
 *     unbounded DB work.
 *
 * Limits are per client IP and per window. They are in-process — see
 * `lib/rateLimit.ts` for what that does and does not buy.
 */

export interface LimitRule {
    /** Requests allowed per window, per client. */
    limit: number;
    windowMs: number;
    /**
     * Only apply to these methods. Empty means all.
     * Reads and writes are throttled differently: a GET costs a key, a POST
     * costs a write.
     */
    methods?: string[];
}

/**
 * Keyed by the path **after** `/api`, without the leading slash — so
 * `app/api/farcaster/route.ts` is `farcaster`.
 */
export const RATE_LIMITS: Record<string, LimitRule> = {
    // ── Spends a server-side API key on an anonymous request ───────────────
    // Each call bills NEYNAR_API_KEY. This was the clearest money bug in the
    // unauthenticated surface.
    farcaster: { limit: 20, windowMs: 60_000 },
    activity: { limit: 20, windowMs: 60_000 },
    friends: { limit: 20, windowMs: 60_000 },

    // ── Service-role reads/writes reachable without a session ─────────────
    activities: { limit: 60, windowMs: 60_000 },
    'predictors/board': { limit: 30, windowMs: 60_000, methods: ['GET'] },
    'presence/online': { limit: 120, windowMs: 60_000, methods: ['GET'] },
    'presence': { limit: 120, windowMs: 60_000, methods: ['POST'] },
    'live-chat': { limit: 60, windowMs: 60_000, methods: ['POST'] },

    // ── Matchmaking: creates and consumes queue rows ──────────────────────
    'matchmaking/join': { limit: 10, windowMs: 60_000, methods: ['POST'] },
    'matchmaking/cancel': { limit: 20, windowMs: 60_000, methods: ['POST'] },
    'matchmaking/pools': { limit: 30, windowMs: 60_000, methods: ['GET'] },
    'matchmaking/status': { limit: 60, windowMs: 60_000, methods: ['GET'] },

    // ── The AI arena claims authority by heartbeat from any spectator ──────
    // SEC-07: the claim itself is still unauthenticated. This bounds the
    // damage (one tick per 3s per client) until the claim is gated.
    'live-arena/power4p': { limit: 40, windowMs: 60_000, methods: ['PATCH'] },

    // ── Session issuance: one wallet prompt per attempt, so keep it tight ──
    'siwe/verify': { limit: 10, windowMs: 60_000, methods: ['POST'] },

    // ── Public reads that are cheap but not free ──────────────────────────
    geo: { limit: 60, windowMs: 60_000, methods: ['GET'] },
    notices: { limit: 60, windowMs: 60_000, methods: ['GET'] },
    'missions/list': { limit: 60, windowMs: 60_000, methods: ['GET'] },
    'onboarding/progress': { limit: 60, windowMs: 60_000 },
    'lobby/invites': { limit: 60, windowMs: 60_000, methods: ['GET'] },
};

/**
 * Never limit these, however they are called.
 *
 * `match/state` is the client's resync and reconnect path: a stale state is
 * answered by re-fetching it, often in a burst. `profile` and `matchmaking`
 * polling back the dashboard. A limit here produces ghost boards and "cannot
 * find match" loops, which look exactly like a backend outage.
 */
export const NEVER_LIMIT = new Set([
    'match/state',
    'match/stream',
    'profile',
]);

/**
 * Routes that authenticate themselves, so they do not need a limit *for the
 * sake of authentication*.
 *
 * This is the third bucket, and it exists so the classification test is honest:
 * "unclassified" must mean someone forgot to decide, not "unlimited by default".
 * Each entry below was checked for a session or signature requirement in its
 * handler — `scripts/rate-limit.test.ts` re-asserts that, so a route cannot
 * quietly lose its auth and stay in this set.
 *
 * **Overlap with `RATE_LIMITS` is deliberate.** A 7-day session is not a rate
 * limit: `matchmaking/join`, `matchmaking/cancel`, `matchmaking/status` and
 * `onboarding/progress` are authenticated *and* bounded, because a valid session
 * should not buy unbounded writes. Only `NEVER_LIMIT` must not overlap.
 *
 * `missions/claim` is a retired 410 with no body read, and `galxe/callback` is an
 * HMAC-verified webhook that fails closed without its secret.
 */
export const SESSION_GATED = new Set([
    'chips/lobby-ticket',
    'chips/settle/propose',
    'feedback',
    'friendships',
    'galxe/callback',
    'live-matches/window',
    'lobby/invite',
    'lobby/join',
    'marketplace/purchase',
    'match/record',
    'match/start',
    'matchmaking/cancel',
    'matchmaking/join',
    'matchmaking/status',
    'messages',
    'missions/claim',
    'missions/voucher',
    'onboarding/claim',
    'onboarding/progress',
    'onboarding/referral',
    'profile/ecdh',
    'push/subscribe',
    'push/test',
    'social/moderation',
    'social/poke',
    'spectator-bets',
    'wallet-links',
]);

/** Look up the rule for a `/api` path. Returns null when unlimited. */
export function ruleFor(apiPath: string): LimitRule | null {
    const key = apiPath.replace(/^\/+|\/+$/g, '');
    if (!key) return null;
    if (NEVER_LIMIT.has(key)) return null;
    const rule = RATE_LIMITS[key];
    if (!rule) return null;
    if (rule.methods && rule.methods.length > 0) {
        return rule; // caller checks the method
    }
    return rule;
}

/** Does this rule apply to this HTTP method? */
export function ruleAppliesTo(rule: LimitRule, method: string): boolean {
    if (!rule.methods || rule.methods.length === 0) return true;
    return rule.methods.includes(method.toUpperCase());
}
