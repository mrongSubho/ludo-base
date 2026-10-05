import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { loadMissionCatalog, periodBucketFor } from '@/lib/missionCatalog';

/**
 * GET /api/missions/list?wallet=0x…&sessionId=…
 *
 * Daily + weekly missions joined with the caller's progress for the *current*
 * period bucket.
 *
 * Rewritten from a hardcoded `DAILY_MISSIONS` table of coin rewards plus an
 * inline daily reset. Rewards now come from `mission_catalog` (whole CHIPS,
 * CHECK-constrained to 5..20) and the reset disappears entirely because
 * `player_missions` is keyed by (player, mission, period_id) — a new period is
 * a new row, so there is no date comparison to get wrong (migration
 * 202609300004).
 *
 * Still writes: it seeds a `player_missions` row at 0 for each mission the
 * caller has not touched yet, so progress tracking has somewhere to accumulate.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet')?.toLowerCase();

    if (!walletAddress) {
        return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
    }
    const wallet = await requireAppSession(walletAddress, searchParams.get('sessionId'));
    if (!wallet) {
        return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    try {
        const db = serviceDb();
        const now = new Date();

        const all = await loadMissionCatalog();
        const periodic = all.filter((m) => m.category === 'daily' || m.category === 'weekly');
        if (periodic.length === 0) {
            return NextResponse.json([]);
        }

        // Buckets in play right now: one per cadence.
        const buckets = Array.from(
            new Set(periodic.map((m) => periodBucketFor(m, now))),
        );

        const { data: rows, error } = await db
            .from('player_missions')
            .select('mission_id, period_id, progress, is_claimed')
            .eq('player_id', wallet)
            .in('period_id', buckets);
        if (error) throw error;

        type ProgressRow = { mission_id: string; progress: number; is_claimed: boolean };
        const byKey = new Map<string, ProgressRow>(
            ((rows ?? []) as unknown as Array<ProgressRow & { period_id: string }>).map((r) => [
                `${r.mission_id}:${r.period_id}`,
                r,
            ]),
        );

        // Seed rows for anything untouched this period, in one round trip.
        const seeds = periodic
            .filter((m) => !byKey.has(`${m.missionId}:${periodBucketFor(m, now)}`))
            .map((m) => ({
                player_id: wallet,
                mission_id: m.missionId,
                period_id: periodBucketFor(m, now),
                progress: 0,
                is_claimed: false,
                last_updated: now.toISOString(),
            }));
        if (seeds.length > 0) {
            // Conflict means a concurrent request seeded it first — harmless,
            // the row exists either way.
            await db
                .from('player_missions')
                .upsert(seeds, { onConflict: 'player_id,mission_id,period_id', ignoreDuplicates: true });
        }

        return NextResponse.json(
            periodic.map((m) => {
                const bucket = periodBucketFor(m, now);
                const row = byKey.get(`${m.missionId}:${bucket}`);
                const progress = row?.progress ?? 0;
                const isClaimed = row?.is_claimed ?? false;
                return {
                    id: m.missionId,
                    mission_id: m.missionId,
                    category: m.category,
                    period: m.period,
                    period_id: bucket,
                    title: m.title,
                    description: m.description,
                    target: m.target,
                    progress,
                    is_claimed: isClaimed,
                    rewardType: 'chips' as const,
                    rewardAmount: m.rewardChips,
                    claimable: progress >= m.target && !isClaimed,
                };
            }),
        );
    } catch (err) {
        console.error('Error fetching missions:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'missions unavailable' },
            { status: 500 },
        );
    }
}
