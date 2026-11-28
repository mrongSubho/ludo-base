import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MatchRoomCore } from '../src/room/MatchRoomCore';
import {
    AFK_BOT_MOVE_DELAY_MS,
    AFK_BOT_ROLL_DELAY_MS,
    AFK_DISCONNECT_GRACE_MS,
    TURN_TIMERS,
} from '../lib/constants';
import {
    getAfkReclaimWindowMs,
    getKickReasonMessage,
    pickTier1RandomMove,
    pickTier1RandomPower,
    sampleHumanizedBotDelayMs,
} from '../lib/afkPolicy';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import { assignCornersForShape } from '../lib/boardLayout';
import { ARENA_TREASURY_WALLET, resolveSettledPayoutShares } from '../lib/arenaVaultService';
import { hashToken } from '../lib/sessionV2';
import type { GameState } from '../lib/types';

class AfkMockSocket {
    public readyState = 1;
    public messages: string[] = [];
    private attachment: unknown = null;

    send(data: string) {
        this.messages.push(data);
    }

    close() {
        this.readyState = 3;
    }

    serializeAttachment(att: unknown) {
        this.attachment = JSON.parse(JSON.stringify(att));
    }

    deserializeAttachment() {
        return this.attachment ? JSON.parse(JSON.stringify(this.attachment)) : null;
    }

    allParsed(): Array<Record<string, unknown>> {
        return this.messages.map((raw) => JSON.parse(raw) as Record<string, unknown>);
    }

    lastParsed(): Record<string, unknown> | null {
        const list = this.allParsed();
        return list.length > 0 ? list[list.length - 1] : null;
    }
}

