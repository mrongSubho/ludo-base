import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb, ensurePlayerRow } from '@/lib/serverAuth';
import {
    ONBOARDING_TRACKS,
    ONBOARDING_TRACK_KEYS,
    WELCOME_GRANT_REWARD,
    WELCOME_GRANT_MISSION_ID,
    isOnboardingTrack,
    type OnboardingTrack,
} from '@/lib/onboardingServer';

/**
 * GET /api/onboarding/progress?walletAddress=0x…&sessionId=…
 * Track progress for the session wallet (service role; RLS default-deny).
 *
 * POST /api/onboarding/progress
 * Body: { walletAddress, sessionId, track, delta? }
 * Server-side increment. Claim flags are never read from the client.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const db = serviceDb();
        const { data, error } = await db
            .from('onboarding_progress')
            .select('track, progress, target, is_claimed, voucher_id, updated_at')
            .eq('wallet_address', wallet);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const rows = data ?? [];
        const byTrack = new Map(rows.map((r: { track: string }) => [r.track, r]));
        const tracks = ONBOARDING_TRACK_KEYS.map((key) => {
            const def = ONBOARDING_TRACKS[key];
            const row = byTrack.get(key) as
                | { progress: number; target: number; is_claimed: boolean; voucher_id: string | null }
                | undefined;
            const progress = row?.progress ?? 0;
            const target = row?.target && row.target > 0 ? row.target : def.target;
            const isClaimed = row?.is_claimed ?? false;
            return {
                track: key,
                label: def.label,
                core: def.core,
                progress,
                target,
                reward: def.reward,
                is_claimed: isClaimed,
                claimable: progress >= target && !isClaimed,
                voucher_id: row?.voucher_id ?? null,
            };
        });

        const { data: welcome } = await db
            .from('mission_vouchers')
            .select('id')
            .eq('wallet_address', wallet)
            .eq('mission_id', WELCOME_GRANT_MISSION_ID)
            .limit(1);

        return NextResponse.json({
            wallet,
            tracks,
            welcomeGrant: {
                reward: WELCOME_GRANT_REWARD,
                claimed: (welcome?.length ?? 0) > 0,
            },
        });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const wallet = await requireAppSession(body?.walletAddress, body?.sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const track = body?.track;
        if (!isOnboardingTrack(track)) {
            return NextResponse.json({ error: 'Unknown track' }, { status: 400 });
        }
        const def = ONBOARDING_TRACKS[track as OnboardingTrack];
        // Server-side increment only — claim flags are never client-writable.
        const rawDelta = body?.delta;
        let delta = 1;
        if (rawDelta !== undefined && rawDelta !== null) {
            const n = Number(rawDelta);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
                return NextResponse.json({ error: 'Invalid delta' }, { status: 400 });
            }
            delta = Math.min(n, def.target);
        }

        const err = await ensurePlayerRow(wallet);
        if (err) return NextResponse.json({ error: err }, { status: 500 });

        const db = serviceDb();
        const { data: existing, error: readError } = await db
            .from('onboarding_progress')
            .select('progress, target, is_claimed')
            .eq('wallet_address', wallet)
            .eq('track', track)
            .maybeSingle();
        if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

        const prev = existing?.progress ?? 0;
        const target = existing?.target && existing.target > 0 ? existing.target : def.target;
        // Never let a replayed increment blow past the target.
        const progress = Math.min(prev + delta, target);

        const { error: upsertError } = await db.from('onboarding_progress').upsert(
            {
                wallet_address: wallet,
                track,
                progress,
                target,
                // Preserve any server-set claim; clients cannot flip it.
                is_claimed: existing?.is_claimed ?? false,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'wallet_address,track' },
        );
        if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

        return NextResponse.json({
            track,
            progress,
            target,
            reward: def.reward,
            complete: progress >= target,
            is_claimed: existing?.is_claimed ?? false,
        });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
