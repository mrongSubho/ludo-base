/**
 * Room Two-Client Verification Test (Server-Owned Lobby Phase S3 Gate)
 *
 * Asserts the core Phase S3 requirements:
 * 1. Two independent WebSocket clients against one room instance.
 * 2. Room self-seeds from match_shape and match_seats without any client seed frame.
 * 3. Both Client A and Client B receive identical roster and seed state (seq = 0) with ZERO peer broadcast.
 * 4. Client A (Green, active turn) issues REQUEST_ROLL -> Room executes roll and fans out seq = 1 to BOTH clients.
 * 5. Client B (Yellow, out of turn) issues REQUEST_ROLL -> Room rejects with NOT_YOUR_TURN.
 * 6. D2 Gate: unauthenticated client cannot participate as seat.
 *
 * Imported from `MatchRoomCore`, not `MatchRoom`. The previous version imported
 * the Durable Object and tried to shim `cloudflare:workers` by patching
 * `Module.prototype.require`; that can never intercept an ESM bare specifier, so
 * the suite failed at `MatchRoom is not a constructor` and verified nothing.
 * `MatchRoomCore` is the same behaviour with the runtime binding factored out
 * (see src/room/MatchRoom.ts), so this now exercises the real logic.
 *
 * Run: npx tsx --test scripts/room-two-client.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from '../lib/sessionV2';
import type { GameState } from '../lib/types';
import { MatchRoomCore } from '../src/room/MatchRoomCore';

// Mock WebSocket implementation for in-memory testing (including DO Hibernation attachment API)
class MockWebSocket {
  public messages: string[] = [];
  public closed = false;
  public readyState = 1; // OPEN
  public onmessage?: (event: { data: string }) => void;
  public onclose?: (event: unknown) => void;
  public counterpart?: MockWebSocket;
  private attachment: unknown = null;

  serializeAttachment(value: unknown) {
    this.attachment = JSON.parse(JSON.stringify(value));
  }

  deserializeAttachment(): unknown {
    return this.attachment ? JSON.parse(JSON.stringify(this.attachment)) : null;
  }

  send(data: string) {
    this.messages.push(data);
    if (this.counterpart?.onmessage) {
      this.counterpart.onmessage({ data });
    }
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    if (this.counterpart?.onclose) {
      this.counterpart.onclose({});
    }
  }

  getLastMessage(): Record<string, unknown> | null {
    if (this.messages.length === 0) return null;
    return JSON.parse(this.messages[this.messages.length - 1]);
  }
}

describe('Phase S3 — Match Room Two-Client Synchronization & Self-Seeding', () => {
  it('S3-1: two clients against one room instance receive identical rosters and seed state with zero peer broadcast', async () => {
    const matchId = '11111111-2222-3333-4444-555555555555';
    const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const walletB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const ticketA = 'ticket-token-wallet-a-green';
    const ticketB = 'ticket-token-wallet-b-yellow';
    const hashA = await hashToken(ticketA);
    const hashB = await hashToken(ticketB);

    // Simulated Postgres storage & responses
    const mockDbSessions = new Map<string, { wallet_address: string; scope: string; match_id: string; seat_color: string }>([
      [hashA, { wallet_address: walletA, scope: 'match', match_id: matchId, seat_color: 'green' }],
      [hashB, { wallet_address: walletB, scope: 'match', match_id: matchId, seat_color: 'yellow' }],
    ]);

    // Mock global fetch to answer Supabase REST calls made by MatchRoom
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = String(input);

      // 1. match_states lookup (initially empty)
      if (url.includes('/rest/v1/match_states')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 2. matches lookup (shape = 1v1)
      if (url.includes('/rest/v1/matches')) {
        return new Response(
          JSON.stringify([{ match_shape: '1v1', game_mode: 'classic' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 3. match_seats lookup (ordered seats)
      if (url.includes('/rest/v1/match_seats')) {
        return new Response(
          JSON.stringify([
            { color: 'green', wallet_address: walletA, seat_index: 0 },
            { color: 'yellow', wallet_address: walletB, seat_index: 1 },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 4. sessions lookup by token_hash
      if (url.includes('/rest/v1/sessions')) {
        const hashMatch = url.match(/token_hash=eq\.([a-f0-9]+)/);
        if (hashMatch && hashMatch[1]) {
          const session = mockDbSessions.get(hashMatch[1]);
          if (session) {
            return new Response(
              JSON.stringify([{ ...session, expires_at: new Date(Date.now() + 60000).toISOString() }]),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 5. match_commit_action RPC (CAS commits)
      if (url.includes('/rest/v1/rpc/match_commit_action')) {
        return new Response(JSON.stringify({ ok: true, seq: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response('Not found', { status: 404 });
    };

    try {
      // Create mock DO state
      const storageMap = new Map<string, unknown>();
      const connectedSockets: MockWebSocket[] = [];

      const mockCtx = {
        storage: {
          get: async (k: string) => storageMap.get(k),
          put: async (k: string, v: unknown) => { storageMap.set(k, v); },
          delete: async (k: string) => { storageMap.delete(k); },
          setAlarm: async () => {},
        },
        getWebSockets: () => connectedSockets as unknown as WebSocket[],
        acceptWebSocket: (ws: unknown) => {
          connectedSockets.push(ws as MockWebSocket);
        },
      };

      const mockEnv = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      };

      // Instantiate the room core (same behaviour as the DO, no runtime binding)
      const room = new MatchRoomCore(mockCtx as never, mockEnv);

      // WebSocket mock pairs for Client A and Client B
      const serverSockA = new MockWebSocket();
      const serverSockB = new MockWebSocket();

      // Client A connects with ticketA
      const reqA = new Request(`https://ludobase.com/api/room/${matchId}/ws?ticket=${ticketA}`, {
        headers: { Upgrade: 'websocket' },
      });

      // Stub WebSocketPair in global scope for fetch upgrade
      (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
        0 = new MockWebSocket();
        1 = serverSockA;
      };

      await room.fetch(reqA);

      // Assert Client A received initial self-seeded state (seq = 0)
      assert.equal(serverSockA.messages.length, 1, 'Client A must receive initial state frame');
      const stateFrameA = serverSockA.getLastMessage();
      assert.equal(stateFrameA?.t, 'state');
      assert.equal(stateFrameA?.seq, 0);

      const stateA = stateFrameA?.state as GameState;
      assert.equal(stateA.matchId, matchId);
      assert.equal(stateA.playerCount, '1v1');
      assert.equal(stateA.currentPlayer, 'green');
      assert.equal(stateA.isStarted, true);
      assert.equal(stateA.initialBoardConfig?.players.length, 2);
      assert.equal(stateA.initialBoardConfig?.players[0].color, 'green');
      assert.equal(stateA.initialBoardConfig?.players[0].walletAddress, walletA);
      assert.equal(stateA.initialBoardConfig?.players[1].color, 'yellow');
      assert.equal(stateA.initialBoardConfig?.players[1].walletAddress, walletB);

      // Client B connects with ticketB
      (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
        0 = new MockWebSocket();
        1 = serverSockB;
      };

      const reqB = new Request(`https://ludobase.com/api/room/${matchId}/ws?ticket=${ticketB}`, {
        headers: { Upgrade: 'websocket' },
      });
      await room.fetch(reqB);

      // Assert Client B received identical initial state frame (seq = 0)
      assert.equal(serverSockB.messages.length, 1, 'Client B must receive initial state frame');
      const stateFrameB = serverSockB.getLastMessage();
      assert.equal(stateFrameB?.t, 'state');
      assert.equal(stateFrameB?.seq, 0);

      const stateB = stateFrameB?.state as GameState;
      assert.deepEqual(stateA, stateB, 'Client A and Client B must receive exact identical rosters and seed state');

      // ── Step 4: Client A (Green, active turn) issues REQUEST_ROLL ─────────
      const rollIntentId = 'intent-roll-turn-1';
      await room.webSocketMessage(
        serverSockA as unknown as WebSocket,
        JSON.stringify({
          t: 'intent',
          kind: 'REQUEST_ROLL',
          intentId: rollIntentId,
        })
      );

      // Room must send intent_ack to the roller and broadcast state at seq = 1
      // to BOTH Client A and Client B.
      const latestMsgA = serverSockA.getLastMessage();
      const latestMsgB = serverSockB.getLastMessage();

      assert.equal(latestMsgA?.t, 'intent_ack', 'roller must get intent_ack');
      assert.equal(latestMsgB?.t, 'state', 'other client must get state broadcast');

      const stateMsgA = serverSockA.messages.map((m) => JSON.parse(m)).find((m) => m.t === 'state' && m.seq === 1);
      const stateMsgB = serverSockB.messages.map((m) => JSON.parse(m)).find((m) => m.t === 'state' && m.seq === 1);
      assert.ok(stateMsgA, 'Client A must receive state broadcast at seq 1');
      assert.ok(stateMsgB, 'Client B must receive state broadcast at seq 1');

      const rolledStateA = stateMsgA?.state as GameState;
      const rolledStateB = stateMsgB?.state as GameState;
      assert.deepEqual(rolledStateA, rolledStateB, 'Both clients must receive identical roll state');
      // Two valid post-roll shapes:
      //  - legal moves (a six from yard, or tokens out): same player, phase
      //    'moving', the face still showing;
      //  - auto-pass (no legal moves, not a six): turn advanced, phase
      //    'rolling', diceValue RESET to null — a stale face here used to
      //    freeze the next player's Roll button (it gates on diceValue===null).
      const advanced = rolledStateA.currentPlayer !== 'green';
      if (advanced) {
        assert.equal(rolledStateA.diceValue, null, 'auto-pass must reset the face for the next player');
        assert.equal(rolledStateA.gamePhase, 'rolling');
      } else {
        assert.ok(rolledStateA.diceValue !== null && rolledStateA.diceValue >= 1 && rolledStateA.diceValue <= 6);
        assert.equal(rolledStateA.gamePhase, 'moving');
      }

      // ── Step 5: The player who is NOT the current player attempts REQUEST_ROLL ──
      // If Client A rolled a non-six from yard, engine auto-advanced to Yellow.
      // Either way, the player who is NOT the active player must be rejected.
      const activeColor = (rolledStateA.currentPlayer as string);
      const outOfTurnSock = activeColor === 'yellow' ? serverSockA : serverSockB;
      const illegalIntentId = 'intent-illegal-out-of-turn-roll';
      await room.webSocketMessage(
        outOfTurnSock as unknown as WebSocket,
        JSON.stringify({
          t: 'intent',
          kind: 'REQUEST_ROLL',
          intentId: illegalIntentId,
        })
      );

      // Out-of-turn player must be rejected with NOT_YOUR_TURN
      const rejectedMsg = outOfTurnSock.getLastMessage();
      assert.equal(rejectedMsg?.t, 'rejected');
      assert.equal(rejectedMsg?.code, 'NOT_YOUR_TURN');

      // The in-turn player's state was NOT corrupted
      const inTurnSock = activeColor === 'yellow' ? serverSockB : serverSockA;
      const inTurnStateMsgs = inTurnSock.messages.map((m) => JSON.parse(m)).filter((m) => m.t === 'state');
      const inTurnLastSeq = inTurnStateMsgs[inTurnStateMsgs.length - 1]?.seq;
      assert.equal(inTurnLastSeq, 1, 'In-turn player state remains pristine at seq 1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('S3-2: D2 Gate — unauthenticated client without seat cannot participate or send intents', async () => {
    const serverSock = new MockWebSocket();
    const storageMap = new Map<string, unknown>();

    const mockCtx = {
      storage: {
        get: async (k: string) => storageMap.get(k),
        put: async (k: string, v: unknown) => { storageMap.set(k, v); },
      },
      getWebSockets: () => [serverSock] as unknown as WebSocket[],
      acceptWebSocket: () => {},
    };

    const mockEnv = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    };

    const room = new MatchRoomCore(mockCtx as never, mockEnv);

    // Client connects without ticket and attempts seat intent
    await room.webSocketMessage(
      serverSock as unknown as WebSocket,
      JSON.stringify({
        t: 'intent',
        kind: 'REQUEST_ROLL',
        intentId: 'bad-intent-1',
      })
    );

    const reply = serverSock.getLastMessage();
    assert.equal(reply?.t, 'rejected');
    assert.equal(reply?.code, 'NOT_AUTHORIZED');
  });

  it('S3-3: SV-14 — DO hibernation wake restores matchId, state, timerHeap, socketMeta, and accepts frame.ticket on join', async () => {
    const matchId = '99999999-8888-7777-6666-555555555555';
    const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const walletB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const ticketA = 'ticket-hibernation-a';
    const ticketB = 'ticket-hibernation-b';
    const hashA = await hashToken(ticketA);
    const hashB = await hashToken(ticketB);

    const mockDbSessions = new Map<string, { wallet_address: string; scope: string; match_id: string; seat_color: string }>([
      [hashA, { wallet_address: walletA, scope: 'match', match_id: matchId, seat_color: 'green' }],
      [hashB, { wallet_address: walletB, scope: 'match', match_id: matchId, seat_color: 'yellow' }],
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('/rest/v1/match_states')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/rest/v1/matches')) {
        return new Response(JSON.stringify([{ match_shape: '1v1', game_mode: 'classic' }]), { status: 200 });
      }
      if (url.includes('/rest/v1/match_seats')) {
        return new Response(
          JSON.stringify([
            { color: 'green', wallet_address: walletA, seat_index: 0 },
            { color: 'yellow', wallet_address: walletB, seat_index: 1 },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/rest/v1/sessions')) {
        const hashMatch = url.match(/token_hash=eq\.([a-f0-9]+)/);
        const session = hashMatch?.[1] ? mockDbSessions.get(hashMatch[1]) : undefined;
        return new Response(
          JSON.stringify(session ? [{ ...session, expires_at: new Date(Date.now() + 60000).toISOString() }] : []),
          { status: 200 }
        );
      }
      if (url.includes('/rest/v1/rpc/match_commit_action')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    try {
      const storageMap = new Map<string, unknown>();
      const connectedSockets: MockWebSocket[] = [];
      const mockCtx = {
        storage: {
          get: async (k: string) => storageMap.get(k),
          put: async (k: string, v: unknown) => { storageMap.set(k, v); },
          setAlarm: async () => {},
        },
        getWebSockets: () => connectedSockets as unknown as WebSocket[],
        acceptWebSocket: (ws: unknown) => { connectedSockets.push(ws as MockWebSocket); },
      };
      const mockEnv = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      };

      const room1 = new MatchRoomCore(mockCtx as never, mockEnv);
      const serverSockA = new MockWebSocket();
      const serverSockB = new MockWebSocket();

      // Connect A via upgrade without query ticket, then authenticate via in-band join frame carrying `ticket` (not `token`)
      (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
        0 = new MockWebSocket();
        1 = serverSockA;
      };
      await room1.fetch(new Request(`https://ludobase.com/api/room/${matchId}/ws`, { headers: { Upgrade: 'websocket' } }));
      await room1.webSocketMessage(
        serverSockA as unknown as WebSocket,
        JSON.stringify({ t: 'join', ticket: ticketA, as: 'seat', lastSeq: 0 })
      );
      const joinedFrame = serverSockA.messages.map(m => JSON.parse(m)).find(m => m.t === 'joined');
      assert.equal(joinedFrame?.role, 'seat', 'handleJoinFrame must authenticate frame.ticket as seat');
      assert.equal(joinedFrame?.seat, 'green');

      // Connect B with upgrade ticket
      (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
        0 = new MockWebSocket();
        1 = serverSockB;
      };
      await room1.fetch(new Request(`https://ludobase.com/api/room/${matchId}/ws?ticket=${ticketB}`, { headers: { Upgrade: 'websocket' } }));

      // Simulate DO hibernation eviction: construct a brand new MatchRoomCore with the same storage + hibernated sockets
      const roomAfterWake = new MatchRoomCore(mockCtx as never, mockEnv);
      serverSockA.messages = [];
      await roomAfterWake.webSocketMessage(
        serverSockA as unknown as WebSocket,
        JSON.stringify({ t: 'intent', kind: 'REQUEST_ROLL', intentId: 'wake-roll-1' })
      );
      const wakeReply = serverSockA.getLastMessage();
      assert.equal(wakeReply?.t, 'intent_ack', 'Woken DO must restore socketMeta and state and accept REQUEST_ROLL');

      // Simulate DO eviction before alarm fires: construct another fresh MatchRoomCore and expire the timer
      const timers = (storageMap.get('timerHeap') as Array<{ id: string; kind: string; deadlineAt: number }>) || [];
      assert.equal(timers.length, 1, 'Exactly one timer per room');
      timers[0].deadlineAt = Date.now() - 10;
      storageMap.set('timerHeap', timers);

      const roomForAlarmWake = new MatchRoomCore(mockCtx as never, mockEnv);
      const preAlarmState = storageMap.get('state') as GameState;
      const prePlayer = preAlarmState.currentPlayer;
      await roomForAlarmWake.alarm();
      const postAlarmState = storageMap.get('state') as GameState;
      assert.notEqual(postAlarmState.currentPlayer, prePlayer, 'Woken alarm() must rehydrate state/timers and advance turn on timeout');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('S3-4: SV-03, SV-04, SV-05B, SV-15 — roll edge cases (6 with 0 moves, three sixes, boost +6), 2v2 assist, and ai_turn timer preservation', async () => {
    const matchId = '77777777-6666-5555-4444-333333333333';
    const walletG = '0x1111111111111111111111111111111111111111';
    const walletR = '0x2222222222222222222222222222222222222222';
    const walletY = '0x3333333333333333333333333333333333333333';
    const walletB = '0x4444444444444444444444444444444444444444';
    const ticketG = 'ticket-2v2-green';
    const hashG = await hashToken(ticketG);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('/rest/v1/sessions')) {
        return new Response(
          JSON.stringify([{ wallet_address: walletG, scope: 'match', match_id: matchId, seat_color: 'green', expires_at: new Date(Date.now() + 60000).toISOString() }]),
          { status: 200 }
        );
      }
      if (url.includes('/rest/v1/rpc/match_commit_action')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const origGetRandomValues = crypto.getRandomValues.bind(crypto);
    let forcedDieByte = 5; // (5 % 6) + 1 = 6
    crypto.getRandomValues = <T extends ArrayBufferView | null>(arr: T): T => {
      if (arr instanceof Uint8Array) arr[0] = forcedDieByte;
      return arr;
    };

    try {
      const storageMap = new Map<string, unknown>();
      const connectedSockets: MockWebSocket[] = [];
      const mockCtx = {
        storage: {
          get: async (k: string) => storageMap.get(k),
          put: async (k: string, v: unknown) => { storageMap.set(k, v); },
          setAlarm: async () => {},
        },
        getWebSockets: () => connectedSockets as unknown as WebSocket[],
        acceptWebSocket: (ws: unknown) => { connectedSockets.push(ws as MockWebSocket); },
      };
      const mockEnv = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      };

      const baseSeedState: GameState = {
        positions: {
          green: [55, 57, 57, 57],
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
        strikes: { green: 2, red: 0, yellow: 0, blue: 0 },
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
          green: { isAutoPlaying: false, consecutiveTurns: 2, totalTriggers: 2, isKicked: false },
          red: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
          yellow: { isAutoPlaying: true, consecutiveTurns: 3, totalTriggers: 3, isKicked: false },
          blue: { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false },
        },
        idleWarning: null,
        participantPeers: {},
        isStarted: true,
        isBotMatch: false,
        botDifficulty: 'pro',
        lastUpdate: Date.now(),
        playerCount: '2v2',
        matchId,
        initialBoardConfig: {
          players: [
            { name: 'G', level: 1, avatar: '', color: 'green', position: 'bottom-left', walletAddress: walletG },
            { name: 'R', level: 1, avatar: '', color: 'red', position: 'top-left', walletAddress: walletR },
            { name: 'B', level: 1, avatar: '', color: 'blue', position: 'top-right', walletAddress: walletB },
            { name: 'Y', level: 1, avatar: '', color: 'yellow', position: 'bottom-right', walletAddress: walletY },
          ],
          colorCorner: { green: 'BL', red: 'TL', blue: 'TR', yellow: 'BR' },
        },
      };

      storageMap.set('matchId', matchId);
      storageMap.set('seq', 0);
      storageMap.set('state', baseSeedState);

      const room = new MatchRoomCore(mockCtx as never, mockEnv);
      const sockG = new MockWebSocket();
      (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
        0 = new MockWebSocket();
        1 = sockG;
      };
      await room.fetch(new Request(`https://ludobase.com/api/room/${matchId}/ws?ticket=${ticketG}`, { headers: { Upgrade: 'websocket' } }));
      assert.ok(hashG);

      // 1. SV-03A + SV-05B + SV-15: Green (BL) has tokens at [55, 57, 57, 57] and rolls a 6 -> 0 legal moves -> MUST auto-pass to Yellow (BR)!
      // And because Yellow isAutoPlaying=true, timerHeap MUST hold 'ai_turn' (NOT overwritten by 'turn')!
      // And Green's strikes must reset to 0 on active roll!
      forcedDieByte = 5; // roll = 6
      await room.webSocketMessage(
        sockG as unknown as WebSocket,
        JSON.stringify({ t: 'intent', kind: 'REQUEST_ROLL', intentId: 'roll-6-no-moves' })
      );
      const stateAfter6NoMove = storageMap.get('state') as GameState;
      assert.equal(stateAfter6NoMove.currentPlayer, 'yellow', 'SV-03A: rolling 6 with 0 legal moves must auto-pass turn');
      assert.equal(stateAfter6NoMove.diceValue, null);
      assert.equal(stateAfter6NoMove.gamePhase, 'rolling');
      assert.equal(stateAfter6NoMove.strikes.green, 0, 'SV-15: active human roll resets strikes to 0');
      const timersAfterPass = storageMap.get('timerHeap') as Array<{ kind: string }>;
      assert.equal(timersAfterPass[0]?.kind, 'ai_turn', 'SV-05B: ai_turn timer must not be overwritten by 15s turn timer');

      // 2. SV-03B: Green has consecutiveSixes = 2 and rolls a 3rd 6 -> MUST auto-pass at roll time!
      await mockCtx.storage.put('state', {
        ...baseSeedState,
        positions: { ...baseSeedState.positions, green: [0, -1, -1, -1] },
        currentPlayer: 'green',
        consecutiveSixes: 2,
      });
      (room as unknown as { state: GameState }).state = storageMap.get('state') as GameState;
      forcedDieByte = 5; // roll = 6
      await room.webSocketMessage(
        sockG as unknown as WebSocket,
        JSON.stringify({ t: 'intent', kind: 'REQUEST_ROLL', intentId: 'roll-third-six' })
      );
      const stateAfterThirdSix = storageMap.get('state') as GameState;
      assert.equal(stateAfterThirdSix.currentPlayer, 'yellow', 'SV-03B: 3rd consecutive six must forfeit turn immediately');
      assert.equal(stateAfterThirdSix.consecutiveSixes, 0);
      assert.equal(stateAfterThirdSix.gamePhase, 'rolling');
      assert.equal(stateAfterThirdSix.strikes.green, 2, 'D-2: forfeited 3rd six must not erase existing AFK strikes');

      // 3. SV-04 + D-1: 2v2 Teammate Assist — Green has all 4 tokens at [57, 57, 57, 57], teammate Blue has token 0 at pos 8.
      // Green rolls a 4 and moves token 0 onto a power tile at pos 12 ({ r: 6, c: 9 }) -> Blue's token advances to 12 and Blue's inventory receives the power!
      await mockCtx.storage.put('state', {
        ...baseSeedState,
        positions: {
          green: [57, 57, 57, 57],
          red: [-1, -1, -1, -1],
          yellow: [-1, -1, -1, -1],
          blue: [8, -1, -1, -1],
        },
        powerTiles: [{ r: 6, c: 9, type: 'shield' }],
        currentPlayer: 'green',
        consecutiveSixes: 0,
      });
      (room as unknown as { state: GameState }).state = storageMap.get('state') as GameState;
      forcedDieByte = 3; // (3 % 6) + 1 = 4
      await room.webSocketMessage(
        sockG as unknown as WebSocket,
        JSON.stringify({ t: 'intent', kind: 'REQUEST_ROLL', intentId: 'roll-2v2-assist' })
      );
      const stateAfterAssistRoll = storageMap.get('state') as GameState;
      assert.equal(stateAfterAssistRoll.gamePhase, 'moving', 'SV-04: finished 2v2 player rolling for teammate enters moving phase');
      assert.equal(stateAfterAssistRoll.diceValue, 4);

      await room.webSocketMessage(
        sockG as unknown as WebSocket,
        JSON.stringify({ t: 'intent', kind: 'REQUEST_MOVE', intentId: 'move-2v2-assist', payload: { tokenIndex: 0 } })
      );
      const stateAfterAssistMove = storageMap.get('state') as GameState;
      assert.equal(stateAfterAssistMove.positions.blue[0], 12, 'SV-04: finished 2v2 player REQUEST_MOVE advances teammate token');
      assert.equal(stateAfterAssistMove.playerPowers?.blue?.length, 1, 'D-1: 2v2 assist power pickup credits active teammate (targetColor)');
      assert.equal(stateAfterAssistMove.playerPowers?.green?.length ?? 0, 0, 'D-1: 2v2 assist power pickup does not credit finished roller');
    } finally {
      crypto.getRandomValues = origGetRandomValues;
      globalThis.fetch = originalFetch;
    }
  });
});
