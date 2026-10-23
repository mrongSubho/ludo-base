import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
    hashToken,
    parseSessionToken,
    validateCsrf,
    isCapabilityAllowed,
    APP_IDLE_TTL_MS,
    MATCH_IDLE_TTL_MS,
    type SessionScope,
    type SessionCapability,
    type SessionRecord,
} from './sessionV2';

let admin: SupabaseClient<Database> | null = null;

export function serviceDb(): SupabaseClient<Database> {
    if (admin) return admin;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase service role is not configured');
    // DB-22: the client carries the regenerated Database types, so `.from()` and
    // `.rpc()` payloads are checked against the migration chain, not `any`.
    admin = createClient<Database>(url, key);
    return admin;
}

export interface SessionAuthResult {
    wallet: string;
    scope: SessionScope;
    matchId: string | null;
    seatColor?: string | null;
    session: SessionRecord | null;
}

export interface RequireSessionOptions {
    scope?: SessionScope;
    capability?: SessionCapability | string;
    matchId?: string;
    expectedWallet?: string;
}

/**
 * Validates a session from an incoming HTTP Request.
 *
 * Checks:
 *  1. CSRF posture on state-modifying verbs (POST/PUT/PATCH/DELETE)
 *  2. Token extraction from Cookie (__Host-ludo_session) or Authorization: Bearer
 *  3. Token hash verification against `sessions` table
 *  4. Scope isolation ('app' cannot access match-only actions; 'match' cannot access chat/profile)
 *  5. Absolute and idle expiration windows
 *  6. Dual-read fallback to `app_sessions` for backward compatibility during rollout
 */
export async function requireSession(
    request: Request,
    scopeOrOptions?: SessionScope | RequireSessionOptions,
    capability?: SessionCapability | string,
): Promise<SessionAuthResult | null> {
    const opts: RequireSessionOptions =
        typeof scopeOrOptions === 'string'
            ? { scope: scopeOrOptions, capability }
            : (scopeOrOptions ?? {});

    const expectedScope: SessionScope = opts.scope ?? 'app';

    // 1. Verify CSRF posture on mutations
    if (!validateCsrf(request)) {
        console.warn('[auth] rejected request failing CSRF origin check', request.url);
        return null;
    }

    // 2. Extract token
    const token = parseSessionToken(request);
    const db = serviceDb();

    if (token) {
        const tokenHash = hashToken(token);
        const now = Date.now();
        const nowIso = new Date(now).toISOString();

        // 3. Lookup in sessions v2 table
        const { data: session } = await db
            .from('sessions')
            .select('*')
            .eq('token_hash', tokenHash)
            .is('revoked_at', null)
            .maybeSingle();

        if (session) {
            // Check absolute expiration
            if (new Date(session.expires_at).getTime() <= now) {
                return null;
            }

            // Check idle expiration
            if (new Date(session.idle_expires_at).getTime() <= now) {
                return null;
            }

            // Check scope isolation:
            // - If route requires 'app' scope, 'match' scope is rejected
            // - If route requires 'match' scope, 'app' scope is rejected
            if (session.scope !== expectedScope) {
                // Exception: 'match' scope has read-only 'spectator' compatibility only if explicitly spectating
                return null;
            }

            // Check match binding if matchId required
            if (opts.matchId && session.match_id !== opts.matchId) {
                return null;
            }

            // Check expected wallet if specified
            if (
                opts.expectedWallet &&
                session.wallet_address.toLowerCase() !== opts.expectedWallet.toLowerCase()
            ) {
                return null;
            }

            // Check capability if specified
            if (opts.capability) {
                const allowed = isCapabilityAllowed(session.scope as SessionScope, opts.capability as SessionCapability);
                if (!allowed) return null;
            }

            // Throttled update of last_seen_at and idle_expires_at (at most once every 60s)
            const lastSeenTime = new Date(session.last_seen_at).getTime();
            if (now - lastSeenTime > 60_000) {
                const idleTtl = session.scope === 'app' ? APP_IDLE_TTL_MS : MATCH_IDLE_TTL_MS;
                const newIdleExpires = new Date(now + idleTtl).toISOString();
                // Fire and forget, don't block auth on touch
                db.from('sessions')
                    .update({ last_seen_at: nowIso, idle_expires_at: newIdleExpires })
                    .eq('id', session.id)
                    .then(() => {}, () => {});
            }

            return {
                wallet: session.wallet_address.toLowerCase(),
                scope: session.scope as SessionScope,
                matchId: session.match_id,
                seatColor: session.seat_color ?? null,
                session,
            };
        }
    }

    // 4. Dual-read fallback to `app_sessions` (restored).
    //
    // This was retired here on the assumption that the writer had migrated to
    // `sessions` v2. It had not: `/api/siwe/verify` still inserts into
    // `app_sessions` and hands the client that row's id, while this function hashed
    // it and looked for `sessions.token_hash` — a match that can never occur. Every
    // route authenticating through here returned 401, which took live broadcast,
    // DMs and missions down while the session-free surfaces (chips, leaderboard,
    // activity feed) kept working.
    //
    // The header on this function already documented this fallback ("Dual-read
    // fallback to app_sessions for backward compatibility during rollout"); the
    // implementation and its own doc disagreed, and the implementation was wrong.
    //
    // `app_sessions` has no scope column, so a fallback session is treated as
    // 'app' scope — which is the only scope the legacy writer ever minted.
    if (token) {
        const legacy = await requireAppSession(undefined, token);
        if (legacy) {
            // Honour the requested scope: legacy sessions are app-scope only, so a
            // match-scoped request must not authenticate off one.
            if (expectedScope !== 'app') return null;
            if (opts.expectedWallet && opts.expectedWallet.toLowerCase() !== legacy) return null;
            return {
                wallet: legacy,
                scope: 'app',
                matchId: null,
                seatColor: null,
                session: null,
            };
        }
    }

    return null;
}

