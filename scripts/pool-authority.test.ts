import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    POOL_SHAPE,
    POOL_STATUS,
    settleNonceFor,
    PoolAuthorityError,
    assertSettleable,
    deriveSettlePlan,
    requireAuthority,
    resolveDeadline,
    type PoolSummary,
} from '../lib/poolAuthority';

/**
 * SEC-03 / SEC-04 regression tests.
 *
 * MatchPool.settlePool and MatchPool.submitAbandon have no `msg.sender` check,
 * so the edge co-signature is the only authorization. These cover the
 * server-side rules that decide who may obtain one, and the amount derivation
 * that replaced client-supplied payout values.
 */

const E18 = BigInt(10) ** BigInt(18);
const AUTHORITY = '0x1111111111111111111111111111111111111111';
const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function summary(over: Partial<PoolSummary> = {}): PoolSummary {
    return {
        status: POOL_STATUS.Locked,
        maxSeats: 2,
        filledSeats: 2,
        shape: POOL_SHAPE.OneVsOne,
        settleNonce: BigInt(1),
        authority: AUTHORITY as `0x${string}`,
        entryFee: BigInt(10) * E18,
        gross: BigInt(20) * E18,
        prizeFund: BigInt(20) * E18,
        hostBond: BigInt(4) * E18,
        settleBy: BigInt(Math.floor(Date.now() / 1000) + 3600),
        claimUnlockAt: BigInt(0),
        ...over,
    };
}

/** getAddress() returns EIP-55 checksummed form; compare on lowercase. */
function amounts(plan: { amount: bigint }[]): string[] {
    return plan.map((p) => p.amount.toString());
}
function addrs(plan: { addr: string }[]): string[] {
    return plan.map((p) => p.addr.toLowerCase());
}

test('requireAuthority accepts only the on-chain authority', () => {
    const s = summary();
    // Case-insensitive on the way in, checksummed on the way out.
    assert.equal(requireAuthority(s, AUTHORITY).toLowerCase(), AUTHORITY);
    assert.equal(
        requireAuthority(s, AUTHORITY.toUpperCase().replace('0X', '0x')).toLowerCase(),
        AUTHORITY,
    );
    // Anyone else is refused — this is the SEC-04 fix, since `authority` used to
    // come from the request body.
    for (const other of [A, B]) {
        assert.throws(() => requireAuthority(s, other), (e: unknown) => {
            assert.ok(e instanceof PoolAuthorityError);
            assert.equal(e.status, 403);
            return true;
        });
    }
});

test('assertSettleable refuses terminal and non-Locked pools', () => {
    assert.doesNotThrow(() => assertSettleable(summary()));
    for (const st of [POOL_STATUS.Settled, POOL_STATUS.Cancelled, POOL_STATUS.Expired]) {
        assert.throws(() => assertSettleable(summary({ status: st })), PoolAuthorityError);
    }
    for (const st of [POOL_STATUS.Open, POOL_STATUS.Funded]) {
        assert.throws(() => assertSettleable(summary({ status: st })), PoolAuthorityError);
    }
});

test('a lone winner may not settle a 4-seat pool (it would also take the slashed bond)', () => {
    // MatchPool.sol:609 adds p.hostBond to a lone winner's credit in Mode B, so
    // permitting one winner on a 4-seat pool hands over 100% of the prize fund
    // *and* the bond. This was the SEC-04 exploit path.
    assert.throws(
        () => deriveSettlePlan(summary({ maxSeats: 4 }), [A]),
        (e: unknown) => {
            assert.ok(e instanceof PoolAuthorityError);
            assert.equal(e.status, 400);
            assert.match(e.message, /4-seat/);
            return true;
        },
    );
});

test('a lone winner is allowed when the pool is not 4-seat', () => {
    const plan = deriveSettlePlan(summary({ maxSeats: 2, prizeFund: BigInt(20) * E18 }), [A]);
    assert.deepEqual(addrs(plan), [A]);
    assert.deepEqual(amounts(plan), [(BigInt(20) * E18).toString()]);
});

test('4-seat 2v2 team split is exactly 50/50, dust to the first seat', () => {
    // Mirrors MatchPool.sol:584-586 (half = fund/2, dust = fund%2).
    const fund = BigInt(20) * E18 + BigInt(1); // odd, to exercise the dust term
    const plan = deriveSettlePlan(
        summary({ maxSeats: 4, shape: POOL_SHAPE.TwoVsTwo, prizeFund: fund }),
        [A, B],
        'team',
    );
    const half = fund / BigInt(2);
    assert.deepEqual(addrs(plan), [A, B]);
    assert.deepEqual(amounts(plan), [(half + (fund % BigInt(2))).toString(), half.toString()]);
    assert.equal(plan.reduce((x, p) => x + p.amount, BigInt(0)), fund);
});

test('4-seat 4P podium split is exactly 75/25, remainder to second', () => {
    // Mirrors MatchPool.sol:590-591.
    const fund = BigInt(20) * E18 + BigInt(7);
    const plan = deriveSettlePlan(
        summary({ maxSeats: 4, shape: POOL_SHAPE.FourPlayer, prizeFund: fund }),
        [A, B],
        'podium',
    );
    const firstDue = (fund * BigInt(75)) / BigInt(100);
    assert.deepEqual(addrs(plan), [A, B]);
    assert.deepEqual(amounts(plan), [firstDue.toString(), (fund - firstDue).toString()]);
    assert.equal(plan.reduce((x, p) => x + p.amount, BigInt(0)), fund);
});

