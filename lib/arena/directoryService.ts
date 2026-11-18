/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceDb } from '@/lib/serverAuth';
import { getClanTagsForWallets } from '@/lib/clan/clanService';
import {
    getArenaWagerTier,
    maxSeatsForShape,
    type ArenaBetWindowStatus,
    type ArenaDirectoryResponse,
    type ArenaDirectoryRoom,
    type ArenaGameMode,
    type ArenaMatchShape,
    type ArenaPlayerSeat,
} from './types';

export interface RawPlayerRow {
    wallet_address: string;
    username?: string | null;
    avatar_url?: string | null;
    rank_tier?: string | null;
    rxp?: number | null;
    total_wins?: number | null;
    total_games?: number | null;
}

export interface RawQueueRow {
    player_id: string;
    game_mode: string;
    match_type: string;
    wager: number | string;
    room_code?: string | null;
    created_at: string;
}

export interface RawRoomShoutRow {
    room_code: string;
    content?: string | null;
    username?: string | null;
    avatar_url?: string | null;
    sender_id?: string | null;
    room_open?: boolean | null;
    created_at: string;
}

export interface RawLiveMatchRow {
    match_id: string;
    room_code: string;
    bet_window_status: string;
    current_bet_type?: string | null;
    spectator_count: number;
    host_address?: string | null;
    created_at: string;
    matches?: {
        game_mode?: string | null;
        participants?: string[] | null;
        total_bet_volume?: number | null;
        streaming_enabled?: boolean | null;
        metadata?: Record<string, any> | null;
    } | null;
}

function normalizeGameMode(raw?: string | null): ArenaGameMode {
    return raw?.toLowerCase() === 'power' ? 'power' : 'classic';
}

function normalizeMatchShape(raw?: string | null, participantCount?: number): ArenaMatchShape {
    const s = (raw || '').toLowerCase();
    if (s === '1v1' || s === '2' || s === '2p') return '1v1';
    if (s === '2v2') return '2v2';
    if (s === '4p' || s === '4') return '4P';
    if (participantCount === 2) return '1v1';
    return '4P';
}

function shortUserLabel(wallet: string, username?: string | null): string {
    if (username && !username.startsWith('0x') && username.trim().length > 0) {
        return username.trim();
    }
    return `${wallet.slice(0, 6)}...${wallet.slice(-3)}`;
}

function hydrateSeat(
    wallet: string,
    seatIndex: number,
    isHost: boolean,
    playerMap: Map<string, RawPlayerRow>,
    clanTagMap: Record<string, string>,
    fallbackName?: string | null,
    fallbackAvatar?: string | null,
): ArenaPlayerSeat {
    const key = wallet.toLowerCase();
    const p = playerMap.get(key);
    return {
        walletAddress: key,
        username: shortUserLabel(key, p?.username ?? fallbackName),
        avatarUrl: p?.avatar_url ?? fallbackAvatar ?? null,
        clanTag: clanTagMap[key] ?? null,
        rankTier: p?.rank_tier ?? null,
        rxp: Number(p?.rxp || 0),
        wins: Number(p?.total_wins || 0),
        totalGames: Number(p?.total_games || 0),
        isHost,
        seatIndex,
    };
}

/**
 * Pure aggregator building unified open + live ArenaDirectoryRoom[] cards
 * with zero internal auth secrets exposed.
 */
