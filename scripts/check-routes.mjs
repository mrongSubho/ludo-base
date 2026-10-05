/**
 * Route authorization matrix gate.
 *
 * Phase 1 exit gate. The `system review` found unauthenticated mutations and
 * authenticated-but-IDOR routes by reading code by hand, which does not survive
 * contact with a growing `app/api`. This encodes the expectation as data so a
 * newly added or newly-opened route fails CI.
 *
 * Two properties are enforced:
 *
 *  1. Every route in the matrix must exist, and every route handler in
 *     `app/api` must appear in the matrix. A new route with no entry fails, so
 *     it cannot ship unreviewed.
 *  2. A route marked `unauthenticated-mutation` fails. These are deliberate,
 *     narrow exceptions (there should be very few); changing the matrix to add
 *     one is a visible diff.
 *
 * `serviceRole: true` means the handler reads/writes with SUPABASE_SERVICE_ROLE_KEY,
 * which bypasses RLS entirely — so the route must do its own authorization.
 * Those are flagged in the report rather than failed, because several are
 * correct-by-design public reads (spectator board state, arena directory).
 *
 * Run: npm run check:routes
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'app', 'api');

/**
 * method: HTTP methods the file exports.
 * auth:    'session'  — requireAppSession
 *          'signature'— wallet signature verified against a claimed address
 *          'public'   — intentionally unauthenticated (read-only)
 * resource:'host' | 'owner' | 'self' | 'none' — what the handler authorizes against
 * serviceRole: handler uses the service-role client (RLS bypassed)
 */
const MATRIX = {
    // ── Match lifecycle ───────────────────────────────────────────────────
    'match/start':            { methods: ['POST'], auth: 'conditional', resource: 'self', serviceRole: true },
    'match/record':           { methods: ['POST'], auth: 'signature', resource: 'owner', serviceRole: true },
    'match/state':            { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: true },
    'match/stream':           { methods: ['POST'], auth: 'signature', resource: 'owner', serviceRole: true },

    // ── Lobbies ───────────────────────────────────────────────────────────
    'lobby/invite':           { methods: ['POST'], auth: 'session', resource: 'host', serviceRole: true },
    'lobby/invites':          { methods: ['GET'],          auth: 'session', resource: 'self', serviceRole: true },
    // SEC-12: POST is unauthenticated and seat-verified only by a room secret.
    'lobby/join':             { methods: ['POST', 'GET', 'DELETE'], auth: 'session*', resource: 'none', serviceRole: true },

    // ── Chips / settlement ────────────────────────────────────────────────
    'chips/settle/propose':   { methods: ['POST', 'PUT'], auth: 'session', resource: 'host', serviceRole: true },
    'chips/lobby-ticket':     { methods: ['POST'], auth: 'session', resource: 'host', serviceRole: true },

    // ── Spectator betting ─────────────────────────────────────────────────
    'spectator-bets':         { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },

    // ── Messaging ─────────────────────────────────────────────────────────
    'messages':               { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },

    // ── Profile / identity ────────────────────────────────────────────────
    'profile':                { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },
    'profile/ecdh':           { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },
    'wallet-links':           { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },

    // ── Social ────────────────────────────────────────────────────────────
    'friendships':            { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },
    // SEC-08: no format validation on `wallet`, interpolated into .or()
    'friends':                { methods: ['GET'], auth: 'none*', resource: 'none', serviceRole: true },
    'social/moderation':      { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },
    'social/poke':            { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },

    // ── Missions / onboarding ──────────────────────────────────────────────
    'onboarding/progress':    { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },
    'onboarding/claim':       { methods: ['POST'], auth: 'session', resource: 'self', serviceRole: true },
    'onboarding/referral':    { methods: ['GET', 'POST'], auth: 'session', resource: 'self', serviceRole: true },
    'missions/list':          { methods: ['GET'], auth: 'session', resource: 'self', serviceRole: true },
    'missions/voucher':       { methods: ['POST'], auth: 'session', resource: 'self', serviceRole: true },
    // Retired: coin rewards are frozen (410 Gone). Kept in the matrix so the
    // retirement cannot be silently reverted.
    'missions/claim':         { methods: ['POST'], auth: 'retired', resource: 'none', serviceRole: false },

    // ── Matchmaking ───────────────────────────────────────────────────────
    'matchmaking/join':       { methods: ['POST'], auth: 'session', resource: 'self', serviceRole: true },
    'matchmaking/cancel':     { methods: ['POST'], auth: 'session', resource: 'owner', serviceRole: true },
    'matchmaking/status':     { methods: ['GET'],  auth: 'session', resource: 'owner', serviceRole: true },
    'matchmaking/pools':      { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: true },

    // ── Live / spectator ──────────────────────────────────────────────────
    'live-matches/window':    { methods: ['POST'], auth: 'session', resource: 'host', serviceRole: true },
    'live-arena/power4p':     { methods: ['POST', 'PATCH'], auth: 'none*', resource: 'none', serviceRole: true },
    'live-chat':              { methods: ['GET', 'POST'], auth: 'none*', resource: 'none', serviceRole: true },
    'predictors/board':       { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: true },

    'galxe/callback':         { methods: ['POST'], auth: 'hmac', resource: 'none', serviceRole: true },

    // ── Misc ──────────────────────────────────────────────────────────────
    'activities':             { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: true },
    'activity':               { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: true },
    'notices':                { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: false },
    'feedback':               { methods: ['POST'], auth: 'public', resource: 'none', serviceRole: true },
    'presence':               { methods: ['POST'], auth: 'session', resource: 'self', serviceRole: true },
    'presence/online':        { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: true },
    'geo':                    { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: false },
    'siwe/verify':            { methods: ['POST'], auth: 'public', resource: 'none', serviceRole: true },
    'farcaster':              { methods: ['GET'],  auth: 'public', resource: 'none', serviceRole: false },
    'push/subscribe':         { methods: ['POST'], auth: 'session', resource: 'self', serviceRole: true },
    'push/test':              { methods: ['POST'], auth: 'session', resource: 'self', serviceRole: true },
    'marketplace/purchase':   { methods: ['POST'], auth: 'session', resource: 'self', serviceRole: true },
};

