/**
 * Lobby join trust boundary (Phase 3 / SEC-12).
 *
 * `POST /api/lobby/join` used to take `wallet` and `coins` straight from the
 * body and write them into `lobby_join_requests`. So a request could be filed
 * against someone else's wallet, and the host saw a coin balance the guest
 * chose — which the host panel then rendered as a "Low chip" warning.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

const route = code('app/api/lobby/join/route.ts');
const teamUp = code('hooks/TeamUpContext.tsx');

test('SEC-12: the wallet comes from the session, not the body', () => {
    assert.match(route, /const wallet = await requireAppSession\(/);
    // The old line read a caller-supplied string with a length check.
    assert.doesNotMatch(route, /const wallet = String\(body\.wallet/, 'the wallet must not be read from the body');
    assert.doesNotMatch(route, /wallet\.length < 3/, 'a length check on an unverified string is not auth');
    // `wallet` is still accepted, but only as the session's own wallet claim.
    assert.match(route, /body\.walletAddress \?\? body\.wallet/, 'legacy field tolerated, verified anyway');
    // Scoped to the POST branch: GET and DELETE have their own 401s, so a
    // whole-file match would pass even with this gate removed.
    const post = route.slice(route.indexOf('export async function POST'), route.indexOf('export async function GET'));
    assert.match(post, /if \(!wallet\)/, 'no session means no join');
    assert.match(post, /status: 401/);
});

test('SEC-12: the client-declared coins field is gone', () => {
    assert.doesNotMatch(route, /body\.coins/, 'coins must never be read from the body');
    assert.doesNotMatch(route, /coins:\s*typeof body/, 'the insert must not persist a caller-supplied balance');
    // Nor advertised back to the host: nothing writes it, so selecting it would
    // advertise a permanently-null field.
    assert.doesNotMatch(route, /desired_seat, coins, created_at/);
});

test('SEC-12: the insert uses the session-derived wallet', () => {
    assert.match(route, /from\('lobby_join_requests'\)\.insert\(\{[\s\S]*?wallet_address: wallet,/);
});

test('SEC-12: joining is throttled per wallet and room', () => {
    assert.match(route, /checkRateLimit\(/);
    // Keyed on BOTH: per-room would let one wallet flood many rooms, per-wallet
    // would let a caller spam a single room.
    assert.match(route, /rateKey\(`lobby:join:\$\{roomCode\}`, wallet\)/);
    assert.match(route, /status: 429/);
});

test('the client sends a session and no longer invents a wallet or a balance', () => {
    const join = teamUp.slice(teamUp.indexOf("'/api/lobby/join'"));
    assert.match(join, /sessionId,/, 'the POST body must carry a session');
    assert.match(join, /walletAddress: myAddress/, 'it may send its own address as the session claim');
    assert.doesNotMatch(join.slice(0, 600), /\bcoins\b/, 'no client-declared balance');
    // The host's request shape must not read coins either.
    const listing = teamUp.slice(teamUp.indexOf('data?.requests || []'));
    assert.doesNotMatch(listing.slice(0, 400), /coins\?:/, 'the host listing type must not carry coins');
    assert.doesNotMatch(teamUp, /typeof req\.coins === 'number'/, 'the host must not read a balance from the request');
});

test('SEC-12: the invite secret gate is dead code and is flagged as such', () => {
    // `join_secret_hash` is only ever SELECTed, never written — so the
    // invite-link gate never fires. That is a real gap, and it is why the
    // session is now the primary gate rather than the secret.
    assert.match(route, /join_secret_hash/, 'the check is still present');
    const writers = read('app/api/lobby/join/route.ts').includes('join_secret_hash:');
    assert.equal(writers, false, 'this route must not write the hash it checks');
});

// ── The friendship requirement is NOT implemented, deliberately ────────────

test('SEC-12 friendship is deliberately NOT required, and the reason is recorded', () => {
    // Matchmaking pairs STRANGERS by design: QuickMatchPanel joins a room found
    // by the queue, and `allowOpenJoins()` clears the room secret for exactly
    // that flow. Requiring an accepted friendship would break quick match
    // outright, so it is left out pending a product decision rather than
    // shipping a broken queue.
    const quick = code('app/components/QuickMatchPanel.tsx');
    assert.match(quick, /joinGame\(foundRoomCode, validationToken\)/, 'quick match still joins rooms it did not create');
    assert.doesNotMatch(route, /from\('friendships'\)/, 'friendship is not gated in this route yet');
});
