/**
 * Q5 + N4 tests — error copy, protocol version/size cap, TTL/LRU dedup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError, friendlyErrorFromMessage } from '../lib/errorCopy';
import {
    parseGameActionEnvelope,
    parseGameIntent,
    protocolVersionOk,
    withinSizeCap,
    PROTOCOL_VERSION,
    MAX_MESSAGE_BYTES,
} from '../lib/protocol';
import { createDedupStore, rememberIntent } from '../lib/netcode/dedup';
import { resetNetCounters, getNetCounters } from '../lib/netcode/counters';

test('Q5 friendly copy for match action codes', () => {
    const expired = friendlyError('SESSION_EXPIRED');
    assert.equal(expired.recoverable, true);
    assert.match(expired.copy, /Sign once/);
    assert.equal(friendlyError('MATCH_NOT_FOUND').recoverable, false);
    assert.equal(friendlyError('STALE_SEQ').cta, 'Retry');
    assert.equal(friendlyError(undefined).code, 'UNKNOWN');
    assert.equal(friendlyErrorFromMessage('ChunkLoadError: failed').code, 'CHUNK');
    assert.equal(friendlyErrorFromMessage('session expired').code, 'SESSION_EXPIRED');
});

test('N4 protocolVersion + size cap', () => {
    assert.equal(PROTOCOL_VERSION.startsWith('1.'), true);
    assert.equal(protocolVersionOk(undefined), true);
    assert.equal(protocolVersionOk('1.2'), true);
    assert.equal(protocolVersionOk('2.0'), false);
    assert.equal(withinSizeCap({ a: 1 }), true);
    assert.equal(withinSizeCap({ a: 'x'.repeat(MAX_MESSAGE_BYTES + 10) }), false);

    assert.equal(parseGameActionEnvelope({ type: 'SYNC_STATE', protocolVersion: '1.0' }).ok, true);
    assert.equal(parseGameActionEnvelope({ type: 'SYNC_STATE', protocolVersion: '2.0' }).ok, false);
    assert.equal(parseGameIntent({ type: 'REQUEST_ROLL', payload: {}, intentId: 'a'.repeat(MAX_MESSAGE_BYTES) }).ok, false);
});

test('N4 TTL + LRU dedup store', () => {
    resetNetCounters();
    const store = createDedupStore({ max: 3, ttlMs: 1000 });
    assert.equal(store.add('a', 0), false);
    assert.equal(store.add('a', 1), true, 'second add is dup');
    assert.equal(store.add('b', 2), false);
    assert.equal(store.add('c', 3), false);
    assert.equal(store.add('d', 4), false);
    assert.equal(store.size(), 3, 'LRU cap');
    assert.ok(store.evictions() >= 1);

    // TTL expiry
    const ttl = createDedupStore({ max: 10, ttlMs: 50 });
    ttl.add('old', 0);
    assert.equal(ttl.has('old', 10), true);
    assert.equal(ttl.has('old', 100), false);

    assert.equal(rememberIntent(store, undefined), 'skip');
    assert.equal(rememberIntent(store, 'fresh-1'), 'new');
    assert.equal(rememberIntent(store, 'fresh-1'), 'dup');
    assert.ok(getNetCounters().net_intent_dup >= 1);
});

test('NET-08: a replayed id below the high-water mark is refused after eviction', () => {
    // The old unbounded Sets never forgot; the bounded store must not forget
    // ORDER. An evicted-but-stale id must read as duplicate, never as new —
    // otherwise it double-applies after long enough.
    const evicted: string[] = [];
    const store = createDedupStore({ max: 2, ttlMs: 10 * 60 * 1000, onEvict: (id, r) => evicted.push(`${id}:${r}`) });
    store.add('1000-a');
    store.add('2000-a');
    store.add('3000-a'); // evicts 1000-a (LRU)
    store.add('4000-a'); // evicts 2000-a
    assert.deepEqual(evicted, ['1000-a:lru', '2000-a:lru']);

    // The evicted ids are still refused by the order guard.
    assert.equal(store.has('1000-a'), true, 'an evicted older id is still a duplicate');
    assert.equal(store.has('2000-a'), true);
    // A genuinely-new id has never been seen and is not below the mark.
    assert.equal(store.has('9999-new'), false);
    assert.equal(store.highWaterSeq(), 4000);

    // clear() resets both the map and the mark — a new match is a new space.
    store.clear();
    assert.equal(store.highWaterSeq(), 0);
    assert.equal(store.has('1000-a'), false, 'after a clear the old id space is gone too');
});

test('NET-08: order-less ids fail closed rather than being treated as new', () => {
    const store = createDedupStore({ max: 4 });
    store.add('6f1e-uuid-no-seq');
    assert.equal(store.has('6f1e-uuid-no-seq'), true, 'resident order-less ids are still duplicates');
    assert.equal(store.has('another-uuid'), false, 'an unseen order-less id is not provably stale — treated as new');
});

test('NET-23: expiry is amortized — head walk every call, full sweep throttled', () => {
    const seen: string[] = [];
    const store = createDedupStore({ max: 10, ttlMs: 100, sweepIntervalMs: 10_000, onEvict: (id, reason) => seen.push(`${id}:${reason}`) });
    store.add('old', 0);
    store.add('new', 150);
    // t=160: the expired head is collected by the per-call walk; the fresh
    // head stops it. The full sweep stays throttled (160 - 0 < 10_000).
    assert.equal(store.has('probe', 160), false);
    assert.deepEqual(seen, ['old:ttl']);
    assert.equal(store.has('old', 160), false, 'expired head is gone');
    assert.equal(store.has('new', 160), true, 'fresh head survives');
    // t=20000: past the throttle — the full sweep reclaims the stranded entry.
    assert.equal(store.has('probe2', 20_000), false);
    assert.deepEqual(seen, ['old:ttl', 'new:ttl']);
    assert.equal(store.size(), 0);
    // Expiry never flips a present id to missing early: a live id reads dup.
    const live = createDedupStore({ max: 10, ttlMs: 100 });
    live.add('k', 0);
    assert.equal(live.has('k', 50), true);
    assert.equal(live.add('k', 50), true, 'still dup before TTL');
});
