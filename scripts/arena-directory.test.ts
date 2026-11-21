import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatArenaChips, getArenaWagerTier, ARENA_WAGER_PRESETS } from '../lib/arena/types';
import { buildArenaDirectoryResponse } from '../lib/arena/directoryService';
import { buildDemoArenaRooms, getDemoExhibitionByRoomCode } from '../lib/arena/demoArenas';

test('arena directory: full-spectrum wager tiers cover Free through 10M without level gating', () => {
    assert.deepEqual(
        [...ARENA_WAGER_PRESETS],
        [0, 500, 1_000, 10_000, 100_000, 500_000, 1_000_000, 3_000_000, 5_000_000, 10_000_000],
    );

    assert.equal(formatArenaChips(0), 'Free');
    assert.equal(formatArenaChips(500_000), '500K');
    assert.equal(formatArenaChips(3_000_000), '3M');
    assert.equal(formatArenaChips(5_000_000), '5M');
    assert.equal(formatArenaChips(10_000_000), '10M');

    assert.equal(getArenaWagerTier(0).label, 'FREE');
    assert.equal(getArenaWagerTier(10_000).label, 'ARENA');
    assert.equal(getArenaWagerTier(100_000).label, 'HEATED');
    assert.equal(getArenaWagerTier(500_000).label, 'VIP');
    assert.equal(getArenaWagerTier(3_000_000).isVip, true);
    assert.equal(getArenaWagerTier(5_000_000).label, 'APEX');
    assert.equal(getArenaWagerTier(10_000_000).isVip, true);
});

test('arena directory: builds open pools, room shouts, and live matches with hydrated seats and zero secret leakage', () => {
    const res = buildArenaDirectoryResponse({
        queueRows: [
            {
                player_id: '0xAlice0000000000000000000000000000000001',
                game_mode: 'power',
                match_type: '2v2',
                wager: 3_000_000,
                room_code: null,
                created_at: '2026-11-18T10:00:00Z',
            },
            {
                player_id: '0xBob00000000000000000000000000000000002',
                game_mode: 'power',
                match_type: '2v2',
                wager: 3_000_000,
                room_code: null,
                created_at: '2026-11-18T10:01:00Z',
            },
        ],
        shoutRows: [
            {
                room_code: 'VIP777',
                content: 'Power · 1v1 · 5M · 1/2 · join',
                username: 'KingCharlie',
                avatar_url: 'https://example.com/c.png',
                sender_id: '0xCharlie0000000000000000000000000000003',
                room_open: true,
                created_at: '2026-11-18T10:02:00Z',
            },
        ],
        liveMatchRows: [
            {
                match_id: 'm-live-1',
                room_code: 'LIVE88',
                bet_window_status: 'open',
                spectator_count: 14,
                host_address: '0xdave0000000000000000000000000000000004',
                created_at: '2026-11-18T09:55:00Z',
                matches: {
                    game_mode: 'classic',
                    participants: [
                        '0xdave0000000000000000000000000000000004',
                        '0xeve00000000000000000000000000000000005',
                    ],
                    total_bet_volume: 500_000,
                    streaming_enabled: true,
                    metadata: { matchType: '1v1', entryFee: 500_000 },
                },
            },
        ],
        playerRows: [
            {
                wallet_address: '0xalice0000000000000000000000000000000001',
                username: 'Alice',
                avatar_url: null,
                rank_tier: 'Gold',
                rxp: 2400,
                total_wins: 12,
                total_games: 20,
            },
        ],
        clanTags: {
            '0xalice0000000000000000000000000000000001': '3077',
            '0xdave0000000000000000000000000000000004': 'SYND',
        },
        nowIso: '2026-11-18T10:05:00Z',
    });

    assert.equal(res.stats.openCount, 2);
    assert.equal(res.stats.liveCount, 1);
    assert.equal(res.stats.watchingTotal, 14);
    assert.equal(res.stats.volumeTotal, 500_000);

    // Betting-open live match floats to the top
    assert.equal(res.rooms[0].kind, 'live');
    assert.equal(res.rooms[0].roomCode, 'LIVE88');
    assert.equal(res.rooms[0].tier.label, 'VIP');
    assert.equal(res.rooms[0].seats[0].clanTag, 'SYND');
    assert.equal(res.rooms[0].seats[0].isHost, true);

    const openShout = res.rooms.find((r) => r.roomCode === 'VIP777');
    assert.ok(openShout);
    assert.equal(openShout.wager, 5_000_000);
    assert.equal(openShout.tier.label, 'APEX');
    assert.equal(openShout.matchShape, '1v1');
    assert.equal(openShout.maxSeats, 2);
    assert.equal(openShout.seats[0].username, 'KingCharlie');

    const openPool = res.rooms.find((r) => r.joinMode === 'pool');
    assert.ok(openPool);
    assert.equal(openPool.wager, 3_000_000);
    assert.equal(openPool.matchShape, '2v2');
    assert.equal(openPool.maxSeats, 4);
    assert.equal(openPool.seats.length, 2);
    assert.equal(openPool.seats[0].clanTag, '3077');
    assert.equal(openPool.seats[0].rxp, 2400);

    // Ensure directory route source never selects validation_token or join_secret_hash
    const routeSrc = readFileSync(
        join(process.cwd(), 'lib/arena/directoryService.ts'),
        'utf8',
    );
    assert.equal(routeSrc.includes('validation_token'), false);
    assert.equal(routeSrc.includes('join_secret_hash'), false);
    assert.equal(routeSrc.includes('arena_key'), false);
});

