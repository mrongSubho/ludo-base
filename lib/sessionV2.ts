/**
 * Session v2 Core Library (Server Authority Migration Phase 1).
 *
 * Implements:
 * - Scope model ('app' | 'match' | 'spectator')
 * - Secure cookie transport (__Host-ludo_session)
 * - Cryptographic token hashing (SHA-256)
 * - Challenge generation & single-use verification
 * - Scope isolation & capabilities
 * - CSRF verification for cookie-authenticated mutations
 *
 * See: docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.2, §4.3
 */

import crypto from 'node:crypto';
import { serviceDb } from './serverAuth';
import { buildSiweMessage } from './sessionProof';
import { verifyPersonalSign } from './walletVerify';
import { DEFAULT_CHAIN_ID } from './chains';
import type { Database } from '@/types/database.types';

export type SessionScope = 'app' | 'match' | 'spectator';

export type SessionCapability =
    | 'seat.play'
    | 'seat.assist'
    | 'room.own'
    | 'bet.settle'
    | 'match.record'
    | 'spectate'
    | 'chat.send'
    | 'profile.read'
    | 'profile.write'
    | 'presence'
    | 'lobby.manage'
    | 'matchmaking';

export type SessionRecord = Database['public']['Tables']['sessions']['Row'];
export type AuthChallengeRecord = Database['public']['Tables']['auth_challenges']['Row'];

// ─── TTL Constants ────────────────────────────────────────────────────────────

export const APP_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;    // 7 days absolute
export const APP_IDLE_TTL_MS = 30 * 60 * 1000;                 // 30 minutes idle
export const MATCH_SESSION_TTL_MS = 2 * 60 * 60 * 1000;        // 2 hours absolute
export const MATCH_IDLE_TTL_MS = 5 * 60 * 1000;                // 5 minutes idle grace
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;                 // 5 minutes single-use
export const MATCH_TICKET_TTL_MS = 30 * 1000;                  // 30s single-use WS ticket

// ─── Cookie Constants & Helpers ───────────────────────────────────────────────

export const PRIMARY_COOKIE_NAME = '__Host-ludo_session';
export const FALLBACK_COOKIE_NAME = 'ludo_session';

export function getSessionCookieName(): string {
    return process.env.NODE_ENV === 'production' ? PRIMARY_COOKIE_NAME : FALLBACK_COOKIE_NAME;
}

/** SHA-256 hash of the bearer token stored in sessions.token_hash */
export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/** Secure random opaque token */
export function generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/** Cryptographic random nonce for challenges */
export function generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

/** Builds the Set-Cookie string for a session token */
export function buildSessionCookieHeader(token: string, maxAgeSeconds: number = 7 * 86400): string {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieName = getSessionCookieName();
    const parts = [
        `${cookieName}=${token}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${maxAgeSeconds}`,
    ];
    // __Host- requires Secure flag; in prod or https always set Secure
    if (isProd || cookieName.startsWith('__Host-')) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/** Builds the Set-Cookie string to clear/revoke the session cookie */
export function buildClearCookieHeader(): string {
    const cookieName = getSessionCookieName();
    const parts = [
        `${cookieName}=`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=0',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ];
    if (process.env.NODE_ENV === 'production' || cookieName.startsWith('__Host-')) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/** Extracts session token from Cookie header or Authorization: Bearer */
export function parseSessionToken(request: Request): string | null {
    // 1. Check Cookie header (both primary __Host- and fallback)
    const cookieHeader = request.headers.get('cookie') || '';
    if (cookieHeader) {
        const cookies = cookieHeader.split(';').map((c) => c.trim());
        for (const c of cookies) {
            if (c.startsWith(`${PRIMARY_COOKIE_NAME}=`)) {
                return decodeURIComponent(c.slice(`${PRIMARY_COOKIE_NAME}=`.length));
            }
            if (c.startsWith(`${FALLBACK_COOKIE_NAME}=`)) {
                return decodeURIComponent(c.slice(`${FALLBACK_COOKIE_NAME}=`.length));
            }
        }
    }

    // 2. Check Authorization: Bearer <token> (capability probe fallback)
    const authHeader = request.headers.get('authorization') || '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) return token;
    }

    // 3. Check custom header x-session-id or x-session-token
    const xSession = request.headers.get('x-session-id') || request.headers.get('x-session-token');
    if (xSession) return xSession.trim();

    return null;
}

// ─── CSRF Verification ────────────────────────────────────────────────────────

/**
 * Validate CSRF for state-modifying requests.
 * Exempts Bearer-token requests (since custom headers cannot be set cross-site).
 */
export function validateCsrf(request: Request): boolean {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return true;
    }

    // Bearer auth is not subject to ambient browser cookie injection
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        return true;
    }

    // Check Sec-Fetch-Site (modern browsers)
    const secFetchSite = request.headers.get('sec-fetch-site');
    if (secFetchSite === 'cross-site') {
        return false;
    }

    // Check Origin vs Host
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (origin && host) {
        try {
            const originUrl = new URL(origin);
            const hostClean = host.split(':')[0].toLowerCase();
            const originHostClean = originUrl.hostname.toLowerCase();

            // Allow exact match or localhost in dev
            if (originHostClean === hostClean) return true;
            if (originHostClean === 'localhost' || originHostClean === '127.0.0.1') return true;

            // Check SIWE_ALLOWED_DOMAINS
            const allowedExtra = (process.env.SIWE_ALLOWED_DOMAINS || '')
                .split(',')
                .map((d) => d.trim().toLowerCase())
                .filter(Boolean);
            if (allowedExtra.includes(originHostClean)) return true;

            return false;
        } catch {
            return false;
        }
    }

    return true;
}

