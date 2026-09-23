/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
/**
 * N3 deepened live-drill simulation — D1–D4 as in-process client pairs.
 * Complements (does not replace) two-phone drills in NETCODE_DRILLS.md.
 *
 * Run: npm run drill:deep
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bumpNet, getNetCounters, resetNetCounters } from '../lib/netcode/counters';
import { resyncMatch, shouldPauseLocalOrchestration } from '../lib/netcode/resync';
import { classifyAbandon, ABANDON_GRACE_MS, abandonGraceRemainingMs } from '../lib/netcode/abandon';
import { createMatchFsm } from '../lib/matchFsm';
import { parseGameIntent, parseJoinRequest } from '../lib/protocol';
import type { GameState, GameActionType } from '../lib/types';

type WireMsg = { type: string; actionId?: string; intentId?: string; payload?: unknown; action?: unknown };

/** Minimal dual-path bus (PeerJS + Supabase stand-in). */
class FakeBus {
    private peerUp = true;
    private supaUp = true;
    readonly delivered: WireMsg[] = [];
    readonly dropped: WireMsg[] = [];

    dropPeer(): void { this.peerUp = false; }
    liftPeer(): void { this.peerUp = true; }
    dropSupa(): void { this.supaUp = false; }
    liftSupa(): void { this.supaUp = true; }

    send(channel: 'peer' | 'supa', msg: WireMsg): boolean {
        const up = channel === 'peer' ? this.peerUp : this.supaUp;
        if (!up) {
            this.dropped.push(msg);
            return false;
        }
        this.delivered.push(msg);
        return true;
    }

    /** Dual-path send — at least one channel must land. */
    sendDual(msg: WireMsg): boolean {
        const a = this.send('peer', msg);
        const b = this.send('supa', msg);
        return a || b;
    }
}

class Client {
    seq = 0;
    processed = new Set<string>();
    fsm = createMatchFsm('idle');
    status: 'connected' | 'reconnecting' | 'syncing' | 'ended' = 'connected';

    accept(msg: WireMsg): void {
        const intentId = msg.intentId || msg.actionId;
        if (intentId && this.processed.has(intentId)) {
            bumpNet('net_intent_dup');
            return;
        }
        if (msg.type === 'GAME_INTENT' || msg.type === 'GAME_ACTION') {
            const parsed = parseGameIntent(msg.action ?? msg.payload);
            if (!parsed.ok) {
                bumpNet('net_schema_drop');
                return;
            }
        }
        if (intentId) this.processed.add(intentId);
        bumpNet('net_intent_ok');
        this.fsm.send({ type: 'START' });
    }

    async pull(matchId: string, fetchSnap: () => Promise<{ ok: boolean; seq?: number; state?: GameState; code?: string }>) {
        const r = await resyncMatch({
            matchId,
            currentSeq: this.seq,
            allowEqual: true,
            fetchSnapshot: fetchSnap,
            apply: (_s, seq) => {
                this.seq = Math.max(this.seq, seq);
            },
            onStatus: (st) => {
                if (st === 'connected' || st === 'reconnecting' || st === 'syncing' || st === 'ended') {
                    this.status = st;
                }
            },
        });
        return r;
    }
}

