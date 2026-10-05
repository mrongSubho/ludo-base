/**
 * Server-side pool authority for MatchPool co-signing.
 *
 * Why this exists
 * ---------------
 * `MatchPool.settlePool` and `MatchPool.submitAbandon` have **no `msg.sender`
 * authorization** — anyone may call them. The only thing standing between an
 * anonymous caller and a wagered pool is that the digest carries an `edgeSig`
 * from the trusted edge signer:
 *
 *   settlePool:   if (!modeB) { _verifyHost(d, hostSig, p.authority) }
 *                if (_recover(d, edgeSig) != edgeSigner) revert BadSignature();
 *   submitAbandon: requires only edgeSig
 *
 * So the edge co-signature *is* the authorization. That means the security of
 * both paths is decided entirely by who can obtain an edge signature — which
 * is what this module and its two callers enforce. No contract change is
 * required to close SEC-03/SEC-04.
 *
 * A signature obtained for one digest cannot be reused for another: the digest
 * commits to (poolId, payoutPlan, deadline, nonce, authority), `nonce` is
 * single-use (`p.settleNonce += 1`), and settlement sets `status = Settled`.
 *
 * Everything value-bearing is read from the chain via `getPoolSummary`, never
 * from the request body. The `chips_*` tables are an indexer cache and may lag
 * or be empty, so they are only ever used for non-authoritative enrichment.
 */
import { createPublicClient, http, getAddress, type Address, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { MATCH_POOL_ABI, matchPoolAddress } from "@/lib/chips";
import { parseRequestedChainId } from "@/lib/chipsSettle";
import type { PayoutEntry } from "@/lib/chipsSettle";

/**
 * Abandon evidence thresholds. Sourced from the netcode's own AFK policy so the
 * signed evidence cannot be stricter or looser than the game it describes:
 * hooks/useAFKManager.ts strikes at `totalTriggers >= AFK_STRIKES_REQUIRED`.
 */
export const AFK_STRIKES_REQUIRED = 3;

/** A match whose authoritative state advanced within this window is not stalled. */
export const AFK_STALE_MS = 60_000;

/** MatchPool.Status enum. Must stay in sync with contracts/src/MatchPool.sol:13. */
export const POOL_STATUS = {
    Open: 0,
    Funded: 1,
    Locked: 2,
    Settled: 3,
    Cancelled: 4,
    Expired: 5,
} as const;

export interface PoolSummary {
    status: number;
    maxSeats: number;
    filledSeats: number;
    authority: Address;
    entryFee: bigint;
    gross: bigint;
    prizeFund: bigint;
    hostBond: bigint;
    settleBy: bigint;
    claimUnlockAt: bigint;
}

export class PoolAuthorityError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = "PoolAuthorityError";
    }
}

function clientFor(chainId: number) {
    // Chain is pinned so viem cannot silently read a different network than the
    // one the digest is bound to; the caller already validated chainId.
    const chain = chainId === 8453 ? base : baseSepolia;
    return createPublicClient({ chain, transport: http() });
}

/** Read the on-chain pool. Throws PoolAuthorityError if the pool is unknown. */
export async function readPoolSummary(
    poolId: string,
    chainId: number,
): Promise<PoolSummary> {
    const pool = matchPoolAddress();
    if (!pool) throw new PoolAuthorityError("MatchPool not configured", 503);
    const client = clientFor(chainId);
    try {
        const res = (await client.readContract({
            address: pool,
            abi: MATCH_POOL_ABI,
            functionName: "getPoolSummary",
            args: [poolId as Hex],
        })) as unknown as readonly [
            number | bigint, number | bigint, number | bigint, string,
            bigint, bigint, bigint, bigint, bigint, bigint,
        ];
        return {
            status: Number(res[0]),
            maxSeats: Number(res[1]),
            filledSeats: Number(res[2]),
            authority: getAddress(res[3]),
            entryFee: res[4],
            gross: res[5],
            prizeFund: res[6],
            hostBond: res[7],
            settleBy: res[8],
            claimUnlockAt: res[9],
        };
    } catch (err) {
        throw new PoolAuthorityError(
            `pool ${poolId} unreadable on chain ${chainId}`,
            502,
        );
    }
}

/**
 * The authorization check both handlers were missing.
 *
 * The caller must be the pool authority recorded on-chain. Comparing against
 * the chain (not a body field) is what makes this meaningful — previously
 * `authority` came from the request, so anyone could nominate themselves.
 */
export function requireAuthority(summary: PoolSummary, wallet: string): Address {
    const w = getAddress(wallet);
    if (w.toLowerCase() !== summary.authority.toLowerCase()) {
        throw new PoolAuthorityError("caller is not this pool's authority", 403);
    }
    return summary.authority;
}

/**
 * Reject pools that can no longer be settled or abandoned.
 *
 * `settleNonce` has no public getter, but it is initialised to 1 on create and
 * only ever incremented by `settlePool` itself, which also sets
 * `status = Settled`. So a pool in any non-terminal status has provably never
 * settled and its nonce is 1. Asserting the status makes that assumption
 * self-checking rather than load-bearing.
 */
