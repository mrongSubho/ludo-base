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
import { serviceDb } from "@/lib/serverAuth";

export interface IssuedVoucher {
    missionClaim: string;
    chainId: number;
    rewardChips: number;
    period: string;
    voucher: {
        wallet: `0x${string}`;
        missionId: Hex;
        amount: string;
        periodId: Hex;
        deadline: string;
        nonce: string;
    };
    signature: Hex;
}

export type IssueResult =
    | { ok: true; issued: IssuedVoucher }
    | { ok: false; error: string; status: number };

/**
 * Issue an EIP-712 MissionClaim voucher — the single CHIPS mission-reward
 * path, shared by `/api/missions/voucher` (user-initiated claim) and
 * `/api/social/poke` (poke-back auto-issue). Extracted verbatim from the
 * voucher route so both callers share the reserve → nonce → sign → fill
 * sequence and its failure semantics:
 *
 * - reward / periodId / nonce are server-owned (catalog / clock / sequence);
 * - eligibility is an unclaimed current-period row at or past target;
 * - the claim lock is the `unique (wallet_address, mission_id, period_id)`
 *   constraint: reserve-before-sign, 23505 → already-claimed;
 * - a signing failure releases the reservation so the slot is retryable.
 */
export async function issueMissionVoucher(
    wallet: string,
    missionId: string,
    chainIdRaw?: unknown,
): Promise<IssueResult> {
    const def = await loadMissionDef(missionId);
    if (!def) {
        return { ok: false, error: "Unknown mission", status: 404 };
    }
    if (def.category === "onboarding") {
        return {
            ok: false,
            error: "Use /api/onboarding/claim for onboarding tracks",
            status: 400,
        };
    }

    const db = serviceDb();
    const periodId = periodIdFor(def);
    const now = new Date();

    const { data: rows, error: readErr } = await db
        .from("player_missions")
        .select("progress, is_claimed")
        .eq("player_id", wallet)
        .eq("mission_id", missionId)
        .eq("period_id", periodBucketFor(def, now))
        .limit(1);
    if (readErr) {
        return { ok: false, error: readErr.message, status: 500 };
    }
    const row = rows?.[0];
    const eligible = checkMissionClaimable(def, row?.progress ?? 0, !!row?.is_claimed);
    if (!eligible.ok) {
        return { ok: false, error: eligible.error, status: eligible.status };
    }

    const claim = missionClaimAddress();
    if (!claim) {
        return { ok: false, error: "MissionClaim not configured", status: 503 };
    }
    const chainId = parseChainForMission(chainIdRaw ?? 84532);

    const amount = chipsToBaseUnits(def.rewardChips);
    const deadline = BigInt(Math.floor(now.getTime() / 1000) + 30 * 24 * 3600);

    const { error: reserveErr } = await db.from("mission_vouchers").insert({
        wallet_address: wallet,
        mission_id: missionId,
        period_id: periodId,
        amount: amount.toString(),
        signature: "pending",
        deadline: new Date(Number(deadline) * 1000).toISOString(),
    });
    if (reserveErr) {
        if (reserveErr.code === "23505") {
            return { ok: false, error: "Already claimed for this period", status: 409 };
        }
        return { ok: false, error: reserveErr.message, status: 500 };
    }

    const mid: Hex = missionIdBytes32(missionId);
    const nonce = await nextVoucherNonce(db);

    const voucher = {
        wallet: wallet as `0x${string}`,
        missionId: mid,
        amount,
        periodId,
        deadline,
        nonce,
    };

    let sig: Hex;
    try {
        sig = await signMissionVoucher(voucher, claim, chainId);
    } catch (signErr) {
        await db
            .from("mission_vouchers")
            .delete()
            .eq("wallet_address", wallet)
            .eq("mission_id", missionId)
            .eq("period_id", periodId)
            .eq("signature", "pending");
        console.error("mission voucher signing failed; reservation released:", signErr);
        return {
            ok: false,
            error: "Voucher signing failed; the claim slot was released, retry shortly",
            status: 503,
        };
    }

    const { error: sigErr } = await db
        .from("mission_vouchers")
        .update({ signature: sig })
        .eq("wallet_address", wallet)
        .eq("mission_id", missionId)
        .eq("period_id", periodId)
        .eq("signature", "pending");
    if (sigErr) {
        return { ok: false, error: sigErr.message, status: 500 };
    }

    return {
        ok: true,
        issued: {
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
        },
    };
}

async function nextVoucherNonce(db: ReturnType<typeof serviceDb>): Promise<bigint> {
    const { data, error } = await db.rpc("next_mission_voucher_nonce");
    if (!error && data !== null && data !== undefined) {
        return BigInt(data as string | number);
    }
    console.error("next_mission_voucher_nonce unavailable; using fallback:", error?.message);
    return BigInt(Date.now()) * BigInt(1000) + BigInt(Math.floor(Math.random() * 1000));
}
