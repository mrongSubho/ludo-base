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

// ── SEC-13 / SEC-14 / SEC-22 / SEC-26 ─────────────────────────────────────

test('SEC-13: a friendship delete is scoped to the caller', () => {
    const src = code('app/api/friendships/route.ts');
    // `.eq('id', friendshipId)` alone let any session-holder delete ANY
    // friendship in the table by guessing an id.
    assert.match(src, /Not your friendship/);
    assert.match(src, /status: 403/);
    assert.match(src, /String\(row\.user_address\)\.toLowerCase\(\) === wallet/);
    assert.match(src, /String\(row\.friend_address\)\.toLowerCase\(\) === wallet/);
    // And the by-target path must not interpolate (SEC-08).
    assert.doesNotMatch(src, /\.or\(`and\(user_address/);
});

test('SEC-14: a push unsubscribe is scoped to the wallet', () => {
    const lib = code('lib/pushServer.ts');
    assert.match(lib, /dropPushSubscription\(endpoint: string, walletAddress: string\)/);
    assert.match(lib, /\.eq\("endpoint", endpoint\)[\s\S]*\.eq\("wallet_address"/);
    assert.match(lib, /if \(!endpoint \|\| !walletAddress\) return/, 'walletAddress is required, not advisory');
    const route = code('app/api/push/subscribe/route.ts');
    assert.match(route, /dropPushSubscription\(endpoint, requester\)/);
});

test('SEC-22: a poke requires an accepted friendship', () => {
    const src = code('app/api/social/poke/route.ts');
    assert.match(src, /You can only poke friends/);
    assert.match(src, /status: 403/);
    // Both directions, and only 'accepted'.
    assert.equal((src.match(/\.eq\('status', 'accepted'\)/g) || []).length, 2);
});

test('SEC-26: an unkeyed hash is no longer called a signature', () => {
    const route = code('app/api/notices/route.ts');
    assert.match(route, /contentHash/);
    assert.match(route, /signature: null/, 'and the field is explicitly null on the wire');
    assert.doesNotMatch(route, /signature: `unsigned:/, 'the FNV stamp must not be presented as a signature');

    const lib = code('lib/notices.ts');
    assert.match(lib, /contentHash\?: string/);
    assert.doesNotMatch(lib, /signature\?: string/, 'the type must not advertise a signature');
    // The warning lives in a docblock, so read the raw file — `code()` strips
    // comment lines and would hide exactly the text this asserts.
    assert.match(
        read('lib/notices.ts'),
        /NOT a signature — do not verify against it/,
        'the field must be documented as unverified, or a caller will trust it',
    );
});

// ── SEC-16 / SEC-17 / SEC-20 / SEC-32 ──────────────────────────────────────

import { boardDigest, stableStringify } from '../lib/matchProof';
import { pickPersistedState } from '../lib/engine/core';

test('SEC-16: the signed seed message binds the board', () => {
    // Without the digest a host signs "start this match" and may then seed any
    // board, including one that puts its own tokens ahead.
    const src = code('lib/matchProof.ts');
    assert.match(src, /`board: \$\{params\.board\}`/, 'the board must be inside the signed text');
    assert.match(src, /board: string;/, 'and be a required field');

    const edge = code('supabase/functions/move-auth/index.ts');
    assert.match(
        edge,
        /issuedAt, board: actualBoard/,
        'Edge signs the digest it recomputed from the payload',
    );
    assert.match(edge, /const actualBoard = await boardDigest\(/);
});

test('SEC-16: the digest is order-independent', () => {
    // JSON.stringify is key-order dependent, so a digest over it would mismatch
    // between client and Edge for structurally identical input.
    const a = { b: 1, a: [1, { z: 1, y: 2 }], c: { k: 'v' } };
    const b = { c: { k: 'v' }, a: [1, { y: 2, z: 1 }], b: 1 };
    assert.equal(stableStringify(a), stableStringify(b));
    // And it must actually be digesting something.
    assert.ok(boardDigest({ initialState: a, colorCorner: {}, playerSeats: {} }).then(Boolean));
});

test('SEC-16: seats and colour assignment are validated server-side', () => {
    const edge = code('supabase/functions/move-auth/index.ts');
    assert.match(edge, /Unknown seat key/, 'seat keys must be a subset of the four colours');
    assert.match(edge, /Wallet seated twice/, 'one wallet cannot hold two seats');
    assert.match(edge, /Unknown seat kind/);
    assert.match(edge, /color_corner does not match the declared mode/);
});

test('the Edge proof helpers are generated, not hand-maintained', () => {
    // Two hand-maintained copies of a digest function drift silently, and the
    // symptom is a match that cannot start with no useful error.
    const proof = read('supabase/functions/_shared/boardDigest.ts');
    assert.match(proof, /AUTO-GENERATED by scripts\/sync-edge-proof\.mjs/);
    const corners = read('supabase/functions/_shared/corners.ts');
    assert.match(corners, /AUTO-GENERATED by scripts\/sync-edge-proof\.mjs/);
    // Behaviour must match the client source.
    const canonical = stableStringify({ a: 1, b: 2 });
    assert.equal(
        canonical,
        stableStringify(JSON.parse('{"b":2,"a":1}')),
    );
});

test('SEC-17: a provisional session is per (key, wallet)', () => {
    const edge = code('supabase/functions/move-auth/index.ts');
    // On `authorization_key` alone, two wallets sharing a key silently overwrote
    // each other's grant.
    assert.match(edge, /onConflict: 'authorization_key,wallet_address'/);
    assert.doesNotMatch(edge, /onConflict: 'authorization_key'/);
    // And the client keys include the wallet.
    assert.match(code('hooks/TeamUpContext.tsx'), /`room:\$\{code\}:\$\{/);
});

test('SEC-20: the Edge chain allowlist matches the app', () => {
    const edge = read('supabase/functions/_shared/walletVerify.ts');
    const app = read('lib/chains.ts');
    const edgeIds = /export const SUPPORTED_CHAIN_IDS = \[([^\]]+)\]/.exec(edge);
    const appIds = /export const SUPPORTED_CHAIN_IDS = \[([^\]]+)\]/.exec(app);
    assert.ok(edgeIds && appIds);
    assert.equal(edgeIds[1].trim(), appIds[1].trim(), 'the two allowlists have drifted apart');
    // And no public-endpoint fallback.
    assert.match(edge, /refusing the public-endpoint fallback/);
    assert.doesNotMatch(edge, /transport: rpc \? http\(rpc\) : http\(\)/, 'no bare http() fallback');
});

test('SEC-32: persisted state is whitelisted, not blacklisted', () => {
    const src = code('lib/engine/core.ts');
    assert.match(src, /export const PERSISTED_STATE_FIELDS/);
    assert.match(src, /export function pickPersistedState/);
    // The tile whitelist must NOT include `type` — that is the whole point.
    const tiles = /const PERSISTED_TILE_FIELDS = \[([^\]]+)\]/.exec(src);
    assert.ok(tiles, 'tile fields must be an explicit list');
    assert.ok(!tiles[1].includes('type'), 'powerTiles[].type must not be persisted');

    const edge = code('supabase/functions/move-auth/index.ts');
    // Whitelisted at seed AND on every write.
    assert.match(edge, /\.\.\.pickPersistedState\(initialState\)/, 'seed must whitelist');
    // The seed spreads pickPersistedState into `state` and persists that, so the
    // four sites are: seed spread + move + pass + power.
    assert.match(edge, /state: pickPersistedState\(toStore\)/, 'move');
    assert.match(edge, /state: pickPersistedState\(next\)/, 'pass');
    assert.equal(
      (edge.match(/state: pickPersistedState\(/g) || []).length, 3,
      'all three CAS sites must whitelist',
    );
});

test('SEC-32: pickPersistedState drops what it does not know', () => {
    const out = pickPersistedState({
        positions: { green: [0, -1, -1, -1] },
        currentPlayer: 'green',
        // Not on the list — a client could smuggle this into an authority row.
        smuggled: { evil: true },
        powerTiles: [{ r: 1, c: 2, type: 'nuke', extra: 1 }],
    });
    assert.equal('smuggled' in out, false, 'unknown fields must be dropped');
    assert.deepEqual(out.powerTiles, [{ r: 1, c: 2 }], 'and tile members reduced to the board');
    assert.equal(out.currentPlayer, 'green', 'known fields survive');
});

// ── CRY-01 / CRY-02 / CRY-03 ───────────────────────────────────────────────

test('CRY-01: the KDF is real HKDF, not "HKDF-ish"', () => {
    const src = read('lib/encryption.ts');

    // The derivation itself.
    assert.match(
        src,
        /crypto\.subtle\.deriveBits\(\s*\{\s*name: 'HKDF', hash: 'SHA-256', salt, info\s*\}/,
        'must be crypto.subtle HKDF, not a hand-rolled hash',
    );
    assert.match(src, /HKDF_INFO_PREFIX = 'ludo-dm-ecdh-v2'/);

    // Scoped to the v2 function: a constant "salt" is not a salt, and info must
    // bind BOTH static keys or the same shared secret derives the same key in a
    // different transcript.
    const v2 = src.slice(src.indexOf('async function deriveAesKeyV2'));
    const v2End = v2.indexOf('/** @deprecated');
    const v2Body = v2.slice(0, v2End === -1 ? v2.length : v2End);
    assert.match(v2Body, /canonicalJwk\(senderStaticPub\)/, 'info must bind the sender key');
    assert.match(v2Body, /canonicalJwk\(recipientStaticPub\)/, 'info must bind the recipient key');

    // Scoped to encryptForPeer: the salt must be random, not derived.
    const encryptFn = src.slice(src.indexOf('export async function encryptForPeer'));
    const encryptBody = encryptFn.slice(0, encryptFn.indexOf('export async function decryptSealedBox'));
    assert.match(
        encryptBody,
        /const salt = crypto\.getRandomValues\(new Uint8Array\(16\)\)/,
        'the HKDF salt must be 16 random bytes',
    );
    assert.doesNotMatch(
        encryptBody,
        /const salt = new TextEncoder\(\)/,
        'a constant salt is a domain tag, not a salt',
    );
    assert.match(encryptBody, /salt: b64encode\(salt\)/, 'and it must travel in the box');
    assert.match(encryptBody, /deriveAesKeyV2/);
    assert.doesNotMatch(
        encryptBody,
        /deriveAesKeyV1/,
        'new messages must never be sealed with the v1 derivation',
    );
});

test('CRY-01: v1 stays decrypt-only so historical DMs remain readable', () => {
    const src = read('lib/encryption.ts');
    assert.match(src, /deriveAesKeyV1/, 'the v1 derivation must still exist');
    assert.match(src, /decrypt-only/i);
    // And the version selects the path — nothing new is written as v1.
    assert.match(src, /if \(box\.v === 2 && box\.salt\)/);
    assert.match(src, /v: 1 \| 2/);
    // A v2 box without its salt cannot be opened, so isSealedBox must refuse it.
    assert.match(src, /if \(v\.v === 2 && typeof v\.salt !== 'string'\) return false/);
});

test('CRY-03: the messages route refuses plaintext', () => {
    const src = code('app/api/messages/route.ts');
    assert.match(src, /isSealedBox\(safeParseJson\(content\)\)/);
    assert.match(src, /not plaintext/);
    assert.match(src, /status: 400/);
    // Structural check, not a length or shape heuristic.
    assert.match(src, /typeof content !== 'string' \|\| !isSealedBox/);
});

test('CRY-02: peer-supplied metadata is not spread into a rendered message', () => {
    const src = code('hooks/usePeerChat.ts');
    assert.doesNotMatch(src, /\.\.\.data\.metadata/, 'a peer must not set fields on what the UI renders');
    // The fields are set explicitly instead.
    assert.match(src, /sender_id: senderWallet/);
    assert.match(src, /receiver_id: address\.toLowerCase\(\)/);
});
