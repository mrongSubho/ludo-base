import type {
    AfkPlayerStats,
    ColorCorner,
    GameState,
    KickReason,
    PlayerColor,
    PowerItem,
    PowerType,
} from './types';
import {
    AFK_BOT_MOVE_DELAY_MS,
    AFK_BOT_ROLL_DELAY_MS,
    AFK_DISCONNECT_GRACE_MS,
    AFK_MAX_TRIGGERS,
    AFK_RECLAIM_WINDOWS_MS,
    BOARD_FINISH_INDEX,
    HOME_LANE_START_INDEX,
    TEAM_PAIRINGS,
} from './constants';
import {
    countNukeVictims,
    getLegalTokenIndices,
    resolveControllableColor,
    type EngineGameState,
} from './engine/core';

export {
    AFK_BOT_MOVE_DELAY_MS,
    AFK_BOT_ROLL_DELAY_MS,
    AFK_DISCONNECT_GRACE_MS,
    AFK_MAX_TRIGGERS,
    AFK_RECLAIM_WINDOWS_MS,
};

const ALL_COLORS: readonly PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

/**
 * Dynamic Tier-1 AFK reclaim window scaled by match age at takeover:
 * - < 5m  → 10m
 * - 5–10m →  8m
 * - 10–15m→  6m
 * - >=15m →  5m
 */
export function getAfkReclaimWindowMs(matchElapsedMs: number): number {
    const elapsed = Number.isFinite(matchElapsedMs) ? Math.max(0, matchElapsedMs) : 0;
    if (elapsed < 5 * 60_000) return AFK_RECLAIM_WINDOWS_MS.under5Min;
    if (elapsed < 10 * 60_000) return AFK_RECLAIM_WINDOWS_MS.under10Min;
    if (elapsed < 15 * 60_000) return AFK_RECLAIM_WINDOWS_MS.under15Min;
    return AFK_RECLAIM_WINDOWS_MS.from15Min;
}

/**
 * Humanized bot pacing shared by Tier-1 Random Bot and Tier-2 Smart Bot:
 * - roll phase: 2,000–4,000 ms
 * - move phase: 3,000–5,000 ms
 */
export function sampleHumanizedBotDelayMs(
    phase: 'roll' | 'move',
    rand: () => number = Math.random,
): number {
    const range = phase === 'roll' ? AFK_BOT_ROLL_DELAY_MS : AFK_BOT_MOVE_DELAY_MS;
    const raw = Number(rand());
    const clamped = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : 0;
    return range.min + Math.floor(clamped * (range.max - range.min + 1));
}

export function createDefaultAfkStats(): AfkPlayerStats {
    return {
        mode: 'human',
        isAutoPlaying: false,
        consecutiveTurns: 0,
        totalTriggers: 0,
        afkTriggers: 0,
        isKicked: false,
        afkSinceAt: null,
        afkDeadlineAt: null,
        afkWindowMs: null,
        presence: 'active',
        presenceUpdatedAt: null,
        kickReason: null,
        kickedAt: null,
    };
}

export function createInitialAfkStatsMap(): Record<PlayerColor, AfkPlayerStats> {
    return {
        green: createDefaultAfkStats(),
        red: createDefaultAfkStats(),
        yellow: createDefaultAfkStats(),
        blue: createDefaultAfkStats(),
    };
}

export function normalizeSeatAfkStats(stats?: Partial<AfkPlayerStats> | null): AfkPlayerStats {
    const base = createDefaultAfkStats();
    if (!stats) return base;
    const triggers = Number(stats.afkTriggers ?? stats.totalTriggers ?? 0);
    return {
        ...base,
        ...stats,
        afkTriggers: triggers,
        totalTriggers: triggers,
        mode: stats.mode ?? (stats.isKicked ? 'kicked_smart_bot' : stats.isAutoPlaying ? 'afk_random_bot' : 'human'),
    };
}

export function isSeatPermanentlyLocked(stats?: Partial<AfkPlayerStats> | null): boolean {
    if (!stats) return false;
    return Boolean(
        stats.isKicked ||
            stats.mode === 'kicked_smart_bot' ||
            stats.mode === 'left_forfeited',
    );
}

export function isSeatInTier1Afk(stats?: Partial<AfkPlayerStats> | null): boolean {
    if (!stats || isSeatPermanentlyLocked(stats)) return false;
    return Boolean(stats.mode === 'afk_random_bot' || stats.isAutoPlaying);
}

