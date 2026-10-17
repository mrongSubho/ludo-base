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
 * - `welcome_grant` (missionId or track): one-time, issues an EIP-712
 *   MissionClaim voucher exactly like the tracks (reserve → sign → fill),
 *   so the client submits `MissionClaim.claim` and 50 CHIPS settle from the
 *   funded reserve. Sent as an unregistered mission (fixed 50e18 reward
 *   enforced server-side), so no on-chain `setMission` call is required and
 *   the period window is always open.
 *
 * Double-claim is refused on `is_claimed` (tracks) and on the existing
 * mission_vouchers row (welcome grant); the contract's `claimedInPeriod`
 * and `usedVoucher` guards add on-chain defence in depth.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const wallet = await requireAppSession(body?.walletAddress, body?.sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const rawTrack = String(body?.track ?? body?.missionId ?? '');
        const db = serviceDb();

        // ── Welcome grant: one-time, on-chain MissionClaim voucher ────────────
        if (rawTrack === WELCOME_GRANT_MISSION_ID) {
            const { data: prior, error: priorError } = await db
                .from('mission_vouchers')
                .select('id, signature')
                .eq('wallet_address', wallet)
                .eq('mission_id', WELCOME_GRANT_MISSION_ID)
                .limit(1);
            if (priorError) return NextResponse.json({ error: priorError.message }, { status: 500 });

            // Same definition of "claimed" as /api/onboarding/progress: a
            // reservation (signature 'pending') is not a payout. A request that
            // died between reserving and signing used to leave a permanent
            // 'pending' row here, which reported the grant as Claimed and then
            // refused every retry through the unique (wallet, mission, period)
            // constraint.
            const priorRows = prior ?? [];
            const claimed = priorRows.some(
                (r: { signature: string | null }) => !!r.signature && r.signature !== 'pending',
            );
            const check = checkWelcomeGrantClaimable(claimed);
            if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

            // Drop abandoned reservations so the slot is retryable. Re-issuing is
            // safe: MissionClaim enforces `claimedInPeriod` (one payout per
            // wallet/mission/period) and a per-voucher `usedVoucher` digest, so a
            // voucher that was already redeemed on-chain cannot pay twice.
            const stale = priorRows.filter(
                (r: { signature: string | null }) => !r.signature || r.signature === 'pending',
            );
            if (stale.length > 0) {
                await db.from('mission_vouchers').delete().in('id', stale.map((r: { id: string }) => r.id));
            }

            const claim = missionClaimAddress();
            if (!claim) return NextResponse.json({ error: 'MissionClaim not configured' }, { status: 503 });
            const chainId = parseChainForMission(body?.chainId ?? 84532);

            // 50 CHIPS in 1e18 base units — matches mission_vouchers.amount everywhere else.
            const amount = BigInt(WELCOME_GRANT_REWARD) * BigInt(10) ** BigInt(18);
            const missionId: Hex = keccak256(toBytes('welcome_grant'));
            const nonce = BigInt(Date.now());
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
            const voucher = {
                wallet: wallet as Address,
                missionId,
                amount,
                periodId: WELCOME_PERIOD,
                deadline,
                nonce,
            };

            // Reserve before signing so a failed sign can release the slot.
            const { error: insertError } = await db.from('mission_vouchers').insert({
                wallet_address: wallet,
                mission_id: WELCOME_GRANT_MISSION_ID,
                period_id: WELCOME_PERIOD,
                amount: amount.toString() as unknown as number,
                signature: 'pending',
                deadline: new Date(Number(deadline) * 1000).toISOString(),
            });
            if (insertError) {
                // Unique (wallet, mission_id, period_id) — concurrent double-claim.
                return NextResponse.json({ error: 'Already claimed' }, { status: 400 });
            }

            let sig: Hex;
            try {
                sig = await signMissionVoucher(voucher, claim, chainId);
            } catch (signErr) {
                // Release the reservation so the slot is retryable.
                await db
                    .from('mission_vouchers')
                    .delete()
                    .eq('wallet_address', wallet)
                    .eq('mission_id', WELCOME_GRANT_MISSION_ID)
                    .eq('period_id', WELCOME_PERIOD)
                    .eq('signature', 'pending');
                console.error('welcome grant voucher signing failed; reservation released:', signErr);
                return NextResponse.json(
                    { error: 'Voucher signing failed; the claim slot was released, retry shortly' },
                    { status: 503 },
                );
            }

            const { error: sigErr } = await db
                .from('mission_vouchers')
                .update({ signature: sig })
                .eq('wallet_address', wallet)
                .eq('mission_id', WELCOME_GRANT_MISSION_ID)
                .eq('period_id', WELCOME_PERIOD)
                .eq('signature', 'pending');
            if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 });

            return NextResponse.json({
                success: true,
                track: WELCOME_GRANT_MISSION_ID,
                reward: WELCOME_GRANT_REWARD,
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
