import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkExpectedSequence,
  compareAndSwapSequence,
  confirmSequenceAfterWrite,
  isDuplicateAction,
  isExpired,
  isTerminalMatch,
} from '../supabase/functions/_shared/networkBoundary';

test('stale sequence responses identify the current authoritative sequence', () => {
  assert.deepEqual(checkExpectedSequence(8, 7), {
    ok: false,
    code: 'STALE_SEQ',
    currentSeq: 8,
  });
  assert.deepEqual(checkExpectedSequence(7, 7), { ok: true });
});

test('compare-and-swap advances only the expected sequence', () => {
  assert.equal(compareAndSwapSequence(7, 7), 8);
  assert.equal(compareAndSwapSequence(8, 7), null);
});

test('a concurrent writer is rejected when the post-write sequence is not ours', () => {
  assert.deepEqual(confirmSequenceAfterWrite(8, 8), { ok: true });
  assert.deepEqual(confirmSequenceAfterWrite(9, 8), {
    ok: false,
    code: 'STALE_SEQ',
    currentSeq: 9,
  });
});

test('expired sessions are deterministic at the boundary', () => {
  const now = Date.parse('2026-09-14T00:00:00.000Z');
  assert.equal(isExpired('2026-09-13T23:59:59.999Z', now), true);
  assert.equal(isExpired('2026-09-14T00:00:00.001Z', now), false);
});

test('terminal matches reject both winner and finished states', () => {
  assert.equal(isTerminalMatch({ winner: 'green', status: 'playing' }), true);
  assert.equal(isTerminalMatch({ winner: null, status: 'finished' }), true);
  assert.equal(isTerminalMatch({ winner: null, status: 'playing' }), false);
});

test('consumed or passed rolls are duplicate actions', () => {
  assert.equal(isDuplicateAction('consumed'), true);
  assert.equal(isDuplicateAction('passed'), true);
  assert.equal(isDuplicateAction('open'), false);
  assert.equal(isDuplicateAction(null), true);
});
