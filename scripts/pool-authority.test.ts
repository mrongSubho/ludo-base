import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    POOL_STATUS,
    PoolAuthorityError,
    assertSettleable,
    deriveSettlePlan,
    initialSettleNonce,
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
    const plan = deriveSettlePlan(summary({ maxSeats: 4, prizeFund: fund }), [A, B], 'team');
    const half = fund / BigInt(2);
    assert.deepEqual(addrs(plan), [A, B]);
    assert.deepEqual(amounts(plan), [(half + (fund % BigInt(2))).toString(), half.toString()]);
    assert.equal(plan.reduce((x, p) => x + p.amount, BigInt(0)), fund);
});

test('4-seat 4P podium split is exactly 75/25, remainder to second', () => {
    // Mirrors MatchPool.sol:590-591.
    const fund = BigInt(20) * E18 + BigInt(7);
    const plan = deriveSettlePlan(summary({ maxSeats: 4, prizeFund: fund }), [A, B], 'podium');
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
        for (const maxSeats of [1, 2, 4]) {
            const winners = maxSeats === 4 ? [A, B] : [A];
            const plan = deriveSettlePlan(summary({ maxSeats, prizeFund: f }), winners);
            assert.equal(
                plan.reduce((x, p) => x + p.amount, BigInt(0)),
                f,
                `sum mismatch for fund=${f} maxSeats=${maxSeats}`,
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

test('settle nonce is 1 for any pool that has provably never settled', () => {
    // settleNonce has no public getter; it starts at 1 and is only incremented by
    // settlePool, which also sets status = Settled. assertSettleable gates on that
    // status, so 1 is correct here and only here.
    assert.equal(initialSettleNonce(), BigInt(1));
    assert.doesNotThrow(() => assertSettleable(summary({ status: POOL_STATUS.Locked })));
    assert.throws(() => assertSettleable(summary({ status: POOL_STATUS.Settled })));
});
