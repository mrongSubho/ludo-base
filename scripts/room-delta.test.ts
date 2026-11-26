import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MatchRoomCore } from '../src/room/MatchRoomCore';
import { RoomClient } from '../lib/netcode/roomClient';
import { hashToken } from '../lib/sessionV2';
import { assignCornersForShape } from '../lib/boardLayout';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import { derivePowerVfxEvents } from '../lib/powerVfx';
import { deriveMatchFeedEvent } from '../lib/matchFeed';
import { TURN_TIMERS } from '../lib/constants';
import type { MatchEvent } from '../lib/matchEvents';
import type { GameState } from '../lib/types';

class BridgedSocket {
    public readyState = 1;
    public sentRaw: string[] = [];
    public onopen: (() => void) | null = null;
    public onmessage: ((ev: { data: string }) => void) | null = null;
    public onerror: ((ev: unknown) => void) | null = null;
    public onclose: (() => void) | null = null;
    private attachment: unknown = null;
    public onSend?: (data: string) => void;

    serializeAttachment(v: unknown) {
        this.attachment = JSON.parse(JSON.stringify(v));
    }

    deserializeAttachment() {
        return this.attachment ? JSON.parse(JSON.stringify(this.attachment)) : null;
    }

    send(data: string) {
        this.sentRaw.push(data);
        this.onSend?.(data);
    }

    close() {
        this.readyState = 3;
        this.onclose?.();
    }
}

