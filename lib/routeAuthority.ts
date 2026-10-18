/**
 * Route Authority Table (Server Authority Migration Phase 1).
 *
 * Declares the authoritative security and routing contract for all routes in `app/api`:
 * - method: HTTP methods exported
 * - scope: 'app' | 'match' | 'spectator' | 'public' | 'signature' | 'hmac' | 'retired' | 'conditional'
 * - capability: required capability if any
 * - csrf: whether CSRF Origin / Sec-Fetch-Site validation applies
 * - resource: 'host' | 'owner' | 'self' | 'none'
 * - serviceRole: whether Supabase service role is used
 *
 * Enforced statically by `scripts/check-routes.mjs`.
 * See: docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.3
 */

export interface RouteAuthorityEntry {
    methods: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
    scope: 'app' | 'match' | 'spectator' | 'public' | 'signature' | 'hmac' | 'retired' | 'conditional';
    capability?: string;
    csrf: boolean;
    resource: 'host' | 'owner' | 'self' | 'none';
    serviceRole: boolean;
}

export const ROUTE_AUTHORITY_MAP: Record<string, RouteAuthorityEntry> = {
    // ── Auth v2 ────────────────────────────────────────────────────────────
    'auth/challenge':         { methods: ['POST'], scope: 'public', csrf: false, resource: 'none', serviceRole: true },
    'auth/verify':            { methods: ['POST'], scope: 'public', csrf: true, resource: 'none', serviceRole: true },
    'auth/match':             { methods: ['POST'], scope: 'app', capability: 'seat.play', csrf: true, resource: 'self', serviceRole: true },
    'auth/logout':            { methods: ['POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'auth/session':           { methods: ['GET'],  scope: 'app', csrf: false, resource: 'self', serviceRole: true },

    // ── Match lifecycle ───────────────────────────────────────────────────
    'match/start':            { methods: ['POST'], scope: 'conditional', capability: 'room.own', csrf: true, resource: 'self', serviceRole: true },
    'match/record':           { methods: ['POST'], scope: 'signature', capability: 'match.record', csrf: true, resource: 'owner', serviceRole: true },
    'match/state':            { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: true },
    'match/stream':           { methods: ['POST'], scope: 'signature', csrf: true, resource: 'owner', serviceRole: true },

    // ── Lobbies ───────────────────────────────────────────────────────────
    'lobby/invite':           { methods: ['POST'], scope: 'app', capability: 'lobby.manage', csrf: true, resource: 'host', serviceRole: true },
    'lobby/invites':          { methods: ['GET'],  scope: 'app', csrf: false, resource: 'self', serviceRole: true },
    'lobby/join':             { methods: ['POST', 'GET', 'DELETE'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'lobby/policy':           { methods: ['POST'], scope: 'app', capability: 'lobby.manage', csrf: true, resource: 'host', serviceRole: true },

    // ── Chips / settlement ────────────────────────────────────────────────
    'chips/settle/propose':   { methods: ['POST', 'PUT'], scope: 'app', capability: 'bet.settle', csrf: true, resource: 'host', serviceRole: true },
    'chips/lobby-ticket':     { methods: ['POST'], scope: 'app', csrf: true, resource: 'host', serviceRole: true },
    'chips/escrow-balance':   { methods: ['GET'],  scope: 'app', csrf: false, resource: 'self', serviceRole: true },

    // ── Spectator betting ─────────────────────────────────────────────────
    'spectator-bets':         { methods: ['GET', 'POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },

    // ── Messaging ─────────────────────────────────────────────────────────
    'messages':               { methods: ['GET', 'POST'], scope: 'app', capability: 'chat.send', csrf: true, resource: 'self', serviceRole: true },

    // ── Profile / identity ────────────────────────────────────────────────
    'profile':                { methods: ['GET', 'POST'], scope: 'app', capability: 'profile.read', csrf: true, resource: 'self', serviceRole: true },
    'profile/ecdh':           { methods: ['GET', 'POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'wallet-links':           { methods: ['GET', 'POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },

    // ── Social ────────────────────────────────────────────────────────────
    'friendships':            { methods: ['GET', 'POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'friends':                { methods: ['GET'],  scope: 'app', csrf: false, resource: 'self', serviceRole: true },
    'social/moderation':      { methods: ['GET', 'POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'social/poke':            { methods: ['GET', 'POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },

    // ── Missions / onboarding ──────────────────────────────────────────────
    'onboarding/progress':    { methods: ['GET', 'POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'onboarding/claim':       { methods: ['POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'onboarding/referral':    { methods: ['GET', 'POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'missions/list':          { methods: ['GET'],  scope: 'app', csrf: false, resource: 'self', serviceRole: true },
    'missions/voucher':       { methods: ['POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'missions/daily-bonus':   { methods: ['POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'missions/claim':         { methods: ['POST'], scope: 'retired', csrf: false, resource: 'none', serviceRole: false },

    // ── Matchmaking ───────────────────────────────────────────────────────
    'matchmaking/join':       { methods: ['POST'], scope: 'app', capability: 'matchmaking', csrf: true, resource: 'self', serviceRole: true },
    'matchmaking/cancel':     { methods: ['POST'], scope: 'app', capability: 'matchmaking', csrf: true, resource: 'owner', serviceRole: true },
    'matchmaking/status':     { methods: ['GET'],  scope: 'app', capability: 'matchmaking', csrf: false, resource: 'owner', serviceRole: true },
    'matchmaking/pools':      { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: true },

    // ── Live / spectator ──────────────────────────────────────────────────
    'live-matches/window':    { methods: ['POST'], scope: 'app', csrf: true, resource: 'host', serviceRole: true },
    'live-arena/power4p':     { methods: ['POST', 'PATCH'], scope: 'app', csrf: true, resource: 'host', serviceRole: true },
    'live-chat':              { methods: ['GET', 'POST'], scope: 'public', csrf: true, resource: 'none', serviceRole: true },
    'predictors/board':       { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: true },

    'galxe/callback':         { methods: ['POST'], scope: 'hmac', csrf: false, resource: 'none', serviceRole: true },

    // ── Misc ──────────────────────────────────────────────────────────────
    'activities':             { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: true },
    'activity':               { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: true },
    'notices':                { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: false },
    'feedback':               { methods: ['POST'], scope: 'public', csrf: true, resource: 'none', serviceRole: true },
    'presence':               { methods: ['POST'], scope: 'app', capability: 'presence', csrf: true, resource: 'self', serviceRole: true },
    'presence/online':        { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: true },
    'geo':                    { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: false },
    'siwe/verify':            { methods: ['POST'], scope: 'public', csrf: false, resource: 'none', serviceRole: true },
    'farcaster':              { methods: ['GET'],  scope: 'public', csrf: false, resource: 'none', serviceRole: false },
    'push/subscribe':         { methods: ['POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'push/test':              { methods: ['POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
    'marketplace/purchase':   { methods: ['POST'], scope: 'app', csrf: true, resource: 'self', serviceRole: true },
};
