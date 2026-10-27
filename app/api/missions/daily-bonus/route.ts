import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { loadMissionDef, periodBucketFor } from '@/lib/missionCatalog';
import { reportProgress } from '@/lib/missionOracle';
import { isMissionSystemConfigured, missionSystemAddress, MISSION_SYSTEM_ABI } from '@/lib/missionSystem';
import { issueMissionVoucher, type IssuedVoucher } from '@/lib/missionVoucherIssue';
import { createPublicClient, http, keccak256, toBytes, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';

/**
 * POST /api/missions/daily-bonus  { walletAddress, sessionId }
 *
 * The daily check-in ("Daily Bonus", `daily_bonus`). Target 0.
 *
 * On-chain authority (MissionSystem):
 *  1. Server oracle verifies check-in and submits `recordProgress` (waiting for receipt),
 *     which flips `completed = true` on-chain.
 *  2. The connected user then executes a 1:1 pull claim on-chain (`claimMission`),
 *     paying their own gas fee to withdraw CHIPS directly into their wallet.
 *
 * Fallback (when MissionSystem is unconfigured):
 *  Issues an EIP-712 voucher for MissionClaim.
 */
const DAILY_BONUS_MISSION = 'daily_bonus';

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId } = await request.json();
        if (!walletAddress) {
            return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
        }
        const authed = await requireAppSession(walletAddress, sessionId);
        if (!authed) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        }
        const wallet = authed.toLowerCase() as Address;

        const def = await loadMissionDef(DAILY_BONUS_MISSION);
        if (!def) {
            return NextResponse.json({ error: 'Unknown mission' }, { status: 404 });
        }
        const bucket = periodBucketFor(def, new Date());
        const db = serviceDb();

        // ── 1. On-chain MissionSystem Path (Authority) ───────────────────────
        if (isMissionSystemConfigured()) {
            const sysAddr = missionSystemAddress()!;
            const rpc = process.env.NEXT_PUBLIC_MISSION_RPC_URL?.trim();
            const client = createPublicClient({ chain: baseSepolia, transport: http(rpc || undefined) });
            const mid = keccak256(toBytes(DAILY_BONUS_MISSION));

            const isClaimedOnChain = await client.readContract({
                address: sysAddr,
                abi: MISSION_SYSTEM_ABI,
                functionName: 'isClaimed',
                args: [wallet, mid],
            });

            if (isClaimedOnChain) {
                return NextResponse.json({
                    success: true,
                    alreadyClaimed: true,
                    delivered: 'onchain' as const,
                    reward: def.rewardChips,
                    rewardCurrency: 'CHIPS' as const,
                });
            }

            const isCompletedOnChain = await client.readContract({
                address: sysAddr,
                abi: MISSION_SYSTEM_ABI,
                functionName: 'isCompleted',
                args: [wallet, mid],
            });

            if (!isCompletedOnChain) {
                // Submit progress record from oracle and wait for confirmation on Base Sepolia (~2s)
                const ok = await reportProgress(wallet, DAILY_BONUS_MISSION, 1, true);
                if (!ok) {
                    return NextResponse.json({ error: 'Failed to record daily check-in on-chain' }, { status: 500 });
                }
            }

            // Sync database row: progress = 1, is_claimed = false (until claimed on-chain)
            await db.from('player_missions').upsert(
                {
                    player_id: wallet,
                    mission_id: DAILY_BONUS_MISSION,
                    period_id: bucket,
                    progress: 1,
                    is_claimed: false,
                    last_updated: new Date().toISOString(),
                },
                { onConflict: 'player_id,mission_id,period_id' }
            );

            return NextResponse.json({
                success: true,
                completed: true,
                delivered: 'onchain' as const,
                reward: def.rewardChips,
                rewardCurrency: 'CHIPS' as const,
            });
        }

        // ── 2. Legacy / Fallback Voucher Path ────────────────────────────────
        const { data: existing, error: readErr } = await db
            .from('player_missions')
            .select('progress, is_claimed')
            .eq('player_id', wallet)
            .eq('mission_id', DAILY_BONUS_MISSION)
            .eq('period_id', bucket)
            .maybeSingle();
        if (readErr) {
            console.error('[daily-bonus] read failed:', readErr);
            return NextResponse.json({ error: readErr.message }, { status: 500 });
        }
        if (existing?.is_claimed) {
            return NextResponse.json({
                success: true,
                alreadyClaimed: true,
                delivered: 'voucher' as const,
                reward: def.rewardChips,
                rewardCurrency: 'CHIPS' as const,
            });
        }

        const issue = await issueMissionVoucher(wallet, DAILY_BONUS_MISSION);
        const delivered = 'voucher' as const;
        let voucher: IssuedVoucher | null = null;
        if (!issue.ok) {
            console.error('[daily-bonus] voucher fallback failed:', issue.error);
            if (issue.status === 409) {
                await markClaimed(db, wallet, bucket, existing?.progress ?? 0);
                return NextResponse.json({
                    success: true,
                    alreadyClaimed: true,
                    delivered: 'voucher' as const,
                    reward: def.rewardChips,
                    rewardCurrency: 'CHIPS' as const,
                });
            }
            return NextResponse.json({ error: issue.error }, { status: issue.status });
        }
        voucher = issue.issued;

        const writeErr = await markClaimed(db, wallet, bucket, existing?.progress ?? 0);
        if (writeErr) return writeErr;

        return NextResponse.json({
            success: true,
            delivered,
            reward: def.rewardChips,
            rewardCurrency: 'CHIPS' as const,
            voucher,
        });
    } catch (err) {
        console.error('[daily-bonus] unexpected error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'bonus claim failed' },
            { status: 500 },
        );
    }
}

async function markClaimed(
    db: ReturnType<typeof serviceDb>,
    wallet: string,
    bucket: string,
    prevProgress: number,
): Promise<NextResponse | null> {
    const { error } = await db
        .from('player_missions')
        .upsert(
            {
                player_id: wallet,
                mission_id: DAILY_BONUS_MISSION,
                period_id: bucket,
                // target is 0, so 1 is "complete"; never regress an existing row.
                progress: Math.max(prevProgress ?? 0, 1),
                is_claimed: true,
                last_updated: new Date().toISOString(),
            },
            { onConflict: 'player_id,mission_id,period_id' },
        );
    if (error) {
        // The reward may already have been paid on-chain at this point, so this is
        // reported as a hard error rather than silently dropped.
        console.error('[daily-bonus] claim write failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return null;
}
