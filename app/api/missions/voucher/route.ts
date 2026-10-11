import { NextResponse } from "next/server";
import { issueMissionVoucher } from "@/lib/missionVoucherIssue";
import { requireAppSession } from "@/lib/serverAuth";

/**
 * POST /api/missions/voucher
 * Issue an EIP-712 MissionClaim voucher — the canonical CHIPS mission reward
 * path. Body: { walletAddress, sessionId, missionId, chainId? }
 *
 * Every value that determines what is signed is server-owned:
 *   reward    <- mission_catalog (CHECK-constrained to 5..20 whole CHIPS)
 *   periodId  <- mission_catalog.period, computed for "now" (UTC)
 *   nonce     <- public.next_mission_voucher_nonce() (a DB sequence)
 *   amount    <- reward * 1e18
 *
 * The previous revision read no eligibility state at all and accepted a
 * client-supplied `periodKey`, so any free SIWE session could mint an unbounded
 * number of chain-redeemable vouchers (SYSTEM_REVIEW.md SEC-10). The claim lock
 * is now the `unique (wallet_address, mission_id, period_id)` constraint on
 * mission_vouchers, which makes concurrent mints collide in the database rather
 * than in application logic.
 *
 * Issuance itself lives in `lib/missionVoucherIssue.ts`, shared with the
 * poke-back auto-issue (`/api/social/poke`) so both paths share the
 * reserve → nonce → sign → fill sequence.
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

        const result = await issueMissionVoucher(wallet, missionId, chainRaw);
        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: result.status });
        }
        return NextResponse.json(result.issued);
    } catch (err) {
        console.error("mission voucher error", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "voucher failed" },
            { status: 500 },
        );
    }
}
