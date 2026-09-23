/**
 * Prize payout plans for MatchPool.settlePool.
 *
 * Locked product rules:
 * - 1v1: winner 100%
 * - 2v2: two teammates 50-50 (floor + dust to lower seat index)
 * - 4P top-2 podium: 1st 75%, 2nd 25% (remainder exact)
 * - 4P single winner: 100%
 *
 * Amounts are CHIPS wei (1e18). Contract enforces sum == prizeFund and
 * 2v2 team pair + equal split; 4P 75/25 is enforced when winners are not
 * a TEAM_PAIRINGS pair.
 */
import type { Address } from "viem";
import type { PayoutEntry } from "./chipsSettle";

export type MatchShape = "1v1" | "2v2" | "4P";

export interface RankedWinner {
    addr: Address;
    /** 1 = 1st place. */
    rank: number;
    /** Optional 1-based seat index for dust tie-break; lower wins dust. */
    seatIndex?: number;
}

function dustToFirst(prizeFund: bigint, amounts: bigint[], order: number[]): bigint[] {
    const out = amounts.slice();
    const sum = out.reduce((a, b) => a + b, BigInt(0));
    const extra = prizeFund - sum;
    if (extra > BigInt(0)) {
        let firstPos = 0;
        for (let i = 1; i < order.length; i++) {
            if (order[i] < order[firstPos]) firstPos = i;
        }
        out[firstPos] = out[firstPos] + extra;
    }
    return out;
}

/**
 * Build settle payout plan from ranked winners.
 * Winners sorted by rank ascending (1 first). Invalid shapes throw.
 */
export function buildPayoutPlan(args: {
    shape: MatchShape;
    prizeFund: bigint;
    winners: RankedWinner[];
}): PayoutEntry[] {
    const { shape, prizeFund, winners } = args;
    if (prizeFund <= BigInt(0)) throw new Error("prizeFund must be > 0");
    if (!winners.length) throw new Error("winners required");
    const ranked = [...winners].sort(
        (a, b) => a.rank - b.rank || (a.seatIndex ?? 99) - (b.seatIndex ?? 99),
    );
    const order = ranked.map((w, i) => w.seatIndex ?? i + 1);

    if (ranked.length === 1) {
        return [{ addr: ranked[0].addr, amount: prizeFund }];
    }

    if (shape === "1v1") {
        throw new Error("1v1 needs exactly one winner");
    }

    if (shape === "2v2") {
        if (ranked.length !== 2) throw new Error("2v2 needs both teammates as winners");
        const half = prizeFund / BigInt(2);
        const amounts = dustToFirst(prizeFund, [half, half], order);
        return [
            { addr: ranked[0].addr, amount: amounts[0] },
            { addr: ranked[1].addr, amount: amounts[1] },
        ];
    }

    // 4P podium top-2: 75% / 25%
    if (ranked.length === 2) {
        const first = (prizeFund * BigInt(75)) / BigInt(100);
        const second = prizeFund - first;
        return [
            { addr: ranked[0].addr, amount: first },
            { addr: ranked[1].addr, amount: second },
        ];
    }

    throw new Error(`Unsupported 4P winner count: ${ranked.length} (use 1 or 2)`);
}

/** Display share for UI rows. */
export function payoutShareLabel(shape: MatchShape, rank: number, winnerCount: number): string {
    if (winnerCount <= 1) return "100%";
    if (shape === "2v2") return "50%";
    if (shape === "4P") {
        if (rank === 1) return "75%";
        if (rank === 2) return "25%";
    }
    return "—";
}