export function assertSettleable(summary: PoolSummary): void {
    if (summary.status === POOL_STATUS.Settled) {
        throw new PoolAuthorityError("pool already settled", 409);
    }
    if (summary.status === POOL_STATUS.Cancelled || summary.status === POOL_STATUS.Expired) {
        throw new PoolAuthorityError(`pool is terminal (status ${summary.status})`, 409);
    }
    if (summary.status !== POOL_STATUS.Locked) {
        throw new PoolAuthorityError(
            `pool must be Locked to settle (status ${summary.status})`,
            409,
        );
    }
}

/** Nonce for a pool that assertSettleable() has confirmed has never settled. */
export function initialSettleNonce(): bigint {
    return BigInt(1);
}

/**
 * Derive the payout amounts from the on-chain prize fund.
 *
 * The client chooses *who* won; it never chooses *how much*. Amounts are
 * computed here so `sum === prizeFund` by construction and the contract's
 * `SumMismatch` cannot be hit by a fat-fingered or hostile amount.
 *
 * The ratios mirror `_applySettle` (contracts/src/MatchPool.sol:562):
 *   - 2v2 team pair on a 4-seat pool -> exact 50/50, dust to the first seat
 *   - 4P podium on a 4-seat pool     -> 75/25, remainder to second
 *   - single winner (only when the pool is not 4-seat) -> whole fund
 *
 * A single winner is rejected for 4-seat pools on purpose: the contract adds the
 * slashed host bond to a lone winner's credit (MatchPool.sol:609), so allowing
 * one would let the Mode-B caller take 100% of the prize fund *and* the bond.
 */
export function deriveSettlePlan(
    summary: PoolSummary,
    winners: string[],
    split: "team" | "podium" | "auto" = "auto",
): PayoutEntry[] {
    const addrs = winners.map((w) => getAddress(w));
    if (addrs.length === 0) {
        throw new PoolAuthorityError("no winners supplied", 400);
    }
    if (new Set(addrs.map((a) => a.toLowerCase())).size !== addrs.length) {
        throw new PoolAuthorityError("duplicate winner addresses", 400);
    }
    if (summary.prizeFund <= BigInt(0)) {
        throw new PoolAuthorityError("pool has no prize fund", 409);
    }

    const fourSeat = summary.maxSeats === 4;

    if (addrs.length === 1) {
        if (fourSeat) {
            throw new PoolAuthorityError(
                "4-seat pools must settle to 2 winners (a lone winner would also " +
                    "collect the slashed host bond)",
                400,
            );
        }
        return [{ addr: addrs[0], amount: summary.prizeFund }];
    }

    if (fourSeat && addrs.length !== 2) {
        throw new PoolAuthorityError(
            `4-seat pools settle to exactly 2 winners (got ${addrs.length})`,
            400,
        );
    }

    const [a, b] = addrs;

    if (!fourSeat) {
        // Non-4-seat pools are not ratio-checked by the contract; split evenly
        // and push the remainder onto the first entry so the sum is exact.
        const share = summary.prizeFund / BigInt(addrs.length);
        let rest = summary.prizeFund - share * BigInt(addrs.length);
        return addrs.map((addr) => {
            const amount = rest > BigInt(0) ? share + BigInt(1) : share;
            if (rest > BigInt(0)) rest = BigInt(0);
            return { addr, amount };
        });
    }

    const kind = split === "auto" ? "team" : split;
    if (kind === "team") {
        const half = summary.prizeFund / BigInt(2);
        const dust = summary.prizeFund % BigInt(2);
        return [
            { addr: a, amount: half + dust },
            { addr: b, amount: half },
        ];
    }
    const firstDue = (summary.prizeFund * BigInt(75)) / BigInt(100);
    const secondDue = summary.prizeFund - firstDue;
    return [
        { addr: a, amount: firstDue },
        { addr: b, amount: secondDue },
    ];
}

/** Reject a deadline the caller cannot honour, and clamp it to settleBy + grace. */
export function resolveDeadline(
    summary: PoolSummary,
    requested: unknown,
): bigint {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const settleBy = summary.settleBy;
    // Mode B ignores `deadline` entirely, so cap it there rather than letting a
    // caller pin the digest to an arbitrary timestamp.
    const cap = settleBy > now ? settleBy + BigInt(24 * 3600) : settleBy + BigInt(48 * 3600);
    if (requested === undefined || requested === null) return cap;
    let d: bigint;
    try {
        d = BigInt(requested as string | number);
    } catch {
        throw new PoolAuthorityError("deadline is not an integer", 400);
    }
    if (d <= now) throw new PoolAuthorityError("deadline is in the past", 400);
    if (d > cap) throw new PoolAuthorityError("deadline exceeds the settlement window", 400);
    return d;
}

export { parseRequestedChainId };
