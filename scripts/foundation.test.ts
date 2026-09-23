/**
 * Foundation unit tests — telemetry, netcode counters, FSM, protocol, replay.
 * Run: npm run test:foundation
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { track, captureException, setTelemetryTransport, initTelemetry, setTelemetrySampleRate } from '../lib/telemetry';
import {
    bumpNet,
    getNetCounters,
    resetNetCounters,
    reconnectDelayMs,
    onNetCounter,
} from '../lib/netcode/counters';
import { createMatchFsm, canTransition, nextPhase } from '../lib/matchFsm';
import {
    createReplayLog,
    appendReplayEvent,
    finalizeReplay,
    serializeReplay,
    parseReplay,
    verifyReplayEnd,
} from '../lib/replay/log';
import { hashGameState } from '../lib/replay/hash';
import {
    parseGameIntent,
    parseGameActionEnvelope,
    parseJoinRequest,
} from '../lib/protocol';
import type { GameState } from '../lib/types';

function stubState(): GameState {
    return {
        positions: { green: [-1, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
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
        botDifficulty: 'rookie',
        lastUpdate: 0,
        playerCount: '4P',
    };
}

test('telemetry redacts sensitive keys and does not throw', () => {
    const events: Array<{ name: string; props?: unknown }> = [];
    setTelemetryTransport({
        track(name, props) {
            events.push({ name, props });
        },
        exception() {
            /* ok */
        },
    });
    setTelemetrySampleRate(1);
    track('roll_ok', { signature: '0xdead', dice: 6 });
    assert.equal(events[0]?.name, 'roll_ok');
    const props = events[0]?.props as Record<string, unknown>;
    assert.equal(props.signature, '[redacted]');
    assert.equal(props.dice, 6);
    captureException(new Error('x'), { sessionKey: 'secret' });
});

test('initTelemetry is idempotent and emits session_start once', () => {
    let n = 0;
    setTelemetryTransport({
        track(name) {
            if (name === 'session_start') n += 1;
        },
        exception() {},
    });
    initTelemetry();
    initTelemetry();
    assert.equal(n, 1);
});

test('net counters bump, notify, and reset', () => {
    resetNetCounters();
    let seen = 0;
    const off = onNetCounter(() => {
        seen += 1;
    });
    bumpNet('net_reconnect_attempt', 2);
    bumpNet('net_seq_gap');
    off();
    const counts = getNetCounters();
    assert.equal(counts.net_reconnect_attempt, 2);
    assert.equal(counts.net_seq_gap, 1);
    assert.equal(seen, 2);
    resetNetCounters();
    assert.equal(getNetCounters().net_reconnect_attempt, 0);
});

test('reconnectDelayMs backs off and caps', () => {
    const a = reconnectDelayMs(0, 500, 8000);
    const b = reconnectDelayMs(10, 500, 8000);
    assert.ok(a >= 500 && a <= 500 * 1.25 + 1);
    assert.ok(b <= 8000 * 1.25 + 1);
});

test('match FSM happy path and illegal reject', () => {
    const fsm = createMatchFsm();
    assert.equal(fsm.phase, 'idle');
    fsm.send({ type: 'OPEN_LOBBY' });
    fsm.send({ type: 'GUEST_SEATED' });
    fsm.send({ type: 'START' });
    fsm.send({ type: 'START' });
    assert.equal(fsm.phase, 'live');
    fsm.send({ type: 'RESYNC_NEEDED' });
    assert.equal(fsm.phase, 'resyncing');
    fsm.send({ type: 'RESYNC_APPLIED' });
    fsm.send({ type: 'FINISH' });
    assert.equal(fsm.phase, 'ended');
    const before = fsm.illegalTransitions;
    fsm.send({ type: 'OPEN_LOBBY' });
    assert.equal(fsm.phase, 'ended');
    assert.equal(fsm.illegalTransitions, before + 1);
    assert.equal(canTransition('live', { type: 'FINISH' }), true);
    assert.equal(nextPhase('idle', { type: 'FINISH' }), null);
});

test('match FSM allows guest start from idle (no host lobby)', () => {
    const fsm = createMatchFsm();
    fsm.send({ type: 'START' });
    assert.equal(fsm.phase, 'starting');
    fsm.send({ type: 'START' });
    assert.equal(fsm.phase, 'live');
    assert.equal(fsm.illegalTransitions, 0);
});

test('replay log round-trips and verifies end hash', () => {
    const state = stubState();
    const log = createReplayLog({ matchId: 'm1', playerCount: '4P' });
    appendReplayEvent(log, { seq: 1, kind: 'action', actionId: 'a1', payload: { type: 'ROLL_DICE' } }, state);
    finalizeReplay(log, state);
    const text = serializeReplay(log);
    const parsed = parseReplay(text);
    assert.equal(parsed.events.length, log.events.length);
    const check = verifyReplayEnd(parsed, state);
    assert.equal(check.ok, true);
    assert.equal(hashGameState(state), log.finalHash);
});

test('protocol parse-or-drop on join and actions', () => {
    assert.equal(parseJoinRequest({
        type: 'JOIN_REQUEST',
        intentId: 'j1',
        payload: { name: 'Ada', walletAddress: '0xabc' },
    }).ok, true);
    assert.equal(parseJoinRequest({ type: 'JOIN_REQUEST', intentId: '', payload: {} }).ok, false);
    assert.equal(parseGameIntent({
        type: 'REQUEST_ROLL',
        payload: { value: 7 },
        intentId: 'x',
    }).ok, false);
    assert.equal(parseGameActionEnvelope({ type: 'SYNC_STATE', actionId: 'a' }).ok, true);
});
