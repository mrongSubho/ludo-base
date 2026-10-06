/**
 * Lobby join doors (Phase 3 / SEC-12, product decision: quick match gets its own door).
 *
 * SEC-12 originally said "require an accepted friendship with the host". That
 * cannot be a blanket rule: the queue pairs STRANGERS, so it would break quick
 * match outright. The resolution is an explicit per-room door:
 *
 *   matchmaking  credential = the queue's validation_token. Friendship is NOT
 *                required — the queue did the introducing.
 *   invite       credential = a server-minted room secret AND an accepted
 *                friendship with the host.
 *   open         session only, the pre-SEC-12 behaviour.
 *
 * The test that matters most is the negative one: an invite door must actually
 * refuse a non-friend, or the whole decision is decorative.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SESSION_GATED, RATE_LIMITS, ruleFor } from '../lib/rateLimitRoutes';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

const policyRoute = code('app/api/lobby/policy/route.ts');
const joinRoute = code('app/api/lobby/join/route.ts');
const teamUp = code('hooks/TeamUpContext.tsx');
const migration = read('supabase/migrations/202609300012_lobby_join_policy.sql');

// ── The door vocabulary exists ──────────────────────────────────────────────

test('the migration defines exactly three doors', () => {
    assert.match(migration, /create table if not exists public\.lobby_join_policies/);
    assert.match(migration, /check \(join_policy in \('matchmaking', 'invite', 'open'\)\)/);
    assert.match(migration, /enable row level security/);
    assert.match(migration, /revoke all on public\.lobby_join_policies from anon, authenticated/);
    assert.match(migration, /^begin;/m, 'the A4 schema gate requires a transaction');
});

test('the host declares the door through a session-gated route', () => {
    assert.match(policyRoute, /requireAppSession\(body\.walletAddress, body\.sessionId\)/);
    assert.match(policyRoute, /Not the room host/, 'only the host may set the door');
    assert.match(policyRoute, /checkRateLimit\(/, 'and it is rate-limited');
    assert.match(policyRoute, /A matchmaking room needs the queue validation_token/);
});

// ── Quick match gets its own door ───────────────────────────────────────────

test('the matchmaking door requires the queue token, NOT a friendship', () => {
    assert.match(joinRoute, /if \(door === 'matchmaking'\)/);
    assert.match(joinRoute, /Invalid matchmaking ticket/);
    // The ticket comparison itself, not just the branch name: a declared door
    // with no credential must fail closed rather than wave the guest in.
    assert.match(joinRoute, /!policyRow\?\.credential_hash/);
    // Scoped to the matchmaking branch. There are two identical credential
    // comparisons in this file (matchmaking and invite), so a whole-file match
    // would still pass with the queue check removed.
    const mmBranch = joinRoute.slice(
        joinRoute.indexOf("door === 'matchmaking'"),
        joinRoute.indexOf("door === 'invite'"),
    );
    assert.match(
        mmBranch,
        /!secret \|\| sha256Hex\(secret\.trim\(\)\) !== policyRow\.credential_hash/,
        'the queue token must actually be compared inside the matchmaking branch',
    );
    // The friendship check must not appear inside the matchmaking branch: a
    // quick-match pair are strangers by definition.
    const mm = joinRoute.slice(joinRoute.indexOf("door === 'matchmaking'"), joinRoute.indexOf("door === 'invite'"));
    assert.doesNotMatch(mm, /areAcceptedFriends/, 'quick match must not require friendship');
});

test('the invite door requires BOTH a secret and a friendship', () => {
    assert.match(joinRoute, /door === 'invite'/);
    assert.match(joinRoute, /Invalid invite secret/);
    assert.match(joinRoute, /if \(!\(await areAcceptedFriends\(wallet, hostAddress\)\)\)/);
    assert.match(joinRoute, /invite-only/);
    // Friendship must come AFTER the secret is proven, so an attacker cannot
    // probe who is friends with a host without the link.
    const invite = joinRoute.slice(joinRoute.indexOf("door === 'invite'"));
    assert.ok(
        invite.indexOf('credential_hash') < invite.indexOf('areAcceptedFriends'),
        'the secret is checked before the friendship list is consulted',
    );
});

test('an undeclared room stays open — the door is opt-in, never implicit', () => {
    assert.match(joinRoute, /policyRow\?\.join_policy \|\| 'open'/, 'no row means open');
    assert.match(joinRoute, /Room is not ready to accept joins/, 'a declared door with no credential fails closed');
});

test('the invite secret is minted by the server, not chosen by the host', () => {
    // A host who picked their own secret could omit it from the link and hand
    // out room codes instead. The server mints it.
    assert.match(policyRoute, /randomBytes\(24\)/);
    assert.match(policyRoute, /roomSecret \|\| minted/);
    assert.match(policyRoute, /roomSecret: policy === 'invite'/);
});

// ── Friendship is never reached through a filter string ────────────────────

test('the friendship check uses two .eq() queries, never .or()', () => {
    assert.match(joinRoute, /async function areAcceptedFriends/);
    const fn = joinRoute.slice(joinRoute.indexOf('async function areAcceptedFriends'), joinRoute.indexOf('export async function'));
    // Two queries, each pinned on status plus both addresses.
    assert.equal((fn.match(/\.from\('friendships'\)/g) || []).length, 2, 'exactly two queries');
    assert.equal((fn.match(/\.eq\(/g) || []).length, 6, 'each query pins status and both addresses');
    assert.doesNotMatch(fn, /\.or\(/, 'never interpolate into .or() (SEC-08)');
});

// ── The host wires it up ────────────────────────────────────────────────────

test('hostGame declares a door, defaulting to the pre-existing behaviour', () => {
    assert.match(teamUp, /async function declareLobbyPolicy|const declareLobbyPolicy = useCallback/);
    assert.match(teamUp, /const door = joinPolicy \|\| \(expectedValidationToken \? 'matchmaking' : 'open'\)/);
    assert.match(teamUp, /void declareLobbyPolicy\(code, door, expectedValidationToken\)/);
    // The minted secret is adopted so `inviteLinkFor` can append `?s=`.
    assert.match(teamUp, /setRoomSecret\(String\(data\.roomSecret\)\)/);
});

test('the door is published on the context type', () => {
    assert.match(teamUp, /hostGame: \(roomId\?: string, expectedValidationToken\?: string, joinPolicy\?/);
});

// ── The policy route is classified, and the client degrades safely ──────────

test('the new route exists, is classified, and is not unlimited', () => {
    assert.ok(existsSync(at('app/api/lobby/policy/route.ts')), 'the policy route must exist');
    assert.ok(SESSION_GATED.has('lobby/policy'), 'lobby/policy must be classified');
    assert.equal(ruleFor('lobby/policy'), null, 'and must not be IP-limited — it is session-gated');
    assert.equal(RATE_LIMITS['lobby/policy'], undefined);
});

test('a failure to declare the door does not break the lobby', () => {
    // The host must still be able to host if this call fails: an open room is
    // the fallback and the route treats a missing policy row as 'open'.
    assert.match(teamUp, /catch \{ \/\* the room still works; the door stays open \*\/ \}/);
});

function at(p: string): string {
    return join(root, p);
}
