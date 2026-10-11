/**
 * NET-01/NET-02 — the liveness recovery that stops a match wedging.
 *
 * A turn with no legal move (or a third six) hands the turn over. Before this
 * path existed, `match_states` desynced and every later action was refused with
 * STALE_SEQ permanently — the next player 403'd forever. The contract:
 *
 *  - one 409 with a fresh seq re-submits with the SAME rollId (no double-apply);
 *  - exactly ONE retry (two racers must not ping-pong);
 *  - a second refusal returns the freshest snapshot for the caller to resync;
 *  - a 409 with no usable seq is returned, not retried into a loop.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isStaleSeqCall,
    staleSeqValue,
    withStaleSeqRetry,
    type MoveAuthCall,
} from '../lib/netcode/staleSeq';

const ok = (seq: number): MoveAuthCall => ({ ok: true, status: 200, data: { seq, state: {} } });
const stale = (seq: number, rollId: string, code: string | undefined = 'STALE_SEQ'): MoveAuthCall => ({
    ok: false, status: 409, data: { error: 'STALE_SEQ', code, seq, state: {}, rollId },
});
const illegal: MoveAuthCall = ({ ok: false, status: 409, data: { error: 'ILLEGAL_ACTION', code: 'ILLEGAL_ACTION', seq: 9 } });

test('a STALE_SEQ 409 re-submits once with the fresh seq and the same rollId', async () => {
    const seen: { expectedSeq: number; rollId: string }[] = [];
    const r = await withStaleSeqRetry(async (expectedSeq) => {
        seen.push({ expectedSeq, rollId: 'roll-7' });
        // First attempt races: the authority moved 5 -> 8.
        return seen.length === 1 ? stale(8, 'roll-7') : ok(8);
    }, 5);
    assert.equal(r.ok, true, 'the retry succeeds');
    assert.equal(seen.length, 2, 'exactly one retry');
    assert.deepEqual(seen, [
        { expectedSeq: 5, rollId: 'roll-7' },
        { expectedSeq: 8, rollId: 'roll-7' },
    ], 'the rollId is carried through unchanged — no double-apply');
});

test('a second STALE_SEQ is not retried — it surfaces as the freshest refusal', async () => {
    let attempts = 0;
    const r = await withStaleSeqRetry(async () => {
        attempts += 1;
        // Both attempts lose the race, and the authority advanced further.
        return stale(8 + attempts, 'roll-7');
    }, 5);
    assert.equal(attempts, 2, 'bounded to one retry — two racers must not ping-pong');
    assert.equal(r.ok, false);
    assert.equal(staleSeqValue(r), 10, 'the caller gets the freshest seq to reconcile against');
});

test('a non-stale 409 (illegal move) is never retried', async () => {
    let attempts = 0;
    const r =     await withStaleSeqRetry(async () => { attempts += 1; return illegal; }, 5);
    assert.equal(attempts, 1, 'retrying an illegal move would burn a wallet prompt');
    assert.equal(r.data.code, 'ILLEGAL_ACTION');
});

test('a 409 with no usable seq is returned, not looped', async () => {
    let attempts = 0;
    const r = await withStaleSeqRetry(async () => {
        attempts += 1;
        return { ok: false, status: 409, data: { code: 'STALE_SEQ' } };
    }, 5);
    assert.equal(attempts, 1);
    assert.equal(r.ok, false);
    assert.equal(isStaleSeqCall(r), false, 'no seq means no retry target');
    assert.equal(staleSeqValue(r), null);
});

test('legacy 409s with no code at all still recover (Edge shape drift)', async () => {
    let attempts = 0;
    const r = await withStaleSeqRetry(async (_seq) => {
        attempts += 1;
        return attempts === 1 ? { ok: false, status: 409, data: { error: 'stale', seq: 12 } } : ok(12);
    }, 4);
    assert.equal(r.ok, true);
    assert.equal(attempts, 2);
});

test('success and non-409 refusals pass straight through', async () => {
    assert.equal((await withStaleSeqRetry(async () => ok(3), 3)).ok, true);
    const expired = { ok: false, status: 401, data: { code: 'SESSION_EXPIRED' } } as MoveAuthCall;
    let attempts = 0;
    const r = await withStaleSeqRetry(async () => { attempts += 1; return expired; }, 3);
    assert.equal(attempts, 1, '401 recovery is the caller\'s session path, not the seq retry');
    assert.equal(r.data.code, 'SESSION_EXPIRED');
});