test('every derived plan sums to the on-chain prize fund exactly', () => {
    // The old code trusted client amounts, so a wrong sum reverted SumMismatch
    // on-chain. Amounts are derived now, so this must always hold.
    const funds = [BigInt(1), BigInt(2), BigInt(3), BigInt(7), E18, BigInt(7) * E18 + BigInt(13), BigInt(12345)];
    for (const f of funds) {
        for (const [maxSeats, shape] of [
            [1, POOL_SHAPE.OneVsOne],
            [2, POOL_SHAPE.OneVsOne],
            [4, POOL_SHAPE.TwoVsTwo],
            [4, POOL_SHAPE.FourPlayer],
        ] as const) {
            const winners = maxSeats === 4 ? [A, B] : [A];
            const plan = deriveSettlePlan(summary({ maxSeats, shape, prizeFund: f }), winners);
            assert.equal(
                plan.reduce((x, p) => x + p.amount, BigInt(0)),
                f,
                `sum mismatch for fund=${f} maxSeats=${maxSeats} shape=${shape}`,
            );
        }
    }
});

test('deriveSettlePlan rejects empty, duplicate, zero-fund and odd winner counts', () => {
    assert.throws(() => deriveSettlePlan(summary(), []), PoolAuthorityError);
    assert.throws(() => deriveSettlePlan(summary({ maxSeats: 4 }), [A, A]), PoolAuthorityError);
    assert.throws(() => deriveSettlePlan(summary({ prizeFund: BigInt(0) }), [A]), PoolAuthorityError);
    const C = '0xcccccccccccccccccccccccccccccccccccccccc';
    // 4-seat with 3 winners is not a shape the contract ratio-checks.
    assert.throws(
        () => deriveSettlePlan(summary({ maxSeats: 4 }), [A, B, C]),
        PoolAuthorityError,
    );
});

test('resolveDeadline refuses a past or out-of-window deadline', () => {
    const s = summary();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const d = resolveDeadline(s, undefined);
    assert.ok(d > now, 'default deadline must be in the future');
    assert.ok(d <= s.settleBy + BigInt(48 * 3600), 'default deadline must be clamped');
    assert.throws(() => resolveDeadline(s, (now - BigInt(60)).toString()), PoolAuthorityError);
    assert.throws(() => resolveDeadline(s, 'not-a-number'), PoolAuthorityError);
    assert.throws(
        () => resolveDeadline(s, (now + BigInt(30 * 86400)).toString()),
        PoolAuthorityError,
    );
});

test('the settle nonce comes from the chain, never a hardcoded 1', () => {
    // SEC-04b: this used to return BigInt(1) with a justification that happened
    // to hold. A derived value signed as if authoritative is a latent failure
    // the moment a second settle path exists.
    assert.equal(settleNonceFor(summary({ settleNonce: BigInt(1) })), BigInt(1));
    assert.equal(settleNonceFor(summary({ settleNonce: BigInt(7) })), BigInt(7));
    // It must not silently clamp a consumed counter back to the first value.
    assert.notEqual(settleNonceFor(summary({ settleNonce: BigInt(4) })), BigInt(1));
});


test('ECO-08: a 4P pool auto-settles to 75/25, never 50/50', () => {
    // Regression: the split used to be inferred from seat colours, and the
    // lobby seats 4P as green,red,yellow,blue. A 4P game whose top two are
    // green+blue is the {1,4} pair the contract called "teammates", so it was
    // paid 50/50. Worse, "auto" resolved to "team" unconditionally, making the
    // podium unreachable without an explicit override. Shape is now declared
    // on-chain and read by the server.
    const fund = BigInt(20) * E18;
    const fourP = summary({ maxSeats: 4, shape: POOL_SHAPE.FourPlayer, prizeFund: fund });
    const plan = deriveSettlePlan(fourP, [A, B]);
    const firstDue = (fund * BigInt(75)) / BigInt(100);
    assert.deepEqual(amounts(plan), [firstDue.toString(), (fund - firstDue).toString()]);
    assert.notEqual(plan[0]!.amount, fund / BigInt(2), '4P must not pay an even split');
});

test('ECO-08: a 2v2 pool auto-settles to 50/50', () => {
    const fund = BigInt(20) * E18;
    const twoVtwo = summary({ maxSeats: 4, shape: POOL_SHAPE.TwoVsTwo, prizeFund: fund });
    const plan = deriveSettlePlan(twoVtwo, [A, B]);
    assert.deepEqual(amounts(plan), [(fund / BigInt(2)).toString(), (fund / BigInt(2)).toString()]);
});

test('a split that contradicts the declared shape is rejected', () => {
    const fourP = summary({ maxSeats: 4, shape: POOL_SHAPE.FourPlayer });
    const twoVtwo = summary({ maxSeats: 4, shape: POOL_SHAPE.TwoVsTwo });
    assert.throws(() => deriveSettlePlan(fourP, [A, B], 'team'), PoolAuthorityError);
    assert.throws(() => deriveSettlePlan(twoVtwo, [A, B], 'podium'), PoolAuthorityError);
    // ...and a 1v1 pool cannot claim a team split either.
    assert.throws(
        () => deriveSettlePlan(summary({ maxSeats: 2, shape: POOL_SHAPE.OneVsOne }), [A, B], 'team'),
        PoolAuthorityError,
    );
});

test('an unknown on-chain shape is refused rather than guessed', () => {
    assert.throws(
        () => deriveSettlePlan(summary({ maxSeats: 4, shape: 99 }), [A, B]),
        (e: unknown) => {
            assert.ok(e instanceof PoolAuthorityError);
            assert.equal(e.status, 502);
            return true;
        },
    );
});