describe('Dual-Tier AFK Bot, Match-Age Window, Presence, Stealth Masking, Forfeit & Treasury', () => {
    it('scales reclaim windows by match elapsed time (10m -> 8m -> 6m -> 5m)', () => {
        assert.equal(getAfkReclaimWindowMs(0), 10 * 60_000);
        assert.equal(getAfkReclaimWindowMs(60_000), 10 * 60_000);
        assert.equal(getAfkReclaimWindowMs(4 * 60_000 + 59_000), 10 * 60_000);
        assert.equal(getAfkReclaimWindowMs(5 * 60_000), 8 * 60_000);
        assert.equal(getAfkReclaimWindowMs(9 * 60_000 + 59_000), 8 * 60_000);
        assert.equal(getAfkReclaimWindowMs(10 * 60_000), 6 * 60_000);
        assert.equal(getAfkReclaimWindowMs(14 * 60_000 + 59_000), 6 * 60_000);
        assert.equal(getAfkReclaimWindowMs(15 * 60_000), 5 * 60_000);
        assert.equal(getAfkReclaimWindowMs(45 * 60_000), 5 * 60_000);
    });

    it('samples humanized bot pacing delays inside 2-4s roll and 3-5s move bounds', () => {
        assert.equal(sampleHumanizedBotDelayMs('roll', () => 0), AFK_BOT_ROLL_DELAY_MS.min);
        assert.equal(sampleHumanizedBotDelayMs('roll', () => 0.9999), AFK_BOT_ROLL_DELAY_MS.max);
        assert.equal(sampleHumanizedBotDelayMs('move', () => 0), AFK_BOT_MOVE_DELAY_MS.min);
        assert.equal(sampleHumanizedBotDelayMs('move', () => 0.9999), AFK_BOT_MOVE_DELAY_MS.max);
        assert.ok(getKickReasonMessage('afk_limit_5').includes('5/5'));
    });

    it('Tier-1 Random Bot chooses uniformly legal tokens (including 2v2 assist) and valid random powers', () => {
        const cc = assignCornersForShape('2v2');
        const pos = {
            green: [57, 57, 57, 57],
            blue: [10, 56, -1, -1],
            red: [-1, -1, -1, -1],
            yellow: [-1, -1, -1, -1],
        };
        // Green finished -> assists Blue; with dice 1 only tokens 0 (10->11) and 1 (56->57) are legal
        const lowPick = pickTier1RandomMove(pos, 'green', 1, cc, '2v2', () => 0.1);
        const highPick = pickTier1RandomMove(pos, 'green', 1, cc, '2v2', () => 0.9);
        assert.deepEqual(lowPick, { color: 'blue', tokenIndex: 0 });
        assert.deepEqual(highPick, { color: 'blue', tokenIndex: 1 });

        // Power decision: 50% save rate when rand < 0.5; otherwise picks usable held power
        const powerState: GameState = {
            ...structuredClone(INITIAL_GAME_STATE),
            gameMode: 'power',
            powerTiles: [{ r: 2, c: 2, type: 'boost' }],
            positions: {
                green: [34, -1, -1, -1],
                red: [-1, -1, -1, -1],
                yellow: [-1, -1, -1, -1],
                blue: [-1, -1, -1, -1],
            },
            playerPowers: {
                green: [{ type: 'boost', expiresAt: 9_999_999_999_999 }],
                red: [],
                yellow: [],
                blue: [],
            },
        };
        assert.equal(pickTier1RandomPower(powerState, 'green', cc, '2v2', () => 0.2, 1000), null);
        assert.deepEqual(pickTier1RandomPower(powerState, 'green', cc, '2v2', () => 0.75, 1000), { type: 'boost' });
    });

    it('DO executes Tier-1 two-phase turns, stealth-masks opponents, enforces afk_expire & 5s disconnect grace', async (t) => {
        t.mock.timers.enable({ apis: ['Date'] });
        const startNow = 1_750_000_000_000;
        t.mock.timers.setTime(startNow);

        const matchId = 'f1111111-2222-3333-4444-555555555555';
        const walletG = '0x1111111111111111111111111111111111111111';
        const walletY = '0x2222222222222222222222222222222222222222';
        const ticketG = 'afk-ticket-g';
        const ticketY = 'afk-ticket-y';
        const [hashG, hashY] = await Promise.all([hashToken(ticketG), hashToken(ticketY)]);

        const cc = assignCornersForShape('1v1');
        const seededState: GameState = {
            ...structuredClone(INITIAL_GAME_STATE),
            matchId,
            playerCount: '1v1',
            currentPlayer: 'green',
            gamePhase: 'rolling',
            status: 'playing',
            isStarted: true,
            matchStartedAt: startNow,
            positions: {
                green: [cc.green === 'BL' ? 34 : 8, -1, -1, -1],
                yellow: [cc.yellow === 'TR' ? 8 : 34, -1, -1, -1],
                red: [-1, -1, -1, -1],
                blue: [-1, -1, -1, -1],
            },
            initialBoardConfig: {
                colorCorner: cc,
                players: [
                    { name: 'Green', level: 1, avatar: '', color: 'green', position: 'bottom-left', isAi: false, walletAddress: walletG },
                    { name: 'Yellow', level: 1, avatar: '', color: 'yellow', position: 'top-right', isAi: false, walletAddress: walletY },
                ],
            },
        };

        const storageMap = new Map<string, unknown>([
            ['matchId', matchId],
            ['seq', 0],
            ['state', seededState],
        ]);
        let connectedSockets: AfkMockSocket[] = [];
        const mockCtx = {
            storage: {
                get: async <T = unknown>(k: string) => storageMap.get(k) as T | undefined,
                put: async (k: string, v: unknown) => { storageMap.set(k, v); },
                setAlarm: async () => {},
                deleteAlarm: async () => {},
            },
            getWebSockets: () => connectedSockets as unknown as WebSocket[],
            acceptWebSocket: (ws: unknown) => { connectedSockets.push(ws as AfkMockSocket); },
        };

        const originalFetch = globalThis.fetch;
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

        try {
            const room = new MatchRoomCore(mockCtx as never, {
                NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
                SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
            });

            const joinSeat = async (ticket: string, delta = true) => {
                const sock = new AfkMockSocket();
                (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
                    0 = new AfkMockSocket();
                    1 = sock;
                };
                await room.fetch(new Request(`https://ludobase.com/api/room/${matchId}/ws`, { headers: { Upgrade: 'websocket' } }));
                await room.webSocketMessage(
                    sock as unknown as WebSocket,
                    JSON.stringify({ v: 1, t: 'join', token: ticket, as: 'seat', ...(delta ? { caps: ['delta'] } : {}) }),
                );
                return sock;
            };

            const sockG = await joinSeat(ticketG, true);
            const sockY = await joinSeat(ticketY, true);

            // 1. Silent CMD_PRESENCE updates without bumping seq or notifying Yellow
            const seqBeforePresence = storageMap.get('seq');
            const yLenBeforePresence = sockY.messages.length;
            await room.webSocketMessage(
                sockG as unknown as WebSocket,
                JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_PRESENCE', intentId: 'pres-1', payload: { presence: 'tab_hidden' } }),
            );
            assert.equal(storageMap.get('seq'), seqBeforePresence);
            assert.equal(sockY.messages.length, yLenBeforePresence, 'CMD_PRESENCE never broadcasts to opponents');
            assert.equal((storageMap.get('state') as GameState).afkStats.green.presence, 'tab_hidden');

            // 2. Manual autopilot toggle disabled
            await room.webSocketMessage(
                sockG as unknown as WebSocket,
                JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_REQUEST_TRUST', intentId: 'bad-trust', payload: { trust: true } }),
            );
            assert.equal(sockG.lastParsed()?.code, 'AUTOPILOT_MANUAL_DISABLED');

            // 3. Green misses 12s cast timer -> enters Tier-1 (1/5, 10m window since match < 5m), rolls, and schedules ai_move (3-5s)
            sockG.messages = [];
            sockY.messages = [];
            t.mock.timers.tick(TURN_TIMERS.castMs + 50);
            await room.alarm();

            const afterTimeoutState = storageMap.get('state') as GameState;
            assert.equal(afterTimeoutState.afkStats.green.mode, 'afk_random_bot');
            assert.equal(afterTimeoutState.afkStats.green.afkTriggers, 1);
            assert.equal(afterTimeoutState.afkStats.green.afkWindowMs, 10 * 60_000);
            assert.equal(afterTimeoutState.afkStats.green.isKicked, false);

            // Check stealth masking over delta frames: Green receives its own AFK stats & TURN_TIMEOUT; Yellow sees neutral mask + no TURN_TIMEOUT!
            const gDelta = sockG.allParsed().find((m) => m.t === 'delta')!;
            const gPatchAfk = (gDelta.patch as { afkStats: GameState['afkStats'] }).afkStats;
            assert.equal(gPatchAfk.green.afkTriggers, 1);
            assert.equal((gDelta.events as Array<Record<string, unknown>>).some((e) => e.type === 'TURN_TIMEOUT'), true);

            const yDelta = sockY.allParsed().find((m) => m.t === 'delta')!;
            const yPatchAfk = (yDelta.patch as { afkStats: GameState['afkStats'] }).afkStats;
            assert.equal(yPatchAfk.green.isAutoPlaying, false, 'opponent must not see Tier-1 AFK status');
            assert.equal(yPatchAfk.green.afkTriggers, 0);
            assert.equal((yDelta.events as Array<Record<string, unknown>>).some((e) => e.type === 'TURN_TIMEOUT'), false, 'opponent never sees TURN_TIMEOUT');

            // 4. Advance match past 10m afk_expire -> Green permanently kicked with afk_timeout + added to forfeitedWallets
            t.mock.timers.tick(10 * 60_000 + 100);
            await room.alarm();

            const kickedState = storageMap.get('state') as GameState;
            assert.equal(kickedState.afkStats.green.isKicked, true);
            assert.equal(kickedState.afkStats.green.mode, 'kicked_smart_bot');
            assert.equal(kickedState.afkStats.green.kickReason, 'afk_timeout');
            assert.ok((kickedState.forfeitedWallets || []).includes(walletG));

            // Green cannot roll, move, or reclaim after kick
            await room.webSocketMessage(
                sockG as unknown as WebSocket,
                JSON.stringify({ v: 1, t: 'intent', kind: 'REQUEST_ROLL', intentId: 'kicked-roll' }),
            );
            assert.equal(sockG.lastParsed()?.code, 'SEAT_KICKED');

            // 5. Disconnect grace on Yellow: drop for 5s -> Tier-1 disconnect trigger
            await room.webSocketClose(sockY as unknown as WebSocket, 1000, 'drop');
            connectedSockets = connectedSockets.filter((s) => s !== sockY);
            t.mock.timers.tick(AFK_DISCONNECT_GRACE_MS + 50);
            await room.alarm();

            const afterYDrop = storageMap.get('state') as GameState;
            assert.equal(afterYDrop.afkStats.yellow.mode, 'afk_random_bot');
            assert.equal(afterYDrop.afkStats.yellow.presence, 'disconnected');
            // Match was > 10m old (< 15m) when Yellow disconnected -> 6 min window!
            assert.equal(afterYDrop.afkStats.yellow.afkWindowMs, 6 * 60_000);
        } finally {
            globalThis.fetch = originalFetch;
            t.mock.timers.reset();
        }
    });

    it('enforces shape-specific CMD_LEAVE_MATCH rules for 1v1, 2v2, and 4P', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const url = String(input);
            if (url.includes('/rest/v1/sessions')) {
                const tokenHash = url.match(/token_hash=eq\.([a-f0-9]+)/)?.[1] || '';
                const seatMap: Record<string, { wallet: string; color: string }> = {
                    [await hashToken('leave-g')]: { wallet: '0x1111111111111111111111111111111111111111', color: 'green' },
                    [await hashToken('leave-b')]: { wallet: '0x3333333333333333333333333333333333333333', color: 'blue' },
                };
                const match = seatMap[tokenHash];
                return new Response(
                    JSON.stringify(match ? [{ wallet_address: match.wallet, scope: 'match', match_id: 'm-leave', seat_color: match.color, expires_at: null, idle_expires_at: null }] : []),
                    { status: 200 },
                );
            }
            if (url.includes('/rest/v1/rpc/match_commit_action')) {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
        };

        try {
            const makeRoom = async (shape: '1v1' | '2v2' | '4P') => {
                const cc = assignCornersForShape(shape);
                const state: GameState = {
                    ...structuredClone(INITIAL_GAME_STATE),
                    matchId: 'm-leave',
                    playerCount: shape,
                    status: 'playing',
                    isStarted: true,
                    currentPlayer: 'red',
                    initialBoardConfig: {
                        colorCorner: cc,
                        players: [
                            { name: 'G', level: 1, avatar: '', color: 'green', position: 'bottom-left', walletAddress: '0x1111111111111111111111111111111111111111' },
                            { name: 'B', level: 1, avatar: '', color: 'blue', position: 'top-right', walletAddress: '0x3333333333333333333333333333333333333333' },
                            { name: 'R', level: 1, avatar: '', color: 'red', position: 'top-left', walletAddress: '0x4444444444444444444444444444444444444444' },
                            { name: 'Y', level: 1, avatar: '', color: 'yellow', position: 'bottom-right', walletAddress: '0x2222222222222222222222222222222222222222' },
                        ],
                    },
                };
                const storageMap = new Map<string, unknown>([
                    ['matchId', 'm-leave'],
                    ['seq', 0],
                    ['state', state],
                ]);
                const sockets: AfkMockSocket[] = [];
                const room = new MatchRoomCore({
                    storage: {
                        get: async <T = unknown>(k: string) => storageMap.get(k) as T | undefined,
                        put: async (k: string, v: unknown) => { storageMap.set(k, v); },
                    },
                    getWebSockets: () => sockets as unknown as WebSocket[],
                    acceptWebSocket: (ws: unknown) => { sockets.push(ws as AfkMockSocket); },
                } as never, {
                    NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
                    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
                });
                const connect = async (ticket: string) => {
                    const sock = new AfkMockSocket();
                    (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
                        0 = new AfkMockSocket();
                        1 = sock;
                    };
                    await room.fetch(new Request('https://ludobase.com/api/room/m-leave/ws', { headers: { Upgrade: 'websocket' } }));
                    await room.webSocketMessage(sock as unknown as WebSocket, JSON.stringify({ v: 1, t: 'join', token: ticket, as: 'seat' }));
                    return sock;
                };
                return { room, storageMap, connect };
            };

            // 1v1: leaving awards immediate win to opposing seated color
            const r1 = await makeRoom('1v1');
            const s1 = await r1.connect('leave-g');
            await r1.room.webSocketMessage(s1 as unknown as WebSocket, JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_LEAVE_MATCH', intentId: 'l1' }));
            const st1 = r1.storageMap.get('state') as GameState;
            assert.equal(st1.status, 'finished');
            assert.equal(st1.winner, 'yellow');
            assert.ok(st1.forfeitedWallets?.includes('0x1111111111111111111111111111111111111111'));

            // 2v2: 1st teammate leaving keeps match running; 2nd teammate leaving ends match cleanly for Team 2
            const r2 = await makeRoom('2v2');
            const s2g = await r2.connect('leave-g');
            const s2b = await r2.connect('leave-b');
            await r2.room.webSocketMessage(s2g as unknown as WebSocket, JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_LEAVE_MATCH', intentId: 'l2g' }));
            const st2a = r2.storageMap.get('state') as GameState;
            assert.equal(st2a.winner, null);
            assert.equal(st2a.afkStats.green.mode, 'left_forfeited');

            await r2.room.webSocketMessage(s2b as unknown as WebSocket, JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_LEAVE_MATCH', intentId: 'l2b' }));
            const st2b = r2.storageMap.get('state') as GameState;
            assert.equal(st2b.status, 'finished');
            assert.equal(st2b.winner, 'Team 2');
            assert.deepEqual(st2b.winners, ['red', 'yellow']);

            // 4P: leaving records forfeit and replaces seat seamlessly while match continues
            const r4 = await makeRoom('4P');
            const s4g = await r4.connect('leave-g');
            await r4.room.webSocketMessage(s4g as unknown as WebSocket, JSON.stringify({ v: 1, t: 'intent', kind: 'CMD_LEAVE_MATCH', intentId: 'l4g' }));
            const st4 = r4.storageMap.get('state') as GameState;
            assert.equal(st4.status, 'playing');
            assert.equal(st4.winner, null);
            assert.equal(st4.afkStats.green.mode, 'left_forfeited');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('routes 100% of kicked/forfeited prize shares to treasury while protecting clean 2v2 teammates', () => {
        const w1 = '0x1111111111111111111111111111111111111111';
        const w2 = '0x2222222222222222222222222222222222222222';

        // 1v1 kicked winner's Tier-2 bot won 1st -> 100% to treasury
        const singleForfeit = resolveSettledPayoutShares({
            winnerWallets: [w1],
            forfeitedWallets: [w1],
            matchShape: '1v1',
        });
        assert.deepEqual(singleForfeit.winners, [ARENA_TREASURY_WALLET]);
        assert.deepEqual(singleForfeit.sharesBps, [10000]);
        assert.equal(singleForfeit.divertedSharesBps, 10000);

        // 2v2: w1 kicked, w2 played legitimately -> w2 keeps 5000 bps, w1's 5000 bps goes to treasury
        const split2v2 = resolveSettledPayoutShares({
            winnerWallets: [w1, w2],
            forfeitedWallets: [w1],
            matchShape: '2v2',
        });
        assert.deepEqual(split2v2.winners, [ARENA_TREASURY_WALLET, w2]);
        assert.deepEqual(split2v2.sharesBps, [5000, 5000]);

        // 2v2: BOTH teammates kicked -> merges duplicate treasury recipient to a single 10000 bps entry
        const bothForfeit = resolveSettledPayoutShares({
            winnerWallets: [w1, w2],
            forfeitedWallets: [w1, w2],
            matchShape: '2v2',
        });
        assert.deepEqual(bothForfeit.winners, [ARENA_TREASURY_WALLET]);
        assert.deepEqual(bothForfeit.sharesBps, [10000]);
        assert.equal(bothForfeit.divertedSharesBps, 10000);

        // Clean 2v2 -> untouched 50/50 split
        const clean2v2 = resolveSettledPayoutShares({
            winnerWallets: [w1, w2],
            forfeitedWallets: [],
            matchShape: '2v2',
        });
        assert.deepEqual(clean2v2.winners, [w1, w2]);
        assert.deepEqual(clean2v2.sharesBps, [5000, 5000]);
        assert.equal(clean2v2.divertedSharesBps, 0);
    });
});