test('arena directory: functional demo AI cards include joinable tables and watchable/bettable exhibitions', () => {
    const emptyDemo = buildDemoArenaRooms([]);
    const joinable = emptyDemo.filter((r) => r.joinMode === 'ai_match');
    const watchable = emptyDemo.filter((r) => r.joinMode === 'watch');

    assert.equal(joinable.length, 3);
    assert.equal(watchable.length, 3);
    assert.ok(joinable.every((r) => r.kind === 'open' && r.isDemoAi === true && r.seats.length < r.maxSeats));
    assert.ok(
        watchable.every(
            (r) =>
                r.kind === 'live' &&
                r.isDemoAi === true &&
                r.streamingEnabled === true &&
                r.betWindowStatus === 'open' &&
                r.currentBetType === 'winner' &&
                Boolean(r.roomCode),
        ),
    );

    // Suffixed restarted exhibition roomCodes match back cleanly to their exhibition config & hydrate without duplication
    const matchedSuffixed = getDemoExhibitionByRoomCode('ARENA-VIP-DUEL-9X2K');
    assert.ok(matchedSuffixed);
    assert.equal(matchedSuffixed.arenaKey, 'vip-classic-1v1');

    const withDbRow = buildDemoArenaRooms([
        {
            ...watchable[1],
            id: 'db-match-id',
            matchId: 'db-match-id',
            roomCode: 'ARENA-VIP-DUEL-9X2K',
            spectatorCount: 9,
            totalBetVolume: 750_000,
        },
    ]);
    const vipMerged = withDbRow.find((r) => r.roomCode === 'ARENA-VIP-DUEL-9X2K');
    assert.ok(vipMerged);
    assert.equal(vipMerged.spectatorCount, 9);
    assert.equal(vipMerged.totalBetVolume, 750_000);
    assert.equal(withDbRow.filter((r) => r.joinMode === 'watch').length, 3);

    const arenaRouteSrc = readFileSync(
        join(process.cwd(), 'app/api/live-arena/power4p/route.ts'),
        'utf8',
    );
    assert.equal(arenaRouteSrc.includes('validation_token'), false);
    assert.equal(arenaRouteSrc.includes('join_secret_hash'), false);
});
