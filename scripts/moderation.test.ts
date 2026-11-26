import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { containsProfanity, filterProfanity } from '../lib/profanity';
import { getBlockedWallets, isBlockedBetween } from '../lib/moderation';

test('profanity filter masks slurs and phishing terms while preserving benign gaming text', () => {
    assert.equal(containsProfanity('classic pass to assassin'), false);
    assert.equal(filterProfanity('classic pass 0xdeadbeef'), 'classic pass 0xdeadbeef');

    assert.equal(containsProfanity('fuck this roll'), true);
    assert.equal(filterProfanity('fuck this roll'), '**** this roll');

    assert.equal(containsProfanity('send me your seed phrase now'), true);
    assert.equal(filterProfanity('send me your seed phrase now').includes('seed phrase'), false);
});

test('bidirectional block helpers check both directions on user_blocks', async () => {
    const alice = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bob = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const carol = '0xcccccccccccccccccccccccccccccccccccccccc';

    const rows = [{ id: '1', blocker_address: bob, blocked_address: alice }];
    const fakeDb = {
        from(table: string) {
            assert.equal(table, 'user_blocks');
            const filters: Record<string, string> = {};
            const chain = {
                select() { return chain; },
                eq(col: string, val: string) { filters[col] = val; return chain; },
                limit() { return chain; },
                then(resolve: (v: { data: unknown[] }) => unknown) {
                    const matched = rows.filter((r) =>
                        Object.entries(filters).every(([k, v]) => (r as Record<string, string>)[k] === v),
                    );
                    return Promise.resolve({ data: matched }).then(resolve);
                },
            };
            return chain;
        },
    };

    assert.equal(await isBlockedBetween(fakeDb, alice, bob), true);
    assert.equal(await isBlockedBetween(fakeDb, bob, alice), true);
    assert.equal(await isBlockedBetween(fakeDb, alice, carol), false);

    const aliceBlocks = await getBlockedWallets(fakeDb, alice);
    assert.equal(aliceBlocks.has(bob), true);
    assert.equal(aliceBlocks.has(carol), false);
});

test('moderation source invariants: cascade unfriend, E2EE DMs unfiltered, messages rate limited', () => {
    const root = process.cwd();
    const modRoute = readFileSync(join(root, 'app/api/social/moderation/route.ts'), 'utf8');
    assert.match(modRoute, /friendships[\s\S]*\.delete\(\)/);

    const messagesRoute = readFileSync(join(root, 'app/api/messages/route.ts'), 'utf8');
    assert.match(messagesRoute, /isBlockedBetween/);
    assert.match(messagesRoute, /getBlockedWallets/);
    assert.doesNotMatch(messagesRoute, /filterProfanity/);

    for (const rel of [
        'app/api/friendships/route.ts',
        'app/api/friends/route.ts',
        'app/api/social/poke/route.ts',
        'app/api/lobby/invite/route.ts',
    ]) {
        const src = readFileSync(join(root, rel), 'utf8');
        assert.match(src, /isBlockedBetween|getBlockedWallets/, `${rel} must enforce user_blocks`);
    }

    const rateRoutes = readFileSync(join(root, 'lib/rateLimitRoutes.ts'), 'utf8');
    assert.match(rateRoutes, /messages:\s*\{\s*limit:\s*60,\s*windowMs:\s*60_000/);
});
