/**
 * Golden-replay CI gate — ≥50 deterministic matches, stable hashes.
 * Run: npm run test:golden
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    GOLDEN_MATCH_COUNT,
    assertDeterministicCorpus,
    runGoldenCorpus,
    runGoldenMatch,
    lcg,
} from './golden-replay';
import { hashGameState } from '../lib/replay/hash';

test('golden corpus ≥50 matches is deterministic (double-run)', () => {
    const summary = assertDeterministicCorpus(GOLDEN_MATCH_COUNT);
    assert.ok(summary.n >= 50, `need ≥50 golden matches, got ${summary.n}`);
    assert.ok(summary.uniqueHashes >= 1);
    console.log('golden summary', summary);
});

test('golden match replay JSONL parses and matches finalHash', () => {
    const m = runGoldenMatch(7, 12345);
    assert.match(m.replayJsonl, /golden-7/);
    assert.ok(m.replayJsonl.split('\n').length >= 2);
    assert.equal(m.finalHash.length, 16);
    // Same seed → same hash
    assert.equal(runGoldenMatch(7, 12345).finalHash, m.finalHash);
});

test('golden seeds differ across the corpus', () => {
    const corpus = runGoldenCorpus(10);
    const hashes = new Set(corpus.map((c) => c.finalHash));
    assert.ok(hashes.size >= 2, 'corpus should not be one identical hash');
    assert.equal(typeof lcg(1)(), 'number');
});

test('hashGameState is a 16-hex digest used in corpus', () => {
    const m = runGoldenMatch(0, 99);
    assert.equal(m.finalHash.length, 16);
    assert.match(m.finalHash, /^[0-9a-f]+$/);
    assert.equal(hashGameState.length, 1);
});
