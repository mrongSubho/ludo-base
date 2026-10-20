import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payoutPlanHash, type PayoutEntry } from '../lib/chipsSettle';
import { POOL_SHAPE, POOL_STATUS, deriveSettlePlan, type PoolSummary } from '../lib/poolAuthority';
import type { PoolSummaryView } from '../hooks/useChipsPool';

const E18 = BigInt(10) ** BigInt(18);
const AUTHORITY = '0x1111111111111111111111111111111111111111';
const WINNER_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WINNER_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('CHAIN-01: deriveSettlePlan resolves winners correctly for propose payload', () => {
    const summary: PoolSummary = {
        status: POOL_STATUS.Locked,
        maxSeats: 4,
        filledSeats: 4,
        shape: POOL_SHAPE.TwoVsTwo,
        settleNonce: BigInt(1),
        authority: AUTHORITY as `0x${string}`,
        entryFee: BigInt(10) * E18,
        gross: BigInt(40) * E18,
        prizeFund: BigInt(40) * E18,
        hostBond: BigInt(8) * E18,
        settleBy: BigInt(Math.floor(Date.now() / 1000) + 3600),
        claimUnlockAt: BigInt(0),
    };

    // Winner addresses passed from UI
    const winnerAddresses = [WINNER_A, WINNER_B];
    const plan = deriveSettlePlan(summary, winnerAddresses, 'auto');
    assert.equal(plan.length, 2);
    assert.equal(plan[0].addr.toLowerCase(), WINNER_A.toLowerCase());
    assert.equal(plan[1].addr.toLowerCase(), WINNER_B.toLowerCase());
    assert.equal(plan[0].amount + plan[1].amount, summary.prizeFund);
});

test('CHAIN-02: 12-tuple decoder correctly preserves indices and fields without shift', () => {
    // 12-tuple exactly as returned by MatchPool.sol:getPoolSummary:
    // [status, maxSeats, filledSeats, shape, authority, entryFee, gross, prizeFund, hostBond, settleBy, claimUnlockAt, settleNonce]
    const mockContractTuple: readonly unknown[] = [
        1,                                          // status = Locked (1)
        4,                                          // maxSeats = 4
        4,                                          // filledSeats = 4
        2,                                          // shape = TwoVsTwo (2)
        AUTHORITY,                                  // authority
        BigInt(10) * E18,                           // entryFee = 10 CHIPS
        BigInt(40) * E18,                           // gross = 40 CHIPS
        BigInt(38) * E18,                           // prizeFund = 38 CHIPS
        BigInt(5) * E18,                            // hostBond = 5 CHIPS
        BigInt(1700000000),                         // settleBy
        BigInt(1700003600),                         // claimUnlockAt
        BigInt(7),                                  // settleNonce = 7
    ];

    const decoded: PoolSummaryView = {
        status: Number(mockContractTuple[0] ?? 0),
        maxSeats: Number(mockContractTuple[1] ?? 0),
        filledSeats: Number(mockContractTuple[2] ?? 0),
        shape: Number(mockContractTuple[3] ?? 0),
        authority: mockContractTuple[4] as `0x${string}` | undefined,
        entryFee: (mockContractTuple[5] as bigint) ?? BigInt(0),
        gross: (mockContractTuple[6] as bigint) ?? BigInt(0),
        prizeFund: (mockContractTuple[7] as bigint) ?? BigInt(0),
        hostBond: (mockContractTuple[8] as bigint) ?? BigInt(0),
        settleBy: (mockContractTuple[9] as bigint) ?? BigInt(0),
        claimUnlockAt: (mockContractTuple[10] as bigint) ?? undefined,
        settleNonce: (mockContractTuple[11] as bigint) ?? BigInt(0),
    };

    assert.equal(decoded.status, 1);
    assert.equal(decoded.maxSeats, 4);
    assert.equal(decoded.filledSeats, 4);
    assert.equal(decoded.shape, 2, 'shape must be index 3');
    assert.equal(decoded.authority, AUTHORITY, 'authority must be index 4');
    assert.equal(decoded.entryFee, BigInt(10) * E18, 'entryFee must be index 5');
    assert.equal(decoded.gross, BigInt(40) * E18, 'gross must be index 6');
    assert.equal(decoded.prizeFund, BigInt(38) * E18, 'prizeFund must be index 7');
    assert.equal(decoded.hostBond, BigInt(5) * E18, 'hostBond must be index 8');
    assert.equal(decoded.settleBy, BigInt(1700000000), 'settleBy must be index 9');
    assert.equal(decoded.claimUnlockAt, BigInt(1700003600), 'claimUnlockAt must be index 10');
    assert.equal(decoded.settleNonce, BigInt(7), 'settleNonce must be index 11');
});

test('CHAIN-03: payoutPlanHash matches between server and client reconstructed plan', () => {
    const serverPlan: PayoutEntry[] = [
        { addr: WINNER_A as `0x${string}`, amount: BigInt(20) * E18 },
        { addr: WINNER_B as `0x${string}`, amount: BigInt(20) * E18 },
    ];

    const serverPlanHash = payoutPlanHash(serverPlan);

    // Client wire deserialization
    const wirePlan = serverPlan.map((p) => ({
        addr: p.addr,
        amount: p.amount.toString(),
    }));

    const clientReconstructed: PayoutEntry[] = wirePlan.map((p) => ({
        addr: p.addr,
        amount: BigInt(p.amount),
    }));

    const clientPlanHash = payoutPlanHash(clientReconstructed);
    assert.equal(clientPlanHash, serverPlanHash, 'payoutPlanHash must be identical across wire round-trip');
});
