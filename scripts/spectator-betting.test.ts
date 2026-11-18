import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SPECTATOR_BET_PRESETS,
    SPECTATOR_BET_WINDOW_DEFAULT_SEC,
    SPECTATOR_BET_WINDOW_MAX_SEC,
    SPECTATOR_BET_WINDOW_MIN_SEC,
    SPECTATOR_RAKE_BPS,
    calculatePariMutuelSettlement,
    clampBetWindowSeconds,
    computeBetWindowBounds,
    computeSpectatorPoolSummary,
    isBetWindowOpen,
    resolveWinningBetValues,
} from '../lib/spectatorBetting';

test('spectator betting presets & fixed timeframe bounds (30s..180s, default 90s)', () => {
    assert.deepEqual([...SPECTATOR_BET_PRESETS], [100, 500, 1_000, 10_000, 100_000]);
    assert.equal(SPECTATOR_BET_WINDOW_MIN_SEC, 30);
    assert.equal(SPECTATOR_BET_WINDOW_MAX_SEC, 180);
    assert.equal(SPECTATOR_BET_WINDOW_DEFAULT_SEC, 90);
    assert.equal(SPECTATOR_RAKE_BPS, 500);

    assert.equal(clampBetWindowSeconds(), 90);
    assert.equal(clampBetWindowSeconds(10), 30);
    assert.equal(clampBetWindowSeconds(60), 60);
    assert.equal(clampBetWindowSeconds(300), 180);

    const bounds = computeBetWindowBounds(1_000_000, 45);
    assert.equal(bounds.durationSec, 45);
    assert.equal(bounds.openedAtMs, 1_000_000);
    assert.equal(bounds.closedAtMs, 1_045_000);

    assert.equal(
        isBetWindowOpen({ status: 'open', windowClosedAt: bounds.windowClosedAt, nowMs: 1_044_999 }),
        true,
    );
    assert.equal(
        isBetWindowOpen({ status: 'open', windowClosedAt: bounds.windowClosedAt, nowMs: 1_045_000 }),
        false,
    );
    assert.equal(
        isBetWindowOpen({ status: 'closed', windowClosedAt: bounds.windowClosedAt, nowMs: 1_010_000 }),
        false,
    );
});

test('pari-mutuel opposed pool: user prompt example (100 Team A vs 50 Team B -> 143 net pot to A)', () => {
    const res = calculatePariMutuelSettlement(
        [
            { id: 'b1', playerId: '0xaaa', betValue: 'team 1', amount: 100 },
            { id: 'b2', playerId: '0xbbb', betValue: 'team 2', amount: 50 },
        ],
        ['team 1', 'green', 'blue'],
    );

    assert.equal(res.mode, 'parimutuel');
    assert.equal(res.totalPot, 150);
    assert.equal(res.winningPool, 100);
    assert.equal(res.losingPool, 50);
    // 5% of 150 = 7
    assert.equal(res.rake, 7);
    assert.equal(res.netPot, 143);

    const winPayout = res.payouts.find((p) => p.id === 'b1')!;
    const losePayout = res.payouts.find((p) => p.id === 'b2')!;

    assert.equal(winPayout.status, 'won');
    assert.equal(winPayout.payout, 143);
    assert.equal(winPayout.claimType, 'match_prize');
    assert.equal(winPayout.outcome, 'parimutuel_win');

    assert.equal(losePayout.status, 'lost');
    assert.equal(losePayout.payout, 0);
    assert.equal(losePayout.claimType, null);
    assert.equal(losePayout.outcome, 'parimutuel_loss');
});

test('pari-mutuel multi-bettor proportional distribution with exact dust reconciliation', () => {
    const res = calculatePariMutuelSettlement(
        [
            { id: 'w1', playerId: '0x111', betValue: 'green', amount: 100 },
            { id: 'w2', playerId: '0x222', betValue: 'green', amount: 300 },
            { id: 'l1', playerId: '0x333', betValue: 'red', amount: 200 },
        ],
        ['green'],
    );

    assert.equal(res.mode, 'parimutuel');
    assert.equal(res.totalPot, 600);
    assert.equal(res.winningPool, 400);
    assert.equal(res.losingPool, 200);
    assert.equal(res.rake, 30);
    assert.equal(res.netPot, 570);

    const p1 = res.payouts.find((p) => p.id === 'w1')!;
    const p2 = res.payouts.find((p) => p.id === 'w2')!;
    assert.equal(p1.payout, 142); // floor(570 * 100 / 400)
    assert.equal(p2.payout, 428); // remainder 570 - 142
    assert.equal(p1.payout + p2.payout, res.netPot);
});

