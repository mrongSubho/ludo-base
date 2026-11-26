/**
 * CSPRNG die fairness & rejection-sampling tests.
 * Run: npx --yes tsx --test scripts/dice-fairness.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollUnbiasedDie } from '../lib/engine/core';

test('rollUnbiasedDie rejects bytes >= 252 and maps 0..251 uniformly to 1..6', () => {
    const seq = [252, 253, 254, 255, 0];
    let idx = 0;
    const face = rollUnbiasedDie((arr) => {
        arr[0] = seq[idx++];
        return arr;
    });
    assert.equal(idx, 5, 'must skip 252..255 and consume 0');
    assert.equal(face, 1);

    // Exhaustive check across 0..251: every face appears exactly 42 times.
    const counts = [0, 0, 0, 0, 0, 0];
    for (let b = 0; b < 252; b++) {
        const f = rollUnbiasedDie((arr) => {
            arr[0] = b;
            return arr;
        });
        assert.ok(f >= 1 && f <= 6);
        counts[f - 1] += 1;
    }
    assert.deepEqual(counts, [42, 42, 42, 42, 42, 42]);
});

test('rollUnbiasedDie passes chi-squared uniformity over 60,000 CSPRNG rolls', () => {
    const N = 60_000;
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
        const face = rollUnbiasedDie();
        assert.ok(face >= 1 && face <= 6);
        counts[face - 1] += 1;
    }
    const expected = N / 6;
    const chiSq = counts.reduce((acc, c) => acc + ((c - expected) ** 2) / expected, 0);
    // df = 5, p = 0.001 critical value = 20.515
    assert.ok(chiSq < 20.515, `chi-squared ${chiSq.toFixed(3)} exceeded 20.515: ${JSON.stringify(counts)}`);
});
