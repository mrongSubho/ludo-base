/**
 * Batch 1 — SIWE, upstream URL validation, wallet links, ECDH keys
 * (Phase 3 / SEC-21, SEC-23, SEC-24, SEC-25).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizeP256Jwk, isCanonicalP256Jwk } from '../lib/validation/ecdhJwk';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

// ── SEC-25: the private scalar must never be stored ─────────────────────────

test('SEC-25: a JWK carrying `d` is refused, not stripped', () => {
    const good = {
        kty: 'EC', crv: 'P-256',
        x: 'A'.repeat(43), y: 'B'.repeat(43),
    };
    assert.equal(canonicalizeP256Jwk(good).ok, true);

    // The vulnerability: a private scalar posted alongside the public key was
    // persisted verbatim and then served back by GET.
    const withD = { ...good, d: 'C'.repeat(43) };
    const v = canonicalizeP256Jwk(withD);
    assert.equal(v.ok, false);
    assert.ok(v.ok === false && v.error.includes('d'));
});

test('SEC-25: every unexpected member is refused', () => {
    const good = { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) };
    for (const member of ['key_ops', 'ext', 'alg', 'use']) {
        const v = canonicalizeP256Jwk({ ...good, [member]: 'anything' });
        assert.equal(v.ok, false, `${member} must be refused`);
    }
});

test('SEC-25: the curve, key type and coordinate lengths are enforced', () => {
    const x = 'A'.repeat(43);
    const y = 'B'.repeat(43);
    const bad: [unknown, string][] = [
        [{ kty: 'RSA', crv: 'P-256', x, y }, 'kty'],
        [{ kty: 'EC', crv: 'P-384', x, y }, 'crv'],
        [{ kty: 'EC', crv: 'P-256', x, y: 'B'.repeat(42) }, '32 bytes'],
        [{ kty: 'EC', crv: 'P-256', x: 'A'.repeat(42), y }, '32 bytes'],
        [{ kty: 'EC', crv: 'P-256', x: `${'A'.repeat(42)}=`, y }, 'base64url'],
        [{ kty: 'EC', crv: 'P-256', x: 1, y }, 'base64url'],
        ['not-an-object', 'JWK object'],
        [null, 'JWK object'],
        [[], 'JWK object'],
    ];
    for (const [input, needle] of bad) {
        const v = canonicalizeP256Jwk(input);
        assert.equal(v.ok, false, `${JSON.stringify(input)} must be refused`);
        assert.ok(v.ok === false && v.error.toLowerCase().includes(needle.toLowerCase().split(' ')[0]));
    }
});

test('SEC-25: the returned key contains only the four accepted fields', () => {
    const v = canonicalizeP256Jwk({
        kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43), extra: 'nope',
    });
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.deepEqual(Object.keys(v.key).sort(), ['crv', 'kty', 'x', 'y']);
    // An unknown member is dropped by construction.
    assert.equal(isCanonicalP256Jwk(v.key), true);
});

test('SEC-25: the route persists the canonical key, not the posted object', () => {
    const src = code('app/api/profile/ecdh/route.ts');
    assert.match(src, /canonicalizeP256Jwk\(publicKey\)/);
    assert.match(src, /ecdh_pubkey: canonical\.key/);
    assert.doesNotMatch(src, /ecdh_pubkey: publicKey/, 'the posted blob must never be stored');
});

// ── SEC-21: the SIWE domain must be one we serve ───────────────────────────

test('SEC-21: the signed domain is compared against the request Host', () => {
    const src = code('app/api/siwe/verify/route.ts');
    // The bug: `domain` was signed AND used to rebuild the message, so a
    // signature harvested on an attacker's domain replayed here and minted a
    // session. Signing a value does not help when the server supplies it too.
    assert.match(src, /request\.headers\.get\('host'\)/);
    assert.match(src, /allowedDomains\(host\)/);
    assert.match(src, /allowed\.has\(String\(domain\)\.toLowerCase\(\)\)/);
    assert.match(src, /status: 401/, 'a foreign domain is refused');
    // The allowlist is extensible for aliases, since Host alone would reject
    // a legitimate custom domain with no safe default.
    assert.match(src, /SIWE_ALLOWED_DOMAINS/);
});

test('SEC-21: a nonce is single-use', () => {
    const src = code('app/api/siwe/verify/route.ts');
    assert.match(src, /\.eq\('nonce', nonce\)/, 'the nonce must be looked up before insert');
    assert.match(src, /Nonce already used/);
    assert.match(src, /status: 409/);
});

test('SEC-21: no raw database error is returned', () => {
    const src = code('app/api/siwe/verify/route.ts');
    // Scoped to what reaches the RESPONSE. The log lines legitimately carry
    // code/message/hint, so a whole-file match on ".message" is useless here.
    const bodies = [...src.matchAll(/NextResponse\.json\(\{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(bodies.length > 5, `expected several response bodies, found ${bodies.length}`);
    for (const body of bodies) {
        assert.ok(
            !/\.message\b/.test(body),
            `a response body echoes a raw message: {${body}}`,
        );
    }
});

// ── SEC-23: nothing unvalidated reaches an upstream URL ─────────────────────

test('SEC-23: farcaster validates before the Neynar call and encodes it', () => {
    const src = code('app/api/farcaster/route.ts');
    assert.match(src, /normalizeWallet\(raw\)/);
    assert.match(src, /Invalid wallet address/);
    assert.match(src, /encodeURIComponent\(wallet\)/);
    // Ordering matters: validate first, then spend the key.
    assert.ok(src.indexOf('normalizeWallet') < src.indexOf('api.neynar.com'));
});

test('SEC-23: activity and matchmaking/pools validate their wallet inputs', () => {
    const act = code('app/api/activity/route.ts');
    assert.match(act, /normalizeWallet\(/);
    assert.match(act, /requireAppSession\(/, 'and it needs a session — each call spends ETHERSCAN_API_KEY');
    assert.match(act, /session !== wallet/);

    const pools = code('app/api/matchmaking/pools/route.ts');
    assert.match(pools, /normalizeWallet\(rawExclude\)/);
    assert.match(pools, /Invalid wallet address/);
});

// ── SEC-24: wallet links need a session and a fresh proof ──────────────────

test('SEC-24: reading links needs a session for that exact wallet', () => {
    const src = code('app/api/wallet-links/route.ts');
    assert.match(src, /requireAppSession\(/);
    assert.match(src, /session !== wallet/);
    assert.doesNotMatch(src, /\.or\(`primary_wallet/, 'no interpolation into .or() (SEC-08)');
    assert.match(src, /\.eq\("primary_wallet", wallet\)/);
    assert.match(src, /\.eq\("linked_wallet", wallet\)/);
});

test('SEC-24: creating a link requires a fresh signed proof', () => {
    const src = code('app/api/wallet-links/route.ts');
    assert.match(src, /isFreshIssuedAt\(issuedAt\)/);
    assert.match(src, /Link proof expired/);
});

test('the link panel passes a session', () => {
    const src = code('app/components/WalletLinkPanel.tsx');
    assert.match(src, /peekAppSession\(\)/);
    assert.match(src, /sessionId=\$\{encodeURIComponent\(sid\)\}/);
    assert.match(src, /encodeURIComponent\(wallet\)/);
});

test('the activity hook passes a session', () => {
    const src = code('hooks/useWalletActivity.ts');
    assert.match(src, /peekAppSession\(\)/);
    assert.match(src, /api\/activity\?wallet=\$\{encodeURIComponent\(address\)\}/);
});
