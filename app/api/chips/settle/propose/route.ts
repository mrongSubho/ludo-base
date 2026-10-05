import { NextResponse } from "next/server";
import type { Address, Hex } from "viem";
import {
    edgeSign,
    parseRequestedChainId,
    payoutPlanHash,
    settleDigest,
    abandonDigest,
} from "@/lib/chipsSettle";
import { matchPoolAddress } from "@/lib/chips";
import { requireAppSession, serviceDb } from "@/lib/serverAuth";
import {
    AFK_STALE_MS,
    AFK_STRIKES_REQUIRED,
    POOL_STATUS,
    PoolAuthorityError,
    assertSettleable,
    deriveSettlePlan,
    initialSettleNonce,
    readPoolSummary,
    requireAuthority,
    resolveDeadline,
} from "@/lib/poolAuthority";

/**
 * POST /api/chips/settle/propose
 * Builds the canonical settle payload and returns the Edge co-signature (Mode A).
 * Host signs client-side with the same digest; anyone may submit settlePool.
 *
 * Body:
 * {
 *   walletAddress, sessionId,
 *   chainId, poolId,
 *   matchId, roomCode,
 *   authority, participants[], winnerAddresses[],
 *   payoutPlan: [{ addr, amount }...]  // amount as decimal string (wei)
 *   nonce, deadline
 * }
 *
 * Optional body.mode === "edge-only" after effective settleBy (Mode B) —
 * still returns edgeSig only; hostSig is empty on the wire.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            walletAddress,
            sessionId,
            chainId: chainRaw,
            poolId,
            winners,
            split,
        } = body ?? {};

        if (!poolId || !Array.isArray(winners) || winners.length === 0) {
            return NextResponse.json({ error: "Missing settle fields" }, { status: 400 });
        }

        // ── Auth ──────────────────────────────────────────────────────────
        // The caller must be the pool authority recorded ON-CHAIN. Previously
        // the only gate was "any valid session" and `authority` was taken from
        // the request body, so anyone could nominate themselves as host; and
        // because MatchPool.settlePool has no msg.sender check and skips the
        // host signature entirely in Mode B, a valid session was enough to
        // take 100% of the prize fund plus the slashed host bond (SEC-04).
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) {
            return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        }

        const chainId = parseRequestedChainId(chainRaw ?? 84532);
        const pool = matchPoolAddress();
        if (!pool) {
            return NextResponse.json({ error: "MatchPool not configured" }, { status: 503 });
        }

        // ── Server-owned state ────────────────────────────────────────────
        // prizeFund, status, maxSeats, settleBy and the authority all come from
        // the chain. Client amounts are never used.
        const summary = await readPoolSummary(String(poolId), chainId);
        requireAuthority(summary, wallet);
        assertSettleable(summary);

        const plan = deriveSettlePlan(
            summary,
            winners.map((w: unknown) => String(w)),
            split === "podium" || split === "team" ? split : "auto",
        );

        const deadline = resolveDeadline(summary, body?.deadline);
        const nonce = initialSettleNonce();

        const params = {
            poolId: String(poolId) as Hex,
            plan,
            nonce,
            deadline,
            authority: summary.authority,
        };

        const digest = settleDigest(params, pool, chainId);
        const edgeSig = await edgeSign(digest);

        return NextResponse.json({
            poolId: params.poolId,
            planHash: payoutPlanHash(plan),
            nonce: params.nonce.toString(),
            deadline: params.deadline.toString(),
            authority: params.authority,
            digest,
            edgeSig,
            /** Host signs the same digest (EIP-712 / eth_sign raw). */
            hostSignsDigest: digest,
            chainId,
            matchPool: pool,
            plan,
            // Informational only: Mode B is derived from block.timestamp by the
            // contract, not chosen by the caller.
            modeB: false,
        });
    } catch (err) {
        if (err instanceof PoolAuthorityError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("settle/propose error", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "settle propose failed" },
            { status: 500 },
        );
    }
}

/**
 * POST /api/chips/abandon
 * Edge-only abandon evidence (HIGH-2: Edge-only = full refund, no burn).
 */
