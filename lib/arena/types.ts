export type ArenaGameMode = 'classic' | 'power';
export type ArenaMatchShape = '1v1' | '2v2' | '4P';
export type ArenaRoomKind = 'open' | 'live';
export type ArenaBetWindowStatus = 'open' | 'closed' | 'resolving' | 'settled';

export const ARENA_WAGER_PRESETS = [
    0,
    500,
    1_000,
    10_000,
    100_000,
    500_000,
    1_000_000,
    3_000_000,
    5_000_000,
    10_000_000,
] as const;

export interface ArenaTierInfo {
    id: 'free' | 'casual' | 'heated' | 'vip' | 'apex';
    label: string;
    isVip: boolean;
    accentColor: string;
}

export function getArenaWagerTier(wager: number): ArenaTierInfo {
    if (wager >= 5_000_000) {
        return { id: 'apex', label: 'APEX', isVip: true, accentColor: '#ec4899' };
    }
    if (wager >= 500_000) {
        return { id: 'vip', label: 'VIP', isVip: true, accentColor: '#f59e0b' };
    }
    if (wager >= 50_000) {
        return { id: 'heated', label: 'HEATED', isVip: false, accentColor: '#f97316' };
    }
    if (wager > 0) {
        return { id: 'casual', label: 'ARENA', isVip: false, accentColor: '#22d3ee' };
    }
    return { id: 'free', label: 'FREE', isVip: false, accentColor: '#64748b' };
}

export function formatArenaChips(amount: number): string {
    if (!amount || amount <= 0) return 'Free';
    if (amount >= 1_000_000) {
        const m = amount / 1_000_000;
        return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
    }
    if (amount >= 1_000) {
        const k = amount / 1_000;
        return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
    }
    return amount.toLocaleString();
}

export function maxSeatsForShape(shape: ArenaMatchShape): number {
    return shape === '1v1' ? 2 : 4;
}

export interface ArenaPlayerSeat {
    walletAddress: string;
    username: string;
    avatarUrl: string | null;
    clanTag: string | null;
    rankTier: string | null;
    rxp: number;
    wins: number;
    totalGames: number;
    isHost: boolean;
    seatIndex: number;
}

export interface ArenaDirectoryRoom {
    id: string;
    kind: ArenaRoomKind;
    joinMode: 'pool' | 'party' | 'watch' | 'ai_match';
    roomCode: string | null;
    matchId: string | null;
    gameMode: ArenaGameMode;
    matchShape: ArenaMatchShape;
    wager: number;
    totalBetVolume: number;
    betWindowStatus: ArenaBetWindowStatus;
    currentBetType?: string | null;
    spectatorCount: number;
    streamingEnabled: boolean;
    maxSeats: number;
    seats: ArenaPlayerSeat[];
    isPrivate: boolean;
    isDemoAi?: boolean;
    createdAt: string;
    tier: ArenaTierInfo;
    summaryText?: string | null;
}

export interface ArenaDirectoryResponse {
    rooms: ArenaDirectoryRoom[];
    stats: {
        openCount: number;
        liveCount: number;
        watchingTotal: number;
        volumeTotal: number;
    };
    updatedAt: string;
}
