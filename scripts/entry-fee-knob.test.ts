import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DIAL_MAX_DEG,
    DIAL_MIN_DEG,
    ENTRY_FEE_TIERS,
    ENTRY_FEE_TIER_NAMES,
    angleToTierIndex,
    formatDialTierLabel,
    getEntryFeeTierName,
    maxAffordableTierIndex,
    pointerToDialAngle,
    stepTier,
    tierIndexToAngle,
    wagerToAngle,
} from '../lib/entryFeeDial';

test('entry fee dial: 10 tiers span -135 to +135 at 30deg intervals with smart names (no VIP)', () => {
    assert.deepEqual(
        [...ENTRY_FEE_TIERS],
        [0, 500, 1_000, 10_000, 100_000, 500_000, 1_000_000, 3_000_000, 5_000_000, 10_000_000],
    );
    assert.equal(ENTRY_FEE_TIERS.includes(1_500_000 as never), false);
    assert.equal(tierIndexToAngle(0), DIAL_MIN_DEG);
    assert.equal(tierIndexToAngle(9), DIAL_MAX_DEG);
    assert.equal(tierIndexToAngle(7), 75);
    assert.equal(formatDialTierLabel(0), 'FREE');
    assert.equal(formatDialTierLabel(3_000_000), '3M');
    assert.equal(formatDialTierLabel(10_000_000), '10M');

    for (const tier of ENTRY_FEE_TIERS) {
        const name = ENTRY_FEE_TIER_NAMES[tier];
        assert.ok(name && name !== 'VIP');
        assert.equal(getEntryFeeTierName(tier), name);
    }
    assert.equal(getEntryFeeTierName(0), 'SCOUT');
    assert.equal(getEntryFeeTierName(25_000), 'PULSE');
    assert.equal(getEntryFeeTierName(10_000_000), 'APEX');
});

test('entry fee dial: wagerToAngle hits exact detents and interpolates custom intermediate values', () => {
    ENTRY_FEE_TIERS.forEach((tier, idx) => {
        assert.equal(wagerToAngle(tier), tierIndexToAngle(idx));
    });
    assert.equal(wagerToAngle(-50), DIAL_MIN_DEG);
    assert.equal(wagerToAngle(25_000_000), DIAL_MAX_DEG);

    // 55,000 is halfway between 10k (-45°) and 100k (-15°) -> -30°
    assert.equal(wagerToAngle(55_000), -30);
});

test('entry fee dial: pointerToDialAngle prevents bottom dead-zone wrap jumps', () => {
    assert.equal(Math.round(pointerToDialAngle(0, -100, -45)), 0);
    assert.equal(Math.round(pointerToDialAngle(-100, 100, -120)), -135);
    assert.equal(Math.round(pointerToDialAngle(100, 100, 120)), 135);

    assert.equal(pointerToDialAngle(20, 100, -130), DIAL_MIN_DEG);
    assert.equal(pointerToDialAngle(-20, 100, 130), DIAL_MAX_DEG);
});

test('entry fee dial: users can experience full 0..10M dial while maxAffordableTierIndex still computes balance cap', () => {
    assert.equal(maxAffordableTierIndex(0), 0);
    assert.equal(maxAffordableTierIndex(25_000), 3); // 10_000
    assert.equal(maxAffordableTierIndex(3_500_000), 7); // 3_000_000

    assert.equal(angleToTierIndex(135), 9); // 10_000_000
    assert.equal(stepTier(10_000, 1), 100_000);
    assert.equal(stepTier(1_000_000, 1), 3_000_000);
    assert.equal(stepTier(3_000_000, -1), 1_000_000);
    assert.equal(stepTier(12_000, -1), 10_000);
    assert.equal(stepTier(12_000, 1), 100_000);
});
