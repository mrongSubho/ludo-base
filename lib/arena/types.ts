import { ENTRY_FEE_TIER_NAMES } from '../entryFeeDial';

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
    id:
        | 'scout'
        | 'spark'
        | 'strike'
        | 'pulse'
        | 'surge'
        | 'blitz'
        | 'titan'
        | 'nova'
        | 'omega'
        | 'apex';
    label: string;
    isVip: boolean;
    accentColor: string;
}

export function getArenaWagerTier(wager: number): ArenaTierInfo {
    if (wager >= 10_000_000) {
        return { id: 'apex', label: ENTRY_FEE_TIER_NAMES[10_000_000], isVip: true, accentColor: '#f43f5e' };
    }
    if (wager >= 5_000_000) {
        return { id: 'omega', label: ENTRY_FEE_TIER_NAMES[5_000_000], isVip: true, accentColor: '#ec4899' };
    }
    if (wager >= 3_000_000) {
        return { id: 'nova', label: ENTRY_FEE_TIER_NAMES[3_000_000], isVip: true, accentColor: '#fb7185' };
    }
    if (wager >= 1_000_000) {
        return { id: 'titan', label: ENTRY_FEE_TIER_NAMES[1_000_000], isVip: true, accentColor: '#fb923c' };
    }
    if (wager >= 500_000) {
        return { id: 'blitz', label: ENTRY_FEE_TIER_NAMES[500_000], isVip: true, accentColor: '#f59e0b' };
    }
    if (wager >= 100_000) {
        return { id: 'surge', label: ENTRY_FEE_TIER_NAMES[100_000], isVip: false, accentColor: '#22c55e' };
    }
    if (wager >= 10_000) {
        return { id: 'pulse', label: ENTRY_FEE_TIER_NAMES[10_000], isVip: false, accentColor: '#00e5ff' };
    }
    if (wager >= 1_000) {
        return { id: 'strike', label: ENTRY_FEE_TIER_NAMES[1_000], isVip: false, accentColor: '#06b6d4' };
    }
    if (wager > 0) {
        return { id: 'spark', label: ENTRY_FEE_TIER_NAMES[500], isVip: false, accentColor: '#38bdf8' };
    }
    return { id: 'scout', label: ENTRY_FEE_TIER_NAMES[0], isVip: false, accentColor: '#64748b' };
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
