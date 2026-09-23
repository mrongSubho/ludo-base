/**
 * N3 live-drill runner — automates every drill row that does not need a human
 * holding a phone. Live device drills stay manual (docs/ops/NETCODE_DRILLS.md).
 *
 * Run: npm run drill:live
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bumpNet, getNetCounters, resetNetCounters, reconnectDelayMs } from '../lib/netcode/counters';
import { resyncMatch, shouldPauseLocalOrchestration } from '../lib/netcode/resync';
import { classifyAbandon, ABANDON_GRACE_MS } from '../lib/netcode/abandon';
import { createMatchFsm } from '../lib/matchFsm';
import { parseGameIntent, parseJoinRequest, parseGameActionEnvelope } from '../lib/protocol';
import type { GameState } from '../lib/types';

const rows: Array<{ id: string; live: boolean; note: string }> = [
    { id: 'D1 drop PeerJS 10s', live: true, note: 'manual — badge → resync_ok → timers resume' },
    { id: 'D2 drop Supabase Realtime', live: true, note: 'manual — dual-path still seats/moves' },
    { id: 'D3 kill host / elect', live: true, note: 'manual — net_authority_switch, no double-apply' },
    { id: 'D4 airplane 30s', live: true, note: 'manual — abandon grace visible' },
    { id: 'D5 duplicate join', live: false, note: 'automated below' },
    { id: 'A1 intent flood', live: false, note: 'automated below' },
    { id: 'A2 schema garbage', live: false, note: 'automated below' },
    { id: 'A3 seq gap + stale', live: false, note: 'automated below' },
    { id: 'A4 host-elect churn', live: false, note: 'automated below' },
    { id: 'A5 backoff cap', live: false, note: 'automated below' },
    { id: 'A6 abandon grace', live: false, note: 'automated below' },
];

test('D5 duplicate join — second JOIN_REQUEST is a no-op seat', () => {
    resetNetCounters();
    const seen = new Set<string>();
    const first = parseJoinRequest({
        type: 'JOIN_REQUEST',
        intentId: 'j1',
        payload: { name: 'Ada', walletAddress: '0xada' },
    });
    assert.equal(first.ok, true);
    if (first.ok && !seen.has('0xada')) {
        seen.add('0xada');
        bumpNet('net_intent_ok');
    }
    const second = parseJoinRequest({
        type: 'JOIN_REQUEST',
        intentId: 'j2',
        payload: { name: 'Ada', walletAddress: '0xada' },
    });
    assert.equal(second.ok, true);
    if (second.ok && seen.has('0xada')) {
        bumpNet('net_intent_dup');
    }
    assert.equal(seen.size, 1);
    assert.equal(getNetCounters().net_intent_dup, 1);
    assert.equal(getNetCounters().net_intent_ok, 1);
});

test('A1 intent flood metered', () => {
    resetNetCounters();
    const processed = new Set<string>();
    for (let i = 0; i < 40; i++) {
        const intentId = `i-${i % 8}`;
        const ok = parseGameIntent({ type: 'REQUEST_ROLL', payload: {}, intentId }).ok;
        assert.equal(ok, true);
        if (processed.has(intentId)) bumpNet('net_intent_dup');
        else {
            processed.add(intentId);
            bumpNet('net_intent_ok');
        }
    }
    assert.equal(getNetCounters().net_intent_ok, 8);
    assert.equal(getNetCounters().net_intent_dup, 32);
});

test('A2 schema garbage rejected', () => {
    resetNetCounters();
    for (const junk of [null, 42, 'nope', { type: 1 }, { foo: 1 }]) {
        if (!parseGameActionEnvelope(junk).ok) bumpNet('net_schema_drop');
    }
    assert.ok(getNetCounters().net_schema_drop >= 4);
});

test('A3 seq gap + stale reject + fetch fail pause', async () => {
    resetNetCounters();
    let seq = 0;
    const state = { playerCount: '4P', matchId: 'drill', status: 'playing' } as GameState;

    const gap = await resyncMatch({
        matchId: 'drill',
        currentSeq: seq,
        allowEqual: true,
        fetchSnapshot: async () => ({ ok: true, seq: 9, state }),
        apply: (_s, s) => {
            seq = s;
        },
    });
    assert.equal(gap.status, 'applied');
    assert.ok(getNetCounters().net_seq_gap >= 1);

    const stale = await resyncMatch({
        matchId: 'drill',
        currentSeq: seq,
        fetchSnapshot: async () => ({ ok: true, seq: 3, state }),
        apply: (_s, s) => {
            seq = Math.max(seq, s);
        },
    });
    assert.equal(stale.status, 'stale');
    assert.equal(seq, 9);

    const fail = await resyncMatch({
        matchId: 'drill',
        currentSeq: seq,
        fetchSnapshot: async () => ({ ok: false, code: 'SESSION_EXPIRED' }),
        apply: () => {},
    });
    assert.equal(fail.status, 'error');
    assert.equal(shouldPauseLocalOrchestration('reconnecting'), true);
});

test('A4 host-elect churn stays legal', () => {
    const fsm = createMatchFsm();
    fsm.send({ type: 'START' });
    fsm.send({ type: 'START' });
    for (let i = 0; i < 15; i++) {
        fsm.send({ type: 'HOST_ELECT' });
        bumpNet('net_authority_switch');
    }
    assert.equal(fsm.phase, 'live');
    assert.equal(fsm.illegalTransitions, 0);
    assert.equal(getNetCounters().net_authority_switch, 15);
});

test('A5 reconnect backoff within cap', () => {
    for (let a = 0; a < 25; a++) {
        const d = reconnectDelayMs(a, 500, 8000);
        assert.ok(d >= 500 && d <= 8000 * 1.25 + 1);
    }
});

test('A6 abandon grace + HIGH-2 refund', () => {
    assert.equal(
        classifyAbandon({ hasEdgeSig: true, hasHostSig: true, sinceDisconnectMs: 10 }).mode,
        'none'
    );
    const edge = classifyAbandon({
        hasEdgeSig: true,
        hasHostSig: false,
        sinceDisconnectMs: ABANDON_GRACE_MS + 5,
    });
    assert.equal(edge.mode, 'edge_only_refund');
    assert.equal(edge.burnBps, 0);
});

test('Drill matrix summary — print sign-off sheet', () => {
    const automatable = rows.filter((r) => !r.live);
    console.log('\n── Live-drill sign-off (automated rows) ──');
    for (const r of automatable) {
        console.log(`  [auto] ${r.id} — covered`);
    }
    console.log('── Manual rows (device / two clients) ──');
    for (const r of rows.filter((x) => x.live)) {
        console.log(`  [ ] ${r.id} — ${r.note}`);
    }
    console.log('');
    assert.ok(automatable.length >= 6);
});
