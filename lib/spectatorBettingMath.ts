import { TEAM_ID, TEAM_PAIRINGS } from '@/lib/constants';
import type { PlayerColor } from '@/lib/types';

export const SPECTATOR_BET_WINDOW_MIN_SEC = 30;
export const SPECTATOR_BET_WINDOW_MAX_SEC = 180;
export const SPECTATOR_BET_WINDOW_DEFAULT_SEC = 90;

export const SPECTATOR_BET_PRESETS = [100, 500, 1_000, 10_000, 100_000] as const;
export const SPECTATOR_BET_MIN_CHIPS = 1;
export const SPECTATOR_BET_MAX_CHIPS = 10_000_000;
export const SPECTATOR_RAKE_BPS = 500; // 5% protocol rake

const PLAYER_COLORS: readonly PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

function isPlayerColor(val: string): val is PlayerColor {
    return (PLAYER_COLORS as readonly string[]).includes(val);
}

/**
 * Clamp betting window duration strictly inside [30s, 180s], defaulting to 90s.
 */
export function clampBetWindowSeconds(sec?: number | null): number {
    if (sec === undefined || sec === null || !Number.isFinite(sec)) {
        return SPECTATOR_BET_WINDOW_DEFAULT_SEC;
    }
    return Math.min(
        SPECTATOR_BET_WINDOW_MAX_SEC,
        Math.max(SPECTATOR_BET_WINDOW_MIN_SEC, Math.round(sec)),
    );
}

/**
 * Compute authoritative open/close ISO timestamps for a fixed spectator betting window.
 */
export function computeBetWindowBounds(
    nowMs: number = Date.now(),
    durationSec?: number | null,
): {
    durationSec: number;
    openedAtMs: number;
    closedAtMs: number;
    windowOpenedAt: string;
    windowClosedAt: string;
} {
    const clampedSec = clampBetWindowSeconds(durationSec);
    const openedAtMs = nowMs;
    const closedAtMs = nowMs + clampedSec * 1000;
    return {
        durationSec: clampedSec,
        openedAtMs,
        closedAtMs,
        windowOpenedAt: new Date(openedAtMs).toISOString(),
        windowClosedAt: new Date(closedAtMs).toISOString(),
    };
}

/**
 * True only when the status is `'open'` and `nowMs` is strictly before `windowClosedAt`.
 */
export function isBetWindowOpen(params: {
    status?: string | null;
    windowClosedAt?: string | number | null;
    nowMs?: number;
}): boolean {
    if (params.status !== 'open') return false;
    if (params.windowClosedAt === null || params.windowClosedAt === undefined) return false;
    const closedMs =
        typeof params.windowClosedAt === 'number'
            ? params.windowClosedAt
            : Date.parse(params.windowClosedAt);
    if (!Number.isFinite(closedMs)) return false;
    const now = params.nowMs ?? Date.now();
    return now < closedMs;
}

/**
 * Normalize a match winner (color, `'Team 1'`, `'Team 2'`, or `0x...` wallet)
 * into all matching lowercase `spectator_bets.bet_value` labels.
 * Uses `TEAM_PAIRINGS` / `TEAM_ID` as the single source of truth for 2v2 teams.
 */
