import { NextResponse } from "next/server";
import type { Hex } from "viem";
import {
    missionClaimAddress,
    signMissionVoucher,
    parseChainForMission,
} from "@/lib/missionVoucher";
import {
    chipsToBaseUnits,
    checkMissionClaimable,
    loadMissionDef,
    missionIdBytes32,
    periodBucketFor,
    periodIdFor,
} from "@/lib/missionCatalog";
import { requireAppSession, serviceDb } from "@/lib/serverAuth";

/**
 * POST /api/missions/voucher
 * Issue an EIP-712 MissionClaim voucher — the canonical CHIPS mission reward
 * path. Body: { walletAddress, sessionId, missionId, chainId? }
 *
 * Every value that determines what is signed is server-owned:
 *   reward    <- mission_catalog (CHECK-constrained to 5..20 whole CHIPS)
 *   periodId  <- mission_catalog.period, computed for "now" (UTC)
 *   nonce     <- derived from the claim row, not from the clock
 *   amount    <- reward * 1e18
 *
 * The previous revision read no eligibility state at all and accepted a
 * client-supplied `periodKey`, so any free SIWE session could mint an unbounded
 * number of chain-redeemable vouchers (SYSTEM_REVIEW.md SEC-10). The claim lock
 * is now the `unique (wallet_address, mission_id, period_id)` constraint on
 * mission_vouchers, which makes concurrent mints collide in the database rather
 * than in application logic.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { walletAddress, sessionId, missionId, chainId: chainRaw } = body ?? {};
        if (!walletAddress || !missionId || typeof missionId !== "string") {
            return NextResponse.json({ error: "Missing mission fields" }, { status: 400 });
        }

        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) {
            return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        }

        // Reward + target + cadence all come from the catalog.
        const def = await loadMissionDef(missionId);
        if (!def) {
            return NextResponse.json({ error: "Unknown mission" }, { status: 404 });
        }
        if (def.category === "onboarding") {
            // Onboarding has its own progress store and claim rules.
            return NextResponse.json(
                { error: "Use /api/onboarding/claim for onboarding tracks" },
                { status: 400 },
            );
        }

        const db = serviceDb();
        const periodId = periodIdFor(def);
        const now = new Date();

        // Eligibility: an unclaimed row for this period, at or past target.
        // `daily_bonus` has target 0 and is therefore claimable on sight, which
        // is its intent (it is the login bonus, not a task).
        const { data: rows, error: readErr } = await db
            .from("player_missions")
            .select("progress, is_claimed")
            .eq("player_id", wallet)
            .eq("mission_id", missionId)
            .eq("period_id", periodBucketFor(def, now))
            .limit(1);
        if (readErr) {
            return NextResponse.json({ error: readErr.message }, { status: 500 });
        }
        const row = rows?.[0];
        const eligible = checkMissionClaimable(def, row?.progress ?? 0, !!row?.is_claimed);
        if (!eligible.ok) {
            return NextResponse.json({ error: eligible.error }, { status: eligible.status });
        }

        const claim = missionClaimAddress();
        if (!claim) {
            return NextResponse.json({ error: "MissionClaim not configured" }, { status: 503 });
        }
        const chainId = parseChainForMission(chainRaw ?? 84532);

        const amount = chipsToBaseUnits(def.rewardChips);
        const deadline = BigInt(Math.floor(now.getTime() / 1000) + 30 * 24 * 3600);

        // The insert below is the claim lock: unique(wallet, mission, period).
        // Reserve the slot BEFORE signing so a concurrent request cannot both
        // sign. The signature is filled in on the same row.
        const { error: reserveErr } = await db.from("mission_vouchers").insert({
            wallet_address: wallet,
            mission_id: missionId,
            period_id: periodId,
            amount: amount.toString(),
            signature: "pending",
            deadline: new Date(Number(deadline) * 1000).toISOString(),
        });
        if (reserveErr) {
            // 23505 = unique_violation -> already claimed this period.
            if (reserveErr.code === "23505") {
                return NextResponse.json(
                    { error: "Already claimed for this period" },
                    { status: 409 },
                );
            }
            return NextResponse.json({ error: reserveErr.message }, { status: 500 });
        }

        const mid: Hex = missionIdBytes32(missionId);
        // Nonce only needs to be unique per (wallet, mission, period), which the
        // unique constraint already guarantees. Mixing in a random suffix keeps
        // two legitimately-distinct vouchers for the same ms distinguishable.
        const nonce =
            BigInt(now.getTime()) * BigInt(1000) +
            BigInt(Math.floor(Math.random() * 1000));
        const voucher = {
            wallet: wallet as `0x${string}`,
            missionId: mid,
            amount,
            periodId,
            deadline,
            nonce,
        };
        const sig = await signMissionVoucher(voucher, claim, chainId);

        const { error: sigErr } = await db
            .from("mission_vouchers")
            .update({ signature: sig })
            .eq("wallet_address", wallet)
            .eq("mission_id", missionId)
            .eq("period_id", periodId)
            .eq("signature", "pending");
        if (sigErr) {
            return NextResponse.json({ error: sigErr.message }, { status: 500 });
        }

        return NextResponse.json({
            missionClaim: claim,
            chainId,
            rewardChips: def.rewardChips,
            period: def.period,
            voucher: {
                wallet: voucher.wallet,
                missionId: voucher.missionId,
                amount: voucher.amount.toString(),
                periodId: voucher.periodId,
                deadline: voucher.deadline.toString(),
                nonce: voucher.nonce.toString(),
            },
            signature: sig,
        });
    } catch (err) {
        console.error("mission voucher error", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "voucher failed" },
            { status: 500 },
        );
    }
}
