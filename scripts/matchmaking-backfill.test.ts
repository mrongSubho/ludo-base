import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MatchRoomCore } from '../src/room/MatchRoomCore';
import { CORNER_SLOTS } from '../lib/boardLayout';
import type { GameState } from '../lib/types';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('Wave 4 migration defines seat_kind, drops 7-arg hybrid overload, and adds p_slots_needed + p_party_wallets', () => {
    const sql = read('supabase/migrations/202611270001_wave4_matchmaking_and_seat_kind.sql');

    assert.match(sql, /^[\s\S]*BEGIN;/);
    assert.match(sql, /COMMIT;[\s\S]*$/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS seat_kind text NOT NULL DEFAULT 'human'\s*CHECK\s*\(seat_kind IN \('human',\s*'bot'\)\)/i);
    assert.match(sql, /DROP FUNCTION IF EXISTS public\.join_matchmaking_hybrid\(text,\s*text,\s*text,\s*numeric,\s*numeric,\s*numeric,\s*text\)/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.join_matchmaking_hybrid\([\s\S]*p_slots_needed int default null[\s\S]*p_party_wallets text\[\] default null/i);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.join_matchmaking_hybrid\(text,\s*text,\s*text,\s*numeric,\s*numeric,\s*numeric,\s*text,\s*int,\s*text\[\]\) FROM PUBLIC, anon, authenticated/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.join_matchmaking_hybrid\(text,\s*text,\s*text,\s*numeric,\s*numeric,\s*numeric,\s*text,\s*int,\s*text\[\]\) TO service_role/i);
});

test('pools route filters out expired searching tickets and join route forwards hybrid party args + quick mode', () => {
    const poolsSrc = read('app/api/matchmaking/pools/route.ts');
    assert.match(poolsSrc, /\.eq\('status',\s*'searching'\)/);
    assert.match(poolsSrc, /\.gt\('expires_at',\s*new Date\(\)\.toISOString\(\)\)/);

    const joinSrc = read('app/api/matchmaking/join/route.ts');
    assert.match(joinSrc, /ALLOWED_MODES\s*=\s*new Set\(\['classic',\s*'power',\s*'quick'\]\)/);
    assert.match(joinSrc, /p_slots_needed/);
    assert.match(joinSrc, /p_party_wallets/);
});

test('backfill-bots route enforces free-only guards (no wagers, ranked, clanWar, or active vault stakes)', () => {
    const src = read('app/api/matchmaking/backfill-bots/route.ts');

    assert.match(src, /requireSessionWallet/);
    assert.match(src, /requireAppSession/);
    assert.match(src, /wager\s*>\s*0\s*\|\|\s*body\.ranked\s*===\s*true\s*\|\|\s*body\.clanWar\s*===\s*true/);
    assert.match(src, /arena_match_stakes/);
    assert.match(src, /status:\s*403/);
    assert.match(src, /code:\s*'BOT_BACKFILL_FREE_ONLY'/);
    assert.match(src, /host_proven:\s*false/);
    assert.match(src, /seat_kind:\s*idx\s*<\s*humanWallets\.length\s*\?\s*'human'\s*:\s*'bot'/);

    // Triple route registration
    assert.match(read('scripts/check-routes.mjs'), /'matchmaking\/backfill-bots'/);
    assert.match(read('lib/routeAuthority.ts'), /'matchmaking\/backfill-bots'/);
    const rl = read('lib/rateLimitRoutes.ts');
    assert.match(rl, /'matchmaking\/backfill-bots':\s*\{\s*limit:\s*10,\s*windowMs:\s*60_000/);
    assert.match(rl, /SESSION_GATED[\s\S]*'matchmaking\/backfill-bots'/);
});

test('PlayerInfoRow badges AI seats and QuickMatchPanel restricts server AI backfill to free queues', () => {
    const infoRow = read('app/components/PlayerInfoRow.tsx');
    assert.match(infoRow, /data-testid="ai-seat-badge"/);
    assert.match(infoRow, /player\.isAi/);

    const qmPanel = read('app/components/QuickMatchPanel.tsx');
    assert.match(qmPanel, /activeWager === 0/);
    assert.match(qmPanel, /\/api\/matchmaking\/backfill-bots/);
    assert.match(qmPanel, /Fill with \[AI\]/);
});

test('MatchRoomCore S3 self-seed hydrates seat_kind=bot with isAi=true and Quick mode initial positions', async () => {
    const matchId = 'eeeeeeee-1111-2222-3333-444444444444';
    const humanWallet = '0x1111111111111111111111111111111111111111';
    const originalFetch = globalThis.fetch;

    try {
        globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const url = String(input);
            if (url.includes('/rest/v1/matches?')) {
                return new Response(
                    JSON.stringify([
                        {
                            match_shape: '1v1',
                            game_mode: 'quick',
                            metadata: { botBackfill: true, unranked: true, botDifficulty: 'master' },
                        },
                    ]),
                    { status: 200 },
                );
            }
            if (url.includes('/rest/v1/match_seats?')) {
                return new Response(
                    JSON.stringify([
                        { color: 'green', wallet_address: humanWallet, seat_index: 0, seat_kind: 'human' },
                        { color: 'yellow', wallet_address: 'bot:1', seat_index: 1, seat_kind: 'bot' },
                    ]),
                    { status: 200 },
                );
            }
            if (url.includes('/rest/v1/rpc/match_commit_action')) {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            return new Response(JSON.stringify([]), { status: 200 });
        };

        const storageMap = new Map<string, unknown>([['matchId', matchId]]);
        const mockCtx = {
            storage: {
                get: async <T = unknown>(k: string) => storageMap.get(k) as T | undefined,
                put: async (k: string, v: unknown) => {
                    storageMap.set(k, v);
                },
                setAlarm: async () => {},
            },
            getWebSockets: () => [],
            acceptWebSocket: () => {},
        };

        const room = new MatchRoomCore(mockCtx as never, {
            NEXT_PUBLIC_SUPABASE_URL: 'https://test-supabase.mock',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        });

        await room.fetch(new Request(`https://ludobase.com/api/room/${matchId}/ws?matchId=${matchId}`, {
            method: 'GET',
        }));

        const state = storageMap.get('state') as GameState | undefined;
        assert.ok(state, 'MatchRoomCore should self-seed state from matches + match_seats');
        assert.equal(state.isBotMatch, false);
        assert.equal(state.botDifficulty, 'master');
        assert.equal(state.gameMode, 'quick');

        const players = state.initialBoardConfig?.players || [];
        const greenPlayer = players.find((p) => p.color === 'green');
        const yellowBot = players.find((p) => p.color === 'yellow');
        assert.equal(greenPlayer?.isAi, false);
        assert.equal(yellowBot?.isAi, true);

        const cc = state.initialBoardConfig!.colorCorner;
        assert.deepEqual(state.positions.green, [CORNER_SLOTS[cc.green].startIdx, -1, 57, 57]);
        assert.deepEqual(state.positions.yellow, [CORNER_SLOTS[cc.yellow].startIdx, -1, 57, 57]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