export function resolveWinningBetValues(params: {
    winnerRaw?: string | null;
    matchShape?: string | null;
    playerSeats?: Record<string, { wallet?: string }> | null;
    winnerWallets?: string[];
}): string[] {
    const out = new Set<string>();
    const raw = (params.winnerRaw || '').trim().toLowerCase();
    const is2v2 = params.matchShape === '2v2';

    const addColorWithTeam = (color: PlayerColor) => {
        out.add(color);
        if (is2v2) {
            out.add(TEAM_PAIRINGS[color]);
            out.add(`team ${TEAM_ID[color]}`);
        }
    };

    if (raw === 'team 1' || raw === 'team1' || raw === 'team_1') {
        out.add('team 1');
        out.add('green');
        out.add('blue');
    } else if (raw === 'team 2' || raw === 'team2' || raw === 'team_2') {
        out.add('team 2');
        out.add('red');
        out.add('yellow');
    } else if (isPlayerColor(raw)) {
        addColorWithTeam(raw);
    } else if (raw.startsWith('0x') && params.playerSeats) {
        for (const [seatKey, seatInfo] of Object.entries(params.playerSeats)) {
            const c = seatKey.trim().toLowerCase();
            if (seatInfo?.wallet?.toLowerCase() === raw && isPlayerColor(c)) {
                addColorWithTeam(c);
            }
        }
    }

    if (Array.isArray(params.winnerWallets) && params.playerSeats) {
        const walletSet = new Set(params.winnerWallets.map((w) => w.trim().toLowerCase()));
        for (const [seatKey, seatInfo] of Object.entries(params.playerSeats)) {
            const c = seatKey.trim().toLowerCase();
            if (seatInfo?.wallet && walletSet.has(seatInfo.wallet.toLowerCase()) && isPlayerColor(c)) {
                addColorWithTeam(c);
            }
        }
    }

    return [...out];
}

export interface PariMutuelBetInput {
    id: string;
    playerId: string;
    betValue: string;
    amount: number;
}

export interface PariMutuelPayoutItem {
    id: string;
    playerId: string;
    betValue: string;
    amount: number;
    status: 'won' | 'lost';
    payout: number;
    claimType: 'match_prize' | 'match_refund' | null;
    outcome: 'parimutuel_win' | 'parimutuel_loss' | 'unopposed_refund' | 'house_forfeit';
}

export interface PariMutuelSettlementResult {
    mode: 'parimutuel' | 'unopposed_refund' | 'house_forfeit' | 'empty';
    totalPot: number;
    winningPool: number;
    losingPool: number;
    rake: number;
    netPot: number;
    payouts: PariMutuelPayoutItem[];
}

/**
 * Pure Pari-Mutuel settlement math:
 * - Opposed (`winningPool > 0 && losingPool > 0`):
 *     Losing pool pays winners proportionally after 5% protocol rake.
 *     Rake is capped at `losingPool` so winners never receive less than principal.
 * - Unopposed winners only (`winningPool > 0 && losingPool === 0`):
 *     100% refund (`match_refund`, 0% rake) to Claim Hub.
 * - Unopposed losers only (`winningPool === 0 && losingPool > 0`):
 *     100% forfeited to House Pool (`payout = 0`).
 */