function stubState(): GameState {
    return {
        positions: { green: [0, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
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
        matchId: 'deep-drill',
    };
}

test('D1 drop PeerJS 10s — dual-path still delivers, then resync', async () => {
    resetNetCounters();
    const bus = new FakeBus();
    const host = new Client();
    const guest = new Client();
    host.fsm.send({ type: 'START' });

    bus.dropPeer();
    const msg: WireMsg = {
        type: 'GAME_INTENT',
        intentId: 'd1-intent-1',
        action: { type: 'REQUEST_ROLL', payload: {}, intentId: 'd1-intent-1' },
    };
    assert.equal(bus.sendDual(msg), true, 'Supabase path must survive PeerJS drop');
    assert.equal(bus.send('peer', msg), false);
    host.accept(msg);
    guest.accept(msg);
    assert.equal(getNetCounters().net_intent_ok, 2);

    // After lift + pull, both on same seq
    bus.liftPeer();
    const snap = async () => ({ ok: true as const, seq: 4, state: stubState() });
    await host.pull('deep-drill', snap);
    await guest.pull('deep-drill', snap);
    assert.equal(host.seq, 4);
    assert.equal(guest.seq, 4);
    assert.equal(shouldPauseLocalOrchestration('connected'), false);
});

test('D2 drop Supabase Realtime — PeerJS path still seats and moves', () => {
    resetNetCounters();
    const bus = new FakeBus();
    const host = new Client();
    bus.dropSupa();

    const join: WireMsg = {
        type: 'JOIN_REQUEST',
        intentId: 'd2-join-1',
        payload: { name: 'Ada', walletAddress: '0xada' },
    };
    assert.equal(parseJoinRequest(join).ok, true);
    // Peer carries the join
    assert.equal(bus.sendDual({ ...join, type: 'SYNC_PROFILE' }), true);
    const intent: WireMsg = {
        type: 'GAME_ACTION',
        actionId: 'd2-a1',
        action: { type: 'REQUEST_MOVE', payload: { color: 'green', tokenIndex: 0 }, intentId: 'd2-a1' },
    };
    assert.equal(bus.sendDual(intent), true);
    host.accept(intent);
    assert.equal(getNetCounters().net_intent_ok, 1);
    bus.liftSupa();
});

test('D3 kill host / elect — FSM + dedup, no double-apply', async () => {
    resetNetCounters();
    const a = new Client();
    const b = new Client();
    // idle → starting → live
    a.fsm.send({ type: 'START' });
    a.fsm.send({ type: 'START' });
    b.fsm.send({ type: 'START' });
    b.fsm.send({ type: 'START' });

    for (let i = 0; i < 5; i++) {
        a.fsm.send({ type: 'HOST_ELECT' });
        b.fsm.send({ type: 'HOST_ELECT' });
        bumpNet('net_authority_switch', 2);
    }
    assert.equal(a.fsm.phase, 'live');
    assert.equal(a.fsm.illegalTransitions, 0);

    const msg: WireMsg = {
        type: 'GAME_ACTION',
        actionId: 'd3-shared',
        action: { type: 'REQUEST_ROLL', payload: {}, intentId: 'd3-shared' },
    };
    a.accept(msg);
    a.accept(msg); // duplicate
    b.accept(msg);
    assert.equal(getNetCounters().net_intent_ok, 2);
    assert.equal(getNetCounters().net_intent_dup, 1);
});

test('D4 airplane 30s — grace rejects abandon until window', async () => {
    resetNetCounters();
    const client = new Client();
    const snapFail = async () => ({ ok: false as const, code: 'SESSION_EXPIRED' });
    const r1 = await client.pull('deep-drill', snapFail);
    assert.equal(r1.status, 'error');
    assert.equal(shouldPauseLocalOrchestration('reconnecting'), true);

    // 30s into a 60s grace — abandon must not file
    const early = classifyAbandon({
        hasEdgeSig: true,
        hasHostSig: true,
        sinceDisconnectMs: 30_000,
    });
    assert.equal(early.mode, 'none');
    assert.equal(abandonGraceRemainingMs(30_000), ABANDON_GRACE_MS - 30_000);

    const late = classifyAbandon({
        hasEdgeSig: true,
        hasHostSig: false,
        sinceDisconnectMs: ABANDON_GRACE_MS + 1,
    });
    assert.equal(late.mode, 'edge_only_refund');
    assert.equal(late.burnBps, 0);

    // Recovery
    const r2 = await client.pull('deep-drill', async () => ({ ok: true, seq: 8, state: stubState() }));
    assert.equal(r2.status, 'applied');
    assert.equal(client.status, 'connected');
});

test('Deep drill sign-off sheet', () => {
    console.log(`
── Deep drill sign-off (in-process) ──
  [sim] D1 drop PeerJS — dual-path + resync OK
  [sim] D2 drop Supabase — peer path OK
  [sim] D3 host elect — FSM legal, dedup OK
  [sim] D4 airplane — grace + HIGH-2 refund OK
── Still required on real devices ──
  [ ] D1–D4 with two phones / two browsers (NETCODE_DRILLS.md)
  [ ] Q2 phone hop pass (DEVICE_PASS.md)
`);
    assert.equal(getNetCounters().net_schema_drop, 0);
});
