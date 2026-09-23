/**
 * Q6 edgeOps unit tests — version check + degrade thresholds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    checkEdgeVersion,
    compareEdgeVersion,
    shouldDegrade,
    EDGE_API_VERSION,
    REALTIME_LOAD_TARGETS,
} from '../lib/edgeOps';

test('Q6 edge version check fails closed on missing/stale/mismatch', () => {
    assert.equal(checkEdgeVersion(EDGE_API_VERSION, EDGE_API_VERSION).ok, true);
    assert.equal(checkEdgeVersion(undefined, EDGE_API_VERSION).ok, false);
    assert.equal(checkEdgeVersion(undefined, EDGE_API_VERSION, { strict: false }).ok, true);
    const stale = checkEdgeVersion('2026-09-22.1', '2026-09-23.1');
    assert.equal(stale.ok, false);
    assert.equal(stale.ok === false && stale.reason, 'STALE');
    const mismatch = checkEdgeVersion('2026-09-24.1', '2026-09-23.1');
    assert.equal(mismatch.ok === false && mismatch.reason, 'MISMATCH');
    assert.equal(compareEdgeVersion('2026-09-23.1', '2026-09-23.2'), -1);
});

test('Q6 realtime degrade thresholds', () => {
    assert.equal(shouldDegrade({ rooms: 10, msgPerRoomPerSec: 2 }).degrade, false);
    const hot = shouldDegrade({ rooms: REALTIME_LOAD_TARGETS.maxRooms + 1, msgPerRoomPerSec: 2 });
    assert.equal(hot.degrade, true);
    assert.equal(hot.dropFirst, 'emote');
    const chatty = shouldDegrade({ rooms: 1, msgPerRoomPerSec: 20 });
    assert.equal(chatty.degrade, true);
});
