import { NextResponse } from 'next/server';
import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import {
    missionClaimAddress,
    parseChainForMission,
    signMissionVoucher,
} from '@/lib/missionVoucher';
import {
    ONBOARDING_TRACKS,
    WELCOME_GRANT_MISSION_ID,
    WELCOME_GRANT_REWARD,
    checkTrackClaimable,
    checkWelcomeGrantClaimable,
    isCorePackageComplete,
    isOnboardingTrack,
    type OnboardingTrack,
} from '@/lib/onboardingServer';

const ONBOARDING_PERIOD = keccak256(toBytes('onboarding-v1'));
const WELCOME_PERIOD = keccak256(toBytes('welcome-grant-v1'));

/**
 * POST /api/onboarding/claim
 * Body: { walletAddress, sessionId, track | missionId }
 *
 * - Onboarding track (tutorial … clan): requires progress ≥ target and
 *   !is_claimed (server-owned). Issues an EIP-712 MissionClaim voucher.
 * - `welcome_grant` (missionId or track): one-time, marked pending (no
 *   on-chain voucher here) — ops/treasury path.
 *
 * Double-claim is refused on `is_claimed` (tracks) and on the existing
 * mission_vouchers row (welcome grant).
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const wallet = await requireAppSession(body?.walletAddress, body?.sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const rawTrack = String(body?.track ?? body?.missionId ?? '');
        const db = serviceDb();

        // ── Welcome grant: one-time, marked pending ─────────────────────────
        if (rawTrack === WELCOME_GRANT_MISSION_ID) {
            const { data: prior, error: priorError } = await db
                .from('mission_vouchers')
                .select('id')
                .eq('wallet_address', wallet)
                .eq('mission_id', WELCOME_GRANT_MISSION_ID)
                .limit(1);
            if (priorError) return NextResponse.json({ error: priorError.message }, { status: 500 });

            const check = checkWelcomeGrantClaimable((prior?.length ?? 0) > 0);
            if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

            const deadline = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
            const { error: insertError } = await db.from('mission_vouchers').insert({
                wallet_address: wallet,
                mission_id: WELCOME_GRANT_MISSION_ID,
                period_id: WELCOME_PERIOD,
                amount: WELCOME_GRANT_REWARD,
                signature: 'pending',
                deadline,
            });
            if (insertError) {
                // Unique (wallet, mission_id, period_id) — concurrent double-claim.
                return NextResponse.json({ error: 'Already claimed' }, { status: 400 });
            }
            return NextResponse.json({
                success: true,
                track: WELCOME_GRANT_MISSION_ID,
                reward: WELCOME_GRANT_REWARD,
                pending: true,
            });
        }

        // ── Onboarding track: completed + !is_claimed → voucher ────────────
        if (!isOnboardingTrack(rawTrack)) {
            return NextResponse.json({ error: 'Unknown track' }, { status: 400 });
        }
        const track = rawTrack as OnboardingTrack;
        const def = ONBOARDING_TRACKS[track];

        const { data: row, error: rowError } = await db
            .from('onboarding_progress')
            .select('progress, target, is_claimed')
            .eq('wallet_address', wallet)
            .eq('track', track)
            .maybeSingle();
        if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });

        const { data: claimedRows, error: claimedError } = await db
            .from('onboarding_progress')
            .select('track, is_claimed')
            .eq('wallet_address', wallet);
        if (claimedError) return NextResponse.json({ error: claimedError.message }, { status: 500 });

        const check = checkTrackClaimable(
            track,
            row
                ? { progress: row.progress ?? 0, target: row.target ?? def.target, is_claimed: !!row.is_claimed }
                : null,
            isCorePackageComplete(claimedRows ?? []),
        );
        if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

        const chainId = parseChainForMission(body?.chainId ?? 84532);
        const claim = missionClaimAddress();
        if (!claim) {
            return NextResponse.json({ error: 'MissionClaim not configured' }, { status: 503 });
        }

        const amount = BigInt(def.reward) * BigInt(10) ** BigInt(18);
        const missionId: Hex = keccak256(toBytes(`onboarding:${track}`));
        const nonce = BigInt(Date.now());
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
        const voucher = {
            wallet: wallet as Address,
            missionId,
            amount,
            periodId: ONBOARDING_PERIOD,
            deadline,
            nonce,
        };
        const sig = await signMissionVoucher(voucher, claim, chainId);

        // Claim flag flips only after the voucher is signed. Concurrent claims
        // are caught by the conditional update (0 rows → already claimed).
        const { data: locked, error: lockError } = await db
            .from('onboarding_progress')
            .update({
                is_claimed: true,
                voucher_id: sig,
                updated_at: new Date().toISOString(),
            })
            .eq('wallet_address', wallet)
            .eq('track', track)
            .eq('is_claimed', false)
            .select('track');
        if (lockError) return NextResponse.json({ error: lockError.message }, { status: 500 });
        if (!locked || locked.length === 0) {
            return NextResponse.json({ error: 'Already claimed' }, { status: 400 });
        }

        try {
            await db.from('mission_vouchers').insert({
                wallet_address: wallet,
                mission_id: `onboarding:${track}`,
                period_id: ONBOARDING_PERIOD,
                amount: def.reward,
                signature: sig,
                deadline: new Date(Number(deadline) * 1000).toISOString(),
            });
        } catch {
            // Bookkeeping only — voucher is already signed and claim is locked.
        }

        return NextResponse.json({
            success: true,
            track,
            reward: def.reward,
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
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