// ─── Scope & Capabilities ─────────────────────────────────────────────────────

/** Returns default capabilities granted to a scope */
export function getCapabilitiesForScope(scope: SessionScope, isMatchOwner: boolean = false): SessionCapability[] {
    switch (scope) {
        case 'app':
            return [
                'profile.read',
                'profile.write',
                'chat.send',
                'presence',
                'lobby.manage',
                'matchmaking',
            ];
        case 'match': {
            const caps: SessionCapability[] = ['seat.play', 'chat.send', 'spectate'];
            if (isMatchOwner) {
                caps.push('room.own', 'bet.settle', 'match.record');
            }
            return caps;
        }
        case 'spectator':
            return ['spectate'];
        default:
            return [];
    }
}

/** Check if a session scope possesses a required capability */
export function isCapabilityAllowed(scope: SessionScope, capability: SessionCapability, isMatchOwner: boolean = false): boolean {
    const granted = getCapabilitiesForScope(scope, isMatchOwner);
    return granted.includes(capability);
}

// ─── Database Operations ──────────────────────────────────────────────────────

/**
 * Creates a server-issued challenge nonce for wallet authentication (P4 fix).
 */
export async function createAuthChallenge(params: {
    ip?: string | null;
    userAgent?: string | null;
    walletAddress?: string | null;
    host?: string;
    chainId?: number;
}): Promise<{ challengeId: string; nonce: string; message: string; expiresAt: string }> {
    const nonce = generateNonce();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
    const domain = (params.host || 'ludobase.com').split(':')[0];
    const chainId = params.chainId ?? DEFAULT_CHAIN_ID;

    const db = serviceDb();
    const { data, error } = await db
        .from('auth_challenges')
        .insert({
            nonce,
            wallet_address: params.walletAddress ? params.walletAddress.toLowerCase() : null,
            ip: params.ip || null,
            user_agent: params.userAgent || null,
            expires_at: expiresAt,
        })
        .select('id, nonce, expires_at')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create challenge: ${error?.message || 'unknown error'}`);
    }

    const message = buildSiweMessage({
        domain,
        address: params.walletAddress || '0x0000000000000000000000000000000000000000',
        issuedAt: new Date().toISOString(),
        expirationTime: expiresAt,
        nonce,
        chainId,
    });

    return {
        challengeId: data.id,
        nonce: data.nonce,
        message,
        expiresAt: data.expires_at,
    };
}

/**
 * Atomically consumes a challenge and verifies the wallet signature (kills P4 replay).
 */
export async function verifyAndConsumeChallenge(params: {
    challengeId: string;
    signature: string;
    wallet: string;
    message: string;
    chainId?: number;
}): Promise<{ ok: boolean; code?: string; error?: string }> {
    const db = serviceDb();
    const wallet = params.wallet.toLowerCase();
    const chainId = params.chainId ?? DEFAULT_CHAIN_ID;

    // 1. Atomic consume: set consumed_at = now() WHERE id = challengeId AND consumed_at IS NULL AND expires_at > now()
    const nowIso = new Date().toISOString();
    const { data: challenge, error: challengeError } = await db
        .from('auth_challenges')
        .update({ consumed_at: nowIso })
        .eq('id', params.challengeId)
        .is('consumed_at', null)
        .gt('expires_at', nowIso)
        .select('id, nonce, wallet_address, expires_at')
        .maybeSingle();

    if (challengeError || !challenge) {
        return { ok: false, code: 'challenge-invalid-or-consumed', error: 'Challenge invalid, expired, or already used' };
    }

    if (challenge.wallet_address && challenge.wallet_address.toLowerCase() !== wallet) {
        return { ok: false, code: 'wallet-mismatch', error: 'Challenge was bound to a different wallet' };
    }

    // 2. Verify signature using 6492-aware verification
    const verdict = await verifyPersonalSign({
        address: wallet as `0x${string}`,
        message: params.message,
        signature: params.signature,
        chainId,
    });

    if (!verdict.ok) {
        return {
            ok: false,
            code: verdict.code,
            error: verdict.code === 'ecrecover-invalid' ? 'Invalid signature format' : 'Signer mismatch',
        };
    }

    return { ok: true };
}

/**
 * Issues an 'app' scoped session for a verified wallet.
 */
export async function issueAppSession(params: {
    wallet: string;
    deviceId?: string | null;
}): Promise<{ token: string; session: SessionRecord; cookieHeader: string }> {
    const db = serviceDb();
    const wallet = params.wallet.toLowerCase();
    const token = generateSessionToken();
    const tokenHash = hashToken(token);

    const now = Date.now();
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + APP_SESSION_TTL_MS).toISOString();
    const idleExpiresAt = new Date(now + APP_IDLE_TTL_MS).toISOString();

    // 1. Ensure player row exists
    await db
        .from('players')
        .upsert({ wallet_address: wallet }, { onConflict: 'wallet_address', ignoreDuplicates: true });

    // 2. Revoke prior active app sessions for this wallet
    await db
        .from('sessions')
        .update({ revoked_at: issuedAt })
        .eq('wallet_address', wallet)
        .eq('scope', 'app')
        .is('revoked_at', null);

    // 3. Insert new session row
    const { data: session, error } = await db
        .from('sessions')
        .insert({
            token_hash: tokenHash,
            wallet_address: wallet,
            scope: 'app',
            device_id: params.deviceId || null,
            issued_at: issuedAt,
            expires_at: expiresAt,
            idle_expires_at: idleExpiresAt,
            last_seen_at: issuedAt,
        })
        .select('*')
        .single();

    if (error || !session) {
        throw new Error(`Failed to issue session: ${error?.message || 'unknown error'}`);
    }

    const cookieHeader = buildSessionCookieHeader(token, Math.floor(APP_SESSION_TTL_MS / 1000));

    return { token, session, cookieHeader };
}

/**
 * Issues a 'match' or 'spectator' scoped session derived from an active 'app' session.
 */
export async function issueMatchSession(params: {
    appSessionToken: string;
    matchId: string;
    scope?: 'match' | 'spectator';
}): Promise<{ token: string; session: SessionRecord; ticket: string; cookieHeader: string }> {
    const db = serviceDb();
    const tokenHash = hashToken(params.appSessionToken);

    // 1. Validate the parent app session
    const { data: parentSession } = await db
        .from('sessions')
        .select('*')
        .eq('token_hash', tokenHash)
        .eq('scope', 'app')
        .is('revoked_at', null)
        .maybeSingle();

    if (!parentSession) {
        throw new Error('Valid app session required to enter match');
    }

    if (new Date(parentSession.expires_at).getTime() <= Date.now()) {
        throw new Error('App session has expired');
    }

    const targetScope: SessionScope = params.scope || 'match';

    // 2. If seat 'match' scope requested, verify membership in matches.participants
    if (targetScope === 'match') {
        const { data: match } = await db
            .from('matches')
            .select('participants')
            .eq('id', params.matchId)
            .maybeSingle();

        if (!match) {
            throw new Error('Match not found');
        }

        const participants = Array.isArray(match.participants) ? match.participants : [];
        const isParticipant = participants.some(
            (p: string) => p.toLowerCase() === parentSession.wallet_address.toLowerCase(),
        );

        if (!isParticipant) {
            throw new Error('Wallet is not a participant in this match');
        }
    }

    const token = generateSessionToken();
    const matchTokenHash = hashToken(token);
    const now = Date.now();
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + MATCH_SESSION_TTL_MS).toISOString();
    const idleExpiresAt = new Date(now + MATCH_IDLE_TTL_MS).toISOString();

    const { data: session, error } = await db
        .from('sessions')
        .insert({
            token_hash: matchTokenHash,
            wallet_address: parentSession.wallet_address,
            scope: targetScope,
            match_id: params.matchId,
            device_id: parentSession.device_id,
            issued_at: issuedAt,
            expires_at: expiresAt,
            idle_expires_at: idleExpiresAt,
            rotated_from: parentSession.id,
            last_seen_at: issuedAt,
        })
        .select('*')
        .single();

    if (error || !session) {
        throw new Error(`Failed to issue match session: ${error?.message || 'unknown'}`);
    }

    // A single-use short-lived ticket for WS upgrade
    const ticket = generateSessionToken();
    const cookieHeader = buildSessionCookieHeader(token, Math.floor(MATCH_SESSION_TTL_MS / 1000));

    return { token, session, ticket, cookieHeader };
}

/**
 * Revokes a session given its token.
 */
export async function revokeSessionByToken(token: string): Promise<boolean> {
    const db = serviceDb();
    const tokenHash = hashToken(token);
    const { error } = await db
        .from('sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token_hash', tokenHash)
        .is('revoked_at', null);

    return !error;
}
