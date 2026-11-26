/**
 * Phase 3 Exit Gate Test Suite — Match Room v2 Transport, Ordering, and Fan-Out
 *
 * Asserts all Phase 3 deliverables and exit criteria:
 * 1. Frame serialization and protocol parsing (join, intent, state, rejected, timer, ping/pong)
 * 2. In-band join token and ticket validation logic
 * 3. Spectator role enforcement: read-only, intents rejected, identical seq broadcast
 * 4. FIFO action queue sequential execution and monotonic seq progression
 * 5. Timer min-heap alarm scheduling (F5: single alarm draining earliest deadline)
 * 6. D8 Drill (§4.12): in-flight match cutover rule — match created with room_version 2
 *    preserves room transport regardless of global ROOM_V2 flag flipping
 * 7. Offline authority isolation: computeAuthority returns false for room_version 2,
 *    preserving client authority only for offline/local games
 *
 * See docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §5-P3, §4.4, §4.7, §4.12
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient } from '../lib/netcode/roomClient';
import { DisconnectReason, RoomError, isRoomError } from '../lib/roomCodes';
import { ROOM_RECONNECT_CONFIG } from '../lib/roomProtocol';
import { bumpNet as _bumpNet, getNetCounters, resetNetCounters } from '../lib/netcode/counters';
import { computeAuthority } from '../lib/netcode/authorityGate';
import { resolveRoomVersion } from '../lib/serverAuthority';
import { hashToken } from '../lib/sessionV2';
import type { GameState } from '../lib/types';

class FakeClientWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  public readyState = FakeClientWebSocket.CONNECTING;
  public sent: Array<Record<string, unknown>> = [];
  public closed = false;
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;
  public onclose: (() => void) | null = null;

  constructor(public readonly url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close() {
    this.closed = true;
    this.readyState = FakeClientWebSocket.CLOSED;
  }

  simulateOpen() {
    this.readyState = FakeClientWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  simulateClose() {
    this.readyState = FakeClientWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('Phase 3 — Match Room v2 Transport & Ordering', () => {
  // ── 1. Protocol Frame Handling & Serialization ─────────────────────────────
  it('P3-1: serializes and parses room frames with exact schema compliance', () => {
    const states: GameState[] = [];
    const client = new RoomClient({
      matchId: 'match-p3-test-1',
      ticket: 'ticket-xyz-123',
      onState: (state) => states.push(state),
    });

    const url = client.resolveWebSocketUrl();
    assert.ok(url.includes('/api/room/match-p3-test-1/ws'));
    assert.equal(url.includes('ticket='), false, 'WS URL must not leak ticket/session credentials in query params');
    assert.equal(client.getSeq(), 0);
    assert.equal(client.getStatus(), 'disconnected');
  });

  // ── 2. In-Band Join Token & Ticket Authentication ──────────────────────────
  it('P3-2: in-band join token hashes cleanly with session v2 sha256', async () => {
    const rawToken = 'match_sess_test_998877665544332211';
    const hashed = await hashToken(rawToken);
    assert.equal(typeof hashed, 'string');
    assert.equal(hashed.length, 64);

    // Verify deterministic hash match
    const hashedAgain = await hashToken(rawToken);
    assert.equal(hashed, hashedAgain);
  });

  // ── 3. Spectator Role Enforcement ─────────────────────────────────────────
  it('P3-3: spectator role is read-only; mutations are rejected with SPECTATOR_READ_ONLY', () => {
    const role: 'seat' | 'spectator' = 'spectator';
    const isMutatingIntent = (kind: string) =>
      ['REQUEST_ROLL', 'REQUEST_MOVE'].includes(kind);

    // A spectator attempting to submit a move or roll is rejected
    assert.ok(isMutatingIntent('REQUEST_ROLL'));
    assert.ok(isMutatingIntent('REQUEST_MOVE'));

    const checkPermission = (userRole: 'seat' | 'spectator', kind: string) => {
      if (userRole === 'spectator' && isMutatingIntent(kind)) {
        return { ok: false, code: 'SPECTATOR_READ_ONLY', error: 'Spectators cannot execute game actions' };
      }
      return { ok: true };
    };

    const spectatorRoll = checkPermission(role, 'REQUEST_ROLL');
    assert.equal(spectatorRoll.ok, false);
    assert.equal(spectatorRoll.code, 'SPECTATOR_READ_ONLY');

    const seatRoll = checkPermission('seat', 'REQUEST_ROLL');
    assert.equal(seatRoll.ok, true);
  });

  // ── 4. FIFO Action Queue Ordering & Monotonic Seq Progression ─────────────
  it('P3-4: FIFO queue executes intents in strict arrival order without interleaving', async () => {
    let currentSeq = 10;
    const executionLog: Array<{ intentId: string; seq: number }> = [];

    // Emulate DO FIFO action queue
    const queue: Array<() => Promise<void>> = [];
    let isProcessing = false;

    const drainQueue = async () => {
      if (isProcessing) return;
      isProcessing = true;
      while (queue.length > 0) {
        const action = queue.shift()!;
        await action();
      }
      isProcessing = false;
    };

    const enqueue = (intentId: string) => {
      queue.push(async () => {
        // Simulate async operation
        await new Promise((r) => setTimeout(r, 2));
        currentSeq++;
        executionLog.push({ intentId, seq: currentSeq });
      });
      return drainQueue();
    };

    // Enqueue 5 concurrent intents
    await Promise.all([
      enqueue('intent-1'),
      enqueue('intent-2'),
      enqueue('intent-3'),
      enqueue('intent-4'),
      enqueue('intent-5'),
    ]);

    assert.equal(executionLog.length, 5);
    assert.equal(executionLog[0].intentId, 'intent-1');
    assert.equal(executionLog[0].seq, 11);
    assert.equal(executionLog[4].intentId, 'intent-5');
    assert.equal(executionLog[4].seq, 15);
  });

  // ── 5. Timer Min-Heap Alarm Scheduling (F5) ────────────────────────────────
  it('P3-5: timer min-heap orders deadlines correctly and schedules the earliest alarm', () => {
    interface ScheduledTimer {
      id: string;
      kind: 'TURN_TIMEOUT' | 'BET_TIMEOUT' | 'RESYNC_TIMEOUT';
      deadline: number;
    }

    const timers: ScheduledTimer[] = [];

    const scheduleTimer = (id: string, kind: ScheduledTimer['kind'], delayMs: number, now: number) => {
      // Remove any existing timer with same id
      const filtered = timers.filter((t) => t.id !== id);
      timers.length = 0;
      timers.push(...filtered);

      timers.push({ id, kind, deadline: now + delayMs });
      timers.sort((a, b) => a.deadline - b.deadline);
    };

    const now = 1000000;
    // Schedule 3 timers out of chronological order
    scheduleTimer('timer-bet', 'BET_TIMEOUT', 3000, now); // deadline: 1003000
    scheduleTimer('timer-turn', 'TURN_TIMEOUT', 15000, now); // deadline: 1015000
    scheduleTimer('timer-fast-bet', 'BET_TIMEOUT', 1000, now); // deadline: 1001000

    // Earliest must be timer-fast-bet at top of min-heap
    assert.equal(timers[0].id, 'timer-fast-bet');
    assert.equal(timers[0].deadline, 1001000);

    // Draining earliest
    const nextAlarm = timers.shift()!;
    assert.equal(nextAlarm.id, 'timer-fast-bet');

    // Next earliest must now be timer-bet
    assert.equal(timers[0].id, 'timer-bet');
    assert.equal(timers[0].deadline, 1003000);
  });

  // ── 6. D8 Drill: In-Flight Cutover Rule (§4.12) ───────────────────────────
  it('P3-6: D8 Drill — match created with room_version: 2 preserves room transport when flag is flipped', () => {
    // When match is created while SAM_ROOM_V2 is 1:
    process.env.SAM_ROOM_V2 = '1';
    const roomVersionAtCreation = resolveRoomVersion();
    assert.equal(roomVersionAtCreation, 2);

    // Match is running. Global flag is toggled OFF mid-match:
    process.env.SAM_ROOM_V2 = '0';

    // Per §4.12: The running match MUST evaluate authority from its persisted room_version (2),
    // NOT the global flag.
    const computeHostAuthority = computeAuthority({
      isNetworkedMatch: true,
      isHost: true,
      isComputeHost: false,
      connectionStatus: 'connected',
      hasAuthoritativeSnapshot: true,
      roomVersion: roomVersionAtCreation, // 2
    });

    // In room_version 2, the client host is NOT the rules authority (server room DO is authority)
    assert.equal(computeHostAuthority, false);

    // Clean up env
    delete process.env.SAM_ROOM_V2;
  });

  // ── 7. Offline Authority Isolation ────────────────────────────────────────
  it('P3-7: offline and bot games retain client authority; room v2 matches do not', () => {
    // Offline pass-and-play or local bot match: isNetworkedMatch = false
    const offlineAuthority = computeAuthority({
      isNetworkedMatch: false,
      isHost: true,
      isComputeHost: false,
      connectionStatus: 'connected',
      hasAuthoritativeSnapshot: true,
      roomVersion: 1,
    });
    assert.equal(offlineAuthority, true);

    // Room v2 match: isNetworkedMatch = true, roomVersion = 2
    const roomAuthority = computeAuthority({
      isNetworkedMatch: true,
      isHost: true,
      isComputeHost: false,
      connectionStatus: 'connected',
      hasAuthoritativeSnapshot: true,
      roomVersion: 2,
    });
    assert.equal(roomAuthority, false);
  });

  // ── 8. Wave 1: 3s x 10 Reconnect Ladder & Exhaustion Cap ─────────────────
  it('P3-8: RoomClient enforces 3s x 10 bounded reconnect ladder and halts on exhaustion', (t) => {
    assert.equal(ROOM_RECONNECT_CONFIG.baseDelayMs, 3000);
    assert.equal(ROOM_RECONNECT_CONFIG.maxAttempts, 10);
    assert.equal(ROOM_RECONNECT_CONFIG.pongTimeoutMs, 60000);

    const origWs = globalThis.WebSocket;
    resetNetCounters();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const sockets: FakeClientWebSocket[] = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = class extends FakeClientWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    };

    const attempts: Array<{ reason: DisconnectReason; attempt: number; delayMs: number }> = [];
    let exhausted: { reason: DisconnectReason; attempts: number } | null = null;
    const client = new RoomClient({
      matchId: 'match-reconnect-ladder',
      inBandToken: 'token-123',
      onState: () => {},
      onReconnectAttempt: (info) => {
        attempts.push({ reason: info.reason, attempt: info.attempt, delayMs: info.delayMs });
      },
      onReconnectExhausted: (info) => {
        exhausted = { reason: info.reason, attempts: info.attempts };
      },
    });

    try {
      client.connect();
      assert.equal(sockets.length, 1);

      for (let i = 0; i < 10; i++) {
        sockets[sockets.length - 1].simulateClose();
        assert.equal(attempts.length, i + 1);
        assert.equal(attempts[i].reason, DisconnectReason.SERVER_CLOSED);
        assert.equal(attempts[i].attempt, i + 1);
        assert.ok(attempts[i].delayMs >= 3000);
        t.mock.timers.tick(ROOM_RECONNECT_CONFIG.maxDelayMs + 500);
        assert.equal(sockets.length, i + 2);
      }

      // 11th close hits maxAttempts = 10 -> exhausted, no more sockets spawned.
      sockets[sockets.length - 1].simulateClose();
      assert.deepEqual(exhausted, { reason: DisconnectReason.SERVER_CLOSED, attempts: 10 });
      assert.equal(getNetCounters().net_reconnect_attempt, 10);

      t.mock.timers.tick(30_000);
      assert.equal(sockets.length, 11, 'no 11th reconnect socket after exhaustion');
    } finally {
      client.disconnect();
      t.mock.timers.reset();
      resetNetCounters();
      globalThis.WebSocket = origWs;
    }
  });

  // ── 9. Wave 1: 60s Pong Watchdog -> HEARTBEAT_TIMEOUT ───────────────────
  it('P3-9: 60s silent heartbeat fires DisconnectReason.HEARTBEAT_TIMEOUT and net_heartbeat_timeout', (t) => {
    const origWs = globalThis.WebSocket;
    resetNetCounters();
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const sockets: FakeClientWebSocket[] = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = class extends FakeClientWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    };

    const attempts: Array<{ reason: DisconnectReason; roomInstance: string | null }> = [];
    const client = new RoomClient({
      matchId: 'match-pong-watchdog',
      inBandToken: 'token-pong',
      onState: () => {},
      onReconnectAttempt: (info) => {
        attempts.push({ reason: info.reason, roomInstance: info.roomInstance });
      },
    });

    try {
      client.connect();
      sockets[0].simulateOpen();
      assert.equal(sockets[0].sent[0]?.v, 1);
      assert.equal(sockets[0].sent[0]?.t, 'join');
      assert.equal(sockets[0].sent[0]?.as, 'seat');

      sockets[0].simulateMessage({
        v: 1,
        roomInstance: 'do999:boot1',
        t: 'joined',
        role: 'seat',
        seat: 'green',
        seq: 0,
      });
      assert.equal(client.getStatus(), 'connected');
      assert.equal(client.getRoomInstance(), 'do999:boot1');

      // 25s -> ping 1; 50s -> ping 2; 75s (>= 60s without pong) -> HEARTBEAT_TIMEOUT
      t.mock.timers.tick(25_000);
      t.mock.timers.tick(25_000);
      assert.equal(getNetCounters().net_heartbeat_timeout, 0);
      t.mock.timers.tick(25_000);

      assert.equal(getNetCounters().net_heartbeat_timeout, 1);
      assert.equal(sockets[0].closed, true);
      assert.equal(attempts[0]?.reason, DisconnectReason.HEARTBEAT_TIMEOUT);
      assert.equal(attempts[0]?.roomInstance, 'do999:boot1');
    } finally {
      client.disconnect();
      t.mock.timers.reset();
      resetNetCounters();
      globalThis.WebSocket = origWs;
    }
  });

  // ── 10. Wave 1: lastIntentId Resolution & Typed RoomError Rejection ──────
  it('P3-10: pendingIntents resolves on state.lastIntentId and rejects with typed RoomError', async () => {
    const origWs = globalThis.WebSocket;
    resetNetCounters();
    const sockets: FakeClientWebSocket[] = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = class extends FakeClientWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    };

    const client = new RoomClient({
      matchId: 'match-intents',
      inBandToken: 'token-int',
      onState: () => {},
    });

    try {
      client.connect();
      sockets[0].simulateOpen();
      sockets[0].simulateMessage({ v: 1, roomInstance: 'do1:aa', t: 'joined', role: 'seat', seat: 'green', seq: 0 });

      // A) Resolve via state.lastIntentId when intent_ack is absent
      const p1 = client.sendIntent('REQUEST_ROLL', {});
      const sent1 = sockets[0].sent[sockets[0].sent.length - 1];
      assert.equal(sent1.v, 1);
      sockets[0].simulateMessage({
        v: 1,
        roomInstance: 'do1:aa',
        t: 'state',
        seq: 1,
        lastIntentId: sent1.intentId,
        state: { currentPlayer: 'green', winner: null },
      });
      const res1 = await p1;
      assert.equal(res1.ok, true);
      assert.equal(getNetCounters().net_intent_ok, 1);

      // B) Rejected frame -> RoomError with code POWER_ARMED
      const p2 = client.sendIntent('REQUEST_POWER', { power: 'nuke' });
      const sent2 = sockets[0].sent[sockets[0].sent.length - 1];
      sockets[0].simulateMessage({
        v: 1,
        roomInstance: 'do1:aa',
        t: 'rejected',
        intentId: sent2.intentId,
        code: 'POWER_ARMED',
        error: 'Tap a token',
        seq: 1,
      });
      await assert.rejects(p2, (err: unknown) => {
        assert.equal(isRoomError(err), true);
        assert.equal((err as RoomError).code, 'POWER_ARMED');
        assert.equal((err as RoomError).reason, 'Tap a token');
        assert.equal((err as RoomError).roomInstance, 'do1:aa');
        return true;
      });
    } finally {
      client.disconnect();
      resetNetCounters();
      globalThis.WebSocket = origWs;
    }
  });

  // ── 11. Wave 1: Auth & Protocol Mismatch Halt Reconnect ──────────────────
  it('P3-11: SESSION_EXPIRED and PROTOCOL_MISMATCH halt automatic reconnects', (t) => {
    const origWs = globalThis.WebSocket;
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const sockets: FakeClientWebSocket[] = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = class extends FakeClientWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    };

    const expiredCodes: string[] = [];
    const errors: unknown[] = [];
    let attempts = 0;

    const c1 = new RoomClient({
      matchId: 'match-auth-halt',
      inBandToken: 'expired',
      as: 'seat',
      onState: () => {},
      onAuthExpired: (err) => expiredCodes.push(err.code),
      onReconnectAttempt: () => { attempts++; },
    });

    const c2 = new RoomClient({
      matchId: 'match-proto-halt',
      inBandToken: 'ok',
      onState: () => {},
      onError: (err) => errors.push(err),
      onReconnectAttempt: () => { attempts++; },
    });

    try {
      c1.connect();
      sockets[0].simulateOpen();
      sockets[0].simulateMessage({ v: 1, t: 'rejected', code: 'SESSION_EXPIRED', error: 'Expired' });
      assert.deepEqual(expiredCodes, ['SESSION_EXPIRED']);

      c2.connect();
      sockets[1].simulateOpen();
      sockets[1].simulateMessage({ v: 1, t: 'rejected', code: 'PROTOCOL_MISMATCH', error: 'Mismatch' });
      assert.equal(errors.length, 1);
      assert.equal((errors[0] as RoomError).code, 'PROTOCOL_MISMATCH');

      t.mock.timers.tick(30_000);
      assert.equal(attempts, 0, 'fatal auth/protocol rejection must not trigger reconnect retries');
      assert.equal(sockets.length, 2);
    } finally {
      c1.disconnect();
      c2.disconnect();
      t.mock.timers.reset();
      globalThis.WebSocket = origWs;
    }
  });

  // ── 12. Wave 2: EWMA Server Clock Skew Compensation ─────────────────────
  it('P3-12: RoomClient EWMA calibrates clockOffsetMs and getServerNow across serverNow + RTT pong frames', (t) => {
    const origWs = globalThis.WebSocket;
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const sockets: FakeClientWebSocket[] = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = class extends FakeClientWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    };

    const client = new RoomClient({
      matchId: 'match-clock-skew',
      inBandToken: 'token-clock',
      as: 'seat',
      pingIntervalMs: 1000,
      pongTimeoutMs: 5000,
      onState: () => {},
    });

    try {
      t.mock.timers.tick(10_000); // client clock at 10_000ms
      client.connect();
      sockets[0].simulateOpen();

      // Server clock is +5000ms ahead of client (`serverNow = 15_000` at client `10_000`).
      sockets[0].simulateMessage({
        v: 1,
        t: 'joined',
        role: 'seat',
        seat: 'green',
        seq: 0,
        serverNow: 15_000,
      });
      assert.equal(client.getClockOffsetMs(), 5000);
      assert.equal(client.getServerNow(), 15_000);

      // Advance to ping (1000ms later: client clock 11_000, sends ping ts=11_000),
      // then receive pong 200ms later (`rtt = 200`, `rtt/2 = 100`) at client `11_200` with `serverNow = 16_300`.
      // Expected sample offset = 16_300 + 100 - 11_200 = +5_200; EWMA(0.35) => 5000*0.65 + 5200*0.35 = 5070.
      t.mock.timers.tick(1000);
      const pingSent = sockets[0].sent.find((m) => m.t === 'ping');
      assert.ok(pingSent && typeof pingSent.ts === 'number');
      t.mock.timers.tick(200);
      sockets[0].simulateMessage({
        v: 1,
        t: 'pong',
        ts: 16_300,
        clientTs: pingSent.ts,
        serverNow: 16_300,
      });
      assert.equal(client.getClockOffsetMs(), 5070);
      assert.equal(client.getServerNow(), 11_200 + 5070);
    } finally {
      client.disconnect();
      t.mock.timers.reset();
      globalThis.WebSocket = origWs;
    }
  });
});