/**
 * Tier-1 Random / No-Brain Bot token selector.
 * Uses engine-accurate legality and teammate assist rules, then picks uniformly at random.
 */
export function pickTier1RandomMove(
    positions: Record<PlayerColor, number[]>,
    playerId: PlayerColor,
    roll: number,
    colorCorner: ColorCorner,
    playerCount: string = '4P',
    rand: () => number = Math.random,
): { color: PlayerColor; tokenIndex: number } | null {
    const teammate = playerCount === '2v2' ? TEAM_PAIRINGS[playerId] : null;
    const selfFinished = (positions[playerId] || []).every((p) => p === BOARD_FINISH_INDEX);
    const actingColor: PlayerColor =
        playerCount === '2v2' && selfFinished && teammate && ALL_COLORS.includes(teammate)
            ? teammate
            : resolveControllableColor(positions, playerId, playerCount);

    const options = getLegalTokenIndices(positions, actingColor, roll, colorCorner);
    if (options.length === 0) return null;

    const raw = Number(rand());
    const clamped = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : 0;
    const picked = options[Math.floor(clamped * options.length)];
    return { color: actingColor, tokenIndex: picked };
}

/**
 * Tier-1 Random / No-Brain Bot power selector.
 * 50% save rate; when spending, picks a random usable held power and random valid target.
 */
export function pickTier1RandomPower(
    state: GameState,
    color: PlayerColor,
    colorCorner: ColorCorner,
    playerCount: string,
    rand: () => number = Math.random,
    now: number = Date.now(),
): { type: PowerType; tokenIdx?: number } | null {
    if (state.gameMode && state.gameMode !== 'power') return null;
    if (!state.gameMode && (!state.powerTiles || state.powerTiles.length === 0)) return null;
    if (state.powerSpentThisTurn) return null;

    const hand = (state.playerPowers?.[color] ?? []).filter(
        (p): p is PowerItem => Boolean(p && p.type && p.expiresAt > now),
    );
    if (hand.length === 0) return null;

    // 50% chance Tier-1 bot ignores powers and just rolls
    if (rand() < 0.5) return null;

    const candidates: { type: PowerType; tokenIdx?: number }[] = [];
    const tokens = state.positions[color] || [];

    for (const item of hand) {
        if (item.type === 'boost') {
            if (state.activeBoost !== color) {
                candidates.push({ type: 'boost' });
            }
        } else if (item.type === 'shield') {
            const hasOnTrack = tokens.some((pos) => pos >= 0 && pos < HOME_LANE_START_INDEX);
            if (hasOnTrack) {
                candidates.push({ type: 'shield' });
            }
        } else if (item.type === 'teleport') {
            const validIndices = tokens
                .map((pos, idx) => (pos >= 0 && pos < BOARD_FINISH_INDEX ? idx : -1))
                .filter((idx) => idx !== -1);
            if (validIndices.length > 0) {
                const idx = validIndices[Math.floor(Math.min(0.999999999, Math.max(0, rand())) * validIndices.length)];
                candidates.push({ type: 'teleport', tokenIdx: idx });
            }
        } else if (item.type === 'nuke') {
            const validNukes = tokens
                .map((pos, idx) => {
                    if (pos < 0 || pos >= HOME_LANE_START_INDEX) return -1;
                    const { victims } = countNukeVictims(
                        state as unknown as EngineGameState,
                        color,
                        idx,
                        colorCorner,
                        playerCount,
                    );
                    return victims.length > 0 ? idx : -1;
                })
                .filter((idx) => idx !== -1);
            if (validNukes.length > 0) {
                const idx = validNukes[Math.floor(Math.min(0.999999999, Math.max(0, rand())) * validNukes.length)];
                candidates.push({ type: 'nuke', tokenIdx: idx });
            }
        }
    }

    if (candidates.length === 0) return null;
    const pickIdx = Math.floor(Math.min(0.999999999, Math.max(0, rand())) * candidates.length);
    return candidates[pickIdx];
}

export function getKickReasonMessage(reason?: KickReason | null): string {
    switch (reason) {
        case 'afk_limit_5':
            return 'You reached the 5/5 AFK limit in this match.';
        case 'afk_timeout':
            return 'You did not return before your AFK countdown expired.';
        case 'disconnect_timeout':
            return 'You remained disconnected past the reconnect window.';
        case 'explicit_leave':
            return 'You forfeited and left this match.';
        default:
            return 'Your seat was permanently replaced by the smart bot.';
    }
}