/**
 * Convenience helper returning just the authenticated wallet string, or null.
 */
export async function requireSessionWallet(
    request: Request,
    scopeOrOptions?: SessionScope | RequireSessionOptions,
    capability?: SessionCapability | string,
): Promise<string | null> {
    const res = await requireSession(request, scopeOrOptions, capability);
    return res ? res.wallet : null;
}

/**
 * Dual-read legacy session validator.
 * Validates either against `sessions` (by hash or id) or `app_sessions` (by id).
 */
export async function requireAppSession(walletAddress: unknown, sessionId: unknown): Promise<string | null> {
    const wallet = String(walletAddress || '').toLowerCase();
    const id = String(sessionId || '').trim();
    if (!id) return null;
    if (wallet && !/^0x[a-f0-9]{40}$/.test(wallet) && !wallet.startsWith('guest_')) return null;

    const db = serviceDb();
    const now = Date.now();

    // 1. Check sessions table (by token hash or id)
    const tokenHash = hashToken(id);
    const { data: session } = await db
        .from('sessions')
        .select('wallet_address, expires_at, idle_expires_at, revoked_at, scope')
        .or(`token_hash.eq.${tokenHash},id.eq.${id}`)
        .is('revoked_at', null)
        .maybeSingle();

    if (
        session &&
        session.scope === 'app' &&
        new Date(session.expires_at).getTime() > now &&
        new Date(session.idle_expires_at).getTime() > now &&
        (!wallet || session.wallet_address.toLowerCase() === wallet)
    ) {
        return session.wallet_address.toLowerCase();
    }

    // 2. Dual-read from app_sessions (backward compatibility)
    const { data: legacy } = await db
        .from('app_sessions')
        .select('wallet_address, expires_at, revoked_at')
        .eq('id', id)
        .maybeSingle();

    if (
        legacy &&
        !legacy.revoked_at &&
        new Date(legacy.expires_at).getTime() > now &&
        (!wallet || String(legacy.wallet_address).toLowerCase() === wallet)
    ) {
        return String(legacy.wallet_address).toLowerCase();
    }

    return null;
}

/**
 * Ensure a players row exists for a wallet that may never have connected
 * (invite/friend-request/poke targets). Fresh-DB FKs reject rows referencing
 * unknown wallets, so any server flow that stores a third-party address must
 * provision first. Idempotent, defaults fill the rest. Returns an error
 * string on failure, null on success.
 */
export async function ensurePlayerRow(walletAddress: string): Promise<string | null> {
    const wallet = String(walletAddress || '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet) && !wallet.startsWith('guest_')) {
        return 'Invalid wallet address';
    }
    const { error } = await serviceDb()
        .from('players')
        .upsert({ wallet_address: wallet }, { onConflict: 'wallet_address', ignoreDuplicates: true });
    return error ? error.message : null;
}
