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
