/**
 * N3 — netcode chaos drills (no live sockets).
 * Simulates intent floods, seq gaps, resync, and FSM host-election churn.
 * Run: npm run test:chaos   (or npm test — included)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    bumpNet,
    getNetCounters,
    resetNetCounters,
    reconnectDelayMs,
} from '../lib/netcode/counters';
import { resyncMatch, shouldPauseLocalOrchestration } from '../lib/netcode/resync';
import { classifyAbandon, ABANDON_GRACE_MS } from '../lib/netcode/abandon';
import { createMatchFsm } from '../lib/matchFsm';
import { parseGameIntent, parseGameActionEnvelope } from '../lib/protocol';
import { createReplayLog, appendReplayEvent, serializeReplay, parseReplay } from '../lib/replay/log';
import type { GameState } from '../lib/types';

function stubState(seqPositions: number): GameState {
    return {
        positions: {
            green: [seqPositions, -1, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
            blue: [-1, -1, -1, -1],
        },
        currentPlayer: 'green',
        diceValue: null,
        isRolling: false,
        gamePhase: 'rolling',
        status: 'playing',
        winner: null,
        winners: [],
        captureMessage: null,
        timeLeft: 15,
        strikes: { green: 0, red: 0, yellow: 0, blue: 0 },
        powerTiles: [],
        playerPowers: { green: [], red: [], yellow: [], blue: [] },
        powerSpentThisTurn: false,
        activeBoost: null,
        nukeFlash: [],
        boostTrail: null,
        activeTraps: [],
        activeShields: [],
        consecutiveSixes: 0,
        afkStats: {
            green: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            yellow: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
            blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        },
        idleWarning: null,
        participantPeers: {},
        isStarted: true,
        isBotMatch: false,
        botDifficulty: 'pro',
        lastUpdate: 0,
        playerCount: '4P',
        matchId: 'chaos-match',
    };
}

test('chaos: intent flood + duplicates are metered, not applied twice', () => {
    resetNetCounters();
    const processed = new Set<string>();
    const accepted: string[] = [];
    for (let i = 0; i < 100; i++) {
        const intentId = `intent-${i % 10}`; // 10 unique, 10x duplicate flood
        const parsed = parseGameIntent({
            type: 'REQUEST_ROLL',
            payload: {},
            intentId,
            sender: 'guest',
        });
        assert.equal(parsed.ok, true);
        if (processed.has(intentId)) {
            bumpNet('net_intent_dup');
            continue;
        }
        processed.add(intentId);
        bumpNet('net_intent_ok');
        accepted.push(intentId);
    }
    assert.equal(accepted.length, 10);
    assert.equal(getNetCounters().net_intent_dup, 90);
    assert.equal(getNetCounters().net_intent_ok, 10);
});

test('chaos: schema drops reject garbage envelopes', () => {
    resetNetCounters();
    let dropped = 0;
    for (const junk of [null, 1, 'x', { type: '' }, { type: 'GAME_ACTION' }, { type: 1 }]) {
        const parsed = parseGameActionEnvelope(junk);
        if (!parsed.ok) {
            bumpNet('net_schema_drop');
            dropped += 1;
        }
    }
    assert.equal(dropped, 5); // { type: 'GAME_ACTION' } has no actionId — still ok per schema
    assert.equal(getNetCounters().net_schema_drop, 5);
});

test('chaos: seq gap then resync applies only forward snapshots', async () => {
    resetNetCounters();
    let appliedSeq = 0;
    let state = stubState(1);
    const apply = (next: GameState, seq: number) => {
        assert.ok(seq > appliedSeq || seq === appliedSeq, 'apply must be monotonic');
        appliedSeq = Math.max(appliedSeq, seq);
        state = next;
    };

    // Jump from seq 1 → 7 (gap)
    const r1 = await resyncMatch({
        matchId: 'chaos-match',
        currentSeq: appliedSeq,
        allowEqual: true,
        fetchSnapshot: async () => ({ ok: true, seq: 7, state: stubState(7) }),
        apply,
    });
    assert.equal(r1.status, 'applied');
    assert.equal(appliedSeq, 7);
    assert.ok(getNetCounters().net_seq_gap >= 1, 'seq gap must be metered');

    // Stale snapshot must not regress
    const r2 = await resyncMatch({
        matchId: 'chaos-match',
        currentSeq: appliedSeq,
        fetchSnapshot: async () => ({ ok: true, seq: 5, state: stubState(5) }),
        apply,
    });
    assert.equal(r2.status, 'stale');
    assert.equal(appliedSeq, 7);

    // Fetch failure pauses orchestration
    const r3 = await resyncMatch({
        matchId: 'chaos-match',
        currentSeq: appliedSeq,
        fetchSnapshot: async () => ({ ok: false, code: 'SESSION_EXPIRED' }),
        apply,
    });
    assert.equal(r3.status, 'error');
    assert.equal(shouldPauseLocalOrchestration('reconnecting'), true);
    assert.equal(shouldPauseLocalOrchestration('connected'), false);
    assert.ok(state.positions.green);
});

test('chaos: host election churn stays legal on FSM', () => {
    const fsm = createMatchFsm();
    fsm.send({ type: 'OPEN_LOBBY' });
    fsm.send({ type: 'GUEST_SEATED' });
    fsm.send({ type: 'START' });
    fsm.send({ type: 'START' });
    for (let i = 0; i < 20; i++) {
        fsm.send({ type: 'HOST_ELECT' });
        bumpNet('net_authority_switch');
    }
    assert.equal(fsm.phase, 'live');
    assert.equal(fsm.illegalTransitions, 0);
    assert.equal(getNetCounters().net_authority_switch, 20);

    fsm.send({ type: 'RESYNC_NEEDED' });
    assert.equal(fsm.phase, 'resyncing');
    assert.equal(shouldPauseLocalOrchestration('syncing'), true);
    fsm.send({ type: 'RESYNC_APPLIED' });
    assert.equal(fsm.phase, 'live');
});

test('chaos: reconnect backoff stays within cap', () => {
    for (let attempt = 0; attempt < 30; attempt++) {
        const d = reconnectDelayMs(attempt, 500, 8000);
        assert.ok(d >= 500 && d <= 8000 * 1.25 + 1, `delay ${d} out of bounds at ${attempt}`);
    }
});

test('chaos: abandon grace rejects early, edge-only refunds, dual needs flag for burn', () => {
    const early = classifyAbandon({ hasEdgeSig: true, hasHostSig: true, sinceDisconnectMs: 1000 });
    assert.equal(early.mode, 'none');
    assert.equal(early.reason, 'grace');

    const edgeOnly = classifyAbandon({
        hasEdgeSig: true,
        hasHostSig: false,
        sinceDisconnectMs: ABANDON_GRACE_MS + 1,
    });
    assert.equal(edgeOnly.mode, 'edge_only_refund');
    assert.equal(edgeOnly.burnBps, 0);
    assert.equal(edgeOnly.refundBps, 10000);

    const dual = classifyAbandon({
        hasEdgeSig: true,
        hasHostSig: true,
        sinceDisconnectMs: ABANDON_GRACE_MS + 1,
    });
    assert.equal(dual.mode, 'dual_sign_burn_split');
    assert.equal(dual.burnEnabled, false, 'burn split must stay flag-gated until CHIPS');
});

test('chaos: replay survives a noisy reconnect drill', () => {
    const state = stubState(3);
    const log = createReplayLog({ matchId: 'chaos-match', playerCount: '4P' });
    for (let i = 1; i <= 50; i++) {
        appendReplayEvent(log, {
            seq: i,
            kind: i % 7 === 0 ? 'resync' : 'action',
            actionId: `a-${i}`,
            payload: { i },
        }, state);
    }
    const text = serializeReplay(log);
    // Simulate transport corruption of trailing whitespace only
    const parsed = parseReplay(text.trim() + '\n\n');
    assert.equal(parsed.events.length, 50);
    assert.equal(parsed.matchId, 'chaos-match');
});