export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { walletAddress, sessionId, chainId: chainRaw, poolId, accusedSeat, reason } =
            body ?? {};

        if (!poolId || !accusedSeat) {
            return NextResponse.json({ error: "Missing abandon fields" }, { status: 400 });
        }

        // ── Auth ──────────────────────────────────────────────────────────
        // This handler had NO authentication at all. MatchPool.submitAbandon
        // requires only an edge signature, so any anonymous caller could obtain
        // one and cancel a Locked wagered pool, refunding the host bond without
        // slashing it (SEC-03).
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) {
            return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        }

        const chainId = parseRequestedChainId(chainRaw ?? 84532);
        const pool = matchPoolAddress();
        if (!pool) {
            return NextResponse.json({ error: "MatchPool not configured" }, { status: 503 });
        }

        // ── Server-owned state ────────────────────────────────────────────
        const summary = await readPoolSummary(String(poolId), chainId);
        const authority = requireAuthority(summary, wallet);

        if (summary.status !== POOL_STATUS.Locked) {
            throw new PoolAuthorityError(
                `pool must be Locked to abandon (status ${summary.status})`,
                409,
            );
        }

        const accused = String(accusedSeat).toLowerCase() as Address;
        if (accused === authority.toLowerCase()) {
            // The authority cannot be the accused seat in its own request; that
            // would let a host abandon its own pool and reclaim the bond.
            throw new PoolAuthorityError("cannot abandon the authority seat", 403);
        }

        // Evidence is DERIVED, never accepted from the caller. The client used
        // to choose seqAtDisconnect, afkStrikes and deadline outright.
        const evidence = await deriveAbandonEvidence(String(poolId), accused);

        const params = {
            poolId: String(poolId) as Hex,
            accusedSeat: accused,
            seqAtDisconnect: evidence.seqAtDisconnect,
            afkStrikes: evidence.afkStrikes,
            deadline: evidence.deadline,
        };
        const digest = abandonDigest(params, pool, chainId);
        const edgeSig = await edgeSign(digest);

        return NextResponse.json({
            reason: reason === "dual" ? "dual" : "edge-only",
            digest,
            edgeSig,
            hostSig: null,
            burnSplit: false,
            params: {
                poolId: params.poolId,
                accusedSeat: params.accusedSeat,
                seqAtDisconnect: params.seqAtDisconnect.toString(),
                afkStrikes: params.afkStrikes,
                deadline: params.deadline.toString(),
            },
        });
    } catch (err) {
        if (err instanceof PoolAuthorityError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error("abandon sign error", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "abandon sign failed" },
            { status: 500 },
        );
    }
}

/**
 * Derive abandon evidence from our own state rather than the request body.
 *
 * `afkStrikes` must clear the AFK threshold the netcode already tracks, and the
 * disconnect must actually be stale, so a host cannot manufacture an abandon for
 * a live opponent. The seat list comes from the indexer cache, which may lag —
 * so a missing seat is not fatal, but a present-and-authoritative one is
 * checked.
 */
async function deriveAbandonEvidence(
    poolId: string,
    accused: string,
): Promise<{ seqAtDisconnect: bigint; afkStrikes: number; deadline: bigint }> {
    const supabase = serviceDb();
    const now = new Date();

    const { data: seats } = await supabase
        .from("chips_pool_seats")
        .select("wallet_address")
        .eq("pool_id", poolId);
    if (Array.isArray(seats) && seats.length > 0) {
        const known = seats.some(
            (r: { wallet_address: string }) =>
                String(r.wallet_address).toLowerCase() === accused,
        );
        if (!known) {
            throw new PoolAuthorityError("accused seat is not seated in this pool", 403);
        }
    }

    const { data: live } = await supabase
        .from("live_matches")
        .select("match_id, bet_window_status")
        .eq("room_code", poolId)
        .maybeSingle();
    const matchId = live?.match_id as string | undefined;

    let strikes = 0;
    let seqAtDisconnect = BigInt(0);
    if (matchId) {
        const { data: state } = await supabase
            .from("match_states")
            .select("seq, updated_at, state")
            .eq("match_id", matchId)
            .maybeSingle();
        const s = (state?.state ?? {}) as { afkStats?: Record<string, unknown> };
        const per = (s.afkStats ?? {}) as Record<string, { strikes?: number }>;
        strikes = Number(per[accused]?.strikes ?? 0);
        seqAtDisconnect = BigInt(state?.seq ?? 0);
        const updatedAt = state?.updated_at ? new Date(state.updated_at).getTime() : 0;
        // The match must actually be stalled, not merely old.
        if (updatedAt && now.getTime() - updatedAt < AFK_STALE_MS) {
            throw new PoolAuthorityError(
                "match state is still advancing; abandon evidence rejected",
                409,
            );
        }
    }

    if (strikes < AFK_STRIKES_REQUIRED) {
        throw new PoolAuthorityError(
            `accused seat has ${strikes} AFK strike(s); ${AFK_STRIKES_REQUIRED} required`,
            403,
        );
    }

    return {
        seqAtDisconnect,
        afkStrikes: Math.min(strikes, 255),
        deadline: BigInt(Math.floor(now.getTime() / 1000) + 600),
    };
}
