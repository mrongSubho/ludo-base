/**
 * Wave 1 — Typed RoomError, Friendly Copy, Protocol v1, Size Cap, Rate Limiter, & roomInstance Gate
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from '../lib/sessionV2';
import { RoomError, isRoomError, ROOM_ERROR_CODES, DisconnectReason } from '../lib/roomCodes';
import { friendlyError } from '../lib/errorCopy';
import { ROOM_PROTOCOL_VERSION, MAX_ROOM_FRAME_BYTES } from '../lib/roomProtocol';
import { MatchRoomCore } from '../src/room/MatchRoomCore';

class MockWebSocket {
  public messages: string[] = [];
  public closed = false;
  public readyState = 1;
  private attachment: unknown = null;

  serializeAttachment(value: unknown) {
    this.attachment = JSON.parse(JSON.stringify(value));
  }

  deserializeAttachment(): unknown {
    return this.attachment ? JSON.parse(JSON.stringify(this.attachment)) : null;
  }

  send(data: string) {
    this.messages.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  parsedMessages(): Array<Record<string, unknown>> {
    return this.messages.map((m) => JSON.parse(m) as Record<string, unknown>);
  }

  lastMessage(): Record<string, unknown> | null {
    if (this.messages.length === 0) return null;
    return JSON.parse(this.messages[this.messages.length - 1]) as Record<string, unknown>;
  }
}

describe('Wave 1 — RoomError, Protocol v1, Rate Limit & roomInstance', () => {
  it('W1-1: RoomError preserves code, reason, seq, intentId, roomInstance and type guard works', () => {
    const err = new RoomError('POWER_ARMED', 'Tap one of your tokens to target', {
      seq: 7,
      intentId: 'intent-abc',
      roomInstance: 'do1234567890:deadbeef',
    });

    assert.equal(err instanceof Error, true);
    assert.equal(err instanceof RoomError, true);
    assert.equal(isRoomError(err), true);
    assert.equal(isRoomError(new Error('plain error')), false);
    assert.equal(err.name, 'RoomError');
    assert.equal(err.code, 'POWER_ARMED');
    assert.equal(err.reason, 'Tap one of your tokens to target');
    assert.equal(err.message, '[POWER_ARMED] Tap one of your tokens to target');
    assert.equal(err.seq, 7);
    assert.equal(err.intentId, 'intent-abc');
    assert.equal(err.roomInstance, 'do1234567890:deadbeef');
    assert.equal(DisconnectReason.AUTH_EXPIRED, 'AUTH_EXPIRED');
    assert.equal(DisconnectReason.PROTOCOL_MISMATCH, 'PROTOCOL_MISMATCH');
  });

  it('W1-2: friendlyError provides non-UNKNOWN player copy for every RoomErrorCode', () => {
    for (const code of ROOM_ERROR_CODES) {
      const copy = friendlyError(code);
      assert.equal(copy.code, code, `friendlyError(${code}) must preserve code`);
      assert.notEqual(copy.code, 'UNKNOWN', `${code} must not fall back to UNKNOWN`);
      assert.ok(copy.title.length > 0);
      assert.ok(copy.copy.length > 0);
    }
  });

  it('W1-3: MatchRoomCore enforces protocol v1, 32KB cap, roomInstance, sliding-window rate limit, sync_needed, timer schema, and deduped cookie join', async () => {
    const matchId = '12345678-1234-1234-1234-1234567890ab';
    const walletG = '0x1111111111111111111111111111111111111111';
    const walletY = '0x2222222222222222222222222222222222222222';
    const tokenG = 'sess-wave1-green';
    const expiredToken = 'sess-wave1-expired';
    const missingTicket = 'ticket-wave1-missing';
    const hashG = await hashToken(tokenG);
    const hashExpired = await hashToken(expiredToken);

    const mockSessions = new Map<string, Record<string, unknown>>([
      [hashG, { wallet_address: walletG, scope: 'match', match_id: matchId, seat_color: 'green', expires_at: new Date(Date.now() + 60_000).toISOString() }],
      [hashExpired, { wallet_address: walletY, scope: 'match', match_id: matchId, seat_color: 'yellow', expires_at: new Date(Date.now() - 5_000).toISOString() }],
    ]);

    const commitPayloads: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/rest/v1/match_states')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/rest/v1/matches')) {
        return new Response(JSON.stringify([{ match_shape: '1v1', game_mode: 'classic' }]), { status: 200 });
      }
      if (url.includes('/rest/v1/match_seats')) {
        return new Response(
          JSON.stringify([
            { color: 'green', wallet_address: walletG, seat_index: 0 },
            { color: 'yellow', wallet_address: walletY, seat_index: 1 },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/rest/v1/sessions')) {
        const hashMatch = url.match(/token_hash=eq\.([a-f0-9]+)/);
        const row = hashMatch?.[1] ? mockSessions.get(hashMatch[1]) : undefined;
        return new Response(JSON.stringify(row ? [row] : []), { status: 200 });
      }
      if (url.includes('/rest/v1/rpc/match_commit_action')) {
        const body = JSON.parse(String(init?.body || '{}')) as {
          p_event_type?: string;
          p_event_payload?: Record<string, unknown>;
        };
        commitPayloads.push({
          eventType: body.p_event_type || '',
          payload: body.p_event_payload || {},
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    try {
      const storageMap = new Map<string, unknown>();
      const sockets: MockWebSocket[] = [];
      const mockCtx = {
        id: { toString: () => 'do1234567890abcdef' },
        storage: {
          get: async (k: string) => storageMap.get(k),
          put: async (k: string, v: unknown) => { storageMap.set(k, v); },
          setAlarm: async () => {},
        },
        getWebSockets: () => sockets as unknown as WebSocket[],
        acceptWebSocket: (ws: unknown) => { sockets.push(ws as MockWebSocket); },
      };
      const mockEnv = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      };

      const room = new MatchRoomCore(mockCtx as never, mockEnv);
      const expectedInstance = room.getRoomInstance();
      assert.match(expectedInstance, /^do1234567890:[a-f0-9]{8}$/);

      // 1. /info and 426 carry X-Room-Instance + protocolVersion
      const infoRes = await room.fetch(new Request(`https://ludobase.com/api/room/${matchId}/info`));
      const infoBody = (await infoRes.json()) as { roomInstance: string; protocolVersion: number };
      assert.equal(infoBody.protocolVersion, ROOM_PROTOCOL_VERSION);
      assert.equal(infoBody.roomInstance, expectedInstance);
      assert.equal(infoRes.headers.get('X-Room-Instance'), expectedInstance);
      assert.equal(commitPayloads[0]?.payload?.roomInstance, expectedInstance, 'server_seeded commit must include roomInstance');

      const nonWsRes = await room.fetch(new Request(`https://ludobase.com/api/room/${matchId}/ws`));
      assert.equal(nonWsRes.status, 426);
      assert.equal(nonWsRes.headers.get('X-Room-Instance'), expectedInstance);

      // 2. Cookie-authenticated upgrade sends NO duplicate state before join
      const cookieSock = new MockWebSocket();
      (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
        0 = new MockWebSocket();
        1 = cookieSock;
      };
      const wsCookieRes = await room.fetch(
        new Request(`https://ludobase.com/api/room/${matchId}/ws`, {
          headers: { Upgrade: 'websocket', Cookie: `__Host-ludo_session=${tokenG}` },
        })
      );
      assert.equal(wsCookieRes.headers.get('X-Room-Instance'), expectedInstance);
      assert.equal(cookieSock.messages.length, 0, 'cookie upgrade must wait for join frame instead of duplicate state send');

      await room.webSocketMessage(
        cookieSock as unknown as WebSocket,
        JSON.stringify({ v: ROOM_PROTOCOL_VERSION, t: 'join', as: 'seat', lastSeq: 0 })
      );
      const joinMsgs = cookieSock.parsedMessages();
      assert.equal(joinMsgs.length, 2, 'join after cookie upgrade sends joined + state once');
      assert.equal(joinMsgs[0].v, 1);
      assert.equal(joinMsgs[0].roomInstance, expectedInstance);
      assert.equal(joinMsgs[0].t, 'joined');
      assert.equal(joinMsgs[1].t, 'state');

      // 3. Oversized frame (> 32 KB) rejected before JSON parse
      cookieSock.messages = [];
      const hugePayload = `{"t":"ping","pad":"${'a'.repeat(MAX_ROOM_FRAME_BYTES + 256)}"}`;
      await room.webSocketMessage(cookieSock as unknown as WebSocket, hugePayload);
      assert.equal(cookieSock.lastMessage()?.code, 'FRAME_TOO_LARGE');
      assert.equal(cookieSock.lastMessage()?.roomInstance, expectedInstance);

      // 4. Protocol version mismatch rejected, omitted & v:1 accepted
      cookieSock.messages = [];
      await room.webSocketMessage(
        cookieSock as unknown as WebSocket,
        JSON.stringify({ v: 2, t: 'ping', intentId: 'bad-proto-1' })
      );
      assert.equal(cookieSock.lastMessage()?.code, 'PROTOCOL_MISMATCH');
      assert.equal(cookieSock.lastMessage()?.intentId, 'bad-proto-1');

      await room.webSocketMessage(cookieSock as unknown as WebSocket, JSON.stringify({ t: 'ping' }));
      assert.equal(cookieSock.lastMessage()?.t, 'pong');
      assert.equal(cookieSock.lastMessage()?.v, 1);

      // 5. Expired token vs missing ticket rejection codes
      const authSock = new MockWebSocket();
      (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
        0 = new MockWebSocket();
        1 = authSock;
      };
      await room.fetch(new Request(`https://ludobase.com/api/room/${matchId}/ws`, { headers: { Upgrade: 'websocket' } }));
      await room.webSocketMessage(
        authSock as unknown as WebSocket,
        JSON.stringify({ v: 1, t: 'join', as: 'seat', token: expiredToken })
      );
      assert.equal(authSock.lastMessage()?.code, 'SESSION_EXPIRED');

      await room.webSocketMessage(
        authSock as unknown as WebSocket,
        JSON.stringify({ v: 1, t: 'join', as: 'seat', ticket: missingTicket })
      );
      assert.equal(authSock.lastMessage()?.code, 'TICKET_INVALID');

      // 6. Intent advances seq to 1 -> state carries lastIntentId & intent_ack carries data.roomInstance
      cookieSock.messages = [];
      commitPayloads.length = 0;
      await room.webSocketMessage(
        cookieSock as unknown as WebSocket,
        JSON.stringify({ v: 1, t: 'intent', kind: 'REQUEST_ROLL', intentId: 'intent-roll-w1', seq: 0 })
      );
      const rollMsgs = cookieSock.parsedMessages();
      const stateAfterRoll = rollMsgs.find((m) => m.t === 'state');
      const ackAfterRoll = rollMsgs.find((m) => m.t === 'intent_ack');
      assert.equal(stateAfterRoll?.lastIntentId, 'intent-roll-w1');
      assert.equal(stateAfterRoll?.roomInstance, expectedInstance);
      assert.equal((ackAfterRoll?.data as { roomInstance?: string })?.roomInstance, expectedInstance);
      assert.equal(commitPayloads[0]?.payload?.roomInstance, expectedInstance);

      // 7. Stale client frame.seq < this.seq emits sync_needed
      cookieSock.messages = [];
      await room.webSocketMessage(
        cookieSock as unknown as WebSocket,
        JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_REQUEST_TRUST', intentId: 'intent-trust-1', seq: 0 })
      );
      const staleMsgs = cookieSock.parsedMessages();
      assert.equal(staleMsgs[0]?.t, 'sync_needed');
      assert.equal(staleMsgs[0]?.serverSeq, 1);
      assert.equal(staleMsgs[0]?.clientSeq, 0);

      // 8. Sliding-window rate limit (already 2 intents sent in < 2s; send 6 more -> ok, 9th -> RATE_LIMITED)
      for (let i = 0; i < 6; i++) {
        cookieSock.messages = [];
        await room.webSocketMessage(
          cookieSock as unknown as WebSocket,
          JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_REQUEST_TRUST', intentId: `trust-ok-${i}`, seq: 1 })
        );
        assert.equal(cookieSock.lastMessage()?.t, 'intent_ack');
      }
      cookieSock.messages = [];
      await room.webSocketMessage(
        cookieSock as unknown as WebSocket,
        JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_REQUEST_TRUST', intentId: 'trust-rate-limited', seq: 1 })
      );
      assert.equal(cookieSock.lastMessage()?.t, 'rejected');
      assert.equal(cookieSock.lastMessage()?.code, 'RATE_LIMITED');

      // 9. Alarm emits normalized timer frame with timerId, kind, deadlineAt, remainingMs
      const timers = (storageMap.get('timerHeap') as Array<{ id: string; kind: string; deadlineAt: number }>) || [];
      assert.ok(timers.length > 0);
      timers[0].deadlineAt = Date.now() - 25;
      storageMap.set('timerHeap', timers);
      (room as unknown as { timerHeap: typeof timers }).timerHeap = timers;
      cookieSock.messages = [];
      await room.alarm();
      const timerFrame = cookieSock.parsedMessages().find((m) => m.t === 'timer');
      assert.ok(timerFrame, 'alarm must emit timer frame');
      assert.equal(timerFrame.v, 1);
      assert.equal(timerFrame.roomInstance, expectedInstance);
      assert.equal(typeof timerFrame.timerId, 'string');
      assert.equal(typeof timerFrame.kind, 'string');
      assert.equal(typeof timerFrame.deadlineAt, 'number');
      assert.equal(typeof timerFrame.remainingMs, 'number');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
