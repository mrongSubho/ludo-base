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
            authority,
            participants,
            winnerAddresses,
            payoutPlan,
            nonce,
            deadline,
            mode,
        } = body ?? {};

        if (!poolId || !authority || !Array.isArray(payoutPlan) || payoutPlan.length === 0) {
            return NextResponse.json({ error: "Missing settle fields" }, { status: 400 });
        }

        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) {
            return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        }

        const chainId = parseRequestedChainId(chainRaw ?? 84532);
        const pool = matchPoolAddress();
        if (!pool) {
            return NextResponse.json({ error: "MatchPool not configured" }, { status: 503 });
        }

        // Participants / winners must be seats-shaped; keep canonical lowercase.
        const parts = Array.isArray(participants)
            ? participants.map((p: string) => String(p).toLowerCase())
            : [];
        const winners = Array.isArray(winnerAddresses)
            ? winnerAddresses.map((p: string) => String(p).toLowerCase())
            : [];
        for (const w of winners) {
            if (parts.length && !parts.includes(w)) {
                return NextResponse.json({ error: "Winner is not a participant" }, { status: 403 });
            }
        }

        const plan = payoutPlan.map((p: { addr: string; amount: string | number }) => ({
            addr: String(p.addr).toLowerCase() as Address,
            amount: BigInt(p.amount),
        }));

        // Optional server-side sum check against cached prize (fail-soft — contract is authority).
        try {
            const supabase = serviceDb();
            const { data: cached } = await supabase
                .from("chips_pools")
                .select("prize_fund, status")
                .eq("pool_id", String(poolId))
                .maybeSingle();
            if (cached?.prize_fund != null) {
                const sum = plan.reduce((a: bigint, p: { amount: bigint }) => a + p.amount, BigInt(0));
                const fund = BigInt(String(cached.prize_fund));
                if (fund > BigInt(0) && sum !== fund) {
                    return NextResponse.json(
                        { error: `payout sum ${sum} != pool prize_fund ${fund}` },
                        { status: 400 },
                    );
                }
            }
        } catch {
            // cache optional
        }

        const params = {
            poolId: String(poolId) as Hex,
            plan,
            nonce: BigInt(nonce ?? 1),
            deadline: BigInt(deadline ?? Math.floor(Date.now() / 1000) + 3600),
            authority: String(authority).toLowerCase() as Address,
        };

        const digest = settleDigest(params, pool, chainId);
        const edgeSig = await edgeSign(digest);

        return NextResponse.json({
            mode: mode === "edge-only" ? "edge-only" : "dual",
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
            modeB: mode === "edge-only",
        });
    } catch (err) {
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
        const {
            chainId: chainRaw,
            poolId,
            accusedSeat,
            seqAtDisconnect,
            afkStrikes,
            deadline,
            dual,
            hostSig,
        } = body ?? {};

        if (!poolId || !accusedSeat) {
            return NextResponse.json({ error: "Missing abandon fields" }, { status: 400 });
        }
        const chainId = parseRequestedChainId(chainRaw ?? 84532);
        const pool = matchPoolAddress();
        if (!pool) {
            return NextResponse.json({ error: "MatchPool not configured" }, { status: 503 });
        }

        const params = {
            poolId: String(poolId) as Hex,
            accusedSeat: String(accusedSeat).toLowerCase() as Address,
            seqAtDisconnect: BigInt(seqAtDisconnect ?? 0),
            afkStrikes: Number(afkStrikes ?? 0),
            deadline: BigInt(deadline ?? Math.floor(Date.now() / 1000) + 600),
        };
        const digest = abandonDigest(params, pool, chainId);
        const edgeSig = await edgeSign(digest);

        return NextResponse.json({
            dual: Boolean(dual),
            digest,
            edgeSig,
            hostSig: dual ? hostSig ?? null : null,
            burnSplit: Boolean(dual),
            params: {
                poolId: params.poolId,
                accusedSeat: params.accusedSeat,
                seqAtDisconnect: params.seqAtDisconnect.toString(),
                afkStrikes: params.afkStrikes,
                deadline: params.deadline.toString(),
            },
        });
    } catch (err) {
        console.error("abandon sign error", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "abandon sign failed" },
            { status: 500 },
        );
    }
}