test('pari-mutuel high-skew principal protection caps rake at losing pool', () => {
    const res = calculatePariMutuelSettlement(
        [
            { id: 'w1', playerId: '0x111', betValue: 'green', amount: 10_000 },
            { id: 'l1', playerId: '0x222', betValue: 'yellow', amount: 10 },
        ],
        ['green'],
    );

    assert.equal(res.mode, 'parimutuel');
    assert.equal(res.totalPot, 10_010);
    // 5% of 10,010 = 500, capped at losingPool (10) so winner never loses principal
    assert.equal(res.rake, 10);
    assert.equal(res.netPot, 10_000);
    assert.equal(res.payouts.find((p) => p.id === 'w1')?.payout, 10_000);
});

test('unopposed winners only -> 100% refund (0% rake) delivered as match_refund', () => {
    const res = calculatePariMutuelSettlement(
        [
            { id: 'w1', playerId: '0x111', betValue: 'blue', amount: 500 },
            { id: 'w2', playerId: '0x222', betValue: 'green', amount: 1_000 },
        ],
        ['green', 'blue', 'team 1'],
    );

    assert.equal(res.mode, 'unopposed_refund');
    assert.equal(res.rake, 0);
    assert.equal(res.netPot, 1_500);
    assert.equal(res.payouts.length, 2);
    for (const p of res.payouts) {
        assert.equal(p.status, 'won');
        assert.equal(p.payout, p.amount);
        assert.equal(p.claimType, 'match_refund');
        assert.equal(p.outcome, 'unopposed_refund');
    }
});

test('unopposed losers only -> 100% forfeited to House Pool', () => {
    const res = calculatePariMutuelSettlement(
        [
            { id: 'l1', playerId: '0x111', betValue: 'red', amount: 1_000 },
            { id: 'l2', playerId: '0x222', betValue: 'yellow', amount: 500 },
        ],
        ['green'],
    );

    assert.equal(res.mode, 'house_forfeit');
    assert.equal(res.winningPool, 0);
    assert.equal(res.losingPool, 1_500);
    assert.equal(res.rake, 1_500);
    assert.equal(res.netPot, 0);
    for (const p of res.payouts) {
        assert.equal(p.status, 'lost');
        assert.equal(p.payout, 0);
        assert.equal(p.claimType, null);
        assert.equal(p.outcome, 'house_forfeit');
    }
});

test('2v2 team pairing resolution uses TEAM_PAIRINGS (Green+Blue vs Red+Yellow)', () => {
    assert.deepEqual(
        resolveWinningBetValues({ winnerRaw: 'Team 1', matchShape: '2v2' }).sort(),
        ['blue', 'green', 'team 1'],
    );
    assert.deepEqual(
        resolveWinningBetValues({ winnerRaw: 'Team 2', matchShape: '2v2' }).sort(),
        ['red', 'team 2', 'yellow'],
    );
    assert.deepEqual(
        resolveWinningBetValues({ winnerRaw: 'green', matchShape: '2v2' }).sort(),
        ['blue', 'green', 'team 1'],
    );
    assert.deepEqual(
        resolveWinningBetValues({ winnerRaw: 'yellow', matchShape: '1v1' }),
        ['yellow'],
    );
    assert.deepEqual(
        resolveWinningBetValues({
            winnerRaw: '0xAbCd000000000000000000000000000000000001',
            matchShape: '2v2',
            playerSeats: {
                red: { wallet: '0xabcd000000000000000000000000000000000001' },
            },
        }).sort(),
        ['red', 'team 2', 'yellow'],
    );
});

test('pool summary aggregates per-side amounts and percentages', () => {
    const summary = computeSpectatorPoolSummary(
        [
            { bet_value: 'team 1', amount: 100, status: 'open' },
            { bet_value: 'green', amount: 50, status: 'open' },
            { bet_value: 'team 2', amount: 50, status: 'open' },
        ],
        '2v2',
    );
    assert.equal(summary.totalPot, 200);
    assert.equal(summary.betCount, 3);
    assert.equal(summary.bySide['team 1'].amount, 150);
    assert.equal(summary.bySide['team 1'].sharePct, 75);
    assert.equal(summary.bySide['team 2'].amount, 50);
    assert.equal(summary.bySide['team 2'].sharePct, 25);
});