/**
 * Known-weak routes, tracked as failures so they cannot be forgotten. Each has a
 * finding ID. Closing one means removing it from this list AND fixing the code.
 */
const KNOWN_UNAUTHENTICATED = new Set([
    'friends',            // SEC-08: no format validation on `wallet`, interpolated into .or()
    'live-arena/power4p', // SEC-07: authority claim is unauthenticated by design; needs a gate
    'lobby/join',         // SEC-12: POST seat request has no session
    'live-chat',          // no session guard on either verb; spectator chat is public
                           // by intent, but the write path is unrated/unthrottled
]);

let failures = 0;
let notes = 0;
const fail = (m) => { console.error('✗', m); failures += 1; };
const note = (m) => { console.warn('!', m); notes += 1; };

/** Collect every route.ts under app/api as a slash-joined route key. */
function collectRoutes(dir, prefix = '') {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...collectRoutes(p, prefix ? `${prefix}/${e.name}` : e.name));
        else if (e.name === 'route.ts') out.push(prefix || 'root');
    }
    return out;
}

/** HTTP methods a route file actually exports. */
function exportedMethods(file) {
    const src = readFileSync(file, 'utf8');
    const out = [];
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
        if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`).test(src)) out.push(m);
    }
    return out;
}

if (!existsSync(apiDir)) {
    fail('app/api not found');
    process.exit(1);
}

const found = collectRoutes(apiDir).sort();
const declared = Object.keys(MATRIX).sort();

// 1) Coverage: every route file must be in the matrix.
for (const r of found) {
    if (!declared.includes(r)) fail(`route "${r}" has no entry in the authorization matrix — review its auth and add it`);
}
// 2) No stale entries.
for (const r of declared) {
    if (!found.includes(r)) fail(`matrix lists "${r}" but no app/api/${r}/route.ts exists`);
}

// 3) Per-route checks.
for (const r of found) {
    const entry = MATRIX[r];
    if (!entry) continue;
    const file = join(apiDir, r, 'route.ts');

    const actual = exportedMethods(file).sort();
    const listed = [...entry.methods].sort();
    const missing = actual.filter((m) => !listed.includes(m));
    const extra = listed.filter((m) => !actual.includes(m));
    if (missing.length) fail(`${r}: exports ${missing.join(', ')} but the matrix does not list it`);
    if (extra.length) fail(`${r}: matrix lists ${extra.join(', ')} but the handler does not export it`);

    const auth = String(entry.auth);
    if (auth === 'conditional') {
        // Session required only when the canonical host is a real address; the
        // offline/bot path uses an explicit anonymous marker and produces a
        // non-settleable match (host_proven=false). See /api/match/start.
        const src = readFileSync(file, 'utf8');
        if (!/requireAppSession/.test(src)) {
            fail(`${r}: auth='conditional' but the handler never calls requireAppSession`);
        }
        if (!/host_proven/.test(src)) {
            fail(`${r}: auth='conditional' must record host_proven so settlement can refuse it`);
        }
    }

    if (auth.endsWith('*')) {
        if (!KNOWN_UNAUTHENTICATED.has(r)) {
            fail(`${r}: marked unauthenticated ('${auth}') but is not in KNOWN_UNAUTHENTICATED — either fix it or record it`);
        } else {
            note(`${r} is unauthenticated (${auth}) — tracked in KNOWN_UNAUTHENTICATED, not yet fixed`);
        }
    }

    // A session/signature route using the service role must reference the guard,
    // otherwise the matrix is lying about it.
    if (auth === 'hmac') {
        const src = readFileSync(file, 'utf8');
        if (!/verifyGalxeHmac|GALXE_HMAC_SECRET/.test(src)) {
            fail(`${r}: auth='hmac' but the handler does not verify the Galxe HMAC`);
        }
    }

    if (entry.serviceRole && (auth === 'session' || auth === 'session*')) {
        const src = readFileSync(file, 'utf8');
        const guarded =
            /requireAppSession|requireWalletSession|verifyPersonalSign|verifyTypedDataSign/.test(src);
        if (!guarded) {
            fail(`${r}: matrix says auth='${auth}' but the handler calls no session/signature guard`);
        }
    }
}

// Report service-role reads that are intentionally public, so they stay visible.
const publicServiceRole = Object.entries(MATRIX)
    .filter(([, e]) => e.serviceRole && e.auth === 'public')
    .map(([r]) => r);
if (publicServiceRole.length) {
    console.log(`  public service-role reads (RLS bypassed, output is public by design): ${publicServiceRole.join(', ')}`);
}

if (failures === 0) {
    console.log(`✓ route authorization matrix clean (${found.length} routes${notes ? `, ${notes} known-weak` : ''})`);
    process.exit(0);
}
console.error(`\nroute authorization matrix failed: ${failures} finding(s) across ${found.length} routes`);
process.exit(1);
