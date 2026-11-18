import type {
    ArenaDirectoryRoom,
    ArenaGameMode,
    ArenaMatchShape,
    ArenaPlayerSeat,
} from './types';
import { getArenaWagerTier, maxSeatsForShape } from './types';

export interface DemoExhibitionConfig {
    arenaKey: 'power4p-ai' | 'vip-classic-1v1' | 'apex-power-2v2';
    roomCode: string;
    title: string;
    gameMode: ArenaGameMode;
    matchShape: ArenaMatchShape;
    wager: number;
    defaultBetVolume: number;
    summaryText: string;
    bots: Array<{
        walletAddress: string;
        username: string;
        clanTag: string | null;
        rankTier: string;
        rxp: number;
        wins: number;
        totalGames: number;
    }>;
}

export const DEMO_EXHIBITIONS: readonly DemoExhibitionConfig[] = [
    {
        arenaKey: 'apex-power-2v2',
        roomCode: 'ARENA-APEX-2V2',
        title: 'APEX 2v2 AI Exhibition',
        gameMode: 'power',
        matchShape: '2v2',
        wager: 5_000_000,
        defaultBetVolume: 250_000,
        summaryText: 'Live AI 2v2 Power Squad clash · Spectate & Winner Bet active',
        bots: [
            { walletAddress: 'ai-green', username: 'Bot Zeus', clanTag: 'APEX', rankTier: 'Master', rxp: 9800, wins: 64, totalGames: 90 },
            { walletAddress: 'ai-blue', username: 'Bot Hera', clanTag: 'APEX', rankTier: 'Diamond', rxp: 8400, wins: 51, totalGames: 80 },
            { walletAddress: 'ai-red', username: 'Bot Ares', clanTag: 'SYND', rankTier: 'Master', rxp: 9100, wins: 59, totalGames: 88 },
            { walletAddress: 'ai-yellow', username: 'Bot Nyx', clanTag: 'SYND', rankTier: 'Platinum', rxp: 6900, wins: 41, totalGames: 74 },
        ],
    },
    {
        arenaKey: 'vip-classic-1v1',
        roomCode: 'ARENA-VIP-DUEL',
        title: 'VIP 1v1 Classic AI Duel',
        gameMode: 'classic',
        matchShape: '1v1',
        wager: 1_500_000,
        defaultBetVolume: 120_000,
        summaryText: 'High-stakes 1v1 AI Duel · Watch live turns & bet winner',
        bots: [
            { walletAddress: 'ai-green', username: 'Bot Magnus', clanTag: 'VIP', rankTier: 'Diamond', rxp: 7600, wins: 48, totalGames: 70 },
            { walletAddress: 'ai-yellow', username: 'Bot Solis', clanTag: '3077', rankTier: 'Gold', rxp: 5200, wins: 33, totalGames: 62 },
        ],
    },
    {
        arenaKey: 'power4p-ai',
        roomCode: 'ARENA-POWER-4P',
        title: '4P Power AI Arena',
        gameMode: 'power',
        matchShape: '4P',
        wager: 100_000,
        defaultBetVolume: 45_000,
        summaryText: '24/7 AI Power 4P exhibition · Live tiles, captures & winner bets',
        bots: [
            { walletAddress: 'ai-green', username: 'Bot Nova', clanTag: 'LUDO', rankTier: 'Gold', rxp: 4100, wins: 29, totalGames: 55 },
            { walletAddress: 'ai-red', username: 'Bot Apex', clanTag: 'CORE', rankTier: 'Gold', rxp: 3900, wins: 25, totalGames: 50 },
            { walletAddress: 'ai-yellow', username: 'Bot Vex', clanTag: 'LUDO', rankTier: 'Silver', rxp: 2400, wins: 19, totalGames: 44 },
            { walletAddress: 'ai-blue', username: 'Bot Orion', clanTag: 'CORE', rankTier: 'Silver', rxp: 2100, wins: 16, totalGames: 40 },
        ],
    },
] as const;

export function getDemoExhibitionByRoomCode(roomCode?: string | null): DemoExhibitionConfig | null {
    if (!roomCode) return null;
    const upper = roomCode.trim().toUpperCase();
    return DEMO_EXHIBITIONS.find((d) => upper === d.roomCode || upper.startsWith(`${d.roomCode}-`)) ?? null;
}

export function getDemoExhibitionByKey(arenaKey?: string | null): DemoExhibitionConfig | null {
    if (!arenaKey) return null;
    return DEMO_EXHIBITIONS.find((d) => d.arenaKey === arenaKey) ?? null;
}

function makeBotSeats(bots: DemoExhibitionConfig['bots']): ArenaPlayerSeat[] {
    return bots.map((b, idx) => ({
        walletAddress: b.walletAddress,
        username: b.username,
        avatarUrl: null,
        clanTag: b.clanTag,
        rankTier: b.rankTier,
        rxp: b.rxp,
        wins: b.wins,
        totalGames: b.totalGames,
        isHost: idx === 0,
        seatIndex: idx,
    }));
}

/**
 * Ready-to-play joinable AI exhibition rooms + watchable/bettable AI Arena rooms.
 * Real DB rooms with matching roomCodes automatically merge/override stale stats.
 */