export function calculatePariMutuelSettlement(
    bets: PariMutuelBetInput[],
    winningValues: string[],
    rakeBps: number = SPECTATOR_RAKE_BPS,
): PariMutuelSettlementResult {
    const winSet = new Set(winningValues.map((v) => v.trim().toLowerCase()).filter(Boolean));
    if (bets.length === 0 || winSet.size === 0) {
        return {
            mode: 'empty',
            totalPot: 0,
            winningPool: 0,
            losingPool: 0,
            rake: 0,
            netPot: 0,
            payouts: [],
        };
    }

    let totalPot = 0;
    let winningPool = 0;
    let losingPool = 0;
    const winningBets: PariMutuelBetInput[] = [];
    const losingBets: PariMutuelBetInput[] = [];

    for (const bet of bets) {
        const amt = Math.max(0, Math.floor(Number(bet.amount) || 0));
        if (amt <= 0) continue;
        const normalizedBet = { ...bet, amount: amt };
        totalPot += amt;
        if (winSet.has(bet.betValue.trim().toLowerCase())) {
            winningPool += amt;
            winningBets.push(normalizedBet);
        } else {
            losingPool += amt;
            losingBets.push(normalizedBet);
        }
    }

    if (totalPot <= 0) {
        return {
            mode: 'empty',
            totalPot: 0,
            winningPool: 0,
            losingPool: 0,
            rake: 0,
            netPot: 0,
            payouts: [],
        };
    }

    if (winningPool > 0 && losingPool > 0) {
        const rawRake = Math.floor((totalPot * rakeBps) / 10_000);
        const rake = Math.min(rawRake, losingPool);
        const netPot = totalPot - rake;

        let distributed = 0;
        const payouts: PariMutuelPayoutItem[] = [];

        for (let i = 0; i < winningBets.length; i++) {
            const b = winningBets[i];
            const payout =
                i === winningBets.length - 1
                    ? netPot - distributed
                    : Math.floor((netPot * b.amount) / winningPool);
            distributed += payout;
            payouts.push({
                id: b.id,
                playerId: b.playerId,
                betValue: b.betValue,
                amount: b.amount,
                status: 'won',
                payout,
                claimType: 'match_prize',
                outcome: 'parimutuel_win',
            });
        }

        for (const b of losingBets) {
            payouts.push({
                id: b.id,
                playerId: b.playerId,
                betValue: b.betValue,
                amount: b.amount,
                status: 'lost',
                payout: 0,
                claimType: null,
                outcome: 'parimutuel_loss',
            });
        }

        return {
            mode: 'parimutuel',
            totalPot,
            winningPool,
            losingPool,
            rake,
            netPot,
            payouts,
        };
    }

    if (winningPool > 0 && losingPool === 0) {
        return {
            mode: 'unopposed_refund',
            totalPot,
            winningPool,
            losingPool: 0,
            rake: 0,
            netPot: winningPool,
            payouts: winningBets.map((b) => ({
                id: b.id,
                playerId: b.playerId,
                betValue: b.betValue,
                amount: b.amount,
                status: 'won',
                payout: b.amount,
                claimType: 'match_refund',
                outcome: 'unopposed_refund',
            })),
        };
    }

    return {
        mode: 'house_forfeit',
        totalPot,
        winningPool: 0,
        losingPool,
        rake: losingPool,
        netPot: 0,
        payouts: losingBets.map((b) => ({
            id: b.id,
            playerId: b.playerId,
            betValue: b.betValue,
            amount: b.amount,
            status: 'lost',
            payout: 0,
            claimType: null,
            outcome: 'house_forfeit',
        })),
    };
}

export interface SpectatorPoolSideStats {
    amount: number;
    count: number;
    sharePct: number;
}

export interface SpectatorPoolSummary {
    totalPot: number;
    betCount: number;
    bySide: Record<string, SpectatorPoolSideStats>;
}

/**
 * Aggregate spectator bets per side (`green`, `red`, `yellow`, `blue`, `team 1`, `team 2`).
 * In `2v2`, color bets (`green`/`blue` or `red`/`yellow`) also roll up into `'team 1'` / `'team 2'`
 * while retaining individual keys so both team-level and color-level UIs display accurate pools.
 */
export function computeSpectatorPoolSummary(
    bets: Array<{ bet_value?: string | null; betValue?: string | null; amount?: number | string | null; status?: string | null }>,
    matchShape?: string | null,
): SpectatorPoolSummary {
    const rawTotals = new Map<string, { amount: number; count: number }>();
    let totalPot = 0;
    let betCount = 0;

    const addBucket = (key: string, amt: number) => {
        const cur = rawTotals.get(key) ?? { amount: 0, count: 0 };
        cur.amount += amt;
        cur.count += 1;
        rawTotals.set(key, cur);
    };

    for (const row of bets) {
        if (row.status === 'cancelled' || row.status === 'cashed_out') continue;
        const side = String(row.bet_value ?? row.betValue ?? '').trim().toLowerCase();
        const amt = Math.max(0, Math.floor(Number(row.amount ?? 0)));
        if (!side || amt <= 0) continue;

        totalPot += amt;
        betCount += 1;
        addBucket(side, amt);

        if (matchShape === '2v2' && isPlayerColor(side)) {
            addBucket(`team ${TEAM_ID[side]}`, amt);
        }
    }

    const bySide: Record<string, SpectatorPoolSideStats> = {};
    for (const [key, stats] of rawTotals.entries()) {
        bySide[key] = {
            amount: stats.amount,
            count: stats.count,
            sharePct: totalPot > 0 ? Math.round((stats.amount / totalPot) * 1000) / 10 : 0,
        };
    }

    return { totalPot, betCount, bySide };
}