describe('Hybrid Event-Deltas, PW-1 Privacy, Auto-Resync, Split Bot Turns & 51->0 Wrap Fixes', () => {
    it('emits compact t=delta frames (< 650 B), maintains deep equality with t=state, enforces PW-1 privacy, auto-resyncs gaps, and splits bot turns', async () => {
        const matchId = 'dddddddd-1111-2222-3333-444444444444';
        const walletG = '0x1111111111111111111111111111111111111111';
        const walletY = '0x2222222222222222222222222222222222222222';
        const ticketG = 'delta-ticket-green';
        const ticketY = 'delta-ticket-yellow';
        const [hashG, hashY] = await Promise.all([hashToken(ticketG), hashToken(ticketY)]);

        const cc = { green: 'BL', red: 'TL', blue: 'TR', yellow: 'BR' } as const;
        // Start Green at pos 34 so a roll of 2 lands at pos 36 ({ r: 12, c: 7 }), matching our planted powerTile.
        const seededState: GameState = {
            ...structuredClone(INITIAL_GAME_STATE),
            matchId,
            playerCount: '1v1',
            currentPlayer: 'green',
            gamePhase: 'rolling',
            status: 'playing',
            isStarted: true,
            positions: {
                green: [34, -1, -1, -1],
                yellow: [37, -1, -1, -1],
                red: [-1, -1, -1, -1],
                blue: [-1, -1, -1, -1],
            },
            powerTileSeed: 12345,
            powerTiles: [{ r: 12, c: 7, type: 'nuke' }],
            playerPowers: {
                green: [],
                yellow: [{ type: 'shield', expiresAt: 9_999_999 }],
                red: [],
                blue: [],
            },
            initialBoardConfig: {
                colorCorner: cc,
                players: [
                    { name: 'Green', level: 1, avatar: '', color: 'green', position: 'bottom-left', walletAddress: walletG, isAi: false },
                    { name: 'Yellow', level: 1, avatar: '', color: 'yellow', position: 'top-right', walletAddress: walletY, isAi: true },
                ],
            },
        };

        const originalFetch = globalThis.fetch;
        const origWebSocket = globalThis.WebSocket;
        const origCrypto = crypto.getRandomValues.bind(crypto);
        let forcedDieByte = 1; // (1 % 6) + 1 = 2
        crypto.getRandomValues = <T extends ArrayBufferView | null>(arr: T): T => {
            if (arr instanceof Uint8Array) arr[0] = forcedDieByte;
            return arr;
        };

        globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const url = String(input);
            if (url.includes('/rest/v1/sessions')) {
                if (url.includes(hashG)) {
                    return new Response(JSON.stringify([{ wallet_address: walletG, scope: 'match', match_id: matchId, seat_color: 'green', expires_at: null, idle_expires_at: null }]), { status: 200 });
                }
                if (url.includes(hashY)) {
                    return new Response(JSON.stringify([{ wallet_address: walletY, scope: 'match', match_id: matchId, seat_color: 'yellow', expires_at: null, idle_expires_at: null }]), { status: 200 });
                }
                return new Response(JSON.stringify([]), { status: 200 });
            }
            if (url.includes('/rest/v1/rpc/match_commit_action')) {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
        };

        const storageMap = new Map<string, unknown>([
            ['matchId', matchId],
            ['seq', 0],
            ['state', seededState],
        ]);
        const acceptedSockets: BridgedSocket[] = [];
        const mockCtx = {
            storage: {
                get: async <T = unknown>(k: string) => storageMap.get(k) as T | undefined,
                put: async (k: string, v: unknown) => { storageMap.set(k, v); },
                setAlarm: async () => {},
            },
            getWebSockets: () => acceptedSockets as unknown as WebSocket[],
            acceptWebSocket: (ws: unknown) => { acceptedSockets.push(ws as BridgedSocket); },
        };
        const room = new MatchRoomCore(mockCtx as never, {
            NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        });

        // Bridge `new WebSocket(...)` in RoomClient directly to MatchRoomCore
        (globalThis as unknown as { WebSocket: unknown }).WebSocket = class extends BridgedSocket {
            static readonly OPEN = 1;
            constructor(url: string) {
                super();
                const serverSock = new BridgedSocket();
                serverSock.onSend = (raw) => {
                    this.onmessage?.({ data: raw });
                };
                this.onSend = (raw) => {
                    void room.webSocketMessage(serverSock as unknown as WebSocket, raw);
                };
                (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
                    0 = new BridgedSocket();
                    1 = serverSock;
                };
                void room
                    .fetch(new Request(`https://ludobase.com${url.startsWith('/') ? url : `/api/room/${matchId}/ws`}`, { headers: { Upgrade: 'websocket' } }))
                    .then(() => {
                        this.onopen?.();
                    });
            }
        };

        const statesG: Array<{ state: GameState; seq: number; resync?: boolean }> = [];
        const eventsG: Array<{ events: MatchEvent[]; seq: number }> = [];
        const statesSpec: Array<{ state: GameState; seq: number; resync?: boolean }> = [];
        const eventsSpec: Array<{ events: MatchEvent[]; seq: number }> = [];

        const clientG = new RoomClient({
            matchId,
            inBandToken: ticketG,
            as: 'seat',
            onState: (state, seq, _id, resync) => statesG.push({ state, seq, resync }),
            onEvents: (events, seq) => eventsG.push({ events, seq }),
        });
        const clientSpec = new RoomClient({
            matchId,
            as: 'spectator',
            onState: (state, seq, _id, resync) => statesSpec.push({ state, seq, resync }),
            onEvents: (events, seq) => eventsSpec.push({ events, seq }),
        });

        // Raw legacy observer without `caps: ['delta']` to verify exact state parity
        const legacyObs = new BridgedSocket();
        (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
            0 = new BridgedSocket();
            1 = legacyObs;
        };
        await room.fetch(new Request(`https://ludobase.com/api/room/${matchId}/ws`, { headers: { Upgrade: 'websocket' } }));
        await room.webSocketMessage(legacyObs as unknown as WebSocket, JSON.stringify({ v: 1, t: 'join', as: 'spectator', lastSeq: 0 }));

        try {
            // Connect Green (delta-capable seat) & Spectator (delta-capable spectator)
            clientG.connect();
            await new Promise((r) => setTimeout(r, 15));
            clientSpec.connect();
            await new Promise((r) => setTimeout(r, 15));

            assert.equal(clientG.getStatus(), 'connected');
            assert.equal(statesG.length, 1, 'initial connect receives full state snapshot');

            // 1. REQUEST_ROLL (die = 2) -> emits compact `t: 'delta'` frame
            const srvSockG = acceptedSockets.find((s) =>
                s.sentRaw.some((m) => m.includes('"seat":"green"')),
            )!;
            srvSockG.sentRaw = [];
            forcedDieByte = 1; // roll = 2
            await clientG.sendIntent('REQUEST_ROLL', {});
            await new Promise((r) => setTimeout(r, 10));

            const rollWireFrames = srvSockG.sentRaw.map((r) => JSON.parse(r) as Record<string, unknown>);
            const rollDeltaRawIdx = srvSockG.sentRaw.findIndex((r) => r.includes('"t":"delta"'));
            assert.ok(rollDeltaRawIdx >= 0, 'Room must send t:delta after negotiating caps:[delta]');
            const rollByteLen = new TextEncoder().encode(srvSockG.sentRaw[rollDeltaRawIdx]).byteLength;
            assert.ok(rollByteLen < 650, `Expected compact roll delta (< 650 B), got ${rollByteLen} B`);
            const rollDelta = rollWireFrames[rollDeltaRawIdx];
            assert.equal(rollDelta.prevSeq, 0);
            assert.equal(rollDelta.seq, 1);
            assert.equal(eventsG[0]?.events[0]?.type, 'ROLL');

            // 2. REQUEST_MOVE token 0 from 34 -> 36 (lands on Nuke tile!) -> PW-1 privacy check!
            srvSockG.sentRaw = [];
            await clientG.sendIntent('REQUEST_MOVE', { tokenIndex: 0 });
            await new Promise((r) => setTimeout(r, 10));

            const moveDelta = srvSockG.sentRaw.map((r) => JSON.parse(r) as Record<string, unknown>).find((m) => m.t === 'delta')!;
            assert.equal(moveDelta.prevSeq, 1);
            assert.equal(moveDelta.seq, 2);

            // Green (picker) sees exact powerType on POWER_PICKUP and in own playerPowers
            const gMoveEvents = eventsG.find((e) => e.seq === 2)?.events ?? [];
            assert.equal(gMoveEvents.some((e) => e.type === 'MOVE' && e.fromPos === 34 && e.toPos === 36), true);
            const gPickup = gMoveEvents.find((e) => e.type === 'POWER_PICKUP');
            assert.ok(gPickup && gPickup.type === 'POWER_PICKUP' && gPickup.powerType === 'nuke', 'picker sees powerType');

            // Spectator NEVER sees powerType on POWER_PICKUP, powerTileSeed, powerTiles[].type, or playerPowers[].type!
            const specPickup = (eventsSpec.find((e) => e.seq === 2)?.events ?? []).find((e) => e.type === 'POWER_PICKUP');
            assert.ok(specPickup && specPickup.type === 'POWER_PICKUP');
            assert.equal('powerType' in specPickup, false, 'PW-1: spectator POWER_PICKUP must strip powerType');

            const specReconstructed = statesSpec[statesSpec.length - 1].state;
            assert.equal('powerTileSeed' in specReconstructed, false);
            assert.ok(specReconstructed.powerTiles.every((tile) => (tile as { type?: unknown }).type === undefined));
            assert.equal(specReconstructed.playerPowers.green[0]?.type, undefined);
            assert.equal(specReconstructed.playerPowers.yellow[0]?.type, undefined);

            // Deep equality between delta-reconstructed spectator state and full legacy `t:state` spectator snapshot!
            const legacyFullStateMsg = legacyObs.sentRaw
                .map((r) => JSON.parse(r) as Record<string, unknown>)
                .filter((m) => m.t === 'state')
                .pop()!;
            assert.deepEqual(specReconstructed, legacyFullStateMsg.state, 'delta reconstruction matches full wire state identically');

            // 3. Turn is now Yellow (isAi: true): expiring ai_turn timer triggers alarm which splits bot turn into ROLL (seq 3) + MOVE (seq 4)
            const gLenBeforeBot = eventsG.length;
            const timers = (storageMap.get('timerHeap') as Array<{ id: string; kind: string; deadlineAt: number }>) || [];
            assert.ok(timers.length > 0 && timers[0].kind === 'ai_turn', 'Yellow AI turn timer must be scheduled');
            timers[0].deadlineAt = Date.now() - 20;
            storageMap.set('timerHeap', timers);
            (room as unknown as { timerHeap: typeof timers }).timerHeap = timers;
            forcedDieByte = 2; // Yellow bot rolls 3 (moves 37 -> 40)
            await room.alarm();
            await new Promise((r) => setTimeout(r, 15));

            const botBatches = eventsG.slice(gLenBeforeBot);
            assert.equal(botBatches.length, 2, 'bot turn emits separate ROLL and MOVE delta frames');
            assert.equal(botBatches[0].seq, 3);
            assert.equal(botBatches[0].events[0].type, 'ROLL');
            assert.equal((botBatches[0].events[0] as Extract<MatchEvent, { type: 'ROLL' }>).source, 'bot');
            assert.equal(botBatches[1].seq, 4);
            assert.equal(botBatches[1].events[0].type, 'MOVE');
            assert.equal(statesG[statesG.length - 1].state.positions.yellow[0], 40);
            assert.equal(TURN_TIMERS.aiStepMs, 1000);

            // 4. prevSeq !== knownSeq gap on RoomClient automatically triggers resync join -> full state resync: true
            const preResyncLen = statesG.length;
            const fakeGapDelta = JSON.stringify({
                v: 1,
                t: 'delta',
                seq: 9,
                prevSeq: 8,
                patch: { diceValue: 5 },
                events: [],
                deadlineAt: null,
            });
            srvSockG.onSend?.(fakeGapDelta);
            await new Promise((r) => setTimeout(r, 20));
            const latestAfterGap = statesG[statesG.length - 1];
            assert.ok(statesG.length > preResyncLen, 'gap resync delivered recovery state');
            assert.equal(latestAfterGap.resync, true, 'gap recovery sets resync=true for AnimationBarrier flush');
            assert.equal(clientG.getStatus(), 'connected');
        } finally {
            clientG.disconnect();
            clientSpec.disconnect();
            crypto.getRandomValues = origCrypto;
            globalThis.WebSocket = origWebSocket;
            globalThis.fetch = originalFetch;
        }
    });

    it('fixes 51 -> 0 perimeter wrap in derivePowerVfxEvents (boost_trail) and deriveMatchFeedEvent (capture kicker)', () => {
        const cc = assignCornersForShape('4P');

        // 1. Boost trail wrapping across 50 -> 2
        const boostPrev: GameState = {
            ...structuredClone(INITIAL_GAME_STATE),
            currentPlayer: 'green',
            positions: { green: [48, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
            boostTrail: null,
        };
        const boostNext: GameState = {
            ...boostPrev,
            positions: { green: [2, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
            boostTrail: 'green',
        };
        const vfx = derivePowerVfxEvents(boostPrev, boostNext, cc, '4P');
        const trail = vfx.find((e) => e.kind === 'boost_trail');
        assert.ok(trail && trail.kind === 'boost_trail', 'boost_trail must derive on 51 -> 0 wrap');
        assert.equal(trail.cells.length, 7, 'start cell + 6 wrapped steps = 7 trail cells');

        // 2. Capture attribution wrapping across 50 -> 2 (kicks red from pos 2 -> -1)
        const capPrev: GameState = {
            ...structuredClone(INITIAL_GAME_STATE),
            currentPlayer: 'yellow',
            positions: { green: [50, -1, -1, -1], red: [2, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        };
        const capNext: GameState = {
            ...capPrev,
            positions: { green: [2, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
        };
        const feed = deriveMatchFeedEvent(capPrev, capNext, { myColor: 'red', playerCount: '4P', colorCorner: cc });
        assert.deepEqual(feed, { text: 'RED KICKED BY GREEN · BONUS ROLL', tone: 'capture' });
    });
});
