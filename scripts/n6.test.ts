/**
 * N6 spectator parity tests — parse-or-drop + bet windows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseSpectatorBroadcast,
    parseBetWindowOpen,
    parseBetWindowClosed,
} from '../lib/protocol';
import { bumpNet, getNetCounters, resetNetCounters } from '../lib/netcode/counters';

test('N6 spectator broadcast parse-or-drop', () => {
    resetNetCounters();
    const ok = parseSpectatorBroadcast({ type: 'SYNC_STATE', gameState: { a: 1 } });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value.type, 'SYNC_STATE');

    assert.equal(parseSpectatorBroadcast({ type: 'HACK', gameState: {} }).ok, false);
    assert.equal(parseSpectatorBroadcast(null).ok, false);
    assert.equal(parseSpectatorBroadcast({ type: 'EMOTE' }).ok, false);

    if (!parseSpectatorBroadcast({ type: 'nope' }).ok) bumpNet('net_schema_drop');
    assert.equal(getNetCounters().net_schema_drop, 1);
});

test('N6 bet window schemas', () => {
    const open = parseBetWindowOpen({ windowId: 'w1', betType: 'winner', expiresAt: 123 });
    assert.equal(open.ok, true);
    assert.equal(parseBetWindowOpen({ windowId: '', betType: 'x', expiresAt: 1 }).ok, false);
    assert.equal(parseBetWindowOpen({ windowId: 'w', betType: 'x' }).ok, false);

    const closed = parseBetWindowClosed({ windowId: 'w1', windowClosedAt: '2026-09-23T00:00:00Z' });
    assert.equal(closed.ok, true);
    assert.equal(parseBetWindowClosed({ windowId: 'w1' }).ok, false);
});