export function buildArenaDirectoryResponse(params: {
    queueRows: RawQueueRow[];
    shoutRows: RawRoomShoutRow[];
    liveMatchRows: RawLiveMatchRow[];
    playerRows: RawPlayerRow[];
    clanTags: Record<string, string>;
    nowIso?: string;
}): ArenaDirectoryResponse {
    const { queueRows, shoutRows, liveMatchRows, playerRows, clanTags } = params;
    const playerMap = new Map<string, RawPlayerRow>();
    for (const p of playerRows) {
        if (p?.wallet_address) {
            playerMap.set(p.wallet_address.toLowerCase(), p);
        }
    }

    const rooms: ArenaDirectoryRoom[] = [];
    const seenRoomCodes = new Set<string>();

    // 1. Live Matchmaking Queues -> grouped into joinable room cards
    const queueGroups = new Map<string, RawQueueRow[]>();
    for (const q of queueRows) {
        if (!q?.player_id) continue;
        const mode = normalizeGameMode(q.game_mode);
        const shape = normalizeMatchShape(q.match_type);
        const wager = Math.max(0, Number(q.wager || 0));
        const code = q.room_code?.trim().toUpperCase() || '';
        const groupKey = code ? `party:${code}` : `pool:${mode}:${shape}:${wager}`;
        const list = queueGroups.get(groupKey) || [];
        // Deduplicate same player in same group
        if (!list.some((x) => x.player_id.toLowerCase() === q.player_id.toLowerCase())) {
            list.push(q);
            queueGroups.set(groupKey, list);
        }
    }

    for (const [groupKey, group] of queueGroups.entries()) {
        const head = group[0];
        const gameMode = normalizeGameMode(head.game_mode);
        const matchShape = normalizeMatchShape(head.match_type);
        const wager = Math.max(0, Number(head.wager || 0));
        const maxSeats = maxSeatsForShape(matchShape);
        const roomCode = head.room_code?.trim().toUpperCase() || null;
        if (roomCode) seenRoomCodes.add(roomCode);

        // If group has > maxSeats queued players, slice to maxSeats - 1 filled + 1 open slot visually
        const visiblePlayers = group.slice(0, Math.max(1, maxSeats - 1));
        const seats = visiblePlayers.map((row, idx) =>
            hydrateSeat(row.player_id, idx, idx === 0, playerMap, clanTags),
        );

        const metricWager = wager;
        rooms.push({
            id: groupKey,
            kind: 'open',
            joinMode: roomCode ? 'party' : 'pool',
            roomCode,
            matchId: null,
            gameMode,
            matchShape,
            wager,
            totalBetVolume: 0,
            betWindowStatus: 'closed',
            spectatorCount: 0,
            streamingEnabled: true,
            maxSeats,
            seats,
            isPrivate: false,
            createdAt: head.created_at,
            tier: getArenaWagerTier(metricWager),
            summaryText:
                group.length > 1
                    ? `${group.length} searching in pool`
                    : 'Waiting for challenger',
        });
    }

    // 2. Open Hosted Room Broadcasts (from live_chat)
    for (const shout of shoutRows) {
        const code = shout.room_code?.trim().toUpperCase();
        if (!code || shout.room_open === false || seenRoomCodes.has(code)) continue;
        seenRoomCodes.add(code);

        const content = (shout.content || '').trim();
        const lower = content.toLowerCase();
        const gameMode: ArenaGameMode = lower.includes('power') ? 'power' : 'classic';
        const matchShape: ArenaMatchShape = lower.includes('1v1')
            ? '1v1'
            : lower.includes('2v2')
              ? '2v2'
              : '4P';
        const maxSeats = maxSeatsForShape(matchShape);

        // Parse stake from content if formatted like "500K" / "1.5M" / "10,000"
        let parsedWager = 0;
        const wagerMatch = content.match(/(\d+(?:\.\d+)?)\s*(k|m)\b/i);
        if (wagerMatch) {
            const num = parseFloat(wagerMatch[1]);
            const mult = wagerMatch[2].toLowerCase() === 'm' ? 1_000_000 : 1_000;
            if (Number.isFinite(num)) parsedWager = Math.round(num * mult);
        }

        const seats: ArenaPlayerSeat[] = shout.sender_id
            ? [
                  hydrateSeat(
                      shout.sender_id,
                      0,
                      true,
                      playerMap,
                      clanTags,
                      shout.username,
                      shout.avatar_url,
                  ),
              ]
            : [];

        rooms.push({
            id: `shout:${code}`,
            kind: 'open',
            joinMode: 'party',
            roomCode: code,
            matchId: null,
            gameMode,
            matchShape,
            wager: parsedWager,
            totalBetVolume: 0,
            betWindowStatus: 'closed',
            spectatorCount: 0,
            streamingEnabled: true,
            maxSeats,
            seats,
            isPrivate: false,
            createdAt: shout.created_at,
            tier: getArenaWagerTier(parsedWager),
            summaryText: content || `Open Room #${code}`,
        });
    }

    // 3. Active In-Progress Matches (Spectate + Bet)
    for (const lm of liveMatchRows) {
        const m = lm.matches;
        if (!m || m.streaming_enabled === false) continue;
        const code = lm.room_code?.trim().toUpperCase();
        if (!code) continue;

        const meta = (m.metadata || {}) as Record<string, any>;
        const rawParticipants = Array.isArray(m.participants) ? m.participants : [];
        const matchShape = normalizeMatchShape(meta.matchType || meta.match_type, rawParticipants.length);
        const maxSeats = maxSeatsForShape(matchShape);
        const gameMode = normalizeGameMode(m.game_mode);
        const wager = Math.max(0, Number(meta.entryFee ?? meta.wager ?? 0));
        const totalBetVolume = Math.max(0, Number(m.total_bet_volume || 0));
        const hostWallet = lm.host_address?.toLowerCase() || '';

        const seats: ArenaPlayerSeat[] = rawParticipants
            .slice(0, maxSeats)
            .map((wallet, idx) =>
                hydrateSeat(
                    wallet,
                    idx,
                    hostWallet ? wallet.toLowerCase() === hostWallet : idx === 0,
                    playerMap,
                    clanTags,
                ),
            );

        const rawWindow = (lm.bet_window_status || 'closed') as ArenaBetWindowStatus;
        const metricWager = Math.max(wager, totalBetVolume);

        rooms.push({
            id: `live:${lm.match_id}`,
            kind: 'live',
            joinMode: 'watch',
            roomCode: code,
            matchId: lm.match_id,
            gameMode,
            matchShape,
            wager,
            totalBetVolume,
            betWindowStatus: rawWindow,
            currentBetType: lm.current_bet_type ?? null,
            spectatorCount: Math.max(0, Number(lm.spectator_count || 0)),
            streamingEnabled: Boolean(m.streaming_enabled ?? true),
            maxSeats,
            seats,
            isPrivate: false,
            createdAt: lm.created_at,
            tier: getArenaWagerTier(metricWager),
            summaryText: null,
        });
    }

    // Sort: VIP/High-stake & Bet-Open & Open Joinable up top, newest fallback
    rooms.sort((a, b) => {
        const aBet = a.betWindowStatus === 'open' ? 1 : 0;
        const bBet = b.betWindowStatus === 'open' ? 1 : 0;
        if (aBet !== bBet) return bBet - aBet;
        const aKind = a.kind === 'open' ? 1 : 0;
        const bKind = b.kind === 'open' ? 1 : 0;
        if (aKind !== bKind) return bKind - aKind;
        const aStake = Math.max(a.wager, a.totalBetVolume);
        const bStake = Math.max(b.wager, b.totalBetVolume);
        if (aStake !== bStake) return bStake - aStake;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const openCount = rooms.filter((r) => r.kind === 'open').length;
    const liveCount = rooms.filter((r) => r.kind === 'live').length;
    const watchingTotal = rooms.reduce((acc, r) => acc + r.spectatorCount, 0);
    const volumeTotal = rooms.reduce((acc, r) => acc + r.totalBetVolume, 0);

    return {
        rooms,
        stats: { openCount, liveCount, watchingTotal, volumeTotal },
        updatedAt: params.nowIso || new Date().toISOString(),
    };
}

/**
 * Server-side query orchestrator for GET /api/live-arena/directory.
 */
export async function fetchArenaDirectory(): Promise<ArenaDirectoryResponse> {
    const db = serviceDb() as any;
    const nowIso = new Date().toISOString();
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const [queueRes, shoutRes, liveRes] = await Promise.all([
        db
            .from('matchmaking_queue')
            .select('player_id, game_mode, match_type, wager, room_code, created_at')
            .eq('status', 'searching')
            .gt('expires_at', nowIso)
            .order('created_at', { ascending: false })
            .limit(60),
        db
            .from('live_chat')
            .select('room_code, content, username, avatar_url, sender_id, room_open, created_at')
            .not('room_code', 'is', null)
            .eq('room_open', true)
            .gt('created_at', tenMinsAgo)
            .order('created_at', { ascending: false })
            .limit(20),
        db
            .from('live_matches')
            .select(`
                match_id, room_code, bet_window_status, current_bet_type, spectator_count, host_address, created_at,
                matches!inner (game_mode, participants, total_bet_volume, streaming_enabled, metadata)
            `)
            .eq('matches.streaming_enabled', true)
            .order('spectator_count', { ascending: false })
            .limit(25),
    ]);

    const queueRows = (queueRes.data || []) as RawQueueRow[];
    const shoutRows = (shoutRes.data || []) as RawRoomShoutRow[];
    const liveMatchRows = (liveRes.data || []) as RawLiveMatchRow[];

    const walletSet = new Set<string>();
    for (const q of queueRows) if (q.player_id) walletSet.add(q.player_id.toLowerCase());
    for (const s of shoutRows) if (s.sender_id) walletSet.add(s.sender_id.toLowerCase());
    for (const l of liveMatchRows) {
        if (l.host_address) walletSet.add(l.host_address.toLowerCase());
        for (const p of l.matches?.participants || []) {
            if (p) walletSet.add(p.toLowerCase());
        }
    }

    const wallets = Array.from(walletSet);
    let playerRows: RawPlayerRow[] = [];
    const clanTags: Record<string, string> = {};

    if (wallets.length > 0) {
        const [playersRes, tagsRes] = await Promise.all([
            db
                .from('players')
                .select('wallet_address, username, avatar_url, rank_tier, rxp, total_wins, total_games')
                .in('wallet_address', wallets),
            getClanTagsForWallets(wallets).catch(() => ({})),
        ]);
        playerRows = (playersRes.data || []) as RawPlayerRow[];
        for (const [wallet, info] of Object.entries(tagsRes || {})) {
            if (info && typeof info === 'object' && 'tag' in info && typeof info.tag === 'string') {
                clanTags[wallet.toLowerCase()] = info.tag;
            }
        }
    }

    return buildArenaDirectoryResponse({
        queueRows,
        shoutRows,
        liveMatchRows,
        playerRows,
        clanTags,
        nowIso,
    });
}
