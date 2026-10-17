import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { loadMissionDef, periodBucketFor } from '@/lib/missionCatalog';
import { reportProgress } from '@/lib/missionOracle';
import { issueMissionVoucher, type IssuedVoucher } from '@/lib/missionVoucherIssue';

/**
 * POST /api/missions/daily-bonus  { walletAddress, sessionId }
 *
 * The daily check-in ("Daily Bonus", `daily_bonus`). Target 0 — it completes on
 * the first progress event, so this endpoint IS the trigger.
 *
 * Reward delivery, in order:
 *  1. **MissionSystem (authority)** — one `reportProgress` both completes the
 *     mission and pays the CHIPS from the contract's own reserve.
 *  2. **EIP-712 voucher (fallback)** — only when the oracle did not report
 *     (contract/address/oracle key unset, or the RPC rejected the send), so the
 *     player is never left unpaid just because the chain path is offline.
 *
 * Exactly one of the two pays per (wallet, UTC day): on success the
 * `player_missions` row is written with `is_claimed = true`, which is also the
 * gate `issueMissionVoucher` reads (see lib/missionVoucherIssue.ts) — that is
 * what keeps the two paths from paying twice. Retries are idempotent no-ops.
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
        const wallet = authed.toLowerCase();

        const def = await loadMissionDef(DAILY_BONUS_MISSION);
        if (!def) {
            return NextResponse.json({ error: 'Unknown mission' }, { status: 404 });
        }
        const bucket = periodBucketFor(def, new Date());

        const db = serviceDb();
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
                delivered: 'onchain' as const,
                reward: def.rewardChips,
                rewardCurrency: 'CHIPS' as const,
            });
        }

        // Primary path: the contract is the authority and pays on completion.
        const reported = await reportProgress(wallet, DAILY_BONUS_MISSION, 1);

        let delivered: 'onchain' | 'voucher' = 'onchain';
        let voucher: IssuedVoucher | null = null;
        if (!reported) {
            // Fallback so the player is still paid exactly once when the oracle
            // cannot report. The claim lock is the unique
            // (wallet_address, mission_id, period_id) constraint on
            // `mission_vouchers`; a 409 means an earlier attempt already paid.
            const issue = await issueMissionVoucher(wallet, DAILY_BONUS_MISSION);
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
            delivered = 'voucher';
            voucher = issue.issued;
        }

        // Mark the period claimed. `is_claimed` is the same flag
        // `issueMissionVoucher` checks, so this also closes the voucher path for
        // today — the mechanism that prevents a double payout.
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