export function buildDemoArenaRooms(existingRooms: ArenaDirectoryRoom[]): ArenaDirectoryRoom[] {
    const existingByArenaKey = new Map<DemoExhibitionConfig['arenaKey'], ArenaDirectoryRoom>();
    for (const r of existingRooms) {
        const matched = getDemoExhibitionByRoomCode(r.roomCode);
        if (!matched) continue;
        const prev = existingByArenaKey.get(matched.arenaKey);
        if (!prev || (r.betWindowStatus === 'open' && prev.betWindowStatus !== 'open')) {
            existingByArenaKey.set(matched.arenaKey, r);
        }
    }

    const demoRooms: ArenaDirectoryRoom[] = [];
    const nowIso = new Date().toISOString();

    // 1. Joinable instant AI matches (Free, 500K VIP, 1.5M VIP)
    const joinableDemos: Array<{
        id: string;
        gameMode: ArenaGameMode;
        matchShape: ArenaMatchShape;
        wager: number;
        summaryText: string;
        bots: DemoExhibitionConfig['bots'];
    }> = [
        {
            id: 'demo-join:vip-1v1-500k',
            gameMode: 'classic',
            matchShape: '1v1',
            wager: 500_000,
            summaryText: 'AI Skirmish Table · Tap [+] or Join to duel Bot Vanguard now',
            bots: [
                { walletAddress: 'ai-bot-vanguard', username: 'Bot Vanguard', clanTag: 'VGD', rankTier: 'Diamond', rxp: 6800, wins: 44, totalGames: 68 },
            ],
        },
        {
            id: 'demo-join:vip-2v2-1m5',
            gameMode: 'power',
            matchShape: '2v2',
            wager: 1_500_000,
            summaryText: 'AI Squad Skirmish · Claim the 4th seat & launch 2v2 Power match',
            bots: [
                { walletAddress: 'ai-bot-atlas', username: 'Bot Atlas', clanTag: '3077', rankTier: 'Master', rxp: 8900, wins: 57, totalGames: 84 },
                { walletAddress: 'ai-bot-vega', username: 'Bot Vega', clanTag: '3077', rankTier: 'Gold', rxp: 4500, wins: 31, totalGames: 59 },
                { walletAddress: 'ai-bot-nexus', username: 'Bot Nexus', clanTag: 'NEX', rankTier: 'Platinum', rxp: 6100, wins: 38, totalGames: 65 },
            ],
        },
        {
            id: 'demo-join:free-4p',
            gameMode: 'power',
            matchShape: '4P',
            wager: 0,
            summaryText: 'Free AI Warmup Arena · Jump straight into a 4P Power match',
            bots: [
                { walletAddress: 'ai-bot-rook', username: 'Bot Rook', clanTag: 'FREE', rankTier: 'Silver', rxp: 1850, wins: 14, totalGames: 34 },
                { walletAddress: 'ai-bot-echo', username: 'Bot Echo', clanTag: null, rankTier: 'Bronze', rxp: 920, wins: 9, totalGames: 26 },
            ],
        },
    ];

    for (const d of joinableDemos) {
        demoRooms.push({
            id: d.id,
            kind: 'open',
            joinMode: 'ai_match',
            roomCode: null,
            matchId: null,
            gameMode: d.gameMode,
            matchShape: d.matchShape,
            wager: d.wager,
            totalBetVolume: 0,
            betWindowStatus: 'closed',
            spectatorCount: 0,
            streamingEnabled: false,
            maxSeats: maxSeatsForShape(d.matchShape),
            seats: makeBotSeats(d.bots),
            isPrivate: false,
            isDemoAi: true,
            createdAt: nowIso,
            tier: getArenaWagerTier(d.wager),
            summaryText: d.summaryText,
        });
    }

    // 2. Watchable & Bettable AI Exhibition matches
    for (const ex of DEMO_EXHIBITIONS) {
        const dbLive = existingByArenaKey.get(ex.arenaKey);
        if (dbLive) {
            // Hydrate clean bot display names + enable winner bet showcase on DB-backed exhibition
            demoRooms.push({
                ...dbLive,
                wager: dbLive.wager > 0 ? dbLive.wager : ex.wager,
                betWindowStatus: dbLive.betWindowStatus === 'open' ? 'open' : 'closed',
                currentBetType: dbLive.currentBetType || 'winner',
                totalBetVolume: dbLive.totalBetVolume > 0 ? dbLive.totalBetVolume : ex.defaultBetVolume,
                seats: dbLive.seats.length > 0 ? dbLive.seats : makeBotSeats(ex.bots),
                tier: getArenaWagerTier(Math.max(dbLive.wager, ex.wager)),
                isDemoAi: true,
                summaryText: ex.summaryText,
            });
        } else {
            demoRooms.push({
                id: `demo-watch:${ex.arenaKey}`,
                kind: 'live',
                joinMode: 'watch',
                roomCode: ex.roomCode,
                matchId: null,
                gameMode: ex.gameMode,
                matchShape: ex.matchShape,
                wager: ex.wager,
                totalBetVolume: ex.defaultBetVolume,
                betWindowStatus: 'open',
                currentBetType: 'winner',
                spectatorCount: 1,
                streamingEnabled: true,
                maxSeats: maxSeatsForShape(ex.matchShape),
                seats: makeBotSeats(ex.bots),
                isPrivate: false,
                isDemoAi: true,
                createdAt: nowIso,
                tier: getArenaWagerTier(ex.wager),
                summaryText: ex.summaryText,
            });
        }
    }

    return demoRooms;
}
