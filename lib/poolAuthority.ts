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

/** MatchPool.PoolShape. Must stay in sync with contracts/src/MatchPool.sol. */
export const POOL_SHAPE = {
    OneVsOne: 0,
    TwoVsTwo: 1,
    FourPlayer: 2,
} as const;

export interface PoolSummary {
    status: number;
    maxSeats: number;
    filledSeats: number;
    /** Declared pool shape (ECO-08). Authoritative for the payout split. */
    shape: number;
    /** Next settle nonce (SEC-04b). Read from chain, never derived. */
    settleNonce: bigint;
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
            number | bigint, number | bigint, number | bigint, number | bigint, string,
            bigint, bigint, bigint, bigint, bigint, bigint, bigint,
        ];
        return {
            status: Number(res[0]),
            maxSeats: Number(res[1]),
            filledSeats: Number(res[2]),
            shape: Number(res[3]),
            authority: getAddress(res[4]),
            entryFee: res[5],
            gross: res[6],
            prizeFund: res[7],
            hostBond: res[8],
            settleBy: res[9],
            claimUnlockAt: res[10],
            settleNonce: res[11],
        };
    } catch {
        // Deliberately opaque: a revert here means the pool is unknown or the RPC
        // is unreachable, and the distinction is not useful to a caller.
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
 * Independent of the nonce: `settlePool` sets `status = Settled`, so a terminal
 * pool has already consumed its nonce and signing another digest for it would
 * only produce an on-chain revert.
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

/**
 * The settle nonce to sign over.
 *
 * SEC-04b. This used to return a hardcoded `1`, justified by the pool having a
 * non-terminal status. It is now read from the chain via getPoolSummary, so the
 * server never signs a digest the contract will reject because it guessed the
 * counter wrong.
 */
export function settleNonceFor(summary: PoolSummary): bigint {
    return summary.settleNonce;
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
    // ECO-08: the split is chosen by the pool's DECLARED shape, read from the
    // chain. It used to be inferred from seat colours, which is wrong for 4P:
    // the lobby seats 4P as green,red,yellow,blue, so the top-2 can be colours
    // {1,4} — the exact pair the contract treated as teammates — and a 4P
    // podium was paid 50/50. "auto" previously always resolved to "team", which
    // made the 75/25 podium unreachable without an explicit override.
    const shape = summary.shape;
    if (shape !== POOL_SHAPE.OneVsOne && shape !== POOL_SHAPE.TwoVsTwo && shape !== POOL_SHAPE.FourPlayer) {
        throw new PoolAuthorityError(`unknown pool shape ${shape}`, 502);
    }
    const teamShape = shape === POOL_SHAPE.TwoVsTwo;
    if (shape === POOL_SHAPE.OneVsOne && split !== "auto") {
        throw new PoolAuthorityError(`split override is meaningless for a 1v1 pool`, 400);
    }
    if (split === "team" && !teamShape) {
        throw new PoolAuthorityError(
            `team split requested for a ${shape === POOL_SHAPE.FourPlayer ? "4P" : "1v1"} pool`,
            400,
        );
    }
    if (split === "podium" && teamShape) {
        throw new PoolAuthorityError("podium split requested for a 2v2 pool", 400);
    }

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

    // Shape decides; an explicit split that contradicts it already threw above.
    if (teamShape) {
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
