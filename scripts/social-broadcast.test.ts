import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashToken } from '../lib/sessionV2';
import { ROOM_PROTOCOL_VERSION } from '../lib/roomProtocol';
import { MatchRoomCore } from '../src/room/MatchRoomCore';

class MockWebSocket {
    public messages: string[] = [];
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
        this.readyState = 3;
    }

    parsed(): Array<Record<string, unknown>> {
        return this.messages.map((m) => JSON.parse(m) as Record<string, unknown>);
    }
}

test('MatchRoomCore handles guest/host t=social frames, stamps color, filters profanity, and enforces rate/role limits', async () => {
    const matchId = '22222222-3333-4444-5555-666666666666';
    const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const walletB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const walletSpec = '0xdddddddddddddddddddddddddddddddddddddddd';
    const ticketA = 'ticket-social-a';
    const ticketB = 'ticket-social-b';
    const ticketSpec = 'ticket-social-spec';
    const [hashA, hashB, hashSpec] = await Promise.all([
        hashToken(ticketA),
        hashToken(ticketB),
        hashToken(ticketSpec),
    ]);

    const mockDbSessions = new Map<string, { wallet_address: string; scope: string; match_id: string; seat_color?: string }>([
        [hashA, { wallet_address: walletA, scope: 'match', match_id: matchId, seat_color: 'green' }],
        [hashB, { wallet_address: walletB, scope: 'match', match_id: matchId, seat_color: 'yellow' }],
        [hashSpec, { wallet_address: walletSpec, scope: 'spectator', match_id: matchId }],
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.includes('/rest/v1/match_states')) {
            return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/rest/v1/matches')) {
            return new Response(JSON.stringify([{ match_shape: '1v1', game_mode: 'classic' }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (url.includes('/rest/v1/match_seats')) {
            return new Response(
                JSON.stringify([
                    { color: 'green', wallet_address: walletA, seat_index: 0 },
                    { color: 'yellow', wallet_address: walletB, seat_index: 1 },
                ]),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
        }
        if (url.includes('/rest/v1/sessions')) {
            const m = url.match(/token_hash=eq\.([a-f0-9]+)/);
            const row = m?.[1] ? mockDbSessions.get(m[1]) : undefined;
            return new Response(
                JSON.stringify(row ? [{ ...row, expires_at: new Date(Date.now() + 60_000).toISOString() }] : []),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
        }
        if (url.includes('/rest/v1/rpc/match_commit_action')) {
            return new Response(JSON.stringify({ ok: true, seq: 0 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response('Not found', { status: 404 });
    };

    try {
        const storageMap = new Map<string, unknown>();
        const connectedSockets: MockWebSocket[] = [];
        const mockCtx = {
            storage: {
                get: async (k: string) => storageMap.get(k),
                put: async (k: string, v: unknown) => {
                    storageMap.set(k, v);
                },
                delete: async (k: string) => {
                    storageMap.delete(k);
                },
                setAlarm: async () => {},
            },
            getWebSockets: () => connectedSockets as unknown as WebSocket[],
            acceptWebSocket: (ws: unknown) => {
                connectedSockets.push(ws as MockWebSocket);
            },
        };

        const room = new MatchRoomCore(mockCtx as never, {
            NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        });

        const sockA = new MockWebSocket();
        const sockB = new MockWebSocket();
        const sockSpec = new MockWebSocket();

        for (const [sock, ticket] of [
            [sockA, ticketA],
            [sockB, ticketB],
            [sockSpec, ticketSpec],
        ] as const) {
            (globalThis as unknown as Record<string, unknown>).WebSocketPair = class {
                0 = new MockWebSocket();
                1 = sock;
            };
            await room.fetch(
                new Request(`https://ludobase.com/api/room/${matchId}/ws?ticket=${ticket}`, {
                    headers: { Upgrade: 'websocket' },
                }),
            );
        }

        // 1. Guest (yellow) sends CHAT pretending to be green with profanity
        await room.webSocketMessage(
            sockB as unknown as WebSocket,
            JSON.stringify({
                v: ROOM_PROTOCOL_VERSION,
                t: 'social',
                socialType: 'CHAT',
                payload: { text: 'fuck that roll, classic move', color: 'green' },
            }),
        );

        const chatOnA = sockA.parsed().find((m) => m.t === 'social' && m.socialType === 'CHAT');
        assert.ok(chatOnA, 'Host sockA must receive guest CHAT broadcast');
        assert.equal(chatOnA.fromColor, 'yellow');
        const chatPayload = chatOnA.payload as Record<string, unknown>;
        assert.equal(chatPayload.color, 'yellow');
        assert.equal(chatPayload.text, '**** that roll, classic move');
        assert.equal(
            sockB.parsed().some((m) => m.t === 'social' && m.socialType === 'CHAT'),
            false,
            'Sender socket must not receive echo duplicate',
        );
        assert.ok(
            sockSpec.parsed().some((m) => m.t === 'social' && m.socialType === 'CHAT'),
            'Spectator receives seat social reactions',
        );

        // 2. Guest throws a projectile toward green (attempting to spoof fromColor)
        await room.webSocketMessage(
            sockB as unknown as WebSocket,
            JSON.stringify({
                v: ROOM_PROTOCOL_VERSION,
                t: 'social',
                socialType: 'PROJECTILE',
                payload: { projectileId: 'emp-bomb', fromColor: 'red', toColor: 'green' },
            }),
        );

        const projOnA = sockA.parsed().find((m) => m.t === 'social' && m.socialType === 'PROJECTILE');
        assert.ok(projOnA, 'Host sockA must receive PROJECTILE broadcast');
        assert.equal((projOnA.payload as Record<string, unknown>).fromColor, 'yellow');
        assert.equal((projOnA.payload as Record<string, unknown>).toColor, 'green');

        // 3. Reaction cooldown triggers RATE_LIMITED when guest bursts EMOTE < 800ms after PROJECTILE
        await room.webSocketMessage(
            sockB as unknown as WebSocket,
            JSON.stringify({
                v: ROOM_PROTOCOL_VERSION,
                t: 'social',
                socialType: 'EMOTE',
                payload: { emoteId: 'gl' },
            }),
        );
        const rateRej = sockB.parsed().find((m) => m.t === 'rejected' && m.code === 'RATE_LIMITED');
        assert.ok(rateRej, 'Rapid reaction inside 800ms cooldown must be RATE_LIMITED');

        // 4. Spectator cannot emit t='social' frames
        await room.webSocketMessage(
            sockSpec as unknown as WebSocket,
            JSON.stringify({
                v: ROOM_PROTOCOL_VERSION,
                t: 'social',
                socialType: 'EMOTE',
                payload: { emoteId: 'gl' },
            }),
        );
        const specRej = sockSpec.parsed().find((m) => m.t === 'rejected' && m.code === 'NOT_AUTHORIZED');
        assert.ok(specRej, 'Spectator social frame must fail with NOT_AUTHORIZED');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('Client social broadcast, CyberStickers normalization, and IP packs cleanup invariants', () => {
    const root = process.cwd();
    const ctxSrc = readFileSync(join(root, 'hooks/TeamUpContext.tsx'), 'utf8');
    const bcastIdx = ctxSrc.indexOf('const broadcastSocial = useCallback');
    assert.ok(bcastIdx > 0, 'broadcastSocial must exist in TeamUpContext');
    const bcastBlock = ctxSrc.slice(bcastIdx, ctxSrc.indexOf('const lastSocialAtRef') === -1 ? bcastIdx + 1200 : bcastIdx + 1400);
    assert.doesNotMatch(bcastBlock, /if\s*\(!isHost\)\s*return/);

    const boardSrc = readFileSync(join(root, 'app/components/Board.tsx'), 'utf8');
    assert.doesNotMatch(boardSrc, /broadcastAction\(\s*'(?:EMOTE|CHAT|REMATCH)'/);
    assert.match(boardSrc, /broadcastSocial\('EMOTE'/);
    assert.match(boardSrc, /broadcastSocial\('CHAT'/);
    assert.match(boardSrc, /broadcastSocial\('REMATCH'/);
    assert.match(boardSrc, /broadcastSocial\('PROJECTILE'/);

    const pageSrc = readFileSync(join(root, 'app/page.tsx'), 'utf8');
    assert.match(pageSrc, /broadcastSocial\('REMATCH'/);

    const packs = JSON.parse(readFileSync(join(root, 'public/emotes/packs.json'), 'utf8')) as Array<{ id: string }>;
    assert.equal(packs.some((p) => p.id === 'pepe' || p.id === 'uma'), false);

    const stickerSrc = readFileSync(join(root, 'app/components/emotes/CyberStickers.tsx'), 'utf8');
    assert.match(stickerSrc, /normalizeStickerId/);
    assert.match(stickerSrc, /useReducedMotion/);
});
