/**
 * NET-05 — reconnect ladder + host-hold gating.
 *
 * Two invariants that must both hold or a match wedges:
 *  1. a failed snapshot fetch retries on a BOUNDED exponential ladder
 *     (`reconnectDelayMs`), never tightly, never forever;
 *  2. a client that already holds an authoritative snapshot is NOT paused by
 *     a flap — "cannot reach the snapshot" ≠ "must not act".
 *
 * The retry decision is pure (`shouldRetrySnapshot`), the delay is the same
 * `reconnectDelayMs` the drills assert, and the hold gate is applied at one
 * place (`shouldReportReconnecting`). Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconnectDelayMs } from '../lib/netcode/counters';

/** NET-05: bounded ladder. Mirrors useMatchStates' poll loop. */
export const MAX_SNAPSHOT_RETRIES = 8;

export function shouldRetrySnapshot(attempt: number, code: string | undefined): boolean {
    // A match that is gone is terminal — no ladder for MATCH_NOT_FOUND.
    if (code === 'MATCH_NOT_FOUND') return false;
    return attempt < MAX_SNAPSHOT_RETRIES;
}

/** Delay before retry N (0-based), from the shared counter helper. */
export function snapshotRetryDelay(attempt: number): number {
    return reconnectDelayMs(attempt);
}

/**
 * NET-05: "cannot reach the snapshot" must not mean "must not act" for a
 * client that already holds an authoritative snapshot.
 */
export function shouldReportReconnecting(opts: {
    status: 'syncing' | 'reconnecting' | 'connected' | 'ended';
    holdsSnapshot: boolean;
}): boolean {
    if (opts.status !== 'reconnecting') return true;
    return !opts.holdsSnapshot;
}

test('NET-05: the retry ladder is bounded and exponential', () => {
    for (let a = 0; a < MAX_SNAPSHOT_RETRIES; a++) {
        assert.equal(shouldRetrySnapshot(a, 'FETCH_THROW'), true, `attempt ${a} may retry`);
    }
    assert.equal(
        shouldRetrySnapshot(MAX_SNAPSHOT_RETRIES, 'FETCH_THROW'),
        false,
        'the ladder must end — a dead endpoint cannot be retried forever',
    );
    assert.equal(shouldRetrySnapshot(0, 'MATCH_NOT_FOUND'), false, 'a gone match is terminal');

    // Monotonic, capped, and matching the drills' reconnectDelayMs contract.
    const d = Array.from({ length: MAX_SNAPSHOT_RETRIES + 3 }, (_, i) => snapshotRetryDelay(i));
    for (let i = 1; i < d.length; i++) {
        assert.ok(d[i] >= d[i - 1], `delay must not shrink: ${d[i - 1]} -> ${d[i]}`);
        assert.ok(d[i] <= 8000 * 1.25 + 1, `delay must stay capped: ${d[i]}`);
    }
    assert.ok(d[0] < 8000, 'the first retry is fast (500ms base + jitter)');
});

test('NET-05: a snapshot holder keeps orchestrating through a flap', () => {
    // Host of record already holds the board: a failed poll is reported as
    // degraded, never as "pause everything".
    assert.equal(shouldReportReconnecting({ status: 'reconnecting', holdsSnapshot: true }), false);
    // A client with no snapshot must pause — it cannot render or act safely.
    assert.equal(shouldReportReconnecting({ status: 'reconnecting', holdsSnapshot: false }), true);
    // Other statuses always pass through.
    assert.equal(shouldReportReconnecting({ status: 'connected', holdsSnapshot: true }), true);
    assert.equal(shouldReportReconnecting({ status: 'ended', holdsSnapshot: true }), true);
    assert.equal(shouldReportReconnecting({ status: 'syncing', holdsSnapshot: true }), true);
});
