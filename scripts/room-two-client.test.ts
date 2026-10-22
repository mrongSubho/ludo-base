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

// Mock WebSocket implementation for in-memory testing
class MockWebSocket {
  public messages: string[] = [];
  public closed = false;
  public readyState = 1; // OPEN
  public onmessage?: (event: { data: string }) => void;
  public onclose?: (event: unknown) => void;
  public counterpart?: MockWebSocket;

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

      // Room must broadcast state at seq = 1 to BOTH Client A and Client B
      const latestMsgA = serverSockA.getLastMessage();
      const latestMsgB = serverSockB.getLastMessage();

      assert.equal(latestMsgA?.t, 'state');
      assert.equal(latestMsgB?.t, 'state');
      assert.equal(latestMsgA?.seq, 1);
      assert.equal(latestMsgB?.seq, 1);

      const rolledStateA = latestMsgA?.state as GameState;
      const rolledStateB = latestMsgB?.state as GameState;
      assert.deepEqual(rolledStateA, rolledStateB, 'Both clients must receive identical roll state');
      assert.ok(rolledStateA.diceValue !== null && rolledStateA.diceValue >= 1 && rolledStateA.diceValue <= 6);

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
      const inTurnLastSeq = (inTurnSock.getLastMessage() as { seq: number })?.seq;
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
});
