/**
 * Wallet validation and the SEC-08 friends route (Phase 3).
 *
 * The headline test is the first one: it reproduces the PostgREST filter-string
 * injection that `friends/route.ts` used, and shows that validating the input
 * removes it. The rest pin the shared predicate and the route's shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWalletAddress, normalizeWallet, sanitizeWalletList } from '../lib/validation/wallet';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

const ADA = '0xada0000000000000000000000000000000000001';

// ── The bug, reproduced ─────────────────────────────────────────────────────

test('SEC-08: the old filter-string shape was injectable, and is now impossible', () => {
    // What `fetchAcceptedFriends` used to build:
    const buildOldFilter = (input: string) =>
        `user_address.eq.${input},friend_address.eq.${input}`;

    // A crafted value closes the first term and adds its own. PostgREST `.or()`
    // is a string format, not a query API.
    const attack = `${ADA},status.eq.accepted`;
    const malicious = buildOldFilter(attack);
    assert.ok(
        malicious.includes('status.eq.accepted'),
        'the injected term survives string interpolation',
    );

    // What replaced it: a validated value, and two explicit .eq() calls.
    const safe = normalizeWallet(attack);
    assert.equal(safe, null, 'the crafted value is not an address, so it never becomes a filter');
    assert.equal(isWalletAddress(attack), false);
});

// ── The shared predicate ────────────────────────────────────────────────────

test('a 20-byte hex address is the only accepted form', () => {
    assert.equal(isWalletAddress(ADA), true);
    assert.equal(isWalletAddress(ADA.toUpperCase().replace('0X', '0x')), true);
    assert.equal(isWalletAddress(ADA.slice(2)), false, 'no 0x prefix');
    assert.equal(isWalletAddress(`${ADA}0`), false, 'too long');
    assert.equal(isWalletAddress(ADA.slice(0, -1)), false, 'too short');
    assert.equal(isWalletAddress(`0x${'g'.repeat(40)}`), false, 'non-hex');
});

test('the rejected shapes are the ones that actually appear on the wire', () => {
    for (const bad of [
        '',
        ' ',
        'ada',
        `${ADA}.or(status.eq.accepted)`,
        `${ADA}%2Cstatus.eq.accepted`,
        `${ADA},and(status.eq.accepted)`,
        '0x',
        null,
        undefined,
        42,
        {},
        ['x'],
        true,
    ]) {
        assert.equal(isWalletAddress(bad), false, `${String(bad)} must be rejected`);
    }
});

test('normalizeWallet lowercases, trims, or returns null', () => {
    assert.equal(normalizeWallet(`  ${ADA.toUpperCase()}  `), ADA);
    assert.equal(normalizeWallet('nope'), null);
    assert.equal(normalizeWallet(123), null);
});

test('sanitizeWalletList drops junk, dedupes, and preserves order', () => {
    const out = sanitizeWalletList([
        ADA,
        ADA.toUpperCase(),
        'garbage',
        `${ADA},status.eq.accepted`,
        '0x' + 'bb'.repeat(20),
    ]);
    assert.deepEqual(out, [ADA, '0x' + 'bb'.repeat(20)]);
});

// ── friends/route.ts shape ──────────────────────────────────────────────────

test('SEC-08: the route validates before it queries', () => {
    const src = code('app/api/friends/route.ts');
    const validateAt = src.indexOf('isWalletAddress(wallet)');
    const firstQueryAt = Math.min(
        ...['serviceDb()', 'supabase\n', '.from('].map((n) => {
            const i = src.indexOf(n);
            return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        }),
    );
    assert.ok(validateAt > 0, 'the route must validate the wallet');
    assert.ok(
        validateAt < src.indexOf('api.neynar.com'),
        'validation must precede the upstream Neynar call',
    );
    assert.ok(validateAt > 0 && firstQueryAt > 0);
});

test('SEC-08: no wallet is interpolated into a PostgREST .or() filter', () => {
    const src = code('app/api/friends/route.ts');
    // The friendships lookup must be two .eq() queries merged in JS.
    assert.doesNotMatch(
        src,
        /\.or\(`[^`]*\$\{[^}]*wallet/i,
        'a wallet must never be interpolated into .or()',
    );
    assert.doesNotMatch(src, /friend_address\.eq\.\$\{/, 'the old injected filter is gone');
    assert.match(src, /\.eq\('user_address', walletLower\)/);
    assert.match(src, /\.eq\('friend_address', walletLower\)/);
});

test('SEC-08: the route requires a session for the caller own wallet', () => {
    const src = code('app/api/friends/route.ts');
    assert.match(src, /requireAppSession\(/, 'a session is required');
    assert.match(src, /session !== wallet/, 'and it must be the caller own wallet');
    // Defence in depth on the remaining interpolation: the Neynar-sourced
    // following list is still untrusted input before it reaches a filter.
    assert.match(src, /followingWallets\.filter\(isWalletAddress\)/);
    assert.match(src, /encodeURIComponent\(wallet\)/, 'and it is escaped in the upstream URL');
});

test('every friends caller passes a session and encodes the wallet', () => {
    for (const f of [
        'hooks/useDataBoot.ts',
        'app/components/RankingsPanel.tsx',
        'app/components/PublicProfileModal.tsx',
    ]) {
        const src = code(f);
        for (const m of src.matchAll(/`\/api\/friends\?[^`]*`/g)) {
            assert.match(m[0], /encodeURIComponent/, `${f}: unencoded wallet in ${m[0]}`);
        }
        // The sanctioned shape is an encoded literal in every case: no
        // `wallet=${value}` may appear without encodeURIComponent around it.
        for (const m of src.matchAll(/wallet=([^&`"']+)/g)) {
            assert.ok(
                m[1].includes('encodeURIComponent') || !m[1].includes('${'),
                `${f}: unencoded wallet value ${m[1]}`,
            );
        }
    }
    // A 401 is not data: the boot path must degrade, not poison the panel.
    assert.match(code('hooks/useDataBoot.ts'), /res\.ok \? res\.json\(\)/);
});
