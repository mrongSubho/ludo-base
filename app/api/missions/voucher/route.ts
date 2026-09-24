import { NextResponse } from "next/server";
import type { Address, Hex } from "viem";
import {
    missionClaimAddress,
    missionOpPrivateKey,
    periodIdDay,
    signMissionVoucher,
    parseChainForMission,
    ONBOARDING_REWARDS,
} from "@/lib/missionVoucher";
import { requireAppSession, serviceDb } from "@/lib/serverAuth";
import { privateKeyToAccount } from "viem/accounts";

/**
 * POST /api/missions/voucher
 * Issue an EIP-712 MissionClaim voucher (pull-only on-chain claim).
 * Body: { walletAddress, sessionId, missionId, chainId?, amount? }
 *
 * Amount must be in ONBOARDING_REWARDS or a small daily table — never client-chosen.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { walletAddress, sessionId, missionId, chainId: chainRaw, periodKey } = body ?? {};
        if (!walletAddress || !missionId) {
            return NextResponse.json({ error: "Missing mission fields" }, { status: 400 });
        }
        const wallet = await requireAppSession(walletAddress, sessionId);
        if (!wallet) {
            return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        }

        const chainId = parseChainForMission(chainRaw ?? 84532);
        const claim = missionClaimAddress();
        if (!claim) {
            return NextResponse.json({ error: "MissionClaim not configured" }, { status: 503 });
        }

        const whole = ONBOARDING_REWARDS[String(missionId)];
        if (whole == null) {
            return NextResponse.json({ error: "Unknown missionId" }, { status: 400 });
        }
        const amount = BigInt(whole) * BigInt(10) ** BigInt(18);
        const missionIdB32 = (
            missionId.length === 66 && missionId.startsWith("0x")
                ? missionId
                : undefined
        ) as Hex | undefined;
        const mid: Hex =
            missionIdB32 ??
            // keccak of label without extra dep — use viem via sign path
            (await import("viem")).keccak256((await import("viem")).toBytes(String(missionId)));

        const periodId: Hex =
            periodKey && typeof periodKey === "string" && periodKey.startsWith("0x")
                ? (periodKey as Hex)
                : periodIdDay();

        const nonce = BigInt(Date.now());
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
        const voucher = {
            wallet: wallet as Address,
            missionId: mid,
            amount,
            periodId,
            deadline,
            nonce,
        };
        const sig = await signMissionVoucher(voucher, claim, chainId);

        // Persist for replay bookkeeping (service role).
        try {
            const supabase = serviceDb();
            const op = privateKeyToAccount(missionOpPrivateKey()).address;
            await supabase.from("mission_vouchers").insert({
                wallet_address: wallet,
                mission_id: String(missionId),
                period_id: periodId,
                amount: whole,
                signature: sig,
                deadline: new Date(Number(deadline) * 1000).toISOString(),
            });
            void op;
        } catch {
            // table optional until migration applied
        }

        return NextResponse.json({
            missionClaim: claim,
            chainId,
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
